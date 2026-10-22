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
import statistics
import sys
import threading
import types
import wave
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app import beats as beats_mod
from app import cfp, main, melody
from app.health import Check
from app.audio import Audio, gate, highpass, normalize, process_vocal, resample, write_audio
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


# --- 옥타브 2패스 ------------------------------------------------------------
#
# **모델을 굴리지 않는다.** 여기서 보는 것은 판단 규칙이다 — 되돌리기 산수가
# 맞는가, 조건을 다 채워야만 올리는가, 프레임 하나로 안 뒤집히는가.
# 실제 정확도는 정답 MIDI가 말한다(`scripts/f0_truth.py`).


def _spread(size, low, high):
    """겹치지 않는 confidence 사다리. 분위수 순위가 뜻을 가지려면 값이 퍼져야 한다."""
    return list(np.linspace(low, high, size))


def test_restore_undoes_the_half_rate_trick():
    """f0에 ×2, 프레임은 2칸마다 하나. 절반 속도로 물어본 것을 제자리로."""
    lowered = {"hopMs": 10.0, "f0": [220.0, 999.0] * 4, "confidence": [0.5, 0.1] * 4}
    restored = melody.restore_octave_curve(lowered)
    assert restored["f0"] == [440.0] * 4  # ×2 되고, 홀수 프레임은 버려진다
    assert restored["confidence"] == [0.5] * 4


def test_restore_drops_notes_above_our_range():
    """**복원이 음역 밖을 만들면 무성으로 둔다** (실측 2026-08-19).

    `curve_from_prediction`의 자르기는 **모델이 돈 도메인**에서 일어나므로,
    2패스의 상한(MIDI 96 = 2093Hz)이 복원의 ×2를 거쳐 MIDI 108이 된다.
    그대로 내보내면 웹이 `midi > MAX_MIDI + 1`로 통째로 버려서 **기준 패스가
    맞히고 있던 고음이 사라진다** — 되올리려던 것과 정반대다.
    """
    top = 440.0 * 2 ** ((melody.MAX_MIDI - 69) / 12)  # 도메인 상한 → 복원하면 MIDI 108
    fine = 440.0 * 2 ** ((70 - 69) / 12)              # 복원하면 MIDI 82 — 정상
    lowered = {"hopMs": 10.0, "f0": [top, top, fine, fine], "confidence": [0.9] * 4}

    restored = melody.restore_octave_curve(lowered)
    assert restored["f0"][0] == 0.0, "MIDI 108이 그대로 나갔다 — 웹이 버릴 값이다"
    assert restored["confidence"][0] == 0.0, "무성인데 신뢰도가 남으면 분위수를 오염시킨다"
    assert restored["f0"][1] == pytest.approx(932.33, abs=0.01), "정상 음역까지 지웠다"


def test_high_register_does_not_overwrite_with_out_of_range(monkeypatch):
    """음역 밖 2패스가 **멀쩡한 기준 프레임을 덮어쓰지 않는다.**

    고치기 전에는 기준이 MIDI 69로 맞히고 있는 프레임을 MIDI 108로 바꿔 놓았고,
    그 프레임은 웹에서 통째로 사라졌다. 세 호출부가 전부
    `restore_octave_curve`를 거치므로 거기서 막는다.
    """
    top = 440.0 * 2 ** ((melody.MAX_MIDI - 69) / 12)
    fine = 440.0 * 2 ** ((70 - 69) / 12)
    # **`restore_octave_curve`가 2칸마다 하나를 집는다** — lowered는 두 배 길이로.
    # 홀수 자리는 버려지므로 아무 값이나 둔다.
    lowered = {"hopMs": 10.0, "f0": [top, 0.0, fine, 0.0, top, 0.0], "confidence": [0.9] * 6}
    pitch = {"hopMs": 10.0, "f0": [440.0] * 3, "confidence": [0.9] * 3}

    out, switched = melody.resolve_high_register(pitch, lowered)
    assert out["f0"][0] == 440.0, "음역 밖 값이 기준을 덮어썼다"
    assert out["f0"][2] == 440.0
    assert out["f0"][1] == pytest.approx(932.33, abs=0.01), "정상 고음은 바뀌어야 한다"
    assert switched == 1


