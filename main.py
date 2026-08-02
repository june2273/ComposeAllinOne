"""화성학·청음·분석 앱 — 진입점과 UI.

이 파일에는 Qt만 있다. 무엇을 연습하는지는 [catalog.py](catalog.py), 어떻게
채점하는지는 grading.py, 세션 규칙은 session.py에 있고 여기서는 화면에 옮기기만
한다.

## 화면 구조

    HomePage        도메인 3개 (청음 / 화성학 / 음악분석도구) + MIDI 설정
      └ CatalogPage 그 도메인의 활동 목록
          ├ QuizPage      문항형 — 진행·타이머·판정 크롬 + StageView
          ├ PlannedPage   준비 중 — 무엇을 할 것이고 무엇이 필요한지
          └ ResultPage    문항형이 끝난 뒤

`NavBar`가 위에 고정되어 뒤로 가기와 현재 위치를 보여준다.

## 활동 종류에 따라 화면이 갈린다

`catalog.Kind`가 QUIZ / PERFORMANCE / TOOL 셋인 이유는 시간 축과 결과의 성격이
다르기 때문이다(catalog.py 문서 참고). **QuizPage와 SessionController는 QUIZ
전용이다.** 코드 학습(PERFORMANCE)이나 분석 콘솔(TOOL)을 여기에 태우지 말 것 —
전자는 문제 큐가 아니라 연속 타임라인이고, 후자는 애초에 세션이 아니다.

## 스테이지 화면 끼우기

`StageView`가 스테이지별 "문제 표시 + 답 입력"을 맡는다. 청음처럼 MIDI로 답하는
스테이지는 빈 위젯이고, 화성학처럼 화면에서 답을 만드는 스테이지는 `answered`로
응답을 올려보낸다. `make_stage_view()`에 분기 한 줄을 더하면 새 스테이지가 붙는다.

GUI 없이 세션을 검증하려면 Qt를 띄울 필요가 없다. session.Session을 직접 돌리면
된다(session.py 문서 참고).
"""

from __future__ import annotations

import sys

from PySide6.QtCore import (
    QByteArray,
    QElapsedTimer,
    QObject,
    QRectF,
    Qt,
    QTimer,
    Signal,
    Slot,
)
from PySide6.QtGui import QFont, QKeyEvent, QPainter
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from audio import AudioBackend, make_default_backend
from catalog import (
    DOMAIN_SUMMARY,
    Activity,
    Domain,
    Kind,
    Status,
    by_domain,
    counts,
)
from config import SessionConfig, Stage
from grading import make_grader
from midi_input import MidiInput
from questions import IntervalQuestion, IntervalResponse, Question, make_generator
from score import ScoreRenderer, make_score_renderer
from session import Result, Session
from theory import AUGMENTED, DIMINISHED, MAJOR, MINOR, PERFECT, note_name

# MIDI 키보드가 없을 때 확인용 — 컴퓨터 자판 C4~C5 매핑
KEY_FALLBACK = {
    Qt.Key_A: 60, Qt.Key_W: 61, Qt.Key_S: 62, Qt.Key_E: 63, Qt.Key_D: 64,
    Qt.Key_F: 65, Qt.Key_T: 66, Qt.Key_G: 67, Qt.Key_Y: 68, Qt.Key_H: 69,
    Qt.Key_U: 70, Qt.Key_J: 71, Qt.Key_K: 72,
}

# 성질 선택 단축키. 한글 자판(IME) 상태에서도 눌리도록 알파벳을 쓴다.
# Perfect / Major / miNor / Augmented / Diminished
QUALITY_KEYS: tuple[tuple[str, str, int], ...] = (
    (PERFECT, "P", Qt.Key_P),
    (MAJOR, "M", Qt.Key_M),
    (MINOR, "N", Qt.Key_N),
    (AUGMENTED, "A", Qt.Key_A),
    (DIMINISHED, "D", Qt.Key_D),
)


def _response_text(response: object) -> str:
    """결과 목록에 낸 답을 적는다. 청음은 MIDI 번호 묶음, 화성학은 응답 객체."""
    if isinstance(response, tuple) and all(isinstance(n, int) for n in response):
        return " ".join(note_name(n) for n in sorted(response)) or "없음"
    return str(response)


def _flat_button(text: str, height: int = 0) -> QPushButton:
    """포커스를 받지 않는 버튼. Space가 버튼을 누르지 않고 '다시 듣기'로 가게 한다."""
    btn = QPushButton(text)
    btn.setFocusPolicy(Qt.NoFocus)
    if height:
        btn.setMinimumHeight(height)
    return btn


