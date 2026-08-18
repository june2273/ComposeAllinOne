/**
 * 전사 — **피치 커브 하나에서 음표·MIDI·악보까지.**
 *
 * ```
 * f0 커브 ──[notes]── 음표 ──[quantize]── 격자 음표 ──┬─[midi]──── .mid
 *   (사이드카)   │            (비트 그리드)            └─[musicxml]─ 악보
 *               └──[curve]── 컨트롤 점 ──[svp]──────────────────── .svp
 * ```
 *
 * 아래 갈래가 **커브를 산출물로 내보내는 길**이다(2026-08-12). 위 갈래는 커브에서
 * 음표만 뽑고 비브라토·포르타멘토를 버리는데, 가창 합성기에 음표만 주면 합성기의
 * AI가 자기 피치 커브를 새로 만들어 붙인다 — **원 보컬이 어떻게 불렀는지가 한
 * 톨도 남지 않는다.** 두 갈래는 같은 커브를 보되 서로를 import하지 않는다.
 *
 * ## 이 층이 지키는 것
 *
 * - **순수 함수다.** `fetch`도 `Worker`도 `AudioContext`도 모른다. 답을 아는
 *   합성 f0(사인 하나면 된다)로 브라우저 없이 테스트가 돈다 —
 *   `core/analysis`와 같은 방침이다.
 * - **모델은 여기 없다.** 스템 분리와 f0 추출은 학습된 모델이 필요해서
 *   Python 사이드카가 한다(`platform/sidecar.ts`). 이 층은 **모델이 뱉은 숫자를
 *   음악으로 옮기는 일**만 한다 — 그래서 사이드카를 갈아끼워도 여기는 안 바뀐다.
 * - **원본을 지우지 않는다.** f0 커브도, 양자화 전 시각도 결과에 남는다
 *   (사양서 §1.8·§9).
 *
 * ## 기대치
 *
 * 나오는 악보는 **초안이다.** 이명동음·성부·잇단음표는 자동화되지 않고
 * (`musicxml.ts` 첫 주석), 임계값들은 평가셋 없이 정했다(`notes.ts`). 분리
 * 아티팩트와 숨소리가 가짜 음표를 만드는 것도 아직 못 막는다.
 */

import {
  type NoteEvent,
  type NoteOptions,
  type PitchCurve,
  segmentNotes,
  tuningDriftCents,
  tuningResidualCents,
} from "./notes";
import { fromNotes, fromQuantized, type MidiOptions } from "./midi";
import {
  buildGrid,
  estimateOffsetCurve,
  type Grid,
  type OffsetCurve,
  type QuantizedNote,
  nearestStep,
  quantizeNotes,
} from "./quantize";
import { keyFifths, toMusicXml } from "./musicxml";

export type { NoteEvent, NoteOptions, OnsetCurve, PitchCurve } from "./notes";
export {
  hzToMidi,
  midiToHz,
  onsetPeaks,
  segmentNotes,
  tuningDriftCents,
  tuningResidualCents,
  MIN_MIDI,
  MAX_MIDI,
} from "./notes";
export type {
  Grid,
  OffsetCurve,
  QuantizedNote,
  QuantizeInput,
  QuantizeOptions,
} from "./quantize";
export {
  buildGrid,
  estimateOffsetCurve,
  estimateOffsetMs,
  metricalCost,
  nearestStep,
  offsetAtMs,
  quantizeNotes,
  stepAtTime,
  stepTime,
  STEPS_PER_BEAT,
} from "./quantize";
export { fromNotes, fromQuantized, writeVarLen, TICKS_PER_BEAT } from "./midi";
export type { PitchPoint, PitchTrack, PitchTrackOptions } from "./curve";
export { buildPitchTrack } from "./curve";
export type { SvpInput, SvpOptions } from "./svp";
export { toSvp, BLICKS_PER_QUARTER } from "./svp";
export type { Fifths, HarmonyMark, ScoreOptions } from "./musicxml";
export {
  keyAlter,
  keyFifths,
  notatePiece,
  splitDuration,
  toMusicXml,
} from "./musicxml";

/**
 * 가창 합성기로 보낼 때 음표마다 붙이는 음절.
 *
 * `la`인 것은 어느 언어의 보컬 라이브러리든 무리 없이 발음하기 때문이다 —
 * 영어·일본어·중국어 모두 그대로 읽는다. 진짜 가사는 사용자가 합성기 안에서
 * 덮어쓴다(신스V는 음표를 고르고 Ctrl+L).
 */
const VOCAL_LYRIC = "la";

/**
 * 음표들이 격자에서 이만큼(센트) 넘게 벗어나 있으면 조율을 의심한다.
 *
 * 반음의 1/3쯤이다. 벤드·비브라토로는 중앙값이 여기까지 오지 않는다 —
 * 이만큼 어긋났다면 격자 자체가 밀린 것이다.
 */
