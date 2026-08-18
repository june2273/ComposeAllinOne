"""f0 커브를 정답 MIDI에 대고 **음역대별로** 재는 도구.

**왜 `web/scripts/eval_transcribe.py`와 따로 있는가.** 저쪽은 음표 레벨이라
노트 분할(`notes.ts`)과 양자화(`quantize.ts`)가 결과에 섞여 들어온다. f0 자체를
고칠 때 그 지표를 보면 **무엇이 좋아졌는지 못 읽는다** — RMVPE 교체 때 양자화를
한 줄도 안 건드렸는데 `자리 일치`가 46% → 88%로 오른 전례가 있다. 여기서는
프레임 단위로 f0만 본다.

**음역대로 쪼개는 이유**는 이 저장소의 고음 문제가 곡 전체 평균에 묻히기
때문이다(`docs/고음_f0_미해결.md`). 구간은 곡마다 다시 계산하지 않고 **절대
음역으로 고정한다** — "낮은 1/3"식으로 나누면 곡 간 비교가 안 된다.

    cd server
    .venv/bin/python scripts/f0_truth.py --all
    .venv/bin/python scripts/f0_truth.py fdea2e5cb75d2458 --variant octave2

곡·정답 대응은 `evalset/songs.json`이 든다. 오디오는 `cache/<슬롯>/input.wav`.

## 읽는 법

- **정확**: 정답 음표 구간의 유성 프레임 중 ±50센트 안. 음표 경계 30ms는 뺀다
  (자음·전이 구간이라 음정이 뜻이 없다).
- **−12 / +12**: 정확히 한 옥타브 어긋난 프레임. **이것이 이 저장소의 주 오차원**이라
  `기타`와 갈라 놓는다.
- 정답이 곡 전체를 덮지 않을 수 있다(곡B는 22.5~113.2초뿐). **정답 구간 밖은
  아예 세지 않는다** — 안 그러면 없는 정답에 대해 틀렸다고 세게 된다.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import mido
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
EVALSET = ROOT.parent / "evalset"

# 음역 구간. 절대 음역으로 고정한다 (위 독스트링)
REGISTERS = ((0, 71, "C5 미만"), (72, 76, "C5~E5"), (77, 200, "F5 이상"))
# "맞았다"고 볼 폭(반음). eval_transcribe 쪽 창과 달리 여기는 음정만 본다
TOLERANCE = 0.5
# 음표 경계에서 뺄 구간(초)
EDGE_SEC = 0.03
# 오프셋 탐색 범위·간격(초). 정답 채보의 시작점이 오디오와 다르다 (실측 −0.12~+0.58)
OFFSET_RANGE, OFFSET_STEP = 1.0, 0.01


def read_truth(path: Path, bpm: float | None) -> list[tuple[float, float, int]]:
    """정답 MIDI → (시작초, 끝초, MIDI번호). 트랙을 전부 합친다."""
    mid = mido.MidiFile(str(path))
    tempo = 500_000
    for track in mid.tracks:
        for msg in track:
            if msg.type == "set_tempo":
                tempo = msg.tempo
                break
    # songs.json의 truthBpm이 있으면 그것을 믿는다 — set_tempo가 빠진 정답이 있다
    sec_per_beat = (60.0 / bpm) if bpm else (tempo / 1e6)
    out: list[tuple[float, float, int]] = []
    for track in mid.tracks:
        tick, held = 0, {}
        for msg in track:
            tick += msg.time
            if msg.type == "note_on" and msg.velocity > 0:
                held[msg.note] = tick
            elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
                if msg.note in held:
                    start = held.pop(msg.note) / mid.ticks_per_beat * sec_per_beat
                    out.append((start, tick / mid.ticks_per_beat * sec_per_beat, msg.note))
    return sorted(out)


def to_midi(f0: np.ndarray) -> np.ndarray:
    """0(무성)은 NaN으로. 이후 계산이 전부 `isfinite`로 걸러진다."""
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(f0 > 0, 69.0 + 12.0 * np.log2(np.maximum(f0, 1e-9) / 440.0), np.nan)


def tally(
    curve: np.ndarray, times: np.ndarray, truth: list, offset: float, lo: int, hi: int
) -> tuple[int, int, int, int]:
    """(프레임 수, 정확, −12, +12). 정답 음표 구간 안의 유성 프레임만 센다."""
    total = exact = down = up = 0
    for start, end, pitch in truth:
        if not lo <= pitch <= hi:
            continue
        inside = (
            (times >= start + offset + EDGE_SEC)
            & (times <= end + offset - EDGE_SEC)
            & np.isfinite(curve)
        )
        if inside.sum() < 2:
            continue
        delta = curve[inside] - pitch
        total += len(delta)
        exact += int((np.abs(delta) < TOLERANCE).sum())
        down += int((np.abs(delta + 12) < TOLERANCE).sum())
        up += int((np.abs(delta - 12) < TOLERANCE).sum())
    return total, exact, down, up


def best_offset(curve: np.ndarray, times: np.ndarray, truth: list) -> float:
    """정확률을 최대로 하는 시간 오프셋. 정답과 오디오의 시작점이 다르다."""
    grid = np.arange(-OFFSET_RANGE, OFFSET_RANGE + 1e-9, OFFSET_STEP)
    scores = []
    for offset in grid:
        total, exact, _down, _up = tally(curve, times, truth, offset, 0, 200)
        scores.append(exact / total if total else 0.0)
    return float(grid[int(np.argmax(scores))])


def curves_for(slot: str, variant: str) -> tuple[float, dict[str, np.ndarray]]:
    """슬롯의 오디오에서 커브를 뽑는다. 반환은 (홉초, {이름: MIDI 배열})."""
    import soundfile as sf

    from app import melody

    audio = ROOT / "cache" / slot / "input.wav"
    samples, rate = sf.read(str(audio), dtype="float32", always_2d=True)
    mono = samples.mean(axis=1)

    base = melody.extract_f0_from_samples(mono, rate)
    out = {"기준패스만": to_midi(np.asarray(base["f0"], dtype=np.float64))}

    if variant == "octave2":
        # **`melody.resolve_octave_pass`를 그대로 부른다** — 여기서 규칙을 다시
        # 구현하면 도구와 파이프라인이 갈려서, 재던 개선이 실제로 배포되는지
        # 알 수 없게 된다. 하니스가 `ui/transcription.tsx`와 같은 결선을 쓰는
        # 것과 같은 이유다.
        lowered = melody.extract_f0_from_samples(mono, rate // 2)
        fixed, lifted = melody.resolve_octave_pass(base, lowered)
        size = len(fixed["f0"])
        out = {k: v[:size] for k, v in out.items()}
        out[f"+2패스({lifted / max(size, 1):.1%})"] = to_midi(
            np.asarray(fixed["f0"], dtype=np.float64)
        )

    return base["hopMs"] / 1000.0, out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slots", nargs="*", help="비우고 --all 을 쓰면 정답 있는 곡 전부")
    parser.add_argument("--all", action="store_true")
    parser.add_argument(
        "--variant", default="none", choices=("none", "octave2"), help="함께 잴 비교군"
    )
    args = parser.parse_args()

    songs = json.loads((EVALSET / "songs.json").read_text(encoding="utf-8"))["songs"]
    wanted = [s for s in songs if s.get("truth")]
    if not args.all:
        if not args.slots:
            parser.error("슬롯을 적거나 --all 을 쓸 것")
        wanted = [s for s in wanted if s["slot"] in args.slots]
    if not wanted:
        parser.error("정답이 있는 곡이 없다")

    for song in wanted:
        truth = read_truth(EVALSET / song["truth"], song.get("truthBpm"))
        if not truth:
            continue
        hop, variants = curves_for(song["slot"], args.variant)
        times = np.arange(len(next(iter(variants.values())))) * hop
        # 오프셋은 **현재 커브 기준으로 한 번만** 정한다. 변형마다 다시 맞추면
        # 정렬이 좋아진 것과 음정이 좋아진 것이 한 숫자에 섞인다.
        offset = best_offset(next(iter(variants.values())), times, truth)

        span = f"{truth[0][0]:.1f}~{truth[-1][1]:.1f}초"
        print(f"\n=== {song['name'][:44]} [{song['slot']}] ===")
        print(f"  정답 {len(truth)}음 · {span} · 오프셋 {offset:+.2f}s")
        print(f"  {'음역':<10}{'프레임':>7}" + "".join(f"{n:>24}" for n in variants))
        print(f"  {'':<10}{'':>7}" + "".join(f"{'정확 / −12 / +12':>24}" for _ in variants))
        for lo, hi, label in (*REGISTERS, (0, 200, "── 전체")):
            cells, frames = [], 0
            for curve in variants.values():
                total, exact, down, up = tally(curve, times, truth, offset, lo, hi)
                frames = max(frames, total)
                size = max(total, 1)
                cells.append(
                    f"{100 * exact / size:5.1f}% /{100 * down / size:5.1f}% /{100 * up / size:4.1f}%"
                )
            print(f"  {label:<10}{frames:>7}" + "".join(f"{c:>24}" for c in cells))


if __name__ == "__main__":
    main()
