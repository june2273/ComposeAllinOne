"""MIDI 입력.

rtmidi 콜백은 별도 스레드에서 실행된다. 거기서 Qt 위젯을 직접 건드리면
간헐적 크래시가 나므로, QObject 시그널로만 메인 스레드에 넘긴다.
Qt의 AutoConnection이 emit 시점의 스레드와 수신자의 스레드가 다른 것을
감지해 자동으로 큐잉해준다. 이 파일 밖에서 콜백 스레드를 만질 일은 없어야 한다.
"""

from __future__ import annotations

import mido
from PySide6.QtCore import QObject, Signal

# 컨트롤러 하나가 포트를 여러 개 내보내는 경우가 많다. 예를 들어 KeyLab
# Essential은 MIDI / DINTHRU / MCU-HUI / ALV 네 개를 띄우는데, 건반 노트가
# 나오는 건 MIDI 포트뿐이고 MCU/HUI 포트는 트랜스포트 버튼을 노트 메시지로
# 보내서 오답 판정을 유발한다. 목록 맨 위에 올바른 포트가 오도록 정렬한다.
# 포트 이름 해석은 MIDI의 관심사이므로 UI가 아니라 여기에 둔다.
PORT_AVOID = ("mcu", "hui", "thru", "alv", "daw", "control")


def rank_port(name: str) -> int:
    low = name.lower()
    if any(k in low for k in PORT_AVOID):
        return 2
    return 0 if "midi" in low else 1


class MidiInput(QObject):
    note_on = Signal(int, int)   # (midi_note, velocity)
    note_off = Signal(int)       # (midi_note)
    error = Signal(str)

    def __init__(self, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._port: mido.ports.BaseInput | None = None
        self.port_name: str | None = None

    @staticmethod
    def available_ports() -> list[str]:
        try:
            return mido.get_input_names()
        except Exception:
            return []

    @classmethod
    def ranked_ports(cls) -> list[str]:
        """건반 노트가 나올 가능성이 높은 포트부터 정렬해 돌려준다."""
        return sorted(cls.available_ports(), key=rank_port)

    def open(self, name: str) -> bool:
        self.close()
        try:
            self._port = mido.open_input(name, callback=self._on_message)
        except Exception as exc:
            self.error.emit(f"{name} 열기 실패: {exc}")
            return False
        self.port_name = name
        return True

    def close(self) -> None:
        if self._port is not None:
            try:
                self._port.close()
            except Exception:
                pass
        self._port = None
        self.port_name = None

    @property
    def is_open(self) -> bool:
        return self._port is not None

    # --- rtmidi 콜백 스레드에서 호출됨 ---
    def _on_message(self, msg: "mido.Message") -> None:
        if msg.type == "note_on" and msg.velocity > 0:
            self.note_on.emit(msg.note, msg.velocity)
        elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
            # 벨로시티 0인 note_on을 note_off로 쓰는 키보드가 많다
            self.note_off.emit(msg.note)
