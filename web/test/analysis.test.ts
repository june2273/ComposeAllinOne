/**
 * 오디오 분석 — 합성 신호로 검증한다.
 *
 * **귀로 확인할 수 없는 영역이다.** 120BPM인지 121BPM인지, C장조인지
 * A단조인지는 들어서 판정하기 어렵다. 그래서 답을 아는 신호를 직접 만들어
 * 넣는다 — 클릭 트랙의 BPM은 정의상 정확하고, 화음 진행이 정하는 조성도 그렇다.
 *
 * 실제 음원에 대한 정확도는 이 테스트가 말해 주지 않는다. 그건 사양서 §8이
 * 요구하는 **평가셋**(J-pop 20~30곡 + 채보 정답)이 있어야 재는 것이고 아직
 * 없다. 여기서 지키는 것은 "알고리즘이 의도대로 동작하는가"까지다.
 */

import { describe, expect, test } from "vitest";

import { fft, hann, SpectrumFrames } from "../src/core/analysis/fft";
import {
  ANALYSIS_RATE,
  extractFeatures,
  estimateTuningCents,
  normalizeOnset,
} from "../src/core/analysis/features";
import {
  estimateTempo,
  halfBeatStrength,
  relatedTempo,
  trackBeats,
} from "../src/core/analysis/tempo";
import { beatProfile, estimateMeter, subdivisionOf } from "../src/core/analysis/meter";
import {
  aggregateChroma,
  estimateKeyFromChroma,
  keyName,
} from "../src/core/analysis/key";
import {
  accentPattern,
  analyzeAudio,
  confidenceTier,
  resolveDupleMeter,
  type MeterEstimate,
} from "../src/core/analysis";
import { analyzeFile, downmix, resample } from "../src/platform/analyze";

// --- 신호 합성 -------------------------------------------------------------------

/** 결정적 난수. 테스트가 실행마다 달라지면 안 된다 */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

/** 짧은 잡음 버스트 — 드럼 한 방. ODF가 가장 잘 보는 형태다 */
function click(out: Float32Array, at: number, gain: number, rng: () => number) {
  const start = Math.round(at * ANALYSIS_RATE);
  const length = Math.round(0.03 * ANALYSIS_RATE);
  for (let i = 0; i < length; i += 1) {
    if (start + i >= out.length) break;
    out[start + i] += rng() * gain * Math.exp(-i / (0.006 * ANALYSIS_RATE));
  }
}

/** 지속음 — 조성을 만든다 */
function tone(out: Float32Array, from: number, to: number, freq: number, gain: number) {
  const start = Math.round(from * ANALYSIS_RATE);
  const end = Math.min(out.length, Math.round(to * ANALYSIS_RATE));
  for (let i = start; i < end; i += 1) {
    const fade = Math.min(1, (i - start) / (0.01 * ANALYSIS_RATE), (end - i) / (0.05 * ANALYSIS_RATE));
    out[i] += Math.sin((2 * Math.PI * freq * i) / ANALYSIS_RATE) * gain * fade;
  }
}

function midiToFreq(midi: number, cents = 0): number {
  return 440 * 2 ** ((midi - 69) / 12 + cents / 1200);
}

interface TrackOptions {
  bpm: number;
  bars: number;
  beatsPerBar: number;
  /** 마디마다 울릴 화음 (MIDI 번호). 비우면 클릭만 난다 */
  chords?: number[][];
  /** 박 사이에 넣을 8분음표. "straight" | "swing" | null */
  eighths?: "straight" | "swing" | null;
  cents?: number;
  /**
   * 박마다의 세기. 기본은 `[1, 0.45, 0.45, 0.45]`.
   *
   * **3박째를 세게 주면 절반 템포 오류가 재현된다** — 세기가 두 박 주기로
   * 오르내리면 자기상관이 그 주기를 비트로 읽는다.
   */
  beatGains?: readonly number[];
}

