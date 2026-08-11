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

/** 기준 반음 수와의 차이 → 성질 */
const PERFECT_QUALITY: Record<number, string> = {
  0: PERFECT, 1: AUGMENTED, [-1]: DIMINISHED,
  2: DOUBLY_AUGMENTED, [-2]: DOUBLY_DIMINISHED,
};
const MAJOR_QUALITY: Record<number, string> = {
  0: MAJOR, [-1]: MINOR, 1: AUGMENTED, [-2]: DIMINISHED,
  2: DOUBLY_AUGMENTED, [-3]: DOUBLY_DIMINISHED,
};

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
 * ## 자연음 전용이다
 *
 * 임시표가 붙으면 반음 자리가 옮겨 다녀서 이 셈법 자체가 성립하지 않는다
 * (E♭–F는 온음, E–F♯도 온음). 교재의 표도 온음계 안에서만 유효하다.
 * 반음정 스테이지를 만들 때 이 함수를 재사용하려 하지 말 것.
 */
export function diatonicHalfSteps(a: Pitch, b: Pitch): number {
  if (a.alter !== 0 || b.alter !== 0) {
    throw new Error(
      `온음계적 반음은 자연음 사이에서만 셀 수 있습니다: ${a.name}–${b.name}`,
    );
  }
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
