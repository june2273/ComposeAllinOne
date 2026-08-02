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

export function noteNames(midiNotes: Iterable<number>): string {
  return [...midiNotes].sort((a, b) => a - b).map(noteName).join(" ");
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

export const QUALITIES = [PERFECT, MAJOR, MINOR, AUGMENTED, DIMINISHED] as const;

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

  get isPerfectFamily(): boolean {
    return PERFECT_STEPS.has(((this.number - 1) % 7) + 1);
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
