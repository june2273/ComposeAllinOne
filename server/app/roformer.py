"""보컬 분리 — Mel-Band RoFormer(Kimberley Jensen 판) 래퍼.

**들어보기용 스템이다.** 결과는 `stems/vocals_roformer.wav`로 htdemucs 스템
옆에 놓일 뿐이고, 유·무성 마스크·재발음 온셋·f0는 여전히 htdemucs `vocals`를
쓴다(`main._pipeline`). 귀로 비교해 보고 갈아탈지는 평가 하니스로 잰 뒤에
정한다 — 분리 SDR이 좋다고 전사가 좋아진다는 보장은 없다(`stems.py` 첫 주석의
SAR 이야기, `docs/고음_f0_미해결.md` §3.6).

**모델 코드는 `vendor/`에 있다**(ZFTurbo MSST, MIT). PyPI의 `BS-RoFormer`
최신판은 구조가 바뀌어 이 체크포인트(2024년 학습)와 키가 맞는다는 보장이 없고
새 의존성이 넷 늘어난다. ZFTurbo가 이 가중치를 올려 둔 그 파일을 고정해 가져왔다.

**가중치 913MB는 첫 사용 때 받는다**(HuggingFace, 모델 카드 MIT). RMVPE와 같은
방침이고, 그래서 `selftest`는 import까지만 본다. 피클 파일이라
`weights_only=True`로만 연다 — 임의 코드 실행 경로를 막는다.

끄려면 `SIDECAR_ROFORMER=0`.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Callable

import numpy as np

from .audio import Audio, MODEL_RATE, write_audio

#: `stems/` 안의 파일 이름이자 웹이 부르는 오디오 이름
STEM = "vocals_roformer"

REPO = "KimberleyJSN/melbandroformer"
FILENAME = "MelBandRoformer.ckpt"
#: **리비전을 고정한다.** 같은 이름으로 다른 가중치가 올라오면 결과가 조용히 바뀐다
REVISION = "ac9b0614ab3cd7f77219e18ba494dfd93956c348"

#: ZFTurbo `configs/KimberleyJensen/config_vocals_mel_band_roformer_kj.yaml` 그대로
CONFIG = dict(
    dim=384,
    depth=6,
    stereo=True,
    num_stems=1,
    time_transformer_depth=1,
    freq_transformer_depth=1,
    num_bands=60,
    dim_head=64,
    heads=8,
    attn_dropout=0,
    ff_dropout=0,
    flash_attn=True,
    dim_freqs_in=1025,
    sample_rate=44100,
    stft_n_fft=2048,
    stft_hop_length=441,
    stft_win_length=2048,
    stft_normalized=False,
    mask_estimator_depth=2,
    multi_stft_resolution_loss_weight=1.0,
    multi_stft_resolutions_window_sizes=(4096, 2048, 1024, 512, 256),
    multi_stft_hop_size=147,
    multi_stft_normalized=False,
)

#: 학습 조각 길이(8초). 같은 길이로 잘라 넣는다
CHUNK = 352_800
#: 조각을 반씩 겹친다(설정의 `num_overlap: 2`). 경계의 딸깍임을 창으로 지운다
OVERLAP = 2

Progress = Callable[[str, float], None]


def enabled() -> bool:
    return os.environ.get("SIDECAR_ROFORMER", "1") != "0"


def available() -> bool:
    """켜져 있고 필요한 패키지가 있는가. import를 시도하지 않고 확인한다."""
    from importlib.util import find_spec

    return enabled() and all(
        find_spec(name) is not None
        for name in ("torch", "einops", "rotary_embedding_torch", "librosa")
    )


def selftest() -> None:
    """모델 코드가 이 환경에서 import되는가. **가중치는 받지 않는다.**"""
    from .vendor.mel_band_roformer import MelBandRoformer  # noqa: F401


def weights_path() -> Path:
    from huggingface_hub import hf_hub_download

    return Path(hf_hub_download(REPO, FILENAME, revision=REVISION))


def load_model():
    import torch

    from .vendor.mel_band_roformer import MelBandRoformer

    model = MelBandRoformer(**CONFIG)
    state = torch.load(weights_path(), map_location="cpu", weights_only=True)
    model.load_state_dict(state, strict=True)
    return model.eval()


def overlap_add(
    samples: np.ndarray,
    infer: Callable[[np.ndarray], np.ndarray],
    chunk: int = CHUNK,
    overlap: int = OVERLAP,
    progress: Progress | None = None,
) -> np.ndarray:
    """`(채널, 길이)`를 조각내어 `infer`에 넣고 창을 씌워 다시 잇는다.

    **양 끝을 한 보폭씩 덧대고 시작한다.** 반씩 겹친 한 창의 합은 안쪽에서만
    일정하고 첫·끝 보폭에서는 무너진다 — 덧댄 구간이 그 몫을 받고 잘려 나간다.
    창의 합으로 나누므로 조각 수와 무관하게 입력이 그대로면 출력도 그대로다.
    """
    step = chunk // overlap
    length = samples.shape[-1]
    padded = np.pad(samples, ((0, 0), (step, step + chunk)))
    window = np.hanning(chunk + 1)[:-1].astype(np.float32)  # 주기형: 반 겹침 합이 1
    out = np.zeros_like(padded)
    weight = np.zeros(padded.shape[-1], dtype=np.float32)
    starts = range(0, step + length, step)
    total = len(starts)
    for done, start in enumerate(starts):
        piece = padded[:, start : start + chunk]
        out[:, start : start + chunk] += infer(piece) * window
        weight[start : start + chunk] += window
        if progress:
            # 진행률 보고가 곧 취소 지점이다(`JobStore.progress`)
            progress("보컬 분리(RoFormer)", (done + 1) / total)
    return (out / np.maximum(weight, 1e-6))[:, step : step + length]


def separate_vocals(audio: Audio, out_dir: Path, progress: Progress | None = None) -> Path:
    """보컬 스템 하나를 `out_dir/vocals_roformer.wav`로 쓴다. 원본과 샘플 정렬."""
    import torch

    from .stems import device

    if audio.rate != MODEL_RATE:
        raise ValueError(f"{MODEL_RATE}Hz 입력이어야 한다: {audio.rate}")
    if progress:
        progress("RoFormer 준비", 0.0)
    model = load_model()
    target = device()
    model.to(target)

    # htdemucs와 같은 이유로 모노를 복제해 스테레오로 넣는다
    mono = np.asarray(audio.samples, dtype=np.float32)

    def infer(piece: np.ndarray) -> np.ndarray:
        with torch.no_grad():
            tensor = torch.from_numpy(np.ascontiguousarray(piece))[None].to(target)
            return model(tensor)[0].float().cpu().numpy()

    stereo = overlap_add(np.stack([mono, mono]), infer, progress=progress)
    path = out_dir / f"{STEM}.wav"
    write_audio(path, Audio(samples=stereo.mean(axis=0).astype(np.float32), rate=MODEL_RATE))
    return path
