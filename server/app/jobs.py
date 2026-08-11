"""작업 큐 — 스템 분리가 수 분 걸리므로 요청 하나로 기다릴 수 없다.

**HTTP 하나에 다 담지 않는 이유**는 시간이다. 브라우저·프록시의 유휴 타임아웃은
보통 60~120초인데 4분 곡의 htdemucs는 그보다 오래 걸린다. 그래서 접수(POST)와
진행 확인(GET)을 가르고, 웹은 폴링한다 — 기존 워커 진행률 UI와 같은 모양이라
화면 쪽에 새 개념이 늘지 않는다.

**캐시가 사실상 필수다.** 같은 파일을 다시 열 때마다 몇 분을 기다릴 수는 없다.
내용 해시로 디렉터리를 잡으므로 파일 이름이 달라도 같은 곡이면 즉시 끝난다.
"""

from __future__ import annotations

import hashlib
import threading
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable


@dataclass
class Job:
    id: str
    stage: str = "대기"
    ratio: float = 0.0
    done: bool = False
    error: str | None = None
    #: 결과가 놓인 디렉터리. 완료 전에는 None
    out_dir: Path | None = None
    cancelled: bool = field(default=False)

    def snapshot(self) -> dict:
        return {
            "jobId": self.id,
            "stage": self.stage,
            "ratio": round(self.ratio, 4),
            "done": self.done,
            "error": self.error,
        }


class Cancelled(Exception):
    """취소 신호. 워커 안에서 던져지고 여기서만 잡힌다."""


class JobStore:
    """메모리 안의 작업 표.

    프로세스가 죽으면 사라진다 — 그래도 되는 이유는 **결과가 캐시에 남기**
    때문이다. 다시 올리면 캐시에 맞아 즉시 끝난다.
    """

    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, Job] = {}
        #: 같은 곡(내용 해시)으로 지금 돌고 있는 작업. 아래 `submit` 주석 참조
        self._by_key: dict[str, Job] = {}
        self._lock = threading.Lock()

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if job is None or job.done:
            return False
        job.cancelled = True
        return True

    def submit(self, work: Callable[[Job], Path], key: str | None = None) -> Job:
        """작업을 배경 스레드에 올린다.

        `key`(내용 해시)를 주면 **같은 곡이 이미 돌고 있을 때 그 작업을 그대로
        돌려준다.** 캐시는 `f0.json`이 **다 쓰인 뒤**에야 적중하므로, 분리가
        도는 몇 분 동안 같은 파일을 또 올리면 캐시를 비껴가 htdemucs가 둘
        돌면서 **같은 디렉터리의 같은 WAV에 동시에 쓴다.** 탭을 두 개 열거나
        새로고침 후 다시 올리면 나는 일이다.

        확인과 등록이 같은 락 안에 있어야 한다 — 갈라 두면 둘 다 "없다"를 보고
        각자 등록하는 창이 남는다.
        """
        job = Job(id=uuid.uuid4().hex[:12])
        with self._lock:
            if key is not None:
                running = self._by_key.get(key)
                if running is not None and not running.done and not running.cancelled:
                    return running
                self._by_key[key] = job
            self._jobs[job.id] = job

        def run() -> None:
            try:
                job.out_dir = work(job)
                job.stage = "완료"
                job.ratio = 1.0
            except Cancelled:
                job.error = "취소했습니다"
            except Exception as failure:  # noqa: BLE001 — 무엇이든 화면에 알린다
                traceback.print_exc()
                job.error = f"{type(failure).__name__}: {failure}"
            finally:
                job.done = True

        threading.Thread(target=run, daemon=True).start()
        return job

    def progress(self, job: Job) -> Callable[[str, float], None]:
        """워커에게 넘길 진행률 보고 함수. **취소 확인을 겸한다.**

        별도의 취소 확인 지점을 두면 반드시 빠뜨리는 자리가 생긴다. 진행률을
        보고하는 곳이 곧 중단 가능한 지점이므로 하나로 묶는다.
        """

        def report(stage: str, ratio: float) -> None:
            if job.cancelled:
                raise Cancelled
            job.stage = stage
            job.ratio = max(0.0, min(1.0, ratio))

        return report

    def slot(self, digest: str) -> Path:
        return self.cache_dir / digest


def digest_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]
