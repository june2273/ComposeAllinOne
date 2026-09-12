/**
 * 오디오 분석 — 파일 하나에서 **BPM · 박자 · 조성 · 코드**를 뽑는다.
 *
 * ```
 * 샘플 → [특징] ODF · 크로마 · 저역
 *          ↓
 *        [템포] 자기상관 × 로그정규 prior
 *          ↓
 *        [비트] DP 추적 → 여기서 최종 BPM이 나온다
 *          ↓
 *        [박자] 축A(세분화) × 축B(마디당 박)      [조성] 크로마 × 프로파일
 *          ↓
 *        [코드] 긴 창 크로마 → 비트로 접기 → 템플릿 24개 → Viterbi
 * ```
 *
 * 파이프라인 사양서의 [2]·[3]·[4]·[5]·[6]·[7]에 해당한다. 스템 분리와 멜로디
 * 추출은 **여기 없다** — 학습된 모델이 필요해서 브라우저 안에서 끝나지 않고,
 * 파이썬 사이드카가 맡는다. 코드는 학습된 모델 없이 되는 일이라 여기 있다.
 *
 * ## 이 층이 지키는 것
 *
 * - **순수 함수다.** `AudioContext`도 `Worker`도 모른다. 그래서 브라우저
 *   없이 합성 신호로 테스트가 돈다.
 * - **의존성이 없다.** FFT까지 직접 짰다(`fft.ts` 주석 참조).
 * - **단계마다 신뢰도를 돌려준다.** 사양서 §2가 요구하는 것 — 오차 전파가
 *   이 파이프라인의 최대 리스크라 각 단계가 "모르겠음"을 말할 수 있어야 한다.
 *
 * ## 아직 못 하는 것 (의도적으로)
 *
 * 변박·전조·변속은 **전부 "구간을 어떻게 나눌 것인가"의 문제**이고, 그러려면
 * 구조 분석(섹션 경계)이 먼저 있어야 한다. 지금은 곡 전체를 한 덩어리로 본다.
 * 곡 중간에 바뀌는 곡을 넣으면 우세한 쪽 하나가 나온다.
 */

import { extractChordChroma, extractFeatures, ANALYSIS_RATE } from "./features";
import { estimateChords, type ChordEstimate, type ChordEvent } from "./chords";
import { estimateKey, keyFifths, type KeyEstimate } from "./key";
import { estimateMeter, type MeterEstimate } from "./meter";
import {
  bpmOf,
  metricalFamily,
  retimeBeats,
  type TempoCandidate,
} from "./beats";

export {
  ANALYSIS_RATE,
  CHORD_FRAME_SIZE,
  CHORD_HOP_SIZE,
  extractChordChroma,
  extractFeatures,
  extractOnsetCurve,
  FRAME_SIZE,
  HOP_SIZE,
  normalizeOnset,
} from "./features";
export type { FeatureOptions, FrameFeatures } from "./features";
export { bpmOf, MAX_BPM, MIN_BPM, metricalFamily, relatedTempo, retimeBeats } from "./beats";
export type { TempoCandidate } from "./beats";
export { chordTemplates, estimateChords, rootName } from "./chords";
export type {
  ChordCandidate,
  ChordEstimate,
  ChordEvent,
  ChordOptions,
  ChordQuality,
} from "./chords";
export { keyFifths } from "./key";
export { barEffect, beatChroma, beatNovelty } from "./meter";
export { locate, relabelPreChorus, sectionsFromSegments } from "./sections";
export type {
  RawSegment,
  Section,
  SectionLabel,
  SectionOptions,
  StagedSection,
} from "./sections";
export type { KeyEstimate, MeterEstimate };

/** 진행 상황. 화면이 멈춘 것처럼 보이지 않게 하는 용도 */
export interface AnalysisProgress {
  readonly stage: string;
  /** 0~1 */
  readonly ratio: number;
}

/**
 * 밖에서 받은 비트 격자. **2026-09-12부터 이것이 필수 입력이다.**
 *
 * 예전에는 `analyzeAudio`가 자기상관으로 직접 만들었는데, 배수 오류를 원리적으로
 * 못 가려서 사이드카의 Beat This!로 갈아탔다(`server/app/beats.py`).
 * 워커에는 네트워크가 없으므로 **메인 스레드가 먼저 받아 함께 넣는다.**
 */
export interface BeatGrid {
  readonly beats: readonly number[];
  readonly downbeats: readonly number[];
  readonly beatsPerBar: number;
  /** 사이드카가 낸 BPM. 없으면 비트열에서 다시 뽑는다 */
  readonly bpm?: number;
}

