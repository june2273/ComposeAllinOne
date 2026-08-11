"""멜로디 f0 — basic-pitch 래퍼.

**왜 basic-pitch인가.** 사양서 §[8]의 1순위는 JDC(Kum & Nam 2019)다 —
학습 데이터인 RWC Popular이 100곡 중 80곡이 J-pop이라 도메인이 맞는다. 다만
의존성이 Keras 2.2.2 / madmom 0.16.1로 굳어 있어 지금 파이썬에서 그대로
돌지 않는다(별도 venv를 하나 더 파야 한다). basic-pitch는 Apache-2.0에
pip 한 줄로 가중치까지 오고 유지되고 있어 **먼저 붙이고 나중에 벤치마크**
하기로 했다. 갈아끼울 자리는 이 파일 하나다.

**basic-pitch는 다성 전사기다.** 우리는 그중 멜로디 한 줄만 필요하므로
프레임마다 가장 강한 피치를 골라 f0 커브로 만든다 — 이미 보컬 스템만 넣고
있어 다성일 일이 거의 없지만, 화음 코러스 구간에서는 위 성부가 잡힌다.

f0 커브를 노트로 자르는 것은 **여기서 하지 않는다.** basic-pitch의 노트
출력에도 온셋/오프셋이 있지만, 이 앱은 자기 비트 그리드와 조율 보정을 갖고
있어 그것들을 함께 보고 잘라야 한다(`core/transcribe`). 사양서 §1.8의
"f0가 원재료, 노트는 그 양자화 결과"를 층 경계로 옮긴 것이다.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .audio import Audio

#: 커브의 프레임 간격(밀리초). 웹의 `PitchCurve.hopMs`와 같은 값이다.
HOP_MS = 10.0

#: basic-pitch가 내보내는 프레임 간격. 모델 구조에 박혀 있는 값이라
#: 우리 쪽 HOP_MS로 다시 샘플링한다(모델이 바뀌어도 웹은 안 바뀐다).
_BP_HOP_SEC = 256 / 22050

#: 이 아래 확률의 프레임은 무성으로 본다. basic-pitch의 기본 온셋 임계값과
#: 같은 값에서 출발했다 — **평가셋 없이 정한 값이다.**
MIN_PROBABILITY = 0.3

#: 다룰 음역. 웹 쪽 MIN_MIDI/MAX_MIDI와 맞춰 둔다.
MIN_MIDI = 36
MAX_MIDI = 96


def available() -> bool:
    from importlib.util import find_spec

    return find_spec("basic_pitch") is not None


def selftest() -> None:
    """f0 추출을 **실제로 한 번 돌려 본다.** 실패하면 그대로 던진다.

    `available()`(import 가능 여부)로는 잡히지 않는 부류가 있어서 필요하다 —
    대표가 `resampy`의 `pkg_resources` 의존이다(setuptools 81에서 제거됐다).
    그 경우 `import basic_pitch`는 성공하고 `/health`도 초록으로 뜨는데
    **첫 곡을 분석할 때가 되어서야** `ModuleNotFoundError`로 죽는다.
    수 분짜리 스템 분리를 끝낸 다음에 알게 되는 것이 최악이라 기동 때 확인한다.

    1초짜리 사인파를 쓴다. 결과의 내용은 보지 않는다 — 여기서 재는 것은
    정확도가 아니라 **이 환경에서 코드가 끝까지 도는가**뿐이다.
    """
    import tempfile

    import soundfile as sf

    rate = 22_050
    t = np.arange(rate) / rate
    tone = (0.3 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "selftest.wav"
        sf.write(str(path), tone, rate, subtype="PCM_16")
        extract_f0(path)


def extract_f0(path: Path) -> dict:
    """WAV 하나에서 f0 커브. 반환은 웹의 `PitchCurve`와 같은 모양이다.

    ``{"hopMs": 10, "f0": [...], "confidence": [...]}``
    """
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    # predict는 (활성 행렬, MIDI, 노트 목록) 셋을 준다. **앞의 것만 쓴다** —
    # 뒤의 둘은 basic-pitch가 자기 규칙으로 자른 결과라, 우리 비트 그리드와
    # 조율 보정을 모른다(사양서 §1.8: f0가 원재료, 노트는 그 양자화 결과).
    model_output, _midi, _notes = predict(
        str(path),
        model_or_model_path=ICASSP_2022_MODEL_PATH,
    )
    # (프레임, 88) 확률 행렬. 0번 열이 A0(MIDI 21)이다
    contour = np.asarray(model_output["note"], dtype=np.float32)
    return curve_from_activation(contour, base_midi=21)


def curve_from_activation(
    activation: np.ndarray,
    base_midi: int = 21,
    hop_sec: float = _BP_HOP_SEC,
) -> dict:
    """활성 행렬 → f0 커브. **모델을 부르지 않으므로 테스트가 돈다.**

    프레임마다 최대 확률 하나를 고른다. 그 자리의 이웃 두 칸으로 **포물선
    보간**을 해서 반음 사이를 메운다 — 안 하면 커브가 반음 계단이 되고
    비브라토·벤드가 통째로 사라진다(사양서 §1.8이 지키라고 한 것).
    """
    if activation.size == 0:
        return {"hopMs": HOP_MS, "f0": [], "confidence": []}

    best = activation.argmax(axis=1)
    peak = activation[np.arange(len(best)), best]

    midi = best.astype(np.float64) + base_midi
    # 포물선 보간: 좌우 이웃이 있을 때만
    left = np.where(best > 0, activation[np.arange(len(best)), np.maximum(best - 1, 0)], 0.0)
    right = np.where(
        best < activation.shape[1] - 1,
        activation[np.arange(len(best)), np.minimum(best + 1, activation.shape[1] - 1)],
        0.0,
    )
    denominator = left - 2 * peak + right
    shift = np.where(np.abs(denominator) > 1e-9, 0.5 * (left - right) / denominator, 0.0)
    midi += np.clip(shift, -0.5, 0.5)

    voiced = (peak >= MIN_PROBABILITY) & (midi >= MIN_MIDI) & (midi <= MAX_MIDI)
    hz = np.where(voiced, 440.0 * 2.0 ** ((midi - 69.0) / 12.0), 0.0)

    return resample_curve(hz, peak * voiced, hop_sec)


def resample_curve(hz: np.ndarray, confidence: np.ndarray, hop_sec: float) -> dict:
    """모델의 프레임 간격을 HOP_MS로 옮긴다.

    **최근접 이웃으로 옮긴다.** 선형 보간을 쓰면 무성(0)과 유성 사이에서
    있지도 않은 중간 주파수가 만들어져, 음이 시작할 때마다 아래에서 미끄러져
    올라오는 가짜 포르타멘토가 생긴다.
    """
    target = HOP_MS / 1000
    if len(hz) == 0:
        return {"hopMs": HOP_MS, "f0": [], "confidence": []}
    duration = len(hz) * hop_sec
    count = max(1, int(round(duration / target)))
    index = np.clip(np.round(np.arange(count) * target / hop_sec).astype(int), 0, len(hz) - 1)
    return {
        "hopMs": HOP_MS,
        "f0": [round(float(v), 3) for v in hz[index]],
        "confidence": [round(float(v), 3) for v in confidence[index]],
    }


def curve_duration(curve: dict) -> float:
    return len(curve["f0"]) * curve["hopMs"] / 1000


def silent_curve(audio: Audio) -> dict:
    """f0 추출기가 없을 때의 빈 커브. 파이프라인이 죽지 않게만 한다."""
    count = max(1, int(round(audio.duration * 1000 / HOP_MS)))
    return {"hopMs": HOP_MS, "f0": [0.0] * count, "confidence": [0.0] * count}