/** 클릭 트랙 + 화음. 답을 아는 신호. */
function makeTrack(options: TrackOptions): Float32Array {
  const { bpm, bars, beatsPerBar, chords, eighths = null, cents = 0, beatGains } = options;
  const beat = 60 / bpm;
  const total = bars * beatsPerBar * beat + 1;
  const out = new Float32Array(Math.round(total * ANALYSIS_RATE));
  const rng = random(20260803);

  for (let bar = 0; bar < bars; bar += 1) {
    for (let b = 0; b < beatsPerBar; b += 1) {
      const at = (bar * beatsPerBar + b) * beat;
      // 마디 첫 박을 세게 — 다운비트 단서
      click(out, at, beatGains?.[b] ?? (b === 0 ? 1.0 : 0.45), rng);
      if (eighths) {
        const offset = eighths === "swing" ? (2 / 3) * beat : 0.5 * beat;
        click(out, at + offset, 0.3, rng);
      }
    }
    if (chords?.length) {
      const chord = chords[bar % chords.length];
      const from = bar * beatsPerBar * beat;
      for (const midi of chord) {
        // 배음을 두 개 얹어야 크로마 하한(200Hz) 위로 에너지가 올라온다
        tone(out, from, from + beatsPerBar * beat, midiToFreq(midi, cents), 0.28);
        tone(out, from, from + beatsPerBar * beat, midiToFreq(midi + 12, cents), 0.14);
      }
    }
  }
  return out;
}

/** C장조 — I–V–vi–IV */
const C_MAJOR_PROGRESSION = [
  [60, 64, 67], // C
  [67, 71, 74], // G
  [69, 72, 76], // Am
  [65, 69, 72], // F
];

// --- FFT -----------------------------------------------------------------------

describe("FFT", () => {
  /** 정의 그대로의 DFT. 느리지만 틀릴 여지가 없다 */
  function naive(re: number[]): { re: number[]; im: number[] } {
    const n = re.length;
    const outRe = Array.from({ length: n }, () => 0);
    const outIm = Array.from({ length: n }, () => 0);
    for (let k = 0; k < n; k += 1) {
      for (let t = 0; t < n; t += 1) {
        outRe[k] += re[t] * Math.cos((-2 * Math.PI * k * t) / n);
        outIm[k] += re[t] * Math.sin((-2 * Math.PI * k * t) / n);
      }
    }
    return { re: outRe, im: outIm };
  }

  test("정의대로의 DFT와 같은 값을 낸다", () => {
    const rng = random(7);
    const input = Array.from({ length: 64 }, () => rng());
    const re = Float64Array.from(input);
    const im = new Float64Array(64);
    fft(re, im);
    const want = naive(input);
    for (let k = 0; k < 64; k += 1) {
      expect(re[k]).toBeCloseTo(want.re[k], 8);
      expect(im[k]).toBeCloseTo(want.im[k], 8);
    }
  });

  test("2의 거듭제곱이 아니면 거부한다", () => {
    expect(() => fft(new Float64Array(48), new Float64Array(48))).toThrow();
  });

  test("Hann 창은 양 끝이 0이고 가운데가 1이다", () => {
    const w = hann(8);
    expect(w[0]).toBeCloseTo(0, 12);
    expect(w[4]).toBeCloseTo(1, 12);
  });

  test("사인파의 피크가 제 주파수 빈에 선다", () => {
    const samples = new Float32Array(4096);
    tone(samples, 0, 4096 / ANALYSIS_RATE, 440, 1);
    const frames = new SpectrumFrames(samples, 2048, 256);
    const mag = frames.at(2);
    let peak = 0;
    for (let k = 1; k < frames.bins; k += 1) if (mag[k] > mag[peak]) peak = k;
    expect((peak * ANALYSIS_RATE) / 2048).toBeCloseTo(440, -1); // ±10Hz(=빈 하나)
  });
});

// --- 조율 -----------------------------------------------------------------------

describe("조율 추정", () => {
  function tuningOf(cents: number): number {
    const samples = new Float32Array(ANALYSIS_RATE * 2);
    // 여러 음을 함께 — 피크 하나만으로는 히스토그램이 서지 않는다
    for (const midi of [60, 64, 67, 72]) {
      tone(samples, 0, 2, midiToFreq(midi, cents), 0.25);
    }
    const frames = new SpectrumFrames(samples, 2048, 256);
    return estimateTuningCents(frames, ANALYSIS_RATE);
  }

  test("A440이면 0에 가깝다", () => {
    expect(Math.abs(tuningOf(0))).toBeLessThan(6);
  });

  test("30센트 높게 조율된 음원을 그만큼 집어낸다", () => {
    expect(tuningOf(30)).toBeCloseTo(30, -1);
  });

  test("25센트 낮은 쪽도 마찬가지", () => {
    expect(tuningOf(-25)).toBeCloseTo(-25, -1);
  });
});

// --- 템포 · 비트 -------------------------------------------------------------------

