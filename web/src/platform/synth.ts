/**
 * 사인파 신스 — **Web Audio를 부르는 구현.**
 *
 * `core/audio.ts`가 `AudioBackend` 인터페이스를 정하고 여기가 그것을 브라우저로
 * 실현한다. 오래 `core/`에 함께 있었는데(그래서 그 파일 주석에 "아직 정리 못 한
 * 빚"으로 적혀 있었다), `AudioContext`를 아는 코드가 `core/`에 있으면 그 층의
 * 규칙("브라우저를 모른다")이 거짓이 된다. Tauri로 갈 때 갈아끼울 것도 이쪽이다.
 *
 * 순수 사인파는 음정 지각이 오히려 어려워서 배음을 몇 개 섞는다. 피치가 수식으로
 * 정확해서, 절대음고를 센트 단위로 다뤄야 하는 기능에는 실제 녹음 샘플보다
 * 이쪽이 낫다.
 */

import {
  ARPEGGIO_GAP_SEC,
  type AudioBackend,
  DEFAULT_VELOCITY,
  type NoteHandle,
  SILENT_SEQUENCE,
  type Sequence,
  type SequenceNote,
  midiToFreq,
} from "../core/audio";
import type { PlayMode } from "../core/config";

/**
 * 배음 비율.
 *
 * **3배음(12도 = 5도)만 유독 낮다.** 나머지 배음은 전부 옥타브 관계(1·2·4배)라
 * 기본음과 같은 음이름이지만, 3배음은 **다른 음이름**을 만든다. 여기가
 * 0.22였을 때 G4가 `G-G-D-G`로 울려 파워코드처럼 들렸다(실측: 오실레이터
 * 주파수 392·784·1176·1568Hz). 음높이를 맞히는 앱에서 한 음이 화음으로 들리면
 * 그 자체로 오답 요인이다.
 */
export const HARMONICS = [1.0, 0.4, 0.09, 0.06];
const ATTACK = 0.012;
const DECAY = 0.09;
const SUSTAIN_LEVEL = 0.72;
const RELEASE = 0.3;
/**
 * 눌러서 낼 때의 음량.
 *
 * `playNotes`는 동시에 울릴 음 수를 미리 알아서 그만큼 나누지만, 연주는 몇 음이
 * 겹칠지 모른다. 넉넉히 낮춰 두고 화음이 겹쳐도 클리핑하지 않게 한다.
 */
export const HELD_LEVEL = 0.35;

/**
 * 게인을 **지금 값에서** 0까지 내린다.
 *
 * 예약해 둔 자동화(어택·디케이 램프)가 미래에 남아 있으면 그것과 싸우므로
 * 반드시 먼저 지워야 한다. `cancelAndHoldAtTime`이 정확하지만 없는 브라우저가
 * 있어 두 갈래로 둔다 — 폴백은 램프 도중에 떼면 그만큼 계단이 생기는데,
 * 어택·디케이가 100ms라 실제로 걸리는 창이 아주 좁다.
 */
export function rampDown(gain: AudioParam, now: number, seconds: number): void {
  if (typeof gain.cancelAndHoldAtTime === "function") {
    gain.cancelAndHoldAtTime(now);
  } else {
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
  }
  gain.linearRampToValueAtTime(0, now + seconds);
}

/**
 * h번째 배음이 사는 시간 = duration / (h+1).
 *
 * 레벨이 끝까지 일정하면 귀가 배음을 **별개의 음으로 분리해서** 듣는다.
 * 실제 악기에서 배음이 하나의 음으로 뭉쳐 들리는 이유는 위 배음일수록 빨리
 * 사라지기 때문이다. 그 감쇠 차이를 여기서 만든다.
 */
function partialLife(harmonic: number, duration: number): number {
  return duration / (harmonic + 1);
}

/**
 * 시퀀스의 첫 음을 얼마나 뒤에 놓을까.
 *
 * `currentTime`에 딱 붙여 예약하면 예약을 마치기도 전에 그 시각이 지나 첫 음이
 * 잘린다. 사람이 알아채지 못할 만큼 짧으면서 수백 개를 예약할 시간은 되는 값이다.
 */
export const SEQUENCE_LOOKAHEAD = 0.06;

/**
 * 살아 있는 시퀀스 표시. **백엔드가 들고 손잡이가 함께 본다.**
 *
 * 손잡이 안에만 두면 `stop()`이나 다음 `playSequence()`가 소리를 끊어도 옛
 * 손잡이는 그것을 모르고 계속 위치를 보고한다 — 화면에서 커서만 혼자 흘러간다.
 */
