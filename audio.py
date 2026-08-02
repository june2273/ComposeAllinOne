"""오디오 백엔드.

문서 7절의 교체 가능 인터페이스(`AudioBackend` Protocol)를 그대로 따른다.

재생 버튼을 누른 시점에 전체 파형을 numpy로 미리 렌더한 뒤 sd.play()로
던지는 방식이라, 오디오 콜백 안에서 연산하다 GIL 때문에 글리치가 나는
문제를 통째로 피한다.

구조: `Synth`(추상 기반)가 "음을 렌더 → 스태거 배치 → 믹스 → 피크 정리 →
재생"이라는 절차를 갖고, 하위 클래스는 `render_note` 한 개만 구현한다
(Template Method). 백엔드가 늘어나도 믹싱 규칙은 한 곳에만 있다.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Protocol

import numpy as np
import sounddevice as sd

from config import PlayMode

SAMPLE_RATE = 44100

PIANO_SFZ = (
    Path(__file__).parent
    / "assets"
    / "UprightPianoKW"
    / "UprightPianoKW-20220221.sfz"
)

# 아르페지오 한 음 사이 간격. melody 모드는 음 길이만큼 벌린다.
ARPEGGIO_GAP_SEC = 0.18


def midi_to_freq(midi_note: int) -> float:
    return 440.0 * 2.0 ** ((midi_note - 69) / 12.0)


class AudioBackend(Protocol):
    """문서 7절에 적힌 시그니처 그대로. 세션은 이것만 알면 된다."""

    def play_notes(
        self,
        midi_notes: list[int],
        duration: float,
        mode: PlayMode = "block",
        velocity: int = 80,
    ) -> None: ...

    def stop(self) -> None: ...


class Synth(ABC):
    """공통 믹싱·재생 절차. 하위 클래스는 `render_note`만 채운다."""

    CHANNELS = 1
    PEAK = 0.85
    # 조용해도 PEAK까지 끌어올릴지. SineSynth는 절대 레벨에 의미가 없어
    # 항상 맞추고, SampleSynth는 녹음된 다이내믹을 살리려 리미터로만 쓴다.
    ALWAYS_NORMALIZE = False

    def __init__(self, sample_rate: int = SAMPLE_RATE) -> None:
        self.sr = sample_rate

    @abstractmethod
    def render_note(
        self, midi_note: int, duration: float, velocity: int = 80
    ) -> np.ndarray:
        """(샘플수, 채널수) float32 파형."""

    def stagger_sec(self, mode: PlayMode, duration: float) -> float:
        if mode == "block":
            return 0.0
        return ARPEGGIO_GAP_SEC if mode == "arpeggio_up" else duration

    def render(
        self,
        midi_notes: list[int],
        duration: float,
        mode: PlayMode = "block",
        velocity: int = 80,
    ) -> np.ndarray:
        """섞은 결과를 (샘플수, 채널수)로 돌려준다. 재생하지 않는다."""
        if not midi_notes:
            return np.zeros((0, self.CHANNELS), dtype=np.float32)

        stagger = self.stagger_sec(mode, duration)
        total = int((duration + stagger * (len(midi_notes) - 1)) * self.sr) + 1
        buf = np.zeros((total, self.CHANNELS), dtype=np.float32)

        for i, note in enumerate(midi_notes):
            offset = int(i * stagger * self.sr)
            rendered = self.render_note(note, duration, velocity)
            if rendered.shape[1] == 1 and self.CHANNELS > 1:
                rendered = np.repeat(rendered, self.CHANNELS, axis=1)
            buf[offset : offset + len(rendered)] += rendered

        peak = float(np.max(np.abs(buf))) or 1.0
        if self.ALWAYS_NORMALIZE or peak > self.PEAK:
            buf *= self.PEAK / peak
        return buf

    def play_notes(
        self,
        midi_notes: list[int],
        duration: float,
        mode: PlayMode = "block",
        velocity: int = 80,
    ) -> None:
        buf = self.render(midi_notes, duration, mode, velocity)
        if not len(buf):
            return
        sd.stop()
        sd.play(buf[:, 0] if self.CHANNELS == 1 else buf, self.sr)

    def stop(self) -> None:
        sd.stop()


class SineSynth(Synth):
    """사인파 가산합성 + ADSR. 음원이 없을 때의 폴백.

    순수 사인파는 음정 지각이 오히려 어려워서 배음을 3~4개 섞는다.
    피치가 수식으로 정확해서, 절대음고를 센트 단위로 다뤄야 하는
    기능에는 실제 녹음인 SampleSynth보다 이쪽이 낫다.
    """

    CHANNELS = 1
    ALWAYS_NORMALIZE = True

    HARMONICS = (1.0, 0.45, 0.22, 0.10)

    ATTACK = 0.012
    DECAY = 0.09
    SUSTAIN_LEVEL = 0.72
    RELEASE = 0.30

    def _envelope(self, n: int) -> np.ndarray:
        env = np.ones(n, dtype=np.float32)
        a = min(int(self.ATTACK * self.sr), n)
        d = min(int(self.DECAY * self.sr), n - a)
        r = min(int(self.RELEASE * self.sr), n)

        if a:
            env[:a] = np.linspace(0.0, 1.0, a, dtype=np.float32)
        if d:
            env[a : a + d] = np.linspace(1.0, self.SUSTAIN_LEVEL, d, dtype=np.float32)
        env[a + d :] = self.SUSTAIN_LEVEL
        if r:
            env[-r:] *= np.linspace(1.0, 0.0, r, dtype=np.float32)
        return env

    def render_note(
        self, midi_note: int, duration: float, velocity: int = 80
    ) -> np.ndarray:
        n = max(int(duration * self.sr), 1)
        t = np.arange(n, dtype=np.float32) / self.sr
        freq = midi_to_freq(midi_note)

        wave = np.zeros(n, dtype=np.float32)
        for i, amp in enumerate(self.HARMONICS, start=1):
            # 나이퀴스트를 넘는 배음은 앨리어싱만 만든다
            if freq * i >= self.sr / 2:
                break
            wave += amp * np.sin(2.0 * np.pi * freq * i * t, dtype=np.float32)

        wave /= sum(self.HARMONICS)
        return (wave * self._envelope(n) * (velocity / 127.0))[:, None]


class SampleSynth(Synth):
    """SFZ 샘플 기반 피아노.

    Upright Piano KW (FreePats, CC0). fluidsynth 없이 FLAC을 직접 읽어
    numpy로 섞는다. 샘플이 3반음 간격이라 피치 시프트는 최대 ±1반음이고,
    그 정도는 선형 보간으로 충분하다(실측 오차 0.1센트 미만).
    """

    CHANNELS = 2

    def __init__(
        self, sfz_path: Path = PIANO_SFZ, sample_rate: int = SAMPLE_RATE
    ) -> None:
        super().__init__(sample_rate)

        import soundfile as sf  # 음원을 실제로 쓸 때만 필요

        from sfz import find_region, parse_sfz

        self._sf = sf
        self._find_region = find_region
        self.base = sfz_path.parent
        self.regions = parse_sfz(sfz_path)
        self._cache: dict[str, tuple[np.ndarray, int]] = {}

        if not self.regions:
            raise RuntimeError(f"SFZ에서 region을 찾지 못했습니다: {sfz_path}")

    @staticmethod
    def available(sfz_path: Path = PIANO_SFZ) -> bool:
        return sfz_path.is_file()

    def _load(self, rel: str) -> tuple[np.ndarray, int]:
        cached = self._cache.get(rel)
        if cached is None:
            data, sr = self._sf.read(self.base / rel, dtype="float32", always_2d=True)
            cached = (data, sr)
            self._cache[rel] = cached
        return cached

    @staticmethod
    def _lowpass(buf: np.ndarray, cutoff: float, sr: int) -> np.ndarray:
        """2-pole 저역통과를 주파수 영역에서 근사.

        어차피 전체를 미리 렌더하므로 FFT 한 번이 IIR 루프보다 빠르고 간단하다.
        """
        spec = np.fft.rfft(buf, axis=0)
        freqs = np.fft.rfftfreq(buf.shape[0], 1.0 / sr)
        with np.errstate(divide="ignore"):
            mag = 1.0 / np.sqrt(1.0 + (freqs / cutoff) ** 4)  # Butterworth 2차
        return np.fft.irfft(spec * mag[:, None], n=buf.shape[0], axis=0).astype(
            np.float32
        )

    def render_note(
        self, midi_note: int, duration: float, velocity: int = 80
    ) -> np.ndarray:
        region = self._find_region(self.regions, midi_note, velocity)
        if region is None:
            raise ValueError(f"{midi_note}번 음(vel {velocity})에 맞는 샘플이 없습니다")

        src, src_sr = self._load(region.sample)
        ratio = 2.0 ** ((midi_note - region.pitch_keycenter) / 12.0) * (src_sr / self.sr)

        out_len = max(int(duration * self.sr), 1)
        pos = np.arange(out_len, dtype=np.float64) * ratio
        src_idx = np.arange(src.shape[0], dtype=np.float64)

        out = np.empty((out_len, src.shape[1]), dtype=np.float32)
        for ch in range(src.shape[1]):
            # 샘플보다 긴 음을 요청하면 np.interp가 끝값을 유지하므로 직접 0으로 채운다
            out[:, ch] = np.interp(pos, src_idx, src[:, ch], left=0.0, right=0.0)

        if region.cutoff:
            out = self._lowpass(out, region.cutoff, self.sr)

        # 릴리스: 끝에서 잘려 클릭이 나는 것을 막는다
        rel = min(int(region.ampeg_release * self.sr), out_len)
        if rel:
            out[-rel:] *= np.linspace(1.0, 0.0, rel, dtype=np.float32)[:, None]

        gain = (velocity / 127.0) * (10.0 ** (region.volume / 20.0))
        return out * gain


class NullSynth(Synth):
    """소리를 내지 않는 백엔드. 테스트에서 오디오 장치를 피할 때 쓴다."""

    CHANNELS = 1

    def render_note(
        self, midi_note: int, duration: float, velocity: int = 80
    ) -> np.ndarray:
        return np.zeros((max(int(duration * self.sr), 1), 1), dtype=np.float32)

    def play_notes(
        self,
        midi_notes: list[int],
        duration: float,
        mode: PlayMode = "block",
        velocity: int = 80,
    ) -> None:
        return

    def stop(self) -> None:
        return


def make_default_backend() -> AudioBackend:
    """음원이 있으면 피아노, 없으면 사인파로 떨어진다."""
    if SampleSynth.available():
        try:
            return SampleSynth()
        except Exception as exc:  # 음원이 깨졌어도 앱은 떠야 한다
            print(f"피아노 음원을 불러오지 못해 사인파로 대체합니다: {exc}")
    else:
        print("피아노 음원이 없습니다. .venv/bin/python download_assets.py 로 받으세요.")
    return SineSynth()
