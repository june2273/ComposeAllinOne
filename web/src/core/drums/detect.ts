/**
 * 드럼 스템 → 타점.
 *
 * **`extractFeatures`의 SuperFlux 통과를 그대로 쓴다.** 새 DSP도 새 의존성도
 * 없다 — 사양서 §4[2]가 "Hard 온셋(드럼)은 단순 spectral flux로 충분"이라고
 * 적은 그대로이고, 우리는 그 flux를 이미 만들고 있었다. 달라진 것은 **마지막
 * 한 줄뿐이다**: 205밴드를 한 숫자로 더해 버리는 대신 일곱 묶음으로 나눠 받는다.
 *
 * ## 언제(when)와 무엇(what)을 **다른 신호로** 판단한다
 *
 * 이것이 이 파일의 유일한 큰 결정이고, **실측이 강제한 것이다.**
 *
 * | | 무엇을 쓰나 | 왜 |
 * |---|---|---|
 * | **언제** — 타점 시각 | 로그 플럭스 (`bandFlux`) | 변화에 민감하다. 온셋의 정의 그대로 |
 * | **무엇** — 악기 이름 | **선형** 크기 (`bandEnergy`) | 스펙트럼 모양이 살아 있다 |
 *
 * > **실측 2026-09-03.** 처음에는 분류도 로그 플럭스로 했다. 그런데 킥·스네어·
 * > 하이햇·크래시의 묶음별 플럭스 비율이 **전부 `[.09 .14 .29 .20 .14 .08 .05]`로
 * > 사실상 같았다.** 로그 플럭스는 "이 대역이 켜졌는가"를 재지 "에너지가
 * > 얼마인가"를 재지 않아서, 잡음 바닥 위로 올라오기만 하면 어느 대역이든 같은
 * > 크기로 뛴다. 유일하게 갈린 것이 톰이었는데(5kHz 위가 **진짜로** 0이라)
 * > 그것이 오히려 기전을 확인해 줬다. 로그를 씌우기 전 값을 받자 갈렸다.
 *
 * ## 왜 합산 ODF 하나로는 안 되는가
 *
 * 봉우리 하나에 클래스 하나를 붙이면 **킥과 하이햇이 같은 칸에 있을 때 저역이
 * 이겨서 하이햇이 통째로 사라진다.** J-pop 드럼에서 가장 흔한 사건이 정확히
 * 그것이다. 그래서 채널 셋을 **각각 독립으로** 봉우리 뽑고, 프로파일 검사도
 * 채널마다 따로 건다 — 킥+하이햇 동시타에서는 저역 몫과 고역 몫이 **둘 다**
 * 자기 문턱을 넘으므로 둘 다 선다. `DrumHit`이 (시각, 클래스) 하나이고 **같은
 * 시각에 여럿 설 수 있는** 이유다.
 *
 * ## `onsetPeaks`를 안 쓴 이유
 *
 * `core/transcribe/notes.ts`의 `ONSET_REFRACTORY_MS = 80`이 **모듈 상수이고
 * 인자가 아니다.** `docs/템포_배수오류_미해결.md` H5가 이미 같은 이유로 그
 * 함수를 물리쳤다 — 185BPM의 16분음표가 정확히 81ms다. 하이햇 16분은 150BPM에서
 * 100ms, 180BPM에서 83ms이므로, 그대로 쓰면 **빠른 곡에서 하이햇의 절반을
 * 검출기가 스스로 지운다.** 규칙(국소 최대 + 문턱 + 불응기)은 맞고 상수만
 * 틀렸으므로 여기서는 **채널마다 인자로** 받는다.
 *
 * ## 아직 못 하는 것 — 재기 전에 주장하지 않는다 (규칙 1)
 *
 * - **실곡 정확도를 말할 수 없다.** 드럼 정답을 찍어 둔 곡이 하나도 없다.
 *   아래 상수는 전부 추측이고, 합성 신호로만 확인했다.
 * - **심벌 종류를 못 가른다.** `ANALYSIS_RATE`가 22050이라 나이퀴스트가
 *   11025Hz인데, 라이드·크래시·열린하이햇을 가르는 에너지가 대부분 그 위에
 *   있다. 알고리즘이 아니라 **표본화율의 한계**다.
 * - **플로어톰이 킥으로 샐 수 있다.** `KICK_SUB_SHARE`가 막아 보지만
 *   기본음이 겹치는 구간에서는 원리적으로 어렵다.
 */

