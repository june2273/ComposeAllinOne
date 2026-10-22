/**
 * 음계 — 으뜸음에서 **도수로 쌓는다.**
 *
 * `core/`의 순수 로직이고 `theory`만 본다. React도 브라우저도 모른다.
 *
 * ## MIDI에서 표기를 되찾으려 하지 말 것
 *
 * D장음계는 `D E F♯ G A B C♯`이지 `D E G♭ G A B D♭`이 아니다. 그런데 이 저장소의
 * 음이름 표 **셋이 전부 음고류로 색인되어 있어** 원리적으로 그것을 못 만든다 —
 * `theory.NOTE_NAMES`는 ♯ 고정이고, `analysis/key.ts`와 `transcribe/musicxml.ts`의
 * 표는 조 하나를 골라 12칸을 통째로 정한다. 음고류 6은 언제나 F♯ 아니면 G♭ 하나다.
 *
 * **음계는 도수마다 글자가 하나씩**이라 글자로 색인해야 한다. 그래서 반대로 간다:
 * 글자를 한 칸씩 올리고, 그 글자의 자연음에서 **임시표를 역산한다.** 이러면
 * `theory.natural()`이 검은건반에서 던지는 자리를 아예 지나지 않는다 — 반음정에서
 * 이미 내린 판단과 같다(`docs/화성학_학습_계획.md` H2).
 *
 * ```
 * D4(62)에서 3번째 도수 → 글자 F, 자연음 F4(65), 목표 62+4=66 → 임시표 +1 → F♯4
 * ```
 */

import { ACCIDENTAL_TEXT, LETTERS, LETTER_PC, Pitch } from "../theory";

export const ScaleKind = {
  Major: "major",
  Natural: "natural",
  Harmonic: "harmonic",
  Melodic: "melodic",
} as const;
export type ScaleKind = (typeof ScaleKind)[keyof typeof ScaleKind];

/**
 * 으뜸음에서 잰 반음 수. **상행 8음**이고 마지막이 옥타브다.
 *
 * 단음계 셋의 관계가 이 표에 그대로 보인다 — Harmonic은 Natural의 **7음만**,
 * Melodic은 **6·7음만** 반음 올린 것이다(그 외에는 글자 하나 다르지 않다).
 * 아래 `RAISED`가 그 차이를 다시 적지 않고 이 표에서 끌어낸다.
 */
const PATTERNS: Record<ScaleKind, readonly number[]> = {
  [ScaleKind.Major]: [0, 2, 4, 5, 7, 9, 11, 12],
  [ScaleKind.Natural]: [0, 2, 3, 5, 7, 8, 10, 12],
  [ScaleKind.Harmonic]: [0, 2, 3, 5, 7, 8, 11, 12],
  [ScaleKind.Melodic]: [0, 2, 3, 5, 7, 9, 11, 12],
};

/** 화면에 적는 이름. 사용자 지정으로 **영어 용어를 앞세운다** */
export const KIND_LABEL: Record<ScaleKind, string> = {
  [ScaleKind.Major]: "Major scale",
  [ScaleKind.Natural]: "Natural minor scale",
  [ScaleKind.Harmonic]: "Harmonic minor scale",
  [ScaleKind.Melodic]: "Melodic minor scale",
};

/** 옵션 눈금에 적는 짧은 이름 */
export const KIND_STEP: Record<ScaleKind, string> = {
  [ScaleKind.Major]: "장음계",
  [ScaleKind.Natural]: "Natural minor",
  [ScaleKind.Harmonic]: "Harmonic minor",
  [ScaleKind.Melodic]: "Melodic minor",
};

/** 눈금 순서. **마지막 칸(전부 섞어서)은 여기 없다** — 화면이 더한다 */
export const SCALE_KINDS: readonly ScaleKind[] = [
  ScaleKind.Major,
  ScaleKind.Natural,
  ScaleKind.Harmonic,
  ScaleKind.Melodic,
];

