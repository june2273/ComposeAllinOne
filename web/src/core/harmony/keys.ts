/**
 * 조표 — **5도권으로 색인한 15조 표.**
 *
 * `core/`의 순수 로직이고 아무것도 import하지 않는다.
 *
 * ## 왜 네 번째 표인가 — 축이 다르다
 *
 * 이 저장소에 조표·음이름 표가 이미 셋 있다(`analysis/key.ts`,
 * `transcribe/musicxml.ts`, `harmony/scales.ts`). **셋 다 음고류로 색인한 12칸짜리라
 * 이 파일의 주제를 원리적으로 담지 못한다.**
 *
 * ```
 * C♭ 장조와 B 장조는 같은 음고류 11이다 — 12칸 표는 둘 중 하나만 담는다.
 * C♯/D♭(1)과 F♯/G♭(6)도 같다.
 * ```
 *
 * 그 셋이 정확히 **이명동음조**이고, 5도권에서 원이 닫히는 자리이며, 이 활동이
 * 가르치려는 내용 자체다. 그래서 축을 바꿔 **fifths(−7~+7)로 색인한다** — 중복이
 * 아니라 다른 질문에 답하는 표다(CLAUDE.md "음이름 표는 세 벌이다 … 합치려 하지
 * 말 것, 서로 다른 질문에 답한다").
 *
 * **대신 겹치는 12조는 `core.test.ts`가 `analysis/key.ts`와 대조한다.**
 * 이명동음 세 자리는 그쪽이 표현할 수 없으므로 대조에서 뺀다 — "불일치"가 아니라
 * "표현 불가"다.
 */

/** 장·단을 가르는 축. `analysis/key.ts`의 `Mode`를 **층 규칙 때문에 못 가져온다** */
export type KeyMode = "major" | "minor";

/**
 * 조표 활동이 내는 다섯 유형. **무엇을 주고 무엇을 묻는가**만 다르다.
 *
 * 다섯이 전부 "칸을 채우는 일"이라 스테이지도 채점기도 하나다 — 생성기가
 * 유형별로 칸을 다르게 짜 줄 뿐이다.
 */
export const KeyKind = {
  /** 조표 그림 → 장조 으뜸음 */
  Major: "major_tonic",
  /** 조표 그림 → 단조 으뜸음 */
  Minor: "minor_tonic",
  /** 조표 그림 → 장조·단조 둘 다 */
  Both: "both_tonics",
  /** 조 이름 → 붙는 음이름 + 나란한조 */
  Signature: "signature",
  /** 한쪽 이름 → 다른 쪽 조표 + 이름 */
  Enharmonic: "enharmonic",
} as const;
export type KeyKind = (typeof KeyKind)[keyof typeof KeyKind];

/** 옵션 눈금 순서 = 배우는 순서 */
export const KEY_KINDS: readonly KeyKind[] = [
  KeyKind.Major,
  KeyKind.Minor,
  KeyKind.Both,
  KeyKind.Signature,
  KeyKind.Enharmonic,
];

export const KEY_KIND_LABEL: Record<KeyKind, string> = {
  [KeyKind.Major]: "장조 으뜸음",
  [KeyKind.Minor]: "단조 으뜸음",
  [KeyKind.Both]: "장·단 둘 다",
  [KeyKind.Signature]: "조 → 조표",
  [KeyKind.Enharmonic]: "이명동음조",
};

/** ♯이 붙는 순서 — 파도솔레라미시 */
export const SHARP_ORDER = "FCGDAEB";
/** ♭이 붙는 순서 — ♯의 역순이다 */
export const FLAT_ORDER = "BEADGCF";

export interface KeyEntry {
  /** 조표. 양수면 ♯계, 음수면 ♭계. −7~+7 */
  readonly fifths: number;
  /** 장조 으뜸음. `"C♭"` ~ `"C♯"` */
  readonly major: string;
  /** 단조 으뜸음. **소문자로 적는다** — 관용 표기이고 장조와 눈으로 갈린다 */
  readonly minor: string;
}

/**
 * 15조. **fifths 오름차순**이고 손으로 적었다.
 *
 * 손으로 적은 표는 반드시 규칙과 대조한다(`majorTonicByRule` — 교재 교차표를
 * 92쌍으로 지키는 것과 같은 자리다).
 */
export const KEYS: readonly KeyEntry[] = [
  { fifths: -7, major: "C♭", minor: "a♭" },
  { fifths: -6, major: "G♭", minor: "e♭" },
  { fifths: -5, major: "D♭", minor: "b♭" },
  { fifths: -4, major: "A♭", minor: "f" },
  { fifths: -3, major: "E♭", minor: "c" },
  { fifths: -2, major: "B♭", minor: "g" },
  { fifths: -1, major: "F", minor: "d" },
  { fifths: 0, major: "C", minor: "a" },
  { fifths: 1, major: "G", minor: "e" },
  { fifths: 2, major: "D", minor: "b" },
  { fifths: 3, major: "A", minor: "f♯" },
  { fifths: 4, major: "E", minor: "c♯" },
  { fifths: 5, major: "B", minor: "g♯" },
  { fifths: 6, major: "F♯", minor: "d♯" },
  { fifths: 7, major: "C♯", minor: "a♯" },
];

