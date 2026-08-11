/**
 * 오디오 분석 — 파일 하나에서 **BPM · 박자 · 조성**을 뽑는다.
 *
 * ```
 * 샘플 → [특징] ODF · 크로마 · 저역
 *          ↓
 *        [템포] 자기상관 × 로그정규 prior
 *          ↓
 *        [비트] DP 추적 → 여기서 최종 BPM이 나온다
 *          ↓
 *        [박자] 축A(세분화) × 축B(마디당 박)      [조성] 크로마 × 프로파일
 * ```
 *
 * 파이프라인 사양서의 [2]·[3]·[4]·[5]·[7]에 해당한다. 스템 분리·코드 인식·
 * 멜로디 추출은 **아직 없다** — 무거운 모델이 필요해서 브라우저 안에서
 * 끝나지 않는다.
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

import { extractFeatures, normalizeOnset, ANALYSIS_RATE } from "./features";
import { estimateKey, type KeyEstimate } from "./key";
import { estimateMeter, type MeterEstimate } from "./meter";
import {
  type BeatTrack,
  estimateTempo,
  MAX_BPM,
  resolveOctave,
  type TempoCandidate,
  type TempoEstimate,
  trackBeats,
} from "./tempo";

export { ANALYSIS_RATE, FRAME_SIZE, HOP_SIZE } from "./features";
export type { KeyEstimate, MeterEstimate };

/** 진행 상황. 화면이 멈춘 것처럼 보이지 않게 하는 용도 */
export interface AnalysisProgress {
  readonly stage: string;
  /** 0~1 */
  readonly ratio: number;
}

export interface TempoResult {
  readonly bpm: number;
  readonly confidence: number;
  /** 정수배 후보들. ×2·÷2가 남아 있으면 여기 보인다 */
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
  sampleRate: number = ANALYSIS_RATE,
  onProgress?: (progress: AnalysisProgress) => void,
): AnalysisReport {
  const report = (stage: string, ratio: number) => onProgress?.({ stage, ratio });

  report("스펙트럼 분석", 0);
  const features = extractFeatures(samples, sampleRate, (r) =>
    report("스펙트럼 분석", r * 0.7),
  );

  report("템포 추정", 0.75);
  const onset = normalizeOnset(features.onset, features.fps);
  const tempo = estimateTempo(onset, features.fps);

  report("비트 추적", 0.85);
  let track = tempo.bpm > 0
    ? trackBeats(onset, features.fps, tempo.bpm)
    : { beats: [], bpm: 0, steadiness: 0 };
  // **배수 점검.** 자기상관은 정수배를 원리적으로 못 가리므로 악센트 구조로
  // 한 번 더 본다 — 이걸 안 하면 173BPM 곡이 87BPM으로 나가고, 박자·격자·
  // 악보가 전부 그 위에 얹힌다(`resolveOctave`).
  const faster = resolveOctave(onset, features.fps, tempo, track);
  if (faster) track = faster;

  report("박자 판정", 0.92);
  const measure = (beats: readonly number[]) =>
    estimateMeter(beats, features.fps, features.onset, features.low, features.chroma);
  let meter = measure(track.beats);
  // **2/4가 나오면 템포가 절반이라고 본다**(`resolveDupleMeter`).
  const duple = resolveDupleMeter(onset, features.fps, tempo, track, meter, measure);
  if (duple) {
    track = duple.track;
    meter = duple.meter;
  }

  report("조성 판정", 0.96);
  const key = estimateKey(features.chroma);
  report("완료", 1);

  return {
    durationSec: samples.length / sampleRate,
    tempo: {
      // 비트열에서 다시 뽑은 값이 1차다. 비트가 안 잡히면 추정값으로 물러난다.
      bpm: track.bpm > 0 ? track.bpm : tempo.bpm,
      confidence: tempo.confidence,
      candidates: tempo.candidates,
      steadiness: track.steadiness,
    },
    meter,
    key,
    tuningCents: features.tuningCents,
    beats: track.beats,
    downbeats: meter.downbeats,
  };
}

/**
 * 2배 후보를 이만큼은 자기상관이 지목해야 갈아탄다.
 *
 * `resolveOctave`의 문턱(0.7)보다 낮다 — 거기서는 악센트만 보지만 여기서는
 * **박자 판정이 2/4라는 독립된 증거**가 이미 하나 있기 때문이다.
 */
const DUPLE_RIVAL = 0.25;

/**
 * **2/4가 나왔다면 템포가 절반이라고 본다.** 갈아탈 이유가 없으면 `null`.
 *
 * ## 왜 이 규칙이 맞는가
 *
 * 대중음악에서 2/4는 드물다. 반대로 **템포가 절반으로 잡히면 진짜 4/4 마디가
 * 우리 박으로 정확히 2박이 되어** 축 B가 2를 고른다. 즉 2/4라는 출력은 박자에
 * 대한 답이라기보다 **"비트가 두 배 길다"는 신고**에 가깝다.
 *
 * `resolveOctave`가 먼저 악센트로 같은 것을 잡지만, 그쪽은 반박이 뚜렷해야만
 * 걸린다. 여기는 **박자 판정 결과라는 다른 증거**를 쓰므로 그것이 놓친 경우를
 * 받는다.
 *
 * ## 확인하고 바꾼다
 *
 * 무조건 두 배로 올리지 않는다. 자기상관 후보에 2배가 실제로 있어야 하고
 * (`DUPLE_RIVAL`), 두 배로 다시 추적해서 **박자가 4/4로 풀려야** 채택한다.
 * 안 풀리면 원래 답을 그대로 둔다 — 근거 없이 숫자만 두 배로 만들면 2/4가
 * 알려주던 사실까지 지워진다.
 */
export function resolveDupleMeter(
  onset: Float32Array,
  fps: number,
  tempo: TempoEstimate,
  track: BeatTrack,
  meter: MeterEstimate,
  measure: (beats: readonly number[]) => MeterEstimate,
): { track: BeatTrack; meter: MeterEstimate } | null {
  if (meter.beatsPerBar !== 2 || track.bpm <= 0) return null;
  const doubled = track.bpm * 2;
  if (doubled > MAX_BPM) return null;
  const rival = tempo.candidates.find(
    (c) => Math.abs(c.bpm / doubled - 1) < 0.06 && c.weight >= DUPLE_RIVAL,
  );
  if (!rival) return null;

  const faster = trackBeats(onset, fps, doubled);
  if (faster.beats.length < 8 || faster.bpm <= 0) return null;
  const remeasured = measure(faster.beats);
  return remeasured.beatsPerBar === 4 ? { track: faster, meter: remeasured } : null;
}

/** 박자표를 악센트 패턴으로. 숫자만으로는 3/4와 6/8이 헷갈린다(사양서 §6). */
export function accentPattern(beatsPerBar: number): string {
  return ["●", ...Array<string>(Math.max(0, beatsPerBar - 1)).fill("○")].join(" ");
}

/** 신뢰도 3단계. 0.5 아래는 "확인 필요"가 기본값이다. */
export function confidenceTier(value: number): "high" | "medium" | "low" {
  if (value >= 0.8) return "high";
  return value >= 0.5 ? "medium" : "low";
}
