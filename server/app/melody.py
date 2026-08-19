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

from . import cfp
from .audio import Audio

#: 이 커브를 만든 방식. **`meta.json`에 적혀 캐시 무효화에 쓰인다** —
#: 갈아끼웠는데 캐시가 옛 커브를 돌려주면 바꾼 티가 안 난다.
#: **모델 이름만이 아니라 "무엇을 먹였는가"까지 담는다**(`merge_voicing` 참조) —
#: 입력을 바꾼 것도 사용자가 보는 결과를 바꾸므로 같은 무효화가 필요하다.
ENGINE = "rmvpe+mask+oct2cfp+hi69"

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

#: 옥타브 2패스의 문턱 셋. **전부 정답 6곡으로 정했다**(2026-08-18).
#:
#: 두 패스의 confidence는 **절대값을 비교할 수 없다** — 실측 중앙값이 0.177 대
#: 0.556이라 그냥 큰 쪽을 고르면 늘 2패스가 이긴다. 그래서 **각 패스 안에서의
#: 분위수 순위**로 잰다.
#:
#: 고를 때 본 것은 "F5 이상 정확률이 오르는가"만이 아니라 **"전체 정확률이
#: 어느 곡에서도 안 내려가는가"**다. 이 조건이 손잡이를 크게 좁힌다 —
#: 더 느슨하게 열면 이득은 커지지만(평균 +7~9%p) 곡 하나가 반드시 퇴행한다.
#: 지금 값은 **네 이웃이 전부 안전한 유일한 격자점**이라 골랐다.
OCTAVE_BASE_QUANTILE = 0.6
OCTAVE_LIFT_QUANTILE = 0.6

#: CFP 살리언스 비율 `Z(2X)/Z(X)`가 이보다 크면 **신뢰도 조건을 면제하고** 올린다.
#:
#: 위 두 분위수는 "어느 곡도 퇴행하지 않는다"를 지키느라 발동을 0~3%로 눌러 놓은
#: 값이라 고음을 절반밖에 못 건진다. CFP는 **다른 종류의 증거**(스펙트럼 × 켑스트럼,
#: `app/cfp.py`)라 그 조건을 우회해도 안전하다.
#:
#: **실측으로 정했다** — 정답 6곡에서 이 규칙(`현재 OR CFP>1.5`)이 F5 이상 정확률을
#: 2패스 없음 대비 평균 **+8.2%p** 올린다(신뢰도 조건만 쓰면 +4.9%p).
#: 문턱은 완만하다: 1.0에서 +9.4, 1.5에서 +8.2, 3.0에서 +6.2로 단조롭고 꺾이지 않는다.
#: 1.5를 고른 것은 더 낮추면 퇴행하는 곡이 하나에서 둘로 늘기 때문이다.
CFP_LIFT_RATIO = 1.5

#: 다수결 창(프레임). 옥타브는 프레임 하나로 뒤집히지 않는다 —
#: `notes.pickOnsets`의 불응기와 같은 종류의 장치다. 10ms 홉이므로 50ms.
OCTAVE_MAJORITY = 5

#: 다룰 음역. 웹 쪽 MIN_MIDI/MAX_MIDI와 맞춰 둔다.
MIN_MIDI = 36
MAX_MIDI = 96

