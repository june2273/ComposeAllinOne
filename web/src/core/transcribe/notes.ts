/**
 * 피치 커브 → 음표. **f0가 원재료고 노트는 그것의 양자화 결과다**(사양서 §1.8).
 *
 * 원본 커브를 지우지 않는다 — 비브라토·포르타멘토·벤드는 여기서 버려지지만
 * `PitchCurve`는 그대로 남아 있고, 각 노트가 자기 구간의 평균 편차를
 * `centsOffset`으로 들고 나간다.
 *
 * ## 왜 임계값이 아니라 DP인가
 *
 * "반음 이상 벗어나면 새 음표"로 자르면 두 가지가 동시에 깨진다.
 *
 * - **비브라토**가 음표를 잘게 부순다. J-pop 보컬의 비브라토는 ±50센트를
 *   넘나들어 반음(±50)에 걸친다.
 * - **옥타브 점프**(f0 추정의 고전적 실패, 사양서 §8)가 그대로 음표가 된다.
 *
 * 둘 다 "짧게 벗어났다가 돌아온다"는 같은 모양이라, 벗어난 **양**이 아니라
 * 벗어난 **시간**으로 판단해야 한다. 그래서 국소 비용(관측과의 거리)과 전이
 * 비용(음을 바꾸는 값)을 겨루게 한다 — 사양서 §1.9가 파이프라인 전체에 쓰라고
 * 한 그 구조이고, `analysis/tempo.ts`의 비트 추적과 같은 꼴이다.
 *
 * 국소 비용에 **상한을 둔 것이 핵심이다.** 상한이 없으면 한 옥타브 벗어난
 * 프레임 하나의 비용이 12가 되어 어떤 전이 비용보다도 커지고, DP가 반드시
 * 따라 뛴다. 상한을 두면 "많이 벗어난 것"과 "아주 많이 벗어난 것"이 같아져
 * 짧은 이탈은 값이 쌓이지 않는다(로버스트 손실의 상투적인 수법).
 */

/** 피치 커브. 사이드카가 주는 것과 같은 모양이다 */
export interface PitchCurve {
  /** 프레임 간격(밀리초). basic-pitch·JDC 계열은 보통 10 */
  readonly hopMs: number;
  /** 프레임별 f0(Hz). 0이면 무성(voicing 없음) */
  readonly f0: readonly number[];
  /** 프레임별 신뢰도 0~1. 없으면 f0>0을 그대로 믿는다 */
  readonly confidence?: readonly number[];
}

export interface NoteEvent {
  /** MIDI 번호 */
  readonly midi: number;
  readonly startSec: number;
  readonly endSec: number;
  /** 0~127. 이 단계에는 음량 정보가 없어 상수다(아래 주석) */
  readonly velocity: number;
  /**
   * 이 음표 구간에서 f0가 평균적으로 벗어난 정도(센트).
   *
   * 벤드·포르타멘토가 있으면 여기에 남는다. 표기에는 쓰이지 않지만 **전사가
   * 얼마나 억지였는지의 유일한 흔적**이라 버리지 않는다.
   */
  readonly centsOffset: number;
}

export interface NoteOptions {
  /**
   * 음원 전체의 조율 편차(센트). `AnalysisReport.tuningCents`를 그대로 넣는다.
   *
   * 실제 음원은 속도가 미세하게 어긋나 있을 때가 있어 40센트씩 밀리기도
   * 한다(analysis/features.ts의 같은 주석). 보정하지 않으면 곡 전체가 반음의
   * 절반만큼 밀린 채 반올림되어 **음표의 절반이 옆 음으로 떨어진다.**
   */
  readonly tuningCents?: number;
  /** 이 아래 길이의 음표는 버린다(밀리초) */
  readonly minNoteMs?: number;
  /** 신뢰도가 이 아래인 프레임은 무성으로 본다 */
  readonly minConfidence?: number;
}

/** 다룰 음역. 사람 목소리 + 여유. 상태 수가 곧 DP 비용이라 넓힐 이유가 없다 */
export const MIN_MIDI = 36; // C2
export const MAX_MIDI = 96; // C7

