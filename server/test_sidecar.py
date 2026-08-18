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
import json
import threading
import wave
from pathlib import Path

import numpy as np
import pytest

from app import main, melody
from app.health import Check
from app.audio import Audio, gate, highpass, normalize, process_vocal, resample
from app.jobs import Cancelled, JobStore, digest_of

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


def test_curve_keeps_confident_frames():
    frequency = np.full(50, 440.0)
    confidence = np.full(50, 0.9)
    curve = melody.curve_from_prediction(frequency, confidence)
    assert curve["hopMs"] == melody.HOP_MS
    assert all(abs(v - 440.0) < 1.0 for v in curve["f0"])


def test_curve_marks_low_confidence_frames_unvoiced():
    frequency = np.full(50, 440.0)
    confidence = np.full(50, 0.01)  # MIN_CONFIDENCE 아래
    curve = melody.curve_from_prediction(frequency, confidence)
    assert set(curve["f0"]) == {0.0}


def test_curve_drops_pitches_outside_our_range():
    """무성 구간에서도 모델은 주파수를 하나 내놓는다.

    걸러내지 않으면 그 값들이 그대로 음표가 된다. 확신에 차 있어도 음역 밖이면
    노래가 아니다 — 여기가 그 유일한 방어선이다.
    """
    # MIN_MIDI(36) 한참 아래와 MAX_MIDI(96) 한참 위
    frequency = np.array([20.0, 12000.0, 440.0])
    confidence = np.full(3, 0.9)
    curve = melody.curve_from_prediction(frequency, confidence)
    assert curve["f0"][0] == 0.0
    assert curve["f0"][1] == 0.0
    assert curve["f0"][2] > 0.0


def test_curve_keeps_pitch_between_semitones():
    """반음으로 반올림하지 않는다.

    하면 비브라토·벤드가 통째로 사라지고, 40센트 밀린 음원의 조율 보정도
    할 수 없게 된다(그건 `core/transcribe`가 커브를 보고 하는 일이다).
    """
    frequency = np.full(10, 452.0)  # A4와 A#4 사이
    curve = melody.curve_from_prediction(frequency, np.full(10, 0.9))
    assert all(abs(v - 452.0) < 0.5 for v in curve["f0"])


def test_empty_prediction_is_empty_curve():
    curve = melody.curve_from_prediction(np.zeros(0), np.zeros(0))
    assert curve["f0"] == []


def test_merge_takes_pitch_from_one_and_voicing_from_the_other():
    """음정은 믹스에서, 유·무성은 분리 보컬에서."""
    pitch = {"hopMs": 10.0, "f0": [440.0, 880.0, 660.0], "confidence": [0.9, 0.9, 0.9]}
    voicing = {"hopMs": 10.0, "f0": [220.0, 0.0, 220.0], "confidence": [0.5, 0.0, 0.5]}
    merged = melody.merge_voicing(pitch, voicing)
    # 값은 앞쪽 것, 구멍은 뒤쪽 것
    assert merged["f0"] == [440.0, 0.0, 660.0]
    assert merged["confidence"] == [0.9, 0.0, 0.9]


def test_merge_stops_at_the_shorter_curve():
    """길이가 다르면 짧은 쪽에서 끝낸다.

    한쪽이 길다고 마스크 없이 통과시키면 **거기서부터 유령이 쏟아진다** —
    마스크가 없는 구간은 곧 원본 믹스를 그대로 쓰는 구간이다.
    """
    pitch = {"hopMs": 10.0, "f0": [440.0] * 5, "confidence": [0.9] * 5}
    voicing = {"hopMs": 10.0, "f0": [220.0] * 2, "confidence": [0.5] * 2}
    merged = melody.merge_voicing(pitch, voicing)
    assert merged["f0"] == [440.0, 440.0]


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

    실제로 겪은 것: `resampy`가 `pkg_resources`를 import하는데 setuptools 81이
    그것을 없앴다. `import basic_pitch`는 성공하고 /health도 초록으로 뜨는데
    f0만 죽었다. 그 사슬은 2026-08-11에 RMVPE로 갈아타며 빠졌지만 **부류가
    사라진 것은 아니다** — import되는 것과 도는 것은 여전히 다른 문제다.
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
    assert set(body["checks"]) == {"stems", "melody", "structure"}
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
    assert set(body["models"]) == {"stems", "melody", "structure"}


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


