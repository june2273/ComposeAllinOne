"""사이드카 검증 — **모델 없이 도는 것만 본다.**

스템 분리와 f0 추출은 학습된 모델이라 여기서 정확도를 잴 수 없다(그건 실곡과
채보 정답이 있어야 하는 일이다). 여기서 보는 것은 그 바깥 — 신호 처리가
의도대로 도는가, API가 규약대로 답하는가, 캐시가 맞는가.

```bash
cd server && .venv/bin/python -m pytest -q
```
"""

from __future__ import annotations

import io
import threading
import wave
from pathlib import Path

import numpy as np
import pytest

from app import melody
from app.audio import Audio, gate, highpass, normalize, process_vocal, resample
from app.jobs import JobStore, digest_of

RATE = 44_100


def sine(seconds: float, hz: float, amplitude: float = 0.5) -> np.ndarray:
    t = np.arange(int(RATE * seconds)) / RATE
    return (amplitude * np.sin(2 * np.pi * hz * t)).astype(np.float32)


# --- 신호 처리 ---------------------------------------------------------------


def test_highpass_keeps_voice_and_cuts_rumble():
    voice = sine(0.5, 440.0)
    rumble = sine(0.5, 20.0)
    kept = highpass(voice, RATE)
    cut = highpass(rumble, RATE)
    assert np.sqrt(np.mean(kept**2)) > 0.9 * np.sqrt(np.mean(voice**2))
    # 20Hz는 차단(80Hz)의 4분의 1이라 뚜렷하게 줄어야 한다
    assert np.sqrt(np.mean(cut**2)) < 0.5 * np.sqrt(np.mean(rumble**2))


