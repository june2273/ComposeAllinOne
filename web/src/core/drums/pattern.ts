/**
 * 타점 → 마디 → **반복되는 루프와 필인.**
 *
 * 사양서 §10의 반복 압축을 그대로 쓴다. 그쪽은 코드 심볼 열이 대상이지만
 * 알고리즘의 입력은 **1차원 심볼 열**이면 무엇이든 되고, 드럼이 그 두 번째
 * 사용처다.
 *
 * ```
 * 마디 단위 심볼 열 → 자기상관으로 주기 후보(1·2·4·8) → 편집 거리 클러스터링
 *                  → 거리 1 → A′, 2 → A″  → 섹션과 정렬 → 출력
 * ```
 *
 * ## 필인은 **검출하지 않고 유도한다**
 *
 * 필인 전용 판정기를 따로 만들지 않았다. 위 클러스터링이 끝나면 필인은 공짜로
 * 나온다 — **그 자리의 대표형과 많이 다른 마디**가 필인이다. 거기에 대중음악의
 * 위치 규칙(4·8마디 묶음의 마지막)과 밀도 급증을 증거로 더한다.
 *
 * 전용 판정기를 만들면 "대표형과 다르다"와 "필인이다"가 두 벌의 기준을 갖게
 * 되고, 둘이 어긋나면 표가 자기모순을 보인다.
 *
 * ## 3층 좌표 (사양서 §3)
 *
 * | 층 | 예 | 무엇에 쓰나 |
 * |---|---|---|
 * | 1차 (표시) | `Chorus 2 · 1마디` | 사람이 읽고 기억한다 |
 * | 2차 (보조) | `49마디` | 악보와 대조한다 |
 * | 3차 (내부) | `98.24s` | 재생·탐색 |
 *
 * **못갖춘마디는 0마디다.** 1로 매기면 그 뒤 번호가 통째로 밀려 악보 대조가
 * 어긋난다(`musicxml.ts`·`chords.tsx`와 같은 규칙).
 *
 * ## 격자를 진짜로 import한다
 *
 * `core/analysis`↔`core/transcribe`가 서로를 import하지 않는 것과 달리, 여기서는
 * `quantize`의 격자를 **모양만 맞추지 않고 그대로 쓴다.** `stepAtTime`의 주석이
 * "두 벌 만들지 말 것"을 못박은 자리라, 여기서는 결합보다 중복이 비싸다 —
 * 드럼 5마디와 코드 5마디와 악보 5마디가 갈리면 표를 나란히 놓고 볼 수 없다.
 */

import { type Grid, nearestStep, stepTime } from "../transcribe/quantize";

import { DRUM_CLASSES, type DrumClass } from "./gm";
import type { DrumHit } from "./detect";

/** 찾아볼 주기(마디). 대중음악의 루프는 거의 이 안에 있다 */
const DEFAULT_PERIODS: readonly number[] = [1, 2, 4, 8];

/**
 * 대표형과 이만큼 다르면 **필인**으로 본다. 0~1 (다른 칸의 비율).
 *
 * **추측이다.** 드럼 정답이 하나도 없어서 실곡에서 맞는지 말할 수 없다.
 */
const FILL_DISTANCE = 0.35;
/** 필인이라면 타점이 늘어나는 편이다. 대표형 대비 이 비율을 넘으면 증거로 센다 */
const FILL_DENSITY = 1.3;
/**
 * 필인이 이어질 수 있는 최대 마디 수.
 *
 * **필인은 일회성이고 섹션 변화는 지속된다.** 이것이 둘을 가르는 축이다 —
 * 거리만 보면 "그루브가 통째로 바뀐 여덟 마디"가 여덟 개의 필인으로 잡힌다
 * (실측: 뒤 네 마디를 다른 그루브로 바꾼 시험에서 패턴 `B`가 통째로 사라졌다).
 * 네 마디를 넘게 다른 것은 필인이 아니라 다른 구간이다.
 */
