/**
 * 섹션 — 사이드카가 준 구간을 **우리 마디 격자에 얹고 다시 라벨을 붙인다.**
 *
 * ```
 * allin1 segments[{start,end,label}]  ← 학습된 모델. 신호만 낸다
 *        ↓ [센티널 제거]
 *        ↓ [다운비트 스냅]      우리 격자 위의 마디 번호가 여기서 생긴다
 *        ↓ [pre-chorus 재라벨]  ← **모델이 원리적으로 못 내는 것**
 *        ↓ [같은 라벨 병합]     ← **반드시 재라벨 뒤에** (아래)
 *        ↓ [번호 매기기]
 * Section[]  → 사양서 §3의 1차 좌표 `(Chorus 2, 3마디)`
 * ```
 *
 * ## 병합은 재라벨 **뒤**여야 한다 (실측 2026-08-12, 곡E)
 *
 * allin1은 구간을 **8마디 블록 단위로 끊어 내보낸다** — 실측에서 13.24초짜리
 * 조각이 줄줄이 나왔고(146BPM 4/4의 8마디가 정확히 그 값이다) `chorus`가 늘
 * 둘씩 붙어 있었다. 그러니 이어진 같은 라벨을 그대로 표에 올리면 `Chorus 1`과
 * `Chorus 2`가 사실은 한 후렴이 된다.
 *
 * 그렇다고 **먼저** 합치면 안 된다. pre-chorus 규칙이 보는 것이 바로 그
 * "사비 직전의 짧은 구간"인데, 합치고 나면 그 경계가 사라져 규칙이 통째로
 * 죽는다(먼저 합치는 판을 만들었다가 테스트에서 걸렸다). **순서가 곧 규칙이다.**
 *
 * ## 왜 재라벨이 필요한가
 *
 * All-In-One의 라벨 집합에 **pre-chorus가 없다**(사양서 §9.3):
 *
 * ```
 * ['start','end','intro','outro','break','bridge','inst','solo','verse','chorus']
 * ```
 *
 * J-pop의 B멜로는 독립적이고 중요한 섹션인데 대응이 없어 `verse`나 `bridge`로
 * 뭉개진다. 모델을 바꿔서 될 일이 아니라 **학습 데이터(Harmonix)의 어휘 자체가
 * 그렇다.** 사양서가 권한 대응 순서의 첫째가 "후처리 재라벨링 — B멜로는 '사비
 * 직전 8마디 내외'라는 위치 규칙이 강해 규칙 기반으로 꽤 잡힌다"이고, 이 파일이
 * 그것이다.
 *
 * ## 층
 *
 * **여기는 순수 함수다.** DSP도 HTTP도 모르고, 손으로 쓴 배열만으로 테스트가
 * 돈다. 사이드카는 신호만 내보내고 음악적 판단은 `core/`가 한다는 규칙의 자리 —
 * GAME 실험에서 경계만 모델에서 받고 음고 판단은 core에 남긴 것과 같다.
 *
 * `RawSegment`는 사이드카의 타입을 import한 것이 아니라 **모양만 맞춘 것**이다
 * (`extractOnsetCurve` ↔ `OnsetCurve`와 같은 자리). 잇는 것은 위층의 일이다.
 */

/**
 * 화면에 그대로 나가는 값이다. **번역표를 두지 않는다** — 내부 값과 표시가
 * 갈리면 어느 쪽이 정답인지가 코드와 화면 사이에서 흔들린다.
 */
export type SectionLabel =
  | "intro"
  | "verse"
  | "pre-chorus"
  | "chorus"
  | "bridge"
  | "inst"
  | "solo"
  | "break"
  | "outro"
  | "unknown";

/** 사이드카가 준 것 그대로. 초 단위 */
export interface RawSegment {
  readonly start: number;
  readonly end: number;
  readonly label: string;
}

export interface Section {
  readonly index: number;
  readonly label: SectionLabel;
  /** 모델이 준 원래 라벨. 재라벨을 되짚을 수 있어야 한다 */
  readonly sourceLabel: string;
  /** 같은 라벨 중 몇 번째인가. `Chorus 2`의 2 */
  readonly repeat: number;
  /**
   * `[시작, 끝)` 마디 인덱스. 0부터이고 `downbeats`의 인덱스와 같다.
   * **다운비트가 없으면 `null`이다** — 마디를 모르는 채로 0을 적으면 거짓말이 된다.
   */
  readonly bars: readonly [number, number] | null;
  readonly time: readonly [number, number];
  /** 사람이 읽을 근거. 손대지 않은 구간은 빈 문자열이다 */
  readonly reason: string;
}

