"""전사 평가 — 정답 MIDI와 우리 MIDI를 대조한다.

**평가셋이 없으면 개선했는지 알 수 없다.** 임계값들(`quantize.ts`의 SIGMA_MS·
METRICAL_WEIGHT·FINE_RARE_RATIO, `notes.ts`의 SWITCH_MS)은 전부 합성 신호로
"의도대로 도는가"만 확인한 값이다. 이 스크립트는 그 다음 단계 — 정답이 있는
실곡에서 **숫자로** 재는 자리다.

    python3 web/scripts/eval_transcribe.py 정답.mid 우리.mid

정답 MIDI는 사람이 만든 악보(신스V·DAW에서 내보낸 것)를 전제한다. 트랙이 여럿이면
전부 합쳐서 본다 — 어느 성부를 따라갔는지도 알아야 하기 때문이다.

## 무엇을 재는가

1. **정렬** — 조옮김(±3반음)과 오프셋을 격자 탐색으로 함께 찾는다. 우리 전사가
   반음 어긋나거나 시작점이 밀려 있어도 리듬을 비교할 수 있어야 한다.
2. **자리 정확도** — 정박 / 8분 오프비트 / 16분 자리의 혼동 행렬. **이번 문제의
   핵심 지표다**(점8분쉼표·16분음표 남발은 곧 "16분 자리로 밀렸다"이다).
3. **드리프트 곡선** — 창마다 8분 격자에서 벗어난 중앙값. 이게 흔들리면
   상수 오프셋으로는 못 잡는다.
4. **분류** — 정확 / 옥타브만 다름 / 다른 음(시각은 맞음) / 정답에 없음(유령).
   양자화 문제와 멜로디 선택 문제를 갈라 보기 위한 것이다.

mido만 쓴다(MIT). 루트 `.venv`에 이미 있다 — citation.md 2-3절.
"""

from __future__ import annotations

import statistics
import sys
from collections import Counter
from dataclasses import dataclass

import mido

# 정렬 탐색 범위. 반음 셋이면 커버 곡의 키 변경까지 잡힌다
TRANSPOSE_RANGE = 3
# 정렬 시 "맞았다"고 볼 창(박). 16분음표 절반쯤
ALIGN_WINDOW = 0.15
# 분류 시 "같은 자리"로 볼 창(박). 8분음표 절반보다 조금 넓게
MATCH_WINDOW = 0.35
# 드리프트를 재는 창(박)
DRIFT_WINDOW = 40


@dataclass(frozen=True)
class Note:
    beat: float
    midi: int
    dur: float
    track: int


def read_notes(path: str) -> tuple[list[Note], float]:
    """MIDI → 박 단위 음표 목록. 트랙을 전부 합친다."""
    mid = mido.MidiFile(path)
    tempo = 500000
    for track in mid.tracks:
        for msg in track:
            if msg.type == "set_tempo":
                tempo = msg.tempo
                break
    notes: list[Note] = []
    for index, track in enumerate(mid.tracks):
        clock = 0
        held: dict[int, int] = {}
        for msg in track:
            clock += msg.time
            if msg.type == "note_on" and msg.velocity > 0:
                held[msg.note] = clock
            elif msg.type in ("note_off", "note_on") and msg.note in held:
                start = held.pop(msg.note)
                notes.append(
                    Note(
                        beat=start / mid.ticks_per_beat,
                        midi=msg.note,
                        dur=(clock - start) / mid.ticks_per_beat,
                        track=index,
                    )
                )
    notes.sort(key=lambda n: (n.beat, n.midi))
    return notes, 60_000_000 / tempo


def align(truth: list[Note], ours: list[Note]) -> tuple[int, float, int]:
    """조옮김과 오프셋을 함께 찾는다. 맞는 음 수가 최대인 조합."""
    by_pitch: dict[int, list[float]] = {}
    for note in truth:
        by_pitch.setdefault(note.midi, []).append(note.beat)

    best = (0, 0.0, -1)
    for shift in range(-TRANSPOSE_RANGE, TRANSPOSE_RANGE + 1):
        # 후보 오프셋은 앞부분 음표에서만 뽑는다 — 전수 탐색은 필요 없다
        offsets = {
            round(note.beat - beat, 2)
            for note in ours[:60]
            for beat in by_pitch.get(note.midi + shift, [])
        }
        for offset in offsets:
            hits = sum(
                1
                for note in ours
                if any(
                    abs(note.beat - offset - beat) < ALIGN_WINDOW
                    for beat in by_pitch.get(note.midi + shift, [])
                )
            )
            if hits > best[2]:
                best = (shift, offset, hits)
    return best


