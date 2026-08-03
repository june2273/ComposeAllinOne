/**
 * 템포 추정과 비트 추적 — 캐스케이드의 2·3단계.
 *
 * ## 템포: 자기상관 × 로그정규 prior
 *
 * ODF의 자기상관은 **정수배 지연에서 함께 피크가 선다.** 60·120·240 BPM이
 * 전부 그럴듯해 보이는 half/double 모호성이 여기서 나온다. 실제 음악의 템포
 * 분포가 로그정규에 가깝다는 사실을 prior로 곱해 이 중 하나를 고른다
 * (강의 08; Klapuri 2003 계열).
 *
 * **고른 뒤에도 후보를 버리지 않는다.** ×2·÷2가 남아 있으면 그것은 신뢰도가
 * 낮다는 뜻이지 오류가 아니다 — 화면에 함께 띄운다.
 *
 * ## 비트: Ellis 2007 DP
 *
 * ```
 * D(t) = onset(t) + max { D(τ) − tightness · (log((t−τ)/period))² }
 *                    τ
 * ```
 *
 * 강의 06~08이 반복해 말하는 그 골격이다 — **지역 비용(온셋 강도) + 전이
 * 비용(템포 일관성)**. 프레임마다 독립으로 피크를 고르면 반드시 튀고, 전이
 * 비용을 넣는 순간 전역 최적을 다항 시간에 얻는다.
 *
 * 최종 BPM은 **추정값이 아니라 잡힌 비트 간격에서 다시 뽑는다.** 파이프라인
 * 사양서 §1.3이 못박은 것과 같은 이유다 — 비트열이 1차 자료고 BPM은 그
 * 요약이다.
 *
 * 출처: Ellis, "Beat Tracking by Dynamic Programming", J. New Music Research 2007.
 */

export const MIN_BPM = 50;
export const MAX_BPM = 210;
/** 로그정규 prior의 중심. 사람이 가장 흔히 느끼는 템포 */
const PRIOR_CENTER_BPM = 120;
/** prior 폭 (log2 BPM 기준 표준편차). 1.0이면 60~240이 한 시그마 안 */
const PRIOR_WIDTH = 1.0;
/** 전이 비용 가중치. 클수록 템포를 일정하게 유지한다 (Ellis 기본값 계열) */
const TIGHTNESS = 100;

export interface TempoCandidate {
  readonly bpm: number;
  /** prior까지 곱한 점수. 최고 후보가 1이 되도록 정규화된 값 */
  readonly weight: number;
}

export interface TempoEstimate {
  readonly bpm: number;
  readonly confidence: number;
  readonly candidates: readonly TempoCandidate[];
}

/**
 * 두 템포가 정수배(또는 3:2)로 얽혀 있는가 — 같은 그리드의 다른 해석이다.
 *
 * **1을 빼먹지 말 것.** 자기 자신도 "같은 그리드"다. 빠뜨리면 아래 신뢰도
 * 계산이 최고 후보 자신을 경쟁자로 집어 신뢰도가 늘 0이 된다(실측으로 잡았다).
 */
export function relatedTempo(a: number, b: number, tolerance = 0.04): boolean {
  const ratio = a / b;
  return [1, 0.5, 2, 1 / 3, 3, 2 / 3, 1.5, 0.25, 4].some(
    (r) => Math.abs(ratio / r - 1) < tolerance,
  );
}

/**
 * ODF의 자기상관에서 템포 후보를 뽑는다.
 *
 * 입력은 `normalizeOnset()`을 거친 ODF여야 한다.
 */
export function estimateTempo(onset: Float32Array, fps: number): TempoEstimate {
  const n = onset.length;
  const minLag = Math.max(2, Math.round((60 * fps) / MAX_BPM));
  const maxLag = Math.min(n - 1, Math.round((60 * fps) / MIN_BPM));
  if (n < 4 || maxLag <= minLag) {
    return { bpm: 0, confidence: 0, candidates: [] };
  }

  // 평균을 뺀 자기상관. 겹치는 길이로 나눠 긴 지연이 불리해지지 않게 한다.
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += onset[i];
  mean /= n;

  const score = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < n; i += 1) sum += (onset[i] - mean) * (onset[i + lag] - mean);
    const acf = sum / (n - lag);
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(
      -0.5 * (Math.log2(bpm / PRIOR_CENTER_BPM) / PRIOR_WIDTH) ** 2,
    );
    score[lag] = Math.max(0, acf) * prior;
  }

  // 지역 최대만 후보로. 포물선 보간으로 지연을 소수점까지 다듬는다.
  const peaks: TempoCandidate[] = [];
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    if (score[lag] <= score[lag - 1] || score[lag] < score[lag + 1]) continue;
    const denom = score[lag - 1] - 2 * score[lag] + score[lag + 1];
    const delta = denom === 0 ? 0 : (0.5 * (score[lag - 1] - score[lag + 1])) / denom;
    peaks.push({ bpm: (60 * fps) / (lag + delta), weight: score[lag] });
  }
  if (!peaks.length) return { bpm: 0, confidence: 0, candidates: [] };

  peaks.sort((a, b) => b.weight - a.weight);
  const top = peaks[0];
  const normalized = peaks
    .slice(0, 5)
    .map((p) => ({ bpm: p.bpm, weight: p.weight / top.weight }));

  // 신뢰도 = 정수배로 설명되지 않는 경쟁자가 얼마나 약한가.
  // ×2·÷2는 같은 비트 그리드의 다른 읽기이므로 신뢰도를 깎지 않는다.
  const rival = peaks.find((p) => !relatedTempo(p.bpm, top.bpm));
  const confidence = rival ? 1 - rival.weight / top.weight : 1;

  return { bpm: top.bpm, confidence: Math.max(0, Math.min(1, confidence)), candidates: normalized };
}

