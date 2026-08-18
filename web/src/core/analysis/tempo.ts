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
  /**
   * 후보들 사이의 몫으로 본 비율 0~1. 다 더하면 1이다.
   *
   * **확률이라고 부르지만 교정된 확률은 아니다** — 자기상관 점수를 정규화한
   * 값일 뿐이다. 그래도 "86과 172가 백중세였다" 같은 사실을 한눈에 보여주는
   * 데는 이만한 것이 없어서 화면에 낸다.
   */
  readonly probability: number;
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
    peaks.push({ bpm: (60 * fps) / (lag + delta), weight: score[lag], probability: 0 });
  }
  if (!peaks.length) return { bpm: 0, confidence: 0, candidates: [] };

  peaks.sort((a, b) => b.weight - a.weight);
  const top = peaks[0];
  const shown = peaks.slice(0, 5);
  const total = shown.reduce((sum, p) => sum + p.weight, 0);
  const normalized = shown.map((p) => ({
    bpm: p.bpm,
    weight: p.weight / top.weight,
    probability: total > 0 ? p.weight / total : 0,
  }));

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

// --- 배수 모호성 해소 ----------------------------------------------------------
//
// 아래 상수 셋은 **실곡 하나(173BPM J-pop)에서 잰 값이다.** 평가셋이 커지면
// 다시 맞출 자리다 — `meter.ts`의 임계값들과 같은 처지다.

/** 2배 후보가 최고 후보의 이 비율은 되어야 배수 다툼으로 본다 */
const OCTAVE_RIVAL = 0.7;
/**
 * 반박 자리가 비트 자리의 이 비율을 넘으면 "반박도 비트"로 의심한다.
 *
 * **템포를 두 배로 올리는 모든 경로가 이 문턱을 지나야 한다.** `index.ts`의
 * `resolveDupleMeter`도 쓰므로 export한다 — 두 경로가 서로 다른 기준으로
 * 배증하면 한쪽만 고쳐도 다른 쪽으로 같은 오류가 새어 나온다(실측: 실제로
 * 그렇게 샜다. `resolveDupleMeter` 주석 참조).
 */
export const HALF_BEAT_STRONG = 0.4;
/** 2배로 갈아탄 뒤 반박 대비가 이 배수 이하로 좋아져야 실제로 갈아탄다 */
const OCTAVE_IMPROVE = 0.75;

/**
 * 비트 자리 대비 **반박 자리**의 온셋 세기. 1에 가까우면 반박도 비트다.
 *
 * 배수 오류를 잡는 직접 증거다. 자기상관은 정수배 지연에서 함께 피크가 서기
 * 때문에 원리적으로 배수를 가릴 수 없지만(파일 첫 주석), **악센트 구조는 가린다** —
 * 진짜 비트 자리가 반박 자리보다 세다.
 */
export function halfBeatStrength(
  onset: Float32Array,
  fps: number,
  beats: readonly number[],
): number {
  if (beats.length < 3) return 0;
  const at = (t: number): number => {
    const i = Math.round(t * fps);
    return i >= 0 && i < onset.length ? onset[i] : 0;
  };
  let onBeat = 0;
  let offBeat = 0;
  for (let i = 0; i < beats.length - 1; i += 1) {
    onBeat += at(beats[i]);
    offBeat += at((beats[i] + beats[i + 1]) / 2);
  }
  return onBeat > 0 ? offBeat / onBeat : 0;
}

/**
 * 절반 템포로 잡힌 것을 바로잡는다. 갈아탈 이유가 없으면 `null`.
 *
 * ## 왜 필요한가 (실측 2026-08-11)
 *
 * 173BPM 4/4 곡이 **87BPM 3/4**로 나왔다. 정답 악보의 온셋만 넣어도 똑같이
 * 틀리므로 오디오 문제가 아니라 알고리즘 문제다. 절반 쪽이 이긴 마진이 7%뿐인데
 * 그중 prior 기여는 2.3%였다 — **prior를 손봐도 안 고쳐진다**(86.5는 120에서
 * −0.47옥타브, 173은 +0.53옥타브라 거의 대칭이다). 남은 4.7%는 자기상관 자체가
 * 2박 주기를 좋아해서 생긴 것이고, 그건 자기상관으로는 풀 수 없다.
 *
 * ## 어떻게 가르는가
 *
 * **갈아타서 실제로 좋아지는지를 본다.** 반박 자리가 세다는 것만으로는 부족하다 —
 * 8분음표를 고르게 치는 곡은 진짜 템포에서도 반박이 세고, 그런 곡을 2배로 올리면
 * 그냥 틀린다. 그래서 2배 그리드에서 **대비가 실제로 뚜렷해질 때만** 갈아탄다.
 * 온셋이 완전히 고른 신호에서는 비율이 그대로라 이 조건이 막아 준다.
 *
 * 실측(이 곡): 느린 그리드 0.530 → 빠른 그리드 0.221. 87.1 → 173.0.
 */
export function resolveOctave(
  onset: Float32Array,
  fps: number,
  tempo: TempoEstimate,
  track: BeatTrack,
): BeatTrack | null {
  if (track.beats.length < 8 || track.bpm <= 0) return null;
  const doubled = track.bpm * 2;
  if (doubled > MAX_BPM) return null;
  // 자기상관이 2배 후보를 실제로 지목했을 때만 본다. 근거 없이 올리지 않는다
  const rival = tempo.candidates.find(
    (c) => Math.abs(c.bpm / doubled - 1) < 0.06 && c.weight >= OCTAVE_RIVAL,
  );
  if (!rival) return null;

  const slow = halfBeatStrength(onset, fps, track.beats);
  if (slow < HALF_BEAT_STRONG) return null;

  const fast = trackBeats(onset, fps, doubled);
  if (fast.beats.length < 8 || fast.bpm <= 0) return null;
  const fastRatio = halfBeatStrength(onset, fps, fast.beats);
  return fastRatio <= slow * OCTAVE_IMPROVE ? fast : null;
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
