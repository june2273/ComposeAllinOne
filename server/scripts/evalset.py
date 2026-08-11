"""평가셋 목록 관리 — 캐시 슬롯에 이름을 붙인다.

`server/cache/`의 슬롯 이름은 업로드한 파일 내용의 SHA-256 앞 16자다
(`app.jobs.digest_of`). 곡 이름이 아니라 해시라서 **캐시만 봐서는 무슨 곡인지
알 수 없다** — 실제로 그 때문에 곡 이름을 잘못 적은 채 문서에 들어간 적이 있다
(2026-08-11). 이 도구가 해시를 도로 파일 이름으로 되돌려 `evalset/songs.json`에
적어 둔다.

되돌릴 수 있는 이유는 `POST /jobs`가 **업로드한 바이트를 그대로**
`<slot>/input.<확장자>`에 쓰기 때문이다. 그 파일을 다시 해시하면 슬롯 이름이
나오고, 디스크의 오디오 파일 중 같은 해시를 갖는 것이 원본이다.

    python scripts/evalset.py list
    python scripts/evalset.py scan [--root DIR]...
    python scripts/evalset.py truth <곡.svp|곡.mid> --slot <slot>

**`scan`은 사람이 적은 것을 덮어쓰지 않는다.** `name`·`truth`·`note`는 한 번
채워지면 그대로 두고, 비어 있는 칸과 기계가 아는 값(`durationSec`·`source`)만
갱신한다. 이름을 손으로 고친 뒤 다시 스캔해도 고친 이름이 살아남아야 하기
때문이다.

`truth`는 Synthesizer V 프로젝트(`.svp`)에서 음표를 꺼내 정답 MIDI로 굽는다.
`.svp`가 **정답의 원본**이기 때문이다 — 신스V에서 손으로 내보낸 MIDI를 쓰면
내보내기 설정에 따라 값이 달라지고, 실제로 정답 MIDI를 잃어버린 적이 있다.
프로젝트 파일은 작업 폴더에 그대로 남아 있으므로 언제든 다시 구울 수 있다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SERVER_DIR.parent
CACHE_DIR = SERVER_DIR / "cache"
EVALSET_DIR = REPO_DIR / "evalset"
SONGS_JSON = EVALSET_DIR / "songs.json"

#: 원본 오디오를 찾아 볼 곳. `--root`로 덮어쓸 수 있다.
DEFAULT_ROOTS = (
    Path.home() / "Downloads",
    Path.home() / "Music",
    Path("/Volumes/june2_07ssd/Workspace"),
)

AUDIO_EXTS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".opus", ".aiff"}

#: 이보다 작은 파일은 곡이 아니다. 수만 개를 해시하지 않기 위한 거름망일 뿐이라
#: 넉넉하게 잡는다.
MIN_BYTES = 100_000


def digest_of(data: bytes) -> str:
    """`app.jobs.digest_of`와 같아야 한다. 다르면 슬롯을 못 찾는다."""
    return hashlib.sha256(data).hexdigest()[:16]


def slots() -> dict[str, dict]:
    """캐시에 실제로 있는 슬롯. 이름 → meta.json 내용."""
    out: dict[str, dict] = {}
    if not CACHE_DIR.is_dir():
        return out
    for d in sorted(CACHE_DIR.iterdir()):
        if not d.is_dir():
            continue
        meta_path = d / "meta.json"
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            meta = {}
        out[d.name] = meta
    return out


def load_songs() -> list[dict]:
    if not SONGS_JSON.exists():
        return []
    try:
        return json.loads(SONGS_JSON.read_text(encoding="utf-8")).get("songs", [])
    except ValueError as exc:
        raise SystemExit(f"{SONGS_JSON}를 읽을 수 없습니다: {exc}") from exc


def save_songs(songs: list[dict]) -> None:
    EVALSET_DIR.mkdir(parents=True, exist_ok=True)
    (EVALSET_DIR / "truth").mkdir(exist_ok=True)
    payload = {"songs": sorted(songs, key=lambda s: (s.get("name") or "~", s["slot"]))}
    SONGS_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def find_sources(wanted: set[str], roots: list[Path]) -> dict[str, Path]:
    """디스크를 훑어 해시가 맞는 오디오 파일을 찾는다.

    파일을 통째로 읽어 해시하므로 싸지 않다. 그래서 확장자와 크기로 먼저 거르고,
    찾던 것을 다 찾으면 즉시 멈춘다.
    """
    found: dict[str, Path] = {}
    for root in roots:
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if len(found) == len(wanted):
                return found
            if not path.is_file() or path.suffix.lower() not in AUDIO_EXTS:
                continue
            try:
                if path.stat().st_size < MIN_BYTES:
                    continue
                digest = digest_of(path.read_bytes())
            except OSError:
                continue
            if digest in wanted and digest not in found:
                found[digest] = path
    return found


def cmd_scan(args: argparse.Namespace) -> int:
    roots = [Path(r) for r in args.root] if args.root else list(DEFAULT_ROOTS)
    present = slots()
    if not present:
        print(f"캐시가 비어 있습니다: {CACHE_DIR}")
        return 1

    songs = {s["slot"]: s for s in load_songs()}
    missing = {slot for slot in present if not songs.get(slot, {}).get("source")}
    print(f"슬롯 {len(present)}개 · 원본을 찾아야 하는 것 {len(missing)}개")
    found = find_sources(missing, roots) if missing else {}

    for slot, meta in present.items():
        song = songs.setdefault(slot, {"slot": slot, "name": None, "truth": None, "note": None})
        song["durationSec"] = meta.get("durationSec")
        if slot in found:
            path = found[slot]
            song["source"] = str(path)
            # 이름은 한 번만 짓는다 — 손으로 고친 것을 파일 이름으로 되돌리지 않는다
            if not song.get("name"):
                song["name"] = path.stem
    # 캐시에서 사라진 슬롯도 목록에는 남긴다. 정답 MIDI와 메모가 거기 붙어 있고,
    # 그 파일을 다시 올리면 같은 슬롯이 되살아난다.
    save_songs(list(songs.values()))
    print(f"찾음 {len(found)}개 · {SONGS_JSON}에 적었습니다")
    return 0


#: Synthesizer V의 시간 단위. 4분음표 하나가 이만큼이다.
BLICKS_PER_QUARTER = 705_600_000


#: 겹치는 음이 이 비율을 넘으면 트랙을 합치면 안 된다 — 화음이다.
POLYPHONY_LIMIT = 0.05

Note = tuple[float, float, int]


def svp_tracks(path: Path) -> tuple[list[tuple[str, list[Note]]], float]:
    """`.svp`를 트랙별 (이름, [(시작초, 길이초, MIDI)])로 편다.

    **음표는 트랙 안이 아니라 `library`의 그룹에 들어 있고, 트랙은 그것을
    시각을 붙여 참조한다.** 그래서 세 겹을 다 봐야 한다:

    - `tracks[].groups[]`가 참조다. `groupID`로 `library`의 `uuid`를 찾는다.
    - **`blickOffset`이 그 그룹이 놓인 자리다.** 이걸 빠뜨리면 정답이 통째로
      밀린다 — 실제로 곡E이 −7박 밀린 채 구워졌다(참조의 offset이 0이 아니었다).
      대조 스크립트가 오프셋을 탐색해 자동 보정하는 바람에 숫자로는 안 드러났다.
    - `blickAbsoluteBegin`/`End`가 잘라내는 창이고, `pitchOffset`이 조옮김이다.

    사용자의 작업 파일에서 트랙은 보통 **곡의 구간들**(벌스·코러스)이라 합치는
    것이 맞지만, **화음 성부일 때도 있다.** 둘은 겹침 비율로 갈린다.

    **변속은 처리하지 않는다.** 템포 표에 항목이 둘 이상이면 던진다 — 조용히
    첫 BPM으로 환산하면 곡 뒷부분이 통째로 밀린 정답이 만들어지고, 그건 대조표를
    거짓말로 만든다.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    tempos = data.get("time", {}).get("tempo") or [{"position": 0, "bpm": 120.0}]
    if len(tempos) > 1:
        raise SystemExit(f"{path.name}: 변속 곡은 아직 다루지 않습니다(템포 {len(tempos)}개)")
    bpm = float(tempos[0]["bpm"])
    per_blick = (60.0 / bpm) / BLICKS_PER_QUARTER

    library = {g["uuid"]: g for g in data.get("library", []) if "uuid" in g}
    out: list[tuple[str, list[Note]]] = []
    for index, track in enumerate(data.get("tracks", [])):
        notes: list[Note] = []
        refs = list(track.get("groups", []))
        main = track.get("mainGroup") or {}
        if main.get("notes"):
            refs.append({**(track.get("mainRef") or {}), "_inline": main})
        for ref in refs:
            group = ref.get("_inline") or library.get(ref.get("groupID"))
            if not group or not group.get("notes"):
                continue
            offset = ref.get("blickOffset", 0)
            begin = ref.get("blickAbsoluteBegin", 0)
            end = ref.get("blickAbsoluteEnd", -1)
            shift = ref.get("pitchOffset", 0)
            for note in group["notes"]:
                at = note["onset"] + offset
                if at < begin or (end >= 0 and at >= end):
                    continue
                notes.append(
                    (at * per_blick, note["duration"] * per_blick, int(note["pitch"]) + shift)
                )
        out.append((track.get("name") or f"track{index}", sorted(notes)))
    return out, bpm


