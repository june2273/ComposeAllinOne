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

from . import melody, stems, structure
from .audio import process_vocal, read_audio, write_audio
from .health import Probe
from .jobs import Cancelled, Job, JobStore, digest_of

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
            "structure": (structure.available, structure.selftest),
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
    checks = {
        "stems": probe.get("stems"),
        "melody": probe.get("melody"),
        "structure": probe.get("structure"),
    }
    installed = {
        "stems": stems.available,
        "melody": melody.available,
        "structure": structure.available,
    }
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


#: 재사용할 스템이 원곡보다 이만큼 넘게 짧으면 쓰다 만 것으로 본다(초).
#: 분리는 샘플 단위로 정렬되므로 정상이면 차이가 0에 가깝다.
_STEM_TOLERANCE_SEC = 0.5


def _stem_paths(out_dir: Path, duration: float | None = None) -> dict[str, Path]:
    """이미 분리해 둔 스템. 성한 한 벌이 아니면 빈 표를 준다(= 다시 분리한다).

    **길이까지 본다.** 파일 존재만 보면 분리 도중에 죽어 **잘려 쓰인 WAV**를
    그대로 물려받는다 — 그러면 그 곡은 뒷부분이 통째로 없는 채로 전사되고,
    오류가 하나도 안 난다. 캐시를 손으로 지우기 전까지 계속 그렇다.
    헤더만 읽으므로(`sf.info`) 값이 싸다.
    """
    import soundfile as sf

    stem_dir = out_dir / "stems"
    paths = {name: stem_dir / f"{name}.wav" for name in stems.STEM_NAMES}
    if not all(p.exists() for p in paths.values()):
        return {}
    if duration is None:
        return paths
    try:
        for path in paths.values():
            if duration - sf.info(str(path)).duration > _STEM_TOLERANCE_SEC:
                return {}
    except Exception:  # noqa: BLE001 — 못 읽는 파일도 다시 분리한다
        return {}
    return paths


