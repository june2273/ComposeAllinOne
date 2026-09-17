/**
 * 드럼 검출 — **답을 아는 신호를 합성해 넣는다.**
 *
 * `analysis.test.ts`와 같은 방법이다. 다만 여기서는 그 방법이 유난히 세다 —
 * 멜로디는 사람이 부른 것을 합성할 수 없어서 합성 시험이 "의도대로 도는가"까지만
 * 말했지만, **드럼은 만들 수 있다.** 저역 사인 감쇠가 킥이고 대역 잡음 버스트가
 * 스네어이고 고역 짧은 잡음이 하이햇이다. 타점 목록을 알고 만들면 **온셋
 * F-measure와 클래스 정답률이 둘 다 진짜 숫자로 나온다.**
 *
 * 정답이 없다는 것은 *실곡에* 없다는 뜻이지 아무것도 못 잰다는 뜻이 아니다.
 * 실곡 정확도는 여전히 모르고, 그것은 `scripts/eval/drums.eval.ts`와 언젠가의
 * `truthDrums`가 답할 물음이다.
 */

import { describe, expect, it } from "vitest";

import {
  BAND_EDGES,
  type DrumClass,
  type DrumHit,
  CLASS_MARKS,
  classOf,
  detectDrums,
  DRUM_CLASSES,
  GM_DRUMS,
  GM_NUMBERS,
  pickPeaks,
  representative,
} from "../src/core/drums";

const RATE = 22_050;

// --- 소리 만들기 ----------------------------------------------------------------
//
// 진짜 드럼을 흉내 내려는 것이 아니라 **대역과 감쇠만 맞춘다.** 검출기가 보는
// 것이 그 둘뿐이므로 그 이상은 시험을 어렵게 만들 뿐 아무것도 더 말해 주지 않는다.

/** 결정적 잡음 — 시험이 실행마다 달라지면 안 된다 */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return (s / 0x1_0000_0000) * 2 - 1;
  };
}

function add(into: Float32Array, at: number, sound: Float32Array): void {
  for (let i = 0; i < sound.length; i += 1) {
    const k = at + i;
    if (k >= 0 && k < into.length) into[k] += sound[i];
  }
}

/**
 * 어택 램프 — **불연속이 만드는 광대역 클릭을 없앤다.**
 *
 * 실측(2026-09-03): 이게 없으면 저역 사인으로 만든 킥의 생 플럭스가 220~900Hz에서
 * 가장 컸다. 시작 지점의 계단이 통째로 광대역 임펄스라서다. 대역제한을 주장하는
 * 시험 신호가 실제로는 안 그러면 **시험이 아무것도 못 잰다.**
 */
function ramp(sound: Float32Array, ms = 3): Float32Array {
  const n = Math.round((ms * RATE) / 1000);
  for (let i = 0; i < n && i < sound.length; i += 1) sound[i] *= i / n;
  return sound;
}

/** 다단 원폴 = 가파른 필터. 1단(6dB/oct)으로는 6kHz 하이패스가 500Hz를 못 막는다 */
function lowpass(x: Float32Array, hz: number, stages = 4): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / RATE);
  const y = Float32Array.from(x);
  for (let s = 0; s < stages; s += 1) {
    let z = 0;
    for (let i = 0; i < y.length; i += 1) {
      z += a * (y[i] - z);
      y[i] = z;
    }
  }
  return y;
}

function highpass(x: Float32Array, hz: number, stages = 4): Float32Array {
  const low = lowpass(x, hz, stages);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i += 1) y[i] = x[i] - low[i];
  return y;
}

function whiteNoise(seconds: number, seed: number): Float32Array {
  const rnd = noise(seed);
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i += 1) out[i] = rnd();
  return out;
}

/** 킥 — 118Hz에서 48Hz로 떨어지는 사인, 빠른 감쇠 */
function kick(): Float32Array {
  const n = Math.round(0.3 * RATE);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    const hz = 48 + 70 * Math.exp(-t / 0.025);
    phase += (2 * Math.PI * hz) / RATE;
    out[i] = Math.sin(phase) * Math.exp(-t / 0.08);
  }
  return ramp(out, 2);
}