def test_other_engine_curve_is_not_a_hit(client, tmp_path: Path):
    """멜로디 엔진을 갈아끼우면 캐시된 곡도 다시 뽑아야 한다.

    슬롯 이름이 파일 내용 해시뿐이라, 이걸 안 보면 모델을 바꿔도 이미 분석한
    곡은 옛 커브를 돌려준다 — 그리고 **모델을 바꾼 직후에 가장 많이 열어 보는
    곡들**이 정확히 그 캐시에 들어 있다. "바꿨는데 똑같다"가 되는 자리다.
    """
    data = wav_bytes()
    created = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    poll(client, created["jobId"])

    slot = next(p for p in tmp_path.iterdir() if (p / "meta.json").exists())
    meta = json.loads((slot / "meta.json").read_text(encoding="utf-8"))
    # 이 곡이 다른 엔진으로 분석된 것처럼 꾸민다
    meta["hasMelody"] = True
    meta["melodyEngine"] = "옛날모델"
    (slot / "meta.json").write_text(json.dumps(meta), encoding="utf-8")

    again = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    assert again["cached"] is False
    poll(client, again["jobId"])
    # 다시 돈 결과에는 지금 엔진이 적혀 있고, 이제는 캐시가 맞는다
    assert client.get(f"/jobs/{again['jobId']}/meta").status_code == 200
    third = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    assert third["cached"] is True


def test_existing_stems_are_reused(tmp_path: Path):
    """엔진이 바뀌어 다시 돌 때 htdemucs를 또 돌리지 않는다.

    스템은 곡에만 달려 있다. f0를 다시 뽑겠다고 수 분짜리 분리를 함께 되돌리면
    위 캐시 무효화가 "고쳤다"가 아니라 "느려졌다"가 된다.
    """
    stem_dir = tmp_path / "슬롯" / "stems"
    stem_dir.mkdir(parents=True)
    for name in main.stems.STEM_NAMES:
        (stem_dir / f"{name}.wav").write_bytes(wav_bytes())
    assert set(main._stem_paths(tmp_path / "슬롯")) == set(main.stems.STEM_NAMES)

    # 잘려 쓰인 스템은 재사용하지 않는다. `wav_bytes()`는 아주 짧으므로,
    # 곡이 그보다 길다고 말하면 전부 "쓰다 만 것"으로 잡혀야 한다 —
    # 안 그러면 그 곡은 뒷부분이 없는 채로 조용히 전사된다
    assert main._stem_paths(tmp_path / "슬롯", 60.0) == {}

    # 하나만 없어도 재사용하지 않는다 — 반쯤 남은 디렉터리를 믿으면 안 된다
    (stem_dir / f"{main.stems.STEM_NAMES[0]}.wav").unlink()
    assert main._stem_paths(tmp_path / "슬롯") == {}


def test_missing_structure_is_404_not_an_error(client):
    """구조 모델이 없어도 작업은 성공한다. 없는 것은 404일 뿐이다.

    옛 캐시 슬롯도 같은 상태다 — 웹은 이 404를 "구조 없음"으로 읽고 나머지
    결과를 그대로 보여준다.
    """
    created = client.post(
        "/jobs", files={"file": ("a.wav", wav_bytes(), "audio/wav")}
    ).json()
    job_id = created["jobId"]
    status = poll(client, job_id)
    assert status["error"] is None, status["error"]

    meta = client.get(f"/jobs/{job_id}/meta").json()
    assert "hasStructure" in meta
    if not meta["hasStructure"]:
        assert client.get(f"/jobs/{job_id}/structure").status_code == 404