def _scroll(inner: QWidget) -> QScrollArea:
    area = QScrollArea()
    area.setWidgetResizable(True)
    area.setFrameShape(QFrame.NoFrame)
    area.setWidget(inner)
    return area


# --- 네비게이션 ---------------------------------------------------------------


class NavBar(QWidget):
    back_requested = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 6)
        self.back = _flat_button("‹  뒤로", height=30)
        self.back.clicked.connect(self.back_requested)
        lay.addWidget(self.back)
        self.path = QLabel("")
        self.path.setStyleSheet("color: palette(mid);")
        lay.addWidget(self.path, 1)

    def set_path(self, *parts: str) -> None:
        self.path.setText("  ›  ".join(p for p in parts if p))
        self.back.setVisible(bool(parts))


class CardButton(QPushButton):
    """제목 + 설명 + 배지를 담는 큰 버튼. 홈과 목록에서 쓴다."""

    def __init__(
        self, title: str, summary: str, badge: str = "", enabled: bool = True
    ) -> None:
        super().__init__()
        self.setFocusPolicy(Qt.NoFocus)
        self.setMinimumHeight(72)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.setCursor(Qt.PointingHandCursor)

        lay = QHBoxLayout(self)
        lay.setContentsMargins(16, 10, 16, 10)

        text = QVBoxLayout()
        text.setSpacing(2)
        name = QLabel(title)
        name.setFont(QFont("", 15, QFont.Bold))
        text.addWidget(name)
        desc = QLabel(summary)
        desc.setWordWrap(True)
        desc.setStyleSheet("color: palette(mid);")
        text.addWidget(desc)
        lay.addLayout(text, 1)

        if badge:
            chip = QLabel(badge)
            chip.setAlignment(Qt.AlignCenter)
            chip.setStyleSheet(
                "border: 1px solid palette(mid); border-radius: 9px;"
                "padding: 2px 10px; color: palette(mid);"
                if not enabled
                else "border: 1px solid palette(highlight); border-radius: 9px;"
                "padding: 2px 10px; color: palette(highlight);"
            )
            lay.addWidget(chip, 0, Qt.AlignVCenter)


# --- 홈 ----------------------------------------------------------------------


class HomePage(QWidget):
    domain_chosen = Signal(object)   # Domain
    rescan_requested = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.setSpacing(12)

        title = QLabel("무엇을 연습할까요")
        title.setFont(QFont("", 26, QFont.Bold))
        title.setAlignment(Qt.AlignCenter)
        lay.addWidget(title)
        lay.addSpacing(6)

        for domain in Domain:
            done, total = counts(domain)
            card = CardButton(
                domain.value,
                DOMAIN_SUMMARY[domain],
                badge=f"{done} / {total}",
                enabled=done > 0,
            )
            card.clicked.connect(lambda _=False, d=domain: self.domain_chosen.emit(d))
            lay.addWidget(card)

        lay.addStretch(1)

        # MIDI는 앱 전체 설정이라 홈에 둔다. 필요한 활동에서만 쓰인다.
        box = QFrame()
        box.setFrameShape(QFrame.StyledPanel)
        inner = QVBoxLayout(box)
        row = QHBoxLayout()
        row.addWidget(QLabel("MIDI 입력:"))
        self.port_combo = QComboBox()
        self.port_combo.setMinimumWidth(220)
        self.port_combo.setFocusPolicy(Qt.NoFocus)
        row.addWidget(self.port_combo, 1)
        rescan = _flat_button("재검색")
        rescan.clicked.connect(self.rescan_requested)
        row.addWidget(rescan)
        inner.addLayout(row)
        self.port_status = QLabel("")
        self.port_status.setWordWrap(True)
        self.port_status.setStyleSheet("color: palette(mid);")
        inner.addWidget(self.port_status)
        lay.addWidget(box)

    @property
    def port_name(self) -> str:
        return self.port_combo.currentText()

    @Slot(list)
    def set_ports(self, ports: list[str]) -> None:
        self.port_combo.clear()
        if ports:
            self.port_combo.addItems(ports)
            self.port_status.setText(
                f"{len(ports)}개 발견. 건반이 반응하지 않으면 다른 포트를 골라보세요."
            )
        else:
            self.port_status.setText(
                "MIDI 장치가 없습니다. 연결 후 재검색하세요. "
                "없어도 화성학·분석은 쓸 수 있고, 청음은 자판 "
                "A W S E D F T G Y H U J K로 확인할 수 있습니다."
            )

    @Slot(str)
    def set_status(self, message: str) -> None:
        self.port_status.setText(message)