export interface BeatTrack {
  /** 비트 시각(초) */
  readonly beats: readonly number[];
  /** 비트 간격에서 다시 뽑은 BPM */
  readonly bpm: number;
  /** 간격의 고름 정도 0~1. 변속이나 추적 실패에서 떨어진다 */
  readonly steadiness: number;
}

/**
 * 동적 계획법 비트 추적.
 *
 * `bpm`은 목표 템포일 뿐이다 — DP는 그 주위에서 벗어나되 벗어난 만큼 벌점을
 * 받는다. 그래서 약간의 변속은 따라가고 두 배로 뛰지는 않는다.
 */
export function trackBeats(
  onset: Float32Array,
  fps: number,
  bpm: number,
): BeatTrack {
  const n = onset.length;
  const period = (60 * fps) / bpm;
  if (n === 0 || !Number.isFinite(period) || period < 2) {
    return { beats: [], bpm: 0, steadiness: 0 };
  }

  const from = Math.round(period / 2);
  const to = Math.round(period * 2);
  const cumulative = new Float64Array(n);
  const previous = new Int32Array(n).fill(-1);

  // 전이 벌점은 지연에만 의존하므로 미리 만들어 둔다
  const penalty = new Float64Array(to + 1);
  for (let d = from; d <= to; d += 1) {
    penalty[d] = -TIGHTNESS * Math.log(d / period) ** 2;
  }

  for (let t = 0; t < n; t += 1) {
    let best = 0;
    let bestFrom = -1;
    const low = t - to;
    const high = t - from;
    for (let tau = Math.max(0, low); tau <= high; tau += 1) {
      const value = cumulative[tau] + penalty[t - tau];
      if (bestFrom < 0 || value > best) {
        best = value;
        bestFrom = tau;
      }
    }
    cumulative[t] = onset[t] + (bestFrom < 0 ? 0 : best);
    previous[t] = bestFrom;
  }

  // 마지막 비트 = 누적 점수의 최대점. 누적이라 대개 끝 근처에 선다.
  let last = 0;
  for (let t = 1; t < n; t += 1) if (cumulative[t] > cumulative[last]) last = t;

  const reversed: number[] = [];
  for (let t = last; t >= 0; t = previous[t]) {
    reversed.push(t);
    if (previous[t] < 0) break;
  }
  reversed.reverse();

  const frames = trimSilentEnds(reversed, onset);
  const beats = frames.map((t) => t / fps);
  if (beats.length < 2) return { beats, bpm: 0, steadiness: 0 };

  const gaps = beats.slice(1).map((b, i) => b - beats[i]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  // 중앙값에서 5% 안에 든 간격의 비율 — 평균·표준편차보다 이상치에 강하다
  const steady = gaps.filter((g) => Math.abs(g / median - 1) < 0.05).length / gaps.length;

  return { beats, bpm: 60 / refinePeriod(beats, gaps, median), steadiness: steady };
}

/**
 * DP는 신호 맨 앞뒤에도 비트를 하나씩 세운다 — 그 자리가 시작점이라 전이
 * 비용을 물지 않기 때문이다. 소리가 없는 자리의 비트는 간격을 어그러뜨리므로
 * 양 끝에서만 걷어낸다. 가운데는 건드리지 않는다(쉼표도 음악의 일부다).
 */
function trimSilentEnds(frames: number[], onset: Float32Array): number[] {
  if (frames.length < 3) return frames;
  const values = frames.map((t) => onset[t]).sort((a, b) => a - b);
  const floor = values[values.length >> 1] * 0.25;
  let from = 0;
  let to = frames.length - 1;
  while (from < to && onset[frames[from]] < floor) from += 1;
  while (to > from && onset[frames[to]] < floor) to -= 1;
  return frames.slice(from, to + 1);
}

/**
 * 비트 간격을 프레임 격자보다 정밀하게 다시 잰다.
 *
 * 비트 시각은 ODF 프레임 위에만 설 수 있어 간격이 11.6ms 단위로 양자화된다.
 * 150BPM(0.4초)이면 0.3947과 0.4064만 나올 수 있어 **중앙값을 그대로 쓰면
 * 1.3% 치우친다**(실측: 150 → 153). 세 단계로 푼다.
 *
 * 1. 중앙값에서 20% 넘게 벗어난 간격을 뺀다 — 놓친 비트가 만든 두 배 간격
 * 2. 남은 것의 **평균**을 쓴다. 양자화 오차가 서로 상쇄되어 편향이 사라진다
 * 3. 처음부터 끝까지의 길이를 그 평균이 말하는 주기 수로 나눈다 — 양자화
 *    오차가 양 끝 두 개로만 남아 곡이 길수록 정확해진다
 */
function refinePeriod(
  beats: readonly number[],
  gaps: readonly number[],
  median: number,
): number {
  const inliers = gaps.filter((g) => Math.abs(g / median - 1) < 0.2);
  if (!inliers.length) return median;
  const mean = inliers.reduce((a, b) => a + b, 0) / inliers.length;

  const span = beats[beats.length - 1] - beats[0];
  const periods = Math.round(span / mean);
  if (periods < 1) return mean;
  const refined = span / periods;
  // 크게 어긋나면(변속이거나 추적 실패) 평균으로 물러난다
  return Math.abs(refined / mean - 1) < 0.2 ? refined : mean;
}