const FILL_MAX_BARS = 2;
/** 같은 패턴군으로 묶는 거리. 이보다 가까우면 같은 A다 */
const SAME_PATTERN = 0.12;
/** `A′`와 `A″`를 가르는 거리 눈금 */
const VARIANT_STEP = 0.18;
/** 타점이 칸 중심에서 이 비율 안에 들면 "격자에 맞았다"로 센다 */
const GRID_TOLERANCE = 0.25;

/**
 * 구간 — **모양만 맞춘다.**
 *
 * `core/analysis/sections`의 `Section`을 import하지 않는다. `OnsetCurve`·
 * `HarmonyMark`와 같은 방식이고, 잇는 것은 위층(`ui/drums.tsx`)의 일이다.
 */
export interface BarSection {
  readonly label: string;
  /** 절대 마디 (포함) */
  readonly fromBar: number;
  /** 절대 마디 (포함) */
  readonly toBar: number;
}

export interface BarPattern {
  /** 절대 마디. 못갖춘마디는 0 */
  readonly bar: number;
  /** 길이 = `stepsPerBeat × beatsPerBar`. 칸마다 그 자리에 있는 어휘들 */
  readonly cells: readonly (readonly DrumClass[])[];
  /** 클러스터링에 쓰는 한 줄 표현. 칸 하나가 글자 하나 */
  readonly symbol: string;
  /** 이 마디의 타점 수 */
  readonly hits: number;
}

export interface DrumPattern {
  /** `A` · `A′` · `A″` · `B` … */
  readonly id: string;
  /** 변형을 뗀 이름. `A′`의 base는 `A` */
  readonly base: string;
  /** 편집 거리에서 나온 변형 차수. 0 = 대표형 (사양서 §10) */
  readonly variant: number;
  /** 이 패턴이 차지하는 마디 수 = 주기 */
  readonly bars: number;
  /** 대표형의 칸. `bars × stepsPerBar` */
  readonly cells: readonly (readonly DrumClass[])[];
  /** 이 패턴군이 곡에서 몇 번 나오나 */
  readonly count: number;
}

export interface LoopSpan {
  readonly patternId: string;
  /** 2차 좌표 — 절대 마디 (둘 다 포함) */
  readonly fromBar: number;
  readonly toBar: number;
  /** 3차 좌표 — 재생용 */
  readonly fromSec: number;
  readonly toSec: number;
  /** 1차 좌표 — 구간이 있을 때만 */
  readonly section?: string;
  readonly barInSection?: number;
  readonly fill: boolean;
  /** 대표형과의 거리 0~1 */
  readonly distance: number;
}

export interface DrumAnalysis {
  readonly bars: readonly BarPattern[];
  readonly patterns: readonly DrumPattern[];
  readonly spans: readonly LoopSpan[];
  /** 위생 지표 — 타점이 칸 가까이에 든 비율. 낮으면 격자를 의심할 자리다 */
  readonly gridHitRatio: number;
  /**
   * 고른 주기.
   *
   * **`margin`이 `null`인 것과 0인 것은 다른 사실이다.** 배수는 경쟁자가
   * 아니므로(2마디 루프는 4·8마디로도 맞는다) 주기가 1이면 경쟁자가 아예 없다 —
   * 그때 0을 적으면 "1등과 2등이 붙었다"로 읽혀 화면이 없는 의심을 만든다.
   * 실제로 그렇게 나왔다(완벽한 1마디 루프에 "확인 필요"가 붙었다).
   *
   * `fit`은 그 주기가 반복을 얼마나 설명하는가다(1 = 완벽).
   */
  readonly period: {
    readonly bars: number;
    readonly margin: number | null;
    readonly fit: number;
  };
  /**
   * 마디 안 **박별 킥 세기** — 다운비트 위상의 증거.
   *
   * 이 저장소가 처음 갖는 위상 증거다. 곡E에서 우리 다운비트와 allin1의 것이
   * 정확히 2박 어긋났는데 **둘 다 기계가 낸 값이라 어느 쪽이 맞는지 몰랐다.**
   * 킥은 J-pop에서 크로마 노벨티보다 훨씬 강한 1박 단서라, 이 히스토그램이
   * 그 논쟁에 제3의 자료를 준다.
   *
   * **여기서 격자를 고치지는 않는다.** 격자는 코드·구조·악보가 함께 쓰는
   * 하나뿐인 좌표계이고, 드럼이 자기 위상을 따로 쓰면 마디 번호가 화면마다
   * 갈린다. 재서 알리는 데까지가 이 값의 일이다.
   */
  readonly kickByBeat: readonly number[];
  /** 타점이 칸 중심에서 벗어난 양의 중앙값(ms). 그루브가 밀렸는지 보인다 */
  readonly medianDeviationMs: number;
}

