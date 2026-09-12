/**
 * 샘플 피아노 백엔드 — Upright Piano KW(CC0)를 브라우저에서 재생한다.
 *
 * **런타임에 SFZ를 파싱하지 않는다.** `prepare_web_piano.py`가 빌드 타임에
 * `public/piano/manifest.json`으로 구워 두므로, 여기서는 표를 읽고 어떤 파일을
 * 몇 반음 밀어 쓸지만 고른다. SFZ 의미론의 단일 출처는 계속 Python의 `sfz.py`다.
 *
 * **음원이 없어도 앱은 돈다.** 매니페스트를 못 받거나 아직 디코딩 전이면
 * 사인 신스로 낸다(`SineSynth`). 음원 다운로드를 안 한 새 환경에서 404가 나도
 * 연습은 그대로 된다 — Python판 `make_default_backend()`의 폴백과 같은 방침이다.
 *
 * 샘플은 3반음 간격이라 피치 시프트가 최대 ±1반음이다. `playbackRate`로
 * 미는데, 브라우저의 리샘플링이 Python판의 선형 보간과 같은 역할을 한다.
 */

import {
  type AudioBackend,
  ARPEGGIO_GAP_SEC,
  DEFAULT_VELOCITY,
  type NoteHandle,
  NullSynth,
  SILENT_SEQUENCE,
  type Sequence,
  type SequenceNote,
} from "../core/audio";
import type { PlayMode } from "../core/config";
import {
  HELD_LEVEL,
  SEQUENCE_LOOKAHEAD,
  type SequenceState,
  SineSynth,
  rampDown,
  scheduledNotes,
  sequenceHandle,
} from "./synth";

const MANIFEST_URL = "piano/manifest.json";
const BASE = "piano/";
/** 동시에 받을 파일 수. 가운데 음역이 먼저 준비되도록 순서를 지킨다 */
const CONCURRENCY = 6;
/** 로딩 우선순위의 기준음 — 문제는 대개 이 근처에서 난다 */
const PIVOT = 60; // C4

export interface PianoRegion {
  file: string;
  lokey: number;
  hikey: number;
  root: number;
  lovel: number;
  hivel: number;
  /**
   * 이 샘플이 평균율에서 벗어난 정도(센트, 음수면 낮다). 재생할 때 되민다.
   *
   * 원본은 실제 어쿠스틱 업라이트라 **Railsback 곡선**을 따른다 — 현의 강성
   * 때문에 저음을 일부러 낮게, 고음을 높게 조율한 것이지 불량이 아니다.
   * 그래도 평균율로 당기는 이유는 이 앱이 **음정을 가르치기** 때문이다.
   * 두 음이 서로 다른 만큼 어긋나 있으면 그 음정이 맥놀이로 들린다.
   *
   * 녹음 그대로 들어야 할 일이 생기면 `prepare_web_piano.py`가 이 값을 넣지
   * 않도록 하면 된다 — 오디오 자체는 보정과 무관하다.
   */
  tune?: number;
}

export interface PianoManifest {
  release: number;
  regions: PianoRegion[];
}

/**
 * 이 음·세기를 담당하는 region.
 *
 * SFZ는 뒤에 오는 정의가 이기지만 이 음원은 velocity 레이어가 겹치지 않아
 * 첫 매치로 충분하다 — `sfz.find_region`과 같은 규칙이다.
 */
export function pickRegion(
  regions: readonly PianoRegion[],
  midiNote: number,
  velocity: number,
): PianoRegion | null {
  for (const r of regions) {
    if (
      midiNote >= r.lokey &&
      midiNote <= r.hikey &&
      velocity >= r.lovel &&
      velocity <= r.hivel
    ) {
      return r;
    }
  }
  return null;
}

/** 샘플을 몇 반음 밀어야 하는가. 이 음원은 항상 -1~+1 범위다. */
export function semitoneShift(region: PianoRegion, midiNote: number): number {
  return midiNote - region.root;
}

/**
 * 재생 배속. 음정 이동(반음)과 조율 보정(센트)을 한 번에 건다.
 *
 * `tune`이 −5센트(녹음이 5센트 낮다)면 5센트 올려야 하므로 빼는 방향이다.
 */
export function playbackRateFor(region: PianoRegion, midiNote: number): number {
  const cents = semitoneShift(region, midiNote) * 100 - (region.tune ?? 0);
  return 2 ** (cents / 1200);
}

/** 로딩 순서 — 가운데(C4)에 가까운 것부터. */
export function loadOrder(regions: readonly PianoRegion[]): PianoRegion[] {
  return [...regions].sort(
    (a, b) => Math.abs(a.root - PIVOT) - Math.abs(b.root - PIVOT),
  );
}

/** 테스트가 fetch·AudioContext를 갈아끼우는 자리. */
export interface PianoEnv {
  fetch?: typeof fetch;
  baseUrl?: string;
}

