/**
 * 프레임 특징 — 온셋 강도(ODF) · 크로마 · 저역 에너지를 **한 번의 STFT 통과**로 뽑는다.
 *
 * 세 특징을 따로 계산하면 FFT를 세 번 돌게 된다. 4분 곡이면 프레임이 2만 개
 * 남짓이라 그 차이가 그대로 체감 시간이 된다. 그래서 프레임 루프는 하나뿐이다.
 *
 * ## ODF는 SuperFlux다
 *
 * 강의 08(음악 정보학)이 정리한 리듬 전사 캐스케이드 `온셋 → 템포 → 비트`의
 * 첫 단계. 단순 spectral flux와 다른 점은 셋이다.
 *
 * 1. **로그 주파수 필터뱅크** — 배음이 같은 비브라토 윤곽을 갖게 된다
 * 2. **주파수축 max-filter** — 그 윤곽을 흡수한다
 * 3. **μ 프레임 지연 차분** — 홉이 짧아도 비브라토 주기보다는 길게 본다
 *
 * 이게 없으면 보컬 비브라토가 전부 가짜 온셋이 된다.
 * 출처: Böck & Widmer, "Maximum Filter Vibrato Suppression for Onset Detection",
 * DAFx 2013.
 *
 * **온셋 시각은 24ms쯤 이르게 잡힌다**(실측: 합성 클릭 트랙). 창이 중심
 * 정렬돼 있는데도 그런 이유는 플럭스가 값이 아니라 **기울기**를 보기 때문이다.
 * 창 안으로 소리가 들어오는 동안 기울기가 가장 가파른 지점은 소리가 창
 * 한가운데 오기 전이다. 보정하지 않는다 — 편향의 크기가 온셋 모양에 달려
 * 있어서(임펄스에 가까울수록 크다) 한 값으로 빼면 다른 쪽이 틀어진다.
 * 비트 추적 허용 오차 70ms 안이므로 실용상 문제가 없다.
 *
 * ## 크로마는 조성 판정용이다
 *
 * 옥타브 등가성으로 접어 12차원으로 만든다(강의 03). 여기서는 **조율 편차를
 * 먼저 재고** 그만큼 되민 다음 접는다 — 실제 음원은 속도가 미세하게 어긋나
 * 있는 경우가 있고, 40센트쯤 틀어지면 크로마가 옆 칸으로 새어 조성 판정이
 * 통째로 흔들린다.
 */

import { SpectrumFrames } from "./fft";

/** 분석 표본화율. 11kHz까지 보면 충분하고, 낮출수록 FFT가 싸다. */
export const ANALYSIS_RATE = 22_050;
/** 창 길이 (≈93ms). 저역 분해능과 시간 분해능의 타협점. */
export const FRAME_SIZE = 2048;
/** 홉 (≈11.6ms → 86fps). 박 안쪽 세분화를 보려면 이 정도는 필요하다. */
export const HOP_SIZE = 256;

/** 차분 간격. 2프레임 = 약 23ms — 비브라토 반주기보다 길다. */
const DIFF_FRAMES = 2;
/** 필터뱅크 해상도. 반음의 절반 간격이라 max-filter가 반음 폭을 덮는다. */
const BANDS_PER_OCTAVE = 24;
const BANK_MIN_HZ = 30;
const BANK_MAX_HZ = 11_000;

/**
 * 크로마에 넣을 음역.
 *
 * 하한이 200Hz인 것은 취향이 아니라 **분해능 한계**다. 2048/22050에서 빈
 * 간격은 10.8Hz인데 200Hz에서 반음 간격이 12.2Hz다 — 그 아래로 내려가면 빈
 * 하나가 반음보다 넓어져 접는 순간 옆 칸으로 샌다. 베이스 근음이 빠지지만
 * 옥타브·배음이 같은 음고류를 채우므로 조성 판정에는 견딜 만하다.
 *
 * **코드 인식은 이걸로 부족해서 따로 뽑는다** — `extractChordChroma`가 창을
 * 네 배로 늘려 베이스 근음까지 내려간다(아래 절). 여기를 그 값으로 바꾸지 말
 * 것: 이 크로마는 박자(`meter.chromaChange`)와 조성(`key.estimateKey`)이 쓰고
 * 있고, 바꾸는 순간 그 두 판정이 함께 움직인다.
 */
const CHROMA_MIN_HZ = 200;
const CHROMA_MAX_HZ = 2100;