/**
 * 아래 상수들은 **평가셋 없이 정한 값이다.** 합성 신호로 "의도대로 도는가"만
 * 확인했고 실제 보컬 정확도는 보증하지 않는다. 채보 정답이 붙은 실곡이 20~30곡
 * 모이면 여기서 다시 맞출 것 — `analysis/meter.ts`의 임계값들과 같은 처지다.
 */
/**
 * 국소 비용 상한(반음). 이보다 멀어도 더 비싸지지 않는다.
 *
 * **상한을 두는 순간 "얼마나 벗어났는가"는 판단에서 빠진다** — 한 옥타브
 * 벗어난 것과 온음 벗어난 것이 같은 값이 된다. 남는 유일한 축이 시간이고,
 * 그게 아래 `SWITCH_MS`다.
 */
const COST_CLAMP = 1;
/**
 * 이보다 짧게 벗어난 것은 음표로 세우지 않는다(밀리초).
 *
 * 전이 비용을 상수로 두면 이 값이 **프레임 간격에 딸려 간다** — 10ms 커브에서
 * 맞춘 값이 20ms 커브에서는 두 배가 된다. 그래서 상수를 직접 적지 않고 이
 * 시간에서 매번 계산한다(`switchCost`).
 *
 * 70ms는 16분음표가 214BPM에서 갖는 길이다. 그보다 빠른 멜리스마는 뭉갠다.
 */
const SWITCH_MS = 70;
/** 무성 구간에 음을 세울 때의 값. CLAMP와 같게 두어 끊기는 기준도 SWITCH_MS다 */
const UNVOICED_MISMATCH = COST_CLAMP;
/** 유성 구간을 무성으로 볼 때의 값 */
const VOICED_MISMATCH = COST_CLAMP;
/** 이 앱에는 음량 정보가 없다. MIDI 규격상 0은 note-off라 중간값을 쓴다 */
const DEFAULT_VELOCITY = 80;

/**
 * 이보다 짧은 음표는 버린다. DP가 이미 `SWITCH_MS`(=70ms)보다 짧은 이탈을
 * 세우지 않으므로, 여기서 더 걸러지는 것은 무성 구간에 끼인 짧은 조각들이다.
 */
const DEFAULT_MIN_NOTE_MS = 80;
const DEFAULT_MIN_CONFIDENCE = 0.3;

/**
 * 음을 바꾸는 값.
 *
 * N프레임 벗어났다가 돌아오는 이탈을 따라가려면 `2 × switch`를 내고 `N × CLAMP`를
 * 아껴야 한다. 그래서 손익분기가 `N = 2 × switch / CLAMP` 프레임이고, 그것이
 * `SWITCH_MS`가 되도록 역산한 값이다.
 */
function switchCost(hopMs: number): number {
  return ((SWITCH_MS / hopMs) * COST_CLAMP) / 2;
}

/** Hz → MIDI 번호(소수). A4=440Hz=69 */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

// --- 조율 자가 점검 -----------------------------------------------------------

/** 히스토그램 한 칸 = 1센트 */
const TUNING_BINS = 100;
/** 이만큼은 모여야 봉우리를 믿는다. 못 미치면 null을 돌려준다 */
const TUNING_MIN_NOTES = 12;
/** 봉우리를 찾기 전에 이만큼 폭으로 뭉갠다(센트) */
const TUNING_SMOOTH = 4;