#: 이 음 이상을 2패스가 주장하면 **그 프레임은 통째로 2패스를 쓴다**(A4).
#:
#: `resolve_octave_pass`의 보수적 병합과 **다른 종류의 판단**이다. 저쪽은
#: "이 프레임의 옥타브가 틀렸는가"를 confidence로 묻는데, **고음에서는 그
#: confidence 자체가 못 믿을 값이다** — 정답 구간의 중앙값이 C5 미만 0.28·0.79에서
#: C5 위 0.07~0.17로 **4~6배 무너진다**(실측 2026-08-18). 배음이 8kHz 안에 8개뿐이라
#: 어느 빈도 도드라지지 않기 때문이고(§2.8), 그래서 문턱으로 거르는 규칙이 원리적으로
#: 작동하지 않는다. 대신 **어느 음역인가**로 가른다.
#:
#: **판단 기준을 2패스 추정치로 삼는 것이 요점이다.** 기준 패스는 고음에서 반토막이
#: 나 있을 수 있어 그걸로 음역을 재면 순환이다 — 고음을 고음이라 부르지 못한다.
#:
#: **옥타브 관계를 요구하지 않는다.** 요구하면 이득의 대부분이 사라지고(실측:
#: F5+ 회수 +26음 → +1음) 쌍둥이 두 커버가 반대로 움직인다.
#:
#: 64~71이 6곡에서 거의 같았고 69를 골랐다. **평가셋이 6곡뿐이라는 것을 기억할 것** —
#: 이 저장소에서 곡을 늘렸을 때 결론이 뒤집힌 적이 두 번 있다.
OCTAVE_SPLIT_MIDI = 69


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


