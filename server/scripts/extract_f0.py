"""f0 커브만 뽑는 CLI — 서버를 띄우지 않고 모델을 직접 부른다.

**평가용 도구다.** 곡 여럿에 대해 f0를 배치로 뽑아 두면
`web/scripts/eval/pipeline.eval.ts`가 그것을 MIDI까지 끌고 가고,
`web/scripts/eval_transcribe.py`가 정답 MIDI와 대조한다. HTTP로 하면 조합
하나마다 스템 분리가 다시 도는데, 여기서는 **캐시에 이미 있는 WAV를 바로
먹인다.**

    cd server
    .venv/bin/python scripts/extract_f0.py --out /tmp/f0 cache/*/vocal_processed.wav

**추론을 한 번만 돌리고 문턱만 바꿔** 커브를 여러 벌 낼 수 있다
(`--thresholds`). 문턱 훑기가 사실상 공짜인 이유이고, 다음 모델을 들일 때도
같은 방식으로 비교하면 된다.

출력 이름은 `<슬롯>-<입력>[-t<문턱>].json`이라 나중에 표로 모으기 쉽다.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def label_for(path: Path) -> str:
    """`cache/<digest>/stems/vocals.wav` → `<digest>-vocals`.

    슬롯(곡)과 입력 종류를 한 이름에 담는다. 스템은 `stems/` 아래 있고 나머지는
    슬롯 바로 밑이라 부모 디렉터리 이름만으로는 곡을 못 집는다.
    """
    slot = path.parent.parent.name if path.parent.name == "stems" else path.parent.name
    return f"{slot}-{path.stem}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument(
        "--thresholds",
        default="",
        help="쉼표로 여러 개 (예: 0.01,0.03,0.1). 비우면 melody.MIN_CONFIDENCE 하나",
    )
    args = parser.parse_args()

    import soundfile as sf

    from app import melody

    thresholds = [float(v) for v in args.thresholds.split(",") if v.strip()]
    args.out.mkdir(parents=True, exist_ok=True)

    for path in args.inputs:
        if not path.exists():
            print(f"건너뜀 (없음): {path}", file=sys.stderr)
            continue
        samples, rate = sf.read(str(path), dtype="float32", always_2d=True)
        started = time.monotonic()
        # 추론은 한 번. 문턱은 그 결과 위에서 갈린다.
        _t, frequency, confidence, _act = melody._load().predict(samples.mean(axis=1), rate)
        elapsed = time.monotonic() - started

        wanted = thresholds or [melody.MIN_CONFIDENCE]
        for threshold in wanted:
            curve = melody.curve_from_prediction(frequency, confidence, threshold)
            name = label_for(path)
            if thresholds:
                name += f"-t{threshold:g}"
            target = args.out / f"{name}.json"
            target.write_text(json.dumps(curve), encoding="utf-8")
            voiced = sum(1 for v in curve["f0"] if v > 0)
            total = len(curve["f0"]) or 1
            print(f"{target.name}: {total}프레임 · 유성 {voiced / total:.0%} · {elapsed:.1f}s")


if __name__ == "__main__":
    main()