export interface PatternOptions {
  readonly sections?: readonly BarSection[];
  /** 찾아볼 주기(마디). 기본 `[1, 2, 4, 8]` */
  readonly periods?: readonly number[];
  readonly fillDistance?: number;
}

// --- 마디로 접기 -----------------------------------------------------------------

/** 칸 하나를 글자 하나로. 어휘가 여섯이라 64가지가 한 글자에 들어간다 */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/";

function encodeCell(classes: readonly DrumClass[]): string {
  let mask = 0;
  for (const cls of classes) {
    const bit = DRUM_CLASSES.indexOf(cls);
    if (bit >= 0) mask |= 1 << bit;
  }
  return ALPHABET[mask & 63];
}

/**
 * 절대 마디 번호. **첫 다운비트가 있는 마디가 1마디**이고 그 앞은 0마디다.
 *
 * `chords.tsx`의 `locate`·`musicxml.ts`와 같은 규칙이다 — 갈리면 표를 나란히
 * 놓고 볼 수 없다.
 */
function barOf(step: number, stepsPerBar: number): number {
  return step >= 0 ? Math.floor(step / stepsPerBar) + 1 : 0;
}

/** 두 마디(또는 두 덩어리)가 얼마나 다른가. 0~1 */
function distance(a: string, b: string): number {
  const n = Math.max(a.length, b.length);
  if (n === 0) return 0;
  let differing = 0;
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) differing += 1;
  return differing / n;
}

/** 여럿 중 나머지와 가장 가까운 것 — 대표형 */
function medoid(items: readonly string[]): number {
  let best = 0;
  let bestSum = Infinity;
  for (let i = 0; i < items.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < items.length; j += 1) if (i !== j) sum += distance(items[i], items[j]);
    if (sum < bestSum) {
      bestSum = sum;
      best = i;
    }
  }
  return best;
}