/**
 * 스네어 — 200Hz 몸통 + **5kHz 위가 깎인** 잡음.
 *
 * 백색 잡음을 그대로 쓰면 안 된다. 진짜 스네어는 8kHz 위가 굴러떨어지는데,
 * 평탄한 잡음을 쓰면 고역 몫이 하이햇만큼 커져서 **누설 판정을 시험할 수 없는
 * 상태가 된다.** 시험이 쉬워지는 게 아니라 무의미해진다.
 */
function snare(): Float32Array {
  const n = Math.round(0.3 * RATE);
  const band = highpass(lowpass(whiteNoise(0.3, 7), 5000, 4), 300, 4);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    const body = Math.sin(2 * Math.PI * 200 * t) * 0.45;
    out[i] = (band[i] * 2.2 + body) * Math.exp(-t / 0.09);
  }
  return ramp(out, 1);
}

/** 톰 — 스네어와 같은 몸통 대역인데 **잡음이 없다.** 그것이 유일한 차이다 */
function tom(hz: number): Float32Array {
  const n = Math.round(0.45 * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    const f = hz * (1 + 0.15 * Math.exp(-t / 0.04));
    out[i] =
      (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * 2 * f * t)) *
      Math.exp(-t / 0.16);
  }
  return ramp(out, 2);
}

/** 심벌 계열 — 고역 잡음. **감쇠 시간만 다르다** */
function cymbal(decay: number, cutoffHz = 6500, seed = 11): Float32Array {
  const seconds = Math.min(1.6, decay * 6 + 0.05);
  const band = highpass(whiteNoise(seconds, seed), cutoffHz, 4);
  const out = new Float32Array(band.length);
  for (let i = 0; i < out.length; i += 1) out[i] = band[i] * 3 * Math.exp(-i / RATE / decay);
  return ramp(out, 1);
}

const SOUNDS: Record<Exclude<DrumClass, "unknown">, Float32Array> = {
  kick: kick(),
  snare: snare(),
  tom: tom(180),
  hihat: cymbal(0.025),
  "hihat-open": cymbal(0.22),
  cymbal: cymbal(0.9, 3500, 23),
};

interface Placed {
  readonly atSec: number;
  readonly cls: Exclude<DrumClass, "unknown">;
}

function render(hits: readonly Placed[], seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (const h of hits) add(out, Math.round(h.atSec * RATE), SOUNDS[h.cls]);
  // 아주 작은 바닥 잡음 — 완전한 무음은 정규화를 불안정하게 만든다
  const rnd = noise(99);
  for (let i = 0; i < out.length; i += 1) out[i] += rnd() * 1e-4;
  return out;
}

// --- 채점 ------------------------------------------------------------------------

const TOLERANCE_SEC = 0.05;

interface Score {
  readonly matched: number;
  readonly truth: number;
  readonly found: number;
  readonly correctClass: number;
  readonly f: number;
}

/**
 * 온셋 매칭 — **클래스를 무시하고 시각만으로 짝지은 뒤** 클래스를 따로 센다.
 *
 * 둘을 한 숫자에 섞으면 "온셋을 놓쳤다"와 "이름을 잘못 붙였다"를 구별할 수
 * 없다. RMVPE 교체 때 `자리 일치`가 46→88%로 뛴 것이 정확도가 아니라 **지표가
 * 얽혀 있어서**였던 그 함정이다.
 */
