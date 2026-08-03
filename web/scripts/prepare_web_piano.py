"""피아노 음원을 웹용으로 굽는다.

`assets/UprightPianoKW/`(31MiB, FLAC 24bit 스테레오 7초)를 브라우저가 바로
받아 쓸 수 있는 형태로 바꿔 `web/public/piano/`에 넣는다.

    .venv/bin/python web/scripts/download_assets.py      # 먼저 원본을 받고
    .venv/bin/python web/scripts/prepare_web_piano.py    # 그다음 이걸 돌린다

**왜 원본을 그대로 안 쓰는가**

| | 원본 | 웹용 |
|---|---|---|
| 포맷 | FLAC 24bit | AAC(m4a) 64kbps |
| 채널 | 스테레오 | 모노 |
| 길이 | 약 7초 | 3초 |
| 전체 | 31MiB | 약 2MiB |

문제 하나가 길어야 2초인데 7초짜리 24bit 스테레오를 받을 이유가 없다.
**AAC를 고른 이유는 Safari 때문**이다 — Ogg Vorbis는 Safari가 못 읽고
Opus-in-Ogg도 확실하지 않은데, AAC는 모든 브라우저가 읽는다. Safari 사용자는
Web MIDI가 없어 자판으로 연습하는 쪽이라 소리마저 안 나면 곤란하다.

**런타임에 SFZ를 파싱하지 않는다.** 여기서 `manifest.json`으로 구워 두면
브라우저는 표만 읽으면 된다. SFZ 해석은 옆의 `sfz.py`가 맡는다.

**이 세 스크립트(`sfz.py`·`download_assets.py`·이 파일)만 Python이다.** 앱
코드는 전부 TypeScript이고, 이것들은 빌드 타임에 한 번 돌려 자산을 굽는
도구일 뿐이다 — 앱이 실행 중에 Python을 부르는 곳은 없다.

출력물은 저장소에 커밋하지 않는다(`web/.gitignore`). 원본과 같은 방침이다.
"""

from __future__ import annotations

import json
import shutil
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from sfz import parse_sfz

ROOT = Path(__file__).resolve().parents[2]
SFZ = ROOT / "assets" / "UprightPianoKW" / "UprightPianoKW-20220221.sfz"
SRC = SFZ.parent
DEST = ROOT / "web" / "public" / "piano"

#: 문제 재생 2초 + ampeg_release 0.6초에 여유를 둔 길이
TRIM_SEC = 3.0
#: 잘라낸 끝에서 딸깍 소리가 나지 않도록
FADE_SEC = 0.03
BITRATE = "64k"

# --- 조율 측정 -----------------------------------------------------------------
#
# 이 녹음은 평균율에서 벗어나 있는데, **대부분은 조율 불량이 아니라 Railsback
# 곡선**이다 — 현의 강성(인하모니시티) 때문에 실제 피아노는 저음을 일부러 낮게,
# 고음을 높게 조율한다. 실측도 그 모양이다(저음 −94~−25센트, 중음 ±13센트,
# 고음 +14~+35센트).
#
# 그래도 평균율로 당기는 이유: 이 앱은 **음정을 가르친다.** 예를 들어 D#3가
# −12.7센트, A3가 −4.7센트면 그 트라이톤은 8센트 어긋난 채로 들린다. 화성
# 훈련에서 이건 느린 맥놀이로 들린다.
#
# 오디오는 다시 굽지 않는다. 센트 값을 매니페스트에 적어 두고 재생할 때
# playbackRate로 민다 — 음질 손실이 없고, 녹음 그대로 듣고 싶으면 이 표를
# 비우기만 하면 된다(오디오는 보정과 무관하게 늘 원본이다).

#: 이보다 약한 피크는 잡음일 수 있어 믿지 않는다
MIN_PEAK = 0.15
#: 같은 건반의 두 벨로시티 레이어는 같은 현이다. 이만큼 넘게 어긋나면 측정 실패
LAYER_TOL_CENTS = 8.0