/** 저역 에너지 — 킥과 베이스. 다운비트의 가장 강한 단서다. */
const LOW_MIN_HZ = 30;
const LOW_MAX_HZ = 160;

/**
 * `extractFeatures`의 선택 산출물.
 *
 * **드럼을 위해 생겼다.** 합산 ODF 하나로는 킥과 하이햇이 같은 칸에 있을 때
 * 저역이 이겨서 하이햇이 통째로 사라진다 — 봉우리 하나에 클래스 하나를 붙이는
 * 구조적 한계다. 묶음마다 따로 봉우리를 뽑으려면 플럭스가 나뉘어 있어야 한다.
 *
 * **두 번째 STFT 통과를 만들지 않은 이유.** `extractChordChroma`는 창 길이가
 * 정면으로 상충해서(2048 대 8192) 통과를 나눴지만 드럼은 짧은 창을 원하고
 * 2048/256이 이미 짧다. 상충이 없으면 두 번째 구현은 선례가 아니라 복제다.
 * 값은 이미 아래 루프 안에 있고(`diff`), 지금은 한 숫자로 더하고 버릴 뿐이다.
 */
export interface FeatureOptions {
  /**
   * 밴드 플럭스·에너지를 이 경계(Hz)로 묶어 함께 낸다. 안 주면 안 낸다.
   *
   * 경계가 N개면 묶음은 N-1개다. **필터뱅크를 다시 만들지 않는다** — 기존
   * 205밴드를 경계마다 접을 뿐이라 비용이 사실상 0이다.
   *
   * **플럭스와 에너지가 둘 다 나가는 이유.** 플럭스는 "지금 뭔가 시작했다"만
   * 말하고 얼마나 오래 울리는지는 말하지 않는다. 닫힌하이햇·열린하이햇·크래시는
   * 시작이 똑같이 생겼고 **감쇠 길이로만 갈린다** — 그걸 재려면 포락선이 있어야
   * 한다. 같은 루프에서 함께 나오므로 추가 비용이 없다.
   */
  readonly fluxBandsHz?: readonly number[];
}

export interface FrameFeatures {
  /** 초당 프레임 수 */
  readonly fps: number;
  /** SuperFlux ODF. 길이 = 프레임 수 */
  readonly onset: Float32Array;
  /** 프레임별 12차원 크로마를 이어 붙인 것 (frame * 12 + pc) */
  readonly chroma: Float32Array;
  /** 프레임별 저역 에너지 */
  readonly low: Float32Array;
  /** 추정된 조율 편차(센트). A440 기준, 양수면 높다 */
  readonly tuningCents: number;
  readonly frameCount: number;
  /**
   * `fluxBandsHz`를 줬을 때만. `(frame * fluxBands + b)`로 읽는다.
   *
   * **워커 밖으로 보내지 말 것** — 4분 곡에 7묶음이면 12MB가 넘는다. 봉우리를
   * 뽑고 나면 버리는 중간 산출물이다.
   */
  readonly bandFlux?: Float32Array;
  /**
   * 묶음별 **에너지 포락선 — 로그 압축 *전*의 선형 크기.** `bandFlux`와 같은
   * 자리 매김이다.
   *
   * **선형인 것이 요점이다.** 로그 압축을 거친 플럭스는 "이 대역이 켜졌는가"를
   * 재지 "에너지가 얼마인가"를 재지 않는다 — 잡음 바닥 위로 올라오기만 하면
   * 어느 대역이든 비슷한 크기로 뛴다. 실측으로 확인했다(2026-09-03): 킥·스네어·
   * 하이햇·크래시의 묶음별 **플럭스 비율이 전부 `[.09 .14 .29 .20 .14 .08 .05]`로
   * 사실상 같았다.** 스펙트럼 모양으로 악기를 가르려면 선형 크기여야 한다.
   *
   * 감쇠 길이를 재는 데도 이쪽이 낫다 — 지수 감쇠가 지수 감쇠로 보인다.
   */
  readonly bandEnergy?: Float32Array;
  /** 묶음 수. `bandFlux`가 있을 때만 */
  readonly fluxBands?: number;
}

// --- 로그 주파수 필터뱅크 --------------------------------------------------------

