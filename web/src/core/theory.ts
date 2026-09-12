/**
 * 음이름·음고류·음정 계산.
 *
 * React·오디오·설정 어디에도 의존하지 않는 순수 함수만 둔다.
 *
 * 두 가지 표현이 공존한다.
 *
 * - **MIDI 번호**(number): 건반에서 들어오는 것. 스펠링이 없어서 A♭과 G♯을
 *   구별하지 못한다 — 기술검토서 3절의 이명동음 리스크가 여기에 있다.
 * - **`Pitch`**: 음이름·임시표·옥타브를 가진 표기. 악보를 그리거나 **도수를
 *   세려면 반드시 이쪽이 필요하다.** C-E는 장3도(4반음)지만 C-F♭은 같은
 *   4반음인데 감4도다. MIDI 번호만으로는 이 둘을 나눌 수 없다.
 *
 * (Python판 theory.py의 이식. 계산 규칙은 한 줄도 바꾸지 않았다.)
 */

export const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

/** 한 옥타브 안에서 검은건반인 음고류 */
export const BLACK_KEY_PCS = new Set([1, 3, 6, 8, 10]);

export function pitchClass(midiNote: number): number {
  return ((midiNote % 12) + 12) % 12;
}

export function pitchClasses(midiNotes: Iterable<number>): Set<number> {
  return new Set([...midiNotes].map(pitchClass));
}

export function octaveOf(midiNote: number): number {
  return Math.floor(midiNote / 12) - 1;
}

export function noteName(midiNote: number): string {
  return `${NOTE_NAMES[pitchClass(midiNote)]}${octaveOf(midiNote)}`;
}

/** 여러 음을 낮은 순으로 나열한다. 하나도 없으면 `empty`. */
export function noteNames(midiNotes: Iterable<number>, empty = ""): string {
  const sorted = [...midiNotes].sort((a, b) => a - b);
  return sorted.length ? sorted.map(noteName).join(" ") : empty;
}

export function isBlackKey(midiNote: number): boolean {
  return BLACK_KEY_PCS.has(pitchClass(midiNote));
}

// --- 표기를 가진 음 ---------------------------------------------------------

export const LETTERS = "CDEFGAB";
export const LETTER_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};
export const ACCIDENTAL_TEXT: Record<number, string> = {
  [-2]: "♭♭", [-1]: "♭", 0: "", 1: "♯", 2: "♯♯",
};
/** MusicXML `<accidental>` 값 */
export const ACCIDENTAL_XML: Record<number, string> = {
  [-2]: "flat-flat", [-1]: "flat", 1: "sharp", 2: "double-sharp",
};

/** 음이름 + 임시표 + 옥타브. octave 4가 가온다(C4=MIDI 60) 옥타브. */
export class Pitch {
  readonly letter: string;
  readonly alter: number;
  readonly octave: number;

  constructor(letter: string, alter = 0, octave = 4) {
    this.letter = letter;
    this.alter = alter;
    this.octave = octave;
    if (!(letter in LETTER_PC)) {
      throw new Error(`음이름은 A~G여야 합니다: ${letter}`);
    }
    if (alter < -2 || alter > 2) {
      throw new Error(`임시표는 -2~2 범위입니다: ${alter}`);
    }
  }

  get midi(): number {
    return (this.octave + 1) * 12 + LETTER_PC[this.letter] + this.alter;
  }

  /** 음이름 계단 번호(임시표 무시). 도수는 이 값의 차이로만 정해진다. */
  get step(): number {
    return this.octave * 7 + LETTERS.indexOf(this.letter);
  }

  get name(): string {
    return `${this.letter}${ACCIDENTAL_TEXT[this.alter]}${this.octave}`;
  }

  toString(): string {
    return this.name;
  }
}

/** 자연음(흰건반) MIDI 번호를 표기로 되돌린다. 검은건반이면 오류. */
export function natural(midiNote: number): Pitch {
  const pc = pitchClass(midiNote);
  for (const [letter, value] of Object.entries(LETTER_PC)) {
    if (value === pc) return new Pitch(letter, 0, octaveOf(midiNote));
  }
  throw new Error(`${midiNote}는 자연음이 아니라 표기를 유일하게 정할 수 없습니다`);
}

