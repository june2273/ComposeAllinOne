"""평가용 — 구조 모델(All-In-One)의 BPM을 정답과 대조한다. **서버를 안 띄운다.**

## 왜 이게 필요한가

우리 자기상관 파이프라인의 배수 오류를 규칙으로 고치려는 시도가 여섯 번 죽었다
(`docs/템포_배수오류_미해결.md`). 전부 **주기성에서 뽑은 양**이었고, 자기상관이
×2에 대해 자기닮음이라 그 모호성을 물려받았기 때문이다.

남은 축은 **학습된 제2의견**이고, 그게 이미 저장소 안에 있다 — 구조 사이드카가
자기 BPM을 함께 낸다. 그리고 곡D 오류를 원래 잡아낸 것이 바로 그것이다.
다만 캐시에 3곡뿐이라 "누구를 믿을 것인가"를 정할 수 없어서, 정답 곡 전부에
돌려 본다.

## 주의

**곡당 수 분이다.** allin1이 htdemucs를 우리와 별개로 한 번 더 돌린 뒤 8모델
배깅을 CPU에서 한다. 그래서 배치로 돌리고 결과를 JSON에 쌓는다 — 중간에 죽어도
이미 끝난 곡은 남는다.

```bash
cd server
SIDECAR_STRUCTURE=1 .venv/bin/python scripts/structure_bpm.py --out /tmp/allin1.json
```
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import structure  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EVALSET = ROOT / "evalset"
CACHE = ROOT / "server" / "cache"


def songs() -> list[dict]:
    """정답 BPM이 있고 제외되지 않은 곡들. `songs.json`이 유일한 출처다."""
    data = json.loads((EVALSET / "songs.json").read_text(encoding="utf-8"))
    out = []
    for s in data.get("songs", []):
        if s.get("exclude") or not s.get("truthBpm"):
            continue
        # 캐시가 없으면 원본에서 바로 읽는다 — 스템 분리를 치를 이유가 없다
        cached = CACHE / s["slot"] / "input.wav"
        audio = cached if cached.exists() else Path(s.get("source") or "")
        if not audio.exists():
            continue
        out.append({"slot": s["slot"], "name": s.get("name") or s["slot"],
                    "truthBpm": float(s["truthBpm"]), "audio": str(audio)})
    return out


def verdict(ours: float, truth: float) -> str:
    """`tempo.eval.ts`의 `ratioName`과 같은 분류. 4%가 MIREX 관례다."""
    if not ours or not truth:
        return "?"
    r = ours / truth
    for value, name in ((1, "정확"), (2, "x2"), (0.5, "/2"), (3, "x3"),
                        (1 / 3, "/3"), (1.5, "x3/2"), (2 / 3, "x2/3")):
        if abs(r / value - 1) < 0.04:
            return name
    return "틀림"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/allin1.json")
    ap.add_argument("--only", help="이름에 이 문자열이 든 곡만")
    ap.add_argument("--model", default=structure.MODEL,
                    help="allin1 가중치. harmonix-all(8폴드 배깅) 또는 harmonix-fold0 등")
    # **분리 결과를 남겨 두면 두 번째 실행이 훨씬 싸다.** allin1은
    # `<demix>/htdemucs/<이름>/{bass,drums,other,vocals}.wav`가 다 있으면 분리를
    # 건너뛴다(`allin1/demix.py`). 실측 분리 51초 · 추론 149초라, 폴드를 바꿔 가며
    # 재려면 이걸 재사용하는 것이 사실상 필수다.
    ap.add_argument("--demix-dir", help="분리 결과를 여기 남긴다(비우면 임시 폴더)")
    args = ap.parse_args()

    if not structure.available():
        raise SystemExit("구조 모델이 꺼져 있습니다 — SIDECAR_STRUCTURE=1 로 실행하세요")

    out_path = Path(args.out)
    # 이미 끝난 것은 건너뛴다. 곡당 수 분이라 중간에 죽으면 다시 하기 아깝다
    done: dict[str, dict] = {}
    if out_path.exists():
        done = {r["slot"]: r for r in json.loads(out_path.read_text())}

    todo = [s for s in songs() if not args.only or args.only in s["name"]]
    print(f"{len(todo)}곡 · 이미 끝난 것 {sum(1 for s in todo if s['slot'] in done)}개", flush=True)

    for i, song in enumerate(todo, 1):
        if song["slot"] in done:
            continue
        started = time.time()
        print(f"[{i}/{len(todo)}] {song['name'][:40]} …", flush=True)
        row = {**song}
        try:
            if args.demix_dir:
                work = Path(args.demix_dir)
                work.mkdir(parents=True, exist_ok=True)
                result = structure.analyze(Path(song["audio"]), work, model=args.model)
            else:
                with tempfile.TemporaryDirectory() as tmp:
                    result = structure.analyze(Path(song["audio"]), Path(tmp), model=args.model)
            row["allin1Bpm"] = float(result.get("bpm") or 0)
            row["beats"] = len(result.get("beats") or [])
            row["downbeats"] = len(result.get("downbeats") or [])
            row["segments"] = len(result.get("segments") or [])
            # 다운비트 간격에서 마디당 박을 되짚는다 — allin1은 박자표를 직접
            # 내지 않지만 beatPositions의 최댓값이 그것이다
            positions = result.get("beatPositions") or []
            row["beatsPerBar"] = max(positions) if positions else 0
        except Exception as exc:  # noqa: BLE001 — 한 곡이 죽어도 나머지는 돈다
            row["error"] = f"{type(exc).__name__}: {exc}"[:300]
            row["allin1Bpm"] = 0.0
        row["elapsedSec"] = round(time.time() - started, 1)
        row["model"] = args.model
        row["verdict"] = verdict(row["allin1Bpm"], song["truthBpm"])
        done[song["slot"]] = row
        out_path.write_text(json.dumps(list(done.values()), ensure_ascii=False, indent=2) + "\n")
        print(f"      정답 {song['truthBpm']:.0f} · allin1 {row['allin1Bpm']:.1f}"
              f" · {row['verdict']} · {row['elapsedSec']:.0f}초", flush=True)

    ok = sum(1 for r in done.values() if r.get("verdict") == "정확")
    print(f"\nallin1 정확 {ok}/{len(done)} → {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
