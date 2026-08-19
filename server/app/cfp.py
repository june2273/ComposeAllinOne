"""CFP — 스펙트럼 × 켑스트럼 살리언스. **옥타브 분쟁의 심판.**

## 왜 필요한가

고음에서 f0가 반토막 나는데, 프레임 단위로 어느 옥타브가 맞는지 가리는 심판이
**셋 다 죽었다**(`docs/고음_f0_미해결.md` §3): confidence 분위수, 제2모델(FCPE),
그리고 **스펙트럼 에너지**(H11).

H11이 실패한 이유가 이 파일의 존재 이유다. **스펙트럼은 원리적으로 반토막에
취약하다** — f0/2 가설의 배음열(f0/2, f0, 3f0/2, 2f0 …)이 참 배음열을 포함하므로
스펙트럼만 보면 아래 옥타브가 늘 최소한 같은 점수를 받는다. 기각하려면 홀수
자리(f0/2, 3f0/2 …)가 비어 있어야 하는데, **폴리포닉에서는 거기를 반주가 채운다**
(실측: e(X)/e(2X)가 위가 정답일 때 0.227 대 아래일 때 0.152로 겹쳤다).

CFP는 그 반대쪽 증거를 함께 본다(Su & Yang, TASLP 2015 — citation.md 3-1절).

| 표현 | 무엇에 속는가 |
|---|---|
| 스펙트럼(GCoS) — f0와 **배음** n·f0 | **반토막**(아래 옥타브를 지지) |
| 켑스트럼(GC) — f0와 **하위배음** f0/n | **두 배**(위 옥타브를 지지) |
| **곱(Z)** | 서로의 오류를 상쇄한다 |

즉 켑스트럼 항이 H11에 빠져 있던 나머지 절반이다.

## 이 파일이 하는 것과 안 하는 것

**점 질의만 한다** — "이 시각, 이 주파수의 살리언스는?" 전체 로그주파수
필터뱅크를 만들지 않는다. 심판은 프레임마다 후보 **둘**(X와 2X)만 보면 되고,
그러면 **분쟁 프레임에서만 돌릴 수 있다**(실측 전체의 0.3~4%). 필터뱅크를 만들면
곡 전체를 계산해야 해서 비용이 두 자릿수 늘어난다.

**음악적 판단을 하지 않는다.** 어느 쪽을 고를지는 `melody.resolve_octave_pass`가
정한다 — 여기는 숫자만 낸다.

새 의존성이 없다(numpy만). 블랙만-해리스 창은 4항 코사인이라 직접 적는다.
"""

from __future__ import annotations

import numpy as np

#: 주파수 해상도(Hz). FFT 크기가 `rate / FR`이 된다 — 44.1kHz에서 22050점.
#: 130Hz(고음의 반토막 자리)의 반음 폭이 7.6Hz라 2Hz면 넉넉하다.
FR = 2.0

#: 창 길이(초). **실측으로 정했다** — 정답 4곡의 분쟁 프레임에서 AUC를 재니
#: 창이 길수록 좋아진다(46ms 0.667 → 93ms 0.754 → 186ms 0.803 → 372ms 0.834).
#: f0와 f0/2를 가르는 것은 결국 주파수 분해능이라 당연한 방향이다.
#:
#: **500ms에서 천장을 친다** — 창이 FFT 크기(`rate / FR` = 500ms)에 잘리기
#: 때문이다. 거기서 0.839로 372ms의 0.834와 거의 같아 짧은 쪽을 골랐다:
#: 빠른 곡에서 덜 뭉개고, 영점 채우기가 보간 노릇을 계속 한다.
WIN_SEC = 0.372

#: 다룰 주파수 범위(Hz). 분쟁은 기준 X와 후보 2X 둘을 보므로 위쪽에 여유가 필요하다.
#: `melody.MIN_MIDI`(36=65Hz)~`MAX_MIDI`(96=2093Hz)의 두 배까지 덮는다.
F_MIN = 55.0
F_MAX = 4500.0

#: 층별 거듭제곱. omnizart/Su&Yang이 쓰는 값 그대로다 —
#: [스펙트럼, 켑스트럼, 스펙트럼의 켑스트럼].
GAMMA = (0.24, 0.6, 1.0)

#: 살리언스를 읽을 때 볼 대역(반음). f0 추정이 조금 빗나가도 봉우리를 놓치지
#: 않도록 이 폭 안의 최댓값을 쓴다. H11 실험과 같은 값이라 결과를 견줄 수 있다.
BAND_SEMITONES = 0.5


def _blackman_harris(size: int) -> np.ndarray:
    """4항 블랙만-해리스. scipy를 끌어오지 않으려고 직접 적는다."""
    n = np.arange(size)
    two_pi_n = 2.0 * np.pi * n / (size - 1)
    return (
        0.35875
        - 0.48829 * np.cos(two_pi_n)
        + 0.14128 * np.cos(2.0 * two_pi_n)
        - 0.01168 * np.cos(3.0 * two_pi_n)
    )


