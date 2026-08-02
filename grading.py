"""채점 — Strategy.

문서 5절: "하나의 정답 판정 함수로 모든 상황을 커버하려 하면 실패한다.
모드로 분리한다." 그래서 모드마다 클래스를 하나씩 둔다. 세션은
`Grader` 인터페이스만 알고, 어떤 모드인지 묻지 않는다.

텐션 화음의 생략음 규칙(필수음 전부 있으면 통과)은 `Question`이 들고 있는
required_pcs / optional_pcs로 처리한다. 판정기가 화음 종류를 알 필요가 없다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from config import GradingMode
from questions import IntervalQuestion, IntervalResponse, Question
from theory import note_name, pitch_classes


@dataclass(frozen=True)
class Judgement:
    correct: bool
    detail: str = ""


@runtime_checkable
class Grader(Protocol):
    mode: GradingMode

    # played의 타입은 스테이지가 정한다. 청음은 MIDI 번호 튜플, 화성학은
    # 화면에서 만든 응답 객체(예: IntervalResponse)가 온다. 생성기·채점기·
    # 화면이 스테이지 단위로 함께 정해지므로 짝이 어긋날 일은 없다.
    def grade(self, question: Question, played: object) -> Judgement: ...


def _wrong(question: Question, played: tuple[int, ...]) -> Judgement:
    heard = " ".join(note_name(n) for n in sorted(played)) if played else "없음"
    return Judgement(False, f"정답 {question.answer_text} / 친 음 {heard}")


def _right(question: Question) -> Judgement:
    return Judgement(True, question.answer_text)


class PitchClassGrader:
    """옥타브·전위·중복을 무시하고 음고류만 본다. 코드 구성음 암기용.

    문서 3절 방침 A의 기본 채점기이기도 하다 — 이명동음을 건반 위에서
    구별할 수 없으므로 음고류로 채점하고 스펠링은 화면에 보여준다.
    """

    mode = GradingMode.PITCH_CLASS

    def grade(self, question: Question, played: tuple[int, ...]) -> Judgement:
        heard = pitch_classes(played)
        if not question.required_pcs <= heard:
            return _wrong(question, played)
        # 생략 가능음 외의 군더더기가 섞이면 오답
        if not heard <= (question.required_pcs | question.optional_pcs):
            return _wrong(question, played)
        return _right(question)


class BassNoteGrader:
    """음고류 + 최저음까지. 전위 훈련용."""

    mode = GradingMode.BASS_NOTE

    def __init__(self) -> None:
        self._pcs = PitchClassGrader()

    def grade(self, question: Question, played: tuple[int, ...]) -> Judgement:
        if not self._pcs.grade(question, played).correct:
            return _wrong(question, played)
        if not played or min(played) % 12 != question.bass % 12:
            return _wrong(question, played)
        return _right(question)


class ExactVoicingGrader:
    """보이싱까지 일치. 4성부 화성법용.

    음 사이의 간격 배치가 같으면 전체가 옥타브 단위로 통째 이동한 것은
    허용한다. 옥타브까지 고정하려면 ABSOLUTE_PITCH를 쓴다.
    (문서 5절의 두 모드를 이렇게 갈랐다 — 그 표만으로는 둘의 차이가
    모호해서, "절대 음역 = 위 + 지정 옥타브"라는 서술을 이렇게 읽었다.)
    """

    mode = GradingMode.EXACT_VOICING

    def grade(self, question: Question, played: tuple[int, ...]) -> Judgement:
        want = sorted(set(question.answer_notes))
        got = sorted(set(played))
        if len(want) != len(got) or not got:
            return _wrong(question, played)
        shift = got[0] - want[0]
        if shift % 12 != 0:
            return _wrong(question, played)
        if any(g - w != shift for g, w in zip(got, want)):
            return _wrong(question, played)
        return _right(question)


class AbsolutePitchGrader:
    """MIDI 번호 집합이 정확히 일치. 절대적 음높이 훈련용."""

    mode = GradingMode.ABSOLUTE_PITCH

    def grade(self, question: Question, played: tuple[int, ...]) -> Judgement:
        if set(played) != set(question.answer_notes):
            return _wrong(question, played)
        return _right(question)


class IntervalGrader:
    """음정 세 항목(도수·반음 수·성질)을 채점한다.

    세 항목은 서로 독립이 아니다 — 도수와 성질이 정해지면 반음 수는 하나로
    결정된다. 그래도 셋을 다 묻는 이유는 **반음을 세는 과정을 강제**하기
    위해서고, 덕분에 어디서 틀렸는지를 짚어줄 수 있다.

      도수가 틀렸다        → 줄·칸을 잘못 셌다
      도수는 맞고 반음이 틀렸다 → 임시표나 반음 자리(E–F, B–C)를 놓쳤다
      둘 다 맞고 성질이 틀렸다  → 계산은 맞고 음정표를 못 외웠다
    """

    mode = GradingMode.INTERVAL_FORM

    def grade(self, question: Question, played: object) -> Judgement:
        if not isinstance(question, IntervalQuestion):
            raise TypeError("IntervalGrader는 IntervalQuestion에만 쓸 수 있습니다")
        if not isinstance(played, IntervalResponse):
            return Judgement(False, f"정답: {question.answer_text}")

        want = question.interval
        right_number = played.number == want.number
        right_semitones = played.semitones == want.semitones
        right_quality = played.quality == want.quality

        if right_number and right_semitones and right_quality:
            return Judgement(True, question.answer_text)

        if not right_number:
            hint = "도수부터 다시 — 아래 음을 1로 두고 줄·칸을 세어 보세요"
        elif not right_semitones:
            hint = "도수는 맞습니다. 반음 자리(E–F, B–C)를 빠뜨렸는지 보세요"
        else:
            hint = "도수와 반음 수는 맞습니다. 성질만 다시 보세요"
        return Judgement(False, f"정답: {question.answer_text}\n낸 답: {played} · {hint}")


_GRADERS: dict[GradingMode, type] = {
    GradingMode.PITCH_CLASS: PitchClassGrader,
    GradingMode.BASS_NOTE: BassNoteGrader,
    GradingMode.EXACT_VOICING: ExactVoicingGrader,
    GradingMode.ABSOLUTE_PITCH: AbsolutePitchGrader,
    GradingMode.INTERVAL_FORM: IntervalGrader,
}


def make_grader(mode: GradingMode) -> Grader:
    try:
        return _GRADERS[mode]()
    except KeyError:  # Enum이라 정상 경로에서는 닿지 않는다
        raise ValueError(f"알 수 없는 채점 모드: {mode}") from None