interface Band {
  readonly start: number;
  readonly weights: Float64Array;
  /**
   * 중심 주파수(Hz). **밴드 묶기(`fluxBandsHz`)가 이걸 쓴다.**
   *
   * 밴드 번호에서 계산할 수 없다 — 아래 루프가 빈이 모자란 밴드를 건너뛰므로
   * 번호와 `i`가 어긋난다. 만들 때 함께 적어 두는 편이 싸고 안전하다.
   */
  readonly center: number;
}

/**
 * 삼각 필터뱅크. 중심 주파수가 로그 등간격이라 **한 옥타브 위 배음이 같은
 * 개수의 밴드만큼 떨어져** 놓인다 — max-filter가 배음마다 같은 폭으로 먹는다.
 */
function makeBank(bins: number, sampleRate: number): Band[] {
  const binHz = sampleRate / 2 / (bins - 1);
  const top = Math.min(BANK_MAX_HZ, sampleRate / 2 - binHz);
  const count = Math.floor(Math.log2(top / BANK_MIN_HZ) * BANDS_PER_OCTAVE);
  const centers: number[] = [];
  for (let i = 0; i <= count; i += 1) {
    centers.push(BANK_MIN_HZ * 2 ** (i / BANDS_PER_OCTAVE));
  }

  const bands: Band[] = [];
  for (let i = 1; i < centers.length - 1; i += 1) {
    const lo = centers[i - 1];
    const mid = centers[i];
    const hi = centers[i + 1];
    const from = Math.max(1, Math.ceil(lo / binHz));
    const to = Math.min(bins - 1, Math.floor(hi / binHz));
    if (to < from) continue;
    const weights = new Float64Array(to - from + 1);
    let sum = 0;
    for (let k = from; k <= to; k += 1) {
      const f = k * binHz;
      const w = f <= mid ? (f - lo) / (mid - lo) : (hi - f) / (hi - mid);
      weights[k - from] = Math.max(0, w);
      sum += weights[k - from];
    }
    if (sum <= 0) continue;
    // 면적 정규화 — 고역 밴드가 넓다고 더 커지지 않게
    for (let j = 0; j < weights.length; j += 1) weights[j] /= sum;
    bands.push({ start: from, weights, center: mid });
  }
  return bands;
}

// --- 조율 추정 -----------------------------------------------------------------

/** 조율 추정에 쓸 프레임 수. 곡 전체에 고르게 흩뿌린다. */
const TUNING_FRAMES = 200;
/** 편차 히스토그램 해상도 (한 칸 = 1센트) */
const TUNING_BINS = 100;

/**
 * A440에서 얼마나 벗어나 있는가(센트).
 *
 * 스펙트럼 피크의 음고를 반음 격자에 대고 **소수부만 모은다.** 악기가 평균율로
 * 조율돼 있다면 소수부가 한 자리에 몰리고, 그 자리가 곡 전체의 조율 편차다.
 * 피크 주파수는 포물선 보간으로 다듬는다 — 안 하면 빈 폭(≈10.8Hz)이 그대로
 * 오차가 되어 저역에서 반음을 넘는다.
 */
export function estimateTuningCents(
  frames: SpectrumFrames,
  sampleRate: number,
): number {
  const binHz = sampleRate / frames.size;
  const from = Math.max(2, Math.ceil(CHROMA_MIN_HZ / binHz));
  const to = Math.min(frames.bins - 2, Math.floor(CHROMA_MAX_HZ / binHz));
  const hist = new Float64Array(TUNING_BINS);

  const total = frames.count;
  if (total === 0) return 0;
  const step = Math.max(1, Math.floor(total / TUNING_FRAMES));

  for (let index = 0; index < total; index += step) {
    const mag = frames.at(index);
    let peak = 0;
    for (let k = from; k <= to; k += 1) peak = Math.max(peak, mag[k]);
    if (peak <= 0) continue;
    const floor = peak * 0.1;

    for (let k = from; k <= to; k += 1) {
      if (mag[k] < floor || mag[k] < mag[k - 1] || mag[k] < mag[k + 1]) continue;
      // 포물선 보간으로 참 피크 위치를 찾는다
      const denom = mag[k - 1] - 2 * mag[k] + mag[k + 1];
      const delta = denom === 0 ? 0 : (0.5 * (mag[k - 1] - mag[k + 1])) / denom;
      const freq = (k + delta) * binHz;
      const pitch = 69 + 12 * Math.log2(freq / 440);
      let frac = pitch - Math.round(pitch); // -0.5 ~ 0.5
      if (frac < -0.5) frac += 1;
      const bin = Math.min(TUNING_BINS - 1, Math.floor((frac + 0.5) * TUNING_BINS));
      hist[bin] += mag[k];
    }
  }

  // ±1칸 순환 평활 후 최대점. 히스토그램이 원형이라 끝과 시작이 이어진다.
  let best = 0;
  let bestValue = -1;
  for (let i = 0; i < TUNING_BINS; i += 1) {
    const value =
      hist[(i - 1 + TUNING_BINS) % TUNING_BINS] + hist[i] + hist[(i + 1) % TUNING_BINS];
    if (value > bestValue) {
      bestValue = value;
      best = i;
    }
  }
  if (bestValue <= 0) return 0;
  return (best + 0.5) / TUNING_BINS * 100 - 50;
}