/** `A` `B` … `Z` `AA` … */
function letter(index: number): string {
  let out = "";
  let n = index;
  do {
    out = String.fromCodePoint(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const VARIANT_MARKS = ["", "′", "″"];

export function analyzePattern(
  hits: readonly DrumHit[],
  grid: Grid,
  options: PatternOptions = {},
): DrumAnalysis {
  const stepsPerBar = grid.stepsPerBeat * grid.beatsPerBar;
  const empty: DrumAnalysis = {
    bars: [],
    patterns: [],
    spans: [],
    gridHitRatio: 0,
    period: { bars: 0, margin: null, fit: 0 },
    kickByBeat: [],
    medianDeviationMs: 0,
  };
  if (!grid.times.length || hits.length === 0 || stepsPerBar <= 0) return empty;

  // --- 타점을 칸에 얹는다 --------------------------------------------------
  //
  // **반올림이지 Viterbi가 아니다.** 노래는 박에서 −56~+60ms를 오가서 최적 경로
  // 탐색이 필요했지만(`quantize.ts`), 드럼은 격자를 만드는 쪽이다. 대신 벗어난
  // 양을 재서 위생 지표로 낸다 — 크면 격자를 의심할 자리다.
  const stepSec =
    grid.times.length > 1 ? (grid.times.at(-1)! - grid.times[0]) / (grid.times.length - 1) : 0;
  const deviations: number[] = [];
  let onGrid = 0;

  const perBar = new Map<number, Map<number, Set<DrumClass>>>();
  const kickByBeat: number[] = Array.from({ length: grid.beatsPerBar }, () => 0);
  let lastBar = 0;

  for (const hit of hits) {
    const step = nearestStep(grid, hit.atSec);
    const deviation = hit.atSec - stepTime(grid, step);
    deviations.push(deviation);
    if (stepSec > 0 && Math.abs(deviation) <= stepSec * GRID_TOLERANCE) onGrid += 1;

    const bar = barOf(step, stepsPerBar);
    lastBar = Math.max(lastBar, bar);
    const inBar = ((step % stepsPerBar) + stepsPerBar) % stepsPerBar;
    let cells = perBar.get(bar);
    if (!cells) {
      cells = new Map();
      perBar.set(bar, cells);
    }
    let set = cells.get(inBar);
    if (!set) {
      set = new Set();
      cells.set(inBar, set);
    }
    set.add(hit.cls);

    if (hit.cls === "kick") {
      kickByBeat[Math.floor(inBar / grid.stepsPerBeat) % grid.beatsPerBar] += 1;
    }
  }

  const bars: BarPattern[] = [];
  for (let bar = 0; bar <= lastBar; bar += 1) {
    const cellsMap = perBar.get(bar);
    const cells: DrumClass[][] = [];
    let symbol = "";
    let count = 0;
    for (let i = 0; i < stepsPerBar; i += 1) {
      const set = cellsMap?.get(i);
      // 표시 순서를 어휘 순서로 못박는다 — Set의 삽입 순서를 쓰면 같은 내용의
      // 마디가 다른 심볼을 얻어 클러스터링이 조용히 깨진다.
      const list = set ? DRUM_CLASSES.filter((c) => set.has(c)) : [];
      cells.push(list);
      symbol += encodeCell(list);
      count += list.length;
    }
    bars.push({ bar, cells, symbol, hits: count });
  }

  // --- 주기 찾기 ------------------------------------------------------------
  //
  // 자기상관과 같은 것을 거리로 한다. 주기 P가 맞으면 P마디 떨어진 마디끼리
  // 닮으므로 평균 거리가 낮다.
  const full = bars.filter((b) => b.bar >= 1);
  const periods = (options.periods ?? DEFAULT_PERIODS).filter((p) => p >= 1);
  const scored: { bars: number; distance: number }[] = [];
  for (const p of periods) {
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i + p < full.length; i += 1) {
      sum += distance(full[i].symbol, full[i + p].symbol);
      pairs += 1;
    }
    if (pairs > 0) scored.push({ bars: p, distance: sum / pairs });
  }
  scored.sort((a, b) => a.distance - b.distance || a.bars - b.bars);
  const period = scored[0] ?? { bars: 1, distance: 1 };
  // **배수는 경쟁자가 아니다.** 2마디 루프는 4마디로도 8마디로도 똑같이 맞으므로
  // 그것들을 경쟁자로 세면 마진이 언제나 0이 된다. `relatedTempo`가 ×2를 신뢰도
  // 계산에서 빼는 것, `relatedBar`가 2/4를 4/4의 경쟁자로 안 세는 것과 같은
  // 논리다 — 같은 그리드의 다른 읽기이지 다른 판정이 아니다.
  const rivals = scored.filter((c) => c.bars !== period.bars && c.bars % period.bars !== 0);
  const margin = rivals.length > 0 ? rivals[0].distance - period.distance : null;

  // --- 자리별 대표형과 필인 -------------------------------------------------
  //
  // 대표형은 **같은 자리(주기 안의 몇 번째 마디)끼리** 모아서 뽑는다. 2마디
  // 루프에서 홀수 마디와 짝수 마디는 원래 다르므로, 통째로 모으면 둘이 서로를
  // 필인으로 만든다.
  const phaseOf = (bar: number) => (bar - 1) % period.bars;
  const byPhase = new Map<number, BarPattern[]>();
  for (const b of full) {
    const phase = phaseOf(b.bar);
    const list = byPhase.get(phase);
    if (list) list.push(b);
    else byPhase.set(phase, [b]);
  }
  const representative = new Map<number, BarPattern>();
  for (const [phase, list] of byPhase) representative.set(phase, list[medoid(list.map((b) => b.symbol))]);

  const fillDistance = options.fillDistance ?? FILL_DISTANCE;
  const barInfo = new Map<number, { distance: number; fill: boolean }>();
  const candidates: boolean[] = [];
  for (const b of full) {
    const base = representative.get(phaseOf(b.bar));
    const d = base ? distance(b.symbol, base.symbol) : 0;
    // 필인의 증거 셋. 거리가 문턱을 넘는 것이 필수이고, 나머지 둘은 **위치와
    // 밀도**다 — 사양서 §9.3의 pre-chorus 규칙이 위치를 쓰는 것과 같은 종류다.
    const denser = base ? b.hits > base.hits * FILL_DENSITY : false;
    const atPhraseEnd = b.bar % 4 === 0 || b.bar % 8 === 0;
    candidates.push(d >= fillDistance && (denser || atPhraseEnd));
    barInfo.set(b.bar, { distance: d, fill: false });
  }
  // **이어진 후보가 길면 필인이 아니라 다른 구간이다.** 위 `FILL_MAX_BARS` 참조.
  for (let i = 0; i < candidates.length; ) {
    if (!candidates[i]) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < candidates.length && candidates[end]) end += 1;
    if (end - i <= FILL_MAX_BARS) {
      for (let k = i; k < end; k += 1) {
        const info = barInfo.get(full[k].bar);
        if (info) barInfo.set(full[k].bar, { ...info, fill: true });
      }
    }
    i = end;
  }

  // --- 패턴군 이름 붙이기 ---------------------------------------------------
  //
  // 주기 단위 덩어리를 서로 견줘 `A` · `A′` · `A″` · `B` …로 나눈다.
  const chunks: { fromBar: number; toBar: number; symbol: string }[] = [];
  for (let i = 0; i + period.bars <= full.length; i += period.bars) {
    const slice = full.slice(i, i + period.bars);
    chunks.push({
      fromBar: slice[0].bar,
      toBar: slice.at(-1)!.bar,
      // **필인 마디는 그 자리의 대표형으로 바꿔 넣는다.**
      //
      // 안 그러면 필인 하나가 자기가 든 덩어리 전체의 이름을 바꾼다 — 8마디가
      // 필인이라는 이유로 7마디까지 `B`가 되는 것이 실제로 났다. 7마디는
      // 1·3·5마디와 똑같은데도. 필인은 이미 따로 표시되므로 패턴 이름에서는
      // 빼는 것이 맞고, 사양서 §10의 "불일치 시 **패턴 경계를 신뢰**"도 같은
      // 방향이다.
      symbol: slice
        .map((b) =>
          barInfo.get(b.bar)?.fill
            ? (representative.get(phaseOf(b.bar))?.symbol ?? b.symbol)
            : b.symbol,
        )
        .join(""),
    });
  }

  const assigned = new Map<number, { id: string; base: string; variant: number }>();
  const patterns: DrumPattern[] = [];
  const remaining = new Set(chunks.map((_, i) => i));
  let nextLetter = 0;
  while (remaining.size > 0) {
    // 이웃이 가장 많은 덩어리가 그 패턴군의 대표다
    let seed = -1;
    let bestNeighbours = -1;
    for (const i of remaining) {
      let n = 0;
      for (const j of remaining) if (distance(chunks[i].symbol, chunks[j].symbol) <= SAME_PATTERN) n += 1;
      if (n > bestNeighbours) {
        bestNeighbours = n;
        seed = i;
      }
    }
    if (seed < 0) break;

    const base = letter(nextLetter);
    nextLetter += 1;
    const members: number[] = [];
    // 도는 동안 지우므로 사본이 필요하다
    for (const i of Array.from(remaining)) {
      const d = distance(chunks[i].symbol, chunks[seed].symbol);
      if (d > VARIANT_STEP * (VARIANT_MARKS.length - 1) + SAME_PATTERN) continue;
      const variant = d <= SAME_PATTERN ? 0 : Math.min(VARIANT_MARKS.length - 1, Math.ceil(d / VARIANT_STEP));
      assigned.set(i, { id: base + VARIANT_MARKS[variant], base, variant });
      members.push(i);
      remaining.delete(i);
    }

    const seedBars = full.filter((b) => b.bar >= chunks[seed].fromBar && b.bar <= chunks[seed].toBar);
    patterns.push({
      id: base,
      base,
      variant: 0,
      bars: period.bars,
      cells: seedBars.flatMap((b) => b.cells),
      count: members.length,
    });
  }

  // --- 구간(1차 좌표) -------------------------------------------------------
  const sectionOf = (bar: number): { section?: string; barInSection?: number } => {
    for (const s of options.sections ?? []) {
      if (bar >= s.fromBar && bar <= s.toBar) return { section: s.label, barInSection: bar - s.fromBar + 1 };
    }
    return {};
  };

  // --- 이어지는 같은 것끼리 합친다 ------------------------------------------
  //
  // **필인은 합치지 않는다** — 한 마디짜리로 남아야 목록에서 눈에 띈다.
  const spans: LoopSpan[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const tag = assigned.get(i);
    for (let bar = chunk.fromBar; bar <= chunk.toBar; bar += 1) {
      const info = barInfo.get(bar) ?? { distance: 0, fill: false };
      const id = info.fill ? "필인" : (tag?.id ?? "?");
      const where = sectionOf(bar);
      const previous = spans.at(-1);
      // **구간 경계를 넘어 합치지 않는다.** 합치면 그 구간의 1차 좌표
      // (`Chorus 2 · 1마디`)가 거짓이 된다 — 사양서 §3이 1차를 표시 좌표로
      // 못박은 이상 그 자리가 흔들리면 표 전체를 못 믿는다.
      if (
        previous &&
        previous.patternId === id &&
        !info.fill &&
        !previous.fill &&
        previous.toBar === bar - 1 &&
        previous.section === where.section
      ) {
        spans[spans.length - 1] = {
          ...previous,
          toBar: bar,
          toSec: stepTime(grid, bar * stepsPerBar),
          distance: Math.max(previous.distance, info.distance),
        };
        continue;
      }
      spans.push({
        patternId: id,
        fromBar: bar,
        toBar: bar,
        fromSec: stepTime(grid, (bar - 1) * stepsPerBar),
        toSec: stepTime(grid, bar * stepsPerBar),
        ...where,
        fill: info.fill,
        distance: info.distance,
      });
    }
  }

  const sortedDeviations = deviations.toSorted((a, b) => a - b);
  const medianDeviationMs =
    sortedDeviations.length > 0
      ? Math.round(sortedDeviations[Math.floor(sortedDeviations.length / 2)] * 1000 * 10) / 10
      : 0;

  return {
    bars,
    patterns,
    spans,
    gridHitRatio: hits.length > 0 ? onGrid / hits.length : 0,
    period: {
      bars: period.bars,
      margin: margin === null ? null : Math.round(margin * 1000) / 1000,
      fit: Math.round((1 - period.distance) * 1000) / 1000,
    },
    kickByBeat,
    medianDeviationMs,
  };
}