def _read_meta(out_dir: Path) -> dict:
    """앞선 실행이 남긴 메타. 없거나 깨졌으면 빈 표다."""
    try:
        return json.loads((out_dir / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _f0_reusable(out_dir: Path, meta: dict, has_melody: bool) -> bool:
    """이미 뽑아 둔 f0를 그대로 써도 되는가.

    **스템 재사용과 같은 취지지만 이유가 하나 더 있다.** 구조 엔진만 바뀌어
    캐시가 미스가 됐을 때 RMVPE를 다시 돌릴 이유가 없다 — 그게 없으면 이
    무효화가 "고쳤다"가 아니라 "곡마다 멜로디를 몇 분씩 다시 뽑는다"가 된다
    (`_stem_paths` 주석과 같은 함정이다).

    **지금 모델이 없어졌어도 이미 있는 좋은 커브는 지우지 않는다.** 안 그러면
    구조 때문에 다시 돈 김에 멀쩡한 f0가 무성 커브로 덮인다.
    """
    if not (out_dir / "f0.json").exists() or not (out_dir / "vocal_processed.wav").exists():
        return False
    if not meta.get("hasMelody"):
        return False
    if not has_melody:
        return True
    return meta.get("melodyEngine") == melody.ENGINE


def _pipeline(job: Job, source: Path, out_dir: Path) -> Path:
    """분리 → 후처리 → f0 → 구조. 진행률의 배분은 실측 비율에 맞춘 어림값이다."""
    report = store.progress(job)
    has_stems = _usable("stems", stems.available)
    has_melody = _usable("melody", melody.available)
    has_structure = _usable("structure", structure.available)
    previous = _read_meta(out_dir)

    report("파일 읽는 중", 0.02)
    audio = read_audio(source)

    if has_stems:
        stem_dir = out_dir / "stems"
        stem_dir.mkdir(parents=True, exist_ok=True)
        # **이미 있으면 다시 분리하지 않는다.** 슬롯은 내용 해시라 스템은 곡에만
        # 달려 있는데, 멜로디 모델을 갈아끼우면 캐시가 미스가 된다(아래 `create_job`).
        # 그때 수 분짜리 htdemucs를 다시 돌릴 이유가 없다 — 다시 뽑아야 하는 것은
        # f0뿐이다. 분리는 끝났는데 f0를 쓰기 전에 서버가 죽은 경우도 여기서 산다.
        paths = _stem_paths(out_dir, audio.duration)
        if paths:
            report("스템 재사용", 0.58)
        else:
            paths = stems.separate(
                audio,
                stem_dir,
                # 분리가 전체의 앞 55%를 차지한다고 본다
                progress=lambda stage, ratio: report(stage, 0.05 + ratio * 0.53),
            )
        vocal_path = paths.get("vocals")
    else:
        # 모델이 없으면 원본을 보컬로 취급한다. 반주가 섞여 f0가 나빠지지만
        # **파이프라인이 끝까지 도는 것**이 진단에 훨씬 쓸모 있다.
        vocal_path = None

    melody_engine: str | None = melody.ENGINE if has_melody else None
    # 옥타브 2패스가 되올린 프레임 수. 커브를 새로 뽑을 때만 값이 선다 —
    # 재사용 경로에서는 이번에 아무것도 안 했으므로 None이 정직하다.
    octave_lifted: int | None = None
    if _f0_reusable(out_dir, previous, has_melody):
        report("멜로디 재사용", 0.78)
        has_melody = True
        melody_engine = previous.get("melodyEngine")
    else:
        report("보컬 후처리", 0.60)
        raw = read_audio(vocal_path) if vocal_path else audio
        processed = process_vocal(raw)
        processed_path = out_dir / "vocal_processed.wav"
        write_audio(processed_path, processed)

        report("멜로디 추출", 0.65)
        curve = melody.silent_curve(processed)
        if has_melody:
            curve = melody.extract_f0(processed_path)
            if vocal_path is not None:
                # **음정은 원본 믹스에서 다시 뽑아 덮는다**(`melody.merge_voicing`).
                # 분리가 고음 보컬의 기본음을 깎으면 f0가 아래 옥타브로 내려앉는데,
                # 믹스에는 그 성분이 남아 있다. 유·무성만 위 커브에서 물려받는다.
                # 스템이 없을 때는 두 커브가 같은 신호라 섞을 것이 없다.
                # **한 옥타브 내려서도 한 번 더 물어본다**(`melody.pipeline_curve`).
                # 고음은 8kHz 안에 배음이 8개뿐이라 ÷2 가설을 기각할 증거가 모자란데,
                # 내려서 물으면 17개가 된다. 확실한 자리는 여기서 되올리고, 나머지는
                # `f0Alt` 후보로 실어 웹의 노트 DP가 연속성으로 고르게 한다.
                report("멜로디 추출(원본 믹스·옥타브)", 0.72)
                curve, octave_lifted = melody.pipeline_curve(
                    audio.samples, audio.rate, curve
                )
        (out_dir / "f0.json").write_text(json.dumps(curve), encoding="utf-8")

    structure_error: str | None = None
    if has_structure:
        report("구조 분석", 0.80)
        try:
            structure.write(
                structure.analyze(
                    source,
                    out_dir / "allin1",
                    progress=lambda stage, ratio: report(stage, 0.80 + ratio * 0.17),
                ),
                out_dir,
            )
        except Cancelled:
            # **취소는 실패가 아니다.** 이걸 아래 `except`가 삼키면 사용자가 취소를
            # 눌렀는데 작업이 "완료"로 끝나고, 게다가 그 반쪽짜리 결과가 캐시에
            # 등록된다(실측 2026-08-14: `structureError: "Cancelled: "`가 적힌 슬롯이
            # 남았고, `structureEngine`까지 적혀 그 곡은 영영 구조를 못 받게 됐다).
            # 진행률 보고가 곧 중단 지점이라는 규칙이 여기서만 깨져 있었다.
            raise
        except Exception as failure:  # noqa: BLE001 — 이것 때문에 앞의 결과를 버리지 않는다
            # **여기서 던지면 수 분짜리 분리와 f0가 함께 죽는다.** 구조는 맨 뒤에
            # 붙은 덧붙임이므로 실패해도 나머지는 그대로 내보낸다 — `_usable`이
            # `broken` 모델을 애초에 안 부르는 것과 같은 취지이고, 여기는 그것이
            # 못 잡는 실행 중 실패를 받는다. 무엇이 터졌는지는 메타에 남는다.
            structure_error = f"{type(failure).__name__}: {failure}"
            has_structure = False

    (out_dir / "meta.json").write_text(
        json.dumps(
            {
                "durationSec": round(audio.duration, 3),
                "hasStems": has_stems,
                "hasMelody": has_melody,
                "hasStructure": has_structure,
                "stems": sorted(p.stem for p in (out_dir / "stems").glob("*.wav")),
                # 이 결과를 만든 엔진들. 캐시 적중 판정이 이걸 본다(`create_job`)
                "melodyEngine": melody_engine,
                # 옥타브 2패스가 되올린 프레임 수. **이 장치의 효과를 나중에
                # 분리해서 읽으려면 얼마나 발동했는지를 알아야 한다**(실측 0~3%).
                "octaveLiftedFrames": octave_lifted,
                # **실패해도 엔진 이름을 적는다.** 안 적으면 `_cache_hit`이
                # "구조를 아직 안 돌렸다"로 읽고 곡을 열 때마다 파이프라인을
                # 통째로 다시 돌린다 — 고쳐지지도 않을 실패를 위해서.
                "structureEngine": (
                    structure.ENGINE if has_structure or structure_error else None
                ),
                "structureError": structure_error,
            }
        ),
        encoding="utf-8",
    )
    report("완료", 1.0)
    return out_dir


def _cache_hit(out_dir: Path) -> bool:
    """이 슬롯의 결과를 그대로 써도 되는가.

    **둘 다 있어야 한다.** `f0.json`만 보면, 그 사이에 서버가 죽어 `meta.json`을
    못 쓴 디렉터리가 영영 "완료"로 잡힌다 — 작업은 즉시 끝나고 웹은 `/meta`에서
    404를 받아 "결과를 받지 못했습니다"만 본다. 캐시를 손으로 지우기 전까지 그
    곡은 계속 실패한다.

    **엔진도 같아야 한다.** 슬롯 이름이 파일 내용 해시뿐이라, 멜로디 모델을
    갈아끼워도 이미 분석한 곡은 옛 커브를 그대로 돌려준다. 그러면 사용자가 보는
    것은 "모델을 바꿨는데 결과가 똑같다"이고, 하필 **모델을 바꾼 직후에 가장
    많이 열어 보는 곡들**이 정확히 그 캐시에 들어 있다. 스템은 곡에만 달려
    있으므로 버리지 않는다 — `_pipeline`이 재사용하고 f0만 다시 뽑는다.

    **그때 없던 모델이 지금 있어도 다시 돈다.** 사이드카는 모델이 없으면 그
    칸을 비운 채로 끝까지 가므로(무성 커브, 원본을 보컬로 취급), 그 결과가
    캐시에 남는다. 나중에 모델을 깔고 같은 곡을 열면 **깔기 전의 빈 결과가
    영영 돌아온다** — 사용자가 방금 한 일이 아무 효과가 없어 보인다.
    반대 방향(그때 있던 모델이 지금 없다)에는 다시 돌지 않는다. 이미 좋은
    결과가 있는데 굳이 나쁘게 만들 이유가 없다.
    """
    if not (out_dir / "f0.json").exists() or not (out_dir / "meta.json").exists():
        return False
    try:
        meta = json.loads((out_dir / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False

    if _usable("stems", stems.available) and not meta.get("hasStems"):
        return False
    if _usable("melody", melody.available) and not meta.get("hasMelody"):
        return False
    if meta.get("hasMelody") and meta.get("melodyEngine") != melody.ENGINE:
        return False
    # **구조도 같은 규칙이다.** 다만 판정을 `hasStructure`가 아니라 엔진 이름으로
    # 한다 — 이 파일에서 구조 분석이 터진 적이 있으면 `hasStructure`가 False인
    # 채로 엔진만 적혀 있고, 그때 다시 돌려 봐야 같은 곳에서 같은 이유로 죽는다.
    if _usable("structure", structure.available):
        if meta.get("structureEngine") != structure.ENGINE:
            return False
    return True


@app.post("/jobs")
async def create_job(file: UploadFile) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다")

    digest = digest_of(data)
    out_dir = store.slot(digest)
    if _cache_hit(out_dir):
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


@app.get("/jobs/{job_id}/structure")
def job_structure(job_id: str) -> JSONResponse:
    """구간·비트·다운비트. **없을 수 있다** — 모델이 없거나 옛 캐시 슬롯이다.

    웹은 404를 오류가 아니라 "구조 없음"으로 읽는다(`platform/sidecar.ts`).
    """
    path = _finished(job_id) / "structure.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="구조 분석 결과가 없습니다")
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