def test_gate_silences_quiet_parts():
    loud = sine(0.5, 440.0, 0.5)
    quiet = sine(0.5, 440.0, 0.005)
    samples = np.concatenate([loud, quiet])
    out = gate(samples, RATE)
    half = len(loud)
    assert np.sqrt(np.mean(out[:half] ** 2)) > 0.2
    # 뒤쪽은 거의 남지 않아야 한다(경계의 램프 때문에 완전한 0은 아니다)
    assert np.sqrt(np.mean(out[half + RATE // 10 :] ** 2)) < 1e-4


def test_gate_does_not_clip_or_click():
    samples = sine(1.0, 220.0)
    out = gate(samples, RATE)
    assert np.max(np.abs(out)) <= np.max(np.abs(samples)) + 1e-6
    # 인접 샘플 차이가 원본보다 크게 튀지 않아야 한다 = 딸깍임이 없다
    assert np.max(np.abs(np.diff(out))) < 2 * np.max(np.abs(np.diff(samples)))


def test_normalize_hits_target_without_clipping():
    out = normalize(sine(0.5, 440.0, 0.01))
    rms = float(np.sqrt(np.mean(out**2)))
    assert 20 * np.log10(rms) == pytest.approx(-20.0, abs=0.5)
    assert np.max(np.abs(out)) <= 1.0


def test_normalize_leaves_silence_alone():
    silence = np.zeros(1000, dtype=np.float32)
    assert np.array_equal(normalize(silence), silence)


def test_resample_changes_length_and_keeps_shape():
    out = resample(sine(1.0, 100.0), RATE, 22_050)
    assert len(out) == pytest.approx(22_050, abs=2)
    # 진폭이 살아 있어야 한다 — 0이 되면 보간이 무너진 것이다
    assert np.max(np.abs(out)) > 0.4


def test_process_vocal_returns_same_rate_and_length():
    audio = Audio(samples=sine(0.3, 440.0), rate=RATE)
    out = process_vocal(audio)
    assert out.rate == RATE
    assert len(out.samples) == len(audio.samples)


# --- f0 커브 ----------------------------------------------------------------


def test_curve_from_activation_picks_strongest_bin():
    # 88열 중 A4(MIDI 69) 자리 = 69 - 21 = 48
    activation = np.zeros((50, 88), dtype=np.float32)
    activation[:, 48] = 0.9
    curve = melody.curve_from_activation(activation)
    assert curve["hopMs"] == melody.HOP_MS
    assert all(abs(v - 440.0) < 1.0 for v in curve["f0"])


def test_curve_from_activation_marks_weak_frames_unvoiced():
    activation = np.zeros((50, 88), dtype=np.float32)
    activation[:, 48] = 0.05  # MIN_PROBABILITY 아래
    curve = melody.curve_from_activation(activation)
    assert set(curve["f0"]) == {0.0}


def test_curve_interpolates_between_semitones():
    """이웃 칸이 함께 켜져 있으면 반음 사이가 나와야 한다.

    안 하면 커브가 반음 계단이 되어 비브라토·벤드가 통째로 사라진다.
    """
    activation = np.zeros((10, 88), dtype=np.float32)
    activation[:, 48] = 0.9
    activation[:, 49] = 0.85  # 위 이웃이 거의 같은 세기 = 그 사이
    curve = melody.curve_from_activation(activation)
    assert all(v > 441.0 for v in curve["f0"])


def test_empty_activation_is_empty_curve():
    curve = melody.curve_from_activation(np.zeros((0, 88), dtype=np.float32))
    assert curve["f0"] == []


def test_silent_curve_matches_duration():
    audio = Audio(samples=sine(2.0, 440.0), rate=RATE)
    curve = melody.silent_curve(audio)
    assert melody.curve_duration(curve) == pytest.approx(2.0, abs=0.05)


# --- 자가진단 ----------------------------------------------------------------
#
# 진짜 모델을 굴리는 것은 여기서 재지 않는다(설치돼 있을 수도 아닐 수도 있다).
# 보는 것은 **상태 기계**다 — 안 깔린 것과 깔렸는데 안 도는 것을 가르는가,
# 예외를 삼키지 않고 문장으로 옮기는가.


def test_probe_starts_as_checking():
    from app.health import Probe

    assert Probe().get("melody").status == "checking"


def test_probe_marks_missing_model_unavailable():
    from app.health import Probe

    probe = Probe()
    probe.run("melody", lambda: False, lambda: None)
    assert probe.get("melody").status == "unavailable"


def test_probe_marks_working_model_ok():
    from app.health import Probe

    probe = Probe()
    probe.run("melody", lambda: True, lambda: None)
    check = probe.get("melody")
    assert check.status == "ok"
    assert check.usable is True


def test_probe_catches_import_that_works_but_run_that_fails():
    """이 사고가 이 파일 전체의 존재 이유다.

    `resampy`가 `pkg_resources`를 import하는데 setuptools 81이 그것을 없앴다.
    `import basic_pitch`는 성공하고 /health도 초록으로 뜨는데 f0만 죽는다.
    """
    from app.health import Probe

    def broken():
        raise ModuleNotFoundError("No module named 'pkg_resources'")

    probe = Probe()
    probe.run("melody", lambda: True, broken)
    check = probe.get("melody")
    assert check.status == "broken"
    assert check.usable is False
    assert "pkg_resources" in (check.detail or "")


def test_probe_reports_every_model_independently():
    from app.health import Probe

    probe = Probe()
    probe.run("stems", lambda: True, lambda: None)
    probe.run("melody", lambda: False, lambda: None)
    assert probe.get("stems").status == "ok"
    assert probe.get("melody").status == "unavailable"


def test_health_carries_checks(client):
    body = client.get("/health").json()
    assert set(body["checks"]) == {"stems", "melody"}
    for check in body["checks"].values():
        assert check["status"] in {"checking", "ok", "unavailable", "broken"}


def test_health_reports_broken_model_as_unusable(client, monkeypatch):
    """깔려 있어도 안 돌면 `models`가 false여야 한다.

    화면이 이걸 보고 카드를 잠그므로, 여기서 true로 나가면 사용자가 수 분을
    기다린 끝에 같은 오류를 만난다.
    """
    from app import main
    from app.health import Probe

    def explode():
        raise RuntimeError("터졌다")

    fresh = Probe()
    fresh.run("melody", lambda: True, explode)
    monkeypatch.setattr(main, "probe", fresh)

    body = client.get("/health").json()
    assert body["models"]["melody"] is False
    assert "터졌다" in body["checks"]["melody"]["detail"]


def test_pipeline_skips_broken_model_instead_of_failing(client, monkeypatch):
    """진단이 broken이면 그 모델을 부르지 않는다.

    불러 봐야 같은 예외로 죽는데, 그러면 이미 수 분이 걸린 스템 분리 결과까지
    함께 버려진다. 되는 데까지 가고 안 되는 칸만 비운다.
    """
    from app import main
    from app.health import Probe

    def explode():
        raise RuntimeError("f0가 죽었다")

    fresh = Probe()
    fresh.run("melody", lambda: True, explode)
    fresh.run("stems", lambda: False, lambda: None)
    monkeypatch.setattr(main, "probe", fresh)
    monkeypatch.setattr(
        main.melody,
        "extract_f0",
        lambda _path: pytest.fail("broken인 모델을 불렀다"),
    )

    created = client.post(
        "/jobs", files={"file": ("a.wav", wav_bytes(), "audio/wav")}
    ).json()
    status = poll(client, created["jobId"])
    assert status["done"] and status["error"] is None
    meta = client.get(f"/jobs/{created['jobId']}/meta").json()
    assert meta["hasMelody"] is False


# --- 작업 큐 -----------------------------------------------------------------


def test_digest_is_content_based():
    assert digest_of(b"same") == digest_of(b"same")
    assert digest_of(b"a") != digest_of(b"b")


def wait_done(job, seconds: float = 10.0) -> None:
    import time

    deadline = time.monotonic() + seconds
    while not job.done and time.monotonic() < deadline:
        time.sleep(0.01)


def test_progress_raises_after_cancel(tmp_path: Path):
    import time

    store = JobStore(tmp_path)
    started = threading.Event()
    seen: list[int] = []

    def work(job):
        report = store.progress(job)
        for i in range(10_000):
            report("도는 중", i / 10_000)
            seen.append(i)
            started.set()
            time.sleep(0.001)
        return tmp_path

    job = store.submit(work)
    assert started.wait(5.0), "작업이 시작되지 않았다"
    store.cancel(job.id)
    wait_done(job)
    assert job.done
    assert job.error == "취소했습니다"
    assert len(seen) < 10_000  # 끝까지 돌지 않았다


def test_same_key_shares_the_running_job(tmp_path: Path):
    """같은 곡이 이미 돌고 있으면 두 번째 접수는 그 작업을 함께 쓴다.

    캐시는 `f0.json`이 다 쓰인 뒤에야 적중하므로, 분리가 도는 몇 분 사이에
    같은 파일이 또 올라오면 htdemucs가 둘 돌면서 **같은 WAV에 동시에 쓴다.**
    """
    store = JobStore(tmp_path)
    release = threading.Event()
    runs: list[int] = []

    def work(_job):
        runs.append(1)
        release.wait(5.0)
        return tmp_path

    first = store.submit(work, key="같은곡")
    second = store.submit(work, key="같은곡")
    assert second.id == first.id
    release.set()
    wait_done(first)

    # 끝난 뒤에는 새 작업이 된다 — 실패한 작업을 영영 물려주면 안 된다
    third = store.submit(work, key="같은곡")
    release.set()
    wait_done(third)
    assert third.id != first.id
    assert len(runs) == 2


def test_failure_becomes_error_not_crash(tmp_path: Path):
    store = JobStore(tmp_path)

    def work(_job):
        raise ValueError("일부러")

    job = store.submit(work)
    wait_done(job)
    assert job.done
    assert job.error is not None and "일부러" in job.error


# --- API --------------------------------------------------------------------


def wav_bytes(seconds: float = 0.2) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes((sine(seconds, 440.0) * 32767).astype("<i2").tobytes())
    return buffer.getvalue()


def poll(client, job_id: str, seconds: float = 60.0) -> dict:
    """작업이 끝날 때까지 기다린다. 스템 분리가 붙으면 수 분이 걸린다."""
    import time

    deadline = time.monotonic() + seconds
    status = client.get(f"/jobs/{job_id}").json()
    while not status["done"] and time.monotonic() < deadline:
        time.sleep(0.05)
        status = client.get(f"/jobs/{job_id}").json()
    return status


@pytest.fixture
def client(tmp_path: Path, monkeypatch):
    from fastapi.testclient import TestClient

    from app import main

    monkeypatch.setattr(main, "store", JobStore(tmp_path))
    return TestClient(main.app)


def test_health_answers_without_loading_models(client):
    body = client.get("/health").json()
    assert body["ok"] is True
    assert set(body["models"]) == {"stems", "melody"}


def test_empty_upload_is_rejected(client):
    response = client.post("/jobs", files={"file": ("a.wav", b"", "audio/wav")})
    assert response.status_code == 400


def test_unknown_job_is_404(client):
    assert client.get("/jobs/nope").status_code == 404
    assert client.get("/jobs/nope/f0").status_code == 404


def test_job_runs_and_yields_a_curve(client):
    created = client.post(
        "/jobs", files={"file": ("a.wav", wav_bytes(), "audio/wav")}
    ).json()
    job_id = created["jobId"]
    status = poll(client, job_id)
    assert status["done"], "작업이 끝나지 않았다"
    assert status["error"] is None, status["error"]

    curve = client.get(f"/jobs/{job_id}/f0").json()
    assert curve["hopMs"] == melody.HOP_MS
    assert len(curve["f0"]) > 0
    meta = client.get(f"/jobs/{job_id}/meta").json()
    assert meta["durationSec"] == pytest.approx(0.2, abs=0.05)
    # 처리된 보컬은 늘 있다. 스템은 모델이 있을 때만이다
    assert client.get(f"/jobs/{job_id}/audio/vocal_processed").status_code == 200


def test_second_upload_of_same_file_hits_cache(client):
    data = wav_bytes()
    first = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    poll(client, first["jobId"])
    second = client.post("/jobs", files={"file": ("다른이름.wav", data, "audio/wav")}).json()
    assert second["cached"] is True


def test_half_written_cache_is_not_a_hit(client, tmp_path: Path):
    """`f0.json`만 남은 디렉터리는 캐시가 아니다.

    meta를 쓰기 전에 서버가 죽으면 그 곡은 영영 "완료 즉시 /meta 404"가 된다 —
    캐시를 손으로 지우기 전까지 계속 실패한다.
    """
    data = wav_bytes()
    created = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    poll(client, created["jobId"])

    slot = next(p for p in tmp_path.iterdir() if (p / "meta.json").exists())
    (slot / "meta.json").unlink()

    again = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    assert again["cached"] is False
    poll(client, again["jobId"])
    assert client.get(f"/jobs/{again['jobId']}/meta").status_code == 200


def test_audio_name_is_allowlisted(client):
    created = client.post(
        "/jobs", files={"file": ("a.wav", wav_bytes(), "audio/wav")}
    ).json()
    job_id = created["jobId"]
    poll(client, job_id)
    # 경로 탈출이 되면 안 된다
    assert client.get(f"/jobs/{job_id}/audio/..%2F..%2Fmeta").status_code in {404, 400}
    assert client.get(f"/jobs/{job_id}/audio/meta").status_code == 404
