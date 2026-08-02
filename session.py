"""세션 상태 기계 — Qt를 모른다.

UI에서 분리한 이유는 두 가지다.

1. 테스트. 이 클래스만으로 세션 전체를 돌릴 수 있어서 offscreen Qt를
   띄우거나 모듈 전역을 런타임에 덮어쓸 필요가 없다.
2. 문서 4절의 락아웃·화음 확정 규칙이 UI 이벤트 핸들러에 흩어지면
   "문제가 저절로 틀린 채 넘어가는" 버그를 재현·검증하기 어렵다.
   여기서는 `accepting` 게이트가 한 곳에만 있다.

시간은 이 클래스가 재지 않는다. 호출자(컨트롤러)가 경과 시간을 넘긴다 —
QTimer든 테스트의 가짜 시계든 상관없게 하기 위해서다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto

from config import SessionConfig
from grading import Grader
from questions import Question, QuestionGenerator


class Phase(Enum):
    IDLE = auto()       # 시작 전
    LOCKOUT = auto()    # 문제는 정해졌으나 입력을 받지 않는다 (문서 4절)
    LISTENING = auto()  # 입력 대기
    FEEDBACK = auto()   # 채점 결과 표시 중
    FINISHED = auto()   # 세션 종료


@dataclass(frozen=True)
class Result:
    index: int
    question: Question
    # 사용자가 낸 답. 청음이면 MIDI 번호 튜플, 화성학이면 응답 객체.
    # None이면 시간 초과다.
    response: object | None
    correct: bool
    detail: str
    seconds: float

    @property
    def timed_out(self) -> bool:
        return self.response is None


@dataclass
class NoteCollector:
    """문서 4절 — 마지막 note-on 이후 hold_ms 동안 조용하면 화음 확정.

    타이머는 여기 없다. `add()`가 True를 돌려주면 즉시 확정, False면
    호출자가 hold_ms짜리 타이머를 (다시) 걸고 만료 시 `take()`를 부른다.
    hold_ms=0이면 첫 음을 즉시 확정하므로 1음 청음의 현재 동작과 같다.
    """

    hold_ms: int = 0
    _notes: list[int] = field(default_factory=list, init=False)

    def add(self, note: int) -> bool:
        if note not in self._notes:
            self._notes.append(note)
        return self.hold_ms <= 0

    def take(self) -> tuple[int, ...]:
        notes = tuple(self._notes)
        self._notes.clear()
        return notes

    def clear(self) -> None:
        self._notes.clear()

    @property
    def pending(self) -> bool:
        return bool(self._notes)


class Session:
    """문제 큐·점수·진행 상태. 생성자로 전략을 주입받는다(DIP).

    생성기와 채점기를 밖에서 넣기 때문에, 화음 문제나 다른 채점 모드를
    붙일 때 이 클래스는 한 줄도 바뀌지 않는다.
    """

    def __init__(
        self,
        config: SessionConfig,
        generator: QuestionGenerator,
        grader: Grader,
    ) -> None:
        self.config = config
        self.generator = generator
        self.grader = grader
        self.collector = NoteCollector(config.chord_hold_ms)

        self.phase = Phase.IDLE
        self.index = 0
        self.score = 0
        self.current: Question | None = None
        self.results: list[Result] = []
        self._plays = 0

    # --- 진행 -------------------------------------------------------------

    def start(self) -> None:
        self.phase = Phase.IDLE
        self.index = 0
        self.score = 0
        self.current = None
        self.results.clear()
        self.collector.clear()

    def next_question(self) -> Question | None:
        """다음 문제를 뽑고 락아웃 상태로 들어간다. None이면 세션 종료."""
        if self.index >= self.config.question_count:
            self.phase = Phase.FINISHED
            self.current = None
            return None

        self.index += 1
        self.current = self._draw()
        self.phase = Phase.LOCKOUT
        self._plays = 0
        self.collector.clear()
        return self.current

    def _draw(self) -> Question:
        """태그 필터를 만족하는 문제가 나올 때까지 생성기를 돌린다."""
        wanted = self.config.tag_filter
        for _ in range(64):
            q = self.generator.generate()
            if q.matches_tags(wanted):
                return q
        raise RuntimeError(f"태그 {wanted}를 만족하는 문제를 뽑지 못했습니다")

    def begin_listening(self) -> None:
        """락아웃 해제. 이 시점부터 입력을 받는다."""
        if self.phase is not Phase.LOCKOUT:
            return
        self.phase = Phase.LISTENING

    @property
    def accepting(self) -> bool:
        return self.phase is Phase.LISTENING

    @property
    def finished(self) -> bool:
        return self.phase is Phase.FINISHED

    # --- 재생 횟수 축 -------------------------------------------------------

    @property
    def replays_left(self) -> int | None:
        limit = self.config.difficulty.replay_limit
        return None if limit is None else max(limit - self._plays, 0)

    def note_played(self) -> None:
        self._plays += 1

    def may_play(self) -> bool:
        left = self.replays_left
        return left is None or left > 0

    # --- 입력 ---------------------------------------------------------------

    def collect(self, note: int) -> bool:
        """note-on 하나를 누적한다. True면 지금 바로 확정해도 된다."""
        if not self.accepting:
            return False
        return self.collector.add(note)

    def submit(self, seconds: float) -> Result | None:
        """누적된 음을 채점한다. 누적된 게 없으면 None. (MIDI 경로)"""
        if not self.accepting or not self.collector.pending:
            return None
        return self.respond(self.collector.take(), seconds)

    def respond(self, response: object, seconds: float) -> Result | None:
        """완성된 답을 그대로 채점한다. (화면 입력 경로)

        MIDI 경로와 이 경로가 만나는 곳은 `_finish` 하나뿐이고, 두 경로 모두
        `accepting` 게이트를 지난다. 문서 4절의 락아웃 규칙이 한 군데서만
        지켜지도록 새 입력 경로를 만들 때도 반드시 여기를 통과시킬 것.
        """
        if not self.accepting:
            return None
        return self._finish(response, seconds)

    def time_out(self, seconds: float) -> Result | None:
        if not self.accepting:
            return None
        self.collector.clear()
        return self._finish(None, seconds)

    def _finish(self, response: object | None, seconds: float) -> Result:
        assert self.current is not None
        limit = self.config.difficulty.time_limit_sec

        if response is None:
            correct, detail = False, f"정답: {self.current.answer_text}"
        else:
            judgement = self.grader.grade(self.current, response)
            correct, detail = judgement.correct, judgement.detail

        if correct:
            self.score += 1

        result = Result(
            index=self.index,
            question=self.current,
            response=response,
            correct=correct,
            detail=detail,
            seconds=seconds if limit is None else min(seconds, limit),
        )
        self.results.append(result)
        self.phase = Phase.FEEDBACK
        return result

    # --- 요약 ---------------------------------------------------------------

    @property
    def progress_text(self) -> str:
        return f"문제 {self.index} / {self.config.question_count}"

    def wrong_questions(self) -> list[Question]:
        """오답 재출제용. 문서 8절 wrong_only 축이 이걸 쓴다."""
        return [r.question for r in self.results if not r.correct]
