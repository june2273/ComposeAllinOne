/**
 * 음표를 박자 격자에 얹는다.
 *
 * **원본 타이밍을 지우지 않는다**(사양서 §9). 양자화는 표기를 위한 것이고,
 * 사람이 실제로 노래한 시각은 `NoteEvent`가 계속 들고 있다. 이 파일은
 * "격자에서 몇 칸인가"만 덧붙인다.
 *
 * ## 격자는 추정 BPM이 아니라 잡힌 비트에서 만든다
 *
 * BPM 하나로 등간격 격자를 그리면 곡이 조금만 흔들려도 뒤로 갈수록 어긋난다
 * (4분 곡에서 0.5% 오차면 마지막이 1.2초 밀린다). `AnalysisReport.beats`는
 * 실제로 잡힌 비트 시각이므로 **비트 사이를 잘게 나누는 쪽**이 훨씬 안전하다.
 * 비트 밖(첫 비트 이전·마지막 비트 이후)만 중앙값 간격으로 늘린다.
 *
 * ## 반올림하지 않는다 — 이 파일의 핵심
 *
 * 음표마다 독립적으로 가장 가까운 칸에 반올림하면 **악보가 통째로 당김음이 된다.**
 * 164BPM에서 16분 칸이 91ms인데 보컬이 50ms만 늦어도 절반이 옆 칸으로 떨어지고,
 * 그 결과가 `점8분쉼표 + 16분음표`의 남발이다(실측: 곡M 커버).
 *
 * 이것은 알려진 문제이고 정석 해법이 있다 — Takeda et al.(2002)이 HMM으로 처음
 * 풀었고 Nakamura et al.(TASLP 2017)의 **메트리컬 HMM**이 표준이 됐다. 요지는
 * 양자화를 반올림이 아니라 **최적 경로 탐색**으로 보는 것이다:
 *
 * ```
 * 국소 비용(타이밍 편차) + 사전 비용(박절 위치의 그럴듯함) → Viterbi
 * ```
 *
 * 여기서는 학습 없이 그 구조만 가져왔다(신경망 계열은 학습 데이터가 필요하다).
 * `analysis/tempo.ts`의 비트 추적, `notes.ts`의 음표 분할과 같은 꼴이다
 * (사양서 §1.9가 파이프라인 전체에 쓰라고 한 그 틀).
 *
 * ## 셋잇단·스윙은 아직 없다
 *
 * 격자가 2분할 고정이다. `MeterEstimate.shuffle`이 이미 셔플을 알려주므로
 * 붙일 자리는 있지만(그때는 칸 위치가 균등하지 않게 된다) v1에서는 뺐다 —
 * 셔플 곡을 넣으면 셋잇단이 16분음표 두 개로 표기된다.
 */

import type { NoteEvent } from "./notes";

/** 한 박을 몇 칸으로 나눌 것인가. 4 = 16분음표 */
export const STEPS_PER_BEAT = 4;

export interface QuantizedNote extends NoteEvent {
  /** 격자 칸 번호(0 = 첫 다운비트). 음수면 못갖춘마디다 */
  readonly startStep: number;
  /** 끝 칸. 항상 `startStep`보다 크다 */
  readonly endStep: number;
}

export interface Grid {
  /** 격자 칸의 시각(초). 오름차순 */
  readonly times: readonly number[];
  /** `times[0]`이 몇 번 칸인가. 첫 다운비트가 0이 되도록 음수일 수 있다 */
  readonly origin: number;
  readonly stepsPerBeat: number;
  readonly beatsPerBar: number;
}

export interface QuantizeInput {
  readonly beats: readonly number[];
  readonly downbeats: readonly number[];
  readonly beatsPerBar: number;
  readonly stepsPerBeat?: number;
}

/**
 * 시각에 따라 달라지는 오프셋. **상수 하나로는 안 된다**(`estimateOffsetCurve`).
 *
 * `atSec`는 오름차순이고 `offsetMs`와 길이가 같다. 사이는 선형 보간하고 양 끝은
 * 끝값을 연장한다.
 */
export interface OffsetCurve {
  readonly atSec: readonly number[];
  readonly offsetMs: readonly number[];
  /** 곡 전체를 한 숫자로 요약한 값. 화면에 띄우는 진단용이다 */
  readonly medianMs: number;
}