def _peak_near(spec, df, target, floor):
    """target 주변 ±1.2반음에서 최대 피크를 포물선 보간으로 찾는다."""
    lo, hi = target * 2 ** (-1.2 / 12), target * 2 ** (1.2 / 12)
    i0, i1 = max(int(lo / df), 1), min(int(hi / df), len(spec) - 2)
    if i1 <= i0:
        return None
    idx = i0 + int(np.argmax(spec[i0:i1]))
    if spec[idx] < floor:
        return None
    al, c0, ar = spec[idx - 1], spec[idx], spec[idx + 1]
    den = al - 2 * c0 + ar
    delta = 0.5 * (al - ar) / den if den else 0.0
    return (idx + delta) * df


def measure_cents(path: Path, expected_hz: float) -> tuple[float, str] | None:
    """샘플의 실제 음정이 평균율에서 몇 센트 벗어났는지. 음수면 낮다.

    저음부는 기본음이 잡음에 묻혀서 2·3배음을 대신 본다. 인하모니시티 때문에
    n배음은 n×f0보다 조금 높으므로 그만큼 빼 준다(전형적인 업라이트 기준).
    """
    pcm, rate = sf.read(path, dtype="float64", always_2d=True)
    mono = pcm.mean(axis=1)
    head = int(0.15 * rate)
    seg = mono[head : head + int(3.0 * rate)]
    if len(seg) < int(0.15 * rate):
        return None
    seg = seg * np.hanning(len(seg))
    size = 1 << ((len(seg) - 1).bit_length() + 3)
    spec = np.abs(np.fft.rfft(seg, size))
    df = rate / size
    top = spec.max()

    found = _peak_near(spec, df, expected_hz, MIN_PEAK * top)
    if found:
        return 1200 * np.log2(found / expected_hz), "기본음"
    for harmonic, bias in ((2, 1.7), (3, 3.9)):
        found = _peak_near(spec, df, expected_hz * harmonic, 0.10 * top)
        if found:
            cents = 1200 * np.log2((found / harmonic) / expected_hz) - bias
            return cents, f"{harmonic}배음"
    return None


def tuning_table(regions) -> dict[int, float]:
    """건반별 보정 센트. 두 벨로시티 레이어가 어긋나면 그 건반은 건너뛴다."""
    per_key: dict[int, list[float]] = {}
    methods: dict[int, set[str]] = {}
    for region in regions:
        src = SRC / region.sample
        if not src.exists():
            continue
        expected = 440 * 2 ** ((region.pitch_keycenter - 69) / 12)
        got = measure_cents(src, expected)
        if got is None:
            continue
        cents, how = got
        per_key.setdefault(region.pitch_keycenter, []).append(cents)
        methods.setdefault(region.pitch_keycenter, set()).add(how)

    table: dict[int, float] = {}
    for key, values in sorted(per_key.items()):
        if len(values) > 1 and max(values) - min(values) > LAYER_TOL_CENTS:
            print(f"  키 {key}: 레이어가 {max(values) - min(values):.0f}센트 어긋남 → 보정 안 함")
            continue
        table[key] = round(statistics.fmean(values), 1)
    return table


def safe_name(sample: str) -> str:
    """`F#4vL.flac` → `Fs4vL.m4a`.

    **`#`을 그대로 두면 안 된다** — URL에서 프래그먼트 시작 문자라 브라우저가
    파일 이름의 일부로 보내지 않는다.
    """
    return Path(sample).name.replace("#", "s").replace(".flac", ".m4a")


def encode(pcm: np.ndarray, rate: int, out: Path) -> None:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav = Path(tmp.name)
    try:
        sf.write(wav, pcm, rate, subtype="PCM_16")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
             "-c:a", "aac", "-b:a", BITRATE, "-ac", "1", str(out)],
            check=True,
        )
    finally:
        wav.unlink(missing_ok=True)


