"""문제 생성 — Strategy.

문제 종류(1음/음정/화음/스케일/로마자)마다 생성 규칙이 전혀 다르므로,
세션 컨트롤러가 종류별 분기를 갖는 대신 `QuestionGenerator` 하나만 알게 한다.
새 종류를 추가할 때 손댈 곳은 이 파일과 팩토리 한 줄뿐이다.

태그를 넉넉히 붙이는 것이 이 파일의 또 다른 목적이다. 집중연습은
"태그로 거른 문제 큐"이므로 생성 시점에 붙여두면 거의 공짜로 구현되지만,
나중에 태그를 추가하려면 생성기를 전부 다시 손대야 한다(문서 8절).
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from config import DifficultyAxes, SessionConfig, Stage
from theory import (
    NOTE_NAMES,
    Interval,
    Pitch,
    interval_between,
    is_black_key,
    natural,
    note_name,
    octave,
    pitch_classes,
)


@dataclass(frozen=True)
class Question:
    """문서 8절 데이터 모델.

    `answer_notes`는 MIDI 번호라 스펠링을 담지 못한다. music21이 들어오면
    스펠링을 가진 필드가 추가되고, 화면 표시는 그쪽을 쓴다(문서 3절 방침 A:
    채점은 음고류로, 정답 스펠링은 화면에 보여준다).
    """

    kind: str
    answer_notes: tuple[int, ...]
    required_pcs: frozenset[int]
    optional_pcs: frozenset[int] = frozenset()
    key_context: str | None = None
    prompt: str = ""            # 연습 화면에 띄울 안내
    answer_text: str = ""       # 정답 표시용 (스펠링이 생기면 여기가 바뀐다)
    tags: tuple[str, ...] = ()

    @property
    def bass(self) -> int:
        return min(self.answer_notes)

    def matches_tags(self, wanted: tuple[str, ...] | None) -> bool:
        return wanted is None or any(t in self.tags for t in wanted)


@runtime_checkable
class QuestionGenerator(Protocol):
    kind: str

    def generate(self) -> Question: ...


class SingleNoteGenerator:
    """1음 청음. 직전 문제와 같은 음은 내지 않는다."""

    kind = "ear_single"

    def __init__(self, axes: DifficultyAxes, rng: random.Random | None = None) -> None:
        self.axes = axes
        self.rng = rng or random.Random()
        self._last: int | None = None
        self._pool = [
            n for n in range(axes.note_low, axes.note_high + 1) if axes.allows(n)
        ]
        if not self._pool:
            raise ValueError(
                f"음역 {axes.note_low}~{axes.note_high}에 조성 조건을 만족하는 음이 없습니다"
            )

    def generate(self) -> Question:
        choices = [n for n in self._pool if n != self._last] or self._pool
        note = self.rng.choice(choices)
        self._last = note
        return Question(
            kind=self.kind,
            answer_notes=(note,),
            required_pcs=pitch_classes((note,)),
            prompt=f"{note_name(self.axes.note_low)}~{note_name(self.axes.note_high)} 중 한 음",
            answer_text=note_name(note),
            tags=self._tags(note),
        )

    def _tags(self, note: int) -> tuple[str, ...]:
        return (
            "청음",
            "1음",
            f"음이름:{NOTE_NAMES[note % 12]}",
            f"옥타브:{octave(note)}",
            "검은건반" if is_black_key(note) else "흰건반",
            f"음역:{note_name(self.axes.note_low)}-{note_name(self.axes.note_high)}",
        )


# --- 화성학: 음정 구분 --------------------------------------------------------


@dataclass(frozen=True)
class IntervalQuestion(Question):
    """악보로 보여주고 소리로 들려주는 음정 문제.

    `answer_notes`(MIDI)만으로는 도수를 셀 수 없어서 표기를 함께 들고 있다.
    C–E와 C–F♭은 둘 다 4반음이지만 각각 장3도와 감4도다.
    """

    lower: Pitch = field(kw_only=True)
    upper: Pitch = field(kw_only=True)
    interval: Interval = field(kw_only=True)


@dataclass(frozen=True)
class IntervalResponse:
    """사용자가 화면에서 고른 답. 셋 다 채워져야 제출된다."""

    number: int | None = None      # 도수
    semitones: int | None = None   # 반음 수
    quality: str | None = None     # 완전 / 장 / 단 / 증 / 감

    @property
    def complete(self) -> bool:
        return None not in (self.number, self.semitones, self.quality)

    def __str__(self) -> str:
        num = self.number if self.number is not None else "?"
        semi = self.semitones if self.semitones is not None else "?"
        return f"{self.quality or '?'}{num}도 / {semi}반음"


class DiatonicIntervalGenerator:
    """한 조의 음계음만으로 만드는 화성음정(두 음 동시).

    흰건반(C장조)만 써도 F–B(증4도)와 B–F(감5도)가 나오므로 완전·장·단·증·감
    다섯 성질이 모두 등장한다. 임시표를 도입하지 않고도 성질 판별 훈련이 된다.

    완전1도(동음)는 내지 않는다 — 동시에 울리면 귀로 구별할 수 없고 악보에서도
    두 음표가 겹쳐 읽히지 않는다. 2도~8도만 출제한다.

    **음정 종류를 먼저 뽑고 그 다음에 실제 음을 고른다.** 음 쌍을 균등하게
    뽑으면 C4~A5 구간에서 증4도가 70쌍 중 2쌍, 감5도가 1쌍뿐이라 10문제 동안
    트라이톤이 한 번도 안 나온다 — 정작 가장 연습이 필요한 음정인데도. 종류를
    먼저 뽑으면 13종이 고르게 나온다.
    """

    kind = "interval_id"
    MIN_NUMBER = 2
    MAX_NUMBER = 8

    def __init__(self, axes: DifficultyAxes, rng: random.Random | None = None) -> None:
        self.axes = axes
        self.rng = rng or random.Random()

        pcs = axes.allowed_pitch_classes
        if pcs is None:
            raise ValueError(
                "온음계적 음정에는 조성 축이 필요합니다 "
                "(DifficultyAxes.allowed_pitch_classes를 지정하세요)"
            )
        try:
            self._scale = [
                natural(n)
                for n in range(axes.note_low, axes.note_high + 1)
                if n % 12 in pcs
            ]
        except ValueError as exc:  # 검은건반이 섞인 조는 조표 처리가 필요하다
            raise ValueError(
                f"아직 자연음(흰건반)으로만 이루어진 조성만 지원합니다: {exc}"
            ) from None

        if len(self._scale) < self.MAX_NUMBER:
            raise ValueError(
                f"음역 {axes.note_low}~{axes.note_high}이 좁아 8도를 만들 수 없습니다"
            )

        # 음정 이름 → 그 음정을 이루는 모든 음 쌍
        self._by_interval: dict[str, list[tuple[Pitch, Pitch, Interval]]] = {}
        for i, lower in enumerate(self._scale):
            for steps in range(self.MIN_NUMBER - 1, self.MAX_NUMBER):
                if i + steps >= len(self._scale):
                    break
                upper = self._scale[i + steps]
                interval = interval_between(lower, upper)
                self._by_interval.setdefault(interval.name, []).append(
                    (lower, upper, interval)
                )
        self._names = sorted(self._by_interval)
        self._last_name: str | None = None

    @property
    def interval_names(self) -> list[str]:
        """이 설정에서 나올 수 있는 음정 종류."""
        return list(self._names)

    def generate(self) -> IntervalQuestion:
        names = [n for n in self._names if n != self._last_name] or self._names
        name = self.rng.choice(names)
        self._last_name = name
        lower, upper, interval = self.rng.choice(self._by_interval[name])
        notes = (lower.midi, upper.midi)
        return IntervalQuestion(
            kind=self.kind,
            answer_notes=notes,
            required_pcs=pitch_classes(notes),
            prompt="두 음 사이의 음정은?",
            answer_text=(
                f"{interval.name} — {lower.name}–{upper.name}, {interval.semitones}반음"
            ),
            tags=self._tags(interval),
            lower=lower,
            upper=upper,
            interval=interval,
        )

    def _tags(self, interval: Interval) -> tuple[str, ...]:
        return (
            "화성학",
            "음정",
            "온음계",
            "화성음정",          # 동시에 울림 (선율음정과 구분)
            f"{interval.number}도",
            interval.quality,
            f"{interval.semitones}반음",
        )


@dataclass
class FixedGenerator:
    """미리 정해둔 문제를 순서대로 낸다. 테스트·오답 재출제용."""

    questions: list[Question]
    kind: str = "fixed"
    _i: int = field(default=0, init=False)

    def generate(self) -> Question:
        q = self.questions[self._i % len(self.questions)]
        self._i += 1
        return q


def make_generator(
    config: SessionConfig, rng: random.Random | None = None
) -> QuestionGenerator:
    """스테이지에 맞는 생성기를 고른다.

    새 스테이지를 추가할 때 여기에 분기 한 줄을 더한다. 호출부(세션)는
    바뀌지 않는다.
    """
    axes = config.difficulty
    if config.stage is Stage.INTERVAL_ID:
        return DiatonicIntervalGenerator(axes, rng)
    if config.stage is Stage.EAR_CHORD or axes.chord_pool:
        raise NotImplementedError("화음 문제 생성기는 Phase 2에서 구현한다")
    return SingleNoteGenerator(axes, rng)


__all__ = [
    "Question",
    "QuestionGenerator",
    "SingleNoteGenerator",
    "IntervalQuestion",
    "IntervalResponse",
    "DiatonicIntervalGenerator",
    "FixedGenerator",
    "make_generator",
]