export interface QuantizeOptions {
  /**
   * 전체를 이만큼 앞당겨서 본다(밀리초, 양수면 노래가 늦은 것).
   * **상수 오프셋이다** — 곡선을 쓰려면 `curve`를 넘긴다. 둘 다 없으면
   * `estimateOffsetCurve`가 추정한다. 0을 넘기면 보정하지 않는다.
   */
  readonly offsetMs?: number;
  /** 시변 오프셋. `offsetMs`보다 우선한다 */
  readonly curve?: OffsetCurve;
  /** 박절 사전 비용의 무게. 0이면 순수 최근접 반올림으로 돌아간다 */
  readonly metricalWeight?: number;
  /** 16분 자리(레벨 3 이상)에만 더 걸리는 배수. 1이면 예전 동작 */
  readonly fineBoost?: number;
}

// --- 비용 상수 ---------------------------------------------------------------
//
// **평가셋 없이 정한 값들이다.** 합성 신호로 "의도대로 도는가"만 확인했다.
// 실곡 20~30개와 채보 정답이 모이면 여기서 다시 맞출 것 —
// `analysis/meter.ts`·`notes.ts`의 임계값들과 같은 처지다.

/**
 * 타이밍 편차의 기준 크기(밀리초). 이만큼 벗어나면 비용 1이다.
 *
 * 사람이 정박을 노리고 부를 때의 표준편차쯤으로 잡았다. 작게 하면 편차 비용이
 * 급해져 박절 사전이 힘을 잃고(= 반올림에 가까워지고), 크게 하면 진짜 당김음까지
 * 정박으로 끌려온다.
 */
const SIGMA_MS = 45;

/** 편차 비용의 상한. 아주 멀리 벗어난 후보를 무한정 비싸게 만들지 않는다 */
const DEVIATION_CLAMP = 9;

/**
 * 박절 사전 비용의 무게. 편차 비용과 같은 저울에 올라간다.
 *
 * **이것이 "16분 자리는 증거가 뚜렷할 때만 쓴다"를 표현한다.** 임계값이 아니라
 * 저울이므로 편차 비용이 이기면 오프비트에 그대로 남는다 — 진짜 당김음이
 * 정박으로 뭉개지지 않는 이유다.
 */
const METRICAL_WEIGHT = 1.4;

/**
 * 후보로 볼 범위(칸). 관측에서 이보다 먼 칸은 보지 않는다.
 *
 * 1.2면 앞뒤 한 칸씩 + 경계 여유라 후보가 보통 3개, 많아야 4개다.
 * 넓히면 느려지기만 하고 정확도는 오르지 않는다 — 그만큼 벗어난 음표는
 * 편차 비용이 이미 상한에 닿아 있다.
 */
const CANDIDATE_RADIUS = 1.2;

/**
 * 발성 틈이 IOI(다음 음까지의 간격)의 이 비율을 넘어야 쉼표로 적는다.
 *
 * **음가는 발성 길이가 아니라 IOI에서 얻는다** — Nakamura의 note value
 * recognition이 온셋 양자화와 별개 단계인 이유가 이것이다. 사람은 음을 일찍
 * 떼므로 발성 길이를 그대로 적으면 쉼표가 사방에 생긴다. 다음 음이 시작할 때까지가
 * 악보상의 음가이고, 실제로 쉰 자리만 쉼표로 남긴다.
 *
 * 비율로 재는 이유: 같은 100ms 틈이라도 4분음표 뒤에서는 아티큘레이션이고
 * 16분음표 뒤에서는 진짜 쉼표다. 절대 시간만으로는 이 둘을 가를 수 없다.
 */
const REST_RATIO = 0.35;

/**
 * 그래도 이보다 짧은 틈은 쉼표로 보지 않는다(밀리초).
 *
 * 비율만 쓰면 아주 짧은 음표 뒤의 30ms 숨소리가 "IOI의 40%"가 되어 쉼표로
 * 승격된다. 하한이 그것을 막는다.
 */
const REST_FLOOR_MS = 90;

/** 스타카토가 아무리 짧아도 음표 하나는 이 칸 수 이상이다 */
const MIN_STEPS = 1;

// --- 드리프트 곡선 상수 -------------------------------------------------------

/** 슬라이딩 중앙값의 창 크기(박). 한 프레이즈쯤은 덮어야 표본이 모인다 */
const DRIFT_WINDOW_BEATS = 8;

/** 창 안에 이만큼은 있어야 중앙값을 믿는다. 모자라면 전역 오프셋으로 떨어진다 */
const DRIFT_MIN_SAMPLES = 4;

/** 곡선을 쓰려면 음표가 이만큼은 있어야 한다 */
const DRIFT_MIN_NOTES = 12;

/**
 * 편차 표본에서 잘라낼 경계(격자 칸 대비 비율).
 *
 * **진짜 16분음표를 표본에서 뺀다.** 8분 자리에서 정확히 한 칸(16분) 떨어진
 * 음표는 드리프트가 아니라 그 자리의 음표다. 중앙값이 강건하다지만 16분이 많은
 * 곡에서는 곡선이 그쪽으로 끌려간다 — 0.75칸에서 자르면 드리프트(최대 반 칸)는
 * 다 남고 진짜 16분(한 칸)만 빠진다.
 */