import { extractFeatures, normalizeOnset } from "../analysis";

import { type DrumClass, representative } from "./gm";

/**
 * 밴드 묶음 경계(Hz). 일곱 묶음이다.
 *
 * | 묶음 | 대역 | 무엇이 여기 사는가 |
 * |---|---|---|
 * | 0 | 30~110 | 킥 기본음 |
 * | 1 | 110~220 | 킥 상단 · 플로어톰 |
 * | 2 | 220~900 | 스네어 몸통 · 톰 |
 * | 3 | 900~2500 | 스네어 잡음 하단 |
 * | 4 | 2500~5000 | 스네어 잡음 상단 · 심벌 하단 |
 * | 5 | 5000~8000 | 하이햇 |
 * | 6 | 8000~11000 | 밝기 — 나이퀴스트가 여기서 끝난다 |
 */
export const BAND_EDGES: readonly number[] = [30, 110, 220, 900, 2500, 5000, 8000, 11_000];

/** 채널 = 묶음 몇 개의 합. 봉우리는 **채널마다 독립으로** 뽑는다 */
const LOW_GROUPS = [0, 1];
const MID_GROUPS = [2, 3];
const HIGH_GROUPS = [4, 5, 6];
/** 하이햇·심벌이 사는 곳. 스네어 잡음(주로 묶음 4)과 가르는 축이다 */
const BRIGHT_GROUPS = [5, 6];

/** 봉우리 판정에 볼 좌우 반경(ms). 이 안에 더 큰 값이 있으면 봉우리가 아니다 */
const PEAK_RADIUS_MS = 30;

/**
 * 채널별 기본 문턱. 곡선이 RMS 정규화돼 있어 1.0이 "평균적인 세기"다.
 * **전부 추측이다** — 하니스(`drums.eval.ts`)가 훑는다.
 */
const DEFAULT_MIN_STRENGTH: readonly number[] = [1.15, 1.0, 0.95];

/**
 * 채널별 불응기(ms). **80이 아니다** — 위 주석 참조.
 *
 * 킥이 조금 긴 것은 저역 파형이 길어 한 타점이 프레임 여럿에 걸쳐 서기
 * 때문이다. 45ms는 180BPM 16분(83ms)의 절반이라 여유가 있다.
 */
const DEFAULT_REFRACTORY_MS: readonly number[] = [55, 45, 45];

// --- 프로파일 문턱 ---------------------------------------------------------------
//
// 전부 **몫(share)**이다 — 프로파일을 합 1로 정규화한 뒤의 비율. 절대 크기를
// 쓰면 곡의 음량이 판정에 들어온다.
//
// **동시타를 살리려면 느슨해야 한다.** 킥+하이햇이 함께 울리면 저역 몫도
// 고역 몫도 각자 혼자일 때보다 작아진다. 문턱이 빡빡하면 그 순간 둘 다 죽는다.
//
// > **실측 2026-09-03 — 이 몫은 대역마다 흰색으로 만든 뒤의 값이다.**
// > 처음에는 생 선형 크기를 그대로 합 1로 정규화했다. 합성 신호에서는 완벽했는데
// > (F=1.000) **실곡에서 하이햇이 통째로 죽었다** — 고역 봉우리 604개 중 559개가
// > 밝기 문턱에서 탈락했고, 밝기 몫의 중앙값이 합성 0.398 대 실곡 **0.017**이었다.
// >
// > 원인은 구조적이다: **선형 에너지는 어떤 음악에서든 저역이 압도한다.** 60Hz
// > 킥의 진폭은 8kHz 하이햇보다 자릿수가 다르다. 합성 하이햇은 저역이 아예 0이라
// > 그 편향이 안 보였을 뿐이다. `normalizeOnset`이 플럭스에 하는 일(이동평균을
// > 빼고 RMS로 나눈다)을 대역마다 해 줘야 두 세계가 같은 값을 낸다.
//
// **이것이 합성 시험의 한계를 실제로 만난 자리다** — CLAUDE.md가 "합성 신호는
// '의도대로 도는가'까지만 말한다"고 적어 둔 그것.