/** 임시표를 뗀 같은 자리의 음. 골격 음정을 구할 때 쓴다 (위 프로세스의 ②) */
export function withoutAlter(pitch: Pitch): Pitch {
  return pitch.alter === 0 ? pitch : new Pitch(pitch.letter, 0, pitch.octave);
}

// --- 음정 -------------------------------------------------------------------

/** 완전 계열이 되는 홑음정 도수 */
export const PERFECT_STEPS = new Set([1, 4, 5]);
/** 홑음정 도수별 기준 반음 수 (완전 또는 장) */
const BASE_SEMITONES: Record<number, number> = {
  1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11,
};

export const PERFECT = "완전";
export const MAJOR = "장";
export const MINOR = "단";
export const AUGMENTED = "증";
export const DIMINISHED = "감";
export const DOUBLY_AUGMENTED = "겹증";
export const DOUBLY_DIMINISHED = "겹감";
export const TRIPLY_AUGMENTED = "겹겹증";
export const TRIPLY_DIMINISHED = "겹겹감";

/**
 * 교재의 A표·B표 — 성질 사다리. 왼쪽이 좁고 **오른쪽으로 갈수록 넓다.**
 *
 * ```
 * A표 (1·4·5·8도)   겹겹감 – 겹감 – 감 – 완전 – 증 – 겹증 – 겹겹증
 * B표 (2·3·6·7도)   겹겹감 – 겹감 – 감 – 단 – 장 – 증 – 겹증 – 겹겹증
 * ```
 *
 * **아래 두 `Record`를 이 배열에서 만든다.** 사다리 순서는 화면이 표로 그려야 하는데
 * `Record`에는 순서가 없어서, 표를 따로 손으로 적으면 채점과 갈릴 수 있다.
 * 배열이 하나뿐이면 그 사고가 원리적으로 안 난다.
 */
export const PERFECT_LADDER: readonly string[] = [
  TRIPLY_DIMINISHED, DOUBLY_DIMINISHED, DIMINISHED, PERFECT,
  AUGMENTED, DOUBLY_AUGMENTED, TRIPLY_AUGMENTED,
];
export const MAJOR_LADDER: readonly string[] = [
  TRIPLY_DIMINISHED, DOUBLY_DIMINISHED, DIMINISHED, MINOR, MAJOR,
  AUGMENTED, DOUBLY_AUGMENTED, TRIPLY_AUGMENTED,
];
/** 사다리에서 기준(완전·장)이 앉은 칸 */
const PERFECT_CENTER = 3;
const MAJOR_CENTER = 4;

/** 사다리 → "기준 반음 수와의 차이 → 성질" 표 */
function ladderTable(
  ladder: readonly string[],
  center: number,
): Record<number, string> {
  const table: Record<number, string> = {};
  ladder.forEach((quality, i) => {
    table[i - center] = quality;
  });
  return table;
}

const PERFECT_QUALITY = ladderTable(PERFECT_LADDER, PERFECT_CENTER);
const MAJOR_QUALITY = ladderTable(MAJOR_LADDER, MAJOR_CENTER);

/**
 * 이 도수의 성질 사다리를 화면에 보일 만큼만 잘라 준다.
 *
 * `maxAlter`는 음 하나에 붙일 수 있는 임시표 수다. 겹증·겹감은 위아래 음에 하나씩
 * 붙어야 나오므로 **사다리가 기준에서 `maxAlter + 1`칸씩 뻗는다.**
 *
 * **B표는 좌우가 비대칭이다.** 장·단이 **둘 다 기준**이라 넓히는 쪽은 장에서,
 * 좁히는 쪽은 단에서 센다 — 그래서 교재의 B표가 A표보다 한 칸 길다
 * (`겹감 감 단 장 증 겹증` 대 `겹감 감 완전 증 겹증`). 가운데 하나를 잡고 대칭으로
 * 자르면 겹감이 잘려 나간다.
 */