const DRIFT_TRIM = 0.75;

/**
 * 곡선이 박당 이보다 빨리 변하지 않는다(밀리초/박).
 *
 * 드리프트는 사람의 박자 감각이 서서히 미끄러지는 것이라 완만하다. 제한이 없으면
 * 곡선이 음표 하나하나의 표현(당김음)까지 따라가서 걷어낼 것이 없어진다.
 */
const DRIFT_MAX_SLOPE_MS_PER_BEAT = 12;

/**
 * 총 보정량의 상한(격자 칸 대비 비율). 반 칸을 넘지 않는다.
 *
 * **전역 오프셋과 똑같은 식별 가능성 문제다**(`estimateOffsetMs` 주석). 한 칸을
 * 통째로 미는 해는 편차 비용이 같아서 구별되지 않고, 그걸 고르면 곡 전체가
 * 16분음표 하나만큼 밀린다. 곡선이라고 예외가 아니다 — 오히려 구간마다 다르게
 * 밀 수 있어 더 위험하다.
 */
const DRIFT_CLAMP = 0.5;

// --- 세분화 사전확률 상수 -----------------------------------------------------

/**
 * 레벨 3 이상(16분 자리)의 박절 비용에 곱하는 배수.
 *
 * **위아래가 둘 다 막혀 있어 크게 잡을 수 없다.** 1.6에서 이렇게 된다(139BPM,
 * `SIGMA_MS`=45 기준):
 *
 * - 16분 자리에 **정확히** 놓인 음: 그 자리 비용 6.7 < 8분으로 끌 때의 8.6 →
 *   **진짜 16분은 살아남는다.** 2를 넘기면 여기서 진다.
 * - 8분에서 70ms 늦은 음(드리프트 잔차): 16분 쪽 7.4 > 8분 쪽 5.2 → 정박으로
 *   돌아온다. 1.1 아래로 내리면 여기서 진다.
 *
 * 이 계산이 곡에 무관한 상한·하한이고, 실곡 정답에서도 그대로 확인됐다 —
 * 배수를 1에서 1.6으로 올리는 동안 **진짜 16분음표를 하나도 더 잃지 않았고**
 * (2개 고정) 16분 자리 오배치만 81→39로 줄었다. 2.0에서는 진짜 16분이 하나
 * 깨지기 시작한다.
 *
 * ## 곡마다 다르게 정하려 했다가 그만뒀다 (실측 2026-08-10)
 *
 * "이 곡이 16분을 얼마나 쓰는가"를 읽어서 배수를 조절하려 했는데, **읽을 수가
 * 없다.** 드리프트를 걷어낸 뒤에도 음표 위치의 산포(정답 대비 표준편차 73ms)가
 * 16분 한 칸(108ms)에 맞먹어서, 자리를 세면 12.9%가 16분 자리로 잡힌다 —
 * 정답은 1%다. IOI 분포로 바꿔 봐도 13.5% 대 3.3%로 같은 이유로 부풀었다.
 * **양자화가 풀려는 바로 그 잡음이 측정을 망친다.**
 *
 * 그래서 곡 하나로는 보정할 수 없는 장치 대신, 위의 곡 무관한 경계 안에서
 * 상수를 쓴다. `QuantizeOptions.fineBoost`로 덮어쓸 수 있으니 평가셋이 모이면
 * 그때 다시 볼 것.
 */
const FINE_BOOST = 1.6;

/** 이 배수가 걸리기 시작하는 박절 레벨(3 = 16분 자리) */
const FINE_LEVEL = 3;

/**
 * 비트열을 잘게 나눈 격자.
 *
 * **첫 다운비트가 0번 칸이다**(사양서 §3의 2차 좌표 — 절대 마디 1의 정의).
 * 그보다 앞에 음이 있으면 못갖춘마디이고 칸 번호가 음수로 나온다.
 */