def test_octave_candidate_drops_out_of_range(monkeypatch):
    """후보에도 음역 밖이 실리면 안 된다 — 웹의 `f0Alt` 검사가 또 버린다."""
    top = 440.0 * 2 ** ((melody.MAX_MIDI - 69) / 12)
    lowered = {"hopMs": 10.0, "f0": [top, 0.0, top, 0.0], "confidence": [0.9] * 4}
    # 기준이 그 절반(MIDI 96)이면 옥타브 관계는 성립하지만 후보가 범위 밖이다
    base = {"hopMs": 10.0, "f0": [top / 2, top / 2], "confidence": [0.5] * 2}

    candidate = melody.octave_candidate(base, lowered)
    assert candidate["f0"] == [0.0, 0.0], "음역 밖 후보가 실렸다"


def test_octave_pass_lifts_a_halved_run():
    """정확히 한 옥타브 아래로 깔렸고, 기준은 자신 없고 2패스는 자신 있다.

    **분위수는 상대적이라** 두 confidence를 같은 방향으로 주면 조건이 겹치지
    않는다(기준의 하위 60%와 2패스의 상위 40%가 같은 프레임이어야 한다).
    그래서 반대 방향으로 준다 — 뒤로 갈수록 기준은 자신을 잃고 2패스는 얻는다.
    """
    size = 40
    base = {"hopMs": 10.0, "f0": [440.0] * size, "confidence": _spread(size, 0.2, 0.05)}
    lowered = {
        "hopMs": 10.0,
        "f0": [440.0] * (size * 2),
        "confidence": _spread(size * 2, 0.7, 0.95),
    }
    fixed, lifted = melody.resolve_octave_pass(base, lowered)
    assert lifted >= 10
    assert fixed["f0"][-1] == pytest.approx(880.0)  # 조건이 가장 잘 맞는 끝쪽
    assert fixed["f0"][0] == pytest.approx(440.0)  # 기준이 자신 있던 앞쪽은 그대로


def test_octave_pass_leaves_a_confident_base_alone():
    """기준 패스가 자기 기준으로 자신 있으면 건드리지 않는다.

    이 조건이 없으면 맞게 잡은 저역까지 한 옥타브 위로 밀려 올라간다
    (실측: 조건 없이 전체 교체하면 곡 넷에서 전체 정확률이 내려갔다).
    """
    size = 40
    base = {"hopMs": 10.0, "f0": [440.0] * size, "confidence": _spread(size, 0.8, 0.99)}
    lowered = {
        "hopMs": 10.0,
        "f0": [440.0] * (size * 2),
        "confidence": _spread(size * 2, 0.8, 0.99),
    }
    _fixed, lifted = melody.resolve_octave_pass(base, lowered)
    assert lifted == 0


def test_octave_pass_ignores_gaps_that_are_not_an_octave():
    """5도 차이는 옥타브 오류가 아니다 — 둘 중 하나가 그냥 틀린 것이다."""
    size = 40
    base = {"hopMs": 10.0, "f0": [440.0] * size, "confidence": _spread(size, 0.05, 0.2)}
    lowered = {
        "hopMs": 10.0,
        "f0": [330.0] * (size * 2),  # ×2 하면 660Hz = 5도 위
        "confidence": _spread(size * 2, 0.7, 0.95),
    }
    _fixed, lifted = melody.resolve_octave_pass(base, lowered)
    assert lifted == 0


def test_octave_pass_does_not_flip_on_a_single_frame():
    """다수결 창. 한 프레임짜리 주장으로 옥타브를 바꾸지 않는다."""
    size = 40
    f0 = [440.0] * size
    lowered_f0 = [220.0] * (size * 2)
    lowered_f0[20] = 440.0  # 되돌리면 880 — 딱 한 프레임만 옥타브를 주장한다
    base = {"hopMs": 10.0, "f0": f0, "confidence": _spread(size, 0.05, 0.2)}
    lowered = {
        "hopMs": 10.0,
        "f0": lowered_f0,
        "confidence": _spread(size * 2, 0.7, 0.95),
    }
    _fixed, lifted = melody.resolve_octave_pass(base, lowered)
    assert lifted == 0