export interface SequenceState {
  stopped: boolean;
}

/**
 * 재생 중인 시퀀스 손잡이. `SineSynth`와 `PianoSynth`가 함께 쓴다.
 *
 * **끝을 모른다** — 예약이 다 끝난 뒤에도 `positionSec()`은 계속 늘어난다.
 * 언제 끝나는지는 음표를 넘긴 쪽이 알고 있으므로 거기서 판단한다.
 */
/**
 * 시퀀스의 음표를 **예약할 시각으로 옮긴다.** 두 백엔드가 함께 쓴다 — 소리를
 * 내는 방법(사인 · 샘플)은 다르지만 "언제"는 같은 규칙이다.
 *
 * 거르는 규칙 둘이 여기 한 곳에 있다. (1) **끝이 재생 지점보다 앞인 것만
 * 버린다** — 시작만 보면 재생 지점에 걸쳐 있는 음표를 통째로 잃는다.
 * (2) 길이가 0 이하로 접힌 음표는 예약하지 않는다(예약해도 소리가 안 난다).
 */
export function* scheduledNotes(
  notes: readonly SequenceNote[],
  fromSec: number,
  base: number,
): Generator<{ note: SequenceNote; start: number; end: number }> {
  for (const note of notes) {
    if (note.endSec <= fromSec) continue;
    const start = base + Math.max(0, note.startSec - fromSec);
    const end = base + note.endSec - fromSec;
    if (end <= start) continue;
    yield { note, start, end };
  }
}

export function sequenceHandle(
  ctx: AudioContext,
  base: number,
  fromSec: number,
  state: SequenceState,
  stop: () => void,
): Sequence {
  return {
    // 룩어헤드 동안에는 아직 시작 전이라 음수가 나온다 — 시작점에서 잡아 둔다
    positionSec: () =>
      state.stopped
        ? null
        : Math.max(fromSec, ctx.currentTime - base + fromSec),
    stop: () => {
      if (state.stopped) return;
      state.stopped = true;
      stop();
    },
  };
}

/** 사인파 가산합성 + ADSR. */
export class SineSynth implements AudioBackend {
  private ctx: AudioContext | null = null;
  private active: AudioScheduledSourceNode[] = [];
  /** 지금 도는 시퀀스. `stop()`이 여기에 끝났음을 적는다 */
  private sequence: SequenceState | null = null;

  /**
   * 브라우저는 사용자 제스처 전에는 오디오를 시작하지 못하게 한다.
   * 첫 재생 시점에 만들고 resume한다.
   */
  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private staggerSec(mode: PlayMode, duration: number): number {
    if (mode === "block") return 0;
    return mode === "arpeggio_up" ? ARPEGGIO_GAP_SEC : duration;
  }

  playNotes(
    midiNotes: readonly number[],
    duration: number,
    mode: PlayMode = "block",
    velocity = 80,
  ): void {
    if (!midiNotes.length) return;
    this.stop();

    const ctx = this.context();
    const stagger = this.staggerSec(mode, duration);
    // 화음일 때 클리핑 방지 — 동시에 울리는 음 수로 나눈다
    const simultaneous = stagger === 0 ? midiNotes.length : 1;
    const level = (velocity / 127) * 0.85 / Math.max(simultaneous, 1);

    midiNotes.forEach((note, i) => {
      this.voice(ctx, note, ctx.currentTime + i * stagger, duration, level);
    });
  }