def main() -> int:
    if not SFZ.exists():
        print(f"원본이 없습니다: {SFZ}")
        print("먼저 실행하세요:  .venv/bin/python web/scripts/download_assets.py")
        return 1
    if shutil.which("ffmpeg") is None:
        print("ffmpeg가 필요합니다:  brew install ffmpeg")
        return 1

    regions = parse_sfz(SFZ)
    DEST.mkdir(parents=True, exist_ok=True)
    force = "--force" in sys.argv

    print("조율 측정 중…")
    tuning = tuning_table(regions)

    written: dict[str, str] = {}
    total = 0
    for region in regions:
        if region.sample in written:
            continue
        src = SRC / region.sample
        if not src.exists():
            print(f"  없음(건너뜀): {region.sample}")
            continue

        # 오디오는 조율과 무관하다(센트 보정은 재생 시점에 건다). 이미 구워져
        # 있으면 다시 인코딩하지 않는다 — 매니페스트만 고칠 때 빨라진다.
        done = DEST / safe_name(region.sample)
        if done.exists() and not force and done.stat().st_mtime >= src.stat().st_mtime:
            written[region.sample] = done.name
            total += done.stat().st_size
            continue

        pcm, rate = sf.read(src, dtype="float32", always_2d=True)
        pcm = pcm.mean(axis=1)                      # 모노
        pcm = pcm[: int(TRIM_SEC * rate)]           # 앞에서 3초
        fade = int(FADE_SEC * rate)
        if len(pcm) > fade:
            pcm[-fade:] *= np.linspace(1.0, 0.0, fade, dtype="float32")

        out = DEST / safe_name(region.sample)
        encode(pcm, rate, out)
        written[region.sample] = out.name
        total += out.stat().st_size
        print(f"  {region.sample} -> {out.name}  {out.stat().st_size / 1024:.0f} KiB")

    manifest = {
        "source": "Upright Piano KW (FreePats, Kawai upright) — CC0 1.0",
        "note": "prepare_web_piano.py가 생성한다. 직접 고치지 말 것.",
        "release": regions[0].ampeg_release if regions else 0.6,
        "regions": [
            {
                "file": written[r.sample],
                "lokey": r.lokey,
                "hikey": r.hikey,
                "root": r.pitch_keycenter,
                "lovel": r.lovel,
                "hivel": r.hivel,
                # 이 샘플이 평균율에서 벗어난 정도(센트, 음수면 낮다).
                # 재생할 때 이만큼 되민다. 측정에 실패한 건반은 0(녹음 그대로).
                "tune": tuning.get(r.pitch_keycenter, 0.0),
            }
            for r in regions
            if r.sample in written
        ],
    }
    # 88건반 × 두 벨로시티 레이어가 빠짐없이 덮이는지 여기서 확인한다.
    # 런타임에 구멍이 나면 그 음만 조용히 사인으로 나므로 알아채기 어렵다.
    gaps = [
        (note, vel)
        for note in range(21, 109)
        for vel in (40, 100)
        if not any(
            r["lokey"] <= note <= r["hikey"] and r["lovel"] <= vel <= r["hivel"]
            for r in manifest["regions"]
        )
    ]
    if gaps:
        print(f"\n덮이지 않은 (음, 세기): {gaps[:10]}{' …' if len(gaps) > 10 else ''}")
        return 1

    (DEST / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    # 이전 버전이 남긴 비교본이 있으면 지운다 (조율본으로 일원화)
    (DEST / "manifest.raw.json").unlink(missing_ok=True)

    used = [c for k, c in tuning.items() if 48 <= k <= 84]
    print(f"\n완료: {len(written)}개 파일 {total / 1024 / 1024:.1f} MiB -> {DEST}")
    print(f"조율 보정: {len(tuning)}건반")
    if used:
        print(
            f"  실제 쓰는 C3~C6 구간 중앙값 {statistics.median(used):+.1f}센트, "
            f"범위 {min(used):+.1f}~{max(used):+.1f}"
        )
    print("라이선스: CC0 1.0 (퍼블릭 도메인). 변환본에도 같은 조건이 적용된다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