def test_octave_pass_survives_mismatched_lengths():
    """두 패스의 길이가 딱 두 배가 아닐 수 있다. 짧은 쪽에서 끝낸다."""
    base = {"hopMs": 10.0, "f0": [440.0] * 10, "confidence": [0.1] * 10}
    lowered = {"hopMs": 10.0, "f0": [220.0] * 7, "confidence": [0.9] * 7}
    fixed, _lifted = melody.resolve_octave_pass(base, lowered)
    assert len(fixed["f0"]) == 3  # 7 // 2 = 3


def test_octave_pass_on_empty_curves():
    empty = {"hopMs": 10.0, "f0": [], "confidence": []}
    fixed, lifted = melody.resolve_octave_pass(empty, empty)
    assert fixed["f0"] == [] and lifted == 0


def test_octave_candidate_keeps_only_octave_relation():
    """기준과 정확히 ±1옥타브인 프레임만 후보로 남는다.

    같은 값은 후보로서 무의미하고, 5도처럼 옥타브가 아닌 차이는 2패스가 반주를
    따라간 잡음이다 — 웹의 노트 DP에 넘길 신호는 옥타브 분쟁뿐이다.
    """
    base = {"hopMs": 10.0, "f0": [440.0, 440.0, 440.0, 0.0], "confidence": [0.5] * 4}
    # 되돌리기(×2, [::2]) 후: [880(옥타브 위), 440(같음), 660(5도), 220]
    lowered = {
        "hopMs": 10.0,
        "f0": [440.0, 440.0, 220.0, 220.0, 330.0, 330.0, 110.0, 110.0],
        "confidence": [0.9] * 8,
    }
    alt = melody.octave_candidate(base, lowered)
    assert alt["f0"][0] == pytest.approx(880.0)  # +12 — 남는다
    assert alt["f0"][1] == 0.0  # 같음 — 비운다
    assert alt["f0"][2] == 0.0  # 5도 — 잡음
    assert alt["f0"][3] == 0.0  # 기준 무성 — 관계를 잴 수 없다


def _fake_passes(monkeypatch, base_hz, lowered_hz):
    """기준 패스와 옥타브 패스를 가짜로. **모델을 부르지 않는다.**

    `lowered_hz`는 모델이 절반 속도로 들었을 때의 값이라, 되돌리면 그 두 배가 된다.
    """

    def fake_extract(samples, rate, min_confidence=melody.MIN_CONFIDENCE):
        if rate == 100:
            return {"hopMs": 10.0, "f0": [base_hz] * 6, "confidence": [0.9] * 6}
        return {"hopMs": 10.0, "f0": [lowered_hz] * 12, "confidence": [0.9] * 12}

    monkeypatch.setattr(melody, "extract_f0_from_samples", fake_extract)


def test_pipeline_curve_carries_masked_alt(monkeypatch):
    """f0Alt에도 같은 유·무성 마스크가 걸리고 길이가 기준과 같다.

    **분할 문턱 아래의 음을 쓴다** — 위쪽 음을 쓰면 `resolve_high_register`가
    이미 그 값을 본 커브에 넣어 버려서 후보로 남을 것이 없다(그건 아래 시험이 본다).
    """
    _fake_passes(monkeypatch, 110.0, 110.0)  # 기준 A2(45) · 되돌리면 A3(57)
    voicing = {"hopMs": 10.0, "f0": [220.0, 220.0, 0.0, 220.0, 220.0, 220.0], "confidence": [0.5] * 6}
    curve, _lifted, _switched = melody.pipeline_curve(np.zeros(600, dtype=np.float32), 100, voicing)
    assert len(curve["f0Alt"]) == len(curve["f0"])
    assert curve["f0"][2] == 0.0 and curve["f0Alt"][2] == 0.0  # 마스크가 둘 다 지운다
    assert curve["f0"][0] == pytest.approx(110.0)  # 분할 문턱 아래라 기준 그대로
    assert curve["f0Alt"][0] == pytest.approx(220.0)  # 후보가 실린다