def _quantile_rank(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """패스 **안에서의** 분위수 순위(0~1). 무효 프레임은 NaN.

    두 패스의 confidence는 절대값으로 비교할 수 없다(위 상수의 주석). 순위로
    바꾸면 "이 패스 기준으로 얼마나 자신 있는가"가 되어 비교가 성립한다.
    """
    rank = np.full(len(values), np.nan)
    picked = values[valid]
    if picked.size:
        # **동점은 같은 순위를 받아야 한다.** 커브의 confidence는 소수 셋째
        # 자리에서 반올림돼 있어 동점이 흔한데, `argsort().argsort()`를 쓰면
        # 같은 값이 배열 순서대로 0~1에 흩뿌려져 "자신 없음"과 "자신 있음"으로
        # 갈린다(실측: 상수 커브에서 발동이 통째로 죽었다).
        rank[valid] = np.searchsorted(np.sort(picked), picked, side="left") / max(
            picked.size - 1, 1
        )
    return rank


def restore_octave_curve(lowered: dict) -> dict:
    """표본화율을 절반이라고 속여 얻은 커브를 제자리로 되돌린다.

    모델에게 `rate // 2`를 주면 **오디오가 한 옥타브 내려가고 두 배 길어진다.**
    그래서 f0에 ×2, 프레임은 2칸마다 하나씩 집으면 원래 시간·음고로 돌아온다.
    """
    f0 = np.asarray(lowered["f0"], dtype=np.float64) * 2.0
    confidence = np.asarray(lowered["confidence"], dtype=np.float64)
    keep = slice(0, len(f0) // 2 * 2, 2)
    return {
        "hopMs": lowered["hopMs"],
        "f0": [round(float(v), 3) for v in f0[keep]],
        "confidence": [round(float(v), 3) for v in confidence[: len(confidence) // 2 * 2 : 2]],
    }


def resolve_octave_pass(
    base: dict, lowered: dict, probe: "cfp.CfpProbe | None" = None
) -> tuple[dict, int]:
    """반옥타브 내려 다시 물어본 커브로 **아래로 깔린 옥타브만** 되올린다.

    **고음에서 f0가 반토막 나는 것은 모델 탓이 아니라 입력 표현의 성질이다**
    (실측 2026-08-18). RMVPE의 멜 프런트엔드가 8kHz까지인데 A♯5(932Hz)는 그
    안에 배음이 **8개**뿐이다(C3는 61개). ÷2 가설의 배음은 참 배음과 짝수
    자리에서 전부 겹치므로, 배음이 8개면 그것을 기각할 증거가 거의 없다.
    그래서 모델을 갈아끼워도(basic-pitch·FCPE) 똑같이 무너졌다 —
    `docs/고음_f0_미해결.md` §2.4·H5·H9.

    오디오를 한 옥타브 내리면 같은 음이 466Hz가 되어 **배음이 17개로 는다.**
    그것이 이 2패스의 전부다. 새 모델도 새 의존성도 없다.

    **아래 넷을 모두 만족할 때만 올린다.** 느슨하게 열면 이득은 커지지만
    (F5+ 평균 +7~9%p) 반드시 어느 한 곡의 전체 정확률이 내려간다.

    1. 두 패스가 같은 프레임에서 유성이다
    2. 두 커브가 **정확히 한 옥타브** 차이다(±50센트). 이 조건 하나가 저역을
       지킨다 — 음역 문턱을 따로 두는 판을 만들어 봤는데 MIDI 74 아래로는
       **아무 일도 하지 않았고**, 76 위로는 오히려 곡을 퇴행시켰다
    3. 기준 패스가 **자기 기준으로** 자신 없다(순위 < `OCTAVE_BASE_QUANTILE`)
    4. 2패스가 **자기 기준으로** 자신 있다(순위 > `OCTAVE_LIFT_QUANTILE`)

    그리고 다수결 창을 지난다 — 프레임 하나로 옥타브를 뒤집지 않는다.

    정답 6곡 실측(F5 이상 정확률 · −12 옥타브 오류):

    | 곡 | F5+ 정확 | −12 오류 |
    |---|---|---|
    | 곡A | 49 → **57%** | 19 → **11%** |
    | 곡B (커버2) | 32 → **42%** | 36 → **26%** |
    | 곡B (커버1) | 48 → **49%** | 9 → **7%** |
    | 곡C | 78 → **82%** | 6 → **2%** |
    | 곡D | 27 → 27% | 0 → 0% |
    | 곡E | 33 → **39%** | 8 → **2%** |

    **어느 곡도 어느 음역에서도 내려가지 않는다.** 바뀌는 프레임은 0.0~2.8%뿐이라
    보수적인 값이다. 재는 법은 `scripts/f0_truth.py`.

    반환은 (커브, 되올린 프레임 수). 뒤엣것은 `meta.json`에 남는다 — 이 장치의
    효과를 나중에 분리해서 읽으려면 얼마나 발동했는지를 알아야 한다.
    """
    restored = restore_octave_curve(lowered)
    size = min(len(base["f0"]), len(restored["f0"]))
    if size == 0:
        return base, 0

    base_f0 = np.asarray(base["f0"][:size], dtype=np.float64)
    lift_f0 = np.asarray(restored["f0"][:size], dtype=np.float64)
    base_conf = np.asarray(base["confidence"][:size], dtype=np.float64)
    lift_conf = np.asarray(restored["confidence"][:size], dtype=np.float64)

    with np.errstate(divide="ignore", invalid="ignore"):
        gap = 12.0 * np.log2(np.where(lift_f0 > 0, lift_f0, np.nan) / np.where(base_f0 > 0, base_f0, np.nan))

    candidate = np.abs(gap - 12.0) < 0.5
    pick = (
        candidate
        & (_quantile_rank(base_conf, base_f0 > 0) < OCTAVE_BASE_QUANTILE)
        & (_quantile_rank(lift_conf, lift_f0 > 0) > OCTAVE_LIFT_QUANTILE)
    )
    if probe is not None:
        # **다른 종류의 증거로 신뢰도 조건을 우회한다**(`app/cfp.py`). 켑스트럼이
        # 위 옥타브를, 스펙트럼이 아래 옥타브를 눌러 참 f0에서만 곱이 크다.
        # **후보 프레임에서만 계산한다** — 전체의 0.6~13%라 비용이 곡당 1초 안쪽이다.
        hop_sec = base["hopMs"] / 1000.0
        strong = np.zeros(size, dtype=bool)
        for index in np.flatnonzero(np.nan_to_num(candidate)):
            hz = base_f0[index]
            z_low, z_high = probe.salience(index * hop_sec, np.array([hz, hz * 2.0]))
            strong[index] = z_high > z_low * CFP_LIFT_RATIO
        pick = pick | strong

    pick = np.nan_to_num(pick.astype(np.float64))
    if OCTAVE_MAJORITY > 1 and size > OCTAVE_MAJORITY:
        # `mode="same"`은 **긴 쪽** 길이를 돌려준다 — 커브가 창보다 짧으면
        # 배열이 오히려 늘어나 뒤의 마스크와 모양이 안 맞는다(테스트가 잡았다).
        window = np.ones(OCTAVE_MAJORITY) / OCTAVE_MAJORITY
        pick = np.convolve(pick, window, mode="same")[:size] > 0.5
    pick = np.asarray(pick, dtype=bool) & (lift_f0 > 0) & (base_f0 > 0)

    return {
        "hopMs": base["hopMs"],
        "f0": [round(float(v), 3) for v in np.where(pick, lift_f0, base_f0)],
        "confidence": [round(float(v), 3) for v in np.where(pick, lift_conf, base_conf)],
    }, int(pick.sum())


def resolve_high_register(pitch: dict, lowered: dict) -> tuple[dict, int]:
    """고음 프레임을 **통째로** 2패스 커브로 바꾼다. 반환: (커브, 바꾼 프레임 수).

    `resolve_octave_pass`가 끝난 뒤에 건다. 저쪽이 "프레임마다 옥타브가 틀렸는지"를
    신뢰도로 묻는 보수적 판단이라면, 이쪽은 **"이 음역에서는 2패스가 더 낫다"**는
    구간 판단이다. 둘을 겹쳐 쓰는 이유는 고음에서 신뢰도가 무너져(위 상수의 주석)
    저쪽 규칙이 원리적으로 발동하지 못하기 때문이다.

    **왜 이것이 음표를 살리는가.** 프레임 정확률로는 F5+ 평균 +13%p인데 **음표
    회수율은 +52%p**다(커버1 32% → 84%). 증폭이 나는 자리가 `notes.ts`의 문턱이다 —
    DP는 일치 구간이 `SWITCH_MS`(7프레임)를 넘어야 음을 세우는데, 2패스가 그 구간을
    **이어 붙여** 주면 음표가 통째로 살아난다(8프레임 이상인 F5+ 음표 비율이
    커버1 62% → 78%, 커버2 48% → 76%).

    **유성 판정은 넓히지 않는다.** 기준 커브가 유성인 프레임만 바꾼다 —
    `merge_voicing`과 `MIN_CONFIDENCE`가 만든 판단을 우회하면 유령이 그만큼 돌아온다.
    """
    restored = restore_octave_curve(lowered)
    size = min(len(pitch["f0"]), len(restored["f0"]))
    f0 = np.asarray(pitch["f0"][:size], dtype=np.float64)
    conf = np.asarray(pitch["confidence"][:size], dtype=np.float64)
    lift_f0 = np.asarray(restored["f0"][:size], dtype=np.float64)
    lift_conf = np.asarray(restored["confidence"][:size], dtype=np.float64)

    with np.errstate(divide="ignore", invalid="ignore"):
        lift_midi = 69.0 + 12.0 * np.log2(np.where(lift_f0 > 0, lift_f0, np.nan) / 440.0)
    pick = np.nan_to_num(lift_midi >= OCTAVE_SPLIT_MIDI) & (lift_f0 > 0) & (f0 > 0)

    return {
        "hopMs": pitch["hopMs"],
        "f0": [round(float(v), 3) for v in np.where(pick, lift_f0, f0)],
        "confidence": [round(float(v), 3) for v in np.where(pick, lift_conf, conf)],
    }, int(pick.sum())


def octave_candidate(base: dict, lowered: dict) -> dict:
    """2패스 커브에서 **옥타브 후보만** 남긴 커브.

    `resolve_octave_pass`가 보수적으로 못 가져온 나머지를 버리지 않고 웹의 노트
    DP에 후보로 넘기기 위한 것이다(`f0.json`의 `f0Alt`). 프레임 단위 심판은 셋 다
    죽었지만(confidence 분위수·FCPE·스펙트럼 에너지 — `docs/고음_f0_미해결.md`
    §3), **프레이즈 단위의 연속성은 가릴 수 있다** — 그 판단은 음악적 판단이므로
    사이드카가 아니라 `core/transcribe`의 몫이다. 여기서는 신호만 추린다.

    남기는 것은 기준과 **정확히 ±1옥타브** 관계인 프레임뿐이다. 같은 값이면
    후보로서 무의미하고(0으로 비워 JSON을 키우지 않는다), 옥타브 관계가 아닌
    프레임의 2패스 값은 반주를 따라간 잡음이다(실측 스윕에서 확인).
    """
    restored = restore_octave_curve(lowered)
    size = min(len(base["f0"]), len(restored["f0"]))
    base_f0 = np.asarray(base["f0"][:size], dtype=np.float64)
    alt_f0 = np.asarray(restored["f0"][:size], dtype=np.float64)
    alt_conf = np.asarray(restored["confidence"][:size], dtype=np.float64)

    with np.errstate(divide="ignore", invalid="ignore"):
        gap = np.abs(
            np.abs(
                12.0
                * np.log2(
                    np.where(alt_f0 > 0, alt_f0, np.nan) / np.where(base_f0 > 0, base_f0, np.nan)
                )
            )
            - 12.0
        )
    keep = np.nan_to_num(gap, nan=np.inf) < 0.5

    return {
        "hopMs": base["hopMs"],
        "f0": [round(float(v), 3) for v in np.where(keep, alt_f0, 0.0)],
        "confidence": [round(float(v), 3) for v in np.where(keep, alt_conf, 0.0)],
    }


def pipeline_curve(mix: np.ndarray, rate: int, voicing: dict) -> tuple[dict, int, int]:
    """믹스 + 유·무성 커브 → 앱이 쓰는 최종 f0 커브(옥타브 후보 포함).

    **main.py와 평가 하니스가 이 함수 하나를 함께 쓴다.** 결선을 두 벌 적으면
    조용히 갈라져서 재던 것과 배포되는 것이 달라진다 — `scripts/f0_truth.py`가
    `resolve_octave_pass`를 직접 부르는 것과 같은 규칙이다.

    반환: (커브, 보수적으로 되올린 프레임 수, 음역 분할로 바꾼 프레임 수).
    **두 수를 합치지 않는다** — 장치가 둘이고, 나중에 어느 쪽이 얼마나 일했는지
    떼어 읽을 수 없으면 `meta.json`에 남기는 뜻이 없다.

    커브에는 `f0Alt`/`confidenceAlt`가 실린다 —
    옥타브 후보에도 **같은 마스크**를 걸어, 후보가 유령을 만들 수 있는 자리가
    기준 커브와 같아지게 한다.
    """
    base = extract_f0_from_samples(mix, rate)
    lowered = extract_f0_from_samples(mix, rate // 2)
    pitch, lifted = resolve_octave_pass(base, lowered, cfp.CfpProbe(mix, rate))
    pitch, switched = resolve_high_register(pitch, lowered)
    # **후보는 분할이 끝난 커브를 기준으로 뽑는다.** 분할 전 커브에 대고 재면
    # 이미 2패스로 바뀐 프레임에 "옥타브 후보"로 같은 값이 또 실린다.
    candidate = octave_candidate(pitch, lowered)

    curve = merge_voicing(pitch, voicing)
    alt = merge_voicing(candidate, voicing)
    size = len(curve["f0"])
    pad = size - len(alt["f0"])
    curve["f0Alt"] = alt["f0"][:size] + [0.0] * max(pad, 0)
    curve["confidenceAlt"] = alt["confidence"][:size] + [0.0] * max(pad, 0)
    return curve, lifted, switched


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
