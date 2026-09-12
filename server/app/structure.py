"""곡 구조 — All-In-One(Kim & Nam, WASPAA 2023) 래퍼.

**신호만 내보낸다.** 여기서 나오는 것은 `[{start, end, label}]`과 비트·다운비트
뿐이고, 그것을 우리 마디 격자에 얹고 pre-chorus를 붙이는 **음악적 판단은 웹의
`core/analysis/sections.ts`가 한다.** `stems.py`·`melody.py`와 같은 규칙이다.

이 층 가르기가 여기서는 특히 값을 한다 — 모델의 라벨 집합에 **pre-chorus가
없기 때문이다**(사양서 §9.3):

```python
HARMONIX_LABELS = ['start','end','intro','outro','break',
                   'bridge','inst','solo','verse','chorus']
```

J-pop의 B멜로는 `verse`나 `bridge`로 뭉개져 나온다. 모델을 갈아끼워서 될 일이
아니라 **학습 데이터(Harmonix)의 어휘가 그렇다.** 그래서 우리가 원하는 라벨은
어차피 후처리로 붙여야 하고, 그 후처리는 순수 로직이므로 웹에 있어야 한다.

## natten 호환 shim 셋 (실측 2026-08-12)

allin1 1.1.0은 2023년 natten API로 쓰였는데 그 사이 두 번 갈렸다. 그대로 두면
`import allin1`이 죽는다. **세 가지 모두 import 시점에 시끄럽게 터지는 종류라**
조용히 틀린 결과를 내는 부류가 아니다 — 그래서 shim으로 버틴다.

1. **`natten==0.21`은 `rpb`(학습된 상대 위치 편향)를 받는 분리형 API를 없앴다.**
   0.21의 `na1d`는 융합형이라 rpb를 넣을 자리가 없는데, rpb는 **가중치에 들어
   있는 값**이라 버릴 수 없다. `0.17.5`에는 같은 함수가 이름만 바뀌어 남아
   있다(`na1d_qk(..., rpb=)`). 그래서 0.17.5로 고정하고 옛 이름을 다시 붙인다.
   **0.14.6(원래 버전)은 torch 2.13 헤더에서 컴파일이 깨진다**(`ATen/cpu/vec`의
   `convert_to_float` 시그니처 변경) — 실측으로 확인했다.
2. `torch.cuda._device_t` — torch가 없앤 비공개 별칭을 natten 0.17이 import한다.
3. natten 0.17이 **import 시점에 CUDA 능력치를 묻는다.** CPU/MPS만 있는 기계에서
   `torch.cuda.get_device_capability()`가 단언으로 죽는다.

**버전을 올릴 때 이 셋을 다시 확인할 것.** 특히 1번은 natten을 최신으로 올리는
순간 되살아난다 — `requirements.txt`가 `natten==0.17.5`로 못박혀 있는 이유다.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Callable

#: `meta.json`에 적히는 엔진 이름. 캐시 무효화가 이걸 본다.
#: **모델 이름만이 아니라 입력 구성까지 바뀌면 함께 바꿀 것** — `melody.ENGINE`이
#: `"rmvpe+mask"`인 것과 같은 이유다.
ENGINE = "allin1-harmonix-all"

#: All-In-One의 사전학습 가중치 이름. 8개 모델의 배깅이 기본값(`harmonix-all`)이다.
#:
#: **반드시 `analyze()`에 넘겨야 한다.** 안 넘기면 allin1의 기본값이 쓰이는데
#: 지금은 그 값이 우연히 같아서 동작이 맞다 — 그래서 이 상수를 고쳐도 아무 일이
#: 일어나지 않던 시기가 있었다(2026-08-18에 잡았다). 폴드를 하나로 줄여 속도를
#: 재려다 발견한 것이고, 조용히 틀리는 종류라 회귀 시험을 붙여 뒀다.
MODEL = "harmonix-all"

#: **CPU로 고정한다.** natten의 커널이 MPS를 지원하지 않고, 이 저장소는 이미
#: "장치 자동 선택을 믿지 말 것"을 비싸게 배웠다(`melody._DEVICE` — onnxruntime이
#: CoreML을 고르면 긴 곡에서만 죽었다). 4분 곡에 수십 초라 값을 치를 만하다.
_DEVICE = "cpu"

#: **기본으로 꺼 둔다**(2026-08-14). 켜려면 `SIDECAR_STRUCTURE=1`.
#:
#: 기능이 고장 난 것이 아니라 **너무 느리다.** 이 단계 하나가 4분 곡에 수 분이고
#: (allin1이 htdemucs를 우리와 별개로 **한 번 더** 돌린 뒤 8모델 배깅 추론을
#: CPU에서 한다 — 위 `_DEVICE` 주석), `analyze()`가 블로킹 호출 하나라 그동안
#: 진행률이 80%에 붙어 움직이지 않는다. 사용자에게는 멈춘 것과 구별되지 않는다
#: (실측 2026-08-14: 그렇게 보여서 취소했다).
#:
#: **어디가 느린지 실측했다**(2026-08-18, 14곡): htdemucs 분리 **51초(25%)** ·
#: 스펙트로그램 1초 · **DiNAT 8폴드 추론 149초(74%)**. 곡당 211초다.
#: 우리 스템을 `demix_dir/htdemucs/<이름>/{bass,drums,other,vocals}.wav`로 심으면
#: 분리를 건너뛰지만(`stems.py`가 모노로 저장하므로 스테레오를 한 벌 더 남겨야
#: 한다) **211초 → 160초에 그친다.** 큰 손잡이는 폴드 수다 — `harmonix-fold0`
#: 하나면 78초이고, 정답 14곡에서 8폴드와 순이득이 0이었다(BPM이라는 대리
#: 지표로 본 것이고, 정작 목적인 구간 경계·라벨은 정답이 0곡이라 못 쟀다).
_ENABLED = os.environ.get("SIDECAR_STRUCTURE", "").lower() in ("1", "true", "yes", "on")

Progress = Callable[[str, float], None]


def available() -> bool:
    """allin1을 부를 수 있는가. import를 시도하지 않고 확인한다.

    **스위치가 꺼져 있으면 깔려 있어도 없는 것으로 친다**(위 `_ENABLED`).
    `unavailable`로 나가므로 `/health`가 `broken`이라 거짓말하지 않고, 파이프라인은
    이 단계를 통째로 건너뛴다. `_cache_hit`도 구조를 요구하지 않게 되어 이미 분석한
    곡이 이것 때문에 다시 돌지 않는다.
    """
    from importlib.util import find_spec

    if not _ENABLED:
        return False
    return all(find_spec(name) is not None for name in ("allin1", "natten", "madmom"))


def device() -> str:
    return _DEVICE


def _prepare_natten() -> None:
    """allin1을 import하기 전에 natten을 오늘의 torch에 맞춘다(위 주석 참조).

    **여러 번 불러도 안전하다** — 이미 붙어 있으면 아무것도 하지 않는다.
    """
    from typing import Union

    import torch

    if not hasattr(torch.cuda, "_device_t"):
        torch.cuda._device_t = Union[torch.device, str, int, None]  # type: ignore[attr-defined]
    if not torch.cuda.is_available():
        # natten이 import 시점에 부른다. CPU만 있는 기계에서는 단언으로 죽는다
        torch.cuda.get_device_capability = lambda *_a, **_k: (0, 0)  # type: ignore[assignment]

    import natten.functional as nf

    if not hasattr(nf, "natten1dqkrpb"):
        nf.natten1dqkrpb = lambda q, k, rpb, ks, d: nf.na1d_qk(q, k, ks, d, rpb=rpb)
        nf.natten1dav = lambda a, v, ks, d: nf.na1d_av(a, v, ks, d)
        nf.natten2dqkrpb = lambda q, k, rpb, ks, d: nf.na2d_qk(q, k, ks, d, rpb=rpb)
        nf.natten2dav = lambda a, v, ks, d: nf.na2d_av(a, v, ks, d)


def selftest() -> None:
    """구조 분석이 이 환경에서 도는가. 실패하면 그대로 던진다.

    **가중치를 내려받지 않는다.** `harmonix-all`은 첫 사용 때 받으므로, 서버를
    띄웠을 뿐인 사용자에게 그런 일이 조용히 일어나면 안 된다 —
    `stems.selftest`가 htdemucs에 대해 지키는 규칙과 같다.

    대신 **shim이 실제로 붙는지까지 본다.** 위 세 가지는 전부 import 시점에
    터지므로 여기서 잡힌다. 그것이 이 자가진단이 잡을 수 있는 전부이고,
    "import는 되는데 추론이 죽는" 부류는 못 잡는다는 것을 알고 받아들인다.
    """
    _prepare_natten()

    import allin1  # noqa: F401


def analyze(
    source: Path,
    work_dir: Path,
    progress: Progress | None = None,
    model: str = MODEL,
    keep_byproducts: bool = False,
) -> dict:
    """오디오 하나에서 구간·비트·다운비트를 뽑는다.

    **곡 전체를 한 번에 본다** — 진행률을 잘게 보고할 방법이 없다(allin1이
    블로킹 호출 하나다). 대신 앞뒤로 한 번씩 보고하고, 취소는 그 사이에서만
    받는다.

    `work_dir`에는 allin1이 자기 스템과 스펙트로그램을 굽는다. **우리 스템을
    물려주지 않는다** — `stems.py`가 모노로 저장하는데 allin1은 자기 형식의
    스테레오를 기대하므로 맞지 않는다. 대가는 htdemucs가 곡당 한 번 더 도는
    것이고, 그 값은 실측해서 다시 볼 자리다.
    """
    _prepare_natten()

    import allin1

    if progress:
        progress("구조 분석", 0.0)
    result = allin1.analyze(
        paths=source,
        # **명시적으로 넘긴다.** 안 넘기면 allin1의 기본값이 쓰여서 `MODEL`을
        # 고쳐도 아무 일이 안 일어난다(위 상수 주석).
        model=model,
        # **결과 JSON은 우리가 쓴다.** allin1의 out_dir 캐시를 쓰면 캐시가 두 벌이
        # 되고, 우리 `meta.json`의 엔진 판정과 어긋날 수 있다.
        out_dir=None,
        demix_dir=work_dir / "demix",
        spec_dir=work_dir / "spec",
        device=_DEVICE,
        include_activations=False,
        include_embeddings=False,
        # **기본은 False다 — 파이프라인은 스템을 남기지 않는다.** 평가 하니스가
        # 폴드를 바꿔 가며 잴 때만 True를 준다(`scripts/structure_bpm.py`).
        # 남길 때는 **입력 파일 이름이 곡마다 달라야 한다** — allin1이 스템과
        # 스펙트로그램을 `path.stem`으로 키잉해서, 우리 캐시처럼 전부
        # `input.wav`면 두 번째 곡부터 첫 곡의 스템을 조용히 물려받는다.
        keep_byproducts=keep_byproducts,
        multiprocess=False,
    )
    if progress:
        progress("구조 분석", 1.0)

    return {
        "engine": ENGINE,
        "bpm": result.bpm,
        "beats": [round(t, 3) for t in (result.beats or [])],
        "downbeats": [round(t, 3) for t in (result.downbeats or [])],
        "beatPositions": list(result.beat_positions or []),
        "segments": [
            {"start": round(s.start, 3), "end": round(s.end, 3), "label": s.label}
            for s in (result.segments or [])
        ],
    }


def write(result: dict, out_dir: Path) -> Path:
    path = out_dir / "structure.json"
    path.write_text(json.dumps(result), encoding="utf-8")
    return path