/**
 * 잘라 놓은 음표들이 반음 격자에서 **한쪽으로** 얼마나 쏠려 있는가(센트).
 * 표본이 모자라면 `null`.
 *
 * **`AnalysisReport.tuningCents`는 믹스 전체에서 온다.** 반주가 지배하는 값이라
 * 보컬 전사에 그대로 쓰면 어긋날 수 있는데, 조율이 밀리면 음표가 **통째로 옆 음으로
 * 떨어진다** — 표기 오류 중 가장 크게 티가 나는 종류다. 그래서 전사한 뒤에
 * 전사한 신호로 한 번 되짚는다.
 *
 * **프레임이 아니라 음표 단위로 센다.** 프레임을 그대로 모으면 두 가지가 망친다 —
 * 음과 음을 잇는 포르타멘토가 반음 격자를 고르게 훑어 배경을 깔고, 비브라토는
 * 양 끝(기울기 0인 자리)에 프레임이 몰려 **가짜 봉우리를 ±50센트에 만든다.**
 * `centsOffset`은 음표 구간의 평균이라 둘 다 상쇄된다. 길이로 가중하는 것은
 * 긴 음이 조율의 증거로 더 믿을 만하기 때문이다.
 */
export function tuningDriftCents(notes: readonly NoteEvent[]): number | null {
  if (notes.length < TUNING_MIN_NOTES) return null;
  const hist = new Float64Array(TUNING_BINS);
  for (const note of notes) {
    const weight = Math.max(0, note.endSec - note.startSec);
    let frac = note.centsOffset / 100;
    frac -= Math.round(frac); // −0.5 ~ 0.5
    hist[Math.min(TUNING_BINS - 1, Math.floor((frac + 0.5) * TUNING_BINS))] += weight;
  }

  // **원형으로 뭉갠다.** −49센트와 +49센트는 이웃이다 — 반음 격자 위에서 붙어
  // 있으므로, 선형으로 다루면 그 경계에 걸친 봉우리가 둘로 갈린다.
  let best = 0;
  let bestWeight = -1;
  for (let bin = 0; bin < TUNING_BINS; bin += 1) {
    let weight = 0;
    for (let d = -TUNING_SMOOTH; d <= TUNING_SMOOTH; d += 1) {
      weight += hist[(bin + d + TUNING_BINS) % TUNING_BINS];
    }
    if (weight > bestWeight) {
      bestWeight = weight;
      best = bin;
    }
  }
  return best + 0.5 - TUNING_BINS / 2;
}

/**
 * 이 음표들이 조율 격자에서 벗어난 정도(센트, 중앙값).
 *
 * 자가 점검의 판정값이다 — 크면 고른 조율이 틀렸다는 뜻이고, 그때는 음표의
 * 상당수가 옆 음에 떨어져 있다.
 */
export function tuningResidualCents(notes: readonly NoteEvent[]): number {
  if (!notes.length) return 0;
  const values = notes.map((n) => Math.abs(n.centsOffset)).sort((a, b) => a - b);
  return values[values.length >> 1];
}

/**
 * 피치 커브를 음표로 자른다.
 *
 * 반환은 시간순이고 겹치지 않는다 — DP가 프레임마다 상태 하나만 고르므로
 * 구조적으로 그렇게 된다(단선율 전제. 화음은 이 함수의 범위가 아니다).
 */
export function segmentNotes(
  curve: PitchCurve,
  options: NoteOptions = {},
): NoteEvent[] {
  const {
    tuningCents = 0,
    minNoteMs = DEFAULT_MIN_NOTE_MS,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
  } = options;

  const frames = curve.f0.length;
  const hopSec = curve.hopMs / 1000;
  if (frames === 0 || !(hopSec > 0)) return [];

  // 관측을 MIDI 소수로 옮긴다. 조율 보정은 여기서 한 번만 건다 —
  // 뒤쪽에서 다시 걸면 두 번 밀린다.
  const observed = new Float64Array(frames);
  const voiced = new Uint8Array(frames);
  for (let i = 0; i < frames; i += 1) {
    const hz = curve.f0[i];
    const ok =
      hz > 0 &&
      Number.isFinite(hz) &&
      (curve.confidence === undefined || curve.confidence[i] >= minConfidence);
    if (!ok) continue;
    const midi = hzToMidi(hz) - tuningCents / 100;
    if (midi < MIN_MIDI - 1 || midi > MAX_MIDI + 1) continue;
    observed[i] = midi;
    voiced[i] = 1;
  }

  const path = viterbiPitch(observed, voiced, switchCost(curve.hopMs));

  // 같은 상태가 이어지는 구간이 곧 음표다. 상태 0은 무성이다.
  const notes: NoteEvent[] = [];
  let start = 0;
  for (let i = 1; i <= frames; i += 1) {
    if (i < frames && path[i] === path[i - 1]) continue;
    const state = path[i - 1];
    if (state > 0) {
      const midi = state - 1 + MIN_MIDI;
      const startSec = start * hopSec;
      const endSec = i * hopSec;
      if ((endSec - startSec) * 1000 >= minNoteMs) {
        notes.push({
          midi,
          startSec,
          endSec,
          velocity: DEFAULT_VELOCITY,
          centsOffset: meanCents(observed, voiced, start, i, midi),
        });
      }
    }
    start = i;
  }
  return notes;
}