// **문턱은 몫이 아니라 절대값이다 — 흰색화가 그것을 가능하게 한다.**
//
// 단위는 "그 대역의 전형적 크기 몇 개분"이라 곡의 음량과 무관하다. 몫으로
// 걸면 **동시타에서 원리적으로 깨진다**: 정박의 킥+하이햇에서 킥의 큰 저역이
// 하이햇의 밝기 몫을 0.605 → 0.134로 희석해 문턱 아래로 밀어낸다(실측:
// 동시타가 8정박 중 2번만 잡혔다). 절대값은 악기마다의 기여가 **서로 더해지지
// 나눠 갖지 않으므로** 그 함정이 없다.
//
// **흰색화 공간의 실측표** (2026-09-03, 합성 그루브 안에서 홀로 치는 자리):
//
// |        | 저(0+1) | 중(2+3) | 몸통(1+2) | 잡음(3~6) | 밝(5+6) | 저/중 |
// |--------|--------|--------|----------|----------|--------|------|
// | 킥     | 7.41   | 0.44   | 2.62     | 0.01     | 0.00   | 16.8 |
// | 스네어  | 2.85   | 2.94   | 4.23     | 1.77     | 0.42   | 0.97 |
// | 톰     | 4.27   | 1.99   | 5.75     | 0.01     | 0.00   | 2.15 |
// | 하이햇  | 0.02   | 0.48   | 0.16     | 2.06     | 1.34   | 0.05 |
// | 크래시  | 0.15   | 1.35   | 0.80     | 3.39     | 1.69   | 0.11 |
// | 오픈    | 0.07   | 0.76   | 0.29     | 3.20     | 1.95   | 0.09 |
//
// 아래 문턱은 **전부 이 표에서 뽑았다.** 섞어 쓰지 말 것 — 흰색화 전 값과
// 후 값이 섞여 있던 판이 실곡에서 킥을 0%로 만들었다.

/** 저역 채널 봉우리를 킥으로 인정하는 최소 저역 크기 (묶음 0+1) */
const KICK_LOW = 2;
/**
 * 킥은 **저역이 중역을 이만큼 이겨야 한다.**
 *
 * 이것이 킥을 스네어·톰에서 가르는 축이다 — 크기만 보면 톰도 4.27이라 문턱을
 * 넘는다. 비를 보면 킥 16.8 · 톰 2.15 · 스네어 0.97로 자릿수가 갈린다.
 *
 * > **최저몫(묶음 0 / 묶음 0+1+2)으로 가르려다 되돌렸다.** 합성에서는 킥 0.681
 * > 대 톰 0.081로 깨끗했는데 **실곡에서 곡마다 갈렸다** — 중앙값이 곡C
 * > 0.046 · 곡E 0.158 · 곡F 0.383 · 곡A 0.300이라, 문턱 0.30이 두 곡은
 * > 통째로 죽이고 두 곡은 절반을 살렸다(킥 0%가 실제로 났다). 킥의 기본음이
 * > 어느 묶음에 앉는지는 **곡의 킥 튜닝**이 정하고, 저역에 베이스가 새어 들면
 * > 흰색화 분모까지 함께 올라간다. 곡마다 갈리는 값은 문턱으로 쓰지 않는다.
 * > 지금은 신뢰도에만 반영한다.
 */
const KICK_DOMINANCE = 2.5;
/** 중역 채널 봉우리를 인정하는 최소 중역 크기 (묶음 2+3) */
const MID_LEVEL = 1;
/**
 * 막을 때린 소리인가 — **몸통 크기**(묶음 1+2).
 *
 * 스네어 4.23 · 톰 5.75 · 킥 2.62 · 크래시 0.80 · 하이햇 0.16. 이게 없으면
 * 하이햇이 중역 채널에도 걸려 스네어로 이중 판정된다(실제로 났다).
 */
const BODY_LEVEL = 2;
/**
 * 스네어와 톰을 가르는 **잡음 크기**(묶음 3~6). 스네어 1.77 · 톰 0.01.
 *
 * 밝기로 가르려다 마진이 좁아 뒤집힌 적이 있다 — 톰은 **900Hz 위가 진짜로
 * 비어 있다**는 것이 훨씬 넓은 축이다.
 */