def overlap_ratio(notes: list[Note]) -> float:
    """앞 음이 끝나기 전에 다음 음이 시작하는 비율. 화음이면 높다."""
    if len(notes) < 2:
        return 0.0
    hits = sum(1 for a, b in zip(notes, notes[1:]) if b[0] < a[1] - 0.01)
    return hits / len(notes)


def midi_tracks(path: Path) -> tuple[list[tuple[str, list[Note]]], float]:
    """정답 MIDI를 트랙별로 편다. `.svp` 대신 내보낸 파일을 받을 때 쓴다.

    **변속은 여기서도 안 다룬다** — 첫 `set_tempo`만 쓴다.
    """
    import mido

    mid = mido.MidiFile(str(path))
    tempo = 500_000
    for track in mid.tracks:
        found = next((m.tempo for m in track if m.type == "set_tempo"), None)
        if found is not None:
            tempo = found
            break

    out: list[tuple[str, list[Note]]] = []
    for index, track in enumerate(mid.tracks):
        at, opened, notes = 0.0, {}, []
        for msg in track:
            at += mido.tick2second(msg.time, mid.ticks_per_beat, tempo)
            if msg.type == "note_on" and msg.velocity > 0:
                opened.setdefault(msg.note, []).append(at)
            elif msg.type in ("note_off", "note_on"):
                starts = opened.get(msg.note)
                if starts:
                    began = starts.pop(0)
                    notes.append((began, at - began, msg.note))
        out.append((track.name or f"track{index}", sorted(notes)))
    return out, mido.tempo2bpm(tempo)