const TUNING_RETRY_CENTS = 35;

/**
 * 전사에 필요한 문맥. `AnalysisReport`에서 그대로 꺼낸 값들이다.
 *
 * 이 타입이 `AnalysisReport`를 직접 받지 않는 것은 의도다 — 전사는 BPM·박자·
 * 조성만 있으면 되고, 분석 보고서 전체에 묶이면 사이드카가 자기 비트 그리드를
 * 갖고 올 때(더 나은 비트 트래커를 붙일 때) 갈아끼울 수 없다.
 */
export interface TranscribeContext {
  readonly bpm: number;
  readonly beats: readonly number[];
  readonly downbeats: readonly number[];
  readonly beatsPerBar: number;
  /** 음원 전체의 조율 편차(센트). `AnalysisReport.tuningCents` */
  readonly tuningCents?: number;
  /** 조표 계산용 */
  readonly key?: { readonly tonic: number; readonly mode: "major" | "minor" };
  readonly title?: string;
  /**
   * 악보에 얹을 코드. **초 단위로 받는다** — 격자 칸으로 옮기는 것은 여기서
   * 한다(`buildGrid` 뒤에). 호출부가 자기 격자를 짐작해서 칸 번호를 계산하면
   * 그 순간 두 격자가 갈리고, 코드가 음표와 다른 자리에 앉는다.
   *
   * `analysis.ChordEvent`와 **모양만 맞춘다** — 두 층은 서로를 import하지
   * 않는다(`OnsetCurve`와 같은 방식).
   */
  readonly chords?: readonly {
    readonly atSec: number;
    readonly root: number;
    readonly kind: string;
    readonly text: string;
  }[];
}

export interface Transcription {
  /** 노래한 그대로. 양자화 전이다 */
  readonly notes: readonly NoteEvent[];
  /** 격자에 얹은 것. 악보와 같은 시각을 갖는다 */
  readonly quantized: readonly QuantizedNote[];
  readonly grid: Grid;
  readonly musicXml: string;
  /**
   * 같은 악보에 음표마다 `la` 한 음절을 얹은 것. **가창 합성기용이다.**
   *
   * 악보용과 갈라 둔 이유는 화면이다 — 오선 아래 `la`가 죽 늘어서면 읽기만
   * 나빠진다. 파일로 나갈 때만 필요하다(`ScoreOptions.lyric`).
   */
  readonly vocalXml: string;
  readonly fifths: number;
  /**
   * **원본 f0 커브를 그대로 들고 있는다.**
   *
   * 사양서 §1.8·§9의 "f0가 원재료, 노트는 그 양자화 결과"를 타입으로 지킨 것이다.
   * 예전에는 `transcribe()`가 커브를 인자로만 받고 결과에 안 실어서, 비브라토·
   * 포르타멘토를 되찾으려면 호출부가 커브를 따로 들고 다녀야 했다 — 그러면
   * **어느 조율값으로 자른 커브인지가 갈릴 수 있다.** 같은 객체에 `tuningCents`와
   * 함께 두면 그 짝이 어긋날 자리가 없어진다.
   */
  readonly curve: PitchCurve;
  /**
   * 노래가 박에서 평균 얼마나 밀려 있었는가(밀리초, 양수면 늦음).
   *
   * 양자화가 걷어낸 값이다. **그 자체로 진단 정보다** — 이게 크면 비트 추적이
   * 어긋났거나 가수가 뒤로 눕혀 부른 것이고, 둘은 악보를 보는 눈이 다르다.
   *
   * 곡선(`offsetCurve`)의 중앙값이다 — 밀린 양은 곡 안에서도 변한다.
   */
  readonly offsetMs: number;
  /** 시변 오프셋 전체. 드리프트가 얼마나 심했는지를 본다 */
  readonly offsetCurve: OffsetCurve;
  /**
   * 실제로 쓴 조율 보정(센트). 믹스에서 온 값이 아니라 **고른 값**이다
   * (`segmentWithTuning`). 음이 통째로 어긋나 보일 때 가장 먼저 볼 숫자다.
   */
  readonly tuningCents: number;
}

/**
 * 커브 하나를 전사한다. 실패하지 않는다 — 음이 하나도 없으면 빈 악보가 나온다.
 *
 * 비트가 두 개 미만이면 격자를 못 만드는데, 그때는 BPM으로 등간격 격자를
 * 세운다. 분석이 비트를 못 잡은 곡(박이 뚜렷하지 않은 발라드 등)에서도
 * MIDI만은 나오게 하기 위해서다 — 그런 곡의 악보는 어차피 검수 대상이다.
 */