describe("템포와 비트", () => {
  function tempoOf(bpm: number) {
    const samples = makeTrack({ bpm, bars: 12, beatsPerBar: 4 });
    const features = extractFeatures(samples, ANALYSIS_RATE);
    const onset = normalizeOnset(features.onset, features.fps);
    const tempo = estimateTempo(onset, features.fps);
    const track = trackBeats(onset, features.fps, tempo.bpm);
    return { tempo, track, features };
  }

  test("120BPM 클릭 트랙을 120으로 읽는다", () => {
    const { track } = tempoOf(120);
    expect(track.bpm).toBeCloseTo(120, 0);
  });

  test("느린 곡·빠른 곡도 (90 · 150)", () => {
    expect(tempoOf(90).track.bpm).toBeCloseTo(90, 0);
    expect(tempoOf(150).track.bpm).toBeCloseTo(150, 0);
  });

  /**
   * 절대 시각까지 맞는지 본다 — 격자만 맞고 통째로 밀려 있으면 소니피케이션과
   * 코드학습 판정이 그만큼 어긋난다. 창 중심 정렬과 중심 차분이 여기 걸려 있다.
   */
  test("잡힌 비트가 실제 클릭 위에 놓인다 (허용 오차 40ms)", () => {
    const { track } = tempoOf(120);
    expect(track.beats.length).toBeGreaterThan(40);
    for (const beat of track.beats) {
      const nearest = Math.round(beat / 0.5) * 0.5; // 클릭은 0.5초마다다
      expect(Math.abs(beat - nearest)).toBeLessThan(0.04);
    }
  });

  test("일정한 템포면 고름이 높다", () => {
    expect(tempoOf(120).track.steadiness).toBeGreaterThan(0.9);
  });

  test("무음에서는 템포를 주장하지 않는다", () => {
    const features = extractFeatures(new Float32Array(ANALYSIS_RATE * 3), ANALYSIS_RATE);
    const onset = normalizeOnset(features.onset, features.fps);
    const tempo = estimateTempo(onset, features.fps);
    expect(tempo.bpm === 0 || tempo.confidence < 0.5).toBe(true);
  });

  /**
   * **빠른 곡을 절반으로 읽던 버그의 회귀 시험** (실측 2026-08-11).
   *
   * 173BPM 4/4 실곡이 87BPM 3/4로 나왔다. 세기가 두 박 주기로 오르내리면
   * 자기상관이 그 주기를 비트로 읽고, prior도 120에 가까운 절반 쪽을 든다
   * (86.5는 −0.47옥타브, 173은 +0.53옥타브라 거의 대칭이지만 절반이 조금 가깝다).
   * 정답 악보의 온셋만 넣어도 똑같이 틀렸으므로 오디오 문제가 아니었다.
   */
  test("빠른 곡을 절반 템포로 읽지 않는다", () => {
    // 3박째에 악센트 — 두 박 주기가 생겨 절반으로 읽히던 패턴
    const samples = makeTrack({
      bpm: 174,
      bars: 24,
      beatsPerBar: 4,
      beatGains: [1.0, 0.45, 0.7, 0.45],
    });
    const report = analyzeAudio(samples, ANALYSIS_RATE);
    expect(report.tempo.bpm).toBeGreaterThan(160);
    expect(report.tempo.bpm).toBeCloseTo(174, -1);
    // 템포가 맞아야 박자도 맞는다 — 절반이면 진짜 마디가 2박이 되어 버린다
    expect(report.meter.beatsPerBar).toBe(4);
  });

  test("근거가 없으면 배수를 올리지 않는다", () => {
    // 이미 제대로 잡힌 곡을 건드리면 안 된다
    for (const bpm of [120, 90, 174]) {
      const samples = makeTrack({ bpm, bars: 20, beatsPerBar: 4 });
      expect(analyzeAudio(samples, ANALYSIS_RATE).tempo.bpm).toBeCloseTo(bpm, -1);
    }
  });

  test("반박 세기 — 반박이 비었으면 0에 가깝다", () => {
    const samples = makeTrack({ bpm: 120, bars: 12, beatsPerBar: 4 });
    const features = extractFeatures(samples, ANALYSIS_RATE);
    const onset = normalizeOnset(features.onset, features.fps);
    const track = trackBeats(onset, features.fps, 120);
    expect(halfBeatStrength(onset, features.fps, track.beats)).toBeLessThan(0.2);
    // 비트가 두어 개뿐이면 잴 것이 없다
    expect(halfBeatStrength(onset, features.fps, [0, 0.5])).toBe(0);
  });

  test("템포 후보의 확률을 다 더하면 1이다", () => {
    const { tempo } = tempoOf(120);
    const sum = tempo.candidates.reduce((acc, c) => acc + c.probability, 0);
    expect(sum).toBeCloseTo(1, 5);
    // 내림차순이다
    for (let i = 1; i < tempo.candidates.length; i += 1) {
      expect(tempo.candidates[i].probability).toBeLessThanOrEqual(
        tempo.candidates[i - 1].probability,
      );
    }
  });

  test("정수배·3:2 관계를 알아본다 — 같은 그리드의 다른 읽기다", () => {
    expect(relatedTempo(120, 60)).toBe(true);
    expect(relatedTempo(120, 240)).toBe(true);
    expect(relatedTempo(120, 180)).toBe(true); // 3:2
    expect(relatedTempo(120, 120)).toBe(true); // 자기 자신
    expect(relatedTempo(120, 137)).toBe(false);
  });

  /**
   * 신뢰도가 늘 0으로 나오던 버그의 회귀 시험. `relatedTempo`가 1을 빼먹어
   * 최고 후보 자신이 경쟁자로 잡혔다 — 깨끗한 클릭 트랙에서도 "확인 필요"가
   * 떴다.
   */
  test("깨끗한 클릭 트랙이면 템포를 확신한다", () => {
    const { tempo } = tempoOf(120);
    expect(tempo.confidence).toBeGreaterThan(0.8);
    // ×2·÷2가 후보로 남아 있어도 신뢰도를 깎지 않는다
    expect(tempo.candidates.some((c) => Math.abs(c.bpm - 60) < 2)).toBe(true);
  });
});