def truth_notes(path: Path, track: str | None = None) -> tuple[list[Note], float]:
    """정답으로 쓸 음표 목록. 기본은 전 트랙을 합치되 화음이면 거부한다.

    **작업 파일의 트랙은 보통 곡의 구간이지 성부가 아니다** — 벌스·코러스를
    따로 트랙에 얹어 두는 식이다. 그래서 합치는 것이 기본이고, 진짜 화음일
    때만 겹침 비율이 튄다(실측: 곡A의 가공 전 파일은 49%, 가공본은 0%).
    """
    tracks, bpm = (
        midi_tracks(path)
        if path.suffix.lower() in (".mid", ".midi")
        else svp_tracks(path)
    )
    tracks = [(name, notes) for name, notes in tracks if notes]
    if not tracks:
        raise SystemExit(f"{path.name}: 음표가 없습니다")

    if track is not None:
        try:
            chosen = [tracks[int(track)]]
        except ValueError:
            chosen = [t for t in tracks if t[0] == track]
        except IndexError:
            raise SystemExit(f"{path.name}: {track}번 트랙이 없습니다(0~{len(tracks) - 1})") from None
        if not chosen:
            raise SystemExit(f"{path.name}: {track!r} 트랙이 없습니다")
        notes = sorted(n for _, ns in chosen for n in ns)
    else:
        notes = sorted(n for _, ns in tracks for n in ns)
        ratio = overlap_ratio(notes)
        if ratio > POLYPHONY_LIMIT:
            listing = "\n".join(
                f"  {i}: {name!r} — {len(ns)}음" for i, (name, ns) in enumerate(tracks)
            )
            raise SystemExit(
                f"{path.name}: 트랙을 합치면 음이 {ratio * 100:.0f}% 겹칩니다 — 화음 성부가 있습니다.\n"
                f"{listing}\n멜로디 트랙 하나를 --track으로 고르세요"
            )
    return notes, bpm