export function transcribe(
  curve: PitchCurve,
  context: TranscribeContext,
  options: NoteOptions = {},
): Transcription {
  const { notes, tuningCents } = segmentWithTuning(curve, context, options);

  const beats = context.beats.length >= 2
    ? context.beats
    : syntheticBeats(curve, context.bpm);
  const grid = buildGrid({
    beats,
    downbeats: context.downbeats,
    beatsPerBar: context.beatsPerBar,
  });
  // 오프셋을 먼저 재고 양자화에 넘긴다 — 결과에도 실어 보내야 하므로
  // `quantizeNotes` 안에서 몰래 추정하게 두지 않는다.
  const offsetCurve = estimateOffsetCurve(notes, grid);
  const quantized = quantizeNotes(notes, grid, { curve: offsetCurve });

  const fifths = context.key
    ? keyFifths(context.key.tonic, context.key.mode)
    : 0;
  // 코드는 초로 들어와 여기서 격자 칸이 된다. **격자를 만든 뒤여야 한다**
  const harmony = (context.chords ?? []).map((chord) => ({
    step: nearestStep(grid, chord.atSec),
    root: chord.root,
    kind: chord.kind,
    text: chord.text,
  }));

  const scoreOptions = {
    beatsPerBar: grid.beatsPerBar,
    stepsPerBeat: grid.stepsPerBeat,
    // MIDI에는 이미 나가던 값이다. 없으면 읽는 쪽이 120으로 연다
    bpm: context.bpm,
    // 조표만이 아니라 **조성을 통째로** 넘긴다 — 단조의 이끎음을 ♯으로 적으려면
    // 으뜸음이 어디인지 알아야 한다(`musicxml.spellingFor`)
    key: context.key,
    title: context.title,
  };
  // **코드 심볼은 악보에만 얹는다.** `vocalXml`은 가창 합성기가 읽는 파일이고
  // 거기서 코드 심볼은 쓰이지 않는다 — 화면 악보에 `la`를 안 거는 것과 같은
  // 이유로, 파일마다 필요한 것만 넣는다.
  const musicXml = toMusicXml(quantized, { ...scoreOptions, harmony });
  const vocalXml = toMusicXml(quantized, { ...scoreOptions, lyric: VOCAL_LYRIC });

  return {
    notes,
    quantized,
    grid,
    musicXml,
    vocalXml,
    fifths,
    curve,
    offsetMs: offsetCurve.medianMs,
    offsetCurve,
    tuningCents,
  };
}

/**
 * 조율을 정하고 음표를 자른다. **자르고 나서 되짚는다.**
 *
 * 출발점은 믹스에서 잰 값(`context.tuningCents`)이다. 그런데 그 값은 반주가
 * 지배하고, 조율이 밀리면 **음표가 통째로 옆 음으로 떨어진다** — 소리로도 악보로도
 * 크게 틀리는 종류의 오류다.
 *
 * 그래서 추정을 한 번 더 하지 않고 **결과를 본다.** 잘라 놓은 음표들이 반음 격자에서
 * 한쪽으로 쏠려 있으면(`tuningDriftCents`) 그만큼 밀어서 다시 자르고, **남은 편차가
 * 실제로 줄었을 때만** 새 값을 쓴다. 개선을 확인하지 않으면 자가 점검이 아니라
 * 또 하나의 추정일 뿐이다.
 */
function segmentWithTuning(
  curve: PitchCurve,
  context: TranscribeContext,
  options: NoteOptions,
): { notes: NoteEvent[]; tuningCents: number } {
  const base = context.tuningCents ?? 0;
  const cut = (cents: number) =>
    segmentNotes(curve, { tuningCents: cents, ...options });

  const notes = cut(base);
  const residual = tuningResidualCents(notes);
  const drift = tuningDriftCents(notes);
  if (residual <= TUNING_RETRY_CENTS || drift === null || Math.abs(drift) < 1) {
    return { notes, tuningCents: base };
  }
  const moved = base + drift;
  const retry = cut(moved);
  return tuningResidualCents(retry) < residual
    ? { notes: retry, tuningCents: moved }
    : { notes, tuningCents: base };
}

/** 전사 결과를 파일 두 벌로. 원본 타이밍과 격자 타이밍 둘 다 낸다 */
export function toMidiFiles(
  result: Transcription,
  options: MidiOptions,
): { readonly performed: Uint8Array; readonly quantized: Uint8Array } {
  return {
    performed: fromNotes(result.notes, { ...options, name: "melody (performed)" }),
    quantized: fromQuantized(result.quantized, result.grid, {
      ...options,
      name: "melody (quantized)",
    }),
  };
}

function syntheticBeats(curve: PitchCurve, bpm: number): number[] {
  const period = 60 / (bpm > 0 ? bpm : 120);
  const duration = (curve.f0.length * curve.hopMs) / 1000;
  const out: number[] = [];
  for (let t = 0; t <= duration + period; t += period) out.push(t);
  return out;
}