function score(truth: readonly Placed[], hits: readonly DrumHit[]): Score {
  const used = new Set<number>();
  let matched = 0;
  let correctClass = 0;
  for (const want of truth) {
    let best = -1;
    let bestGap = TOLERANCE_SEC;
    for (let i = 0; i < hits.length; i += 1) {
      if (used.has(i)) continue;
      const gap = Math.abs(hits[i].atSec - want.atSec);
      // 같은 시각에 여럿이면 클래스가 맞는 쪽을 먼저 집는다 — 동시타를
      // 표현할 수 있다는 것이 이 설계의 요점이라, 매칭이 그것을 봐야 한다.
      if (gap <= bestGap && (best < 0 || hits[i].cls === want.cls)) {
        best = i;
        bestGap = gap;
        if (hits[i].cls === want.cls) break;
      }
    }
    if (best >= 0) {
      used.add(best);
      matched += 1;
      if (hits[best].cls === want.cls) correctClass += 1;
    }
  }
  const precision = hits.length ? matched / hits.length : 0;
  const recall = truth.length ? matched / truth.length : 0;
  const f = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { matched, truth: truth.length, found: hits.length, correctClass, f };
}

/**
 * **한 트랙에 여러 악기를 넣는다 — 단일 악기 트랙으로 시험하지 않는다.**
 *
 * `detect.ts`가 대역마다 **그 곡의 전형적 크기로 나눠** 프로파일을 만들기
 * 때문이다(흰색화). 톰만 든 트랙에서는 그 분모가 톰 자신으로 잡혀 프로파일이
 * 퇴화하고, 실곡에서 나올 수 없는 값이 된다. 검출기가 받도록 만들어진 입력은
 * **드럼 스템 하나**이고 거기엔 늘 여러 악기가 있다.
 *
 * 앞부분은 진짜 그루브(흰색화 기준을 현실적으로 만든다), 뒷부분은 악기마다
 * 홀로 치는 구간(겹침 없이 분류를 볼 수 있다).
 */
function mixedTrack(): { truth: Placed[]; solos: Map<Exclude<DrumClass, "unknown">, [number, number]> } {
  const truth: Placed[] = [];
  const beat = 0.5; // 120BPM
  for (let bar = 0; bar < 8; bar += 1) {
    const t0 = 1 + bar * 4 * beat;
    truth.push({ atSec: t0, cls: "kick" }, { atSec: t0 + 2 * beat, cls: "kick" });
    truth.push({ atSec: t0 + beat, cls: "snare" }, { atSec: t0 + 3 * beat, cls: "snare" });
    for (let e = 0; e < 8; e += 1) truth.push({ atSec: t0 + e * beat * 0.5, cls: "hihat" });
    if (bar % 4 === 0) truth.push({ atSec: t0, cls: "cymbal" });
  }

  const solos = new Map<Exclude<DrumClass, "unknown">, [number, number]>();
  let at = 1 + 8 * 4 * beat + 1;
  for (const cls of ["kick", "snare", "tom", "hihat", "hihat-open", "cymbal"] as const) {
    const from = at;
    for (let i = 0; i < 4; i += 1) {
      truth.push({ atSec: at, cls });
      at += 0.7;
    }
    solos.set(cls, [from - 0.1, at]);
    at += 1.2;
  }
  truth.sort((a, b) => a.atSec - b.atSec);
  return { truth, solos };
}

/** 그루브 구간만 — 동시타를 보는 자리 */
const GROOVE_END = 1 + 8 * 4 * 0.5;

// --- 시험 ------------------------------------------------------------------------

describe("GM 표", () => {
  it("35~81을 빠짐없이 든다", () => {
    expect(GM_NUMBERS[0]).toBe(35);
    expect(GM_NUMBERS[GM_NUMBERS.length - 1]).toBe(81);
    // 빠진 번호가 있으면 손드럼 입력이 그 패드의 이름을 못 얻는다
    for (let gm = 35; gm <= 81; gm += 1) expect(GM_DRUMS[gm], `GM ${gm}`).toBeDefined();
  });

  it("어휘와 표가 갈려 있다 — 표는 전부, 어휘는 여섯", () => {
    expect(DRUM_CLASSES).toHaveLength(6);
    expect(DRUM_CLASSES).not.toContain("unknown");
    // 표의 절반 이상은 우리가 주장하지 않는다. 그것이 정직한 상태다.
    const claimed = GM_NUMBERS.filter((gm) => classOf(gm) !== "unknown");
    expect(claimed.length).toBeLessThan(GM_NUMBERS.length);
  });

  it("대표 번호가 자기 어휘로 되돌아온다", () => {
    for (const cls of DRUM_CLASSES) expect(classOf(representative(cls))).toBe(cls);
  });

  it("어휘마다 겹치지 않는 표식이 있다 — 색만으로 구별하지 않는다", () => {
    for (const cls of [...DRUM_CLASSES, "unknown" as const]) {
      expect(CLASS_MARKS[cls]).toMatch(/^\S$/);
    }
    expect(new Set(Object.values(CLASS_MARKS)).size).toBe(Object.keys(CLASS_MARKS).length);
  });
});