class CatalogPage(QWidget):
    activity_chosen = Signal(object)   # Activity

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._root = QVBoxLayout(self)
        self._root.setContentsMargins(0, 0, 0, 0)
        self._body: QWidget | None = None

    def show_domain(self, domain: Domain) -> None:
        if self._body is not None:
            self._body.deleteLater()
            self._root.removeWidget(self._body)

        inner = QWidget()
        lay = QVBoxLayout(inner)
        lay.setSpacing(8)

        head = QLabel(domain.value)
        head.setFont(QFont("", 22, QFont.Bold))
        lay.addWidget(head)
        note = QLabel(DOMAIN_SUMMARY[domain])
        note.setStyleSheet("color: palette(mid);")
        note.setWordWrap(True)
        lay.addWidget(note)
        lay.addSpacing(6)

        for activity in by_domain(domain):
            card = CardButton(
                activity.title,
                activity.summary,
                badge=activity.status.value,
                enabled=activity.ready,
            )
            card.clicked.connect(
                lambda _=False, a=activity: self.activity_chosen.emit(a)
            )
            lay.addWidget(card)
        lay.addStretch(1)

        self._body = _scroll(inner)
        self._root.addWidget(self._body)


class PlannedPage(QWidget):
    """아직 만들지 않은 활동. 무엇을 할 것이고 무엇이 필요한지를 그대로 보여준다.

    빈 화면이나 "준비 중입니다" 한 줄보다 낫다. 카탈로그에 적어 둔 메모가
    그대로 명세 역할을 하고, 구현할 때 읽을 것이 여기 다 있다.
    """

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._root = QVBoxLayout(self)
        self._root.setContentsMargins(0, 0, 0, 0)
        self._body: QWidget | None = None

    def show_activity(self, activity: Activity) -> None:
        if self._body is not None:
            self._body.deleteLater()
            self._root.removeWidget(self._body)

        inner = QWidget()
        lay = QVBoxLayout(inner)
        lay.setSpacing(10)

        head = QLabel(activity.title)
        head.setFont(QFont("", 24, QFont.Bold))
        lay.addWidget(head)

        chip = QLabel(f"{activity.status.value} · {activity.kind.value}")
        chip.setStyleSheet("color: palette(mid);")
        lay.addWidget(chip)

        summary = QLabel(activity.summary)
        summary.setWordWrap(True)
        lay.addWidget(summary)

        for title, items in (
            ("여기서 하게 될 것", activity.features),
            ("구현에 필요한 것", activity.requires),
        ):
            if not items:
                continue
            lay.addSpacing(8)
            label = QLabel(title)
            label.setFont(QFont("", 13, QFont.Bold))
            lay.addWidget(label)
            for item in items:
                bullet = QLabel(f"•  {item}")
                bullet.setWordWrap(True)
                bullet.setStyleSheet("color: palette(mid);")
                lay.addWidget(bullet)

        lay.addStretch(1)
        self._body = _scroll(inner)
        self._root.addWidget(self._body)


# --- 스테이지 화면 -----------------------------------------------------------


class StaffView(QWidget):
    """오선지. 종횡비를 지켜 가운데 정렬로 그린다.

    `QSvgWidget`을 쓰지 않는 이유: 그쪽은 SVG를 위젯 크기에 그대로 늘여서
    오선이 세로로 눌리고 음표 머리가 찌그러진다. `QSvgRenderer`에
    `setAspectRatioMode(KeepAspectRatio)`를 걸어도 `QSvgWidget`이 돌려주는
    렌더러에는 반영되지 않는다(실측). 그래서 직접 그린다.
    """

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._renderer = QSvgRenderer(self)
        self._renderer.repaintNeeded.connect(self.update)

    def load(self, svg: bytes) -> bool:
        ok = self._renderer.load(QByteArray(svg))
        self.update()
        return ok

    def clear(self) -> None:
        self._renderer.load(QByteArray(b""))
        self.update()

    @property
    def has_content(self) -> bool:
        return self._renderer.isValid() and not self._renderer.viewBoxF().isEmpty()

    def paintEvent(self, event) -> None:
        if not self.has_content:
            return
        box = self._renderer.viewBoxF()
        area = self.rect()
        scale = min(area.width() / box.width(), area.height() / box.height())
        w, h = box.width() * scale, box.height() * scale
        target = QRectF(
            area.x() + (area.width() - w) / 2,
            area.y() + (area.height() - h) / 2,
            w,
            h,
        )
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        self._renderer.render(painter, target)