export interface AnalysisOptions {
  /**
   * 격자를 이 배수로 갈아탄다 — **사용자가 후보를 눌렀을 때만.**
   *
   * 2면 중점을 끼우고 0.5면 하나씩 건너뛴다(`retimeBeats`). 예전 `forceBpm`은
   * 워커를 다시 돌려 DP부터 새로 했는데, 비트를 밖에서 받는 지금은 격자를
   * 변환하면 끝이라 **모델을 다시 부를 이유가 없다.**
   */
  readonly ratio?: number;
}

export interface TempoResult {
  readonly bpm: number;
  readonly confidence: number;
  /**
   * 사람이 고를 수 있는 배수들(`metricalFamily`). **자기상관 봉우리가 아니다** —
   * 모델이 답 하나를 주므로 분포가 없고, 대신 틀렸다면 거의 반드시 배수로
   * 틀린다는 사실을 화면에 낸다.
   */
  readonly candidates: readonly TempoCandidate[];
  /** 비트 간격의 고름 정도 0~1 */
  readonly steadiness: number;
}

export interface AnalysisReport {
  readonly durationSec: number;
  readonly tempo: TempoResult;
  readonly meter: MeterEstimate;
  readonly key: KeyEstimate;
  /** 조율 편차(센트). 0에서 멀면 음원 자체가 A440이 아니다 */
  readonly tuningCents: number;
  readonly beats: readonly number[];
  readonly downbeats: readonly number[];
  /**
   * 코드 구간. 비트가 모자라면 빈 배열이다 — **실패로 만들지 않는다.**
   *
   * 평범한 객체·숫자·문자열뿐이라 워커 경계(structured clone)를 그대로 넘는다.
   */
  readonly chords: readonly ChordEvent[];
  /** 구간 길이로 가중한 평균. 코드 표를 얼마나 믿을지의 한 숫자 */
  readonly chordConfidence: number;
}

/**
 * 모노 샘플 한 덩어리를 분석한다.
 *
 * `samples`는 `ANALYSIS_RATE`로 리샘플된 모노여야 한다 — 표본화율이 다르면
 * 인자로 넘긴 `sampleRate`를 쓰지만, 굳이 높은 표본화율로 넣을 이유가 없다
 * (11kHz 위는 이 분석에 쓰이지 않는다).
 */
export function analyzeAudio(
  samples: Float32Array,
  grid: BeatGrid,
  sampleRate: number = ANALYSIS_RATE,
  onProgress?: (progress: AnalysisProgress) => void,
  options: AnalysisOptions = {},
): AnalysisReport {
  const report = (stage: string, ratio: number) => onProgress?.({ stage, ratio });

  report("스펙트럼 분석", 0);
  const features = extractFeatures(samples, sampleRate, (r) =>
    report("스펙트럼 분석", r * 0.6),
  );

  // **격자 변환은 재분석이 아니다.** 사용자가 배수 후보를 누르면 여기서 비트를
  // 촘촘하게 하거나 성기게 할 뿐이고, 모델은 다시 안 돈다.
  const ratio = options.ratio ?? 1;
  const retimed = ratio === 1
    ? { beats: [...grid.beats], downbeats: [...grid.downbeats] }
    : retimeBeats(grid.beats, grid.downbeats, ratio);
  const beats = retimed.beats;
  const downbeats = retimed.downbeats;
  // 마디당 박은 격자를 갈아타도 그대로다 — 박이 잘아졌으면 마디도 그만큼
  // 잘아진 것이 아니라 **한 마디에 든 박 수가 늘어난 것**이다.
  const beatsPerBar = ratio === 1
    ? grid.beatsPerBar
    : Math.max(1, Math.round(grid.beatsPerBar * ratio));
  // 사이드카가 준 BPM은 원래 격자의 것이라, 갈아탔으면 다시 뽑는다.
  const bpm = ratio === 1 && grid.bpm ? grid.bpm : bpmOf(beats);

  report("박자 판정", 0.7);
  const meter = estimateMeter(beats, features.fps, features.onset, {
    beatsPerBar,
    downbeats,
  });

  report("조성 판정", 0.78);
  const key = estimateKey(features.chroma);

  // **코드는 맨 뒤다.** 비트 그리드가 있어야 하고(사양서 §1.1 — 크로마를 먼저
  // 비트로 접는다), 근음을 ♯로 적을지 ♭로 적을지는 조성이 정한다. 조표는
  // **표기에만** 쓴다 — 판정에 넣으면 "조성은 코드 시퀀스 위에서 판정한다"는
  // 사양서 §7의 길이 순환으로 막힌다.
  report("코드 인식", 0.82);
  const chords = recognizeChords(
    samples,
    sampleRate,
    features.tuningCents,
    beats,
    { key, meter },
    (r) => report("코드 인식", 0.82 + r * 0.17),
  );
  report("완료", 1);

  return {
    durationSec: samples.length / sampleRate,
    tempo: {
      bpm,
      // **모델의 답에는 자기상관 같은 후보 경쟁이 없다.** 대신 격자 자체가
      // 얼마나 한결같은지를 신뢰도로 쓴다(`meter.confidence`와 같은 재료).
      confidence: steadinessOf(beats),
      candidates: metricalFamily(bpm),
      steadiness: steadinessOf(beats),
    },
    meter,
    key,
    tuningCents: features.tuningCents,
    beats,
    downbeats: meter.downbeats,
    chords: chords.chords,
    chordConfidence: chords.confidence,
  };
}

