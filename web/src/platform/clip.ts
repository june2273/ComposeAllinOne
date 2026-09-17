/**
 * **오디오 클립의 한 구간을 이음매 없이 반복하는 유일한 곳.**
 *
 * 드럼 패널이 루프 구간을 귀로 확인하는 데 쓴다. 사양서 §6이 못박은 것 —
 * "소니피케이션 = 주 검증 경로 … 시각화는 훑어보기용이고 **확정은 귀로 한다**"
 * — 이 실제로 실행되는 자리다. 정답이 하나도 없는 지금 판정이 맞는지 말할 수
 * 있는 경로가 이것뿐이다.
 *
 * ## `AudioBackend`에 붙이지 않은 이유
 *
 * 그쪽은 **음표를 내는** 인터페이스이고(`playNotes`·`noteOn`·`playSequence`)
 * 여기서 필요한 것은 **이미 있는 오디오의 한 조각을 트는 것**이다. 축이 다르다.
 * 게다가 CLAUDE.md가 그 인터페이스는 EQ·라우드니스·팬과 **한꺼번에 설계해서 한
 * 번에 고치라**고 못박아 뒀다 — 상관없는 축을 지금 끼워 넣으면 그 설계가 시작도
 * 전에 더러워진다.
 *
 * ## `<audio>` 요소를 안 쓴 이유
 *
 * 구간 반복을 `<audio>`로 하려면 `timeupdate`를 듣고 `currentTime`을 되돌려야
 * 하는데 그 이벤트는 초당 네 번쯤 온다 — 드럼 루프에서 250ms 늦게 되감기면
 * 그것만으로 박자가 무너진다. `AudioBufferSourceNode`의 `loopStart`/`loopEnd`는
 * **샘플 단위로 정확하다.**
 *
 * ## 클릭은 스케줄러를 만들지 않고 **미리 섞는다**
 *
 * 메트로놈을 실시간으로 예약하려면 룩어헤드 스케줄러가 필요한데, 그건 이 앱에
 * 아직 없는 기반이다(트랜스포트 시계). 대신 `OfflineAudioContext`로 [구간
 * 오디오 + 클릭]을 **버퍼 하나로 렌더한 뒤** 그걸 네이티브 루프한다 —
 * 스케줄러가 0개이고 클릭 정렬은 완벽하다. `piano.ts`가 디코딩에 이미
 * `OfflineAudioContext`를 쓰는 선례가 있다.
 */

/**
 * 재생 중인 클립 손잡이. `Sequence`와 **같은 모양이고 같은 함정을 피한다.**
 *
 * 손잡이 안에만 상태를 두면 `stop()`이나 다음 `loop()`가 소리를 끊어도 옛
 * 손잡이는 그걸 모르고 계속 위치를 보고한다 — 소리는 끊겼는데 커서만 혼자
 * 흘러간다. 그래서 재생기의 상태를 함께 본다.
 */
export interface Clip {
  /** 클립 안에서의 현재 시각(초). 멈췄으면 `null` */
  positionSec(): number | null;
  stop(): void;
}

/** `Sequence`의 `SequenceState`와 같은 자리 */
interface ClipState {
  stopped: boolean;
}

export interface ClipPlayer {
  /** 오디오를 받아 디코딩해 둔다. 같은 URL을 두 번 부르면 두 번째는 즉시 끝난다 */
  load(url: string, signal?: AbortSignal): Promise<void>;
  /** 길이(초). 아직 안 받았으면 0 */
  durationSec(): number;
  /**
   * `[fromSec, toSec)`을 반복 재생한다.
   *
   * `clicks`를 주면 그 시각(클립 기준 초)에 메트로놈을 **미리 섞어** 렌더한다.
   */
  loop(fromSec: number, toSec: number, clicks?: readonly number[]): Clip;
  stop(): void;
  /** 화면을 떠날 때. `AudioContext`를 닫는다 */
  dispose(): void;
}

export interface ClipEnv {
  /** 테스트가 가짜 컨텍스트를 넣는 자리 */
  context?: () => AudioContext;
  fetch?: typeof fetch;
  /** 클릭 섞기용. 없으면 클릭 없이 원본 구간만 튼다 */
  offline?: (channels: number, length: number, rate: number) => OfflineAudioContext;
}

/** 클릭 소리 — 짧은 사인 감쇠. 드럼 위에서 들리도록 조금 높다 */
const CLICK_HZ = 1600;
const CLICK_SEC = 0.02;
const CLICK_LEVEL = 0.35;
/** 구간이 이보다 짧으면 반복이 뜻이 없다 */
const MIN_LOOP_SEC = 0.05;

const SILENT: Clip = {
  positionSec: () => null,
  stop: () => {},
};

