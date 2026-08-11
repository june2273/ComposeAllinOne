"""멜로디 f0 — RMVPE 래퍼.

**2026-08-11에 basic-pitch에서 갈아탔다.** 둘을 실곡으로 나란히 재고 진 쪽을
지웠다(측정 표는 CLAUDE.md에 있다). 요지는 **어느 쪽이 멜로디를 고르는가**다 —
basic-pitch는 다성 전사기라 프레임마다 가장 센 피치를 고르므로, 보컬 스템에
반주가 남으면 구조적으로 그쪽을 딴다. RMVPE는 반대로 **폴리포닉 음악 속에서
보컬 하나를 찾도록** 학습된 단선율 f0 모델이다(Wei et al., Interspeech 2023).
정답 MIDI 대조에서 정확 매칭이 189 → 515로 올랐다.

**커브를 노트로 자르지 않는다.** 노트 분할·양자화·MIDI·악보는 전부 웹의
`core/transcribe`가 한다 — 사양서 §1.8의 "f0가 원재료, 노트는 그 양자화 결과"를
층 경계로 옮긴 것이다. 그래서 모델을 또 갈아끼워도 웹은 안 바뀐다.

## 이 모델의 성질 중 알아 둘 것

- **홉이 정확히 10ms다**(160샘플 @ 16kHz). 우리 `HOP_MS`와 같아 재표본화가
  사실상 항등으로 지나간다 — basic-pitch(256/22050 ≈ 11.6ms)에는 없던 이점이다.
- **포물선 보간을 하지 않는다.** 모델이 이미 360빈(20센트) salience를 **센트
  영역에서 9빈 가중평균**해 f0를 낸다. 반음 계단을 메우려고 basic-pitch 쪽에
  넣었던 보간을 여기에 또 걸면 두 번 매끄럽게 만드는 것이 된다.
- **torch를 안 쓴다.** 순수 NumPy 멜 + onnxruntime이라, 이 패키지가 새로 끌고
  온 의존성이 하나도 없었다(실측: 14KB 휠 하나).
- **가중치가 362MB다.** 패키지에 안 들어 있고 첫 사용 때 HuggingFace에서 받는다
  (SHA-256 고정 검증). basic-pitch(2.5MB 동봉)와 정반대라 `selftest`의 규칙이
  달라진다 — 아래.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .audio import Audio

#: 이 커브를 만든 방식. **`meta.json`에 적혀 캐시 무효화에 쓰인다** —
#: 갈아끼웠는데 캐시가 옛 커브를 돌려주면 바꾼 티가 안 난다.
#: **모델 이름만이 아니라 "무엇을 먹였는가"까지 담는다**(`merge_voicing` 참조) —
#: 입력을 바꾼 것도 사용자가 보는 결과를 바꾸므로 같은 무효화가 필요하다.
ENGINE = "rmvpe+mask"

#: 커브의 프레임 간격(밀리초). 웹의 `PitchCurve.hopMs`와 같은 값이다.
HOP_MS = 10.0

#: 모델이 내보내는 프레임 간격(초). 160/16000이라 위와 같다.
_MODEL_HOP_SEC = 160 / 16_000

#: 이 아래 confidence의 프레임은 무성으로 본다.
#:
#: confidence는 360빈 salience의 최댓값이다. **basic-pitch에 쓰던 0.3을 그대로
#: 옮기면 안 된다** — 척도가 다르다(순수 사인파에서도 중앙값이 0.45다). 0.03은
#: RVC 생태계가 이 모델에 쓰는 기본값이다.
#:
#: **평가셋 없이 정한 값이지만, 실곡에서 이 값이 둔감하다는 것은 확인했다** —
#: 0.01·0.03·0.1·0.3 넷을 전부 돌려도 최종 음표가 611개로 같았다. 뒤의
#: `notes.ts`가 상한 있는 비용으로 자르기 때문에 짧은 저신뢰 구간이 음표를
#: 만들지 못한다. 그래서 이 상수는 지금 위험한 자리가 아니다.
MIN_CONFIDENCE = 0.03

#: 다룰 음역. 웹 쪽 MIN_MIDI/MAX_MIDI와 맞춰 둔다.
MIN_MIDI = 36
MAX_MIDI = 96

#: 실행 장치를 **CPU로 고정한다.**
#:
#: 자동 선택은 Apple Silicon에서 CoreML을 고르는데, 곡 하나를 통짜로 넣으면
#: 거기서 죽는다 — 255초(25502프레임)에서
#: `Error executing model: Error in building plan`(실측 2026-08-11).
#: 1초짜리 사인파로는 멀쩡히 돌아서 **자가진단을 통과하고 첫 실곡에서 터지는**
#: 부류의 사고다.
#:
#: 그런데 CPU가 이미 충분히 빠르다 — 같은 255초 곡을 3.9초에 끝낸다(약 65배속).
#: 잘라 넣는 복잡도를 들이거나 장치별로 갈라 볼 이유가 없었다.
_DEVICE = "cpu"

#: 세션을 재사용한다. 곡마다 다시 만들면 그 비용이 곡 수만큼 붙는다.
_model = None


def available() -> bool:
    from importlib.util import find_spec

    return find_spec("rmvpe_onnx") is not None


def weights_ready() -> bool:
    """가중치가 이미 디스크에 있는가. **내려받지 않고 확인만 한다.**"""
    if not available():
        return False
    from rmvpe_onnx import default_model_path

    return default_model_path().exists()


def selftest() -> None:
    """이 환경에서 추론이 실제로 도는가. 실패하면 그대로 던진다.

    **가중치가 없으면 import까지만 본다.** `RMVPE()` 생성자는 없으면 곧바로
    362MB를 받는데, 서버를 띄웠을 뿐인 사용자에게 그런 일이 조용히 일어나면
    안 된다 — `stems.selftest`가 htdemucs 가중치에 대해 지키는 규칙과 같다.

    대가가 있다. import는 되는데 실행이 죽는 부류(basic-pitch 시절의 `resampy`
    → `pkg_resources` 사고)를 **가중치가 없는 동안에는 못 잡는다.** 그 상태를
    화면이 알 수 있도록 `main.py`가 `/health`에 함께 실어 보낸다.

    가중치가 있으면 1초짜리 사인파로 추론을 한 번 돌린다. 결과의 내용은 보지
    않는다 — 여기서 재는 것은 정확도가 아니라 이 환경에서 끝까지 도는가다.
    """
    import rmvpe_onnx  # noqa: F401

    if not weights_ready():
        return

    rate = 16_000
    t = np.arange(rate) / rate
    tone = (0.3 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
    extract_f0_from_samples(tone, rate)


def _load():
    global _model
    if _model is None:
        from rmvpe_onnx import RMVPE

        _model = RMVPE(device=_DEVICE)
    return _model


def extract_f0(path: Path) -> dict:
    """WAV 하나에서 f0 커브. 반환은 웹의 `PitchCurve`와 같은 모양이다.

    ``{"hopMs": 10, "f0": [...], "confidence": [...]}``
    """
    import soundfile as sf

    samples, rate = sf.read(str(path), dtype="float32", always_2d=True)
    return extract_f0_from_samples(samples.mean(axis=1), rate)


def extract_f0_from_samples(
    samples: np.ndarray,
    rate: int,
    min_confidence: float = MIN_CONFIDENCE,
) -> dict:
    """모노 float32 → f0 커브.

    문턱을 인자로 받는 것은 **실곡에서 훑어 보기 위해서다**
    (`scripts/extract_f0.py`). 추론은 한 번만 돌리고 문턱만 바꿔 커브를 여러 벌
    만들 수 있어야 한다.
    """
    _time, frequency, confidence, _activation = _load().predict(samples, rate)
    return curve_from_prediction(frequency, confidence, min_confidence)


def curve_from_prediction(
    frequency: np.ndarray,
    confidence: np.ndarray,
    min_confidence: float = MIN_CONFIDENCE,
) -> dict:
    """(f0, confidence) → 커브. **모델을 부르지 않으므로 테스트가 돈다.**

    무성 판정은 두 가지다: confidence가 문턱 아래이거나, 음이 우리가 다루는
    음역 밖이거나. 뒤엣것이 필요한 이유는 모델이 무성 구간에서도 **주파수를
    하나 내놓기** 때문이다 — 걸러내지 않으면 그것들이 그대로 음표가 된다.
    """
    frequency = np.asarray(frequency, dtype=np.float64)
    confidence = np.asarray(confidence, dtype=np.float64)
    if frequency.size == 0:
        return {"hopMs": HOP_MS, "f0": [], "confidence": []}

    with np.errstate(divide="ignore", invalid="ignore"):
        midi = 69.0 + 12.0 * np.log2(np.where(frequency > 0, frequency, np.nan) / 440.0)
    voiced = (
        (confidence >= min_confidence)
        & np.isfinite(midi)
        & (midi >= MIN_MIDI)
        & (midi <= MAX_MIDI)
    )

    hz = np.where(voiced, frequency, 0.0)
    return resample_curve(hz, confidence * voiced, _MODEL_HOP_SEC)


def merge_voicing(pitch: dict, voicing: dict) -> dict:
    """음정은 앞 커브에서, 유·무성은 뒤 커브에서.

    **원본 믹스와 분리 보컬이 서로 다른 것을 잘한다**(실측 2026-08-11, 정답
    MIDI가 있는 두 곡).

    - **음정은 믹스가 낫다.** htdemucs가 고음 보컬을 분리하면서 기본음을
      깎아 놓으면 RMVPE가 아래 옥타브로 내려앉는다. 곡E(원곡 보컬, 최고음 B♭5)에서
      **옥타브 오류 64개 → 16개**로 줄었다. 곡M에서도 6 → 1이다.
    - **유·무성은 분리 보컬이 낫다.** 믹스에는 반주만 있는 구간에도 음정이
      서고, 그것이 그대로 유령 음표가 된다. 마스크를 씌우면 곡E의 유령이
      47 → 32로 준다.

    그래서 둘을 섞는다. **마스크가 분리 보컬 쪽이므로 유령 위험은 예전(분리
    보컬만 쓰던 때)보다 커지지 않는다** — 그때 무성이던 자리는 지금도 무성이다.

    | (정확 / 유령 / 옥타브) | 분리 보컬만 | 믹스만 | 지금 |
    |---|---|---|---|
    | 곡E (정답 553음) | 201 / 108 / 64 | 237 / 47 / 16 | **236 / 32 / 16** |
    | 곡M (정답 783음) | 515 / 17 / 6 | 517 / 14 / 1 | **518 / 14 / 1** |

    **근거가 곡 둘뿐이다.** 평가셋이 늘면 다시 확인할 것.
    """
    n = min(len(pitch["f0"]), len(voicing["f0"]))
    audible = [voicing["f0"][i] > 0 for i in range(n)]
    return {
        "hopMs": pitch["hopMs"],
        "f0": [pitch["f0"][i] if audible[i] else 0.0 for i in range(n)],
        "confidence": [pitch["confidence"][i] if audible[i] else 0.0 for i in range(n)],
    }


def resample_curve(hz: np.ndarray, confidence: np.ndarray, hop_sec: float) -> dict:
    """모델의 프레임 간격을 HOP_MS로 옮긴다.

    **최근접 이웃으로 옮긴다.** 선형 보간을 쓰면 무성(0)과 유성 사이에서 있지도
    않은 중간 주파수가 만들어져, 음이 시작할 때마다 아래에서 미끄러져 올라오는
    가짜 포르타멘토가 생긴다.

    지금 엔진은 홉이 정확히 10ms라 이 함수가 항등으로 지나간다. **그래도
    남겨 둔다** — 다음 모델이 같으리라는 보장이 없고, 여기가 "모델의 시간 격자와
    우리 격자는 다른 것"이라고 말하는 유일한 자리다.
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