# --- 음역 분할 -------------------------------------------------------------
#
# 고음에서는 confidence가 4~6배 무너져 문턱 규칙이 원리적으로 작동하지 않는다.
# 그래서 **어느 음역인가**로 가르고, 판단 기준은 2패스 추정치다(기준 패스는
# 반토막이 나 있을 수 있어 그걸로 음역을 재면 순환이다).


def test_high_register_switches_to_second_pass(monkeypatch):
    """2패스가 분할 문턱 이상을 주장하면 그 프레임은 통째로 2패스를 쓴다."""
    _fake_passes(monkeypatch, 440.0, 440.0)  # 기준 A4(69) · 되돌리면 A5(81)
    voicing = {"hopMs": 10.0, "f0": [220.0] * 6, "confidence": [0.5] * 6}
    curve, _lifted, switched = melody.pipeline_curve(np.zeros(600, dtype=np.float32), 100, voicing)
    assert curve["f0"][0] == pytest.approx(880.0)
    assert switched == 6


def test_high_register_leaves_low_notes_alone(monkeypatch):
    """문턱 아래를 주장하면 아무 일도 안 한다."""
    base = {"hopMs": 10.0, "f0": [110.0] * 6, "confidence": [0.9] * 6}
    lowered = {"hopMs": 10.0, "f0": [110.0] * 12, "confidence": [0.9] * 12}  # 되돌리면 A3(57)
    curve, switched = melody.resolve_high_register(base, lowered)
    assert curve["f0"] == base["f0"]
    assert switched == 0


def test_high_register_does_not_revive_unvoiced(monkeypatch):
    """**유성 판정은 넓히지 않는다.** 기준이 무성인 자리는 그대로 둔다."""
    base = {"hopMs": 10.0, "f0": [440.0, 0.0, 440.0, 0.0], "confidence": [0.9, 0.0, 0.9, 0.0]}
    lowered = {"hopMs": 10.0, "f0": [440.0] * 8, "confidence": [0.9] * 8}
    curve, switched = melody.resolve_high_register(base, lowered)
    assert curve["f0"][1] == 0.0 and curve["f0"][3] == 0.0
    assert curve["f0"][0] == pytest.approx(880.0)
    assert switched == 2


def test_high_register_ignores_octave_relation(monkeypatch):
    """**옥타브 관계를 요구하지 않는다.** 요구하면 이득의 대부분이 사라진다.

    실측: 옥타브 제약을 걸면 곡B 커버1의 F5+ 회수가 +26음에서 +1음이 되고
    쌍둥이 두 커버가 반대로 움직인다.
    """
    # 기준 440(A4=69), 2패스는 되돌리면 700Hz(≈F5=77) — 옥타브 관계가 아니다
    base = {"hopMs": 10.0, "f0": [440.0] * 4, "confidence": [0.9] * 4}
    lowered = {"hopMs": 10.0, "f0": [350.0] * 8, "confidence": [0.9] * 8}
    curve, switched = melody.resolve_high_register(base, lowered)
    assert curve["f0"][0] == pytest.approx(700.0)
    assert switched == 4


def test_pipeline_curve_counts_two_devices_separately(monkeypatch):
    """되올린 수와 분할한 수를 **합치지 않는다** — 따로 읽을 수 있어야 한다."""
    _fake_passes(monkeypatch, 440.0, 440.0)
    voicing = {"hopMs": 10.0, "f0": [220.0] * 6, "confidence": [0.5] * 6}
    curve, lifted, switched = melody.pipeline_curve(np.zeros(600, dtype=np.float32), 100, voicing)
    assert isinstance(lifted, int) and isinstance(switched, int)
    assert switched == 6
    assert len(curve["f0"]) == 6


# --- CFP 살리언스 ---------------------------------------------------------
#
# **답을 아는 합성 신호로만 본다.** 실곡 정확도는 `scripts/f0_truth.py`가 낸다.
# 여기서 못 박는 것은 "스펙트럼 × 켑스트럼이 옥타브를 실제로 가르는가"이다.


def _harmonic(f0, rate=44100, count=8, seconds=1.0):
    t = np.arange(int(rate * seconds)) / rate
    return sum(np.sin(2 * np.pi * f0 * k * t) / k for k in range(1, count + 1))


