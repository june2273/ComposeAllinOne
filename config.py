"""세션 설정 — 문서 6절의 난이도 8축과 그 프리셋.

이 모듈은 프로젝트 안의 어떤 것에도 의존하지 않는다(의존성 그래프의 뿌리).
questions·grading·audio·session이 전부 여기를 바라보므로, 여기서 무언가를
import하면 순환이 생긴다.

"초급/중급/고급"은 난이도 값이 아니라 **축 값들의 묶음에 붙인 이름**일 뿐이다.
사용자 정의 프리셋은 `DifficultyAxes`를 직접 만들면 된다.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Literal

# 문서 7절의 AudioBackend Protocol이 이 리터럴을 그대로 쓴다.
PlayMode = Literal["block", "arpeggio_up", "melody"]


class Stage(str, Enum):
    """연습 스테이지. 문제를 어떻게 내고 무엇으로 답하는지가 여기서 갈린다.

    청음 스테이지는 MIDI 건반으로 답하고, 화성학 스테이지는 화면 입력으로
    답한다. 스테이지가 생성기·채점기·화면을 함께 고르므로, 새 스테이지를
    추가할 때 손댈 곳은 이 Enum과 세 개의 팩토리뿐이다.
    """

    EAR_SINGLE = "ear_single"        # 1음 청음 (MIDI 입력)
    EAR_CHORD = "ear_chord"          # 화음 청음 (MIDI 입력) — Phase 2
    INTERVAL_ID = "interval_id"      # 온음계적 음정 구분 (화면 입력)


class GradingMode(str, Enum):
    """문서 5절 — 채점 엄격도. 단일 판정 함수로 뭉치지 않는다."""

    PITCH_CLASS = "pitch_class"        # 옥타브·전위·중복 무시
    BASS_NOTE = "bass_note"            # 음고류 + 최저음 일치
    EXACT_VOICING = "exact_voicing"    # 보이싱 일치(옥타브 통째 이동은 허용)
    ABSOLUTE_PITCH = "absolute_pitch"  # MIDI 번호까지 완전 일치
    # 아래는 건반 입력이 아니라 화면에서 고른 답을 채점한다
    INTERVAL_FORM = "interval_form"    # 도수 + 반음 수 + 성질 세 항목


@dataclass(frozen=True)
class DifficultyAxes:
    """문서 6절의 8축. 슬라이더 하나로 뭉치지 않는다."""

    # 1. 음역 제한
    note_low: int = 60
    note_high: int = 72
    # 2. 조성 — 지금은 "허용 음고류 집합"이 조성 축의 구체형이다.
    #    None이면 제한 없음(반음계). music21이 들어오면 조(key)에서 유도한다.
    allowed_pitch_classes: frozenset[int] | None = None
    # 3. 재생 횟수 제한 (None = 무제한)
    replay_limit: int | None = None
    # 4. 재생 방식
    play_mode: PlayMode = "block"
    # 5. 화음 종류 풀 — Phase 2에서 채운다. 빈 값이면 1음 청음.
    chord_pool: tuple[str, ...] = ()
    # 6. 전위 포함 여부
    allow_inversions: bool = False
    # 7. 문제당 제한시간 (None = 무제한)
    time_limit_sec: float | None = 10.0
    # 8. 채점 엄격도
    grading: GradingMode = GradingMode.ABSOLUTE_PITCH

    def allows(self, midi_note: int) -> bool:
        if not self.note_low <= midi_note <= self.note_high:
            return False
        if self.allowed_pitch_classes is None:
            return True
        return midi_note % 12 in self.allowed_pitch_classes


@dataclass(frozen=True)
class SessionConfig:
    """한 세션의 전부. 문서 8절 데이터 모델 초안을 따른다.

    타이밍 상수까지 여기 모은 이유: 테스트가 모듈 전역을 런타임에 덮어쓰는
    대신 설정 객체 하나만 바꾸면 되기 때문이다.
    """

    stage: Stage = Stage.EAR_SINGLE
    question_count: int = 10
    difficulty: DifficultyAxes = field(default_factory=DifficultyAxes)
    tag_filter: tuple[str, ...] | None = None   # 집중연습
    wrong_only: bool = False                    # 오답 재출제

    play_duration_sec: float = 2.0
    # 문제 전환 직후 잔여 note-off를 다음 문제 입력으로 오인하지 않도록 (문서 4절)
    input_lockout_ms: int = 200
    feedback_ms: int = 1200
    # 마지막 note-on 이후 이만큼 조용하면 화음 확정. 0이면 첫 음을 즉시 채점한다.
    # 문서 4절 권장값은 화음 70ms, 아르페지오 모드 500~800ms.
    chord_hold_ms: int = 0
    echo_back: bool = False                     # 문서 10절 권장: OFF

    def with_axes(self, **kwargs) -> SessionConfig:
        return replace(self, difficulty=replace(self.difficulty, **kwargs))


# --- 프리셋 ------------------------------------------------------------------
# 축 값의 묶음에 이름을 붙인 것뿐이다. 값을 바꿔도 코드는 손대지 않는다.

BEGINNER = SessionConfig(
    question_count=10,
    difficulty=DifficultyAxes(
        note_low=60,
        note_high=72,
        allowed_pitch_classes=frozenset({0, 2, 4, 5, 7, 9, 11}),  # C장조
        time_limit_sec=15.0,
        grading=GradingMode.PITCH_CLASS,
    ),
)

# 프로토타입이 지금까지 돌던 설정. 기본값이다.
INTERMEDIATE = SessionConfig(
    question_count=10,
    difficulty=DifficultyAxes(
        note_low=60,
        note_high=72,
        time_limit_sec=10.0,
        grading=GradingMode.ABSOLUTE_PITCH,
    ),
)

ADVANCED = SessionConfig(
    question_count=20,
    difficulty=DifficultyAxes(
        note_low=48,
        note_high=84,
        replay_limit=1,
        time_limit_sec=8.0,
        grading=GradingMode.ABSOLUTE_PITCH,
    ),
)

# --- 화성학: 온음계적 음정 구분 ------------------------------------------------
# 한 조(기본 C장조)의 음계음만으로 만드는 음정. 흰건반만 써도 완전·장·단·증·감
# 다섯 성질이 모두 나온다 — F–B가 증4도, B–F가 감5도이기 때문이다. 그래서
# 첫 스테이지로 삼기에 알맞다(별도의 임시표 없이 성질 다섯 개를 다 만난다).
C_MAJOR_PCS = frozenset({0, 2, 4, 5, 7, 9, 11})

DIATONIC_INTERVALS = SessionConfig(
    stage=Stage.INTERVAL_ID,
    question_count=10,
    difficulty=DifficultyAxes(
        note_low=60,               # C4
        note_high=81,              # A5 — 두 음이 옥타브를 넘지 않게 여유를 둔다
        allowed_pitch_classes=C_MAJOR_PCS,
        time_limit_sec=10.0,
        grading=GradingMode.INTERVAL_FORM,
    ),
    play_duration_sec=2.0,
    feedback_ms=2200,              # 진단 문구를 읽을 시간이 필요하다
)

PRESETS: dict[str, SessionConfig] = {
    "초급": BEGINNER,
    "중급": INTERMEDIATE,
    "고급": ADVANCED,
}

# 어떤 연습·도구가 있는지는 catalog.py가 갖는다. 이 파일은 "한 세션을 어떻게
# 돌릴지"만 안다 — 목록을 여기에 두면 config가 화면 구성까지 알게 된다.
DEFAULT_CONFIG = INTERMEDIATE
