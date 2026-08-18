"""구조 대조 — 우리 섹션 vs 사람이 찍은 정답.

```bash
python3 web/scripts/eval_structure.py evalset/truth/곡E.sections.json /tmp/structure/곡E.sections.json
```

`eval_transcribe.py`와 같은 자리이고 같은 방침이다 — **의존성 없이 stdlib만
쓴다**(이 저장소의 `.venv`에는 `mido` 하나뿐이다).

## 지표의 정의는 MIREX/`mir_eval`을 그대로 따랐다

`mir_eval.segment.detection`(경계 F)과 `mir_eval.segment.pairwise`(그룹핑 F)의
정의를 읽고 새로 구현했다. **코드를 옮기지 않았다.** 숫자를 밖에 내놓을 일이
생기면 한 번은 임시 환경의 `mir_eval`과 대조해 볼 것 — 정직하게 적어 두는
위험이다.

## 무엇을 보는가

- **경계 F @0.5s / @3.0s** — 엄격한 것과 관대한 것을 함께 본다(MIREX 관례).
  둘의 차이가 크면 "경계는 찾았는데 몇 초씩 어긋난다"는 뜻이다.
- **경계 중앙 오차** — 부호가 있다. **한 방향으로 몰리면 우리 다운비트 위상이
  밀린 것**이다(`meter.ts`가 전역 위상 하나로 다운비트를 놓는다). 그 경우
  범인은 구조가 아니라 격자다.
- **라벨 프레임 정확도** — 10ms 격자로 잰다. `unknown`은 오답이다.
- **pre-chorus 정밀도·재현율** — **따로 낸다.** 나머지 라벨은 모델이 낸 것이고
  pre-chorus만 우리가 규칙으로 붙인 것이라, 그것만 떼어 봐야 그 규칙의 값을 안다.
- **혼동 행렬** — 무엇을 무엇으로 착각하는가.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

#: 경계 허용 오차(초). MIREX가 쓰는 두 값 그대로다.
TOLERANCES = (0.5, 3.0)
#: 라벨 정확도를 잴 격자(초).
FRAME_SEC = 0.01
#: 이 라벨이 이 도구의 관심사다 — 유일하게 우리가 붙인 것이라서.
FOCUS = "pre-chorus"


def load(path: Path) -> tuple[list[tuple[float, float, str]], float]:
    """`{sections:[{time,label}]}` → `[(시작, 끝, 라벨)]`.

    마지막 항목은 곡의 끝을 닫는 센티널이라 구간이 되지 않는다.
    """
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows = sorted(raw["sections"], key=lambda s: float(s["time"]))
    spans: list[tuple[float, float, str]] = []
    for current, following in zip(rows, rows[1:]):
        label = str(current["label"])
        if label in {"start", "end"}:
            continue
        spans.append((float(current["time"]), float(following["time"]), label))
    end = float(rows[-1]["time"]) if rows else 0.0
    return spans, end


def boundaries(spans: list[tuple[float, float, str]]) -> list[float]:
    """구간 경계. 곡의 처음과 끝은 빼고 잰다 — 누구나 맞히는 자리라서."""
    if not spans:
        return []
    return [span[0] for span in spans[1:]]


def match(truth: list[float], ours: list[float], tolerance: float) -> int:
    """그리디 1:1 매칭. 정답 하나에 추정 하나만 붙는다.

    1:1이 아니면 경계를 잘게 흩뿌리는 쪽이 유리해진다 — 재현율이 공짜로 오른다.
    """
    used = [False] * len(ours)
    hits = 0
    for t in truth:
        best, best_gap = -1, tolerance
        for i, o in enumerate(ours):
            if used[i]:
                continue
            gap = abs(o - t)
            if gap <= best_gap:
                best, best_gap = i, gap
        if best >= 0:
            used[best] = True
            hits += 1
    return hits


def f_measure(hits: int, truth_count: int, our_count: int) -> tuple[float, float, float]:
    precision = hits / our_count if our_count else 0.0
    recall = hits / truth_count if truth_count else 0.0
    if precision + recall == 0:
        return 0.0, 0.0, 0.0
    return precision, recall, 2 * precision * recall / (precision + recall)


def offsets(truth: list[float], ours: list[float], tolerance: float) -> list[float]:
    """매칭된 쌍의 `우리 − 정답`. 부호를 살린다."""
    used = [False] * len(ours)
    out: list[float] = []
    for t in truth:
        best, best_gap = -1, tolerance
        for i, o in enumerate(ours):
            if used[i]:
                continue
            if abs(o - t) <= best_gap:
                best, best_gap = i, abs(o - t)
        if best >= 0:
            used[best] = True
            out.append(ours[best] - t)
    return out


def label_at(spans: list[tuple[float, float, str]], time: float) -> str:
    for start, end, label in spans:
        if start <= time < end:
            return label
    return "—"


def median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("truth", type=Path, help="사람이 찍은 정답")
    parser.add_argument("ours", type=Path, help="우리가 낸 것 (같은 형식)")
    args = parser.parse_args(argv)

    truth_spans, truth_end = load(args.truth)
    our_spans, our_end = load(args.ours)
    if not truth_spans:
        print("정답에 구간이 없다", file=sys.stderr)
        return 1

    truth_bounds = boundaries(truth_spans)
    our_bounds = boundaries(our_spans)

    print(f"구간 수      정답 {len(truth_spans)} · 우리 {len(our_spans)}")
    print()
    for tolerance in TOLERANCES:
        hits = match(truth_bounds, our_bounds, tolerance)
        precision, recall, f = f_measure(hits, len(truth_bounds), len(our_bounds))
        print(
            f"경계 @{tolerance:>3.1f}s   F {f:.3f}   "
            f"정밀도 {precision:.3f}  재현율 {recall:.3f}  ({hits}/{len(truth_bounds)})"
        )

    drift = offsets(truth_bounds, our_bounds, TOLERANCES[-1])
    if drift:
        print(
            f"경계 오차    중앙 {median(drift) * 1000:+.0f}ms   "
            f"최소 {min(drift) * 1000:+.0f} / 최대 {max(drift) * 1000:+.0f}"
        )
        # 한 방향으로 몰리면 구조가 아니라 다운비트 격자를 의심할 자리다
        if len(drift) >= 4 and abs(median(drift)) > 0.2:
            print("             ^ 한 방향으로 몰렸다 — 우리 다운비트 위상부터 볼 것")
    print()

    # --- 라벨 (프레임 단위) ---
    end = max(truth_end, our_end)
    frames = int(end / FRAME_SEC)
    agree = 0
    confusion: dict[tuple[str, str], int] = {}
    for i in range(frames):
        time = i * FRAME_SEC
        want = label_at(truth_spans, time)
        got = label_at(our_spans, time)
        if want == "—":
            continue
        if want == got:
            agree += 1
        confusion[(want, got)] = confusion.get((want, got), 0) + 1
    total = sum(confusion.values())
    print(f"라벨 정확도  {agree / total:.3f}" if total else "라벨 정확도  —")

    focus_truth = sum(n for (want, _), n in confusion.items() if want == FOCUS)
    focus_ours = sum(n for (_, got), n in confusion.items() if got == FOCUS)
    focus_hit = confusion.get((FOCUS, FOCUS), 0)
    precision, recall, f = f_measure(focus_hit, focus_truth, focus_ours)
    print(
        f"{FOCUS:<12} F {f:.3f}   정밀도 {precision:.3f}  재현율 {recall:.3f}"
        "   ← 모델이 아니라 우리 규칙이 붙인 것"
    )
    print()

    print("혼동 (정답 → 우리, 초)")
    for (want, got), n in sorted(confusion.items(), key=lambda kv: -kv[1]):
        if n * FRAME_SEC < 1.0:
            continue
        mark = "  " if want == got else "≠ "
        print(f"  {mark}{want:<12} → {got:<12} {n * FRAME_SEC:6.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