def test_cfp_prefers_the_true_f0_over_its_octaves():
    """참 f0에서만 스펙트럼과 켑스트럼이 함께 크다."""
    probe = cfp.CfpProbe(_harmonic(220.0), 44100)
    low, true, high = probe.salience(0.5, np.array([110.0, 220.0, 440.0]))
    assert true > low and true > high


def test_cfp_survives_few_harmonics():
    """**이것이 이 파일의 존재 이유다.** 고음은 8kHz 안에 배음이 8개뿐이다."""
    probe = cfp.CfpProbe(_harmonic(932.3, count=8), 44100)
    half, true = probe.salience(0.5, np.array([466.16, 932.3]))
    assert true > half


def test_cfp_survives_accompaniment_at_the_subharmonic():
    """반주가 아래 옥타브 자리를 채워도 버틴다.

    스펙트럼만 보는 심판이 죽은 자리다(H11) — 거기서는 반주가 채운 f0/2가
    참 f0와 구별되지 않았다. 켑스트럼 항이 그것을 가른다.
    """
    rate = 44100
    t = np.arange(rate) / rate
    mixed = _harmonic(932.3, count=8) + 0.7 * np.sin(2 * np.pi * 466.16 * t)
    half, true = cfp.CfpProbe(mixed, rate).salience(0.5, np.array([466.16, 932.3]))
    assert true > half


def test_cfp_ignores_frequencies_outside_the_range():
    probe = cfp.CfpProbe(_harmonic(220.0), 44100)
    assert probe.salience(0.5, np.array([10.0, 20000.0])).tolist() == [0.0, 0.0]


def test_cfp_handles_edges_without_crashing():
    """창이 오디오 밖으로 나가는 시각. 곡의 처음·끝에서 실제로 일어난다."""
    probe = cfp.CfpProbe(_harmonic(220.0, seconds=0.5), 44100)
    for at in (0.0, 0.49, 5.0):
        assert probe.salience(at, np.array([220.0])).shape == (1,)


def test_octave_pass_without_probe_is_unchanged():
    """probe를 안 주면 예전 규칙 그대로다 — 회귀가 나면 여기서 잡힌다."""
    size = 40
    base = {"hopMs": 10.0, "f0": [440.0] * size, "confidence": _spread(size, 0.2, 0.05)}
    lowered = {
        "hopMs": 10.0,
        "f0": [440.0] * (size * 2),
        "confidence": _spread(size * 2, 0.7, 0.95),
    }
    with_probe = melody.resolve_octave_pass(base, lowered, None)
    assert with_probe == melody.resolve_octave_pass(base, lowered)


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
    assert set(body["checks"]) == {"stems", "melody", "structure", "beats"}
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
    assert set(body["models"]) == {"stems", "melody", "structure", "beats"}


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


def test_instrumental_sums_the_three_non_vocal_stems(tmp_path: Path):
    """오프보컬은 새 모델 없이 드럼·베이스·그 외를 더한 것이다.

    htdemucs 네 스템은 합치면 원본과 같아지도록 학습되어 있으므로, 보컬만 뺀
    셋을 더하면 그대로 오프보컬(karaoke) 믹스여야 한다.
    """
    # 진폭을 낮게 잡는다 — 셋을 더한 합이 PCM16의 ±1.0을 넘으면 클리핑되어
    # "더하기가 맞았는가"가 아니라 "클리핑됐는가"를 재게 된다.
    paths = {}
    for name, hz in (("drums", 100.0), ("bass", 200.0), ("other", 300.0)):
        path = tmp_path / f"{name}.wav"
        write_audio(path, Audio(samples=sine(0.1, hz, amplitude=0.2), rate=RATE))
        paths[name] = path

    out = main.stems.instrumental(paths, tmp_path / "inst.wav")
    mixed, rate = sf.read(str(out), dtype="float32")
    expected = (
        sine(0.1, 100.0, amplitude=0.2)
        + sine(0.1, 200.0, amplitude=0.2)
        + sine(0.1, 300.0, amplitude=0.2)
    )
    assert rate == RATE
    # PCM16으로 구웠으므로 양자화 오차만 허용한다
    np.testing.assert_allclose(mixed, expected, atol=1e-3)


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