def test_structure_failure_does_not_throw_away_the_melody(client, monkeypatch, tmp_path: Path):
    """구조가 터져도 f0는 나온다.

    구조는 맨 뒤에 붙은 덧붙임이라, 여기서 던지면 수 분짜리 분리와 멜로디까지
    함께 버려진다. 무엇이 터졌는지는 메타에 남고, **엔진 이름도 함께 남아야**
    같은 곡을 열 때마다 파이프라인이 통째로 다시 돌지 않는다.
    """
    monkeypatch.setattr(main.structure, "available", lambda: True)
    monkeypatch.setattr(main.probe, "get", lambda name: Check("ok"))

    def boom(*_args, **_kwargs):
        raise RuntimeError("가중치가 없다")

    monkeypatch.setattr(main.structure, "analyze", boom)

    data = wav_bytes()
    created = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    status = poll(client, created["jobId"])
    assert status["error"] is None, "구조 실패가 작업 전체를 죽였다"
    assert len(client.get(f"/jobs/{created['jobId']}/f0").json()["f0"]) > 0

    meta = client.get(f"/jobs/{created['jobId']}/meta").json()
    assert meta["hasStructure"] is False
    assert "가중치가 없다" in meta["structureError"]
    assert meta["structureEngine"] == main.structure.ENGINE

    # 고쳐지지도 않을 실패 때문에 매번 다시 돌지 않는다
    again = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    assert again["cached"] is True


def test_cancelling_during_structure_is_not_a_structure_failure(client, monkeypatch):
    """취소는 실패가 아니다 — 위 except가 삼키면 안 된다.

    삼키면 두 가지가 한꺼번에 어긋난다: 사용자가 취소를 눌렀는데 작업이 "완료"로
    끝나고, 그 반쪽짜리 결과가 **캐시에 등록되어** 그 곡은 영영 구조를 못 받는다.
    실측(2026-08-14)으로 그 상태의 슬롯이 실제로 남았다.
    """
    monkeypatch.setattr(main.structure, "available", lambda: True)
    monkeypatch.setattr(main.probe, "get", lambda name: Check("ok"))

    def cancel_here(*_args, **_kwargs):
        raise Cancelled

    monkeypatch.setattr(main.structure, "analyze", cancel_here)

    data = wav_bytes()
    created = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    status = poll(client, created["jobId"])
    assert status["error"] == "취소했습니다", "취소가 완료로 둔갑했다"

    # 캐시에 등록되지 않았어야 한다 — 다시 올리면 처음부터 돈다
    again = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    assert again["cached"] is False


def test_other_structure_engine_reuses_the_melody(client, monkeypatch, tmp_path: Path):
    """구조 엔진만 바뀌면 RMVPE를 다시 돌리지 않는다.

    스템 재사용과 같은 취지다 — 안 그러면 이 무효화가 "고쳤다"가 아니라
    "곡마다 멜로디를 몇 분씩 다시 뽑는다"가 된다.
    """
    data = wav_bytes()
    created = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    poll(client, created["jobId"])

    slot = next(p for p in tmp_path.iterdir() if (p / "meta.json").exists())
    meta = json.loads((slot / "meta.json").read_text(encoding="utf-8"))
    meta["hasMelody"] = True
    meta["melodyEngine"] = main.melody.ENGINE
    meta["structureEngine"] = "옛날구조모델"
    (slot / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    curve_before = (slot / "f0.json").read_text(encoding="utf-8")

    monkeypatch.setattr(main.structure, "available", lambda: True)
    monkeypatch.setattr(main.probe, "get", lambda name: Check("ok"))
    monkeypatch.setattr(main.structure, "analyze", lambda *a, **k: {"segments": []})
    called: list[str] = []
    monkeypatch.setattr(
        main.melody, "extract_f0", lambda *a, **k: called.append("f0") or {}
    )

    again = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    assert again["cached"] is False, "구조 엔진이 바뀌었으면 다시 돌아야 한다"
    poll(client, again["jobId"])
    assert called == [], "멜로디를 다시 뽑았다"
    assert (slot / "f0.json").read_text(encoding="utf-8") == curve_before
    assert client.get(f"/jobs/{again['jobId']}/structure").json() == {"segments": []}


def test_audio_name_is_allowlisted(client):
    created = client.post(
        "/jobs", files={"file": ("a.wav", wav_bytes(), "audio/wav")}
    ).json()
    job_id = created["jobId"]
    poll(client, job_id)
    # 경로 탈출이 되면 안 된다
    assert client.get(f"/jobs/{job_id}/audio/..%2F..%2Fmeta").status_code in {404, 400}
    assert client.get(f"/jobs/{job_id}/audio/meta").status_code == 404