export interface SectionOptions {
  /** pre-chorus로 볼 최소 길이(마디) */
  readonly preChorusMinBars?: number;
  /** 최대 길이(마디). 사양서 §9.3의 "사비 직전 8마디 내외" */
  readonly preChorusMaxBars?: number;
  /** 앞 구간 대비 이 비율보다 짧아야 pre-chorus로 본다 */
  readonly preChorusRatio?: number;
}

/**
 * **정답이 없어서 정한 추측값 셋이다.** 이 저장소는 정답 없이 맞춘 문턱을 두 번
 * 되돌렸다(`merge_voicing`, GAME). `evalset`에 섹션 정답이 붙기 전에는 손대지
 * 않는다 — 지금 이 값들이 보증하는 것은 "규칙이 의도대로 도는가"까지다.
 */
const PRECHORUS_MIN_BARS = 2;
const PRECHORUS_MAX_BARS = 8;
const PRECHORUS_RATIO = 0.75;

/** Harmonix 라벨 → 우리 라벨. `start`·`end`는 센티널이라 여기 없다 */
const LABEL_MAP: Readonly<Record<string, SectionLabel>> = {
  intro: "intro",
  verse: "verse",
  chorus: "chorus",
  bridge: "bridge",
  inst: "inst",
  solo: "solo",
  break: "break",
  outro: "outro",
};

/** 이 라벨이 붙어 있던 구간만 pre-chorus가 될 수 있다 */
const PRECHORUS_FROM: ReadonlySet<SectionLabel> = new Set<SectionLabel>([
  "verse",
  "bridge",
  "break",
]);

/**
 * 사이드카의 구간을 우리 마디 격자 위의 섹션으로 바꾼다.
 *
 * `downbeats`가 비어 있어도 동작한다 — 그때는 마디를 모르므로 `bars`가 `null`이고
 * pre-chorus 재라벨도 걸지 않는다(길이 규칙이 마디 단위라 잴 수가 없다).
 */
export function sectionsFromSegments(
  segments: readonly RawSegment[],
  downbeats: readonly number[],
  durationSec: number,
  options: SectionOptions = {},
): readonly Section[] {
  const cleaned = dropSentinels(segments);
  if (cleaned.length === 0) return [];

  const grid = makeGrid(downbeats, durationSec);
  const snapped = grid ? snapToGrid(cleaned, grid) : withoutGrid(cleaned);
  return number(mergeAdjacent(relabelPreChorus(snapped, options)));
}

/**
 * 시각이 어느 섹션의 몇 마디째인가. **사양서 §3의 1차 좌표다.**
 *
 * `bar`는 섹션 안에서 1부터 센다. 마디 격자가 없으면 `bar`는 `null`이다.
 */
export function locate(
  sections: readonly Section[],
  timeSec: number,
  downbeats: readonly number[] = [],
): { label: SectionLabel; repeat: number; bar: number | null } | null {
  const hit = sections.find((s) => timeSec >= s.time[0] && timeSec < s.time[1]);
  if (!hit) return null;
  if (!hit.bars || downbeats.length === 0) {
    return { label: hit.label, repeat: hit.repeat, bar: null };
  }
  let bar = 1;
  for (let i = hit.bars[0]; i < hit.bars[1]; i += 1) {
    if (downbeats[i] !== undefined && timeSec >= downbeats[i]) bar = i - hit.bars[0] + 1;
  }
  return { label: hit.label, repeat: hit.repeat, bar };
}

// --- 단계 -----------------------------------------------------------------------

/** 번호가 붙기 전의 구간. `relabelPreChorus`를 따로 테스트하려고 내보낸다 */
export interface StagedSection {
  readonly label: SectionLabel;
  readonly sourceLabel: string;
  readonly bars: readonly [number, number] | null;
  readonly time: readonly [number, number];
  readonly reason: string;
}

/**
 * `start`·`end`는 곡의 시작·끝을 가리키는 센티널이지 구간이 아니다. 길이가
 * 없거나 뒤집힌 것도 여기서 버린다.
 */
function dropSentinels(segments: readonly RawSegment[]): readonly RawSegment[] {
  return segments
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .filter((s) => s.label !== "start" && s.label !== "end")
    .slice()
    .sort((a, b) => a.start - b.start);
}

/**
 * 마디 경계 후보. **곡 끝을 한 칸 더 둔다** — 마지막 구간의 끝은 다운비트가
 * 아니라 곡의 끝이고, 그 자리가 없으면 마지막 섹션이 한 마디 짧게 잘린다.
 */