// --- 프레임 통과 ----------------------------------------------------------------

/**
 * 한 번의 STFT 통과로 세 특징을 뽑는다.
 *
 * `onProgress`는 0~1을 여러 번 받는다 — 곡 하나에 수 초가 걸리므로 화면이
 * 멈춘 것처럼 보이지 않게 하려면 필요하다.
 */
export function extractFeatures(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (ratio: number) => void,
  options?: FeatureOptions,
): FrameFeatures {
  const frames = new SpectrumFrames(samples, FRAME_SIZE, HOP_SIZE);
  const count = frames.count;
  const fps = sampleRate / HOP_SIZE;
  if (count === 0) {
    return {
      fps,
      onset: new Float32Array(0),
      chroma: new Float32Array(0),
      low: new Float32Array(0),
      tuningCents: 0,
      frameCount: 0,
    };
  }

  const tuningCents = estimateTuningCents(frames, sampleRate);

  // 빈 → 음고류 표. 조율 편차를 여기서 한 번에 흡수한다.
  const binHz = sampleRate / FRAME_SIZE;
  const chromaFrom = Math.max(1, Math.ceil(CHROMA_MIN_HZ / binHz));
  const chromaTo = Math.min(frames.bins - 1, Math.floor(CHROMA_MAX_HZ / binHz));
  const binPc = new Int8Array(frames.bins).fill(-1);
  for (let k = chromaFrom; k <= chromaTo; k += 1) {
    const pitch = 69 + 12 * Math.log2((k * binHz) / 440) - tuningCents / 100;
    binPc[k] = (((Math.round(pitch) % 12) + 12) % 12) as number;
  }
  const lowFrom = Math.max(1, Math.ceil(LOW_MIN_HZ / binHz));
  const lowTo = Math.min(frames.bins - 1, Math.floor(LOW_MAX_HZ / binHz));

  const bank = makeBank(frames.bins, sampleRate);
  const bandCount = bank.length;
  // 지연 차분에 쓸 과거 밴드 값들. DIFF_FRAMES+1개만 돌려 쓴다.
  const history: Float64Array[] = [];
  for (let i = 0; i <= DIFF_FRAMES; i += 1) history.push(new Float64Array(bandCount));

  // 밴드 → 묶음 표. 경계 밖의 밴드는 -1이라 어느 묶음에도 안 들어간다.
  const edges = options?.fluxBandsHz;
  const fluxBands = edges && edges.length >= 2 ? edges.length - 1 : 0;
  const groupOf = fluxBands ? new Int16Array(bandCount).fill(-1) : null;
  if (groupOf && edges) {
    for (let b = 0; b < bandCount; b += 1) {
      const hz = bank[b].center;
      for (let g = 0; g < fluxBands; g += 1) {
        if (hz >= edges[g] && hz < edges[g + 1]) {
          groupOf[b] = g;
          break;
        }
      }
    }
  }

  const onset = new Float32Array(count);
  const chroma = new Float32Array(count * 12);
  const low = new Float32Array(count);
  const bandFlux = fluxBands ? new Float32Array(count * fluxBands) : null;
  const bandEnergy = fluxBands ? new Float32Array(count * fluxBands) : null;
  const report = Math.max(1, Math.floor(count / 20));

  for (let t = 0; t < count; t += 1) {
    const mag = frames.at(t);

    // (1) 필터뱅크 + 로그 압축
    const cur = history[t % history.length];
    for (let b = 0; b < bandCount; b += 1) {
      const { start, weights } = bank[b];
      let sum = 0;
      for (let j = 0; j < weights.length; j += 1) sum += mag[start + j] * weights[j];
      // 포락선 — **로그를 씌우기 전 값이다.** 위 주석 참조: 로그를 거치면
      // 스펙트럼 모양이 뭉개져 악기를 못 가른다.
      if (groupOf && bandEnergy) {
        const g = groupOf[b];
        if (g >= 0) bandEnergy[t * fluxBands + g] += sum;
      }
      cur[b] = Math.log10(1 + 1000 * sum);
    }

    // (2) μ프레임 전 밴드에 주파수축 max-filter → (3) 반파 정류 플럭스
    if (t >= DIFF_FRAMES) {
      const past = history[(t - DIFF_FRAMES + history.length) % history.length];
      let flux = 0;
      for (let b = 0; b < bandCount; b += 1) {
        const lo = b > 0 ? past[b - 1] : past[b];
        const hi = b < bandCount - 1 ? past[b + 1] : past[b];
        const reference = Math.max(lo, past[b], hi);
        const diff = cur[b] - reference;
        if (diff > 0) {
          flux += diff;
          // 같은 값을 묶음에도 더한다. 합산 ODF는 한 줄도 안 바뀐다.
          if (groupOf && bandFlux) {
            const g = groupOf[b];
            if (g >= 0) bandFlux[t * fluxBands + g] += diff;
          }
        }
      }
      onset[t] = flux;
    }

    // 크로마 — 프레임마다 L1 정규화한다. 안 하면 큰 소리 구간이 조성을 독식한다.
    let sum = 0;
    const base = t * 12;
    for (let k = chromaFrom; k <= chromaTo; k += 1) {
      const pc = binPc[k];
      if (pc < 0) continue;
      chroma[base + pc] += mag[k];
      sum += mag[k];
    }
    if (sum > 0) {
      for (let pc = 0; pc < 12; pc += 1) chroma[base + pc] /= sum;
    }

    let lowSum = 0;
    for (let k = lowFrom; k <= lowTo; k += 1) lowSum += mag[k];
    low[t] = lowSum;

    if (onProgress && t % report === 0) onProgress(t / count);
  }
  onProgress?.(1);

  return {
    fps,
    onset,
    chroma,
    low,
    tuningCents,
    frameCount: count,
    ...(bandFlux && bandEnergy ? { bandFlux, bandEnergy, fluxBands } : {}),
  };
}