describe("pickPeaks", () => {
  const fps = 86;

  it("문턱 아래는 안 잡는다", () => {
    const curve = new Float32Array(100);
    curve[50] = 0.4;
    expect(pickPeaks(curve, fps, 1, 45)).toEqual([]);
  });

  it("불응기보다 촘촘하면 큰 쪽만 남는다", () => {
    const curve = new Float32Array(200);
    curve[50] = 2;
    curve[52] = 3; // 23ms 뒤 — 45ms 불응기 안
    expect(pickPeaks(curve, fps, 1, 45)).toEqual([52]);
  });

  it("불응기를 넘으면 셋 다 남는다 — 80ms 상수였으면 여기서 죽는다", () => {
    // 180BPM 16분 = 83ms. `onsetPeaks`의 80ms는 아슬아슬하게 살지만 조금만
    // 빨라지면 지운다. 그래서 인자로 받는다.
    const gap = Math.round((83 / 1000) * fps);
    const curve = new Float32Array(400);
    curve[100] = 2;
    curve[100 + gap] = 2;
    curve[100 + 2 * gap] = 2;
    expect(pickPeaks(curve, fps, 1, 45)).toHaveLength(3);
  });
});

describe("detectDrums — 섞인 트랙", () => {
  const { truth, solos } = mixedTrack();
  const seconds = truth[truth.length - 1].atSec + 2;
  const result = detectDrums(render(truth, seconds), RATE);
  const s = score(truth, result.hits);

  /**
   * **실측 2026-09-03: F=0.904 (정답 122 · 찾음 106 · 맞춤 103) · 클래스 101/103.**
   *
   * 문턱을 실측값에 딱 맞추지 않는 것은 겸손이 아니라 **여유**다 — 딱 맞춘
   * 문턱은 상수를 조금만 만져도 "나빠졌다"가 아니라 빨간불만 준다.
   *
   * **이 숫자는 실곡 정확도가 아니다.** 드럼 정답을 찍어 둔 곡이 하나도 없다.
   */
  it("타점을 거의 다 찾는다", () => {
    // eslint-disable-next-line no-console
    console.log(
      `[섞인 트랙] 정답 ${s.truth} · 찾음 ${s.found} · 맞춤 ${s.matched} · ` +
        `클래스 ${s.correctClass}/${s.matched} · F=${s.f.toFixed(3)} · ` +
        `채널 ${JSON.stringify(result.peakCounts)} · 기각 ${JSON.stringify(result.rejected)}`,
    );
    expect(s.f).toBeGreaterThan(0.85);
  });

  it("클래스를 거의 다 맞힌다", () => {
    expect(s.correctClass / s.matched).toBeGreaterThan(0.85);
  });

  it("묶음 경계와 fps를 함께 돌려준다 — 진단이 없으면 되짚을 수 없다", () => {
    expect(result.bandsHz).toEqual(BAND_EDGES);
    expect(result.fps).toBeCloseTo(RATE / 256, 3);
    expect(result.hits[0].bands).toHaveLength(BAND_EDGES.length - 1);
  });

  it("시각 오름차순으로 돌려준다", () => {
    for (let i = 1; i < result.hits.length; i += 1) {
      expect(result.hits[i].atSec).toBeGreaterThanOrEqual(result.hits[i - 1].atSec);
    }
  });

  /**
   * **이 시험이 설계의 요점이다.**
   *
   * 합산 ODF 하나에 봉우리마다 클래스 하나를 붙이면 킥과 하이햇이 같은 칸에
   * 있을 때 저역이 이겨서 하이햇이 통째로 사라진다. 채널을 갈라 독립으로 뽑는
   * 이유가 이것뿐이므로, 이 시험이 깨지면 그 설계가 죽은 것이다.
   */
  it("동시타 — 그루브의 정박에서 킥과 하이햇이 둘 다 선다", () => {
    const groove = result.hits.filter((h) => h.atSec < GROOVE_END);
    let both = 0;
    for (let bar = 0; bar < 8; bar += 1) {
      const at = 1 + bar * 2;
      const near = groove.filter((h) => Math.abs(h.atSec - at) < 0.06);
      const hasKick = near.some((h) => h.cls === "kick");
      const hasBright = near.some((h) => h.cls === "hihat" || h.cls === "cymbal");
      if (hasKick && hasBright) both += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`[동시타] 킥+고역이 함께 선 정박 ${both}/8`);
    expect(both).toBeGreaterThanOrEqual(6);
  });

  it("백비트에서 스네어와 하이햇이 함께 산다", () => {
    let both = 0;
    for (let bar = 0; bar < 8; bar += 1) {
      const at = 1.5 + bar * 2;
      const near = result.hits.filter((h) => Math.abs(h.atSec - at) < 0.06);
      if (
        near.some((h) => h.cls === "snare") &&
        near.some((h) => h.cls === "hihat" || h.cls === "hihat-open")
      ) {
        both += 1;
      }
    }
    expect(both).toBeGreaterThanOrEqual(6);
  });

  /**
   * 악기마다 홀로 치는 구간에서 **그 악기가 다수여야 한다.**
   *
   * 개수로 못박지 않는다 — 감쇠 자리에 하나가 더 서는 것은 이 시험이 묻는
   * 것이 아니고, 못박으면 상수를 만질 때마다 빨간불만 켜진다.
   */
  it("악기마다 홀로 치는 구간에서 그 악기가 다수다", () => {
    const lines: string[] = [];
    for (const [cls, [from, to]] of solos) {
      const inRange = result.hits.filter((h) => h.atSec >= from && h.atSec < to);
      const counts = new Map<DrumClass, number>();
      for (const h of inRange) counts.set(h.cls, (counts.get(h.cls) ?? 0) + 1);
      const top = [...counts].sort((a, b) => b[1] - a[1])[0];
      lines.push(`${cls}→${top ? `${top[0]}×${top[1]}` : "없음"}`);
      expect(top, `${cls} 구간에서 아무것도 안 잡혔다`).toBeDefined();
      expect(top?.[0], `${cls} 구간의 다수가 ${top?.[0]}이다`).toBe(cls);
    }
    // eslint-disable-next-line no-console
    console.log(`[홀로] ${lines.join(" · ")}`);
  });
});

describe("detectDrums — 경계", () => {
  it("빈 신호에서 안 터진다", () => {
    const result = detectDrums(new Float32Array(0), RATE);
    expect(result.hits).toEqual([]);
    expect(result.peakCounts).toEqual({ low: 0, mid: 0, high: 0 });
  });

  it("무음에서는 아무것도 안 잡는다", () => {
    expect(detectDrums(new Float32Array(RATE * 2), RATE).hits).toEqual([]);
  });

  it("문턱을 올리면 타점이 준다 — 하니스가 훑을 수 있어야 한다", () => {
    const { truth } = mixedTrack();
    const samples = render(truth, truth[truth.length - 1].atSec + 2);
    const loose = detectDrums(samples, RATE, { minStrength: 0.6 }).hits.length;
    const tight = detectDrums(samples, RATE, { minStrength: 2.5 }).hits.length;
    expect(tight).toBeLessThan(loose);
  });
});