export const MIN_FIFTHS = -7;
export const MAX_FIFTHS = 7;

export function keyAt(fifths: number): KeyEntry {
  const entry = KEYS[fifths - MIN_FIFTHS];
  if (!entry) throw new Error(`조표 범위를 벗어났습니다: ${fifths}`);
  return entry;
}

/** 그 조의 으뜸음 이름. 단조는 소문자다 */
export function tonicName(fifths: number, mode: KeyMode): string {
  const entry = keyAt(fifths);
  return mode === "major" ? entry.major : entry.minor;
}

/** `"D Major"` · `"b minor"` — 화면과 정답 문구가 함께 쓴다 */
export function keyLabel(fifths: number, mode: KeyMode): string {
  return `${tonicName(fifths, mode)} ${mode === "major" ? "Major" : "minor"}`;
}

/**
 * 이 조표에 붙는 음이름, **붙는 순서대로**. 조표가 없으면 빈 문자열.
 *
 * `♯2`면 `"FC"`, `♭3`이면 `"BEA"`. 사용자가 이 순서를 그대로 친다.
 */
export function accidentalLetters(fifths: number): string {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths);
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths);
  return "";
}

/** `"♯2"` · `"♭3"` · `"없음"` */
export function signatureLabel(fifths: number): string {
  if (fifths === 0) return "없음";
  return fifths > 0 ? `♯${fifths}` : `♭${-fifths}`;
}

// --- 으뜸음을 찾는 두 규칙 ------------------------------------------------------
//
// 교재가 가르치는 것이 이 둘이고, **둘이 15조를 전부 만들어낸다.**
// 표를 손으로 고치면 `core.test.ts`의 규칙 대조가 먼저 깨진다.

const LETTER_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/**
 * 규칙으로 구한 장조 으뜸음의 **음고류**.
 *
 * - **♯쪽** — 마지막 ♯이 붙은 음은 이끎음이다. **그 음(이미 ♯이 붙어 있다)의
 *   반음 위**가 으뜸음이다. `♯2`는 F♯ C♯ 중 마지막이 C♯ → D.
 *   (자연음 C에서 세면 안 된다 — ♯이 붙은 C♯에서 센다.)
 * - **♭쪽** — **끝에서 두 번째 ♭**이 곧 으뜸음이다. `♭4`(B E A D)는 A → A♭.
 *   **♭1만 예외**로 F다 — ♭이 하나뿐이라 "끝에서 두 번째"가 없다.
 */
export function majorTonicPcByRule(fifths: number): number {
  if (fifths === 0) return 0;
  if (fifths > 0) {
    const last = SHARP_ORDER[fifths - 1];
    // 그 음은 ♯이 붙어 있으므로 +1, 거기서 반음 위라 다시 +1
    return (LETTER_PC[last] + 2) % 12;
  }
  const order = FLAT_ORDER.slice(0, -fifths);
  if (order.length === 1) return LETTER_PC.F;
  const letter = order[order.length - 2];
  return (LETTER_PC[letter] + 11) % 12;
}

/** 이름 → 음고류. `"C♭"` → 11, `"f♯"` → 6 */
export function tonicPc(name: string): number {
  const letter = name[0].toUpperCase();
  const alter = name.includes("♯") ? 1 : name.includes("♭") ? -1 : 0;
  return ((LETTER_PC[letter] + alter) % 12 + 12) % 12;
}

// --- 이명동음조 ----------------------------------------------------------------

/**
 * 이명동음조 — **♯ 개수 + ♭ 개수 = 12.** 셋뿐이다.
 *
 * ```
 * ♯5 + ♭7 = 12     B  / g♯  =  C♭ / a♭
 * ♯6 + ♭6 = 12     F♯ / d♯  =  G♭ / e♭
 * ♯7 + ♭5 = 12     C♯ / a♯  =  D♭ / b♭
 * ```
 *
 * 세 쌍을 따로 외우지 않는다 — **덧셈 하나**다. 이름 쪽도 규칙이 하나다:
 * **글자가 한 칸 올라가고 ♭이 붙는다**(B→C♭, F♯→G♭, C♯→D♭. 감2도 관계).
 *
 * 그리고 이 셋이 **5도권에서 원이 닫히는 자리**다(`CIRCLE`의 5·6·7번). 외워야 할
 * 예외가 아니라 한 바퀴가 만나는 지점이라는 것이 이 설계의 요점이다.
 */
export const ENHARMONIC: readonly (readonly [number, number])[] = [
  [5, -7],
  [6, -6],
  [7, -5],
];

/** 이 조표의 이명동음조. 없으면 null */
export function enharmonicOf(fifths: number): number | null {
  for (const [sharp, flat] of ENHARMONIC) {
    if (fifths === sharp) return flat;
    if (fifths === flat) return sharp;
  }
  return null;
}

// --- 5도권 ---------------------------------------------------------------------