/**
 * 노트 분할이 쓸 온셋 곡선. **믹스가 아니라 보컬 스템에 건다.**
 *
 * `core/transcribe`의 `OnsetCurve`와 같은 모양이다(구조만 맞추고 서로
 * import하지 않는다 — 두 모듈 다 의존성이 없어야 하고, 잇는 것은 위층의 일이다).
 *
 * **왜 여기 있나.** f0는 같은 음을 두 번 부른 것을 표현할 수 없다 — 커브가
 * 평평하다. 경계의 증거를 음정 밖에서 받아야 하고, 그 증거를 이미 만들고 있는
 * 것이 SuperFlux ODF다(비트 추적용). 새로 짤 것이 없어서 이것부터 해 봤다.
 *
 * 크로마·저역·조율까지 함께 계산되는 것은 낭비지만, `extractFeatures`를 쪼개면
 * 검증된 루프가 둘로 갈린다. 4분 곡에 수 초라 그대로 둔다.
 */
export function extractOnsetCurve(
  samples: Float32Array,
  sampleRate: number,
): { readonly hopMs: number; readonly strength: Float32Array } {
  const { onset, fps } = extractFeatures(samples, sampleRate);
  return { hopMs: 1000 / fps, strength: normalizeOnset(onset, fps) };
}

// --- 코드용 크로마 --------------------------------------------------------------
//
// **두 번째 STFT 통과다.** 위 통과와 합칠 수 없다 — ODF는 짧은 창(시간 분해능)이,
// 코드는 긴 창(주파수 분해능)이 필요하고 둘은 정면으로 상충한다(불확정성).

