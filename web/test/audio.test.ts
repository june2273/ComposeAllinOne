/** 오디오 백엔드 — 브라우저 없이 검증할 수 있는 부분. */
import { describe, expect, test, vi } from "vitest";

import { NullSynth, midiToFreq } from "../src/core/audio";
import { SineSynth } from "../src/platform/synth";

describe("주파수", () => {
  test("A4 = 440Hz, C4 ≈ 261.63Hz", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(60)).toBeCloseTo(261.6255653, 6);
  });
  test("한 옥타브 = 정확히 2배", () => {
    expect(midiToFreq(72) / midiToFreq(60)).toBeCloseTo(2, 12);
  });
});

describe("SineSynth", () => {
  /** 최소한의 AudioContext 대역. 어떤 노드를 언제 걸었는지만 본다. */
  function fakeContext() {
    const started: Array<{ freq: number; start: number; stop: number }> = [];
    const gains: Array<{ value: number; time: number }> = [];
    /** 게인 노드별 자동화 이벤트. 배음마다 포락선이 다른지 보려면 필요하다 */
    const envelopes: Array<Array<{ value: number; time: number }>> = [];
    const node = () => {
      const own: Array<{ value: number; time: number }> = [];
      envelopes.push(own);
      return { connect: (n: unknown) => n, gain: param(own) };
    };
    function param(own: Array<{ value: number; time: number }>) {
      const record = (v: number, t: number) => {
        gains.push({ value: v, time: t });
        own.push({ value: v, time: t });
      };
      return {
        value: 0,
        setValueAtTime: record,
        linearRampToValueAtTime: record,
      };
    }
    const ctx = {
      currentTime: 0,
      sampleRate: 48_000,
      state: "running",
      destination: {},
      resume: () => Promise.resolve(),
      createGain: node,
      createOscillator: () => {
        // start()에서 기록한다. stop()은 synth.stop()이 한 번 더 부를 수
        // 있어(이미 끝난 노드 정리) 계수 기준으로 삼으면 두 번 세어진다.
        const osc = {
          frequency: { value: 0 },
          connect: (n: unknown) => n,
          start(t: number) {
            started.push({ freq: osc.frequency.value, start: t, stop: 0 });
          },
          stop() {},
          onended: null as null | (() => void),
        };
        return osc;
      },
    };
    return { ctx, started, gains, envelopes };
  }

  function withContext<T>(fn: () => T) {
    const { ctx, started, gains, envelopes } = fakeContext();
    vi.stubGlobal("AudioContext", function () {
      return ctx;
    });
    try {
      return { result: fn(), started, gains, envelopes };
    } finally {
      vi.unstubAllGlobals();
    }
  }

  test("배음 개수만큼 오실레이터를 만들고 나이퀴스트를 넘지 않는다", () => {
    const { started } = withContext(() => {
      const s = new SineSynth();
      s.playNotes([60], 2);
    });
    // C4 261.6Hz × 4배음 = 1046Hz — 48kHz에서 전부 통과
    expect(started).toHaveLength(4);
    const freqs = started.map((o) => Math.round(o.freq));
    expect(freqs).toEqual([262, 523, 785, 1047]);
  });

  test("아주 높은 음은 나이퀴스트를 넘는 배음을 만들지 않는다", () => {
    const { started } = withContext(() => {
      const s = new SineSynth();
      s.playNotes([120], 1); // 8372Hz — 3배음이 25kHz로 나이퀴스트(24k) 초과
    });
    expect(started).toHaveLength(2);
  });

  test("빈 배열이면 아무것도 하지 않는다", () => {
    const { started } = withContext(() => {
      const s = new SineSynth();
      s.playNotes([], 2);
    });
    expect(started).toHaveLength(0);
  });

  test("아르페지오는 음마다 시작 시각을 벌린다", () => {
    const { started } = withContext(() => {
      const s = new SineSynth();
      s.playNotes([60, 64, 67], 1, "arpeggio_up");
    });
    const starts = [...new Set(started.map((o) => Number(o.start.toFixed(3))))].sort(
      (a, b) => a - b,
    );
    expect(starts).toEqual([0, 0.18, 0.36]);
  });

  test("블록(동시)은 모두 같은 시각에 시작한다", () => {
    const { started } = withContext(() => {
      const s = new SineSynth();
      s.playNotes([60, 64, 67], 1, "block");
    });
    expect(new Set(started.map((o) => o.start)).size).toBe(1);
  });

  test("화음일수록 음당 레벨을 낮춰 클리핑을 피한다", () => {
    const one = withContext(() => {
      const s = new SineSynth();
      s.playNotes([60], 1);
    });
    const three = withContext(() => {
      const s = new SineSynth();
      s.playNotes([60, 64, 67], 1);
    });
    const peak = (g: { value: number }[]) => Math.max(...g.map((x) => x.value));
    expect(peak(three.gains)).toBeLessThan(peak(one.gains));
  });

  /**
   * 한 음이 화음처럼 들리던 문제(실측 2026-08-03).
   *
   * 1·2·4배음은 기본음과 같은 음이름(옥타브)이지만 **3배음은 12도 위, 즉 다른
   * 음이름**이다. 3배음이 크고 끝까지 울리면 귀가 그것을 별개의 음으로 듣는다.
   */
  describe("한 음은 한 음으로 들려야 한다", () => {
    /** 배음별 포락선을 (최고 레벨, 소리가 끝나는 시각)으로 요약한다 */
    function partials(duration: number) {
      const { envelopes } = withContext(() => {
        const s = new SineSynth();
        s.playNotes([60], duration);
      });
      return envelopes
        .filter((e) => e.length > 0)
        .map((e) => ({
          peak: Math.max(...e.map((x) => x.value)),
          ends: Math.max(...e.map((x) => x.time)),
        }));
    }

    test("3배음(다른 음이름)은 기본음의 10% 아래다", () => {
      const [fundamental, , third] = partials(2);
      expect(third.peak / fundamental.peak).toBeLessThan(0.1);
    });

    test("위 배음일수록 먼저 사라진다", () => {
      const ends = partials(2).map((p) => p.ends);
      for (let h = 1; h < ends.length; h += 1) {
        expect(ends[h]).toBeLessThan(ends[h - 1]);
      }
      // 기본음만 문제에서 정한 길이를 끝까지 채운다
      expect(ends[0]).toBeCloseTo(2, 3);
    });

    test("짧은 음에서도 포락선 시각이 뒤집히지 않는다", () => {
      // 자동화 이벤트가 시간 역순이면 브라우저가 예외를 던진다
      for (const duration of [0.1, 0.25, 0.5, 2]) {
        const { envelopes } = withContext(() => {
          const s = new SineSynth();
          s.playNotes([60], duration);
        });
        for (const env of envelopes.filter((e) => e.length > 0)) {
          const times = env.map((e) => e.time);
          expect([...times].sort((a, b) => a - b)).toEqual(times);
        }
      }
    });
  });
});

describe("NullSynth", () => {
  test("오디오 장치를 건드리지 않는다", () => {
    vi.stubGlobal("AudioContext", () => {
      throw new Error("만들면 안 된다");
    });
    const s = new NullSynth();
    expect(() => {
      s.playNotes([60], 1);
      s.stop();
    }).not.toThrow();
    vi.unstubAllGlobals();
  });
});
