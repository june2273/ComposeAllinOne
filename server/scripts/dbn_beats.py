"""평가용 — **우리 ODF를 madmom DBN에 먹여 본다.**

## 왜

우리 템포 경로는 `자기상관 × 120중심 로그정규 prior → Ellis DP`다. 그런데
곡D는 **생 자기상관이 정답(84)을 1.6%로 맞히고 있었고 그 prior가 뒤집은**
경우다(`docs/템포_배수오류_미해결.md` §4).

madmom의 `DBNBeatTrackingProcessor`에는 그 prior가 없다 — 55~215 템포
상태공간 위의 전이 벌점(`transition_lambda`)뿐이고, **임의의 활성 곡선을
받는다.** 그래서 **특징(ODF)은 그대로 두고 추적기만 갈아끼운 비교**가 된다.

allin1 전체를 도입하는 것과 다른 점: DBN은 **학습된 모델이 아니라** 손으로 정한
전이확률 위의 Viterbi다. 그래서 이겼을 때 TypeScript로 옮겨 브라우저에 남길 수
있다(이 저장소는 이미 `chords.ts`·`notes.ts`에 Viterbi가 있다). 라이선스도
madmom **소스(BSD-3)**만 타고 CC BY-NC-SA인 모델 파일은 안 쓴다.

```bash
cd web && EVAL_ODF_ONLY=곡D npx vitest run --config vitest.eval.config.ts odf-dump
cd server && .venv/bin/python scripts/dbn_beats.py
```
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


def bpm_from_beats(beats: np.ndarray) -> tuple[float, float]:
    """비트열에서 BPM 둘 — 중앙값 기반과 전체 구간 기반.

    **둘 다 낸다.** 우리 `refinePeriod`는 "처음부터 끝까지 ÷ 주기 수"를 쓰는데
    (프레임 격자 양자화 편향을 없애려고 — 실측 150 → 153 사건), allin1은 간격
    히스토그램을 쓴다. 어느 쪽으로 재느냐로 결론이 갈리면 안 되므로 나란히 본다.
    """
    if len(beats) < 2:
        return 0.0, 0.0
    gaps = np.diff(beats)
    median = float(np.median(gaps))
    by_median = 60.0 / median if median > 0 else 0.0
    span = float(beats[-1] - beats[0])
    periods = round(span / median) if median > 0 else 0
    by_span = 60.0 * periods / span if periods and span > 0 else by_median
    return by_median, by_span


def verdict(ours: float, truth: float) -> str:
    if not ours or not truth:
        return "?"
    r = ours / truth
    for value, name in ((1, "정확"), (2, "x2"), (0.5, "/2"), (1.5, "x3/2"), (2 / 3, "x2/3")):
        if abs(r / value - 1) < 0.04:
            return name
    return "틀림"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--odf", default="/tmp/odf.json")
    ap.add_argument("--out", default="/tmp/dbn.json")
    args = ap.parse_args()

    from madmom.features.beats import DBNBeatTrackingProcessor
    from madmom.features.downbeats import DBNDownBeatTrackingProcessor

    songs = json.loads(Path(args.odf).read_text(encoding="utf-8"))
    rows = []
    for s in songs:
        fps = float(s["fps"])
        act = np.asarray(s["onset"], dtype=np.float64)
        # **활성값을 0~1로 민다.** DBN의 관측 모델은 확률처럼 생긴 값을 기대하는데
        # 우리 곡선은 RMS 배수라 상한이 없다. 최댓값으로 나누는 것이 가장 덜
        # 개입하는 방법이고, 순위는 보존되므로 봉우리 구조가 안 바뀐다.
        peak = float(act.max())
        act = act / peak if peak > 0 else act
        # **0을 남기면 안 된다.** 우리 ODF는 반파 정류라 0이 대부분인데, DBN의
        # 관측 모델이 `log(활성)`을 취하므로 `-inf`가 되어 Viterbi가 경로를
        # 못 찾는다(실측: 비트 0개). madmom의 RNN 활성은 시그모이드 출력이라
        # 이 문제가 없다 — 곡선을 갈아끼울 때 드러나는 전제 차이다.
        act = np.clip(act, 1e-6, 1.0 - 1e-6)

        beat_dbn = DBNBeatTrackingProcessor(min_bpm=55, max_bpm=215, fps=fps)
        beats = np.asarray(beat_dbn(act))
        med, span = bpm_from_beats(beats)

        # 마디까지 함께 추론하는 판도 본다 — 우리 캐스케이드에 없는 결합이다.
        # 활성 두 벌(beat, downbeat)이 필요한데 우리는 downbeat 곡선이 없으므로
        # 같은 곡선을 두 번 준다. **다운비트 위치는 믿을 게 못 되고**, 여기서
        # 보려는 것은 그 결합이 템포 판단을 바꾸는가뿐이다.
        # 두 열의 합이 1을 넘으면 `log(1 - sum)`이 NaN이 된다. 나눠 담는다
        two = np.stack([act * 0.7, act * 0.3], axis=-1)
        bar_dbn = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=fps)
        bar = np.asarray(bar_dbn(two))
        bar_med, bar_span = bpm_from_beats(bar[:, 0]) if len(bar) > 1 else (0.0, 0.0)
        bar_count = int(max(bar[:, 1])) if len(bar) else 0

        row = {
            "name": s["name"], "truthBpm": s["truthBpm"],
            "oursBpm": s["oursBpm"], "acfTopBpm": s["acfTopBpm"],
            "dbnBpmMedian": med, "dbnBpmSpan": span, "dbnBeats": int(len(beats)),
            "dbnBarBpmMedian": bar_med, "dbnBeatsPerBar": bar_count,
            "oursVerdict": verdict(s["oursBpm"], s["truthBpm"]),
            "dbnVerdict": verdict(span, s["truthBpm"]),
            "dbnBarVerdict": verdict(bar_span, s["truthBpm"]),
        }
        rows.append(row)
        print(
            f"{s['name'][:24]:<24} 정답 {s['truthBpm']:6.1f} | "
            f"우리 {s['oursBpm']:6.1f} {row['oursVerdict']:<4} | "
            f"DBN {span:6.1f} {row['dbnVerdict']:<4} | "
            f"DBN+마디 {bar_span:6.1f} ({bar_count}박) {row['dbnBarVerdict']}",
            flush=True,
        )

    Path(args.out).write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")
    ok_ours = sum(1 for r in rows if r["oursVerdict"] == "정확")
    ok_dbn = sum(1 for r in rows if r["dbnVerdict"] == "정확")
    ok_bar = sum(1 for r in rows if r["dbnBarVerdict"] == "정확")
    print(f"\n우리 {ok_ours}/{len(rows)} · DBN {ok_dbn}/{len(rows)} · DBN+마디 {ok_bar}/{len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
