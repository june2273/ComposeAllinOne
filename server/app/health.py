"""모델이 정말로 도는가 — 기동 시 한 번 확인한다.

## 왜 `import`만으로는 모자라는가

`find_spec`이 성공해도 실행에서 죽는 부류가 있다. 실측으로 걸린 것은
`resampy`(librosa → basic-pitch)가 `pkg_resources`를 import하는 경우다 —
setuptools 81이 그것을 없앴는데, **`import basic_pitch`는 여전히 성공한다.**
그래서 서버가 뜨고 `/health`가 초록으로 나오고, 사용자는 곡을 올리고, 수 분짜리
스템 분리가 끝난 **다음에** `ModuleNotFoundError`를 본다.

## 왜 `/health` 안에서 돌리지 않는가

웹의 감지 타임아웃이 1.2초다(`platform/sidecar.ts`). 모델 로드는 그보다
오래 걸리므로 `/health`가 진단을 기다리면 **사이드카가 없는 환경에서 화면이
그만큼 굳는다** — 늘리지 말라고 CLAUDE.md에 못박아 둔 바로 그 시간이다.

그래서 기동 직후 배경 스레드에서 한 번 돌리고, `/health`는 **그 시점까지 알아낸
것**을 즉시 돌려준다. 진단 전에는 `checking`이고, 사용자가 실제로 분석을 누를
때쯤이면 이미 끝나 있다.
"""

from __future__ import annotations

import threading
import traceback
from dataclasses import dataclass
from typing import Callable, Literal

Status = Literal["checking", "ok", "unavailable", "broken"]


@dataclass
class Check:
    """모델 하나의 진단 결과.

    `unavailable`(안 깔림)과 `broken`(깔렸는데 안 돎)을 가르는 것이 핵심이다 —
    화면이 보여줄 문장이 다르다. 앞은 "pip install 하세요", 뒤는 **무엇이
    잘못됐는지**다.
    """

    status: Status = "checking"
    detail: str | None = None

    @property
    def usable(self) -> bool:
        return self.status == "ok"

    def as_json(self) -> dict:
        return {"status": self.status, "detail": self.detail}


class Probe:
    """모델별 진단 상태. 배경에서 채워지고 `/health`가 읽는다."""

    def __init__(self) -> None:
        self._checks: dict[str, Check] = {}
        self._lock = threading.Lock()

    def get(self, name: str) -> Check:
        with self._lock:
            return self._checks.get(name, Check())

    def _set(self, name: str, check: Check) -> None:
        with self._lock:
            self._checks[name] = check

    def run(self, name: str, available: Callable[[], bool], test: Callable[[], None]) -> None:
        """진단 하나를 지금 이 스레드에서 돌린다."""
        if not available():
            self._set(name, Check("unavailable", "설치되지 않았다"))
            return
        try:
            test()
        except BaseException as failure:  # noqa: BLE001 — 무엇이 터지든 알려야 한다
            # 스택은 로그에만. 화면에는 한 줄이 나간다.
            traceback.print_exc()
            self._set(name, Check("broken", f"{type(failure).__name__}: {failure}"))
            return
        self._set(name, Check("ok"))

    def start(self, jobs: dict[str, tuple[Callable[[], bool], Callable[[], None]]]) -> None:
        """배경에서 전부 돌린다. 서버 기동을 막지 않는다.

        **순차로 돈다.** 둘 다 torch를 로드하므로 병렬로 돌리면 메모리만 두 배
        쓰고 빨라지지도 않는다.
        """

        def worker() -> None:
            for name, (available, test) in jobs.items():
                self.run(name, available, test)

        threading.Thread(target=worker, daemon=True, name="selftest").start()

    def as_json(self) -> dict[str, dict]:
        with self._lock:
            names = list(self._checks)
        return {name: self.get(name).as_json() for name in names}
