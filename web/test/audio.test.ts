/** 오디오 백엔드 — 브라우저 없이 검증할 수 있는 부분. */
import { describe, expect, test, vi } from "vitest";

import { NullSynth, midiToFreq } from "../src/core/audio";
import {
  HARMONICS,
  SEQUENCE_LOOKAHEAD,
  SineSynth,
} from "../src/platform/synth";

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
    /** 끝 시각이 예약된 것들. noteOn은 release 전까지 하나도 없어야 한다 */
    const stops: number[] = [];
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
        // `rampDown`이 예약된 자동화를 먼저 지운다. 없으면 release가 던진다.
        cancelScheduledValues: () => {},
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
          stop(t?: number) {
            if (t !== undefined) stops.push(t);
          },
          onended: null as null | (() => void),
        };
        return osc;
      },
    };
    return { ctx, started, gains, envelopes, stops };
  }

  function withContext<T>(fn: () => T) {
    const { ctx, started, gains, envelopes, stops } = fakeContext();
    vi.stubGlobal("AudioContext", function () {
      return ctx;
    });
    try {
      // ctx를 함께 돌려준다 — 시퀀스 테스트가 `currentTime`을 밀어야 한다
      return { result: fn(), ctx, started, gains, envelopes, stops };
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

  /**
   * 자유 연주 경로. `playNotes`가 맨 앞에서 `stop()`을 부르는 것과 달리
   * **여기서는 앞의 음이 살아 있어야 한다.**
   */
  describe("noteOn — 누르고 있는 동안", () => {
    test("앞의 음을 끊지 않고 쌓인다", () => {
      const { started, stops } = withContext(() => {
        const s = new SineSynth();
        s.noteOn(60);
        s.noteOn(64);
      });
      expect(started).toHaveLength(HARMONICS.length * 2);
      // 뗄 때까지 끝이 예약되지 않는다 — 그래서 무한히 울릴 수 있다
      expect(stops).toHaveLength(0);
    });

    test("release가 배음 전부를 0까지 내리고 끝을 예약한다", () => {
      const { envelopes, stops } = withContext(() => {
        const s = new SineSynth();
        s.noteOn(60).release();
      });
      expect(stops).toHaveLength(HARMONICS.length);
      for (const events of envelopes) {
        expect(events.at(-1)!.value).toBe(0);
      }
    });

    test("두 번 떼도 한 번만 처리한다", () => {
      const { stops } = withContext(() => {
        const s = new SineSynth();
        const note = s.noteOn(60);
        note.release();
        note.release();
      });
      expect(stops).toHaveLength(HARMONICS.length);
    });

    test("나이퀴스트를 넘는 배음은 여기서도 만들지 않는다", () => {
      const { started } = withContext(() => {
        const s = new SineSynth();
        s.noteOn(120); // 8372Hz — 3배음이 나이퀴스트(24k)를 넘는다
      });
      expect(started.every((o) => o.freq < 24_000)).toBe(true);
      expect(started.length).toBeLessThan(HARMONICS.length);
    });
  });

  /**
   * 악보 재생. `playNotes`와 갈리는 것은 **음표마다 시각과 길이가 다르다**는
   * 것뿐이므로, 여기서는 그 시각이 맞게 잡히는지만 본다(음색은 위 테스트들이 본다).
   */
  describe("playSequence", () => {
    /** 배음 넷 중 기본음만 골라 음표 단위로 본다 */
    const fundamentals = (
      started: Array<{ freq: number; start: number }>,
      notes: readonly number[],
    ) =>
      started.filter((o) =>
        notes.some((n) => Math.abs(o.freq - midiToFreq(n)) < 0.01),
      );

    test("음표마다 시작 시각이 다르다 — 룩어헤드만큼 밀려서", () => {
      const { started } = withContext(() => {
        const s = new SineSynth();
        s.playSequence([
          { midi: 60, startSec: 0, endSec: 0.5 },
          { midi: 62, startSec: 1, endSec: 1.5 },
        ]);
      });
      const heads = fundamentals(started, [60, 62]);
      expect(heads).toHaveLength(2);
      expect(heads[0].start).toBeCloseTo(SEQUENCE_LOOKAHEAD, 9);
      expect(heads[1].start).toBeCloseTo(SEQUENCE_LOOKAHEAD + 1, 9);
    });

    test("음표마다 길이가 다르다 — playNotes의 스칼라 duration과 갈리는 자리다", () => {
      const { envelopes } = withContext(() => {
        const s = new SineSynth();
        s.playSequence([
          { midi: 60, startSec: 0, endSec: 0.25 },
          { midi: 60, startSec: 1, endSec: 3 },
        ]);
      });
      // 게인 노드는 음표마다 배음 수(4)만큼 생긴다. 각 음표의 기본음이 0번과 4번.
      const last = (i: number) => envelopes[i].at(-1)!.time;
      expect(last(0)).toBeCloseTo(SEQUENCE_LOOKAHEAD + 0.25, 6);
      expect(last(4)).toBeCloseTo(SEQUENCE_LOOKAHEAD + 3, 6);
    });

    test("fromSec 이전에 끝나는 음표는 건너뛰고, 걸쳐 있는 것은 남긴다", () => {
      const { started } = withContext(() => {
        const s = new SineSynth();
        s.playSequence(
          [
            // 완전히 지나갔다
            { midi: 60, startSec: 0, endSec: 1 },
            // 재생 지점에 걸쳐 있다 — 시작만 보고 거르면 이게 사라진다
            { midi: 62, startSec: 1.5, endSec: 3 },
            { midi: 64, startSec: 3, endSec: 4 },
          ],
          2,
        );
      });
      expect(fundamentals(started, [60])).toHaveLength(0);
      const kept = fundamentals(started, [62, 64]);
      expect(kept).toHaveLength(2);
      // 걸쳐 있는 음표는 재생 지점(=룩어헤드)에서 바로 시작한다
      expect(kept[0].start).toBeCloseTo(SEQUENCE_LOOKAHEAD, 9);
      expect(kept[1].start).toBeCloseTo(SEQUENCE_LOOKAHEAD + 1, 9);
    });

    test("빈 배열이면 아무것도 예약하지 않고 조용한 손잡이를 준다", () => {
      const { result, started } = withContext(() => {
        const s = new SineSynth();
        return s.playSequence([]);
      });
      expect(started).toHaveLength(0);
      expect(result.positionSec()).toBeNull();
    });

    test("위치는 AudioContext 시계를 따른다", () => {
      const { result, ctx } = withContext(() => {
        const s = new SineSynth();
        return s.playSequence([{ midi: 60, startSec: 0, endSec: 5 }]);
      });
      // 룩어헤드 동안에는 아직 시작 전이다 — 음수 대신 0에서 잡아 둔다
      expect(result.positionSec()).toBe(0);
      ctx.currentTime = SEQUENCE_LOOKAHEAD + 1.25;
      expect(result.positionSec()).toBeCloseTo(1.25, 9);
    });

    test("fromSec에서 시작하면 위치도 거기서부터 센다", () => {
      const { result, ctx } = withContext(() => {
        const s = new SineSynth();
        return s.playSequence([{ midi: 60, startSec: 0, endSec: 10 }], 4);
      });
      expect(result.positionSec()).toBe(4);
      ctx.currentTime = SEQUENCE_LOOKAHEAD + 1;
      expect(result.positionSec()).toBeCloseTo(5, 9);
    });

    test("멈추면 위치가 null이 된다", () => {
      const { result } = withContext(() => {
        const s = new SineSynth();
        return s.playSequence([{ midi: 60, startSec: 0, endSec: 5 }]);
      });
      result.stop();
      expect(result.positionSec()).toBeNull();
      // 두 번 불러도 안전하다
      expect(() => result.stop()).not.toThrow();
    });

    /**
     * 손잡이가 백엔드의 상태를 함께 본다는 것을 못박는다. 손잡이 안에만
     * 두면 소리는 끊겼는데 커서만 혼자 흘러간다.
     */
    test("다음 재생이 앞의 손잡이를 무효로 만든다", () => {
      const { result } = withContext(() => {
        const s = new SineSynth();
        const first = s.playSequence([{ midi: 60, startSec: 0, endSec: 5 }]);
        s.playSequence([{ midi: 67, startSec: 0, endSec: 5 }]);
        return first;
      });
      expect(result.positionSec()).toBeNull();
    });

    test("백엔드를 직접 멈춰도 손잡이가 안다", () => {
      const { result } = withContext(() => {
        const s = new SineSynth();
        const handle = s.playSequence([{ midi: 60, startSec: 0, endSec: 5 }]);
        s.stop();
        return handle;
      });
      expect(result.positionSec()).toBeNull();
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
      s.playSequence([{ midi: 60, startSec: 0, endSec: 1 }]);
      s.stop();
    }).not.toThrow();
    // 조용한 손잡이는 위치를 모른다 — 화면이 커서를 그리지 않는다
    expect(s.playSequence([]).positionSec()).toBeNull();
    vi.unstubAllGlobals();
  });
});