/**
 * 상태별 최적 경로. 상태는 `[무성, MIN_MIDI … MAX_MIDI]`.
 *
 * **전이 비용이 상수라 O(프레임 × 상태)로 끝난다.** 모든 i에 대한
 * `min(D[i] + c(i,j))`가 `min(D[j], 전체최솟값 + SWITCH)` 둘 중 하나이기
 * 때문이다 — 상태 수의 제곱을 도는 일반 Viterbi를 쓸 이유가 없다.
 * (이 최적화가 성립하려면 전이 비용이 거리에 의존하면 안 된다. 도약을
 * 순차진행보다 비싸게 매기고 싶어지면 그때 제곱 루프로 돌아와야 한다.)
 */
function viterbiPitch(
  observed: Float64Array,
  voiced: Uint8Array,
  switchTo: number,
): Int16Array {
  const frames = observed.length;
  const pitches = MAX_MIDI - MIN_MIDI + 1;
  const states = pitches + 1;

  let cost = new Float64Array(states);
  let next = new Float64Array(states);
  // 프레임 × 상태 역추적표. 4분 곡이면 24000 × 62 = 1.5MB 남짓이다
  const back = new Int16Array(frames * states);

  for (let t = 0; t < frames; t += 1) {
    // 이전 프레임에서 어디서 오든 가장 싼 곳 하나만 알면 된다
    let bestPrev = 0;
    let bestState = 0;
    if (t > 0) {
      bestPrev = cost[0];
      for (let s = 1; s < states; s += 1) {
        if (cost[s] < bestPrev) {
          bestPrev = cost[s];
          bestState = s;
        }
      }
    }
    const switched = bestPrev + switchTo;

    for (let s = 0; s < states; s += 1) {
      const local =
        s === 0
          ? voiced[t]
            ? VOICED_MISMATCH
            : 0
          : voiced[t]
            ? Math.min(Math.abs(observed[t] - (s - 1 + MIN_MIDI)), COST_CLAMP)
            : UNVOICED_MISMATCH;

      if (t === 0) {
        next[s] = local;
        back[s] = -1;
        continue;
      }
      // 머무르는 쪽이 같은 값이면 머무른다 — 이유 없이 음을 바꾸지 않는다
      const stay = cost[s];
      if (stay <= switched) {
        next[s] = local + stay;
        back[t * states + s] = s;
      } else {
        next[s] = local + switched;
        back[t * states + s] = bestState;
      }
    }
    const swap = cost;
    cost = next;
    next = swap;
  }

  const path = new Int16Array(frames);
  if (frames === 0) return path;
  let end = 0;
  for (let s = 1; s < states; s += 1) if (cost[s] < cost[end]) end = s;
  path[frames - 1] = end;
  for (let t = frames - 1; t > 0; t -= 1) {
    path[t - 1] = back[t * states + path[t]];
  }
  return path;
}

/** 구간 안에서 관측이 그 음표로부터 평균 몇 센트 벗어나 있었는가. */
function meanCents(
  observed: Float64Array,
  voiced: Uint8Array,
  from: number,
  to: number,
  midi: number,
): number {
  let sum = 0;
  let count = 0;
  for (let i = from; i < to; i += 1) {
    if (!voiced[i]) continue;
    sum += (observed[i] - midi) * 100;
    count += 1;
  }
  return count ? sum / count : 0;
}
