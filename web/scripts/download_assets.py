"""피아노 음원 내려받기.

Upright Piano KW (Kawai 업라이트, FreePats) — Creative Commons CC0 퍼블릭
도메인. 저작자 표시 의무가 없어 배포 시 라이선스 부담이 전혀 없다.

용량이 31MiB쯤 되므로 저장소에 커밋하지 않고(.gitignore) 이 스크립트로
받는다.

    .venv/bin/python web/scripts/download_assets.py
"""

from __future__ import annotations

import io
import sys
import tarfile
import urllib.request
from pathlib import Path

REPO = "freepats/upright-piano-KW"
REF = "main"
TARBALL = f"https://codeload.github.com/{REPO}/tar.gz/{REF}"

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "assets" / "UprightPianoKW"
WANTED_SUFFIXES = (".sfz", ".flac")
WANTED_NAMES = ("LICENSE", "README.md")


def main() -> int:
    if DEST.exists() and any(DEST.glob("samples/*.flac")):
        print(f"이미 받아져 있습니다: {DEST}")
        print("다시 받으려면 이 디렉터리를 지우고 실행하세요.")
        return 0

    print(f"내려받는 중: {TARBALL}")
    with urllib.request.urlopen(TARBALL) as resp:
        blob = resp.read()
    print(f"  {len(blob) / 1024 / 1024:.1f} MiB 수신")

    DEST.mkdir(parents=True, exist_ok=True)
    count = 0
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            # 최상위 디렉터리(<repo>-<ref>/) 한 겹을 벗긴다
            rel = Path(*Path(member.name).parts[1:])
            if rel.suffix not in WANTED_SUFFIXES and rel.name not in WANTED_NAMES:
                continue

            target = DEST / rel
            # 압축 파일 안의 경로를 그대로 믿지 않는다
            if not target.resolve().is_relative_to(DEST.resolve()):
                print(f"  건너뜀(경로 이탈): {member.name}")
                continue

            target.parent.mkdir(parents=True, exist_ok=True)
            src = tar.extractfile(member)
            if src is None:
                continue
            target.write_bytes(src.read())
            count += 1

    print(f"완료: {count}개 파일 -> {DEST}")
    print("라이선스: Creative Commons CC0 1.0 (퍼블릭 도메인, 표시 의무 없음)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
