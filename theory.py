"""음이름·음고류·음정 계산.

Qt·오디오·설정 어디에도 의존하지 않는 순수 함수만 둔다.

두 가지 표현이 공존한다.

- **MIDI 번호**(int): 건반에서 들어오는 것. 스펠링이 없어서 A♭과 G♯을
  구별하지 못한다 — 문서 3절의 이명동음 리스크가 여기에 있다.
- **`Pitch`**: 음이름·임시표·옥타브를 가진 표기. 악보를 그리거나 **도수를
  세려면 반드시 이쪽이 필요하다.** C-E는 장3도(4반음)지만 C-F♭은 같은
  4반음인데 감4도다. MIDI 번호만으로는 이 둘을 나눌 수 없다.

music21을 아직 넣지 않은 이유: 온음계 음정에 필요한 계산이 아래 40줄이
전부인데, music21은 import만 2~3초가 걸려 문제당 10초짜리 앱에 부담이 크다.
로마자 분석·화음 스펠링이 필요해지는 Phase 3에서 다시 판단한다.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")

# 한 옥타브 안에서 검은건반인 음고류
BLACK_KEY_PCS = frozenset({1, 3, 6, 8, 10})


def pitch_class(midi_note: int) -> int:
    return midi_note % 12


def pitch_classes(midi_notes: Iterable[int]) -> frozenset[int]:
    return frozenset(n % 12 for n in midi_notes)


def octave(midi_note: int) -> int:
    return midi_note // 12 - 1


def note_name(midi_note: int) -> str:
    return f"{NOTE_NAMES[pitch_class(midi_note)]}{octave(midi_note)}"


def note_names(midi_notes: Iterable[int]) -> str:
    return " ".join(note_name(n) for n in sorted(midi_notes))


def is_black_key(midi_note: int) -> bool:
    return pitch_class(midi_note) in BLACK_KEY_PCS


# --- 표기를 가진 음 -----------------------------------------------------------

LETTERS = "CDEFGAB"
LETTER_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
ACCIDENTAL_TEXT = {-2: "♭♭", -1: "♭", 0: "", 1: "♯", 2: "♯♯"}
# MusicXML <accidental> 값
ACCIDENTAL_XML = {-2: "flat-flat", -1: "flat", 1: "sharp", 2: "double-sharp"}


@dataclass(frozen=True)
class Pitch:
    """음이름 + 임시표 + 옥타브. octave 4가 가온다(C4=MIDI 60) 옥타브."""

    letter: str
    alter: int = 0
    octave: int = 4

    def __post_init__(self) -> None:
        if self.letter not in LETTER_PC:
            raise ValueError(f"음이름은 A~G여야 합니다: {self.letter!r}")
        if not -2 <= self.alter <= 2:
            raise ValueError(f"임시표는 -2~2 범위입니다: {self.alter}")

    @property
    def midi(self) -> int:
        return (self.octave + 1) * 12 + LETTER_PC[self.letter] + self.alter

    @property
    def step(self) -> int:
        """음이름 계단 번호(임시표 무시). 도수는 이 값의 차이로만 정해진다."""
        return self.octave * 7 + LETTERS.index(self.letter)

    @property
    def name(self) -> str:
        return f"{self.letter}{ACCIDENTAL_TEXT[self.alter]}{self.octave}"

    def __str__(self) -> str:
        return self.name


def natural(midi_note: int) -> Pitch:
    """자연음(흰건반) MIDI 번호를 표기로 되돌린다. 검은건반이면 오류."""
    pc = pitch_class(midi_note)
    for letter, value in LETTER_PC.items():
        if value == pc:
            return Pitch(letter, 0, octave(midi_note))
    raise ValueError(f"{midi_note}는 자연음이 아니라 표기를 유일하게 정할 수 없습니다")


# --- 음정 -------------------------------------------------------------------

PERFECT_STEPS = frozenset({1, 4, 5})   # 완전 계열이 되는 홑음정 도수
# 홑음정 도수별 기준 반음 수 (완전 또는 장)
BASE_SEMITONES = {1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11}

PERFECT = "완전"
MAJOR = "장"
MINOR = "단"
AUGMENTED = "증"
DIMINISHED = "감"
DOUBLY_AUGMENTED = "겹증"
DOUBLY_DIMINISHED = "겹감"

QUALITIES = (PERFECT, MAJOR, MINOR, AUGMENTED, DIMINISHED)

# 기준 반음 수와의 차이 → 성질
_PERFECT_QUALITY = {0: PERFECT, 1: AUGMENTED, -1: DIMINISHED,
                    2: DOUBLY_AUGMENTED, -2: DOUBLY_DIMINISHED}
_MAJOR_QUALITY = {0: MAJOR, -1: MINOR, 1: AUGMENTED, -2: DIMINISHED,
                  2: DOUBLY_AUGMENTED, -3: DOUBLY_DIMINISHED}


@dataclass(frozen=True)
class Interval:
    number: int      # 도수 (1=완전1도, 8=옥타브)
    semitones: int   # 반음 수
    quality: str     # 완전 / 장 / 단 / 증 / 감 / 겹증 / 겹감

    @property
    def name(self) -> str:
        return f"{self.quality}{self.number}도"

    @property
    def is_perfect_family(self) -> bool:
        return (self.number - 1) % 7 + 1 in PERFECT_STEPS

    def __str__(self) -> str:
        return self.name


def interval_between(a: Pitch, b: Pitch) -> Interval:
    """두 표기 사이의 음정. 낮은 음이 어느 쪽이든 상관없다.

    도수는 **음이름 계단 수**로, 성질은 그 도수의 기준 반음 수와 실제 반음
    수의 차이로 정한다. 이 두 축을 분리하는 것이 음정 계산의 전부다.
    """
    lower, upper = (a, b) if a.step <= b.step else (b, a)
    number = upper.step - lower.step + 1
    semitones = upper.midi - lower.midi

    simple = (number - 1) % 7 + 1
    octaves = (number - 1) // 7
    base = BASE_SEMITONES[simple] + 12 * octaves
    offset = semitones - base

    table = _PERFECT_QUALITY if simple in PERFECT_STEPS else _MAJOR_QUALITY
    quality = table.get(offset)
    if quality is None:
        raise ValueError(
            f"{lower.name}–{upper.name}: {number}도에 {semitones}반음은 "
            "겹증·겹감을 넘어서 이름이 없습니다"
        )
    return Interval(number, semitones, quality)