export function qualityLadder(number: number, maxAlter = 2): readonly string[] {
  const simple = ((number - 1) % 7) + 1;
  const perfect = PERFECT_STEPS.has(simple);
  const ladder = perfect ? PERFECT_LADDER : MAJOR_LADDER;
  // 좁히는 쪽의 기준(완전 / 단)과 넓히는 쪽의 기준(완전 / 장)
  const low = perfect ? PERFECT_CENTER : MAJOR_CENTER - 1;
  const high = perfect ? PERFECT_CENTER : MAJOR_CENTER;
  const reach = Math.max(1, Math.min(3, maxAlter + 1));
  return ladder.slice(
    Math.max(0, low - reach),
    Math.min(ladder.length, high + reach + 1),
  );
}

/**
 * 답으로 적을 수 있는 성질 — **긴 이름부터** 늘어놓는다.
 * "겹겹증"을 "겹증"이나 "증"으로 먼저 맞추면 뒤가 숫자가 아니라서 통째로 실패한다.
 */
const QUALITY_NAMES: readonly string[] = [
  TRIPLY_AUGMENTED, TRIPLY_DIMINISHED,
  DOUBLY_AUGMENTED, DOUBLY_DIMINISHED, PERFECT,
  MAJOR, MINOR, AUGMENTED, DIMINISHED,
];

/**
 * 자판 별칭. **한글 입력기를 켜지 않고도 답할 수 있어야 한다.**
 *
 * 글자는 예전 성질 버튼의 단축키를 그대로 쓴다 — Perfect / Major / miNor /
 * Augmented / Diminished. 단(minor)이 N인 것은 M을 장(Major)이 가져갔기 때문이고,
 * 겹은 글자를 반복한다.
 */
const QUALITY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["AAA", TRIPLY_AUGMENTED], ["DDD", TRIPLY_DIMINISHED],
  ["AA", DOUBLY_AUGMENTED], ["DD", DOUBLY_DIMINISHED],
  ["P", PERFECT], ["M", MAJOR], ["N", MINOR],
  ["A", AUGMENTED], ["D", DIMINISHED],
];

export interface IntervalAnswer {
  readonly quality: string;
  /** 도수를 안 적었으면 null (성질만 묻는 단계) */
  readonly number: number | null;
}

/** 성질 뒤에 남은 것이 도수인가. 숫자가 아니면 `undefined`(입력 자체가 틀렸다) */
function degreeOf(rest: string): number | null | undefined {
  if (rest === "") return null;
  if (!/^[0-9]{1,2}$/u.test(rest)) return undefined;
  const value = Number(rest);
  return value >= 1 ? value : undefined;
}

/**
 * `"증5"` · `"겹겹증4도"` · `"AAA4"` → `{ quality, number }`.
 *
 * 성질 + 도수 순서다. 음정의 이름이 "장3도"지 "3도 장"이 아니기 때문이고,
 * `Interval.name`도 그 순서로 적는다. "도"와 공백은 버린다.
 */
export function parseIntervalAnswer(text: string): IntervalAnswer | null {
  const cleaned = text.replace(/\s+/gu, "").replace(/도$/u, "");
  if (cleaned === "") return null;

  for (const quality of QUALITY_NAMES) {
    if (!cleaned.startsWith(quality)) continue;
    const number = degreeOf(cleaned.slice(quality.length));
    return number === undefined ? null : { quality, number };
  }
  const upper = cleaned.toUpperCase();
  for (const [alias, quality] of QUALITY_ALIASES) {
    if (!upper.startsWith(alias)) continue;
    const number = degreeOf(upper.slice(alias.length));
    return number === undefined ? null : { quality, number };
  }
  return null;
}

export class Interval {
  /** 도수 (1=완전1도, 8=옥타브) */
  readonly number: number;
  /** 반음 수 */
  readonly semitones: number;
  /** 완전 / 장 / 단 / 증 / 감 / 겹증 / 겹감 */
  readonly quality: string;

  constructor(number: number, semitones: number, quality: string) {
    this.number = number;
    this.semitones = semitones;
    this.quality = quality;
  }

  get name(): string {
    return `${this.quality}${this.number}도`;
  }