/**
 * 5도권 12자리. **시계방향이 ♯이 하나씩 느는 방향**이고 0번이 C다.
 *
 * 자리마다 조표가 하나씩인데 **5·6·7번만 둘**이다 — 거기가 ♯계와 ♭계가 만나
 * 원이 닫히는 곳이고, 그래서 그 세 자리는 **어느 이름으로 써도 정답**이다.
 */
export const CIRCLE: readonly (readonly number[])[] = [
  [0],       // C
  [1],       // G
  [2],       // D
  [3],       // A
  [4],       // E
  [5, -7],   // B  / C♭
  [6, -6],   // F♯ / G♭
  [7, -5],   // C♯ / D♭
  [-4],      // A♭
  [-3],      // E♭
  [-2],      // B♭
  [-1],      // F
];

export const CIRCLE_SIZE = CIRCLE.length;

/**
 * **단조도 같은 원이다 — 자리가 하나도 안 움직인다.**
 *
 * `a`가 12시인데 그 자리는 `C`가 앉은 자리이고, 아래로 쭉 나란한조가 같은 칸에
 * 앉는다(`C/a` `G/e` `D/b` …). 모호한 세 자리도 그대로 셋이다
 * (`g♯/a♭` · `d♯/e♭` · `a♯/b♭`). 그래서 **표를 새로 만들지 않고 이름만 갈아
 * 끼운다** — `circleNames(자리, mode)`가 그 일을 한다.
 *
 * 나란한조가 같은 칸에 앉는다는 것 자체가 외울 거리라, 두 고리를 따로 그리는
 * 대신 **눈금으로 갈아 보이는 쪽**이 그 사실을 더 잘 가르친다.
 */
export const CIRCLE_MODES: readonly KeyMode[] = ["major", "minor"];

export const CIRCLE_MODE_LABEL: Record<KeyMode, string> = {
  major: "장조",
  minor: "단조",
};

/** 자리 번호를 0~11로 감는다. 음수도 받는다 */
export function wrapPosition(position: number): number {
  return ((position % CIRCLE_SIZE) + CIRCLE_SIZE) % CIRCLE_SIZE;
}

/** 그 자리의 조표들. 5·6·7번은 둘이다 */
export function circleAt(position: number): readonly number[] {
  return CIRCLE[wrapPosition(position)];
}

/** 이 조표가 원의 몇 번 자리인가 */
export function positionOf(fifths: number): number {
  const at = CIRCLE.findIndex((list) => list.includes(fifths));
  if (at < 0) throw new Error(`5도권에 없는 조표입니다: ${fifths}`);
  return at;
}

/**
 * 그 자리에서 정답으로 칠 이름 전부. 모호한 자리는 둘이다.
 *
 * 기본이 장조인 것은 **호출부를 안 고치려는 편의가 아니라** 5도권을 장조로
 * 먼저 배우기 때문이다(`CIRCLE_MODES`의 첫 눈금).
 */
export function circleNames(
  position: number,
  mode: KeyMode = "major",
): string[] {
  return circleAt(position).map((f) => tonicName(f, mode));
}

// --- 답 표기 맞추기 -------------------------------------------------------------

/**
 * 비교용으로 다듬는다 — **자판에 ♯·♭이 없다는 것이 출발점이다.**
 *
 * `#`→`♯`, `b`를 ♭로 읽는 것은 **글자 뒤에 올 때만**이다(`Bb`의 첫 B는 음이름,
 * 둘째 b는 ♭). 그래서 첫 글자만 음이름으로 떼고 나머지에서 기호를 읽는다.
 */
export function normalizeKeyName(text: string): string {
  const cleaned = text
    .replace(/\s+/gu, "")
    .replace(/key$/iu, "")
    .replace(/major|장조|maj$/giu, "")
    .replace(/minor|단조|min$/giu, "");
  if (cleaned === "") return "";
  const letter = cleaned[0].toUpperCase();
  if (!(letter in LETTER_PC)) return "";
  const rest = cleaned.slice(1);
  if (/^(♯|#|s)$/iu.test(rest)) return `${letter}♯`;
  if (/^(♭|b|f)$/iu.test(rest)) return `${letter}♭`;
  return rest === "" ? letter : "";
}

/** 붙는 음이름 비교용. 공백·쉼표를 버리고 대문자로. **순서는 지킨다** */
export function normalizeLetters(text: string): string {
  return text.replace(/[^a-z]/giu, "").toUpperCase();
}

/**
 * `"♯2"` · `"#2"` · `"2#"` · `"b3"` · `"0"` · `"없음"` → fifths.
 * 읽을 수 없으면 null.
 */
export function parseSignature(text: string): number | null {
  const cleaned = text.replace(/\s+/gu, "").replace(/개$/u, "");
  if (cleaned === "0" || cleaned === "없음" || cleaned === "") {
    return cleaned === "" ? null : 0;
  }
  const match = /^(?:([♯#b♭])(\d{1,2})|(\d{1,2})([♯#b♭]))$/u.exec(cleaned);
  if (!match) return null;
  const sign = match[1] ?? match[4];
  const count = Number(match[2] ?? match[3]);
  if (count > MAX_FIFTHS) return null;
  return sign === "♯" || sign === "#" ? count : -count;
}