def cmd_truth(args: argparse.Namespace) -> int:
    import mido

    src = Path(args.svp)
    notes, bpm = truth_notes(src, args.track)
    songs = {s["slot"]: s for s in load_songs()}
    song = songs.get(args.slot)
    if song is None:
        raise SystemExit(f"songs.json에 슬롯 {args.slot}이 없습니다 — 먼저 scan을 돌리세요")

    name = args.name or song.get("name") or args.slot
    out = EVALSET_DIR / "truth" / f"{name}.mid"
    out.parent.mkdir(parents=True, exist_ok=True)

    ticks = 480
    mid = mido.MidiFile(ticks_per_beat=ticks)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    per_tick = 60.0 / bpm / ticks
    events: list[tuple[float, int, int]] = []
    for start, dur, pitch in notes:
        events.append((start, 1, pitch))
        events.append((start + dur, 0, pitch))
    # 같은 시각이면 note_off를 먼저 — 붙어 있는 재발음이 겹쳐 울리지 않게 한다
    events.sort(key=lambda e: (e[0], e[1]))
    prev = 0
    for when, on, pitch in events:
        tick = round(when / per_tick)
        track.append(
            mido.Message(
                "note_on" if on else "note_off",
                note=pitch, velocity=80 if on else 0, time=max(0, tick - prev),
            )
        )
        prev = tick
    mid.save(str(out))

    song["truth"] = f"truth/{out.name}"
    song["truthSource"] = str(src)
    # **음표 수를 여기서 적어 둔다.** 굽는 쪽은 이미 세어 놓았는데, 이걸 안
    # 적으면 표를 그리는 도구마다 MIDI를 다시 파싱하게 된다 — 실제로 그러다
    # 러닝 스테이터스를 놓쳐 세 곡이 나란히 58개씩 모자란 적이 있다.
    song["truthNotes"] = len(notes)
    save_songs(list(songs.values()))
    print(f"{len(notes)}음 · {bpm:g} BPM → {out}")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    present = slots()
    songs = load_songs()
    known = {s["slot"] for s in songs}
    for slot in present:
        if slot not in known:
            songs.append({"slot": slot, "name": None, "durationSec": present[slot].get("durationSec")})

    print(f"{'슬롯':<18}{'곡':<34}{'길이':>8}  {'캐시':<6}{'정답':<6}엔진")
    print("-" * 92)
    for song in sorted(songs, key=lambda s: (s.get("name") or "~")):
        slot = song["slot"]
        meta = present.get(slot)
        dur = song.get("durationSec") or (meta or {}).get("durationSec")
        truth = song.get("truth")
        has_truth = bool(truth) and (EVALSET_DIR / truth).exists()
        name = song.get("name") or "(이름 없음)"
        print(
            f"{slot:<18}{name[:32]:<34}"
            f"{(f'{dur:.0f}초' if dur else '?'):>8}  "
            f"{'있음' if meta else '없음':<6}"
            f"{('있음' if has_truth else ('경로만' if truth else '없음')):<6}"
            f"{(meta or {}).get('melodyEngine') or '-'}"
        )
    have = sum(1 for s in songs if s.get("truth") and (EVALSET_DIR / s['truth']).exists())
    print("-" * 92)
    print(f"{len(songs)}곡 · 캐시에 있는 것 {len(present)}개 · 정답 있는 것 {have}개")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_scan = sub.add_parser("scan", help="원본 파일을 찾아 songs.json을 갱신한다")
    p_scan.add_argument("--root", action="append", help="찾아 볼 디렉터리 (여러 번 줄 수 있다)")
    p_scan.set_defaults(func=cmd_scan)

    p_truth = sub.add_parser("truth", help=".svp에서 정답 MIDI를 굽는다")
    p_truth.add_argument("svp", help="Synthesizer V 프로젝트(.svp) 또는 정답 MIDI(.mid)")
    p_truth.add_argument("--slot", required=True, help="이 정답이 붙을 캐시 슬롯")
    p_truth.add_argument("--name", help="파일 이름 (기본: songs.json의 곡 이름)")
    p_truth.add_argument("--track", help="화음 성부가 있을 때 고를 멜로디 트랙의 번호나 이름")
    p_truth.set_defaults(func=cmd_truth)

    p_list = sub.add_parser("list", help="목록을 표로 보여준다")
    p_list.set_defaults(func=cmd_list)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
