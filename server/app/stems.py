"""스템 분리 — demucs(htdemucs) 래퍼.

**모델을 게으르게 부른다.** `import demucs`가 torch를 끌고 오는데 그것만으로
수 초가 걸리고 수백 MB를 먹는다. 서버가 뜨는 시각과 첫 분석이 붙어 있을 이유가
없으므로 실제로 필요할 때 부른다 — 덕분에 demucs가 설치되지 않은 환경에서도
`/health`가 뜨고, 웹은 그 응답을 보고 카드를 잠근다.

사양서 §[1]의 1순위는 ZFTurbo MSST(Mel-Band RoFormer 등)이고 demucs는 "대안
(간편)"이다. 여기서 demucs를 먼저 쓰는 것은 **pip 한 줄로 가중치까지 온다**는
점 때문이고, 품질이 모자라면 이 파일 하나를 갈아끼우면 된다 — 바깥은
`separate()`의 반환 모양만 안다.

**SDR이 아니라 SAR을 보고 고를 것**(사양서 §1.4). 분리 스템을 온셋·f0에 쓰면
중요한 것은 아티팩트의 적음이지 분리의 깨끗함이 아니다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable

import numpy as np

from .audio import Audio, MODEL_RATE, write_audio

#: htdemucs가 내보내는 스템 이름. 순서는 모델 출력 순서 그대로다.
STEM_NAMES = ("drums", "bass", "other", "vocals")

Progress = Callable[[str, float], None]


def available() -> bool:
    """demucs를 실제로 부를 수 있는가. import를 시도하지 않고 확인한다."""
    from importlib.util import find_spec

    return find_spec("demucs") is not None and find_spec("torch") is not None


def selftest() -> None:
    """분리 코드가 이 환경에서 도는가. 실패하면 그대로 던진다.

    **가중치를 내려받지 않는다.** `get_model()`을 부르면 첫 실행에서 수백 MB를
    받는데, 서버를 띄웠을 뿐인 사용자에게 그런 일이 조용히 일어나면 안 된다.
    여기서는 우리가 실제로 쓰는 심볼까지 import만 해 본다 — 설치가 깨진 경우
    (torch ABI 불일치 등)는 그 시점에 드러나고, 가중치 문제는 어차피 작업
    실행 중에 명확한 오류로 나온다.
    """
    import torch  # noqa: F401
    from demucs.apply import apply_model  # noqa: F401
    from demucs.pretrained import get_model  # noqa: F401


def device() -> str:
    """쓸 수 있는 가장 빠른 장치. Apple Silicon이면 mps."""
    try:
        import torch
    except ImportError:
        return "cpu"
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def separate(
    audio: Audio,
    out_dir: Path,
    progress: Progress | None = None,
) -> dict[str, Path]:
    """스템 넷으로 가른다. 반환은 `{이름: WAV 경로}`.

    **원본과 샘플 단위로 정렬되어야 한다**(사양서 §[1] 검증 항목). 어긋나면
    이후의 모든 타임스탬프가 망가진다 — demucs는 정렬을 지키므로 길이만 맞춘다.
    """
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    if progress:
        progress("모델 준비", 0.0)
    model = get_model("htdemucs")
    model.eval()
    target = device()
    model.to(target)

    # demucs는 스테레오를 기대한다. 우리는 모노로 들고 있으므로 복제한다 —
    # 진짜 스테레오 정보를 잃지만, f0와 온셋은 모노에서 뽑으므로 손해가 없다.
    mono = torch.from_numpy(np.asarray(audio.samples, dtype=np.float32))
    wav = torch.stack([mono, mono]).to(target)

    if progress:
        progress("스템 분리", 0.1)
    # **모델에 넣기 전에 정규화하고 나올 때 되돌린다.** demucs 자신이
    # `api.Separator.separate_tensor`에서 하는 일이고(`ref = wav.mean(0)` →
    # `(wav - mean) / std` → 출력에 `* std + mean`), `apply_model`을 직접
    # 부르면 우리가 해야 한다. 빠뜨리면 모델이 학습 때와 다른 레벨의 입력을
    # 보게 되어 분리가 나빠진다 — 조용한 녹음일수록 심하다. 지금 이 파이프라인의
    # 최대 오차원이 "보컬 스템에 남은 반주를 멜로디가 따라간다"는 것이라
    # 그냥 지나칠 자리가 아니다.
    reference = wav.mean(0)
    mean = reference.mean()
    std = reference.std() + 1e-8
    with torch.no_grad():
        # split=True로 조각내어 처리한다. 긴 곡을 한 번에 올리면 메모리가 터진다
        estimates = apply_model(
            model, ((wav - mean) / std)[None], split=True, overlap=0.25
        )[0]
    estimates = estimates * std + mean

    paths: dict[str, Path] = {}
    names = list(model.sources)
    for i, name in enumerate(names):
        samples = estimates[i].mean(dim=0).cpu().numpy().astype(np.float32)
        path = out_dir / f"{name}.wav"
        write_audio(path, Audio(samples=samples, rate=MODEL_RATE))
        paths[name] = path
        if progress:
            progress("스템 저장", 0.85 + 0.15 * (i + 1) / len(names))
    return paths
