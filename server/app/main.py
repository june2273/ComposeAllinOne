"""분석 사이드카 — 스템 분리와 멜로디 f0.

**웹이 못 하는 것만 한다.** BPM·박자·조성은 브라우저 안에서 이미 끝나므로
(`web/src/core/analysis`) 여기로 오지 않는다. 여기 있는 것은 학습된 모델이
필요한 두 가지뿐이고, 그래서 이 서버가 꺼져 있어도 앱은 그대로 동작한다 —
피아노 음원이 없으면 사인 신스로 나는 것과 같은 방침이다.

**음악적 판단을 하지 않는다.** 노트 분할·양자화·MIDI·악보는 전부 웹의
`core/transcribe`가 한다. 여기가 내보내는 것은 신호(스템 WAV)와 숫자(f0
커브)뿐이라, 더 나은 모델로 갈아끼워도 위층이 안 바뀐다.

```bash
cd server
uv venv && uv pip install -r requirements.txt   # 또는 python -m venv .venv
.venv/bin/uvicorn app.main:app --port 8420
```
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, Callable

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import melody, stems
from .audio import process_vocal, read_audio, write_audio
from .health import Probe
from .jobs import Job, JobStore, digest_of

VERSION = "0.1.0"

#: 기본 포트. 5173(vite)·5178과 겹치지 않게 멀리 잡았다.
DEFAULT_PORT = 8420

ROOT = Path(__file__).resolve().parent.parent
store = JobStore(ROOT / "cache")
probe = Probe()

@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """기동 직후 배경에서 모델을 한 번씩 굴려 본다(`health.py` 첫 주석).

    **서버가 뜨는 것을 막지 않는다** — `probe.start()`는 스레드를 띄우고 바로
    돌아온다. `/health`는 진단이 끝나기 전에도 즉시 답하고, 그때는 `checking`이다.
    """
    probe.start(
        {
            "stems": (stems.available, stems.selftest),
            "melody": (melody.available, melody.selftest),
        }
    )
    yield


app = FastAPI(title="musictest analysis sidecar", version=VERSION, lifespan=lifespan)

# 로컬 개발 서버에서만 부른다. 이 서버는 사용자의 파일을 다루므로 아무 곳에나
# 열어 둘 이유가 없다 — 배포 형태가 정해지면 여기부터 다시 볼 것.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5178",
        "http://127.0.0.1:5178",
    ],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    """웹이 이걸 보고 카드를 열지 잠글지 정한다.

    **여기서 모델을 로드하지 않는다.** 진단은 기동 시 배경에서 돌고, 이
    핸들러는 그때까지 알아낸 것만 즉시 돌려준다 — 웹의 감지 타임아웃이 짧아야
    사이드카가 없는 환경에서 화면이 굳지 않는다.

    `models.*`는 **지금 쓸 수 있는가**다. 진단 전에는 설치 여부로 낙관하고,
    진단이 끝나면 실제 결과로 바뀐다. 무엇이 왜 안 되는지는 `checks.*`에 있다.
    """
    checks = {"stems": probe.get("stems"), "melody": probe.get("melody")}
    installed = {"stems": stems.available, "melody": melody.available}
    return {
        "ok": True,
        "version": VERSION,
        "device": stems.device(),
        "models": {
            name: installed[name]() if check.status == "checking" else check.usable
            for name, check in checks.items()
        },
        "checks": {name: check.as_json() for name, check in checks.items()},
    }


def _usable(name: str, installed: Callable[[], bool]) -> bool:
    """이 모델을 지금 불러도 되는가.

    자가진단이 `broken`이라 말했으면 **부르지 않는다.** 어차피 같은 예외로
    죽는데, 그러면 이미 수 분이 걸린 스템 분리 결과까지 함께 버려진다. 되는
    데까지 가고 안 되는 칸만 비우는 편이 낫다 — 무엇이 왜 안 되는지는 `/health`의
    `checks`가 이미 화면에 띄우고 있다.
    """
    status = probe.get(name).status
    return installed() if status == "checking" else status == "ok"


def _pipeline(job: Job, source: Path, out_dir: Path) -> Path:
    """분리 → 후처리 → f0. 진행률의 배분은 실측 비율에 맞춘 어림값이다."""
    report = store.progress(job)
    has_stems = _usable("stems", stems.available)
    has_melody = _usable("melody", melody.available)

    report("파일 읽는 중", 0.02)
    audio = read_audio(source)

    if has_stems:
        stem_dir = out_dir / "stems"
        stem_dir.mkdir(parents=True, exist_ok=True)
        paths = stems.separate(
            audio,
            stem_dir,
            # 분리가 전체의 앞 80%를 차지한다고 본다
            progress=lambda stage, ratio: report(stage, 0.05 + ratio * 0.75),
        )
        vocal_path = paths.get("vocals")
    else:
        # 모델이 없으면 원본을 보컬로 취급한다. 반주가 섞여 f0가 나빠지지만
        # **파이프라인이 끝까지 도는 것**이 진단에 훨씬 쓸모 있다.
        vocal_path = None

    report("보컬 후처리", 0.82)
    raw = read_audio(vocal_path) if vocal_path else audio
    processed = process_vocal(raw)
    processed_path = out_dir / "vocal_processed.wav"
    write_audio(processed_path, processed)

    report("멜로디 추출", 0.88)
    curve = (
        melody.extract_f0(processed_path)
        if has_melody
        else melody.silent_curve(processed)
    )
    (out_dir / "f0.json").write_text(json.dumps(curve), encoding="utf-8")

    (out_dir / "meta.json").write_text(
        json.dumps(
            {
                "durationSec": round(audio.duration, 3),
                "hasStems": has_stems,
                "hasMelody": has_melody,
                "stems": sorted(p.stem for p in (out_dir / "stems").glob("*.wav")),
            }
        ),
        encoding="utf-8",
    )
    report("완료", 1.0)
    return out_dir


@app.post("/jobs")
async def create_job(file: UploadFile) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다")

    digest = digest_of(data)
    out_dir = store.slot(digest)
    # **둘 다 있어야 캐시 적중이다.** `f0.json`만 보면, 그 사이에 서버가 죽어
    # `meta.json`을 못 쓴 디렉터리가 영영 "완료"로 잡힌다 — 작업은 즉시 끝나고
    # 웹은 `/meta`에서 404를 받아 "결과를 받지 못했습니다"만 본다. 캐시를 손으로
    # 지우기 전까지 그 곡은 계속 실패한다.
    if (out_dir / "f0.json").exists() and (out_dir / "meta.json").exists():
        # 캐시 적중. 작업을 만들되 곧바로 끝난 것으로 둔다 — 웹은 같은 경로로
        # 폴링하면 되므로 "캐시였다"는 것을 몰라도 된다.
        job = store.submit(lambda _job: out_dir)
        return {**job.snapshot(), "cached": True}

    out_dir.mkdir(parents=True, exist_ok=True)
    source = out_dir / f"input{Path(file.filename or 'audio.wav').suffix or '.wav'}"
    source.write_bytes(data)
    # 해시를 키로 준다 — 같은 곡이 이미 돌고 있으면 그 작업을 함께 쓴다
    job = store.submit(lambda j: _pipeline(j, source, out_dir), key=digest)
    return {**job.snapshot(), "cached": False}


@app.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="없는 작업입니다")
    return job.snapshot()


@app.delete("/jobs/{job_id}")
def cancel_job(job_id: str) -> dict:
    return {"cancelled": store.cancel(job_id)}


def _finished(job_id: str) -> Path:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="없는 작업입니다")
    if job.error:
        raise HTTPException(status_code=409, detail=job.error)
    if not job.done or job.out_dir is None:
        raise HTTPException(status_code=425, detail="아직 끝나지 않았습니다")
    return job.out_dir


@app.get("/jobs/{job_id}/f0")
def job_f0(job_id: str) -> JSONResponse:
    path = _finished(job_id) / "f0.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="f0가 없습니다")
    return JSONResponse(json.loads(path.read_text(encoding="utf-8")))


@app.get("/jobs/{job_id}/meta")
def job_meta(job_id: str) -> JSONResponse:
    path = _finished(job_id) / "meta.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="메타가 없습니다")
    return JSONResponse(json.loads(path.read_text(encoding="utf-8")))


@app.get("/jobs/{job_id}/audio/{name}")
def job_audio(job_id: str, name: str) -> FileResponse:
    """스템과 처리된 보컬. **이름을 그대로 경로에 쓰지 않는다.**

    사용자가 준 문자열이 파일 경로로 들어가면 `../`로 서버의 아무 파일이나
    읽힌다. 허용 목록으로만 고른다.
    """
    out_dir = _finished(job_id)
    allowed = {
        "vocal_processed": out_dir / "vocal_processed.wav",
        **{stem: out_dir / "stems" / f"{stem}.wav" for stem in stems.STEM_NAMES},
    }
    path = allowed.get(name)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="없는 오디오입니다")
    return FileResponse(path, media_type="audio/wav", filename=f"{name}.wav")