export function buildGrid(input: QuantizeInput): Grid {
  const stepsPerBeat = input.stepsPerBeat ?? STEPS_PER_BEAT;
  const beats = [...input.beats].sort((a, b) => a - b);
  const beatsPerBar = Math.max(1, input.beatsPerBar);
  if (beats.length < 2) {
    return { times: [], origin: 0, stepsPerBeat, beatsPerBar };
  }

  const times: number[] = [];
  for (let i = 0; i < beats.length - 1; i += 1) {
    const span = beats[i + 1] - beats[i];
    for (let s = 0; s < stepsPerBeat; s += 1) {
      times.push(beats[i] + (span * s) / stepsPerBeat);
    }
  }
  times.push(beats[beats.length - 1]);

  // 비트 바깥. 여기만 등간격이다 — 잡힌 비트가 없으니 달리 근거가 없다.
  const gaps = beats.slice(1).map((b, i) => b - beats[i]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const step = sorted[sorted.length >> 1] / stepsPerBeat;
  // **간격이 0이면 늘리지 않는다.** 같은 시각의 비트가 셋 이상 들어오면 중앙값이
  // 0이 되고, 그러면 아래 `before`가 Infinity가 되어 **탭이 그대로 멈춘다.**
  // 지금 비트 트래커는 프레임 번호를 쓰므로 겹칠 수 없지만, 이 함수는 밖으로
  // 열려 있고 격자 하나 못 늘리는 것과 브라우저가 죽는 것은 값이 다르다.
  if (!(step > 0)) {
    const zero = nearestIndex(times, input.downbeats[0] ?? beats[0]);
    return { times, origin: 0 - zero, stepsPerBeat, beatsPerBar };
  }
  const before = Math.ceil((beats[0] - 0) / step);
  const head: number[] = [];
  for (let i = before; i >= 1; i -= 1) head.push(beats[0] - i * step);
  const tail: number[] = [];
  // 마지막 음표가 격자 밖으로 나가지 않도록 한 마디분을 더 깔아 둔다
  for (let i = 1; i <= stepsPerBeat * beatsPerBar; i += 1) {
    tail.push(times[times.length - 1] + i * step);
  }
  const all = [...head, ...times, ...tail];

  // 첫 다운비트가 0번이 되도록 원점을 옮긴다
  const first = input.downbeats.length ? input.downbeats[0] : beats[0];
  const zero = nearestIndex(all, first);
  // `-zero`로 적으면 zero가 0일 때 -0이 나온다. Object.is에서 0과 다르다
  return { times: all, origin: 0 - zero, stepsPerBeat, beatsPerBar };
}

/**
 * 이 칸이 박절 구조에서 얼마나 "그럴듯한" 자리인가. 0이 가장 그럴듯하다.
 *
 * 다운비트 < 박 < 8분 자리 < 16분 자리 순으로 비싸진다. 음악에서 음표는
 * 강한 박절 위치에 몰려 있으므로(Povel–Essens 계열의 오래된 관찰), 같은 편차라면
 * 강한 자리를 고르는 것이 맞다.
 *
 * **2의 거듭제곱으로 나눠떨어지는 깊이**로 계산하므로 `stepsPerBeat`가 바뀌어도
 * 표를 다시 쓸 필요가 없다.
 */
export function metricalCost(step: number, grid: Grid): number {
  const perBar = grid.stepsPerBeat * grid.beatsPerBar;
  // 마디 안에서의 위치. 못갖춘마디의 음수 칸도 제자리를 찾는다
  const inBar = ((step % perBar) + perBar) % perBar;
  if (inBar === 0) return 0; // 다운비트
  // 박에 떨어지면 1, 8분 자리면 2, 16분 자리면 3…
  let level = 1;
  let unit = grid.stepsPerBeat;
  while (unit >= 1) {
    if (inBar % unit === 0) return level;
    level += 1;
    unit /= 2;
  }
  return level;
}

/** 관측 시각과 후보 칸 사이의 편차 비용. 이차식이라 가까운 쪽이 확실히 유리하다 */
function deviationCost(grid: Grid, step: number, atSec: number): number {
  const deltaMs = (atSec - stepTime(grid, step)) * 1000;
  return Math.min((deltaMs / SIGMA_MS) ** 2, DEVIATION_CLAMP);
}

/** 후보 칸들과 각각의 국소 비용 */
function candidatesFor(
  grid: Grid,
  atSec: number,
  weight: number,
  fineBoost: number,
): { step: number; cost: number }[] {
  const nearest = nearestStep(grid, atSec);
  const span = Math.ceil(CANDIDATE_RADIUS);
  const out: { step: number; cost: number }[] = [];
  for (let d = -span; d <= span; d += 1) {
    const step = nearest + d;
    const level = metricalCost(step, grid);
    // 16분 자리만 더 비싸진다(`FINE_BOOST`)
    const metrical = level >= FINE_LEVEL ? level * fineBoost : level;
    out.push({
      step,
      cost: deviationCost(grid, step, atSec) + weight * metrical,
    });
  }
  return out;
}

/**
 * 노래 전체가 박에서 얼마나 밀려 있는가(밀리초, 양수면 늦음).
 *
 * **보컬은 체계적으로 벗어난다.** 가수의 lag/lead는 표현이자 습관이고, 노래
 * 합성 쪽에서는 "악보 음 시작 ≠ 실제 발성 시작"을 아예 따로 모델링한다. 이걸
 * 먼저 걷어내지 않으면 곡 전체가 당김음으로 적힌다.
 *
 * **중앙값이 아니라 격자 탐색인 이유**: 편차가 칸 크기의 절반을 넘으면 최근접
 * 칸이 옆으로 감겨서(wrap) 편차의 부호가 뒤집힌다. 그 상태의 중앙값은 뜻이 없다.
 * 후보 오프셋마다 전체 비용을 재보는 쪽이 확실하고, 49 × 음표 수라 비용도 없다.
 */
export function estimateOffsetMs(
  notes: readonly NoteEvent[],
  grid: Grid,
  limitMs = 120,
  stepMs = 5,
): number {
  if (!grid.times.length || notes.length < 3) return 0;

  // **탐색 범위를 반 칸 안으로 묶는다.** 한 칸만큼 민 오프셋은 편차 비용이
  // 정확히 같아서(모든 음이 옆 칸에 똑같이 떨어진다) 구별되지 않는데, 그걸
  // 고르면 곡 전체가 16분음표 하나만큼 밀린다 — 노래가 달라진다(실측으로
  // 걸렸다: 125ms 격자에서 +60ms와 −65ms의 비용이 동일했다).
  //
  // 반 칸을 넘는 진짜 랙은 음표 위치만으로는 원리적으로 판별할 수 없다
  // ("60ms 늦은 것"인지 "다음 16분음표에 31ms 이른 것"인지). 남는 편차는
  // 아래 DP의 박절 사전이 흡수한다.
  const half = (medianStepSec(grid.times) * 1000) / 2;
  const limit = Math.min(limitMs, half);

  // 절댓값이 작은 것부터 본다. 비용이 같으면 **덜 미는 쪽**이 이긴다.
  const offsets = [0];
  for (let d = stepMs; d <= limit; d += stepMs) offsets.push(d, -d);

  let best = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const offset of offsets) {
    let total = 0;
    for (const note of notes) {
      const at = note.startSec - offset / 1000;
      // 오프셋을 고르는 데에는 편차만 본다 — 박절 사전까지 넣으면 "전부 정박에
      // 몰아넣는 오프셋"이 이겨서 당김음 곡을 통째로 밀어버린다.
      const nearest = nearestStep(grid, at);
      total += deviationCost(grid, nearest, at);
    }
    if (total < bestCost) {
      bestCost = total;
      best = offset;
    }
  }
  return best;
}