const SNARE_NOISE = 0.5;
/**
 * 고역 채널 봉우리를 하이햇 계열로 인정하는 최소 밝기 크기 (묶음 5+6).
 *
 * 하이햇 1.34 · 오픈 1.95 · 크래시 1.69 · 스네어 0.42 · 킥 0.00. 스네어 누설과의
 * 사이가 넓어서 **겹쳐 울려도 지우지 않고 가릴 수 있다.**
 */
const BRIGHT_LEVEL = 0.8;
/**
 * 프로파일과 감쇠를 읽을 프레임을 찾는 창(프레임). 플럭스 봉우리에서 뒤로 이만큼.
 *
 * **플럭스 봉우리는 에너지 봉우리보다 앞선다.** 플럭스는 변화가 가장 큰 자리라
 * 소리가 최대가 되기 *전*에 선다 — 실측(2026-09-03)에서 킥이 일관되게 10~30ms
 * (1~3프레임) 앞섰고, 그 프레임에서 프로파일을 읽으면 **아직 소리가 안 난 상태를
 * 읽는다**(킥의 저역 크기가 7.17 대신 0.64로 나왔다).
 *
 * 그래서 **시각은 플럭스 봉우리가, 값은 에너지 봉우리가** 정한다 — 이 파일의
 * "언제와 무엇을 다른 신호로 판단한다"가 프레임 단위에서도 그대로 적용된다.
 */
const ENERGY_PEAK_AHEAD = 5;
/** 앞쪽으로도 조금은 본다 — 어택이 완만한 심벌은 반대로 설 수 있다 */
const ENERGY_PEAK_BACK = 1;

/**
 * **무음 게이트** — 흰색으로 만든 프로파일의 총합이 이만큼은 되어야 한다.
 *
 * 단위가 "그 대역의 전형적 크기 몇 개분"이라 곡의 음량과 무관하다. 진짜 타점은
 * 보통 1을 넘는다.
 *
 * `normalizeOnset`이 RMS로 나누므로 **내용이 거의 없는 채널에서는 잡음이 그대로
 * 큰 z값이 된다.** 실측(2026-09-03): 킥만 든 트랙에서 중역 채널이 봉우리 16개를
 * 뽑았고(진짜는 0개), 톰만 든 트랙에서 고역 채널이 17개를 뽑았다. 상대 문턱만으로는
 * 원리적으로 못 막는다 — 분모가 함께 작아지기 때문이다.
 */
const ENERGY_FLOOR = 0.15;
/**
 * 대역별 기준 크기를 잡는 분위.
 *
 * 최댓값을 쓰면 크래시 한 번에 곡 전체가 눌리고, 중앙값을 쓰면 쉬는 구간이 많은
 * 곡에서 기준이 무너진다.
 */
const ENERGY_REFERENCE_PERCENTILE = 0.9;

/** 프로파일의 바닥을 재는 창(ms). 타점 **직전**을 본다 */
const FLOOR_FROM_MS = 160;
const FLOOR_TO_MS = 12;

// --- 감쇠 -----------------------------------------------------------------------
//
// 선형 포락선이라 지수 감쇠가 지수 감쇠로 보인다. 계산해 둔 값:
// 닫힘(τ=25ms) r1≈0.07 · 열림(τ=220ms) r1≈0.65 r2≈0.21 · 크래시(τ=0.9s) r2≈0.66

const TAIL1_FROM_MS = 50;
const TAIL1_TO_MS = 150;
const TAIL2_FROM_MS = 250;
const TAIL2_TO_MS = 500;
/** 뒷창이 이만큼 남으면 심벌 */
const CYMBAL_TAIL = 0.4;
/** 앞창이 이만큼 남으면 열린하이햇 */
const OPEN_TAIL = 0.35;
/**
 * 감쇠 창이 다음 봉우리에 잘려 이보다 짧아지면 **판단을 포기하고 하이햇으로
 * 둔다.** 16분 하이햇이 촘촘하면 창 안에 다음 타점이 들어와 닫힌하이햇이
 * 지속음처럼 보인다 — 그 착시를 문턱으로 막는 대신 신뢰도를 낮춘다.
 */
const MIN_TAIL_MS = 40;

/** 벨로시티 1.0에 해당하는 정규화 플럭스 값 */
const VELOCITY_REF = 4;