  toString(): string {
    return this.name;
  }
}

/**
 * 두 표기 사이의 음정. 낮은 음이 어느 쪽이든 상관없다.
 *
 * 도수는 **음이름 계단 수**로, 성질은 그 도수의 기준 반음 수와 실제 반음
 * 수의 차이로 정한다. 이 두 축을 분리하는 것이 음정 계산의 전부다.
 */
/**
 * 음정 안에 든 **온음계적 반음의 개수** (미–파, 시–도).
 *
 * ## `Interval.semitones`와 다른 개념이다 — 헷갈리면 전부 틀린다
 *
 * | | C4–A4 | 뜻 |
 * |---|---|---|
 * | `Interval.semitones` | **9** | 건반을 반음 단위로 센 거리(반음계적) |
 * | `diatonicHalfSteps` | **1** | 음이름 사다리를 오르며 만난 반음 자리의 수 |
 *
 * 한국 화성학 교재의 음정표(`ui/stages.tsx`의 `INTERVAL_TABLE`)가 쓰는 것은
 * **아래쪽**이다. "6도에 반음 1개면 장6도"처럼 도수와 짝지어 성질을 읽는다.
 * 두 값이 같은 이름("반음")으로 불리므로 **UI 문구에서 반드시 하나만 쓸 것.**
 *
 * ## 임시표를 무시한다 — 그게 이 함수의 쓸모다
 *
 * 세는 것은 **음이름 사다리**뿐이라 E♭–F도 F–F♯도 값이 E–F와 같다. 그래서 이 값이
 * 가리키는 성질은 최종 답이 아니라 **임시표를 뗀 골격의 성질**이다(E♭–F는 이 표로
 * 단2도인데 실제로는 장2도다). 음정을 구하는 순서가 원래 그렇게 되어 있다:
 *
 * ```
 * ① 8도를 넘으면 한 옥타브 좁힌다
 * ② 임시표를 떼고 도수와 반음 개수를 센다 → 교재 교차표 → 골격 성질   ← 이 함수
 * ③ 임시표가 음정을 얼마나 벌렸는지 센다
 * ④ 성질 사다리(qualityLadder)에서 그만큼 옮긴다
 * ⑤ 겹음정이면 도수에 7을 되돌린다
 * ```
 *
 * **그러므로 ②의 값을 그대로 성질로 읽지 말 것.** ④가 반드시 뒤따라야 한다.
 * (예전에는 임시표가 붙으면 던졌다. 계산은 늘 옳았고 막으려던 것은 이 오용이었는데,
 * 그 탓에 반음계 문제에서 골격을 셀 방법이 사라졌다.)
 */
export function diatonicHalfSteps(a: Pitch, b: Pitch): number {
  const [lower, upper] = a.step <= b.step ? [a, b] : [b, a];
  let count = 0;
  // 사다리를 한 계단씩 오르며 "이 계단에서 다음 계단까지가 반음인가"를 본다.
  // 자연음에서 반음인 곳은 E→F와 B→C 둘뿐이다.
  for (let s = lower.step; s < upper.step; s += 1) {
    const letter = LETTERS[((s % 7) + 7) % 7];
    if (letter === "E" || letter === "B") count += 1;
  }
  return count;
}

export function intervalBetween(a: Pitch, b: Pitch): Interval {
  const [lower, upper] = a.step <= b.step ? [a, b] : [b, a];
  const number = upper.step - lower.step + 1;
  const semitones = upper.midi - lower.midi;

  const simple = ((number - 1) % 7) + 1;
  const octaves = Math.floor((number - 1) / 7);
  const base = BASE_SEMITONES[simple] + 12 * octaves;
  const offset = semitones - base;

  const table = PERFECT_STEPS.has(simple) ? PERFECT_QUALITY : MAJOR_QUALITY;
  const quality = table[offset];
  if (quality === undefined) {
    throw new Error(
      `${lower.name}–${upper.name}: ${number}도에 ${semitones}반음은 ` +
        "겹증·겹감을 넘어서 이름이 없습니다",
    );
  }
  return new Interval(number, semitones, quality);
}
