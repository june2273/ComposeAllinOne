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
  extractChordChroma,
  extractFeatures,
  estimateTuningCents,
} from "../src/core/analysis/features";
import {
  chordTemplates,
  estimateChords,
  rootName,
  type ChordEvent,
} from "../src/core/analysis/chords";
import { keyFifths as scoreKeyFifths } from "../src/core/transcribe/musicxml";
import {
  beatChroma,
  beatProfile,
  estimateMeter,
  subdivisionOf,
} from "../src/core/analysis/meter";
import {
  aggregateChroma,
  estimateKeyFromChroma,
  keyFifths,
  keyName,
} from "../src/core/analysis/key";
import {
  accentPattern,
  analyzeAudio,
  confidenceTier,
  type AnalysisProgress,
  type BeatGrid,
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
  /**
   * 마디마다의 베이스 한 음 (MIDI 번호). E2~G3(82~196Hz) 안에 두면
   * `extractChordChroma`의 베이스 대역에 잡힌다.
   *
   * **음고류 집합이 같은 코드를 가르는 유일한 단서다** — `Dm7`(D F A C)과
   * `F6`(F A C D)은 위쪽만 봐서는 같은 것이라 근음이 아래에 있어야 갈린다.
   */
  bass?: number[];
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
  const { bpm, bars, beatsPerBar, chords, bass, eighths = null, cents = 0, beatGains } = options;
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
    const from = bar * beatsPerBar * beat;
    if (chords?.length) {
      const chord = chords[bar % chords.length];
      for (const midi of chord) {
        // 배음을 두 개 얹어야 크로마 하한(200Hz) 위로 에너지가 올라온다
        tone(out, from, from + beatsPerBar * beat, midiToFreq(midi, cents), 0.28);
        tone(out, from, from + beatsPerBar * beat, midiToFreq(midi + 12, cents), 0.14);
      }
    }
    if (bass?.length) {
      const root = bass[bar % bass.length];
      tone(out, from, from + beatsPerBar * beat, midiToFreq(root, cents), 0.45);
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

/**
 * 그 합성 트랙의 **정확한** 비트 격자.
 *
 * 예전에는 자기상관으로 찾아냈는데, 이제 격자는 밖에서 온다(사이드카). 합성
 * 신호는 우리가 클릭을 어디 찍었는지 **정확히 알고 있으므로** 찾을 이유가
 * 없다 — `makeTrack`과 같은 식을 쓴다. 추정을 안 거치니 오히려 결정적이고,
 * 박자·코드 시험이 "비트가 잘 잡혔는가"에 딸려 흔들리지 않는다.
 */
function gridOf(options: TrackOptions): BeatGrid {
  const { bpm, bars, beatsPerBar } = options;
  const beat = 60 / bpm;
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    for (let b = 0; b < beatsPerBar; b += 1) {
      const at = (bar * beatsPerBar + b) * beat;
      beats.push(at);
      if (b === 0) downbeats.push(at);
    }
  }
  return { beats, downbeats, beatsPerBar, bpm };
}

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

/*
 * **`describe("템포와 비트")` 10개가 2026-09-12에 사라졌다.**
 *
 * 전부 `estimateTempo`·`trackBeats`·`resolveOctave`·`halfBeatStrength`를 재던
 * 것인데 그 함수들이 없어졌다. 비트는 이제 사이드카(Beat This!)가 낸다.
 *
 * 그중 둘은 값이 컸으므로 어디로 갔는지 적어 둔다 — "빠른 곡을 절반 템포로
 * 읽지 않는다"(174BPM)와 "근거가 없으면 배수를 올리지 않는다"(120·90·174)는
 * **배수 오류의 회귀 시험**이었다. 그 물음은 이제 합성 신호가 아니라 **정답
 * 14곡**이 답한다(`scripts/eval/tempo.eval.ts`, 실측 14/14) — 합성 클릭
 * 트랙으로는 애초에 실곡의 배수 모호성을 재현할 수 없었고, **그래서 이 시험을
 * 전부 통과한 코드가 실곡에서 여덟 번 틀렸다.**
 *
 * 남은 순수 함수(`relatedTempo`·`metricalFamily`·`retimeBeats`·`bpmOf`)는
 * 아래 "비트 격자" 묶음이 본다.
 */

// --- 박자 -----------------------------------------------------------------------

/*
 * **축 B의 대결 시험 아홉 개가 2026-09-12에 사라졌다.**
 *
 * 4·3·2 가설을 노벨티 효과크기로 겨루게 하고 `TRIPLE_MARGIN`·`DUPLE_MARGIN`이
 * 옳게 가르는지 보던 것들이다. 그 축이 통째로 빠졌다 — 마디 길이는 사이드카의
 * 다운비트가 정한다(실측 14/14, 유일한 3/4 포함).
 *
 * 사라진 것 중 값이 컸던 셋: "가릴 단서가 없으면 4/4로 물러난다"(후보를 도는
 * 순서에 답이 달려 있던 버그를 잡은 시험), "어떤 주기를 넣어도 2/4는 안
 * 나온다", "배수 관계인 2박은 4/4의 신뢰도를 깎지 않는다". **그 물음들은 이제
 * 우리 코드가 답하지 않는다** — 근거였던 14곡 표는 CLAUDE.md에 남아 있다.
 */

describe("박자 — 마디 격자를 받는다", () => {
  const flat = (frames: number) => new Float32Array(frames).fill(1);

  function meterOf(beatsPerBar: number, bars = 16, bpm = 120) {
    const samples = makeTrack({ bpm, bars, beatsPerBar, chords: C_MAJOR_PROGRESSION });
    const features = extractFeatures(samples, ANALYSIS_RATE);
    const grid = gridOf({ bpm, bars, beatsPerBar });
    return estimateMeter(grid.beats, features.fps, features.onset, grid);
  }

  test("받은 마디 길이를 그대로 낸다", () => {
    expect(meterOf(4).value).toBe("4/4");
    expect(meterOf(3).value).toBe("3/4");
  });

  test("다운비트를 지어내지 않고 받은 것을 돌려준다", () => {
    const grid = gridOf({ bpm: 120, bars: 16, beatsPerBar: 4 });
    const meter = estimateMeter(grid.beats, 86, flat(2000), grid);
    expect(meter.downbeats).toEqual(grid.downbeats);
  });

  /**
   * **위상은 세지 않고 찾는다.** 첫 다운비트가 몇 번째 비트인지가 곧 위상이다 —
   * 예전에는 네 가설을 겨루게 해서 골랐는데, 지금은 이미 정해져 있다.
   */
  test("첫 다운비트가 어디 있든 위상을 짚는다", () => {
    const beats = Array.from({ length: 40 }, (_, i) => i * 0.5);
    for (const phase of [0, 1, 2, 3]) {
      const downbeats = beats.filter((_, i) => i >= phase && (i - phase) % 4 === 0);
      const meter = estimateMeter(beats, 100, flat(2500), { beatsPerBar: 4, downbeats });
      expect(meter.phase).toBe(phase);
    }
  });

  /**
   * **신뢰도가 다운비트의 일관성이다.** 대결이 없어졌으니 마진도 없다. 대신
   * 모델이 낸 마디가 실제로 같은 간격으로 오는지를 센다 — 겨루기 없이도 셀 수
   * 있는 진짜 증거이고, 곡 중간에 흔들리면 그만큼 덜 믿을 일이다.
   */
  test("마디가 고르면 신뢰도 1, 흔들리면 내려간다", () => {
    const beats = Array.from({ length: 40 }, (_, i) => i * 0.5);
    const even = beats.filter((_, i) => i % 4 === 0);
    expect(estimateMeter(beats, 100, flat(2500), {
      beatsPerBar: 4, downbeats: even,
    }).confidence).toBe(1);

    // 한 마디만 3박으로 밀어 넣는다
    const slipped = [...even.slice(0, 5), even[5] - 0.5, ...even.slice(6)];
    const shaky = estimateMeter(beats, 100, flat(2500), {
      beatsPerBar: 4, downbeats: slipped,
    });
    expect(shaky.confidence).toBeLessThan(1);
    expect(shaky.beatsPerBar).toBe(4);
  });

  test("후보는 관측된 마디 길이의 분포다 — 다 더하면 1", () => {
    const meter = meterOf(4);
    const total = meter.candidates.reduce((sum, c) => sum + c.probability, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(meter.candidates[0].beatsPerBar).toBe(4);
  });

  test("다운비트가 없으면 판정하지 않는다 (신뢰도 0)", () => {
    const meter = estimateMeter([0, 0.5, 1], 86, flat(100), {
      beatsPerBar: 4, downbeats: [],
    });
    expect(meter.confidence).toBe(0);
    // 그래도 4/4로 물러난다 — 화면에 빈 칸을 내지 않는다
    expect(meter.beatsPerBar).toBe(4);
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
    // **옵션을 한 번만 적는다.** `makeTrack`과 `gridOf`에 따로 적었다가 100BPM
    // 트랙에 120BPM 격자를 물려 셔플 판정이 통째로 뒤집혔다(실측 2026-09-12).
    const options: TrackOptions = {
      bpm: 100,
      bars: 12,
      beatsPerBar: 4,
      eighths,
      chords: chords ? C_MAJOR_PROGRESSION : undefined,
    };
    const features = extractFeatures(makeTrack(options), ANALYSIS_RATE);
    return beatProfile(gridOf(options).beats, features.fps, features.onset);
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

// --- 코드 -----------------------------------------------------------------------

describe("코드 인식", () => {
  /**
   * 합성 트랙 → 코드. `meterOf`와 같은 결선이고, `analyzeAudio`가 실제로
   * 하는 것과 같은 순서다(특징 → 템포 → 비트 → 박자 → 코드).
   */
  function chordsOf(options: TrackOptions): readonly ChordEvent[] {
    const samples = makeTrack(options);
    const features = extractFeatures(samples, ANALYSIS_RATE);
    const grid = gridOf(options);
    const meter = estimateMeter(grid.beats, features.fps, features.onset, grid);
    const chroma = extractChordChroma(samples, ANALYSIS_RATE, features.tuningCents);
    return estimateChords(grid.beats, chroma.fps, chroma.chroma, chroma.energy, {
      beatsPerBar: meter.beatsPerBar,
      phase: meter.phase,
      bass: chroma.bass,
    }).chords;
  }

  /** 이어지는 같은 심볼을 접는다. 몇 번 반복됐는지가 아니라 순서가 궁금하다 */
  function progression(chords: readonly ChordEvent[]): string[] {
    return chords.map((c) => c.symbol);
  }

  test("I–V–vi–IV를 그대로 딴다", () => {
    const chords = chordsOf({
      bpm: 120,
      bars: 8,
      beatsPerBar: 4,
      chords: C_MAJOR_PROGRESSION,
    });
    expect(progression(chords)).toEqual([
      "C", "G", "Am", "F", "C", "G", "Am", "F",
    ]);
  });

  /**
   * **이것이 크로마 창을 8192로 넓힌 이유다.** 옛 크로마는 하한이 200Hz라
   * E2(82Hz)·A2(110Hz)가 통째로 빠졌다 — 대중음악 베이스가 사는 자리다.
   */
  test("베이스 음역(E2·A2)의 근음도 잡는다", () => {
    const chords = chordsOf({
      bpm: 120,
      bars: 8,
      beatsPerBar: 4,
      // E2 B2 G♯3 = E장조 · A2 E3 C♯4 = A장조. 전부 옛 하한 아래에서 시작한다
      chords: [
        [40, 47, 56],
        [45, 52, 61],
      ],
    });
    expect(progression(chords)).toEqual(["E", "A", "E", "A", "E", "A", "E", "A"]);
  });

  /**
   * 왕도진행(사양서 §1.5) — 7화음을 빼면 표현되지 않는 진행이다.
   *
   * **베이스가 있어야 풀린다.** `Em7`(E G B D)은 `G` 템플릿에도 `Em` 템플릿에도
   * 4음 중 3개가 맞아 음고류만으로는 동점이고, 가르는 것은 맨 아래 음뿐이다.
   */
  test("왕도진행 IVM7–V7–iii7–vi", () => {
    const chords = chordsOf({
      bpm: 120,
      bars: 8,
      beatsPerBar: 4,
      chords: [
        [65, 69, 72, 76], // FM7
        [67, 71, 74, 77], // G7
        [64, 67, 71, 74], // Em7
        [69, 72, 76], // Am
      ],
      bass: [41, 43, 40, 45], // F2 G2 E2 A2
    });
    expect(progression(chords)).toEqual([
      "FM7", "G7", "Em7", "Am", "FM7", "G7", "Em7", "Am",
    ]);
  });

  /**
   * `Dm7`(D F A C)과 `F6`(F A C D)은 **같은 음 집합**이다. 위쪽만 보면
   * 원리적으로 못 가르고(실측: 베이스가 없으면 `F`로 나온다) 근음이 정한다.
   */
  test("음 집합이 같은 코드는 베이스가 가른다 — Dm7 대 F", () => {
    const options: TrackOptions = {
      bpm: 120,
      bars: 8,
      beatsPerBar: 4,
      chords: [
        [69, 72, 76], // Am
        [62, 65, 69, 72], // Dm7 ≡ F6
      ],
    };
    expect(progression(chordsOf(options))).toContain("F");
    expect(progression(chordsOf({ ...options, bass: [45, 38] }))).toEqual([
      "Am", "Dm7", "Am", "Dm7", "Am", "Dm7", "Am", "Dm7",
    ]);
  });

  test("소리가 없는 구간에는 코드를 세우지 않는다", () => {
    const options: TrackOptions = {
      bpm: 120,
      bars: 8,
      beatsPerBar: 4,
      chords: C_MAJOR_PROGRESSION,
    };
    const samples = makeTrack(options);
    // 3~4마디를 지운다 — 간주처럼. 클릭까지 함께 사라진다
    samples.fill(0, Math.round(4 * ANALYSIS_RATE), Math.round(8 * ANALYSIS_RATE));
    const features = extractFeatures(samples, ANALYSIS_RATE);
    const grid = gridOf(options);
    const chroma = extractChordChroma(samples, ANALYSIS_RATE, features.tuningCents);
    const { chords } = estimateChords(
      grid.beats,
      chroma.fps,
      chroma.chroma,
      chroma.energy,
      { beatsPerBar: 4, phase: 3, bass: chroma.bass },
    );
    // 지운 구간(4~8초)을 덮는 코드가 없어야 한다
    const covering = chords.filter((c) => c.startSec < 7.5 && c.endSec > 4.5);
    expect(covering).toHaveLength(0);
    expect(chords.length).toBeGreaterThan(0);
  });

  test("비트가 모자라면 조용히 빈 결과다", () => {
    const empty = estimateChords([0, 1], 10, new Float32Array(12 * 20), new Float32Array(20));
    expect(empty.chords).toEqual([]);
    expect(empty.confidence).toBe(0);
  });

  test("템플릿은 24개 — 장 12 · 단 12", () => {
    const templates = chordTemplates();
    expect(templates).toHaveLength(24);
    // C장 = C E G
    const c = templates.find((t) => t.root === 0 && t.quality === "maj")!;
    expect([...c.vector]).toEqual([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]);
    // A단 = A C E
    const am = templates.find((t) => t.root === 9 && t.quality === "min")!;
    expect([...am.vector]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]);
  });

  test("근음 표기는 조표 방향을 따른다", () => {
    expect(rootName(6, 2)).toBe("F♯"); // ♯계
    expect(rootName(6, -2)).toBe("G♭"); // ♭계
    expect(rootName(10, -3)).toBe("B♭");
    expect(rootName(0, 0)).toBe("C");
  });

  /**
   * **조표 표가 두 벌이다.** 층 규칙이 `core/analysis`와 `core/transcribe`를
   * 잇는 것을 금지해서 어쩔 수 없는데, 한쪽만 고치면 화면의 코드 심볼과
   * 악보의 음표가 서로 다른 방향(♯/♭)으로 적힌다. 24개 조 전부를 못박는다.
   */
  test("조표 표가 두 층에서 같은 값을 낸다", () => {
    for (let tonic = 0; tonic < 12; tonic += 1) {
      for (const mode of ["major", "minor"] as const) {
        expect(keyFifths(tonic, mode)).toBe(scoreKeyFifths(tonic, mode));
      }
    }
  });

  test("비트 동기 크로마는 비트 수보다 하나 적다", () => {
    // 프레임 4개, 비트 3개(= 구간 2개)
    const chroma = new Float32Array(12 * 4);
    for (let t = 0; t < 4; t += 1) chroma[t * 12 + (t < 2 ? 0 : 7)] = 1;
    const vectors = beatChroma([0, 2, 4], 1, chroma);
    expect(vectors).toHaveLength(2);
    expect(vectors[0][0]).toBeGreaterThan(0); // 앞 구간은 C
    expect(vectors[1][7]).toBeGreaterThan(0); // 뒤 구간은 G
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
  const grid = gridOf({ bpm: 128, bars: 16, beatsPerBar: 4 });
  const report = analyzeAudio(samples, grid, ANALYSIS_RATE);

  test("BPM·박자·조성·코드가 한 번에 나온다", () => {
    expect(report.tempo.bpm).toBeCloseTo(128, 0);
    expect(report.meter.value).toBe("4/4");
    expect(report.key.name).toBe("C 장조");
    expect(report.chords.map((c) => c.symbol).slice(0, 4)).toEqual([
      "C", "G", "Am", "F",
    ]);
  });

  test("코드 구간은 시각 순서대로 겹치지 않는다", () => {
    let previous = -1;
    for (const chord of report.chords) {
      expect(chord.startSec).toBeGreaterThanOrEqual(previous);
      expect(chord.endSec).toBeGreaterThan(chord.startSec);
      expect(chord.endBeat).toBeGreaterThan(chord.startBeat);
      previous = chord.endSec;
    }
  });

  /**
   * `AnalysisReport`는 워커 경계를 structured clone으로 넘는다
   * (`platform/analysis.worker.ts`). 복제되지 않는 값이 하나라도 섞이면
   * 분석이 통째로 실패하는데, 그 실패는 **워커가 있는 환경에서만** 난다.
   */
  test("코드가 붙어도 보고서는 그대로 복제된다", () => {
    const copy = structuredClone(report);
    expect(copy.chords.map((c) => c.symbol)).toEqual(
      report.chords.map((c) => c.symbol),
    );
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
    analyzeAudio(
      samples.slice(0, ANALYSIS_RATE * 3),
      grid,
      ANALYSIS_RATE,
      (p: AnalysisProgress) => seen.push(p.ratio),
    );
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  test("빈 신호에도 죽지 않는다", () => {
    // **격자까지 비어 있는 경우다.** 사이드카가 아무것도 못 찾은 곡이 여기 온다
    const empty = analyzeAudio(
      new Float32Array(0),
      { beats: [], downbeats: [], beatsPerBar: 0 },
      ANALYSIS_RATE,
    );
    expect(empty.beats).toHaveLength(0);
    expect(empty.tempo.bpm).toBe(0);
    expect(empty.chords).toEqual([]);
    expect(empty.chordConfidence).toBe(0);
  });

  test("조율이 틀어진 음원도 조성을 맞힌다 — 크로마 전에 되민다", () => {
    const detuned = makeTrack({
      bpm: 120,
      bars: 12,
      beatsPerBar: 4,
      chords: C_MAJOR_PROGRESSION,
      cents: 35,
    });
    const out = analyzeAudio(
      detuned,
      gridOf({ bpm: 120, bars: 12, beatsPerBar: 4 }),
      ANALYSIS_RATE,
    );
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
      { beats: [0, 0.5], downbeats: [0], beatsPerBar: 4 },
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

/*
 * **`describe("2박 신고가 올라오면 템포 절반을 의심한다")` 6개도 사라졌다.**
 * `resolveDupleMeter`를 재던 것인데 축 B가 없어져 신고 자체가 안 나온다.
 * 그 함수가 실제로 값을 한 사례(곡F MR 164.0 → 82.0)와 악센트 게이트를
 * 나중에 붙인 이력은 CLAUDE.md에 남아 있다.
 */