/** 장음계 계열인가. 으뜸음 표가 갈리는 조건이 이것 하나다 */
export function isMajor(kind: ScaleKind): boolean {
  return kind === ScaleKind.Major;
}

/**
 * **자연단음계에서 반음 올린 도수**(1부터 센 도수). 장·자연단음계는 비어 있다.
 *
 * 표를 손으로 또 적지 않고 `PATTERNS`를 대조해서 끌어낸다 — 둘이 갈리면
 * "Harmonic은 7음을 올린 것"이라는 설명 자체가 거짓이 되기 때문이다.
 */
export function raisedDegrees(kind: ScaleKind): readonly number[] {
  const natural = PATTERNS[ScaleKind.Natural];
  const out: number[] = [];
  PATTERNS[kind].forEach((semi, i) => {
    if (semi !== natural[i]) out.push(i + 1);
  });
  return isMajor(kind) ? [] : out;
}

/**
 * 으뜸음 12개의 **관례 표기.**
 *
 * 같은 음고류라도 장조는 D♭, 단조는 C♯으로 적는다 — 임시표가 적은 쪽이다.
 * `analysis/key.ts`의 `MAJOR_NAMES`·`MINOR_NAMES`와 같은 표인데, 층 규칙이
 * `core/harmony`가 `core/analysis`를 import하는 것을 막아 한 벌 더 둔다.
 * **그래서 `core.test.ts`가 24개를 대조한다** — 조표 표가 두 벌인 것과 같은 자리다.
 */
const MAJOR_TONICS: readonly [string, number][] = [
  ["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0],
  ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0],
];
const MINOR_TONICS: readonly [string, number][] = [
  ["C", 0], ["C", 1], ["D", 0], ["E", -1], ["E", 0], ["F", 0],
  ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["B", -1], ["B", 0],
];

/** 으뜸음은 전부 옥타브 4다 — 그래야 8음이 C4~B5(60~83)에 들어간다 */
export const TONIC_OCTAVE = 4;

/**
 * 이 종류가 쓸 수 있는 으뜸음 12개.
 *
 * 12조를 전부 내도 **임시표가 ±2를 넘는 음이 하나도 안 나온다**(48개 음계를
 * 전부 펼쳐 확인했고 `core.test.ts`가 그것을 지킨다). 넘으면 `Pitch`가 던진다.
 */
export function tonics(kind: ScaleKind): Pitch[] {
  const table = isMajor(kind) ? MAJOR_TONICS : MINOR_TONICS;
  return table.map(([letter, alter]) => new Pitch(letter, alter, TONIC_OCTAVE));
}

/**
 * 상행 8음. **글자를 한 칸씩 올리고 임시표를 역산한다**(파일 머리말 참조).
 *
 * 돌려주는 배열의 `i`번째가 곧 `i+1`도이고, 마지막은 으뜸음의 한 옥타브 위다.
 */
export function scalePitches(tonic: Pitch, kind: ScaleKind): Pitch[] {
  return PATTERNS[kind].map((semitones, i) => {
    const step = tonic.step + i;
    const letter = LETTERS[((step % 7) + 7) % 7];
    const octave = Math.floor(step / 7);
    // 그 글자·그 옥타브의 자연음에서 목표 음고까지가 임시표다
    const natural = (octave + 1) * 12 + LETTER_PC[letter];
    return new Pitch(letter, tonic.midi + semitones - natural, octave);
  });
}

/**
 * `"D Major scale"` · `"A Natural minor scale"`.
 *
 * **옥타브를 안 붙인다** — `Pitch.name`은 `D4`를 주는데 음계의 이름에 옥타브가
 * 들어가면 "D4 장음계"처럼 읽혀 조를 가리키는 말이 아니게 된다.
 */
export function scaleName(tonic: Pitch, kind: ScaleKind): string {
  return `${tonic.letter}${ACCIDENTAL_TEXT[tonic.alter]} ${KIND_LABEL[kind]}`;
}