def test_structure_passes_the_model_name_to_allin1(monkeypatch):
    """**`MODEL` 상수가 실제로 allin1에 넘어가는가.**

    2026-08-18까지 안 넘어가고 있었다. `analyze()`가 `model=`을 빼먹어서
    allin1의 기본값이 쓰였는데, 마침 그 값이 `MODEL`과 같아서 **동작은 맞고
    상수만 죽어 있었다** — 폴드를 하나로 줄여 속도를 재려다 발견했다.

    조용히 틀리는 부류라 여기서 못박는다. 진짜 추론은 돌리지 않는다(가중치가
    수백 MB이고 곡당 수 분이다) — 넘어가는 인자만 본다.
    """
    from app import structure

    seen = {}

    class FakeResult:
        bpm = 120
        beats = [0.5, 1.0]
        downbeats = [0.5]
        beat_positions = [1, 2]
        segments = []

    def fake_analyze(**kwargs):
        seen.update(kwargs)
        return FakeResult()

    fake_allin1 = types.SimpleNamespace(analyze=fake_analyze)
    monkeypatch.setattr(structure, "_prepare_natten", lambda: None)
    monkeypatch.setitem(sys.modules, "allin1", fake_allin1)

    structure.analyze(Path("a.wav"), Path("/tmp"))
    assert seen["model"] == structure.MODEL, "MODEL 상수가 allin1에 안 넘어간다"

    # 폴드를 골라 부를 수 있어야 한다 (속도 실험이 이걸 쓴다)
    structure.analyze(Path("a.wav"), Path("/tmp"), model="harmonix-fold0")
    assert seen["model"] == "harmonix-fold0"


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


# --- 비트 (Beat This!) -------------------------------------------------------


def test_refine_period_is_not_the_median():
    """중앙값을 쓰면 치우친다 — 그것이 이 함수가 세 단계인 이유다.

    비트가 11.6ms 프레임 격자에 묶여 있으면 150BPM(0.4초)에서 0.3947과 0.4064만
    나올 수 있어 중앙값이 153을 낸다(실측). 그 상황을 그대로 만든다.
    """
    step = 1.0 / 86.13  # ODF 프레임 간격
    beats = [round(i * 0.4 / step) * step for i in range(200)]
    gaps = [b - a for a, b in zip(beats, beats[1:])]
    naive = 60.0 / statistics.median(gaps)
    refined = 60.0 / beats_mod.refine_period(beats)
    assert abs(naive - 150.0) > 1.0, f"중앙값이 안 치우치면 이 시험이 뜻이 없다 ({naive})"
    assert abs(refined - 150.0) < 0.2, refined


def test_fill_puts_back_a_dropped_beat():
    """간격이 주기의 두 배면 하나 빠진 것이다 — 곡A의 29초 구간이 그랬다."""
    beats = [i * 0.5 for i in range(20)]
    holed = [b for i, b in enumerate(beats) if i not in (7, 12)]
    filled = beats_mod.fill_dropped_beats(holed)
    assert len(filled) == len(beats)
    for got, want in zip(filled, beats):
        assert abs(got - want) < 1e-9


def test_fill_leaves_a_complete_grid_alone():
    """이미 완전한 격자는 한 개도 안 건드린다(실측: 정답 14곡 중 4곡이 채움 0)."""
    beats = [i * 0.5 for i in range(40)]
    assert beats_mod.fill_dropped_beats(beats) == beats


def test_fill_does_not_invent_beats_in_a_real_rest():
    """정수배가 아닌 간격은 손대지 않는다 — 그것이 쉼과 놓친 비트를 가르는 조건이다."""
    beats = [i * 0.5 for i in range(10)]
    beats += [beats[-1] + 1.73]           # 3.46박 — 어느 정수배도 아니다
    beats += [beats[-1] + 0.5 * i for i in range(1, 10)]
    assert beats_mod.fill_dropped_beats(beats) == beats