export interface DrumHit {
  readonly atSec: number;
  readonly cls: DrumClass;
  /** 대표 GM 번호. 어휘 → 표 변환은 `gm.representative` 한 곳에만 있다 */
  readonly gm: number;
  /** 1~127 */
  readonly velocity: number;
  /** 0~1. 문턱과의 거리에서 나온다 */
  readonly confidence: number;
  /**
   * 판정 근거 — 이 타점의 **선형 대역 프로파일**(합 1로 정규화, 소수 셋째 자리).
   *
   * **지우지 말 것.** 왜 그렇게 판정했는지를 나중에 되짚는 유일한 자료다
   * (`melody`의 `f0Alt`, `sections`의 `reason`과 같은 방침). 하니스가 오분류를
   * 훑을 때 이것부터 본다.
   */
  readonly bands: readonly number[];
}

export interface DetectOptions {
  /** 묶음 경계(Hz). 기본 `BAND_EDGES` */
  readonly bandsHz?: readonly number[];
  /** 채널별 문턱 [저·중·고]. 하나만 주면 셋에 다 쓴다 */
  readonly minStrength?: number | readonly number[];
  /** 채널별 불응기(ms) [저·중·고]. 하나만 주면 셋에 다 쓴다 */
  readonly refractoryMs?: number | readonly number[];
}

export interface DrumDetection {
  /** 시각 오름차순. **같은 시각에 여럿 있을 수 있다** */
  readonly hits: readonly DrumHit[];
  readonly fps: number;
  readonly bandsHz: readonly number[];
  /** 채널이 뽑은 봉우리 수 — 프로파일 검사 **전**이다. 위생 지표 */
  readonly peakCounts: { readonly low: number; readonly mid: number; readonly high: number };
  /**
   * 프로파일 검사에서 떨어진 수 — **채널별로 나눠 둔다.**
   *
   * 합계 하나로는 어느 게이트가 일했는지 못 읽는다. `meta.json`이
   * `octaveLiftedFrames`와 `highRegisterFrames`를 따로 남기는 것과 같은 이유다.
   */
  readonly rejected: { readonly low: number; readonly mid: number; readonly high: number };
}

/**
 * 국소 최대 + 문턱 + 불응기.
 *
 * `onsetPeaks`와 같은 규칙이되 **불응기가 인자다.** 진단용으로 밖에 낸다.
 *
 * 불응기에 걸린 봉우리가 앞의 것보다 크면 **갈아치운다** — 안 그러면 먼저 온
 * 작은 봉우리가 진짜를 막는다(어택이 완만한 심벌에서 실제로 난다).
 */