/**
 * 비트 간격이 얼마나 고른가 0~1. **예전 `trackBeats`가 함께 내던 값이다.**
 *
 * 격자를 밖에서 받게 되면서 계산할 자리가 없어졌는데, 화면이 "이 BPM을 얼마나
 * 믿을지"를 이 숫자로 보이고 있어서 여기로 옮겼다. 중앙값 대비 상대 편차의
 * 평균을 1에서 뺀 값이라, 완전히 일정하면 1이고 흔들릴수록 0에 가까워진다.
 */
function steadinessOf(beats: readonly number[]): number {
  if (beats.length < 3) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i += 1) gaps.push(beats[i] - beats[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return 0;
  const spread =
    gaps.reduce((sum, g) => sum + Math.abs(g / median - 1), 0) / gaps.length;
  return Math.max(0, Math.min(1, 1 - spread));
}

/** 코드 인식에 필요한 최소 비트 수. 이보다 적으면 격자라고 부를 수 없다 */
const MIN_CHORD_BEATS = 4;

/**
 * 코드용 크로마를 뽑아 코드 구간을 낸다. **STFT를 한 번 더 돈다.**
 *
 * 합칠 수 없다 — ODF는 짧은 창(시간 분해능)이, 코드는 긴 창(주파수 분해능)이
 * 필요하고 둘은 정면으로 상충한다. 그래서 분석 시간이 늘어나는 것을 받아들였다
 * (`features.extractChordChroma` 주석).
 *
 * 비트가 모자라면 조용히 빈 결과다 — 박이 뚜렷하지 않은 곡에서 BPM·조성까지
 * 함께 버릴 이유가 없다.
 */
function recognizeChords(
  samples: Float32Array,
  sampleRate: number,
  tuningCents: number,
  beats: readonly number[],
  context: { key: KeyEstimate; meter: MeterEstimate },
  onProgress: (ratio: number) => void,
): ChordEstimate {
  if (beats.length < MIN_CHORD_BEATS) return { chords: [], confidence: 0 };
  const { fps, chroma, bass, energy } = extractChordChroma(
    samples,
    sampleRate,
    tuningCents,
    onProgress,
  );
  return estimateChords(beats, fps, chroma, energy, {
    // 조표는 **표기에만**, 마디와 베이스는 **판정에** 들어간다(`ChordOptions`)
    fifths: keyFifths(context.key.tonic, context.key.mode),
    beatsPerBar: context.meter.beatsPerBar,
    phase: context.meter.phase,
    bass,
  });
}

/*
 * **`resolveDupleMeter`와 `DUPLE_RIVAL`이 2026-09-12에 사라졌다.**
 *
 * 2박 신고를 받아 템포를 두 배로 올리던 자동 교정이다. 축 B가 없어져 신고
 * 자체가 안 나오고, 무엇보다 **고치려던 오류를 모델이 애초에 안 낸다.**
 * 그 함수가 실제로 값을 한 사례(곡F MR 164.0 → 82.0)와 악센트 게이트를
 * 나중에 붙인 이력은 CLAUDE.md와 `docs/템포_배수오류_미해결.md`에 남아 있다.
 */

/** 박자표를 악센트 패턴으로. 숫자만으로는 3/4와 6/8이 헷갈린다(사양서 §6). */
export function accentPattern(beatsPerBar: number): string {
  return ["●", ...Array<string>(Math.max(0, beatsPerBar - 1)).fill("○")].join(" ");
}

/** 신뢰도 3단계. 0.5 아래는 "확인 필요"가 기본값이다. */
export function confidenceTier(value: number): "high" | "medium" | "low" {
  if (value >= 0.8) return "high";
  return value >= 0.5 ? "medium" : "low";
}
