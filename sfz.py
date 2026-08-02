"""최소한의 SFZ 파서.

Upright Piano KW가 쓰는 만큼만 처리한다. SFZ 규격 전체를 구현하지 않으며,
아래 목록에 없는 opcode는 조용히 무시한다.

  지원   : sample, lokey, hikey, key, pitch_keycenter, lovel, hivel,
           cutoff, fil_type, ampeg_release, volume
  무시   : loop_start, loop_end, loop_mode, width, 그 밖의 전부

루프를 무시해도 되는 이유: 청음 문제는 길어야 몇 초이고 샘플 자체가
그보다 길다. 샘플보다 긴 음을 요청하면 뒤를 0으로 채운다(자연 감쇠와 같음).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from pathlib import Path

HEADER_RE = re.compile(r"<(\w+)>")
OPCODE_RE = re.compile(r"(\w+)=([^\s]+)")


@dataclass
class Region:
    sample: str = ""
    lokey: int = 0
    hikey: int = 127
    pitch_keycenter: int = 60
    lovel: int = 0
    hivel: int = 127
    cutoff: float | None = None
    ampeg_release: float = 0.4
    volume: float = 0.0  # dB

    def matches(self, note: int, velocity: int) -> bool:
        return self.lokey <= note <= self.hikey and self.lovel <= velocity <= self.hivel


def _apply(region: Region, opcodes: dict[str, str]) -> Region:
    out = replace(region)
    for name, raw in opcodes.items():
        if name == "sample":
            out.sample = raw.replace("\\", "/")
        elif name == "key":
            n = int(raw)
            out.lokey = out.hikey = out.pitch_keycenter = n
        elif name in ("lokey", "hikey", "pitch_keycenter", "lovel", "hivel"):
            setattr(out, name, int(raw))
        elif name == "cutoff":
            out.cutoff = float(raw)
        elif name == "ampeg_release":
            out.ampeg_release = float(raw)
        elif name == "volume":
            out.volume = float(raw)
    return out


def parse_sfz(path: Path) -> list[Region]:
    """<global> → <group> → <region> 순으로 opcode를 상속시켜 평탄화한다."""
    text = re.sub(r"//.*", "", path.read_text(encoding="utf-8", errors="replace"))

    regions: list[Region] = []
    glob = Region()
    group = Region()
    current: dict[str, str] = {}
    header = ""

    def flush() -> None:
        nonlocal glob, group
        if header == "global":
            glob = _apply(Region(), current)
            group = replace(glob)
        elif header == "group":
            group = _apply(glob, current)
        elif header == "region":
            r = _apply(group, current)
            if r.sample:
                regions.append(r)

    for token in re.finditer(r"<\w+>|\w+=[^\s]+", text):
        tok = token.group(0)
        if tok.startswith("<"):
            flush()
            header = HEADER_RE.match(tok).group(1)
            current = {}
        else:
            name, value = tok.split("=", 1)
            current[name] = value
    flush()

    return regions


def find_region(regions: list[Region], note: int, velocity: int) -> Region | None:
    """조건에 맞는 첫 region. SFZ는 뒤에 오는 정의가 이기지만, 이 음원은
    velocity 레이어가 겹치지 않아 첫 매치로 충분하다."""
    for r in regions:
        if r.matches(note, velocity):
            return r
    return None
