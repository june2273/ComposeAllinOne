"""활동 카탈로그 — 이 앱이 무엇을 하는지의 단일 목록.

**새 연습·도구를 추가할 때 가장 먼저 손대는 곳이다.** 여기에 `Activity` 한 줄을
넣으면 홈·목록 화면에 자동으로 나타나고, `status`가 PLANNED이면 "준비 중" 화면이
그 설명을 그대로 보여준다. 구현이 끝나면 `status`를 READY로 바꾸고 화면을 잇는다.

## 활동은 세 종류다 — 이게 이 파일의 핵심

셋은 시간 축과 결과의 성격이 근본적으로 다르다. 하나의 세션 모델로 묶으면
반드시 어그러진다.

| 종류 | 시간 축 | 결과 | 쓰는 것 |
|---|---|---|---|
| `QUIZ` | 문제당 카운트다운 | 점수 N/10 | `session.Session` |
| `PERFORMANCE` | 곡 전체가 흐르는 타임라인 | 타이밍 정확도 | (미구현) 트랜스포트 시계 |
| `TOOL` | 없음 | 파일·데이터 | (미구현) 백그라운드 작업 |

`session.Session`은 QUIZ 전용이다. 코드 학습(리듬 게임)이나 분석 도구를 여기에
태우려 하지 말 것 — 문제 큐·제한시간·정답 판정이 전부 맞지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from config import DIATONIC_INTERVALS, INTERMEDIATE, SessionConfig


class Domain(str, Enum):
    EAR = "청음"
    HARMONY = "화성학"
    ANALYSIS = "음악분석도구"


class Kind(str, Enum):
    QUIZ = "quiz"                # 문항형 — Session이 돈다
    PERFORMANCE = "performance"  # 연주형 — 타임라인 위에서 친다
    TOOL = "tool"                # 도구 — 입력을 분석·변환한다


class Status(str, Enum):
    READY = "동작"
    PLANNED = "준비 중"


DOMAIN_SUMMARY = {
    Domain.EAR: "소리만 듣고 맞힌다. 음높이부터 EQ·음량·정위까지.",
    Domain.HARMONY: "악보와 이론. 음정에서 텐션·모드까지, 그리고 코드 연주.",
    Domain.ANALYSIS: "곡을 분석하고 변환한다. 연습이 아니라 작곡 도구.",
}


@dataclass(frozen=True)
class Activity:
    id: str
    domain: Domain
    kind: Kind
    title: str
    summary: str
    status: Status = Status.PLANNED
    # QUIZ이면서 READY일 때만 채운다. 나머지는 None.
    config: SessionConfig | None = None
    needs_midi: bool = False
    # 준비 중 화면에 그대로 보여줄 것들. 구현할 사람이 읽을 메모다.
    features: tuple[str, ...] = ()
    requires: tuple[str, ...] = ()

    @property
    def ready(self) -> bool:
        return self.status is Status.READY


# --- 청음 -------------------------------------------------------------------

EAR: tuple[Activity, ...] = (
    Activity(
        id="ear.single_note",
        domain=Domain.EAR,
        kind=Kind.QUIZ,
        title="단일음 청음",
        summary="한 음을 듣고 건반에서 찾는다.",
        status=Status.READY,
        config=INTERMEDIATE,
        needs_midi=True,
    ),
    Activity(
        id="ear.chord",
        domain=Domain.EAR,
        kind=Kind.QUIZ,
        title="화음 청음",
        summary="화음을 듣고 구성음을 전부 누른다.",
        needs_midi=True,
        features=("3화음", "7화음", "전위", "아르페지오 모드"),
        requires=(
            "questions.py에 화음 생성기 (make_generator의 chord_pool 분기)",
            "SessionConfig.chord_hold_ms = 70 — 입력 그룹핑은 이미 동작한다",
            "채점은 PitchClassGrader를 그대로 쓴다",
        ),
    ),
    Activity(
        id="ear.eq",
        domain=Domain.EAR,
        kind=Kind.QUIZ,
        title="EQ 청음",
        summary="어느 대역이 얼마나 부스트/컷됐는지 맞힌다.",
        features=("대역 맞히기", "게인 방향", "Q 폭", "A/B 비교 재생"),
        requires=(
            "AudioBackend에 버퍼 재생 + 필터 경로 (지금은 음표 재생만 된다)",
            "핑크 노이즈 또는 음악 소스 — 음원 라이선스 확인 필요",
            "응답 형식: 주파수 선택 + 게인 부호. IntervalResponse처럼 폼 응답",
        ),
    ),
    Activity(
        id="ear.loudness",
        domain=Domain.EAR,
        kind=Kind.QUIZ,
        title="라우드니스 청음",
        summary="두 소리의 음량 차이를 dB로 맞힌다.",
        features=("dB 차이 맞히기", "LUFS 감각", "피크 vs 라우드니스"),
        requires=(
            "AudioBackend에 게인 파라미터",
            "재생 레벨 교정 — 시스템 볼륨에 따라 체감이 달라진다",
        ),
    ),
    Activity(
        id="ear.pan",
        domain=Domain.EAR,
        kind=Kind.QUIZ,
        title="팬 청음",
        summary="소리가 좌우 어디에 놓였는지 맞힌다.",
        features=("정위 각도", "폭(스테레오 width)", "헤드폰 권장 안내"),
        requires=(
            "AudioBackend에 정위 파라미터 — SineSynth는 지금 모노다",
            "출력이 스테레오인지 확인하는 절차",
        ),
    ),
)

# --- 화성학 -----------------------------------------------------------------

HARMONY: tuple[Activity, ...] = (
    Activity(
        id="harmony.interval_diatonic",
        domain=Domain.HARMONY,
        kind=Kind.QUIZ,
        title="온음정",
        summary="한 조의 음계음으로 만든 음정. 도수·반음 수·성질.",
        status=Status.READY,
        config=DIATONIC_INTERVALS,
    ),
    Activity(
        id="harmony.interval_chromatic",
        domain=Domain.HARMONY,
        kind=Kind.QUIZ,
        title="반음정",
        summary="임시표가 붙은 음정. 증·감이 본격적으로 나온다.",
        features=("증·감 음정", "겹증·겹감", "이명동음 구별"),
        requires=(
            "theory는 이미 계산한다 — 겹증·겹감까지 검증됨",
            "생성기가 theory.natural()을 써서 검은건반을 거부한다. 조표에서 "
            "Pitch를 유도하는 층이 필요",
            "UI 성질 버튼 5개 → 7개 (main.QUALITY_KEYS에 두 줄)",
        ),
    ),
    Activity(
        id="harmony.interval_compound",
        domain=Domain.HARMONY,
        kind=Kind.QUIZ,
        title="겹음정",
        summary="옥타브를 넘는 음정. 9도·11도·13도.",
        features=("홑음정 환원", "9·11·13도", "텐션과의 연결"),
        requires=(
            "theory.interval_between()이 이미 9·10도를 계산한다(검증됨)",
            "생성기의 MAX_NUMBER 상한과 음역 축만 넓히면 된다",
        ),
    ),
    Activity(
        id="harmony.triad",
        domain=Domain.HARMONY,
        kind=Kind.QUIZ,
        title="3화음",
        summary="장·단·증·감 3화음과 전위를 읽고 답한다.",
        features=("4종 성질", "1·2전위", "자리바꿈 표기"),
        requires=(
            "화음 응답 폼 — 근음 + 성질 + 전위. IntervalResponse와 같은 방식",
            "악보는 score.py에 3음 이상 그리는 함수 추가 (지금은 2음 전용)",
        ),
    ),
    Activity(
        id="harmony.key_diatonic",
        domain=Domain.HARMONY,
        kind=Kind.QUIZ,
        title="조표 다이아토닉",
        summary="조표를 읽고 그 조의 다이아토닉 화음을 답한다.",
        features=("조표 읽기", "으뜸조/나란한조", "다이아토닉 7화음", "로마자"),
        requires=(
            "조(key) 개념이 필요 — DifficultyAxes.allowed_pitch_classes는 임시 형태다",
            "여기서 music21 도입을 다시 검토할 것 (로마자 분석이 핵심 기능이 된다)",
        ),
    ),
    Activity(
        id="harmony.seventh",
        domain=Domain.HARMONY,
        kind=Kind.QUIZ,
        title="7화음 연습",
        summary="maj7·m7·7·m7♭5·dim7을 구별한다.",
        features=("5종 성질", "전위", "이명동음 함정(dim7)"),
        requires=(
            "dim7은 4종이 건반에서 동일하다 — 문서 3절 이명동음 방침 A+C를 "
            "여기서 처음으로 실제 적용해야 한다",
        ),
    ),
    Activity(
        id="harmony.tension",
        domain=Domain.HARMONY,
        kind=Kind.QUIZ,
        title="텐션",
        summary="9·11·13과 변화 텐션. 생략음을 허용한다.",
        features=("♭9·♯9·♯11·♭13", "생략 가능음", "어보이드 노트"),
        requires=(
            "Question.required_pcs / optional_pcs가 이미 이 규칙을 담는다 — "
            "채점기는 손대지 않아도 된다",
            "화음 정의 테이블을 데이터로 넣는 작업이 대부분",
        ),
    ),
    Activity(
        id="harmony.mode",
        domain=Domain.HARMONY,
        kind=Kind.QUIZ,
        title="모드",
        summary="7가지 교회선법을 듣고, 읽고, 구별한다.",
        features=("이오니안~로크리안", "특성음", "모달 인터체인지"),
        requires=("스케일 생성기 + 특성음 강조 재생",),
    ),
    Activity(
        id="harmony.chord_play",
        domain=Domain.HARMONY,
        kind=Kind.PERFORMANCE,
        title="코드 학습",
        summary="유명 곡의 코드 진행이 흐르면 박자에 맞춰 친다. 리듬 게임 방식.",
        needs_midi=True,
        features=(
            "코드 진행이 화면을 가로질러 흐른다",
            "박자에 맞춰 MIDI 건반으로 해당 코드를 누른다",
            "타이밍 판정 (Perfect / Good / Miss)",
            "곡 선택 · BPM 조절 · 구간 반복",
        ),
        requires=(
            "Session을 쓰지 않는다. 문제 큐가 아니라 연속 타임라인이다",
            "트랜스포트 시계 — 오디오 재생 위치와 화면·판정이 같은 시계를 봐야 한다. "
            "QTimer로는 드리프트가 생기므로 sounddevice 스트림의 프레임 카운터 기준",
            "타이밍 판정기 — 정답/오답이 아니라 '얼마나 빗나갔나'(ms)",
            "곡 데이터 형식 — 코드 심볼 + 박자 위치. 저작권 주의: 코드 진행 자체는 "
            "보호 대상이 아니라는 견해가 일반적이나, 원곡 음원을 쓰면 별개 문제다.",
        ),
    ),
)

# --- 음악분석도구 -------------------------------------------------------------
# "올인원"이 요구사항이므로 기능별로 메뉴를 쪼개지 않는다. 파일을 한 번 열면
# 분석이 한꺼번에 돌고, 필요한 것만 꺼내 쓰는 형태가 맞다.

ANALYSIS: tuple[Activity, ...] = (
    Activity(
        id="analysis.console",
        domain=Domain.ANALYSIS,
        kind=Kind.TOOL,
        title="분석 콘솔",
        summary="오디오 파일 하나를 열면 분석과 변환을 한자리에서.",
        features=(
            "BPM 검출 — 템포와 박 위치",
            "키 검출 — 조와 스케일",
            "박자 검출 — 拍子(4/4·3/4·6/8 등)",
            "스템 분리 — 보컬·드럼·베이스·기타",
            "MIDI 변환 — 오디오에서 음표 추출",
            "악보 변환 — MIDI에서 오선보 (score.py 재사용)",
            "피치 커브 — 보컬 음정 궤적",
        ),
        requires=(
            "연습 세션이 아니다 — 점수·제한시간·문제가 없다. Session을 쓰지 않는다",
            "무거운 의존성이 필요하다(BPM·키 검출, 스템 분리, 피치 추출). "
            "전부 선택 의존성으로 두고 지연 임포트할 것 — 없어도 연습 기능은 떠야 한다",
            "스템 분리는 수 분이 걸린다. 백그라운드 작업 + 진행률이 필요하고 "
            "Qt 메인 스레드에서 돌리면 앱이 얼어붙는다 (QThread 또는 프로세스 분리)",
            "결과 저장 위치·파일 형식 결정 필요",
            "도입하는 라이브러리는 전부 citation.md에 기록 — 이 분야는 라이선스가 "
            "제각각이고 학습 데이터 출처가 불투명한 모델이 섞여 있다",
        ),
    ),
)


CATALOG: tuple[Activity, ...] = EAR + HARMONY + ANALYSIS

BY_ID: dict[str, Activity] = {a.id: a for a in CATALOG}


def by_domain(domain: Domain) -> list[Activity]:
    return [a for a in CATALOG if a.domain is domain]


def ready_activities() -> list[Activity]:
    return [a for a in CATALOG if a.ready]


def counts(domain: Domain) -> tuple[int, int]:
    """(동작하는 것, 전체)."""
    items = by_domain(domain)
    return sum(1 for a in items if a.ready), len(items)