function makeGrid(downbeats: readonly number[], durationSec: number): number[] | null {
  if (downbeats.length < 2) return null;
  const grid = downbeats.slice();
  const last = grid[grid.length - 1];
  if (durationSec > last) grid.push(durationSec);
  return grid;
}

/**
 * 경계를 가장 가까운 다운비트로 옮긴다. **이 스냅이 있어야 마디 좌표가 생긴다.**
 *
 * allin1은 자기 다운비트로 구간을 잘랐고 우리는 우리 것으로 격자를 만들었으므로
 * 둘이 조금 어긋난다. 많이 옮겼다면 그것은 오차가 아니라 **정보**라 `reason`에
 * 남긴다 — 곡 전체에서 이 값이 한 방향으로 몰리면 우리 다운비트 위상이 밀린
 * 것이다(`meter.ts`가 전역 위상 하나로 다운비트를 놓는다).
 *
 * **문턱이 반 마디가 아니라 4분의 1인 이유**(실측): 격자가 고르면 가장 가까운
 * 칸까지의 거리는 **정의상 반 마디를 넘을 수 없다.** 반 마디로 두면 이 줄은
 * 영영 안 나오는 죽은 코드가 된다. 4/4에서 4분의 1 마디는 한 박이고, "모델의
 * 경계가 우리 다운비트에서 한 박 떨어져 있었다"는 볼 값이 있는 사실이다.
 */
function snapToGrid(segments: readonly RawSegment[], grid: readonly number[]): StagedSection[] {
  const tolerance = medianSpan(grid) / 4;
  const out: StagedSection[] = [];
  for (const segment of segments) {
    const from = nearest(grid, segment.start);
    const to = nearest(grid, segment.end);
    if (to <= from) continue; // 스냅하고 나니 길이가 0마디 — 격자보다 짧은 구간이다
    const drift = Math.abs(grid[from] - segment.start);
    out.push({
      label: LABEL_MAP[segment.label] ?? "unknown",
      sourceLabel: segment.label,
      bars: [from, to],
      time: [grid[from], grid[to]],
      reason:
        tolerance > 0 && drift > tolerance ? `경계를 ${Math.round(drift * 1000)}ms 옮김` : "",
    });
  }

  // **못갖춘마디를 잘라 먹지 않는다** (실측 2026-08-12, 곡E).
  //
  // 곡이 1.1초에 시작하는데 우리 첫 다운비트가 4.8초라 인트로가 3.7초 늦게
  // 시작한다고 적혔다. 그 3.7초는 진짜 음악이고 — allin1은 비음악 구간을
  // `start` 센티널로 따로 표시하므로 그것도 아니다 — 표가 시간을 틀리게
  // 말하는 셈이었다.
  //
  // **마디 번호는 안 건드린다.** 1마디는 첫 다운비트에 있는 것이 맞고
  // (사양서 §3의 못갖춘마디는 0마디다), 여기서 고치는 것은 **시각**뿐이다.
  const first = out[0];
  const start = segments[0]?.start;
  if (first && start !== undefined && start < first.time[0]) {
    out[0] = {
      ...first,
      time: [start, first.time[1]],
      // 근거를 갈아 끼운다 — 여기서 일어난 일은 "경계를 옮겼다"가 아니라
      // "첫 마디 앞에 음악이 있다"이다
      reason: `못갖춘마디 ${Math.round((first.time[0] - start) * 1000)}ms`,
    };
  }
  return out;
}

/** 다운비트가 없을 때. 시각은 그대로 두고 마디만 모른다고 말한다 */
function withoutGrid(segments: readonly RawSegment[]): StagedSection[] {
  return segments.map((segment) => ({
    label: LABEL_MAP[segment.label] ?? "unknown",
    sourceLabel: segment.label,
    bars: null,
    time: [segment.start, segment.end] as const,
    reason: "",
  }));
}

