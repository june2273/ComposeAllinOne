"""오디오 입출력과 보컬 후처리.

**모델이 없다.** 여기 있는 것은 전부 결정론적 신호 처리라 짧은 사인파로
테스트가 돈다. 모델을 부르는 것은 `stems.py`와 `melody.py`뿐이다.
"""

from __future__ import annotations

import math
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

#: 분리·f0 추출에 쓰는 표본화율. demucs가 44.1kHz를 요구하므로 그대로 간다.
MODEL_RATE = 44_100

#: 보컬 후처리 고역통과 차단 주파수(Hz). 사람 목소리의 기본음은 남자 저음도
#: 80Hz 위라, 이 아래는 분리 아티팩트와 방 울림뿐이다.
HPF_HZ = 80.0

#: 무성 게이트의 히스테리시스(전체 RMS 대비). 켜질 때와 꺼질 때 기준을 다르게
#: 두지 않으면 경계에서 딸깍거리고, 그 딸깍임이 그대로 가짜 온셋이 된다.
GATE_OPEN = 0.06
GATE_CLOSE = 0.03

#: 라우드니스 정규화 목표(dBFS RMS). 진짜 K-weighted(BS.1770)가 아니라 단순
#: RMS다 — f0 추출기는 절대 레벨이 아니라 상대 모양을 보므로 이걸로 충분하다.
#: 사양서 §[0]이 요구하는 정규화는 원본 믹스 쪽이고, 여기는 f0 입력 전처리다.
TARGET_DBFS = -20.0


@dataclass(frozen=True)
class Audio:
    samples: np.ndarray  # float32, 모노
    rate: int

    @property
    def duration(self) -> float:
        return len(self.samples) / self.rate if self.rate else 0.0


def read_audio(path: Path, rate: int = MODEL_RATE) -> Audio:
    """파일을 모노 float32로 읽는다.

    **MP3는 ffmpeg로 통과시킨다.** 디코더마다 앞에 20~40ms 무음이 붙는데
    비트 추적 허용 오차가 70ms이므로 무시할 수 없다(사양서 §[0]). WAV로
    한 번 구우면 적어도 우리 파이프라인 안에서는 일관된다.
    """
    if path.suffix.lower() in {".mp3", ".m4a", ".aac", ".ogg", ".opus", ".webm"}:
        path = _to_wav(path)
    data, source_rate = sf.read(str(path), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    return Audio(samples=resample(mono, source_rate, rate), rate=rate)


def write_audio(path: Path, audio: Audio) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio.samples, audio.rate, subtype="PCM_16")


def _to_wav(path: Path) -> Path:
    out = path.with_suffix(".decoded.wav")
    if out.exists():
        return out
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-i", str(path), "-ac", "2", str(out)],
        check=True,
        capture_output=True,
    )
    return out


def resample(samples: np.ndarray, source: int, target: int) -> np.ndarray:
    """선형 보간 리샘플.

    다운샘플에서 에일리어싱이 남지만, 이 함수를 타는 것은 대개 44.1k→44.1k
    (그냥 통과)이거나 48k→44.1k처럼 비율이 1에 가까운 경우다. 크게 낮출 일이
    생기면 그때 저역통과를 앞에 붙일 것.
    """
    if source == target or len(samples) == 0:
        return samples.astype(np.float32, copy=False)
    length = int(round(len(samples) * target / source))
    at = np.linspace(0, len(samples) - 1, length, dtype=np.float64)
    return np.interp(at, np.arange(len(samples)), samples).astype(np.float32)


def highpass(samples: np.ndarray, rate: int, cutoff: float = HPF_HZ) -> np.ndarray:
    """1차 고역통과. 의존성을 늘리지 않으려고 직접 짰다(scipy를 안 쓴다).

    한 극짜리라 감쇠가 완만하지만 목적이 "저역을 없애는 것"이 아니라 "저역이
    f0 추정을 흔들지 못하게 하는 것"이라 충분하다.
    """
    if len(samples) == 0:
        return samples
    alpha = 1.0 / (1.0 + 2.0 * math.pi * cutoff / rate)
    out = np.empty_like(samples)
    previous_in = 0.0
    previous_out = 0.0
    for i, value in enumerate(samples):
        previous_out = alpha * (previous_out + value - previous_in)
        previous_in = value
        out[i] = previous_out
    return out


def gate(samples: np.ndarray, rate: int, window_ms: float = 20.0) -> np.ndarray:
    """무성 구간을 0으로 만든다. 히스테리시스로 경계의 딸깍임을 막는다.

    이걸 거는 이유는 f0 추정기의 진짜 병목이 피치가 아니라 **voicing**이기
    때문이다(사양서 §[8] — 단순 에너지 검출기를 쓰면 voicing false alarm이
    0.41~0.66까지 올라간다). 분리된 보컬 스템에는 노래하지 않는 구간에도
    반주 누설이 남아 있어, 그 자리에서 엉뚱한 f0가 나온다.
    """
    if len(samples) == 0:
        return samples
    window = max(1, int(rate * window_ms / 1000))
    padded = np.pad(samples**2, (0, (-len(samples)) % window))
    energy = padded.reshape(-1, window).mean(axis=1)
    rms = np.sqrt(energy)
    overall = float(np.sqrt(np.mean(samples**2))) or 1.0

    mask = np.zeros(len(rms), dtype=np.float32)
    open_gate = False
    for i, value in enumerate(rms):
        level = value / overall
        if open_gate:
            open_gate = level > GATE_CLOSE
        else:
            open_gate = level > GATE_OPEN
        mask[i] = 1.0 if open_gate else 0.0

    # 창 단위 마스크를 샘플 길이로 늘리고 경계를 5ms에 걸쳐 부드럽게 한다
    expanded = np.repeat(mask, window)[: len(samples)]
    ramp = max(1, int(rate * 0.005))
    kernel = np.ones(ramp, dtype=np.float32) / ramp
    smooth = np.convolve(expanded, kernel, mode="same")
    return (samples * smooth).astype(np.float32)


def normalize(samples: np.ndarray, target_dbfs: float = TARGET_DBFS) -> np.ndarray:
    rms = float(np.sqrt(np.mean(samples**2))) if len(samples) else 0.0
    if rms <= 1e-9:
        return samples
    gain = (10 ** (target_dbfs / 20)) / rms
    # 클리핑 방지. 정규화가 피크를 1 위로 올리면 그만큼 되돌린다
    peak = float(np.max(np.abs(samples))) * gain
    if peak > 0.99:
        gain *= 0.99 / peak
    return (samples * gain).astype(np.float32)


def process_vocal(audio: Audio) -> Audio:
    """분리된 보컬 → f0 추출에 넣을 신호.

    **결과를 파일로도 내보낸다**(`vocal_processed.wav`). 사양서 §6이 말하는
    대로 확정은 귀로 하는 것이고, 이 단계에서 목소리가 뭉개졌는지는 들어 봐야
    안다 — 숫자만 보면 f0가 왜 이상한지 영영 모른다.
    """
    samples = highpass(audio.samples, audio.rate)
    samples = gate(samples, audio.rate)
    samples = normalize(samples)
    return Audio(samples=samples, rate=audio.rate)