export class PianoSynth implements AudioBackend {
  private readonly fallback = new SineSynth();
  private readonly env: PianoEnv;
  private readonly buffers = new Map<string, AudioBuffer>();
  private manifest: PianoManifest | null = null;
  private ctx: AudioContext | null = null;
  private active: AudioBufferSourceNode[] = [];
  /** 지금 도는 시퀀스. `stop()`이 여기에 끝났음을 적는다 */
  private sequence: SequenceState | null = null;
  /** 음원을 하나라도 쓸 수 있게 됐는가 (화면에 알릴 일이 생기면 쓴다) */
  loaded = false;

  constructor(env: PianoEnv = {}) {
    this.env = env;
  }

  private url(path: string): string {
    return (this.env.baseUrl ?? "") + path;
  }

  /**
   * 매니페스트를 받고 샘플을 배경에서 디코딩한다.
   *
   * 디코딩에 `OfflineAudioContext`를 쓰는 이유: 브라우저는 사용자 제스처 전에
   * `AudioContext`를 시작하지 못하게 하는데, 디코딩은 그 제약과 무관하다.
   * 재생용 컨텍스트는 첫 재생 때 따로 만든다.
   */
  async load(): Promise<void> {
    const get = this.env.fetch ?? globalThis.fetch;
    let manifest: PianoManifest;
    try {
      const res = await get(this.url(MANIFEST_URL));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifest = (await res.json()) as PianoManifest;
    } catch {
      // 음원을 준비하지 않은 환경. 사인 신스로 계속 간다.
      return;
    }
    this.manifest = manifest;

    const decoder = new OfflineAudioContext(1, 1, 44_100);
    const queue = loadOrder(manifest.regions);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (let i = cursor++; i < queue.length; i = cursor++) {
        const { file } = queue[i];
        if (this.buffers.has(file)) continue;
        try {
          const res = await get(this.url(BASE + file));
          if (!res.ok) continue;
          const bytes = await res.arrayBuffer();
          this.buffers.set(file, await decoder.decodeAudioData(bytes));
          this.loaded = true;
        } catch {
          // 파일 하나가 없어도 나머지는 쓴다. 그 음만 사인으로 난다.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
    );
  }

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** 요청한 음 전부를 샘플로 낼 수 있는가. 하나라도 없으면 사인으로 통일한다. */
  private canPlay(midiNotes: readonly number[], velocity: number): boolean {
    const regions = this.manifest?.regions;
    if (!regions) return false;
    return midiNotes.every((note) => {
      const region = pickRegion(regions, note, velocity);
      return region !== null && this.buffers.has(region.file);
    });
  }

  playNotes(
    midiNotes: readonly number[],
    duration: number,
    mode: PlayMode = "block",
    velocity = 80,
  ): void {
    if (!midiNotes.length) return;
    // **앞 소리를 먼저 끊는다 — 폴백으로 넘어갈 때도 그렇다.** 여기서 빠뜨리면
    // 샘플로 난 앞 문제의 음이 계속 울리는 채로 다음 문제가 사인으로 겹친다
    // (`fallback.stop()`은 자기 사인 음만 끄지 이쪽 노드를 모른다). 샘플은
    // 배경에서 하나씩 도착하므로 canPlay는 곡 중에도 참↔거짓을 오간다.
    this.stop();
    // 한 문제 안에서 음색이 섞이면 오히려 헷갈린다 — 전부 되거나 전부 사인이다.
    if (!this.canPlay(midiNotes, velocity)) {
      this.fallback.playNotes(midiNotes, duration, mode, velocity);
      return;
    }

    const ctx = this.context();
    const regions = this.manifest!.regions;
    const release = this.manifest!.release;
    const stagger =
      mode === "block" ? 0 : mode === "arpeggio_up" ? ARPEGGIO_GAP_SEC : duration;
    const simultaneous = stagger === 0 ? midiNotes.length : 1;
    const level = (velocity / 127) * 0.9 / Math.max(simultaneous, 1);

    midiNotes.forEach((note, i) => {
      const region = pickRegion(regions, note, velocity)!;
      const buffer = this.buffers.get(region.file)!;
      const start = ctx.currentTime + i * stagger;
      const end = start + duration;

      const env = ctx.createGain();
      env.connect(ctx.destination);
      env.gain.setValueAtTime(level, start);
      env.gain.setValueAtTime(level, end);
      env.gain.linearRampToValueAtTime(0, end + release);

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = playbackRateFor(region, note);
      src.connect(env);
      src.start(start);
      src.stop(end + release + 0.02);
      this.active.push(src);
      src.onended = () => {
        this.active = this.active.filter((n) => n !== src);
      };
    });
  }

  /**
   * 누르고 있는 동안 울리는 한 음 — 자유 연주가 쓰는 경로.
   *
   * `playNotes`와 갈리는 곳이 셋이다. (1) **`stop()`을 부르지 않는다** — 앞
   * 음을 끊으면 화음이 나지 않는다. (2) 끝 시각을 예약하지 않고 `release()`가
   * 정한다. (3) 음원이 없는 음은 **그 음만** 사인으로 낸다 — 문항형에서 음색을
   * 통일하는 규칙(`canPlay`)은 "한 문제가 한 소리"라서 있는 것이고, 연주에서는
   * 방금 누른 음이 조용해지는 편이 훨씬 나쁘다.
   */
  noteOn(midiNote: number, velocity = 80): NoteHandle {
    if (!this.canPlay([midiNote], velocity)) {
      return this.fallback.noteOn(midiNote, velocity);
    }
    const ctx = this.context();
    const region = pickRegion(this.manifest!.regions, midiNote, velocity)!;
    const buffer = this.buffers.get(region.file)!;
    const release = this.manifest!.release;
    const start = ctx.currentTime;
    const level = (velocity / 127) * HELD_LEVEL;

    const env = ctx.createGain();
    env.connect(ctx.destination);
    env.gain.setValueAtTime(level, start);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = playbackRateFor(region, midiNote);
    src.connect(env);
    src.start(start);
    this.active.push(src);
    src.onended = () => {
      this.active = this.active.filter((n) => n !== src);
    };

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const now = ctx.currentTime;
        rampDown(env.gain, now, release);
        try {
          src.stop(now + release + 0.02);
        } catch {
          // 샘플이 이미 끝까지 울렸다 (3초짜리를 그보다 길게 누른 경우)
        }
      },
    };
  }

  /**
   * 악보 재생 — 음표를 한 번에 전부 예약한다.
   *
   * **음색은 `playNotes`처럼 통일한다.** 한 음이라도 샘플이 없으면 시퀀스 전체를
   * 사인으로 낸다 — 곡 중간에서 악기가 바뀌면 전사가 틀린 것처럼 들린다.
   * (자유 연주의 `noteOn`이 그 음만 사인으로 내는 것과 갈리는 자리다. 거기서는
   * 방금 누른 건반이 조용한 것이 더 나쁘고, 여기서는 그 반대다.)
   */
  playSequence(notes: readonly SequenceNote[], fromSec = 0): Sequence {
    if (!notes.length) return SILENT_SEQUENCE;
    const pitches = notes.map((n) => n.midi);
    const velocity = notes[0].velocity ?? DEFAULT_VELOCITY;
    // `playNotes`와 같은 이유로 폴백보다 먼저 끊는다
    this.stop();
    if (!this.canPlay(pitches, velocity)) {
      return this.fallback.playSequence(notes, fromSec);
    }

    const ctx = this.context();
    const regions = this.manifest!.regions;
    const release = this.manifest!.release;
    const base = ctx.currentTime + SEQUENCE_LOOKAHEAD;

    for (const { note, start, end } of scheduledNotes(notes, fromSec, base)) {
      const level = ((note.velocity ?? velocity) / 127) * HELD_LEVEL;
      const region = pickRegion(regions, note.midi, note.velocity ?? velocity)!;
      const buffer = this.buffers.get(region.file)!;

      const env = ctx.createGain();
      env.connect(ctx.destination);
      env.gain.setValueAtTime(level, start);
      env.gain.setValueAtTime(level, end);
      env.gain.linearRampToValueAtTime(0, end + release);

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = playbackRateFor(region, note.midi);
      src.connect(env);
      src.start(start);
      src.stop(end + release + 0.02);
      this.active.push(src);
      src.onended = () => {
        this.active = this.active.filter((n) => n !== src);
      };
    }
    const state: SequenceState = { stopped: false };
    this.sequence = state;
    return sequenceHandle(ctx, base, fromSec, state, () => this.stop());
  }

  stop(): void {
    if (this.sequence) {
      this.sequence.stopped = true;
      this.sequence = null;
    }
    this.fallback.stop();
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

/**
 * 앱이 쓸 오디오 백엔드.
 *
 * 피아노 로딩은 기다리지 않는다 — 준비되기 전에는 사인으로 나고, 준비되면
 * 다음 재생부터 피아노가 된다.
 */
export function makeAudioBackend(env?: PianoEnv): AudioBackend {
  if (typeof AudioContext === "undefined") {
    // jsdom 등 오디오가 없는 환경. **SineSynth를 주면 안 된다** — 그쪽도
    // AudioContext를 만들므로 첫 재생에서 그대로 터진다(실측: 세션을 끝까지
    // 굴리는 App 테스트에서 "AudioContext is not defined").
    return new NullSynth();
  }
  const piano = new PianoSynth(env);
  void piano.load();
  return piano;
}