/**
 * 노래가 박에서 밀린 양의 **곡선**. 상수 하나가 아니다.
 *
 * ## 왜 상수로는 안 되는가 (실측 2026-08-10)
 *
 * 첫 실곡 정답 대조에서 드러났다. 139BPM 커버를 40박 창마다 재니 "최근접 8분
 * 자리까지의 부호 있는 거리" 중앙값이 **−56ms에서 +60ms 사이를 오갔다** —
 * 구간마다 방향까지 뒤집힌다. 16분 한 칸이 108ms이므로 이 스윙만으로 음표가
 * 옆 칸으로 넘어간다. 상수 오프셋으로 걷고 최근접 반올림을 하면 **자리 일치가
 * 49%뿐이었고**, 어긋난 것의 대부분(75/97)이 정박·8분에서 16분 자리로 밀린
 * 것이었다. 점8분쉼표와 16분음표가 난무하던 원인이다.
 *
 * 문헌에서는 이것을 **클록 드리프트**로 다룬다 — Cemgil & Kappen(JAIR 2003)이
 * 템포 곡선과 양자화를 함께 풀었고, Nakamura et al.(TASLP 2017)의 메트리컬
 * HMM에도 드리프트 변수가 들어 있다. 우리가 뺐던 부분이다.
 *
 * ## 8분 자리를 기준으로 잰다
 *
 * 16분 격자에 대고 재면 곡선이 16분 이탈까지 따라가서 **걷어낼 대상이 사라진다**
 * (드리프트를 재려다 드리프트의 정의를 지우는 꼴이다). 8분 자리는 정박과
 * 오프비트를 모두 포함하므로 진짜 당김음도 편차 0으로 잡힌다.
 *
 * 세 겹의 안전장치가 붙는다 — 표본 잘라내기(`DRIFT_TRIM`), 기울기 제한
 * (`DRIFT_MAX_SLOPE_MS_PER_BEAT`), 총량 상한(`DRIFT_CLAMP`).
 */