class StageView(QWidget):
    """스테이지별 문제 표시 + 답 입력.

    청음처럼 MIDI 건반으로 답하는 스테이지는 화면에 낼 것이 없어 빈 위젯이고,
    화성학처럼 화면에서 답을 만드는 스테이지는 `answered`로 응답을 올려보낸다.
    """

    answered = Signal(object)

    def show_question(self, question: Question) -> None:
        """새 문제. 입력 상태를 초기화한다."""

    def show_result(self, result: Result) -> None:
        """채점 결과. 입력을 잠그거나 정답을 덧붙일 때 쓴다."""

    def handle_key(self, event: QKeyEvent) -> bool:
        """이 스테이지가 처리한 키면 True. 나머지는 창이 처리한다."""
        return False


class MidiStageView(StageView):
    """MIDI 건반으로 답하는 스테이지. 화면에 낼 것이 없다."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFixedHeight(0)


class _Field(QLabel):
    """숫자 한 칸. 지금 입력받는 칸을 테두리로 표시한다."""

    def __init__(self, width: int = 76) -> None:
        super().__init__("–")
        self.setAlignment(Qt.AlignCenter)
        self.setFont(QFont("", 26, QFont.Bold))
        self.setFrameShape(QFrame.Box)
        self.setFixedSize(width, 56)
        self.set_active(False)

    def set_active(self, active: bool) -> None:
        self.setStyleSheet(
            "border: 2px solid palette(highlight); border-radius: 6px;"
            if active
            else "border: 1px solid palette(mid); border-radius: 6px;"
        )

    def set_value(self, value: int | None) -> None:
        self.setText("–" if value is None else str(value))


class IntervalStageView(StageView):
    """음정 구분 — 오선지 + 세 항목 입력.

    입력 순서를 도수 → 반음 수 → 성질로 고정했다. 두 가지 이유가 있다.

    1. 실제로 음정을 판별하는 순서와 같다(줄·칸을 세고, 반음을 세고, 표에서
       성질을 읽는다). 순서를 강제하는 것 자체가 연습이다.
    2. 성질 선택이 곧 제출이라 키를 서너 번만 누르면 끝난다. 반대로 자동
       제출을 "세 칸이 다 차면"으로 두면, 반음 수 12를 치려고 1을 누른
       순간 제출되어 버린다.

    겹증·겹감을 넣을 때는 `QUALITY_KEYS`에 두 줄을 더하면 된다 — theory는
    이미 계산한다.
    """

    def __init__(
        self, renderer: ScoreRenderer | None, parent: QWidget | None = None
    ) -> None:
        super().__init__(parent)
        self.renderer = renderer
        self._number: int | None = None
        self._semitones: int | None = None
        self._field = 0          # 0=도수, 1=반음
        self._locked = False

        lay = QVBoxLayout(self)
        lay.setSpacing(10)
        lay.setContentsMargins(0, 0, 0, 0)

        self.staff = StaffView()
        self.staff.setFixedHeight(170)
        self.staff.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        lay.addWidget(self.staff)

        self.staff_text = QLabel("")   # verovio가 없을 때의 대체 표시
        self.staff_text.setAlignment(Qt.AlignCenter)
        self.staff_text.setFont(QFont("", 22, QFont.Bold))
        self.staff_text.setVisible(renderer is None)
        self.staff.setVisible(renderer is not None)
        lay.addWidget(self.staff_text)

        row = QHBoxLayout()
        row.addStretch(1)
        self.number_field = _Field()
        row.addWidget(self.number_field)
        row.addWidget(QLabel("도"))
        row.addSpacing(18)
        self.semitone_field = _Field()
        row.addWidget(self.semitone_field)
        row.addWidget(QLabel("반음"))
        row.addStretch(1)
        lay.addLayout(row)

        quality_row = QHBoxLayout()
        self.quality_buttons: dict[str, QPushButton] = {}
        for quality, letter, _key in QUALITY_KEYS:
            btn = _flat_button(f"{quality}  ({letter})", height=44)
            btn.clicked.connect(lambda _=False, q=quality: self._choose(q))
            quality_row.addWidget(btn)
            self.quality_buttons[quality] = btn
        lay.addLayout(quality_row)

        self.hint = QLabel("숫자 키로 도수 → 반음 수, 성질을 고르면 제출됩니다")
        self.hint.setAlignment(Qt.AlignCenter)
        lay.addWidget(self.hint)

        self._sync()

    # --- StageView ---------------------------------------------------------

    def show_question(self, question: Question) -> None:
        self._number = None
        self._semitones = None
        self._field = 0
        self._locked = False
        self.hint.setText("도수를 세어 숫자 키로 입력하세요")
        self._sync()

        if not isinstance(question, IntervalQuestion):
            return
        if self.renderer is None:
            self.staff_text.setText(f"{question.lower.name}   {question.upper.name}")
            return
        try:
            self.staff.load(self.renderer.render_interval(question.lower, question.upper))
        except Exception as exc:  # 악보가 없어도 문제는 계속 풀 수 있어야 한다
            self.staff.setVisible(False)
            self.staff_text.setVisible(True)
            self.staff_text.setText(f"{question.lower.name}   {question.upper.name}")
            print(f"악보 렌더 실패: {exc}")

    def show_result(self, result: Result) -> None:
        self._locked = True
        self.hint.setText("")

    def handle_key(self, event: QKeyEvent) -> bool:
        if self._locked:
            return False
        key = event.key()

        for quality, _letter, shortcut in QUALITY_KEYS:
            if key == shortcut:
                self._choose(quality)
                return True

        if Qt.Key_0 <= key <= Qt.Key_9:
            self._digit(key - Qt.Key_0)
            return True
        if key in (Qt.Key_Backspace, Qt.Key_Delete):
            self._backspace()
            return True
        if key in (Qt.Key_Tab, Qt.Key_Right, Qt.Key_Left):
            self._field = 1 - self._field
            self._sync()
            return True
        return False

    # --- 입력 --------------------------------------------------------------

    def _digit(self, digit: int) -> None:
        if self._field == 0:
            if not 1 <= digit <= 9:
                self.hint.setText("도수는 1~9입니다")
                return
            self._number = digit
            self._field = 1          # 도수는 한 자리라 바로 다음 칸으로
            self.hint.setText("반음 수를 세어 입력하세요 (두 자리 가능)")
        else:
            grown = digit if self._semitones is None else self._semitones * 10 + digit
            self._semitones = grown if grown <= 24 else digit
            self.hint.setText("성질을 고르면 제출됩니다")
        self._sync()

    def _backspace(self) -> None:
        if self._field == 1 and self._semitones is not None:
            self._semitones = self._semitones // 10 or None
        elif self._field == 1:
            self._field = 0
        else:
            self._number = None
        self._sync()

    def _choose(self, quality: str) -> None:
        if self._locked:
            return
        if self._number is None or self._semitones is None:
            self.hint.setText("도수와 반음 수를 먼저 입력하세요")
            return
        self.answered.emit(IntervalResponse(self._number, self._semitones, quality))

    def _sync(self) -> None:
        self.number_field.set_value(self._number)
        self.semitone_field.set_value(self._semitones)
        self.number_field.set_active(self._field == 0)
        self.semitone_field.set_active(self._field == 1)


def make_stage_view(
    config: SessionConfig, renderer: ScoreRenderer | None
) -> StageView:
    if config.stage is Stage.INTERVAL_ID:
        return IntervalStageView(renderer)
    return MidiStageView()


# --- 세션 컨트롤러 (문항형 전용) ------------------------------------------------


class SessionController(QObject):
    """Qt 타이머·MIDI와 `Session`을 잇는 얇은 층.

    음악적 판단은 하나도 하지 않는다. 무엇이 정답인지, 언제 확정할지는
    Session·Grader·NoteCollector가 정하고 여기서는 타이머만 건다.
    오디오와 MIDI를 생성자로 주입받으므로(DIP) 테스트에서 갈아끼울 수 있다.

    **문항형(Kind.QUIZ) 전용이다.** 코드 학습 같은 연주형은 문제 큐가 아니라
    연속 타임라인이고, 판정도 정답/오답이 아니라 빗나간 밀리초다. 별도의
    트랜스포트 컨트롤러가 필요하다.
    """

    question_ready = Signal(object)   # Question — 락아웃 시작
    listening = Signal(object)        # Question — 입력 받기 시작
    ticked = Signal(float, float)     # 남은 초, 남은 비율(0~1)
    judged = Signal(object)           # Result
    session_ended = Signal(list)      # list[Result]
    progress_changed = Signal(str, int)  # "문제 3 / 10", 점수

    def __init__(
        self,
        config: SessionConfig,
        audio: AudioBackend,
        midi: MidiInput,
        parent: QObject | None = None,
    ) -> None:
        super().__init__(parent)
        self.config = config
        self.audio = audio
        self.midi = midi
        self.session = Session(
            config,
            make_generator(config),
            make_grader(config.difficulty.grading),
        )

        self.midi.note_on.connect(self.on_note_on)

        self._clock = QElapsedTimer()
        self._tick = QTimer(self)
        self._tick.setInterval(50)
        self._tick.timeout.connect(self._on_tick)

        # 마지막 note-on 이후 chord_hold_ms 조용하면 확정 (문서 4절)
        self._confirm = QTimer(self)
        self._confirm.setSingleShot(True)
        self._confirm.setInterval(max(config.chord_hold_ms, 0))
        self._confirm.timeout.connect(self._confirm_input)

    # --- 진행 -------------------------------------------------------------

    def start(self) -> None:
        self.session.start()
        self._next_question()

    def stop(self) -> None:
        self._tick.stop()
        self._confirm.stop()
        self.audio.stop()

    def _next_question(self) -> None:
        question = self.session.next_question()
        if question is None:
            self.session_ended.emit(list(self.session.results))
            return

        self._emit_progress()
        self.question_ready.emit(question)
        # 락아웃이 풀릴 때까지 Session.accepting이 False라 입력은 전부 버려진다.
        QTimer.singleShot(self.config.input_lockout_ms, self._begin_listening)

    def _begin_listening(self) -> None:
        question = self.session.current
        if question is None or self.session.finished:
            return
        self.session.begin_listening()
        self.listening.emit(question)
        self._play()
        self._clock.start()
        if self.config.difficulty.time_limit_sec is not None:
            self._tick.start()

    def _emit_progress(self) -> None:
        self.progress_changed.emit(self.session.progress_text, self.session.score)

    # --- 재생 -------------------------------------------------------------

    def _play(self) -> None:
        question = self.session.current
        if question is None or not self.session.may_play():
            return
        self.session.note_played()
        self.audio.play_notes(
            list(question.answer_notes),
            self.config.play_duration_sec,
            mode=self.config.difficulty.play_mode,
        )

    @Slot()
    def replay(self) -> None:
        if self.session.accepting:
            self._play()

    # --- 입력 -------------------------------------------------------------

    @Slot(int, int)
    def on_note_on(self, note: int, velocity: int) -> None:
        if self.config.echo_back:
            self.audio.play_notes([note], 0.5, velocity=velocity)
        if not self.session.collect(note):
            # 아직 화음이 끝나지 않았을 수 있다. 조용해질 때까지 기다린다.
            if self.session.accepting:
                self._confirm.start()
            return
        self._confirm_input()

    @Slot(object)
    def on_response(self, response: object) -> None:
        """화면에서 만든 답(음정 등). MIDI 경로와 같은 게이트를 지난다."""
        self._settle(self.session.respond(response, self._elapsed()))

    def _confirm_input(self) -> None:
        self._confirm.stop()
        self._settle(self.session.submit(self._elapsed()))

    @Slot()
    def _on_tick(self) -> None:
        limit = self.config.difficulty.time_limit_sec
        if limit is None:
            return
        remaining = limit - self._elapsed()
        if remaining <= 0:
            self._settle(self.session.time_out(self._elapsed()))
            return
        self.ticked.emit(remaining, remaining / limit)

    def _elapsed(self) -> float:
        return self._clock.elapsed() / 1000.0

    def _settle(self, result: Result | None) -> None:
        if result is None:
            return
        self._tick.stop()
        self._emit_progress()
        self.judged.emit(result)
        QTimer.singleShot(self.config.feedback_ms, self._next_question)


# --- 문항형 화면 --------------------------------------------------------------


class QuizPage(QWidget):
    """진행·타이머·판정 표시(크롬) + 가운데에 끼운 스테이지 화면."""

    replay_requested = Signal()

    def __init__(self, stage_view: StageView, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.stage_view = stage_view
        lay = QVBoxLayout(self)
        lay.setSpacing(10)

        head = QHBoxLayout()
        self.progress_label = QLabel("")
        self.score_label = QLabel("")
        self.score_label.setAlignment(Qt.AlignRight)
        head.addWidget(self.progress_label)
        head.addWidget(self.score_label)
        lay.addLayout(head)

        self.timer_bar = QProgressBar()
        self.timer_bar.setRange(0, 1000)
        self.timer_bar.setTextVisible(False)
        self.timer_bar.setFixedHeight(10)
        lay.addWidget(self.timer_bar)

        self.time_label = QLabel("")
        self.time_label.setAlignment(Qt.AlignCenter)
        lay.addWidget(self.time_label)

        lay.addWidget(stage_view)

        lay.addStretch(1)
        self.status_label = QLabel("")
        self.status_label.setFont(QFont("", 26, QFont.Bold))
        self.status_label.setAlignment(Qt.AlignCenter)
        self.status_label.setWordWrap(True)
        lay.addWidget(self.status_label)

        self.detail_label = QLabel("")
        self.detail_label.setAlignment(Qt.AlignCenter)
        self.detail_label.setWordWrap(True)
        lay.addWidget(self.detail_label)
        lay.addStretch(1)

        replay = _flat_button("다시 듣기 (Space)", height=40)
        replay.clicked.connect(self.replay_requested)
        lay.addWidget(replay)

    @Slot(str, int)
    def set_progress(self, text: str, score: int) -> None:
        self.progress_label.setText(text)
        self.score_label.setText(f"점수 {score}")

    @Slot(object)
    def show_lockout(self, question: Question) -> None:
        self.status_label.setText("···")
        self.detail_label.setText("")
        self.timer_bar.setValue(1000)
        self.time_label.setText("")
        self.stage_view.show_question(question)

    @Slot(object)
    def show_listening(self, question: Question) -> None:
        self.status_label.setText("들어보세요")
        self.detail_label.setText(question.prompt)

    @Slot(float, float)
    def set_time(self, remaining: float, ratio: float) -> None:
        self.timer_bar.setValue(int(ratio * 1000))
        self.time_label.setText(f"{remaining:.1f}초")

    @Slot(object)
    def show_judgement(self, result: Result) -> None:
        self.timer_bar.setValue(0)
        self.time_label.setText("")
        if result.correct:
            self.status_label.setText("정답")
        elif result.timed_out:
            self.status_label.setText("시간 초과")
        else:
            self.status_label.setText("오답")
        self.detail_label.setText(result.detail)
        self.stage_view.show_result(result)


class ResultPage(QWidget):
    restart_requested = Signal()
    catalog_requested = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        lay = QVBoxLayout(self)

        self.title = QLabel("")
        self.title.setFont(QFont("", 28, QFont.Bold))
        self.title.setAlignment(Qt.AlignCenter)
        lay.addWidget(self.title)

        self.list = QListWidget()
        lay.addWidget(self.list, 1)

        row = QHBoxLayout()
        again = _flat_button("한 번 더", height=44)
        again.clicked.connect(self.restart_requested)
        row.addWidget(again)
        back = _flat_button("다른 연습 고르기", height=44)
        back.clicked.connect(self.catalog_requested)
        row.addWidget(back)
        lay.addLayout(row)

    def show_results(self, results: list[Result], total: int) -> None:
        score = sum(1 for r in results if r.correct)
        self.title.setText(f"{score} / {total}")
        self.list.clear()
        for r in results:
            mark = "○" if r.correct else "×"
            tail = "시간 초과" if r.timed_out else f"{r.seconds:.1f}초"
            line = f"{r.index:2d}.  {mark}  {r.question.answer_text}   {tail}"
            if not r.correct and not r.timed_out:
                line += f"   → 낸 답 {_response_text(r.response)}"
            self.list.addItem(line)


# --- 창 ----------------------------------------------------------------------


class MainWindow(QWidget):
    def __init__(self, audio: AudioBackend | None = None) -> None:
        super().__init__()
        self.setWindowTitle("화성학·청음 연습")
        self.resize(660, 700)

        self.audio = audio or make_default_backend()
        self.score_renderer = make_score_renderer()
        self.midi = MidiInput(self)

        self.nav = NavBar()
        self.home_page = HomePage()
        self.catalog_page = CatalogPage()
        self.planned_page = PlannedPage()
        self.result_page = ResultPage()

        self.pages = QStackedWidget(self)
        for page in (
            self.home_page,
            self.catalog_page,
            self.planned_page,
            self.result_page,
        ):
            self.pages.addWidget(page)

        root = QVBoxLayout(self)
        root.addWidget(self.nav)
        root.addWidget(self.pages, 1)

        # 문항형 활동별 (컨트롤러, 화면). 세션마다 새로 만들지 않고 캐시한다.
        # 쉬고 있는 컨트롤러도 note_on을 받지만, 그쪽 Session은 LISTENING이
        # 아니어서 입력을 전부 버린다(session.Session.accepting).
        self._quiz: dict[str, tuple[SessionController, QuizPage]] = {}
        self.domain: Domain | None = None
        self.activity: Activity | None = None
        self.controller: SessionController | None = None
        self.quiz_page: QuizPage | None = None

        self.nav.back_requested.connect(self.go_back)
        self.home_page.domain_chosen.connect(self.open_domain)
        self.home_page.rescan_requested.connect(self.rescan_ports)
        self.catalog_page.activity_chosen.connect(self.open_activity)
        self.midi.error.connect(self.home_page.set_status)
        self.result_page.restart_requested.connect(self.restart_activity)
        self.result_page.catalog_requested.connect(
            lambda: self.open_domain(self.domain) if self.domain else self.go_home()
        )

        self.rescan_ports()
        self.go_home()

    # --- 네비게이션 ---------------------------------------------------------

    @Slot()
    def go_home(self) -> None:
        self._stop_active()
        self.domain = self.activity = None
        self.nav.set_path()
        self.pages.setCurrentWidget(self.home_page)

    @Slot(object)
    def open_domain(self, domain: Domain) -> None:
        self._stop_active()
        self.domain = domain
        self.activity = None
        self.catalog_page.show_domain(domain)
        self.nav.set_path(domain.value)
        self.pages.setCurrentWidget(self.catalog_page)

    @Slot(object)
    def open_activity(self, activity: Activity) -> None:
        self.activity = activity
        self.nav.set_path(activity.domain.value, activity.title)

        if activity.status is Status.PLANNED or activity.config is None:
            self.planned_page.show_activity(activity)
            self.pages.setCurrentWidget(self.planned_page)
            return
        if activity.kind is not Kind.QUIZ:
            # 연주형·도구형은 QuizPage가 감당하지 못한다. 카탈로그에서 READY로
            # 올리기 전에 전용 화면을 먼저 만들 것.
            self.planned_page.show_activity(activity)
            self.pages.setCurrentWidget(self.planned_page)
            return

        self._start_quiz(activity)

    @Slot()
    def restart_activity(self) -> None:
        if self.activity is not None:
            self.open_activity(self.activity)

    @Slot()
    def go_back(self) -> None:
        if self.pages.currentWidget() is self.home_page:
            return
        if self.domain is not None and self.activity is not None:
            self.open_domain(self.domain)
        else:
            self.go_home()

    # --- 문항형 -------------------------------------------------------------

    def _start_quiz(self, activity: Activity) -> None:
        controller, page = self._quiz_for(activity)
        self.controller, self.quiz_page = controller, page
        if activity.needs_midi and self.home_page.port_name:
            self.midi.open(self.home_page.port_name)
        self.pages.setCurrentWidget(page)
        controller.start()

    def _quiz_for(self, activity: Activity) -> tuple[SessionController, QuizPage]:
        cached = self._quiz.get(activity.id)
        if cached is not None:
            return cached

        assert activity.config is not None
        controller = SessionController(activity.config, self.audio, self.midi, self)
        page = QuizPage(make_stage_view(activity.config, self.score_renderer))
        self.pages.addWidget(page)

        controller.progress_changed.connect(page.set_progress)
        controller.question_ready.connect(page.show_lockout)
        controller.listening.connect(page.show_listening)
        controller.ticked.connect(page.set_time)
        controller.judged.connect(page.show_judgement)
        controller.session_ended.connect(self.show_results)
        page.replay_requested.connect(controller.replay)
        page.stage_view.answered.connect(controller.on_response)

        self._quiz[activity.id] = (controller, page)
        return controller, page

    def _stop_active(self) -> None:
        if self.controller is not None:
            self.controller.stop()

    @Slot(list)
    def rescan_ports(self) -> None:
        self.home_page.set_ports(MidiInput.ranked_ports())

    @Slot(list)
    def show_results(self, results: list[Result]) -> None:
        self.midi.close()
        total = self.activity.config.question_count if self.activity else len(results)
        self.result_page.show_results(results, total)
        self.nav.set_path(
            self.domain.value if self.domain else "",
            self.activity.title if self.activity else "",
            "결과",
        )
        self.pages.setCurrentWidget(self.result_page)

    # --- 키보드 --------------------------------------------------------------

    def keyPressEvent(self, event: QKeyEvent) -> None:
        page = self.quiz_page
        if event.isAutoRepeat() or page is None or self.pages.currentWidget() is not page:
            super().keyPressEvent(event)
            return
        if event.key() == Qt.Key_Space:
            if self.controller is not None:
                self.controller.replay()
            return
        # 스테이지가 먼저 본다. 음정 스테이지에서는 숫자·성질 키가 여기서 걸린다.
        if page.stage_view.handle_key(event):
            return
        note = KEY_FALLBACK.get(event.key())
        if note is not None and self.controller is not None:
            self.controller.on_note_on(note, 80)
            return
        super().keyPressEvent(event)

    def closeEvent(self, event) -> None:
        for controller, _page in self._quiz.values():
            controller.stop()
        self.midi.close()
        super().closeEvent(event)


def main() -> int:
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