  /**
   * 시각과 길이가 정해진 음 하나를 예약한다.
   *
   * `playNotes`와 `playSequence`가 **함께 쓴다** — 각자 포락선을 만들면 같은 앱
   * 안에서 문제 재생과 악보 재생의 음색이 갈린다.
   */
  private voice(
    ctx: AudioContext,
    midiNote: number,
    start: number,
    duration: number,
    level: number,
  ): void {
    const freq = midiToFreq(midiNote);
    const harmonicSum = HARMONICS.reduce((a, b) => a + b, 0);

    // 배음마다 자기 포락선을 갖는다. 하나의 포락선을 공유하면 모든 배음이
    // 끝까지 같은 레벨로 울려 서로 다른 음처럼 분리되어 들린다.
    HARMONICS.forEach((amp, h) => {
      const partial = freq * (h + 1);
      // 나이퀴스트를 넘는 배음은 앨리어싱만 만든다
      if (partial >= ctx.sampleRate / 2) return;

      const peak = level * (amp / harmonicSum);
      const life = partialLife(h, duration);
      // 자동화 이벤트의 시각이 뒤집히지 않도록 순서를 강제한다
      const decayed = start + ATTACK + DECAY;
      const hold = Math.max(start + life - RELEASE, decayed);
      const end = Math.max(start + life, hold + ATTACK);

      const env = ctx.createGain();
      env.connect(ctx.destination);
      const g = env.gain;
      g.setValueAtTime(0, start);
      g.linearRampToValueAtTime(peak, start + ATTACK);
      g.linearRampToValueAtTime(peak * SUSTAIN_LEVEL, decayed);
      g.setValueAtTime(peak * SUSTAIN_LEVEL, hold);
      g.linearRampToValueAtTime(0, end);

      const osc = ctx.createOscillator();
      osc.frequency.value = partial;
      osc.connect(env);
      osc.start(start);
      osc.stop(end + 0.02);
      this.active.push(osc);
      osc.onended = () => {
        this.active = this.active.filter((n) => n !== osc);
      };
    });
  }

  /**
   * 악보 재생. **음표를 한 번에 전부 예약한다.**
   *
   * 4분 곡이 600음쯤이라 노드 수백 개면 충분히 싸다. 끊기는 것이 실제로 관측되면
   * 그때 룩어헤드 스케줄러로 쪼갠다 — 지금 넣으면 근거 없는 복잡도다.
   */
  playSequence(notes: readonly SequenceNote[], fromSec = 0): Sequence {
    this.stop();
    if (!notes.length) return SILENT_SEQUENCE;

    const ctx = this.context();
    const base = ctx.currentTime + SEQUENCE_LOOKAHEAD;
    for (const { note, start, end } of scheduledNotes(notes, fromSec, base)) {
      const velocity = note.velocity ?? DEFAULT_VELOCITY;
      this.voice(ctx, note.midi, start, end - start, (velocity / 127) * HELD_LEVEL);
    }
    const state: SequenceState = { stopped: false };
    this.sequence = state;
    return sequenceHandle(ctx, base, fromSec, state, () => this.stop());
  }

  /**
   * 누르고 있는 동안 울리는 한 음. **`stop()`을 부르지 않는다** — 앞서 누른
   * 음을 끊으면 화음이 나지 않는다.
   *
   * 감쇠 없이 서스테인 레벨로 버티다가 `release()`에서 내려온다. 배음마다
   * 포락선을 따로 주는 것은 `playNotes`와 같은 이유다(위 `partialLife` 주석).
   */
  noteOn(midiNote: number, velocity = 80): NoteHandle {
    const ctx = this.context();
    const start = ctx.currentTime;
    const freq = midiToFreq(midiNote);
    const level = (velocity / 127) * HELD_LEVEL;
    const harmonicSum = HARMONICS.reduce((a, b) => a + b, 0);
    const parts: Array<{ osc: OscillatorNode; gain: AudioParam }> = [];

    HARMONICS.forEach((amp, h) => {
      const partial = freq * (h + 1);
      if (partial >= ctx.sampleRate / 2) return;
      const peak = level * (amp / harmonicSum);

      const env = ctx.createGain();
      env.connect(ctx.destination);
      const g = env.gain;
      g.setValueAtTime(0, start);
      g.linearRampToValueAtTime(peak, start + ATTACK);
      g.linearRampToValueAtTime(peak * SUSTAIN_LEVEL, start + ATTACK + DECAY);

      const osc = ctx.createOscillator();
      osc.frequency.value = partial;
      osc.connect(env);
      osc.start(start);
      this.active.push(osc);
      osc.onended = () => {
        this.active = this.active.filter((n) => n !== osc);
      };
      parts.push({ osc, gain: g });
    });

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const now = ctx.currentTime;
        for (const { osc, gain } of parts) {
          rampDown(gain, now, RELEASE);
          try {
            osc.stop(now + RELEASE + 0.02);
          } catch {
            // 이미 끝난 노드는 무시한다
          }
        }
      },
    };
  }

  stop(): void {
    if (this.sequence) {
      this.sequence.stopped = true;
      this.sequence = null;
    }
    for (const node of this.active) {
      try {
        node.stop();
      } catch {
        // 이미 끝난 노드는 무시한다
      }
    }
    this.active = [];
  }
}