def test_fill_stops_at_long_gaps():
    """연속 넷을 넘게 비었으면 놓친 것이 아니라 소리가 없는 것으로 본다."""
    beats = [i * 0.5 for i in range(10)]
    beats += [beats[-1] + 0.5 * 6]        # 정확히 6박 — 정수배지만 상한을 넘는다
    beats += [beats[-1] + 0.5 * i for i in range(1, 10)]
    assert beats_mod.fill_dropped_beats(beats) == beats


def test_beats_per_bar_survives_one_slipped_bar():
    """최빈값이라 도입부의 어긋난 마디 하나가 답을 못 바꾼다(평균이면 3.5가 된다)."""
    beats = [i * 0.5 for i in range(41)]
    downbeats = [0.0, 1.0]                # 첫 마디만 2박
    downbeats += [1.0 + 2.0 * i for i in range(1, 10)]   # 나머지는 4박
    assert beats_mod.beats_per_bar(beats, downbeats) == 4


def test_beats_per_bar_reads_three_four():
    """유일한 3/4 곡(곡J)을 3으로 낸다 — 실측으로도 그렇다."""
    beats = [i * 0.3 for i in range(60)]
    downbeats = [i * 0.9 for i in range(20)]
    assert beats_mod.beats_per_bar(beats, downbeats) == 3


def test_beats_cache_ignores_another_engine(tmp_path: Path):
    """엔진이 다르면 없는 것으로 친다 — 무효화가 이 파일 하나에서 끝난다."""
    beats_mod.write({"engine": beats_mod.ENGINE, "bpm": 120.0}, tmp_path)
    assert beats_mod.read(tmp_path) is not None
    beats_mod.write({"engine": "beatthis-old", "bpm": 120.0}, tmp_path)
    assert beats_mod.read(tmp_path) is None


def test_beats_cache_survives_a_broken_file(tmp_path: Path):
    """반쯤 쓰이다 만 JSON이 서버를 죽이면 안 된다 — 그 곡만 다시 재면 된다."""
    (tmp_path / "beats.json").write_text('{"engine": "beat', encoding="utf-8")
    assert beats_mod.read(tmp_path) is None


def test_beats_selftest_does_not_build_the_tracker(monkeypatch):
    """자가진단이 체크포인트 77MB를 받으면 안 된다 — import까지만 본다."""
    import sys as _sys
    import types as _types

    def explode(*_a, **_k):
        pytest.fail("자가진단이 File2Beats를 만들었다 — 가중치를 받게 된다")

    fake = _types.ModuleType("beat_this.inference")
    fake.File2Beats = explode
    monkeypatch.setitem(_sys.modules, "beat_this", _types.ModuleType("beat_this"))
    monkeypatch.setitem(_sys.modules, "beat_this.inference", fake)
    beats_mod.selftest()


def test_beats_endpoint_is_503_when_the_model_is_missing(client, monkeypatch):
    """설치 문제를 4xx로 내면 웹이 '이 파일이 문제'로 읽는다."""
    monkeypatch.setattr(main.probe, "get", lambda name: Check("unavailable", "없다"))
    response = client.post("/beats", files={"file": ("a.wav", wav_bytes(), "audio/wav")})
    assert response.status_code == 503


def test_beats_endpoint_rejects_an_empty_file(client):
    response = client.post("/beats", files={"file": ("a.wav", b"", "audio/wav")})
    assert response.status_code == 400


def test_beats_endpoint_returns_the_cache_without_running_the_model(
    client, monkeypatch, tmp_path: Path
):
    """캐시가 있으면 모델을 안 부른다. 곡당 2~4초라도 열 때마다 치를 값은 아니다."""
    monkeypatch.setattr(main.probe, "get", lambda name: Check("ok"))
    data = wav_bytes()
    out_dir = main.store.slot(digest_of(data))
    out_dir.mkdir(parents=True, exist_ok=True)
    beats_mod.write(
        {"engine": beats_mod.ENGINE, "bpm": 120.0, "beatsPerBar": 4,
         "beats": [0.0, 0.5], "downbeats": [0.0]},
        out_dir,
    )
    monkeypatch.setattr(
        beats_mod, "analyze",
        lambda *_a, **_k: pytest.fail("캐시가 있는데 모델을 불렀다"),
    )
    body = client.post("/beats", files={"file": ("a.wav", data, "audio/wav")}).json()
    assert body["cached"] is True
    assert body["bpm"] == 120.0