// --- 박자 -----------------------------------------------------------------------

describe("박자 — 축 B (마디당 박)", () => {
  function meterOf(beatsPerBar: number, bpm = 120) {
    const samples = makeTrack({
      bpm,
      bars: 16,
      beatsPerBar,
      chords: C_MAJOR_PROGRESSION,
    });
    const features = extractFeatures(samples, ANALYSIS_RATE);
    const onset = normalizeOnset(features.onset, features.fps);
    const tempo = estimateTempo(onset, features.fps);
    const track = trackBeats(onset, features.fps, tempo.bpm);
    return estimateMeter(
      track.beats,
      features.fps,
      features.onset,
      features.low,
      features.chroma,
    );
  }

  test("4박마다 강세가 오면 4/4", () => {
    const meter = meterOf(4);
    expect(meter.value).toBe("4/4");
    expect(meter.beatsPerBar).toBe(4);
  });

  test("3박마다 강세가 오면 3/4", () => {
    const meter = meterOf(3);
    expect(meter.value).toBe("3/4");
  });

  test("다운비트가 마디 수만큼 나온다", () => {
    const meter = meterOf(4);
    expect(meter.downbeats.length).toBeGreaterThan(10);
    // 다운비트 간격 = 4박 = 2초
    const gaps = meter.downbeats.slice(1).map((d, i) => d - meter.downbeats[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(2, 1);
  });

  test("비트가 너무 적으면 판정하지 않는다 (신뢰도 0)", () => {
    const meter = estimateMeter([0, 0.5, 1], 86, new Float32Array(100), new Float32Array(100), new Float32Array(1200));
    expect(meter.confidence).toBe(0);
  });

  /**
   * 단서가 하나도 없을 때(악센트 없는 메트로놈 트랙 등) 3과 4의 점수가 정확히
   * 같아진다. 이때 3/4가 나오면 안 된다 — 4/4가 압도적으로 흔하다는 전제가
   * 코드에 이미 `TRIPLE_MARGIN`으로 들어가 있다. 후보를 도는 순서에 답이
   * 달려 있었다.
   */
  test("가릴 단서가 없으면 4/4로 물러난다", () => {
    const frames = 2000;
    // fps 100 · 비트 간격 0.5초 = 정확히 50프레임 → 구간마다 값이 완전히 같다
    const beats = Array.from({ length: 30 }, (_, i) => i * 0.5);
    const meter = estimateMeter(
      beats,
      100,
      new Float32Array(frames).fill(1),
      new Float32Array(frames).fill(1),
      new Float32Array(frames * 12).fill(1 / 12),
    );
    expect(meter.beatsPerBar).toBe(4);
    expect(meter.confidence).toBe(0);
  });

  /**
   * 2박은 **배수 오류의 신호**라서 후보에 있다. 절반 템포로 잡히면 진짜 마디가
   * 우리 박으로 2박이 되는데, 후보에 2가 없으면 3이나 4가 억지로 뽑혀 나가
   * 원인이 가려진다(실측: 173BPM 4/4 곡이 87BPM 3/4로 나갔다).
   */
  test("후보가 2·3·4 셋이고 확률을 다 더하면 1이다", () => {
    const meter = meterOf(4);
    expect(meter.candidates.map((c) => c.beatsPerBar).sort()).toEqual([2, 3, 4]);
    const sum = meter.candidates.reduce((acc, c) => acc + c.probability, 0);
    expect(sum).toBeCloseTo(1, 5);
    // 고른 것이 1등이다 — 확률은 마진까지 반영한 값이라 결정과 어긋나지 않는다
    expect(meter.candidates[0].beatsPerBar).toBe(meter.beatsPerBar);
  });

  test("2박을 후보에 넣어도 4/4를 빼앗기지 않는다", () => {
    for (const bpm of [100, 120, 140]) {
      expect(meterOf(4, bpm).beatsPerBar).toBe(4);
    }
  });

  /**
   * **4/4가 기본값이다** — 근소하게 앞선다고 넘어가면 안 된다(실측: 실곡에서
   * 1%p 차이로 2/4가 나가 격자·마디·악보가 통째로 어긋났다).
   */
  test("3박째가 첫 박만큼 세도 4/4를 지킨다", () => {
    // 세기만 보면 2박 주기다. 화성이 4박마다 바뀌는 것이 4/4를 지탱한다
    const samples = makeTrack({
      bpm: 120,
      bars: 16,
      beatsPerBar: 4,
      chords: C_MAJOR_PROGRESSION,
      beatGains: [1.0, 0.4, 1.0, 0.4],
    });
    const features = extractFeatures(samples, ANALYSIS_RATE);
    const onset = normalizeOnset(features.onset, features.fps);
    const track = trackBeats(onset, features.fps, 120);
    const meter = estimateMeter(
      track.beats,
      features.fps,
      features.onset,
      features.low,
      features.chroma,
    );
    expect(meter.beatsPerBar).toBe(4);
  });

  /**
   * 주기가 뚜렷하면 그대로 읽는다. **2박을 문턱으로 막지 않는다** —
   * 막아 봤더니 진짜 2/4 동요까지 4/4가 됐고, 2/4가 나오는 것 자체가
   * 배수 오류를 알려주는 값진 신호였다(`resolveDupleMeter`).
   */
  test("순수 주기 신호를 그대로 읽는다 (2·3·4)", () => {
    const fps = 100;
    const beats = Array.from({ length: 48 }, (_, i) => i * 0.5);
    const frames = 48 * 50 + 50;
    const pulse = (period: number) => {
      const onset = new Float32Array(frames);
      for (const [i, beat] of beats.entries()) {
        const at = Math.round(beat * fps);
        for (let k = 0; k < 6; k += 1) onset[at + k] = i % period === 0 ? 1 : 0.2;
      }
      return estimateMeter(
        beats,
        fps,
        onset,
        new Float32Array(frames),
        new Float32Array(frames * 12).fill(1 / 12),
      );
    };
    for (const period of [2, 3, 4]) {
      expect(pulse(period).beatsPerBar).toBe(period);
    }
  });

  /**
   * 2/4와 4/4는 같은 그리드를 다른 단위로 읽은 것이다 — 템포에서 ×2가 신뢰도를
   * 깎지 않는 것과 같다. 이걸 빼먹으면 후보에 2를 넣은 것만으로 신뢰도가
   * 절반이 된다(실측: 0.48 → 0.26).
   */
  test("배수 관계인 2박은 4/4의 신뢰도를 깎지 않는다", () => {
    expect(meterOf(4).confidence).toBeGreaterThan(0.35);
  });
});

describe("박자 — 축 A (박 세분화)", () => {
  /** 12조각 윤곽을 직접 만들어 판정만 본다 */
  function profile(values: Partial<Record<number, number>>): Float64Array {
    const out = new Float64Array(12).fill(0.05);
    for (const [k, v] of Object.entries(values)) out[Number(k)] = v as number;
    return out;
  }

  test("1/2 자리만 강하면 2분할", () => {
    expect(subdivisionOf(profile({ 0: 1, 6: 0.6 }))).toEqual({
      subdivision: "simple",
      shuffle: false,
    });
  });

  test("1/3·2/3이 고르게 강하면 3분할", () => {
    expect(subdivisionOf(profile({ 0: 1, 4: 0.6, 8: 0.6 }))).toEqual({
      subdivision: "compound",
      shuffle: false,
    });
  });

  test("2/3만 강하고 가운데가 비면 셔플 — 3분할이 아니다", () => {
    expect(subdivisionOf(profile({ 0: 1, 4: 0.05, 8: 0.6 }))).toEqual({
      subdivision: "simple",
      shuffle: true,
    });
  });

  /** 합성 신호에서 윤곽을 뽑는다. 화음을 얹어 지속음이 섞인 쪽도 본다. */
  function shapeOf(eighths: "straight" | "swing", chords = false) {
    const samples = makeTrack({
      bpm: 100,
      bars: 12,
      beatsPerBar: 4,
      eighths,
      chords: chords ? C_MAJOR_PROGRESSION : undefined,
    });
    const features = extractFeatures(samples, ANALYSIS_RATE);
    const onset = normalizeOnset(features.onset, features.fps);
    const tempo = estimateTempo(onset, features.fps);
    const track = trackBeats(onset, features.fps, tempo.bpm);
    return beatProfile(track.beats, features.fps, features.onset);
  }

  test("실제 스윙 8분음표를 셔플로 읽는다", () => {
    const shape = shapeOf("swing");
    expect(shape[8]).toBeGreaterThan(shape[6]); // 2/3 자리가 1/2 자리보다 세다
    expect(shape[8]).toBeGreaterThan(shape[4]); // 가운데는 비어 있다
    // 윤곽만 보지 말고 판정까지 볼 것 — 임계값을 넘지 못하면 플래그가 안 선다
    expect(subdivisionOf(shape)).toEqual({ subdivision: "simple", shuffle: true });
  });

  test("지속음(화음)이 깔려 있어도 셔플 판정이 살아 있다", () => {
    expect(subdivisionOf(shapeOf("swing", true)).shuffle).toBe(true);
    expect(subdivisionOf(shapeOf("straight", true)).shuffle).toBe(false);
  });

  test("고른 8분음표는 셔플이 아니다", () => {
    expect(subdivisionOf(shapeOf("straight")).shuffle).toBe(false);
  });

});

// --- 조성 -----------------------------------------------------------------------

describe("조성", () => {
  test("조 이름은 관용 표기를 따른다 — 장조는 ♭, 단조는 ♯", () => {
    expect(keyName(0, "major")).toBe("C 장조");
    expect(keyName(1, "major")).toBe("D♭ 장조");
    expect(keyName(1, "minor")).toBe("C♯ 단조");
    expect(keyName(9, "minor")).toBe("A 단조");
  });

  test("C장조 음계만 울리면 C장조", () => {
    const chroma = Array.from({ length: 12 }, () => 0);
    for (const pc of [0, 2, 4, 5, 7, 9, 11]) chroma[pc] = 1;
    chroma[0] = 3; // 으뜸음이 가장 잦다
    chroma[7] = 2;
    expect(estimateKeyFromChroma(chroma).name).toBe("C 장조");
  });

  test("같은 음계라도 강조가 바뀌면 나란한조로 간다", () => {
    const chroma = Array.from({ length: 12 }, () => 0);
    for (const pc of [0, 2, 4, 5, 7, 9, 11]) chroma[pc] = 1;
    chroma[9] = 3; // A
    chroma[4] = 2; // E
    expect(estimateKeyFromChroma(chroma).mode).toBe("minor");
  });

  test("이조하면 조도 함께 옮겨간다", () => {
    const base = Array.from({ length: 12 }, () => 0);
    for (const pc of [0, 2, 4, 5, 7, 9, 11]) base[pc] = 1;
    base[0] = 3;
    base[7] = 2;
    const up = Array.from({ length: 12 }, (_, i) => base[(i - 3 + 12) % 12]);
    expect(estimateKeyFromChroma(up).name).toBe("E♭ 장조");
  });

  test("모든 음이 고르면 확신하지 않는다", () => {
    const flat = Array.from({ length: 12 }, () => 1);
    expect(estimateKeyFromChroma(flat).confidence).toBeLessThan(0.5);
  });

  test("두 프로파일이 서로 다른 판정을 낼 수 있다 — 그래서 고를 수 있게 둔다", () => {
    const chroma = Array.from({ length: 12 }, () => 0);
    for (const pc of [0, 2, 4, 5, 7, 9, 11]) chroma[pc] = 1;
    const a = estimateKeyFromChroma(chroma, "KRUMHANSL");
    const b = estimateKeyFromChroma(chroma, "TEMPERLEY");
    expect(a.name.length).toBeGreaterThan(0);
    expect(b.name.length).toBeGreaterThan(0);
  });

  test("무음 프레임은 크로마 집계에서 빠진다", () => {
    const chroma = new Float32Array(12 * 4); // 4프레임, 전부 0
    for (let pc = 0; pc < 12; pc += 1) chroma[12 + pc] = pc === 0 ? 1 : 0;
    const total = aggregateChroma(chroma);
    expect(total[0]).toBe(1); // 유효 프레임 하나로만 나눈다
  });
});

// --- 전체 -----------------------------------------------------------------------

describe("analyzeAudio — 전체 통과", () => {
  const samples = makeTrack({
    bpm: 128,
    bars: 16,
    beatsPerBar: 4,
    chords: C_MAJOR_PROGRESSION,
  });
  const report = analyzeAudio(samples, ANALYSIS_RATE);

  test("BPM·박자·조성이 한 번에 나온다", () => {
    expect(report.tempo.bpm).toBeCloseTo(128, 0);
    expect(report.meter.value).toBe("4/4");
    expect(report.key.name).toBe("C 장조");
  });

  test("길이와 비트 수가 서로 맞는다", () => {
    expect(report.durationSec).toBeCloseTo(samples.length / ANALYSIS_RATE, 3);
    const expected = report.durationSec / (60 / 128);
    expect(report.beats.length).toBeGreaterThan(expected * 0.9);
  });

  test("단계마다 신뢰도를 돌려준다", () => {
    for (const value of [
      report.tempo.confidence,
      report.meter.confidence,
      report.key.confidence,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  test("진행률이 0에서 1까지 순서대로 온다", () => {
    const seen: number[] = [];
    analyzeAudio(samples.slice(0, ANALYSIS_RATE * 3), ANALYSIS_RATE, (p) =>
      seen.push(p.ratio),
    );
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  test("빈 신호에도 죽지 않는다", () => {
    const empty = analyzeAudio(new Float32Array(0), ANALYSIS_RATE);
    expect(empty.beats).toHaveLength(0);
    expect(empty.tempo.bpm).toBe(0);
  });

  test("조율이 틀어진 음원도 조성을 맞힌다 — 크로마 전에 되민다", () => {
    const detuned = makeTrack({
      bpm: 120,
      bars: 12,
      beatsPerBar: 4,
      chords: C_MAJOR_PROGRESSION,
      cents: 35,
    });
    const out = analyzeAudio(detuned, ANALYSIS_RATE);
    expect(out.tuningCents).toBeCloseTo(35, -1);
    expect(out.key.name).toBe("C 장조");
  });
});

describe("표시 보조", () => {
  test("악센트 패턴 — 숫자만으로는 3/4와 6/8이 헷갈린다", () => {
    expect(accentPattern(4)).toBe("● ○ ○ ○");
    expect(accentPattern(3)).toBe("● ○ ○");
  });

  test("신뢰도 3단계, 0.5 아래는 확인 필요", () => {
    expect(confidenceTier(0.9)).toBe("high");
    expect(confidenceTier(0.6)).toBe("medium");
    expect(confidenceTier(0.3)).toBe("low");
  });
});

// --- platform 쪽 순수 함수 ---------------------------------------------------------

describe("디코딩 보조", () => {
  test("표본화율 변환은 길이를 비율대로 줄인다", () => {
    const input = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
    const out = resample(input, 44_100, 22_050);
    expect(out.length).toBe(500);
    // 구간 평균이라 값의 흐름은 유지된다
    expect(out[0]).toBeCloseTo(0.0005, 3);
    expect(out[499]).toBeCloseTo(0.9985, 3);
  });

  test("같은 표본화율이면 그대로 돌려준다", () => {
    const input = new Float32Array(10);
    expect(resample(input, 22_050, 22_050)).toBe(input);
  });

  /**
   * 화면을 떠나면 워커를 죽인다. 안 죽이면 스템 분리(수 분)가 붙었을 때
   * 되돌아와 새 파일을 여는 것만으로 무거운 작업이 겹쳐 돈다.
   */
  test("취소하면 워커를 종료한다", async () => {
    let terminated = false;
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: () => {},
      terminate: () => {
        terminated = true;
      },
    } as unknown as Worker;

    const controller = new AbortController();
    const pending = analyzeFile(
      new Blob([new ArrayBuffer(8)]),
      undefined,
      {
        decode: () =>
          Promise.resolve({ samples: new Float32Array(44_100), sampleRate: 22_050 }),
        makeWorker: () => worker,
      },
      controller.signal,
    );
    // 워커가 아무 답도 주지 않는 사이에 화면을 떠난다
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(terminated).toBe(true);
  });

  test("스테레오는 평균해 모노로", () => {
    const left = Float32Array.from([1, 1, 1]);
    const right = Float32Array.from([0, 0, 0]);
    const buffer = {
      numberOfChannels: 2,
      length: 3,
      getChannelData: (c: number) => (c === 0 ? left : right),
    } as unknown as AudioBuffer;
    expect([...downmix(buffer)]).toEqual([0.5, 0.5, 0.5]);
  });
});

// --- 2/4 → 배수 오류 ------------------------------------------------------------

/**
 * **2/4는 박자에 대한 답이라기보다 "비트가 두 배 길다"는 신고다.**
 *
 * 대중음악에서 2/4는 드물고, 반대로 템포가 절반으로 잡히면 진짜 4/4 마디가 우리
 * 박으로 정확히 2박이 되어 축 B가 2를 고른다. `resolveOctave`가 악센트로 먼저
 * 같은 것을 잡지만 반박이 뚜렷해야만 걸리므로, 그것이 놓친 경우를 여기서 받는다.
 *
 * (2박 자체를 마진으로 막아 보기도 했는데, **진짜 2/4 동요까지 4/4가 되어**
 * 되돌렸다 — 2/4가 나오는 것 자체가 값진 신호라 지우면 안 된다.)
 */
describe("2/4가 나오면 템포 절반을 의심한다", () => {
  const onset = new Float32Array(2000).fill(1);
  const beats = Array.from({ length: 40 }, (_, i) => i * 0.5);
  const meterOfBar = (beatsPerBar: number): MeterEstimate => ({
    value: `${beatsPerBar}/4`,
    beatsPerBar,
    phase: 0,
    subdivision: "simple",
    shuffle: false,
    confidence: 0.5,
    candidates: [],
    downbeats: [],
  });
  const track = { beats, bpm: 60, steadiness: 1 };
  const tempoWith = (bpm: number, weight: number) => ({
    bpm: 60,
    confidence: 0.5,
    candidates: [
      { bpm: 60, weight: 1, probability: 0.6 },
      { bpm, weight, probability: 0.4 },
    ],
  });
  /** 두 배로 다시 재면 4/4가 나오는 상황 */
  const solves = () => meterOfBar(4);

  test("2배 후보가 있고 다시 재서 4/4가 나오면 갈아탄다", () => {
    const out = resolveDupleMeter(
      onset, 100, tempoWith(120, 0.5), track, meterOfBar(2), solves,
    );
    expect(out).not.toBeNull();
    expect(out?.meter.beatsPerBar).toBe(4);
    expect(out?.track.bpm).toBeCloseTo(120, 0);
  });

  test("박자가 2/4가 아니면 건드리지 않는다", () => {
    for (const bar of [3, 4]) {
      expect(
        resolveDupleMeter(onset, 100, tempoWith(120, 0.5), track, meterOfBar(bar), solves),
      ).toBeNull();
    }
  });

  test("자기상관에 2배 후보가 없으면 올리지 않는다", () => {
    // 2배가 아닌 자리에 있는 후보
    expect(
      resolveDupleMeter(onset, 100, tempoWith(95, 0.9), track, meterOfBar(2), solves),
    ).toBeNull();
    // 2배 자리이긴 한데 너무 약하다
    expect(
      resolveDupleMeter(onset, 100, tempoWith(120, 0.05), track, meterOfBar(2), solves),
    ).toBeNull();
  });

  test("두 배로 재도 4/4가 안 나오면 원래 답을 지킨다", () => {
    // 근거 없이 숫자만 두 배로 만들면 2/4가 알려주던 사실까지 지워진다
    expect(
      resolveDupleMeter(
        onset, 100, tempoWith(120, 0.5), track, meterOfBar(2), () => meterOfBar(2),
      ),
    ).toBeNull();
  });

  test("2배가 상한을 넘으면 올리지 않는다", () => {
    const fast = { beats, bpm: 150, steadiness: 1 };
    expect(
      resolveDupleMeter(onset, 100, tempoWith(300, 0.9), fast, meterOfBar(2), solves),
    ).toBeNull();
  });
});