/**
 * **사비 직전 구간을 pre-chorus로 바꾼다** (사양서 §9.3의 위치 규칙).
 *
 * 조건 넷을 모두 만족해야 한다. 하나라도 빠지면 그냥 둔다 — 근거 없이 라벨을
 * 채우면 표가 거짓말을 한다.
 *
 * **긴 verse를 쪼개지는 않는다.** allin1이 A멜로와 B멜로를 한 덩어리로 뭉쳐
 * 놓았다면 그것을 가르는 데는 경계의 증거(노벨티)가 필요하고, 그건 이 파일이
 * 가진 것이 아니다. 못 가른 것은 `verse`로 남긴다.
 *
 * **실측(곡E)에서 이 규칙이 걸리는 자리와 놓치는 자리가 한 곡에 다 나왔다.**
 * 1절은 모델이 `verse`(8마디) + `verse`(8마디) + `chorus`로 끊어 줘서 가운데가
 * pre-chorus가 되고, 2절은 같은 자리를 `verse`(16마디) 한 덩어리로 내보내
 * 놓친다. **이 비대칭이 지금 이 층의 한계를 그대로 보여준다** — 정답이 붙으면
 * 이 곡이 첫 시험 사례다.
 */
export function relabelPreChorus(
  sections: readonly StagedSection[],
  options: SectionOptions = {},
): StagedSection[] {
  const minBars = options.preChorusMinBars ?? PRECHORUS_MIN_BARS;
  const maxBars = options.preChorusMaxBars ?? PRECHORUS_MAX_BARS;
  const ratio = options.preChorusRatio ?? PRECHORUS_RATIO;

  const out = sections.slice();
  for (let i = 1; i < out.length; i += 1) {
    if (out[i].label !== "chorus") continue;
    const candidate = out[i - 1];
    if (!PRECHORUS_FROM.has(candidate.label) || !candidate.bars) continue;

    const length = candidate.bars[1] - candidate.bars[0];
    if (length < minBars || length > maxBars) continue;

    // 앞이 없으면 "절 → 프리코러스 → 사비"라는 모양의 증거가 하나도 없다
    const before = out[i - 2];
    if (!before) continue;
    const beforeLength = before.bars ? before.bars[1] - before.bars[0] : 0;
    if (beforeLength <= 0) continue;
    // **앞보다 길면 안 된다.** 앞이 절이어도 그렇다 — 절보다 긴 구간을 "사비
    // 직전의 짧은 마디"라고 부를 수는 없다.
    if (length > beforeLength) continue;
    if (before.label !== "verse" && length > beforeLength * ratio) continue;

    out[i - 1] = {
      ...candidate,
      label: "pre-chorus",
      reason: `사비 직전 ${length}마디`,
    };
  }
  return out;
}

/**
 * 이어진 같은 라벨을 합친다. **재라벨이 끝난 뒤에만 부른다**(파일 첫 주석).
 *
 * 모델의 출력 입자가 8마디라 한 후렴이 두 조각으로 나오는데, 그것을 그대로
 * 표에 올리면 `Chorus 1`·`Chorus 2`가 같은 후렴을 가리키게 된다.
 */
function mergeAdjacent(sections: readonly StagedSection[]): StagedSection[] {
  const out: StagedSection[] = [];
  for (const section of sections) {
    const previous = out[out.length - 1];
    const touching = previous
      && previous.label === section.label
      && Math.abs(previous.time[1] - section.time[0]) < 1e-6;
    if (previous && touching) {
      out[out.length - 1] = {
        ...previous,
        bars: previous.bars && section.bars ? [previous.bars[0], section.bars[1]] : null,
        time: [previous.time[0], section.time[1]],
        // 근거는 앞쪽 것을 남긴다 — 합친 구간의 시작이 그쪽이다
        reason: previous.reason,
      };
      continue;
    }
    out.push(section);
  }
  return out;
}

/** 라벨별 등장 순서. `Verse 1` · `Verse 2` · `Chorus 1` */
function number(sections: readonly StagedSection[]): Section[] {
  const seen = new Map<SectionLabel, number>();
  return sections.map((section, index) => {
    const repeat = (seen.get(section.label) ?? 0) + 1;
    seen.set(section.label, repeat);
    return { ...section, index, repeat };
  });
}

// --- 잔심부름 --------------------------------------------------------------------

/** 가장 가까운 격자 칸의 인덱스. 격자가 오름차순이라 이분 탐색이면 된다 */
function nearest(grid: readonly number[], time: number): number {
  let lo = 0;
  let hi = grid.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (grid[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(grid[lo - 1] - time) <= Math.abs(grid[lo] - time)) return lo - 1;
  return lo;
}

/** 마디 길이의 중앙값. 스냅 허용치의 기준이라 평균보다 중앙값이 맞다 */
function medianSpan(grid: readonly number[]): number {
  if (grid.length < 2) return 0;
  const spans: number[] = [];
  for (let i = 1; i < grid.length; i += 1) spans.push(grid[i] - grid[i - 1]);
  spans.sort((a, b) => a - b);
  return spans[spans.length >> 1];
}