/**
 * 코드용 창 길이 (≈371ms). **빈 간격 2.69Hz.**
 *
 * 위 크로마가 200Hz에서 막힌 이유가 빈 간격(10.8Hz) > 반음 폭이었다. 창을 네
 * 배로 늘리면 빈 간격이 1/4이 되어 **C2(65Hz)의 반음 폭 3.8Hz까지** 내려간다 —
 * 대중음악 베이스 근음(E2 82Hz ~ A2 110Hz)이 여기 들어온다.
 *
 * **CQT가 아니라 긴 창인 이유.** CQT는 옥타브마다 창을 달리 잡아 저역에서만
 * 길게 보는 방식이라 더 정확하지만, 커널 행렬이라는 기계를 통째로 들여야 한다.
 * 우리가 필요한 것은 "근음이 옆 칸으로 새지 않는다" 하나뿐이고, 고역에서 창이
 * 필요 이상으로 긴 대가는 **어차피 비트 단위로 평균할 것**이라 크지 않다.
 */
export const CHORD_FRAME_SIZE = 8192;
/** 코드용 홉 (≈46ms). 120BPM 기준 한 박에 프레임 10개쯤 들어온다 */
export const CHORD_HOP_SIZE = 1024;

/** C2. 그 아래는 이 창으로도 반음이 빈 하나에 못 미친다 */
const CHORD_MIN_HZ = 65;
/** 위 크로마와 같다. 이 위는 배음뿐이라 근음 판정에 보태지 못한다 */
const CHORD_MAX_HZ = 2100;

/**
 * 베이스 크로마의 상한. `CHORD_MIN_HZ`~여기가 **근음이 사는 음역**이다.
 *
 * 대중음악 베이스는 E2(82Hz)~G3(196Hz)에 거의 다 들어온다. 200Hz를 넘기면
 * 반주 화음이 섞여 들어와 "가장 낮은 음이 무엇인가"라는 물음이 흐려진다 —
 * 하필 옛 크로마가 시작하던 자리다.
 */
const BASS_MAX_HZ = 200;

/**
 * 로그 압축의 세기 — `log10(1 + γ·|X|/peak)`.
 *
 * **생 진폭을 그대로 접으면 안 된다.** 조성 판정은 곡 전체를 평균해서 견뎠지만
 * (`key.aggregateChroma`), 코드는 비트 하나를 보므로 그 순간 가장 센 배음
 * 하나가 12칸을 독식한다 — 예를 들어 보컬이 3도를 세게 내면 그 비트가 근음
 * 없는 화음처럼 보인다. 압축은 약한 성분을 끌어올려 **음이 있는가 없는가**에
 * 가깝게 만든다(이진 템플릿이 재는 것이 정확히 그것이다).
 *
 * γ=100이면 peak 대비 1%인 성분이 최대값의 절반쯤으로 올라온다.
 */
const CHORD_GAMMA = 100;

export interface ChordChroma {
  /** 초당 프레임 수 */
  readonly fps: number;
  /** 프레임별 12차원 (frame * 12 + pc). 프레임마다 합이 1, 무음이면 0 */
  readonly chroma: Float32Array;
  /**
   * 같은 모양인데 **베이스 음역만** 접은 것(`CHORD_MIN_HZ`~`BASS_MAX_HZ`).
   *
   * 근음을 가리는 용도다. 음고류 집합만으로는 `Dm7`(D F A C)과 `F6`(F A C D)이
   * 같은 것이라 원리적으로 못 가르는데(사양서 §6이 aug·dim7에 대해 말한 것과
   * 같은 종류의 대칭), **어느 음이 맨 아래 있는가**가 그것을 가른다.
   */
  readonly bass: Float32Array;
  /**
   * 프레임별 생 에너지(압축 전 진폭 합).
   *
   * 크로마가 프레임마다 정규화되어 **큰 소리와 무음이 구별되지 않으므로**,
   * 비트 평균에서 어느 프레임을 얼마나 믿을지는 이 값이 정한다.
   */
  readonly energy: Float32Array;
  readonly frameCount: number;
}

/**
 * 코드 인식용 크로마. **원본 믹스에 건다**(사양서 §1.2 — 분리 스템이 아니다).
 *
 * `tuningCents`는 다시 재지 않고 첫 통과가 잰 값을 받는다. 같은 음원을 두 번
 * 재면 두 값이 갈릴 수 있고, 그러면 조성과 코드가 서로 다른 격자 위에 선다.
 */