def slot(beat: float) -> int:
    """박 안의 자리. 0=정박, 2=8분 오프비트, 1·3=16분 자리"""
    return round((beat % 1) / 0.25) % 4


SLOT_NAME = {0: "정박", 1: "16분", 2: "8분", 3: "16분"}


def classify(truth: list[Note], ours: list[Note], shift: int, offset: float) -> dict:
    exact: list[tuple[Note, Note]] = []
    counts = Counter()
    tracks = Counter()
    for note in ours:
        near = [t for t in truth if abs(note.beat - offset - t.beat) < MATCH_WINDOW]
        same = [t for t in near if t.midi == note.midi + shift]
        if same:
            pick = min(same, key=lambda t: abs(note.beat - offset - t.beat))
            exact.append((note, pick))
            counts["정확"] += 1
            tracks[pick.track] += 1
        elif any((t.midi - note.midi - shift) % 12 == 0 for t in near):
            counts["옥타브만 다름"] += 1
        elif near:
            counts["다른 음"] += 1
        else:
            counts["정답에 없음"] += 1
    return {"exact": exact, "counts": counts, "tracks": tracks}


def report(truth_path: str, ours_path: str) -> None:
    truth, truth_bpm = read_notes(truth_path)
    ours, ours_bpm = read_notes(ours_path)
    beat_ms = 60000 / truth_bpm

    print(f"정답 {len(truth)}음 @ {truth_bpm:.2f}BPM   우리 {len(ours)}음 @ {ours_bpm:.2f}BPM")

    truth_slots = Counter(SLOT_NAME[slot(n.beat)] for n in truth)
    total = sum(truth_slots.values())
    print(
        "정답 리듬 어휘: "
        + " · ".join(f"{k} {v} ({v / total:.0%})" for k, v in truth_slots.most_common())
    )

    shift, offset, hits = align(truth, ours)
    print(f"정렬: 조옮김 {shift:+d}반음, 오프셋 {offset:+.2f}박 (엄격 일치 {hits})")
    if shift:
        print(f"  ** 우리 전사가 {-shift:+d}반음 어긋나 있다 — 조율 추정을 볼 것 **")

    result = classify(truth, ours, shift, offset)
    print("분류: " + " · ".join(f"{k} {v}" for k, v in result["counts"].most_common()))
    if result["tracks"]:
        spread = " ".join(f"{t}:{c}" for t, c in sorted(result["tracks"].items()))
        print(f"  정확 매칭이 걸린 정답 트랙: {spread}")

    exact = result["exact"]
    if not exact:
        print("매칭이 없다 — 정렬이 실패했거나 다른 곡이다")
        return

    devs = [(o.beat - offset - t.beat) * beat_ms for o, t in exact]
    print(
        f"온셋 편차: 중앙값 {statistics.median(devs):+.0f}ms · "
        f"평균 {statistics.mean(devs):+.0f}ms · 표준편차 {statistics.pstdev(devs):.0f}ms"
    )

    # 드리프트 — 상수 오프셋으로 잡히는지의 판단 근거
    print("드리프트(창마다 중앙값):")
    swing = []
    end = int(max(o.beat for o, _ in exact)) + 1
    for start in range(0, end, DRIFT_WINDOW):
        window = [d for (o, _), d in zip(exact, devs) if start <= o.beat < start + DRIFT_WINDOW]
        if len(window) >= 5:
            value = statistics.median(window)
            swing.append(value)
            print(f"  박 {start:4d}~{start + DRIFT_WINDOW:4d}: {value:+5.0f}ms (n={len(window)})")
    if swing:
        print(f"  진폭 {max(swing) - min(swing):.0f}ms — 16분 한 칸이 {beat_ms / 4:.0f}ms")

    # 자리 혼동 행렬 — 이번 문제의 핵심 지표
    grid = Counter()
    for o, t in exact:
        grid[(SLOT_NAME[slot(t.beat)], SLOT_NAME[slot(o.beat - offset)])] += 1
    right = sum(v for (a, b), v in grid.items() if a == b)
    print(f"자리 일치: {right}/{len(exact)} ({right / len(exact):.0%})")
    for (want, got), count in grid.most_common():
        if want != got:
            print(f"  {want} → {got}: {count}")

    # 음가
    ratios = [o.dur / t.dur for o, t in exact if t.dur > 0]
    if ratios:
        print(f"음가 비율(우리/정답): 중앙값 {statistics.median(ratios):.2f}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    report(sys.argv[1], sys.argv[2])