export function makeClipPlayer(env: ClipEnv = {}): ClipPlayer {
  let ctx: AudioContext | null = null;
  let buffer: AudioBuffer | null = null;
  let loadedUrl: string | null = null;
  let source: AudioBufferSourceNode | null = null;
  let state: ClipState | null = null;

  const context = (): AudioContext => {
    if (!ctx) ctx = (env.context ?? (() => new AudioContext()))();
    // 브라우저는 사용자 제스처 전에 오디오를 못 시작하게 한다
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  };

  const stop = (): void => {
    if (state) state.stopped = true;
    state = null;
    if (source) {
      try {
        source.stop();
      } catch {
        // 이미 끝난 노드를 멈추면 던진다 — 멈추려던 목적은 이미 이뤄졌다
      }
      source.disconnect();
      source = null;
    }
  };

  /**
   * 구간을 잘라 클릭을 섞은 버퍼. 클릭이 없으면 자르기만 한다.
   *
   * **오프라인 렌더가 없으면 원본을 그대로 쓴다** — 클릭은 있으면 좋은 것이고,
   * 없다고 루프 재생을 통째로 포기할 이유가 없다.
   */
  const render = async (
    from: number,
    to: number,
    clicks: readonly number[],
  ): Promise<{ buffer: AudioBuffer; offset: number }> => {
    if (!buffer) throw new Error("클립을 아직 안 받았다");
    const makeOffline = env.offline;
    if (clicks.length === 0 || !makeOffline) return { buffer, offset: from };

    const rate = buffer.sampleRate;
    const length = Math.max(1, Math.round((to - from) * rate));
    const offline = makeOffline(buffer.numberOfChannels, length, rate);

    const slice = offline.createBufferSource();
    slice.buffer = buffer;
    slice.connect(offline.destination);
    slice.start(0, from, to - from);

    for (const at of clicks) {
      const local = at - from;
      if (local < 0 || local >= to - from) continue;
      const osc = offline.createOscillator();
      const gain = offline.createGain();
      osc.frequency.value = CLICK_HZ;
      gain.gain.setValueAtTime(CLICK_LEVEL, local);
      gain.gain.exponentialRampToValueAtTime(0.0001, local + CLICK_SEC);
      osc.connect(gain);
      gain.connect(offline.destination);
      osc.start(local);
      osc.stop(local + CLICK_SEC);
    }

    return { buffer: await offline.startRendering(), offset: 0 };
  };

  return {
    async load(url, signal) {
      if (loadedUrl === url && buffer) return;
      const get = env.fetch ?? fetch;
      const response = await get(url, { signal });
      if (!response.ok) throw new Error(`오디오를 못 받았다 (${response.status})`);
      const bytes = await response.arrayBuffer();
      buffer = await context().decodeAudioData(bytes);
      loadedUrl = url;
    },

    durationSec: () => buffer?.duration ?? 0,

    loop(fromSec, toSec, clicks) {
      stop();
      if (!buffer) return SILENT;
      const from = Math.max(0, Math.min(fromSec, buffer.duration));
      const to = Math.max(from + MIN_LOOP_SEC, Math.min(toSec, buffer.duration));
      if (to - from < MIN_LOOP_SEC) return SILENT;

      const audio = context();
      const mine: ClipState = { stopped: false };
      state = mine;
      const span = to - from;
      /**
       * **소리가 실제로 시작한 시각.** 클릭을 섞을 때는 오프라인 렌더가 끝나야
       * 시작하므로, `loop()`을 부른 시각으로 재면 커서가 렌더 시간만큼 앞서
       * 나간다 — 아직 아무 소리도 안 나는 동안 위치가 흐르기도 한다.
       */
      let startedAt: number | null = null;

      // 클릭 섞기는 비동기라, 먼저 원본으로 시작하고 준비되면 갈아탄다면
      // 이음매가 생긴다. 클릭이 있으면 렌더가 끝난 뒤에 시작한다.
      const begin = (playBuffer: AudioBuffer, offset: number) => {
        if (mine.stopped) return;
        startedAt = audio.currentTime;
        const node = audio.createBufferSource();
        node.buffer = playBuffer;
        node.loop = true;
        node.loopStart = offset;
        node.loopEnd = offset + span;
        node.connect(audio.destination);
        node.start(0, offset);
        source = node;
      };

      if (clicks && clicks.length > 0 && env.offline) {
        void render(from, to, clicks).then(
          (rendered) => begin(rendered.buffer, rendered.offset),
          () => begin(buffer!, from),
        );
      } else {
        begin(buffer, from);
      }

      return {
        positionSec: () => {
          if (mine.stopped) return null;
          // 아직 시작 전(클릭 렌더 중)이면 구간의 머리에 서 있다
          if (startedAt === null) return from;
          const elapsed = audio.currentTime - startedAt;
          return from + (elapsed % span);
        },
        stop: () => {
          if (mine.stopped) return;
          stop();
        },
      };
    },

    stop,

    dispose() {
      stop();
      buffer = null;
      loadedUrl = null;
      if (ctx) {
        void ctx.close();
        ctx = null;
      }
    },
  };
}
