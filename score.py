"""악보 렌더링 — MusicXML을 verovio로 SVG로 굽고, Qt가 그릴 수 있게 손본다.

**Qt는 SVG 1.2 Tiny만 지원하므로 verovio 출력을 그대로 주면 아무것도 안 그려진다.**
실측(2026-08-02)으로 확인한 두 가지 문제와 해법:

1. verovio는 바깥 `<svg>` 안에 배율용 `<svg class="definition-scale">`을 한 번 더
   넣는다. Tiny 1.2는 중첩 `<svg>`를 금지해서 Qt가 **안쪽을 통째로 건너뛴다**
   (`qt.svg: Skipping a nested svg element`). → 안쪽을 `<g transform="scale(...)">`로
   바꾼다.
2. 오선·덧줄·마디선은 `<path stroke-width="13">`처럼 굵기만 있고 색이 없다. 색은
   `<style>` 안의 CSS 규칙(`path {stroke:currentColor}`)에서 오는데 Qt Tiny는
   그 CSS를 적용하지 못한다. → 색 없는 path에 `stroke`를 직접 박아 넣는다.
   (이걸 빠뜨리면 음표만 공중에 떠 있는 그림이 나온다. 실제로 그랬다.)

이 두 단계 덕분에 `QWebEngineView`(앱이 무거워짐)나 `cairosvg`(렌더 시간 증가)로
우회할 필요가 없다. 후처리 비용은 렌더당 0.03ms 수준이다.

verovio가 없으면 `ScoreRenderer.available()`이 False를 돌려주고, UI는 악보 대신
음이름 텍스트로 떨어진다. 앱은 verovio 없이도 뜬다.
"""

from __future__ import annotations

import re
from xml.sax.saxutils import escape

from theory import ACCIDENTAL_XML, Pitch

_SVG_TAG = re.compile(r"<svg\b[^>]*>")
_VIEWBOX = re.compile(r'viewBox="([\d.\-\s]+)"')
_STYLE = re.compile(r"<style[^>]*>.*?</style>", re.S)
# stroke 속성이 없으면서 stroke-width만 있는 path
_UNCOLORED = re.compile(r"<path (?![^>]*\bstroke=)([^>]*\bstroke-width=)")

# 이 음보다 낮으면 낮은음자리표가 읽기 편하다
BASS_CLEF_BELOW = 60  # C4


def qt_safe_svg(svg: str, color: str = "#000000") -> str:
    """verovio SVG를 Qt(SVG 1.2 Tiny)가 그릴 수 있는 형태로 바꾼다."""
    svg = _STYLE.sub("", svg)
    svg = _UNCOLORED.sub(rf'<path stroke="{color}" \1', svg)

    tags = list(_SVG_TAG.finditer(svg))
    if len(tags) < 2:
        return svg

    outer = _VIEWBOX.search(tags[0].group(0))
    inner = _VIEWBOX.search(tags[1].group(0))
    if not outer or not inner:
        return svg
    ow = [float(v) for v in outer.group(1).split()]
    iw = [float(v) for v in inner.group(1).split()]
    if not iw[2] or not iw[3]:
        return svg

    group = f'<g transform="scale({ow[2] / iw[2]:.6g},{ow[3] / iw[3]:.6g})" fill="{color}">'
    body = svg[: tags[1].start()] + group + svg[tags[1].end() :]
    last = body.rfind("</svg>")
    prev = body.rfind("</svg>", 0, last)
    return body[:prev] + "</g>" + body[prev + len("</svg>") :] if prev >= 0 else body


def _note_xml(pitch: Pitch, *, chord: bool) -> str:
    alter = f"<alter>{pitch.alter}</alter>" if pitch.alter else ""
    accidental = (
        f"<accidental>{ACCIDENTAL_XML[pitch.alter]}</accidental>" if pitch.alter else ""
    )
    return (
        f"<note>{'<chord/>' if chord else ''}"
        f"<pitch><step>{escape(pitch.letter)}</step>{alter}"
        f"<octave>{pitch.octave}</octave></pitch>"
        f"<duration>4</duration><type>whole</type>{accidental}</note>"
    )


def harmonic_interval_musicxml(lower: Pitch, upper: Pitch, fifths: int = 0) -> str:
    """두 음을 겹쳐 찍은 한 마디짜리 MusicXML."""
    if lower.midi > upper.midi:
        lower, upper = upper, lower
    treble = upper.midi >= BASS_CLEF_BELOW
    sign, line = ("G", 2) if treble else ("F", 4)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<score-partwise version="4.0"><part-list><score-part id="P1">'
        # part-name을 비워 둔다. 내용을 넣으면 verovio가 악보 왼쪽에 성부
        # 이름을 <tspan> 중첩으로 찍는데, Qt Tiny가 그걸 거부하며 경고를 뱉는다.
        "<part-name/></score-part></part-list>"
        '<part id="P1"><measure number="1"><attributes>'
        f"<divisions>1</divisions><key><fifths>{fifths}</fifths></key>"
        f"<clef><sign>{sign}</sign><line>{line}</line></clef></attributes>"
        + _note_xml(lower, chord=False)
        + _note_xml(upper, chord=True)
        + "</measure></part></score-partwise>"
    )


class ScoreRenderer:
    """verovio 툴킷 한 개를 재사용한다. 생성 비용이 있으니 앱당 하나만 만든다."""

    def __init__(self, scale: int = 60, color: str = "#000000") -> None:
        import verovio  # 악보를 실제로 그릴 때만 필요

        self.color = color
        self._tk = verovio.toolkit()
        self._tk.setOptions(
            {
                "pageWidth": 1500,
                "scale": scale,
                "adjustPageHeight": True,
                "adjustPageWidth": True,
                "header": "none",
                "footer": "none",
                "breaks": "none",
                # 여백을 줄여 가로로 지나치게 납작해지는 것을 막는다. 한 마디에
                # 음표 두 개뿐이라 기본 여백(50)이면 종횡비가 5:1을 넘는다.
                "pageMarginLeft": 10,
                "pageMarginRight": 10,
                "pageMarginTop": 10,
                "pageMarginBottom": 10,
                "svgViewBox": True,
                "svgRemoveXlink": True,
            }
        )

    @staticmethod
    def available() -> bool:
        try:
            import verovio  # noqa: F401
        except Exception:
            return False
        return True

    def render(self, musicxml: str) -> bytes:
        if not self._tk.loadData(musicxml):
            raise ValueError("verovio가 MusicXML을 읽지 못했습니다")
        return qt_safe_svg(self._tk.renderToSVG(1), self.color).encode("utf-8")

    def render_interval(self, lower: Pitch, upper: Pitch, fifths: int = 0) -> bytes:
        return self.render(harmonic_interval_musicxml(lower, upper, fifths))


def make_score_renderer(scale: int = 60, color: str = "#000000") -> ScoreRenderer | None:
    """verovio가 없거나 깨졌으면 None. 호출부는 악보 없이도 동작해야 한다."""
    if not ScoreRenderer.available():
        print("verovio가 없어 악보 없이 진행합니다. .venv/bin/pip install verovio")
        return None
    try:
        return ScoreRenderer(scale, color)
    except Exception as exc:
        print(f"악보 렌더러를 만들지 못해 악보 없이 진행합니다: {exc}")
        return None