export function pickPeaks(
  curve: Float32Array,
  fps: number,
  minStrength: number,
  refractoryMs: number,
  radiusMs: number = PEAK_RADIUS_MS,
): number[] {
  const n = curve.length;
  const out: number[] = [];
  if (n === 0) return out;

  const radius = Math.max(1, Math.round((radiusMs * fps) / 1000));
  const refractory = Math.max(1, Math.round((refractoryMs * fps) / 1000));

  for (let t = 0; t < n; t += 1) {
    const v = curve[t];
    if (v < minStrength) continue;

    let isMax = true;
    const from = Math.max(0, t - radius);
    const to = Math.min(n - 1, t + radius);
    for (let k = from; k <= to; k += 1) {
      if (curve[k] > v) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;

    const last = out.at(-1) ?? -Infinity;
    if (t - last < refractory) {
      const previous = out.at(-1);
      if (previous !== undefined && v > curve[previous]) out[out.length - 1] = t;
      continue;
    }
    out.push(t);
  }
  return out;
}

/** 묶음 몇 개를 프레임마다 더해 한 채널로 만든다 */
function channel(
  data: Float32Array,
  bands: number,
  groups: readonly number[],
  count: number,
): Float32Array {
  const out = new Float32Array(count);
  for (let t = 0; t < count; t += 1) {
    let sum = 0;
    for (const g of groups) sum += data[t * bands + g];
    out[t] = sum;
  }
  return out;
}

/** 인자 하나로도 배열로도 받는다 */
function triple(
  value: number | readonly number[] | undefined,
  fallback: readonly number[],
): number[] {
  if (value === undefined) return [...fallback];
  if (typeof value === "number") return [value, value, value];
  return [value[0] ?? fallback[0], value[1] ?? fallback[1], value[2] ?? fallback[2]];
}

/** [from, to) 구간의 평균. 비었으면 null */
function windowMean(curve: Float32Array, from: number, to: number): number | null {
  const lo = Math.max(0, from);
  const hi = Math.min(curve.length, to);
  if (hi <= lo) return null;
  let sum = 0;
  for (let t = lo; t < hi; t += 1) sum += curve[t];
  return sum / (hi - lo);
}

/** [from, to) 구간의 최솟값. 비었으면 0 */
function windowMin(curve: Float32Array, from: number, to: number): number {
  const lo = Math.max(0, from);
  const hi = Math.min(curve.length, to);
  if (hi <= lo) return 0;
  let min = Infinity;
  for (let t = lo; t < hi; t += 1) if (curve[t] < min) min = curve[t];
  return min === Infinity ? 0 : min;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * 진단용 표시값 — 사람이 읽기 좋게 합 1로 정규화한다.
 *
 * **판정은 절대값으로 한다**(위 문턱 표 참조). 여기서 몫으로 바꾸는 것은
 * `DrumHit.bands`에 실어 나갈 때뿐이다 — 곡의 음량과 무관하게 읽히므로
 * 오분류를 훑을 때 눈으로 비교하기 좋다.
 */
function shares(level: readonly number[]): number[] {
  const sum = level.reduce((a, b) => a + b, 0);
  return level.map((v) => Math.round((sum > 0 ? v / sum : 0) * 1000) / 1000);
}

function velocityOf(strength: number): number {
  const scaled = clamp01(strength / VELOCITY_REF);
  return Math.max(1, Math.min(127, Math.round(24 + 103 * scaled)));
}

export function detectDrums(
  samples: Float32Array,
  sampleRate: number,
  options: DetectOptions = {},
  onProgress?: (ratio: number) => void,
): DrumDetection {
  const bandsHz = options.bandsHz ?? BAND_EDGES;
  const features = extractFeatures(samples, sampleRate, onProgress, { fluxBandsHz: bandsHz });
  const { fps, frameCount: count, bandFlux, bandEnergy, fluxBands } = features;

  if (!bandFlux || !bandEnergy || !fluxBands || count === 0) {
    return {
      hits: [],
      fps,
      bandsHz,
      peakCounts: { low: 0, mid: 0, high: 0 },
      rejected: { low: 0, mid: 0, high: 0 },
    };
  }

  const minStrength = triple(options.minStrength, DEFAULT_MIN_STRENGTH);
  const refractoryMs = triple(options.refractoryMs, DEFAULT_REFRACTORY_MS);
  const frame = (ms: number) => Math.max(1, Math.round((ms * fps) / 1000));
  const eps = 1e-12;

  // --- 언제: 로그 플럭스 ---------------------------------------------------
  //
  // 채널마다 따로 정규화한다 — 이동평균 제거가 대역별로 필요하다. 곡 전체를
  // 한 번에 정규화하면 드럼이 쉬는 구간의 잡음이 그대로 봉우리가 된다.
  const low = normalizeOnset(channel(bandFlux, fluxBands, LOW_GROUPS, count), fps);
  const mid = normalizeOnset(channel(bandFlux, fluxBands, MID_GROUPS, count), fps);
  const high = normalizeOnset(channel(bandFlux, fluxBands, HIGH_GROUPS, count), fps);

  const lowPeaks = pickPeaks(low, fps, minStrength[0], refractoryMs[0]);
  const midPeaks = pickPeaks(mid, fps, minStrength[1], refractoryMs[1]);
  const highPeaks = pickPeaks(high, fps, minStrength[2], refractoryMs[2]);

  // --- 무엇: 선형 크기 ------------------------------------------------------
  const brightEnergy = channel(bandEnergy, fluxBands, BRIGHT_GROUPS, count);

  /**
   * 타점의 스펙트럼 모양. **직전 구간의 바닥을 빼고** 합 1로 정규화한다.
   *
   * 바닥을 빼는 것이 핵심이다 — 앞 타점의 잔향과 반주 누설이 그대로 깔려
   * 있어서, 안 빼면 "지금 새로 난 소리"가 아니라 "지금 울리고 있는 것 전부"의
   * 모양이 나온다.
   */
  /**
   * 대역마다의 **전형적 크기.** 흰색으로 만드는 분모다.
   *
   * 이게 없으면 저역이 프로파일을 독식한다 — 위 주석의 실측 참조.
   */
  const reference = new Float64Array(fluxBands);
  {
    const column = new Float64Array(count);
    const at = Math.min(count - 1, Math.floor(count * ENERGY_REFERENCE_PERCENTILE));
    for (let g = 0; g < fluxBands; g += 1) {
      for (let t = 0; t < count; t += 1) column[t] = bandEnergy[t * fluxBands + g];
      reference[g] = Float64Array.from(column).toSorted()[at] || eps;
    }
  }

  /**
   * 타점의 **흰색화된 대역 크기.** 몫이 아니라 절대값을 돌려준다 — 위 주석 참조.
   *
   * 직전 구간의 바닥을 뺀다. 앞 타점의 잔향과 반주 누설이 그대로 깔려 있어서,
   * 안 빼면 "지금 새로 난 소리"가 아니라 "지금 울리고 있는 것 전부"가 나온다.
   */
  const profile = (t: number): { level: number[]; total: number } => {
    const out: number[] = [];
    let sum = 0;
    const from = Math.max(0, t - frame(FLOOR_FROM_MS));
    const to = Math.max(from + 1, t - frame(FLOOR_TO_MS));
    for (let g = 0; g < fluxBands; g += 1) {
      let floor = Infinity;
      for (let k = from; k < to; k += 1) {
        const v = bandEnergy[k * fluxBands + g];
        if (v < floor) floor = v;
      }
      // 직전 바닥을 빼고 — "지금 새로 난 소리"만 남긴다 — 그 대역의 전형적
      // 크기로 나눈다. 단위가 대역마다 같아져야 몫이 뜻을 갖는다.
      const raw = Math.max(0, bandEnergy[t * fluxBands + g] - (floor === Infinity ? 0 : floor));
      const v = raw / reference[g];
      out.push(v);
      sum += v;
    }
    return { level: out, total: sum };
  };

  const energyFloor = ENERGY_FLOOR;

  /**
   * 플럭스 봉우리 `t` 근처에서 **그 채널의 에너지가 가장 큰 프레임.**
   *
   * 위 `ENERGY_PEAK_AHEAD` 주석 참조 — 이걸 안 하면 분류가 통째로 무너진다.
   */
  const energyPeakNear = (t: number, groups: readonly number[]): number => {
    let best = t;
    let bestValue = -Infinity;
    const from = Math.max(0, t - ENERGY_PEAK_BACK);
    const to = Math.min(count - 1, t + ENERGY_PEAK_AHEAD);
    for (let k = from; k <= to; k += 1) {
      let sum = 0;
      for (const g of groups) sum += bandEnergy[k * fluxBands + g];
      if (sum > bestValue) {
        bestValue = sum;
        best = k;
      }
    }
    return best;
  };

  const hits: DrumHit[] = [];
  const rejected = { low: 0, mid: 0, high: 0 };

  // --- 저역 채널 → 킥 -------------------------------------------------------
  for (const t of lowPeaks) {
    const { level: p, total } = profile(energyPeakNear(t, LOW_GROUPS));
    if (total < energyFloor) {
      rejected.low += 1;
      continue;
    }
    const lowLevel = p[0] + p[1];
    const midLevel = p[2] + p[3];
    // 저역이 크기만 한 것으로는 부족하다 — 톰도 4.27이다. **중역을 이겨야** 한다.
    if (lowLevel < KICK_LOW || lowLevel <= midLevel * KICK_DOMINANCE) {
      rejected.low += 1;
      continue;
    }
    // 최저역 몫은 문턱이 아니라 신뢰도로만 쓴다 — 곡마다 갈리기 때문이다.
    const subShare = p[0] / (p[0] + p[1] + p[2] + eps);
    hits.push({
      atSec: t / fps,
      cls: "kick",
      gm: representative("kick"),
      velocity: velocityOf(low[t]),
      confidence: clamp01(0.35 + 0.25 * Math.min(1, lowLevel / (2 * KICK_LOW)) + 0.25 * subShare),
      bands: shares(p),
    });
  }

  // --- 중역 채널 → 스네어 · 톰 ----------------------------------------------
  for (const t of midPeaks) {
    const { level: p, total } = profile(energyPeakNear(t, MID_GROUPS));
    if (total < energyFloor) {
      rejected.mid += 1;
      continue;
    }
    const midLevel = p[2] + p[3];
    const bodyLevel = p[1] + p[2];
    // 막을 때린 소리인가. 이게 없으면 하이햇이 여기에도 걸려 스네어가 된다.
    if (midLevel < MID_LEVEL || bodyLevel < BODY_LEVEL) {
      rejected.mid += 1;
      continue;
    }
    const noiseLevel = p[3] + p[4] + p[5] + p[6];
    const isSnare = noiseLevel >= SNARE_NOISE;
    const cls: DrumClass = isSnare ? "snare" : "tom";
    const margin = Math.abs(noiseLevel - SNARE_NOISE) / SNARE_NOISE;
    hits.push({
      atSec: t / fps,
      cls,
      gm: representative(cls),
      velocity: velocityOf(mid[t]),
      confidence: clamp01(0.4 + 0.6 * Math.min(1, margin)),
      bands: shares(p),
    });
  }

  // --- 고역 채널 → 하이햇 · 오픈 하이햇 · 심벌 -------------------------------
  for (let i = 0; i < highPeaks.length; i += 1) {
    const t = highPeaks[i];
    const peakAt = energyPeakNear(t, BRIGHT_GROUPS);
    const { level: p, total } = profile(peakAt);
    if (total < energyFloor) {
      rejected.high += 1;
      continue;
    }
    const brightLevel = p[5] + p[6];
    // **겹쳤다고 지우지 않는다** — 백비트에서 스네어와 하이햇이 함께 울리는
    // 것이 정상이다. 스네어 잡음은 묶음 4에 몰리고 하이햇은 5~6이 세므로,
    // 몫이 모자라면 그건 스네어의 위쪽 꼬리일 뿐이라고 프로파일이 말해 준다.
    if (brightLevel < BRIGHT_LEVEL) {
      rejected.high += 1;
      continue;
    }

    // 창은 **다음 고역 봉우리에서 잘린다** — 안 그러면 촘촘한 16분 하이햇에서
    // 다음 타점이 창에 들어와 지속음처럼 보인다.
    const next = i + 1 < highPeaks.length ? highPeaks[i + 1] : Infinity;
    const cut = (toMs: number) =>
      Math.min(peakAt + frame(toMs), next === Infinity ? count : next);
    const base = windowMin(
      brightEnergy,
      peakAt - frame(FLOOR_FROM_MS),
      peakAt - frame(FLOOR_TO_MS),
    );
    const peak = Math.max(eps, brightEnergy[peakAt] - base);
    const rel = (mean: number | null) => (mean === null ? 0 : Math.max(0, mean - base) / peak);

    const t1From = peakAt + frame(TAIL1_FROM_MS);
    const t1End = cut(TAIL1_TO_MS);
    const r1 = rel(windowMean(brightEnergy, t1From, t1End));
    const r2 = rel(windowMean(brightEnergy, peakAt + frame(TAIL2_FROM_MS), cut(TAIL2_TO_MS)));
    const truncated = t1End - t1From < frame(MIN_TAIL_MS);

    let cls: DrumClass = "hihat";
    let confidence = 0.5;
    if (truncated) {
      confidence = 0.35;
    } else if (r2 >= CYMBAL_TAIL) {
      cls = "cymbal";
      confidence = clamp01(0.4 + 0.6 * ((r2 - CYMBAL_TAIL) / CYMBAL_TAIL));
    } else if (r1 >= OPEN_TAIL) {
      cls = "hihat-open";
      confidence = clamp01(0.4 + 0.6 * ((r1 - OPEN_TAIL) / OPEN_TAIL));
    } else {
      confidence = clamp01(0.4 + 0.6 * ((OPEN_TAIL - r1) / OPEN_TAIL));
    }

    hits.push({
      atSec: t / fps,
      cls,
      gm: representative(cls),
      velocity: velocityOf(high[t]),
      confidence,
      bands: shares(p),
    });
  }

  hits.sort((a, b) => a.atSec - b.atSec);
  return {
    hits,
    fps,
    bandsHz,
    peakCounts: { low: lowPeaks.length, mid: midPeaks.length, high: highPeaks.length },
    rejected,
  };
}
