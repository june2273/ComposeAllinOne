/**
 * FFT와 스펙트럼 프레임 — 분석 계열의 바닥.
 *
 * 라이브러리를 쓰지 않는다. 필요한 것이 **2의 거듭제곱 실수 FFT 하나**뿐이고,
 * 그것 때문에 의존성과 라이선스를 하나 더 지는 것은 남는 장사가 아니다.
 * (fft.js·kissfft 계열을 쓸 일이 생기면 citation.md에 먼저 기록할 것.)
 *
 * 여기 있는 것은 전부 순수 함수다 — 브라우저도 React도 모른다.
 */

/** 회전인자는 크기별로 한 번만 만든다. STFT가 같은 크기를 수만 번 부른다. */
const TWIDDLES = new Map<number, { cos: Float64Array; sin: Float64Array }>();

function twiddles(n: number): { cos: Float64Array; sin: Float64Array } {
  let t = TWIDDLES.get(n);
  if (!t) {
    const half = n >> 1;
    const cos = new Float64Array(half);
    const sin = new Float64Array(half);
    for (let i = 0; i < half; i += 1) {
      cos[i] = Math.cos((-2 * Math.PI * i) / n);
      sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    t = { cos, sin };
    TWIDDLES.set(n, t);
  }
  return t;
}

/**
 * 제자리 radix-2 Cooley–Tukey FFT. `re`·`im` 길이는 같은 2의 거듭제곱이어야 한다.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`FFT 길이는 같은 2의 거듭제곱이어야 합니다: ${n}, ${im.length}`);
  }

  // 비트 반전 정렬
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  const { cos, sin } = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let base = 0; base < n; base += len) {
      for (let k = 0; k < half; k += 1) {
        const c = cos[k * step];
        const s = sin[k * step];
        const i0 = base + k;
        const i1 = i0 + half;
        const vr = re[i1] * c - im[i1] * s;
        const vi = re[i1] * s + im[i1] * c;
        re[i1] = re[i0] - vr;
        im[i1] = im[i0] - vi;
        re[i0] += vr;
        im[i0] += vi;
      }
    }
  }
}

/** Hann 창 (주기형 — STFT는 대칭형이 아니라 이쪽이다). */
export function hann(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  }
  return w;
}

/**
 * STFT 한 프레임의 진폭 스펙트럼을 계산하는 재사용 가능한 계산기.
 *
 * **프레임을 저장하지 않는다.** 4분짜리 곡이면 프레임이 2만 개가 넘어서
 * 전부 들고 있으면 수십 MB가 된다. 부르는 쪽이 프레임마다 필요한 것(플럭스,
 * 크로마)만 뽑아 쓰고 버리도록 이 모양으로 뒀다.
 *
 * **창은 중심 정렬이다.** 프레임 `i`의 중심이 `i*hop`에 온다(앞은 0으로
 * 채운다). 정렬하지 않으면 창 길이의 절반만큼 늦게 잡히고, 그 지연이 그대로
 * 비트 시각의 편향이 된다 — 93ms 창이면 46ms다. 비트 추적 허용 오차가 보통
 * 70ms이니 이것만으로 절반 이상을 까먹는다.
 */
export class SpectrumFrames {
  readonly size: number;
  readonly hop: number;
  readonly bins: number;
  /** 프레임 하나의 진폭. 다음 `at()` 호출이 덮어쓴다. */
  readonly magnitude: Float64Array;
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly samples: Float32Array;

  constructor(samples: Float32Array, size: number, hop: number) {
    this.samples = samples;
    this.size = size;
    this.hop = hop;
    this.bins = size / 2 + 1;
    this.magnitude = new Float64Array(this.bins);
    this.window = hann(size);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
  }

  /** 프레임 개수. 중심이 신호 안에 있는 프레임까지. */
  get count(): number {
    if (this.samples.length === 0) return 0;
    return Math.floor((this.samples.length - 1) / this.hop) + 1;
  }

  /** `index`번 프레임(중심 = `index*hop`)을 계산해 `magnitude`에 담는다. */
  at(index: number): Float64Array {
    const { re, im, window, size, samples } = this;
    const start = index * this.hop - (size >> 1);
    const from = Math.max(0, -start);
    const to = Math.min(size, samples.length - start);
    re.fill(0);
    im.fill(0);
    for (let i = from; i < to; i += 1) {
      re[i] = samples[start + i] * window[i];
    }
    fft(re, im);
    for (let k = 0; k < this.bins; k += 1) {
      this.magnitude[k] = Math.hypot(re[k], im[k]);
    }
    return this.magnitude;
  }
}