export function extractChordChroma(
  samples: Float32Array,
  sampleRate: number,
  tuningCents: number,
  onProgress?: (ratio: number) => void,
): ChordChroma {
  const frames = new SpectrumFrames(samples, CHORD_FRAME_SIZE, CHORD_HOP_SIZE);
  const count = frames.count;
  const fps = sampleRate / CHORD_HOP_SIZE;
  if (count === 0) {
    return {
      fps,
      chroma: new Float32Array(0),
      bass: new Float32Array(0),
      energy: new Float32Array(0),
      frameCount: 0,
    };
  }

  // 빈 → 음고류 표. 위 통과와 같은 방식으로 조율 편차를 한 번에 흡수한다.
  const binHz = sampleRate / CHORD_FRAME_SIZE;
  const from = Math.max(1, Math.ceil(CHORD_MIN_HZ / binHz));
  const to = Math.min(frames.bins - 1, Math.floor(CHORD_MAX_HZ / binHz));
  const binPc = new Int8Array(frames.bins).fill(-1);
  for (let k = from; k <= to; k += 1) {
    const pitch = 69 + 12 * Math.log2((k * binHz) / 440) - tuningCents / 100;
    binPc[k] = (((Math.round(pitch) % 12) + 12) % 12) as number;
  }

  const bassTo = Math.min(to, Math.floor(BASS_MAX_HZ / binHz));
  const chroma = new Float32Array(count * 12);
  const bass = new Float32Array(count * 12);
  const energy = new Float32Array(count);
  const report = Math.max(1, Math.floor(count / 20));

  for (let t = 0; t < count; t += 1) {
    const mag = frames.at(t);

    // 프레임 최대값으로 나눈 뒤 압축한다 — 곡의 음량 변화가 압축 세기를
    // 바꾸지 않도록. 무음 프레임은 여기서 걸러지지 않고(잡음도 peak을 갖는다)
    // `energy`가 알려 준다.
    let peak = 0;
    let raw = 0;
    for (let k = from; k <= to; k += 1) {
      if (mag[k] > peak) peak = mag[k];
      raw += mag[k];
    }
    energy[t] = raw;
    if (peak <= 0) continue;

    let sum = 0;
    let bassSum = 0;
    const base = t * 12;
    for (let k = from; k <= to; k += 1) {
      const pc = binPc[k];
      if (pc < 0) continue;
      const value = Math.log10(1 + CHORD_GAMMA * (mag[k] / peak));
      chroma[base + pc] += value;
      sum += value;
      if (k <= bassTo) {
        // **베이스는 압축하지 않는다.** 압축은 약한 성분을 끌어올려 "음이
        // 있는가"에 가깝게 만드는 장치인데, 여기서 묻는 것은 반대로 "무엇이
        // 가장 센가"다 — 끌어올리면 근음이 배음·잡음과 같아진다.
        bass[base + pc] += mag[k];
        bassSum += mag[k];
      }
    }
    if (sum > 0) {
      for (let pc = 0; pc < 12; pc += 1) chroma[base + pc] /= sum;
    }
    if (bassSum > 0) {
      for (let pc = 0; pc < 12; pc += 1) bass[base + pc] /= bassSum;
    }

    if (onProgress && t % report === 0) onProgress(t / count);
  }
  onProgress?.(1);

  return { fps, chroma, bass, energy, frameCount: count };
}

/**
 * ODF를 템포·비트 단계가 쓸 형태로 다듬는다.
 *
 * 이동평균을 빼고 반파 정류한 뒤 표준편차로 나눈다. 이유는 셋이다 — 곡의
 * 전체 음량 변화가 상관도에 들어오지 않게, 음수 값이 자기상관을 흐리지 않게,
 * 그리고 DP의 전이 비용 상수(tightness)가 곡마다 다른 스케일을 만나지 않게.
 */
export function normalizeOnset(onset: Float32Array, fps: number): Float32Array {
  const n = onset.length;
  const out = new Float32Array(n);
  if (n === 0) return out;

  const half = Math.max(1, Math.round(0.35 * fps));
  // 누적합으로 이동평균 — 창이 넓어도 O(n)이다
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) prefix[i + 1] = prefix[i] + onset[i];

  for (let i = 0; i < n; i += 1) {
    const from = Math.max(0, i - half);
    const to = Math.min(n, i + half + 1);
    const mean = (prefix[to] - prefix[from]) / (to - from);
    out[i] = Math.max(0, onset[i] - mean);
  }

  let sq = 0;
  for (let i = 0; i < n; i += 1) sq += out[i] * out[i];
  const rms = Math.sqrt(sq / n);
  if (rms > 0) for (let i = 0; i < n; i += 1) out[i] /= rms;
  return out;
}