export function estimateOffsetCurve(
  notes: readonly NoteEvent[],
  grid: Grid,
): OffsetCurve {
  const constant = (ms: number): OffsetCurve => ({
    atSec: [],
    offsetMs: [],
    medianMs: ms,
  });
  if (!grid.times.length || !notes.length) return constant(0);

  const global = estimateOffsetMs(notes, grid);
  const stepMs = medianStepSec(grid.times) * 1000;
  if (notes.length < DRIFT_MIN_NOTES || !(stepMs > 0)) return constant(global);

  // 8분 자리는 격자 두 칸마다다(`stepsPerBeat`=4). 격자가 이미 8분이면 한 칸
  const perEighth = Math.max(1, Math.round(grid.stepsPerBeat / 2));
  const beatSec = (stepMs * grid.stepsPerBeat) / 1000;
  const halfWindow = (DRIFT_WINDOW_BEATS * beatSec) / 2;

  // 표본: 8분 자리에서 벗어난 양. 진짜 16분(한 칸)은 잘라낸다
  const sampleAt: number[] = [];
  const sampleMs: number[] = [];
  for (const note of notes) {
    const position = stepAtTime(grid, note.startSec);
    const eighth = Math.round(position / perEighth) * perEighth;
    const deviation = (note.startSec - stepTime(grid, eighth)) * 1000;
    if (Math.abs(deviation) > DRIFT_TRIM * stepMs) continue;
    sampleAt.push(note.startSec);
    sampleMs.push(deviation);
  }

  // 창마다 중앙값. 표본이 모자란 창은 전역 오프셋으로 떨어진다
  const atSec = notes.map((n) => n.startSec);
  const offsetMs = atSec.map((at) => {
    const window: number[] = [];
    for (let i = 0; i < sampleAt.length; i += 1) {
      if (sampleAt[i] < at - halfWindow) continue;
      if (sampleAt[i] > at + halfWindow) break;
      window.push(sampleMs[i]);
    }
    if (window.length < DRIFT_MIN_SAMPLES) return global;
    window.sort((a, b) => a - b);
    return window[window.length >> 1];
  });

  limitSlope(atSec, offsetMs, beatSec);
  const cap = DRIFT_CLAMP * stepMs;
  for (let i = 0; i < offsetMs.length; i += 1) {
    offsetMs[i] = Math.max(-cap, Math.min(cap, offsetMs[i]));
  }

  const sorted = [...offsetMs].sort((a, b) => a - b);
  return { atSec, offsetMs, medianMs: sorted[sorted.length >> 1] };
}

/**
 * 곡선이 너무 빨리 꺾이지 않게 한다 — 앞뒤로 한 번씩 훑는다.
 *
 * 한 방향만 훑으면 뒤쪽 값이 앞쪽을 끌어내리지 못해 계단이 남는다.
 */
function limitSlope(atSec: readonly number[], ms: number[], beatSec: number): void {
  if (!(beatSec > 0)) return;
  const cap = (from: number, to: number) =>
    DRIFT_MAX_SLOPE_MS_PER_BEAT * (Math.abs(to - from) / beatSec);
  for (let i = 1; i < ms.length; i += 1) {
    const limit = cap(atSec[i - 1], atSec[i]);
    ms[i] = Math.max(ms[i - 1] - limit, Math.min(ms[i - 1] + limit, ms[i]));
  }
  for (let i = ms.length - 2; i >= 0; i -= 1) {
    const limit = cap(atSec[i], atSec[i + 1]);
    ms[i] = Math.max(ms[i + 1] - limit, Math.min(ms[i + 1] + limit, ms[i]));
  }
}

/** 이 시각에서의 오프셋(밀리초). 사이는 선형 보간, 밖은 끝값 */
export function offsetAtMs(curve: OffsetCurve, atSec: number): number {
  const { atSec: xs, offsetMs: ys } = curve;
  if (!xs.length) return curve.medianMs;
  if (atSec <= xs[0]) return ys[0];
  const last = xs.length - 1;
  if (atSec >= xs[last]) return ys[last];
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (xs[mid] <= atSec) low = mid;
    else high = mid;
  }
  const span = xs[high] - xs[low];
  if (!(span > 0)) return ys[low];
  return ys[low] + ((ys[high] - ys[low]) * (atSec - xs[low])) / span;
}