def _nonlinear(values: np.ndarray, power: float, cutoff: int) -> np.ndarray:
    """음수를 0으로, 양 끝 `cutoff`를 0으로, 그리고 거듭제곱.

    **양 끝을 자르는 것이 이 변환의 핵심이다** — 켑스트럼 쪽에서는 너무 높은
    주파수(=너무 짧은 주기), 스펙트럼 쪽에서는 너무 낮은 주파수를 지운다.
    그 자리가 남아 있으면 다음 층의 FFT가 그것을 배음으로 착각한다.
    """
    out = np.where(values < 0, 0.0, values)
    if cutoff > 0:
        out[:cutoff] = 0.0
        out[-cutoff:] = 0.0
    return np.power(out, power)


class CfpProbe:
    """한 오디오에 대해 **특정 시각·특정 주파수**의 CFP 살리언스를 묻는다.

    창과 상수는 한 번만 만들고 프레임마다 재사용한다. 프레임끼리 독립이라
    (켑스트럼이 열 단위 변환이다) 원하는 시각만 골라 계산할 수 있다.
    """

    def __init__(self, samples: np.ndarray, rate: int) -> None:
        self.samples = np.asarray(samples, dtype=np.float64)
        self.rate = int(rate)
        self.n_fft = int(round(rate / FR))
        window = max(16, int(round(WIN_SEC * rate)))
        # 창이 FFT보다 길면 정보가 접혀 들어온다. 그럴 일은 없지만 못 박아 둔다.
        self.window = _blackman_harris(min(window, self.n_fft))
        norm = np.linalg.norm(self.window)
        if norm > 0:
            self.window = self.window / norm
        # 켑스트럼에서 지울 구간 = 1/F_MAX 초보다 짧은 주기
        self._quef_cut = int(round(rate / F_MAX))
        # 스펙트럼에서 지울 구간 = F_MIN 아래
        self._freq_cut = int(round(F_MIN / FR))

    def _column(self, center: int) -> tuple[np.ndarray, np.ndarray]:
        """한 프레임의 (스펙트럼층, 켑스트럼층). 둘 다 길이 `n_fft`."""
        size = len(self.window)
        half = size // 2
        start, stop = center - half, center - half + size
        frame = np.zeros(size)
        lo, hi = max(start, 0), min(stop, len(self.samples))
        if hi > lo:
            frame[lo - start : hi - start] = self.samples[lo:hi]
        frame = frame * self.window

        padded = np.zeros(self.n_fft)
        padded[:size] = frame
        spectrum = np.abs(np.fft.fft(padded))
        spectrum = np.power(spectrum, GAMMA[0])

        # 층 1: 스펙트럼 → 켑스트럼(하위배음이 선다)
        ceps = np.real(np.fft.fft(spectrum)) / np.sqrt(self.n_fft)
        ceps = _nonlinear(ceps, GAMMA[1], self._quef_cut)
        # 층 2: 켑스트럼 → 스펙트럼(배음이 선다). 이것이 GCoS다
        gcos = np.real(np.fft.fft(ceps)) / np.sqrt(self.n_fft)
        gcos = _nonlinear(gcos, GAMMA[2], self._freq_cut)
        return gcos, ceps

    @staticmethod
    def _peak(values: np.ndarray, index: float, span: float) -> float:
        """`index` 둘레 `±span` 칸의 최댓값. 정수 칸으로 반올림해서 읽는다."""
        lo = int(np.floor(index - span))
        hi = int(np.ceil(index + span)) + 1
        lo, hi = max(lo, 0), min(hi, len(values))
        return float(values[lo:hi].max()) if hi > lo else 0.0

    def salience(self, time_sec: float, freqs_hz: np.ndarray) -> np.ndarray:
        """한 시각에서 여러 후보 주파수의 Z 값.

        `Z(f) = GCoS(f) × GC(1/f)` — 스펙트럼이 아래 옥타브를, 켑스트럼이 위
        옥타브를 눌러 참 f0에서만 둘이 함께 큰 값을 갖는다.
        """
        gcos, ceps = self._column(int(round(time_sec * self.rate)))
        freqs = np.asarray(freqs_hz, dtype=np.float64)
        out = np.zeros(len(freqs))
        ratio = 2.0 ** (BAND_SEMITONES / 12.0)
        for i, hz in enumerate(freqs):
            if not (F_MIN <= hz <= F_MAX):
                continue
            # 주파수 칸: 빈 k가 k·FR Hz. 대역 폭도 Hz라 칸 수로 환산한다
            f_index = hz / FR
            f_span = max(1.0, (hz * (ratio - 1.0)) / FR)
            # 켑스트럼 칸: 주기 1/hz 초 → 표본 rate/hz
            q_index = self.rate / hz
            q_span = max(1.0, q_index * (1.0 - 1.0 / ratio))
            out[i] = self._peak(gcos, f_index, f_span) * self._peak(ceps, q_index, q_span)
        return out