def test_beats_endpoint_writes_what_it_computed(client, monkeypatch):
    """계산한 결과가 슬롯에 남아야 다음 열기가 싸다."""
    monkeypatch.setattr(main.probe, "get", lambda name: Check("ok"))
    result = {"engine": beats_mod.ENGINE, "bpm": 84.0, "beatsPerBar": 4,
              "beats": [0.0, 0.71], "downbeats": [0.0]}
    monkeypatch.setattr(beats_mod, "analyze", lambda *_a, **_k: result)
    data = wav_bytes()
    body = client.post("/beats", files={"file": ("a.wav", data, "audio/wav")}).json()
    assert body["cached"] is False and body["bpm"] == 84.0
    assert beats_mod.read(main.store.slot(digest_of(data))) == result


def test_beats_endpoint_does_not_clobber_an_input_being_separated(client, monkeypatch):
    """같은 슬롯을 `/jobs`가 쓰고 있을 수 있다 — 입력을 겹쳐 쓰면 분리가 깨진다."""
    SEPARATING = "분리 중이던 것".encode("utf-8")
    monkeypatch.setattr(main.probe, "get", lambda name: Check("ok"))
    monkeypatch.setattr(
        beats_mod, "analyze",
        lambda *_a, **_k: {"engine": beats_mod.ENGINE, "bpm": 84.0,
                           "beatsPerBar": 4, "beats": [], "downbeats": []},
    )
    data = wav_bytes()
    out_dir = main.store.slot(digest_of(data))
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "input.wav").write_bytes(SEPARATING)
    client.post("/beats", files={"file": ("a.wav", data, "audio/wav")})
    assert (out_dir / "input.wav").read_bytes() == SEPARATING


def test_health_reports_the_beat_tracker(client):
    """웹이 이걸 보고 분석 콘솔을 열지 잠글지 정한다."""
    body = client.get("/health").json()
    assert "beats" in body["models"]
    assert "beats" in body["checks"]


# --- 오프보컬 ------------------------------------------------------------------


@pytest.fixture
def fake_stems(monkeypatch):
    """htdemucs를 가짜로 갈아끼운다. 몇 번 불렸는지 센다."""
    calls: list[Path] = []

    def separate(audio, out_dir, progress=None):
        calls.append(out_dir)
        paths = {}
        for name in main.stems.STEM_NAMES:
            path = out_dir / f"{name}.wav"
            write_audio(path, audio)
            paths[name] = path
        return paths

    monkeypatch.setattr(main.stems, "available", lambda: True)
    monkeypatch.setattr(main.stems, "separate", separate)
    return calls


def test_inst_stem_is_derived_and_served(client, fake_stems):
    """드럼+베이스+그 외를 더한 오프보컬이 목록에 나오고 내려받을 수 있어야 한다."""
    created = client.post("/jobs", files={"file": ("a.wav", wav_bytes(), "audio/wav")}).json()
    status = poll(client, created["jobId"])
    assert status["done"] and status["error"] is None

    meta = client.get(f"/jobs/{created['jobId']}/meta").json()
    assert "inst" in meta["stems"]
    audio = client.get(f"/jobs/{created['jobId']}/audio/inst")
    assert audio.status_code == 200


def test_inst_is_rebuilt_without_rerunning_htdemucs(client, fake_stems, tmp_path: Path):
    """오프보컬만 없어졌으면 htdemucs를 다시 돌리지 않고 그것만 다시 합친다."""
    data = wav_bytes()
    first = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    poll(client, first["jobId"])
    assert len(fake_stems) == 1

    slot = next(p for p in tmp_path.iterdir() if (p / "meta.json").exists())
    (slot / "stems" / "inst.wav").unlink()
    again = client.post("/jobs", files={"file": ("a.wav", data, "audio/wav")}).json()
    assert again["cached"] is False
    poll(client, again["jobId"])
    # 스템은 재사용했다 — htdemucs가 다시 돌지 않았다
    assert len(fake_stems) == 1
    assert (slot / "stems" / "inst.wav").exists()