/** 격자 한 칸의 대표 길이(초). 변속이 있어도 흔들리지 않게 중앙값을 쓴다 */
function medianStepSec(times: readonly number[]): number {
  if (times.length < 2) return 0;
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

/**
 * 음표를 격자에 얹는다. **반올림이 아니라 DP다**(파일 첫 주석).
 *
 * 두 단계로 나뉜다.
 *
 * 1. **온셋** — 후보 칸들 위에서 Viterbi. 국소 비용은 타이밍 편차 + 박절 사전,
 *    전이는 "칸 번호가 늘어야 한다"(단선율이므로 겹칠 수 없다).
 * 2. **음가** — 다음 음 시작까지를 음가로 하고(IOI), 실제로 쉰 자리만 쉼표로
 *    남긴다(`REST_RATIO`).
 *
 * 입력은 시간순이고 겹치지 않아야 한다 — `segmentNotes`의 결과가 그렇다.
 */
export function quantizeNotes(
  notes: readonly NoteEvent[],
  grid: Grid,
  options: QuantizeOptions = {},
): QuantizedNote[] {
  if (!grid.times.length || !notes.length) return [];
  const weight = options.metricalWeight ?? METRICAL_WEIGHT;
  const curve =
    options.curve ??
    (options.offsetMs === undefined
      ? estimateOffsetCurve(notes, grid)
      : { atSec: [], offsetMs: [], medianMs: options.offsetMs });
  const fineBoost = options.fineBoost ?? FINE_BOOST;

  // 음표마다 자기 시각의 오프셋을 걷는다 — 여기가 상수 오프셋과 갈리는 지점이다
  const shifted = notes.map((n) => n.startSec - offsetAtMs(curve, n.startSec) / 1000);
  const starts = viterbiOnsets(shifted, grid, weight, fineBoost);
  return withDurations(notes, grid, starts, curve);
}

/**
 * 온셋 양자화 — 후보 칸 위의 최적 경로.
 *
 * 상태 수가 음표당 3~4개뿐이라 제곱 루프를 그대로 쓴다. `notes.ts`처럼 상수
 * 전이 비용의 트릭을 쓸 수 없는데, 전이가 비용이 아니라 **제약**(순증가)이라
 * 후보마다 허용 범위가 다르기 때문이다. 후보가 적으니 그럴 필요도 없다.
 */
function viterbiOnsets(
  starts: readonly number[],
  grid: Grid,
  weight: number,
  fineBoost: number,
): number[] {
  const lattice = starts.map((at) => candidatesFor(grid, at, weight, fineBoost));

  const total: number[][] = [];
  const back: number[][] = [];
  for (let i = 0; i < lattice.length; i += 1) {
    const row = lattice[i];
    total.push(Array.from<number>({ length: row.length }).fill(Number.POSITIVE_INFINITY));
    back.push(Array.from<number>({ length: row.length }).fill(-1));
    for (let j = 0; j < row.length; j += 1) {
      if (i === 0) {
        total[0][j] = row[j].cost;
        continue;
      }
      const previous = lattice[i - 1];
      for (let k = 0; k < previous.length; k += 1) {
        // 앞 음표보다 최소 한 칸 뒤여야 한다. 단선율이라 겹칠 수 없다
        if (previous[k].step + MIN_STEPS > row[j].step) continue;
        const value = total[i - 1][k];
        if (value + row[j].cost < total[i][j]) {
          total[i][j] = value + row[j].cost;
          back[i][j] = k;
        }
      }
    }
    // 어느 후보도 앞 음표 뒤에 설 수 없으면(빠른 연속) 경로가 끊긴다.
    // 그때는 제약을 풀고 앞 음표 바로 다음 칸으로 밀어 넣는다.
    if (total[i].every((v) => !Number.isFinite(v))) {
      let bestPrev = 0;
      for (let k = 1; k < total[i - 1].length; k += 1) {
        if (total[i - 1][k] < total[i - 1][bestPrev]) bestPrev = k;
      }
      const forced = lattice[i - 1][bestPrev].step + MIN_STEPS;
      lattice[i] = [{ step: forced, cost: DEVIATION_CLAMP }];
      total[i] = [total[i - 1][bestPrev] + DEVIATION_CLAMP];
      back[i] = [bestPrev];
    }
  }

  const last = lattice.length - 1;
  let pick = 0;
  for (let j = 1; j < total[last].length; j += 1) {
    if (total[last][j] < total[last][pick]) pick = j;
  }
  const steps = Array.from<number>({ length: lattice.length });
  for (let i = last; i >= 0; i -= 1) {
    steps[i] = lattice[i][pick].step;
    pick = back[i][pick];
    if (pick < 0) pick = 0;
  }
  return steps;
}

/**
 * 음가를 정한다 — **IOI가 기본이고 쉼표는 예외다**(`REST_RATIO` 주석).
 *
 * 판정은 양자화 전의 실제 시각으로 한다. 실제로 쉬었는가는 노래한 시각만이 알고,
 * 악보에 남는 것은 칸이다.
 */
function withDurations(
  notes: readonly NoteEvent[],
  grid: Grid,
  starts: readonly number[],
  curve: OffsetCurve,
): QuantizedNote[] {
  return notes.map((note, i) => {
    const startStep = starts[i];
    // 끝 시각도 **그 음표가 시작한 자리의** 오프셋으로 본다. 끝 시각의 오프셋을
    // 따로 쓰면 긴 음표에서 시작과 끝이 다른 기준으로 재져 길이가 왜곡된다
    const shift = offsetAtMs(curve, note.startSec) / 1000;
    const next = notes[i + 1];
    if (!next) {
      // 마지막 음표만 발성 길이를 쓴다. 뒤에 IOI가 없다
      const sung = nearestIndex(grid.times, note.endSec - shift) + grid.origin;
      return { ...note, startStep, endStep: Math.max(startStep + MIN_STEPS, sung) };
    }

    const limit = starts[i + 1];
    const gapMs = (next.startSec - note.endSec) * 1000;
    const ioiMs = (next.startSec - note.startSec) * 1000;
    const rested = gapMs >= REST_FLOOR_MS && gapMs >= ioiMs * REST_RATIO;
    if (!rested) {
      return { ...note, startStep, endStep: Math.max(startStep + MIN_STEPS, limit) };
    }
    // 쉰 자리다. 발성이 끝난 칸까지만 늘리되 다음 음표를 침범하지 않는다
    const sung = nearestIndex(grid.times, note.endSec - shift) + grid.origin;
    const endStep = Math.min(limit, Math.max(startStep + MIN_STEPS, sung));
    return { ...note, startStep, endStep };
  });
}

/**
 * 시각(초) → **가장 가까운** 칸 번호(정수).
 *
 * `stepAtTime`(아래)과 헷갈리지 말 것 — 그쪽은 칸 사이 어디쯤인지를 소수로
 * 돌려준다. 여기는 반올림이라 "악보의 어느 자리인가"에 답한다. 드리프트를
 * 재는 데 이걸 쓰면 재려던 편차가 반올림에 먹힌다.
 *
 * 격자 밖의 시각은 양 끝 칸으로 눌린다.
 */
export function nearestStep(grid: Grid, atSec: number): number {
  if (!grid.times.length) return grid.origin;
  return nearestIndex(grid.times, atSec) + grid.origin;
}

/** 칸 번호 → 시각(초). 격자 밖은 양 끝 간격을 연장한다. */
export function stepTime(grid: Grid, step: number): number {
  const index = step - grid.origin;
  const times = grid.times;
  if (!times.length) return 0;
  if (index <= 0) {
    const unit = times.length > 1 ? times[1] - times[0] : 0;
    return times[0] + index * unit;
  }
  if (index >= times.length) {
    const last = times.length - 1;
    const unit = times.length > 1 ? times[last] - times[last - 1] : 0;
    return times[last] + (index - last) * unit;
  }
  return times[index];
}

/**
 * 시각 → **소수점이 있는** 칸 번호. `stepTime`의 역함수다.
 *
 * 드리프트를 재려면 "몇 번 칸에 가까운가"가 아니라 "칸 사이 어디쯤인가"가
 * 필요하다 — 반올림해 버리면 재려던 편차가 사라진다.
 *
 * **밖으로 열어 둔 것은 `svp.ts` 때문이다.** 신스V의 시간 단위(blick)는 박에
 * 매여 있어서 초를 그대로 쓸 수 없고, 피치 컨트롤 점을 옮기려면 이 사상이
 * 필요하다. **두 벌을 만들면 안 된다** — 격자 안은 비트 사이 선형 보간이고
 * 밖은 끝 간격 연장이라, 따로 구현하면 곡 끝에서 조용히 어긋난다.
 */
export function stepAtTime(grid: Grid, at: number): number {
  const times = grid.times;
  if (times.length < 2) return grid.origin;
  const last = times.length - 1;
  if (at <= times[0]) {
    const unit = times[1] - times[0];
    return grid.origin + (unit > 0 ? (at - times[0]) / unit : 0);
  }
  if (at >= times[last]) {
    const unit = times[last] - times[last - 1];
    return grid.origin + last + (unit > 0 ? (at - times[last]) / unit : 0);
  }
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (times[mid] <= at) low = mid;
    else high = mid;
  }
  const span = times[high] - times[low];
  return grid.origin + low + (span > 0 ? (at - times[low]) / span : 0);
}

/** 이 시각에 가장 가까운 칸의 색인. 이분 탐색이라 긴 곡에서도 싸다. */
function nearestIndex(times: readonly number[], at: number): number {
  let low = 0;
  let high = times.length - 1;
  if (at <= times[low]) return low;
  if (at >= times[high]) return high;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (times[mid] <= at) low = mid;
    else high = mid;
  }
  return at - times[low] <= times[high] - at ? low : high;
}
