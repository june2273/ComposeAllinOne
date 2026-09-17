"""평가용 — Beat This!(Foscarin et al., ISMIR 2024)의 BPM을 정답과 대조한다.

## 왜 이걸 재는가

템포 배수 오류를 규칙으로 고치려는 시도가 **여덟 번** 죽었다
(`docs/템포_배수오류_미해결.md`). H8이 특히 결정적이었다 — prior 없는 madmom DBN에
우리 ODF를 먹여도 곡D가 166.6이었고, 거기서 내린 결론이 **"판정 규칙이 아니라
곡선이 이미 그렇게 생겼다"**였다.

그 결론이 가리키는 다음 수는 하나뿐이다: **곡선을 갈아치우는 것.** Beat This!는
우리 1차원 ODF 대신 학습된 표현을 쓰고, GTZAN 비트 F1 89.1로 지금 사실상 1등이다.
allin1(10/14)과 달리 DiNAT도 8폴드 배깅도 없어서 훨씬 싸다.

## 계산은 `app/beats.py`에서 import한다 — 여기 다시 적지 않는다

Beat This!는 **비트만 낸다 — BPM을 안 낸다.** 되뽑는 방법(`refine_period`),
빠진 비트 채우기(`fill_dropped_beats`), 마디당 박(`beats_per_bar`)이 전부
앱 모듈에 있고 여기서 가져다 쓴다. **두 벌이 되면 이 하니스가 내는 숫자는
"Beat This!가 더 낫다"가 아니라 "요약법이 다르다"를 재게 된다.**

여기 남는 것은 하니스의 일뿐이다 — 곡 목록·정답 대조·`cross_check`.

```bash
cd server
.venv/bin/python scripts/beatthis_bpm.py --out /tmp/beatthis.json
```
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.beats import (  # noqa: E402
    MODEL,
    beats_per_bar,
    fill_dropped_beats,
    refine_period,
)
from structure_bpm import songs, verdict  # noqa: E402

#: **CPU로 고정한다.** `app.beats._DEVICE`와 같은 이유다
#: (장치 자동 선택을 믿지 말 것 — `melody._DEVICE` 이력).
DEVICE = "cpu"


def cross_check(beats: list[float], downbeats: list[float], bar: int) -> dict:
    """**BPM이 맞는지를 비트가 아닌 채널로 다시 묻는다.**

    이게 없으면 `refine_period`의 20% 안쪽 거르기가 답을 만들어 냈는지 알 수 없다.
    실측으로 실제 겪은 일이다 — 곡B는 간격의 34%가 중앙값의 두 배라 **곡 안에서
    185와 92.5를 오간다고 의심할 만했다.** 다운비트는 비트열과 따로 예측되므로,
    거기서 나온 마디 주기가 같은 답을 가리키면 거르기가 만든 값이 아니다
    (실측: 곡B의 다운비트가 184.6을 가리켜 의심이 풀렸다).

    - `inlier`: 중앙값의 ±20% 안에 드는 간격의 비율. **낮으면 추적이 불안정하다는
      뜻이지 BPM이 틀렸다는 뜻이 아니다** — 놓친 비트가 두 배 간격을 만든다.
    - `barBpm`: 다운비트 간격 ÷ 마디당 박. **4박을 가정하지 않는다** — 곡J가
      3/4인데 4로 나누면 266.7이 나와 멀쩡한 답이 틀린 것처럼 보인다(실측).
    """
    gaps = [b - a for a, b in zip(beats, beats[1:])]
    if not gaps:
        return {"inlier": 0.0, "barBpm": 0.0}
    median = statistics.median(gaps)
    inlier = (sum(1 for g in gaps if abs(g / median - 1) < 0.2) / len(gaps)
              if median > 0 else 0.0)

    dgaps = [b - a for a, b in zip(downbeats, downbeats[1:])]
    bar_bpm = 0.0
    if dgaps and bar > 0:
        # **중앙값이다.** 평균을 쓰면 추적이 빠진 구간의 긴 간격이 끌어내린다
        # (실측: 곡B의 다운비트 평균은 1.75초인데 중앙값은 1.30초다 — 앞은 185를
        # 부정하는 것처럼 보이고 뒤는 확인해 준다).
        bar_period = statistics.median(dgaps) / bar
        if bar_period > 0:
            bar_bpm = 60.0 / bar_period
    return {"inlier": round(inlier, 3), "barBpm": round(bar_bpm, 1)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/beatthis.json")
    ap.add_argument("--only", help="이름에 이 문자열이 든 곡만")
    ap.add_argument("--model", default=MODEL, help="가중치(final0/final1/final2/small0 등)")
    ap.add_argument("--device", default=DEVICE)
    # **madmom DBN 후처리.** 논문의 요지는 "DBN 없이도 SOTA"인데, 우리 관심사는
    # F1이 아니라 배수다. DBN은 템포 일관성을 강제하므로 **켜고 끈 값이 다를 수
    # 있고, 그 차이 자체가 읽을거리다.** 기본은 논문 기본값(끔)이다.
    ap.add_argument("--dbn", action="store_true", help="madmom DBN 후처리를 켠다")
    # **비트 시각을 재려면 BPM만으로는 모자란다.** 양자화의 드리프트 곡선은 우리
    # 비트에 맞춰 상수를 정한 것이라, BPM이 맞아도 자리가 어긋나면 악보가 나빠진다.
    # 슬롯별로 떨궈 두면 `pipeline.eval.ts`가 `EVAL_BEATS`로 받아 격자 MIDI를 굽고
    # `eval_transcribe.py`가 정답과 대조한다 — 기존 하니스를 그대로 쓴다.
    ap.add_argument("--beats-dir", help="비트·다운비트를 슬롯별 JSON으로 떨군다")
    # 기본으로 켠다 — 아래 실측이 정한 값이다(`fill_dropped_beats` 주석).
    # 끄고 재려면 `--no-fill`.
    ap.add_argument("--no-fill", dest="fill", action="store_false",
                    help="빠진 비트를 안 채운다(비교용)")
    ap.set_defaults(fill=True)
    args = ap.parse_args()

    from beat_this.inference import File2Beats

    out_path = Path(args.out)
    done: dict[str, dict] = {}
    if out_path.exists():
        done = {r["slot"]: r for r in json.loads(out_path.read_text())}

    # 격자를 떨굴 때는 정답 없는 곡도 돈다 — 웹 하니스가 그것들도 본다
    todo = [s for s in songs(require_truth=not args.beats_dir)
            if not args.only or args.only in s["name"]]
    print(f"{len(todo)}곡 · 이미 끝난 것 {sum(1 for s in todo if s['slot'] in done)}개",
          flush=True)

    f2b = File2Beats(checkpoint_path=args.model, device=args.device, dbn=args.dbn)

    for i, song in enumerate(todo, 1):
        if song["slot"] in done:
            continue
        started = time.time()
        print(f"[{i}/{len(todo)}] {song['name'][:40]} …", flush=True)
        row = {**song}
        try:
            beats, downbeats = f2b(song["audio"])
            beats = [float(t) for t in beats]
            downbeats = [float(t) for t in downbeats]
            raw = len(beats)
            if args.fill:
                beats = fill_dropped_beats(beats)
            row["filled"] = len(beats) - raw
            period = refine_period(beats)
            row["bpm"] = 60.0 / period if period > 0 else 0.0
            row["beats"] = len(beats)
            row["downbeats"] = len(downbeats)
            bar = beats_per_bar(beats, downbeats)
            row["beatsPerBar"] = bar
            row.update(cross_check(beats, downbeats, bar))
            if args.beats_dir:
                out = Path(args.beats_dir)
                out.mkdir(parents=True, exist_ok=True)
                (out / f"{song['slot']}.json").write_text(
                    json.dumps({"engine": f"beatthis-{args.model}"
                            + ("" if args.fill else "-nofill"),
                                "bpm": row["bpm"], "beatsPerBar": bar,
                                "beats": [round(t, 4) for t in beats],
                                "downbeats": [round(t, 4) for t in downbeats]},
                               ensure_ascii=False) + "\n", encoding="utf-8")
        except Exception as exc:  # noqa: BLE001 — 한 곡이 죽어도 나머지는 돈다
            row["error"] = f"{type(exc).__name__}: {exc}"[:300]
            row["bpm"] = 0.0
        row["elapsedSec"] = round(time.time() - started, 1)
        row["model"] = args.model
        row["dbn"] = args.dbn
        row["verdict"] = (verdict(row["bpm"], song["truthBpm"])
                          if song["truthBpm"] else "?")
        done[song["slot"]] = row
        out_path.write_text(json.dumps(list(done.values()), ensure_ascii=False, indent=2) + "\n")
        truth = f"{song['truthBpm']:.0f}" if song["truthBpm"] else "  ?"
        print(f"      정답 {truth} · BeatThis {row['bpm']:.1f}"
              f" · {row['verdict']} · {row.get('beatsPerBar', 0)}박"
              f" · 마디가 말하는 BPM {row.get('barBpm', 0):.1f}"
              f" · 안쪽 {row.get('inlier', 0) * 100:.0f}%"
              f" · 채움 {row.get('filled', 0)}"
              f" · {row['elapsedSec']:.0f}초", flush=True)

    # **정답 없는 곡은 분모에서 뺀다.** 격자를 떨구려고 함께 돌 뿐이라
    # 같이 세면 "14/22"가 되어 멀쩡한 결과가 실패로 읽힌다.
    judged = [r for r in done.values() if r.get("verdict") not in (None, "?")]
    ok = sum(1 for r in judged if r["verdict"] == "정확")
    print(f"\nBeat This! 정확 {ok}/{len(judged)}"
          f" (정답 없는 {len(done) - len(judged)}곡은 격자만) → {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
