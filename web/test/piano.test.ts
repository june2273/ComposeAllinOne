/**
 * 샘플 피아노 백엔드.
 *
 * 실제 소리는 브라우저에서 듣고 확인한다. 여기서 보는 것은 **어떤 샘플을
 * 골라 몇 반음 미는가**(순수 함수)와 **음원이 없을 때 앱이 죽지 않는가**다.
 */
import { describe, expect, test, vi } from "vitest";

import { NullSynth } from "../src/core/audio";
import {
  type PianoManifest,
  type PianoRegion,
  PianoSynth,
  loadOrder,
  makeAudioBackend,
  pickRegion,
  playbackRateFor,
  semitoneShift,
} from "../src/platform/piano";

/** 원본 SFZ와 같은 모양 — 3반음 간격, 벨로시티 2층(0~80 / 81~127) */
const REGIONS: PianoRegion[] = [
  { file: "C4vL.m4a", lokey: 59, hikey: 61, root: 60, lovel: 0, hivel: 80 },
  { file: "Ds4vL.m4a", lokey: 62, hikey: 64, root: 63, lovel: 0, hivel: 80 },
  { file: "Fs4vL.m4a", lokey: 65, hikey: 67, root: 66, lovel: 0, hivel: 80 },
  { file: "C4vH.m4a", lokey: 59, hikey: 61, root: 60, lovel: 81, hivel: 127 },
  { file: "C7vL.m4a", lokey: 95, hikey: 97, root: 96, lovel: 0, hivel: 80 },
];
const MANIFEST: PianoManifest = { release: 0.6, regions: REGIONS };

describe("샘플 고르기 (sfz.find_region과 같은 규칙)", () => {
  test("음역 안이면 그 region", () => {
    expect(pickRegion(REGIONS, 60, 80)?.file).toBe("C4vL.m4a");
    expect(pickRegion(REGIONS, 66, 80)?.file).toBe("Fs4vL.m4a");
  });

  test("벨로시티 레이어가 80/81에서 갈린다", () => {
    expect(pickRegion(REGIONS, 60, 80)?.file).toBe("C4vL.m4a");
    expect(pickRegion(REGIONS, 60, 81)?.file).toBe("C4vH.m4a");
  });

  test("음역 경계는 포함", () => {
    expect(pickRegion(REGIONS, 59, 40)?.file).toBe("C4vL.m4a");
    expect(pickRegion(REGIONS, 61, 40)?.file).toBe("C4vL.m4a");
  });

  test("덮이지 않은 음은 null (조용히 사인으로 떨어진다)", () => {
    expect(pickRegion(REGIONS, 20, 80)).toBeNull();
    expect(pickRegion(REGIONS, 90, 80)).toBeNull();
  });
});

describe("피치 시프트", () => {
  test("3반음 간격이라 항상 -1~+1 안에 든다", () => {
    for (const note of [59, 60, 61, 62, 63, 64, 65, 66, 67]) {
      const region = pickRegion(REGIONS, note, 80);
      expect(region).not.toBeNull();
      const shift = semitoneShift(region!, note);
      expect(Math.abs(shift)).toBeLessThanOrEqual(1);
    }
  });

  test("루트음은 시프트 0 — 원본 그대로 난다", () => {
    expect(semitoneShift(pickRegion(REGIONS, 60, 80)!, 60)).toBe(0);
    expect(semitoneShift(pickRegion(REGIONS, 63, 80)!, 63)).toBe(0);
  });
});

describe("조율 보정", () => {
  /** −5센트로 녹음된 샘플 */
  const flat: PianoRegion = { ...REGIONS[0], tune: -5 };

  test("tune이 없으면 보정하지 않는다 (녹음 그대로)", () => {
    expect(playbackRateFor(REGIONS[0], 60)).toBeCloseTo(1, 9);
  });

  test("낮게 녹음된 샘플은 그만큼 올려 낸다", () => {
    expect(playbackRateFor(flat, 60)).toBeCloseTo(2 ** (5 / 1200), 9);
  });

  test("높게 녹음된 샘플은 내려 낸다", () => {
    const sharp: PianoRegion = { ...REGIONS[0], tune: 12 };
    expect(playbackRateFor(sharp, 60)).toBeCloseTo(2 ** (-12 / 1200), 9);
  });

  test("반음 이동과 센트 보정이 함께 걸린다", () => {
    // +1반음(100센트) 이동 + 5센트 되올림 = 105센트
    expect(playbackRateFor(flat, 61)).toBeCloseTo(2 ** (105 / 1200), 9);
    expect(playbackRateFor(flat, 59)).toBeCloseTo(2 ** (-95 / 1200), 9);
  });

  test("보정하면 실제 주파수가 평균율에 맞는다", () => {
    const et = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
    // 루트 60이 5센트 낮게 녹음됐다 → 샘플의 실제 음높이
    const recorded = et(60) * 2 ** (-5 / 1200);
    for (const note of [59, 60, 61]) {
      const heard = recorded * playbackRateFor(flat, note);
      const cents = 1200 * Math.log2(heard / et(note));
      expect(Math.abs(cents)).toBeLessThan(0.001);
    }
  });
});

test("로딩은 가운데(C4)에서 바깥으로 퍼진다", () => {
  const order = loadOrder(REGIONS).map((r) => r.root);
  expect(order[0]).toBe(60);
  expect(order.at(-1)).toBe(96);
});

// --- 없거나 덜 받아진 음원 ------------------------------------------------------

/** decodeAudioData·AudioContext가 없는 jsdom에 최소한만 심는다 */
function stubAudio() {
  const played: Array<{ rate: number }> = [];
  /** `stop()`이 예약된 시각 */
  const stops: number[] = [];
  /** 사인 폴백이 만든 오실레이터 주파수 */
  const sine: number[] = [];
  /** 게인 자동화 — `release()`가 실제로 0까지 내리는지 보려면 기록이 필요하다 */
  const ramps: Array<{ value: number; time: number }> = [];
  const gain = () => ({
    connect: (n: unknown) => n,
    gain: {
      value: 0,
      setValueAtTime: () => {},
      cancelScheduledValues: () => {},
      linearRampToValueAtTime: (value: number, time: number) =>
        ramps.push({ value, time }),
    },
  });
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      decodeAudioData() {
        return Promise.resolve({ duration: 3 } as AudioBuffer);
      }
    },
  );
  vi.stubGlobal(
    "AudioContext",
    class {
      currentTime = 0;
      sampleRate = 48_000;
      state = "running";
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createGain = gain;
      /** 사인 폴백이 쓴다. 샘플 재생과 구분하려고 따로 센다. */
      createOscillator() {
        const osc = {
          frequency: { value: 0 },
          connect: (n: unknown) => n,
          start: () => sine.push(osc.frequency.value),
          stop: () => {},
          onended: null,
        };
        return osc;
      }
      createBufferSource() {
        const src = {
          buffer: null as AudioBuffer | null,
          playbackRate: { value: 1 },
          connect: (n: unknown) => n,
          start: () => played.push({ rate: src.playbackRate.value }),
          stop: (t: number) => stops.push(t),
          onended: null,
        };
        return src;
      }
    },
  );
  return { played, stops, sine, ramps };
}

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}
function bytesResponse() {
  return { ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) } as Response;
}

describe("음원이 없거나 덜 받아졌을 때", () => {
  test("매니페스트가 404여도 던지지 않고 사인으로 낸다", async () => {
    const { played, sine } = stubAudio();
    try {
      const piano = new PianoSynth({
        fetch: () => Promise.resolve({ ok: false, status: 404 } as Response),
      });
      await piano.load();
      expect(piano.loaded).toBe(false);
      expect(() => piano.playNotes([60], 1)).not.toThrow();
      expect(played).toHaveLength(0);   // 버퍼 재생 아님
      expect(sine.length).toBeGreaterThan(0); // 사인으로 났다
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("fetch 자체가 실패해도 마찬가지", async () => {
    const { played, sine } = stubAudio();
    try {
      const piano = new PianoSynth({ fetch: () => Promise.reject(new Error("offline")) });
      await piano.load();
      expect(piano.loaded).toBe(false);
      expect(() => piano.playNotes([60], 1)).not.toThrow();
      expect(played).toHaveLength(0);
      expect(sine.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("받아진 음은 샘플로, 루트에서 밀린 만큼 playbackRate가 바뀐다", async () => {
    const { played } = stubAudio();
    try {
      const piano = new PianoSynth({
        fetch: (input) =>
          Promise.resolve(
            String(input).endsWith("manifest.json") ? jsonResponse(MANIFEST) : bytesResponse(),
          ),
      });
      await piano.load();
      expect(piano.loaded).toBe(true);

      piano.playNotes([60], 1); // 루트 그대로
      expect(played.at(-1)!.rate).toBeCloseTo(1, 6);

      piano.playNotes([61], 1); // 루트 +1반음
      expect(played.at(-1)!.rate).toBeCloseTo(2 ** (1 / 12), 6);

      piano.playNotes([62], 1); // Ds4 루트 63에서 -1반음
      expect(played.at(-1)!.rate).toBeCloseTo(2 ** (-1 / 12), 6);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("화음 중 한 음이라도 샘플이 없으면 전부 사인으로 낸다", async () => {
    const { played, sine } = stubAudio();
    try {
      const piano = new PianoSynth({
        fetch: (input) => {
          const url = String(input);
          if (url.endsWith("manifest.json")) return Promise.resolve(jsonResponse(MANIFEST));
          // C7만 못 받은 상황
          if (url.includes("C7vL")) return Promise.resolve({ ok: false, status: 404 } as Response);
          return Promise.resolve(bytesResponse());
        },
      });
      await piano.load();

      piano.playNotes([60, 63], 1);
      expect(played).toHaveLength(2); // 둘 다 샘플

      played.length = 0;
      sine.length = 0;
      piano.playNotes([60, 96], 1); // 96은 C7 — 못 받았다
      expect(played).toHaveLength(0);          // 음색이 섞이지 않고
      expect(sine.length).toBeGreaterThan(0);  // 전부 사인으로 났다
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /**
   * 악보 재생 경로. 자유 연주(`noteOn`)와 갈리는 규칙 하나를 못박는다 —
   * **여기서는 음색을 통일한다.** 곡 중간에 악기가 바뀌면 전사가 틀린 것처럼 들린다.
   */
  describe("playSequence — 악보 재생", () => {
    function fetchAll(input: RequestInfo | URL) {
      return Promise.resolve(
        String(input).endsWith("manifest.json") ? jsonResponse(MANIFEST) : bytesResponse(),
      );
    }

    test("음표마다 자기 샘플을 고른다", async () => {
      const { played } = stubAudio();
      try {
        const piano = new PianoSynth({ fetch: fetchAll });
        await piano.load();
        // 60은 C4vL의 root라 배속 1, 62는 Ds4vL을 한 반음 내려 쓴다.
        // 한 region을 둘 다에 쓰고 있으면 이 둘이 같은 값으로 나온다.
        piano.playSequence([
          { midi: 60, startSec: 0, endSec: 0.5 },
          { midi: 62, startSec: 0.5, endSec: 1 },
        ]);
        expect(played).toHaveLength(2);
        expect(played[0].rate).toBeCloseTo(1, 9);
        expect(played[1].rate).toBeCloseTo(2 ** (-100 / 1200), 9);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    test("한 음이라도 샘플이 없으면 시퀀스 전체가 사인으로 난다", async () => {
      const { played, sine } = stubAudio();
      try {
        const piano = new PianoSynth({
          fetch: (input) => {
            const url = String(input);
            if (url.endsWith("manifest.json")) return Promise.resolve(jsonResponse(MANIFEST));
            if (url.includes("C7vL")) return Promise.resolve({ ok: false, status: 404 } as Response);
            return Promise.resolve(bytesResponse());
          },
        });
        await piano.load();
        piano.playSequence([
          { midi: 60, startSec: 0, endSec: 0.5 },
          { midi: 96, startSec: 1, endSec: 1.5 },
        ]);
        expect(played).toHaveLength(0);
        expect(sine.length).toBeGreaterThan(0);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    test("사인으로 넘어갈 때도 앞 샘플을 끊는다", async () => {
      // **샘플은 배경에서 하나씩 도착하므로 `canPlay`는 곡 중에도 뒤집힌다.**
      // 그 순간 앞 문제의 샘플 음을 안 끊으면 "한 문제가 한 소리" 규칙이
      // 깨진 채 사인과 겹쳐 울린다.
      const { played, stops, sine } = stubAudio();
      try {
        const piano = new PianoSynth({
          fetch: (input) => {
            const url = String(input);
            if (url.endsWith("manifest.json")) return Promise.resolve(jsonResponse(MANIFEST));
            if (url.includes("C7vL")) return Promise.resolve({ ok: false, status: 404 } as Response);
            return Promise.resolve(bytesResponse());
          },
        });
        await piano.load();

        piano.playNotes([60], 2);
        expect(played).toHaveLength(1);
        // 예약된 끝 시각 하나. 아직 아무도 강제로 끄지 않았다
        expect(stops.filter((t) => t === undefined)).toHaveLength(0);

        // 샘플이 없는 음 → 사인으로 떨어진다
        piano.playNotes([96], 2);
        expect(sine.length).toBeGreaterThan(0);
        // 인자 없는 stop() = 지금 끊어라. 앞의 샘플 노드가 실제로 받았다
        expect(stops.filter((t) => t === undefined)).toHaveLength(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    test("사인으로 넘겨도 손잡이는 살아 있다", async () => {
      stubAudio();
      try {
        // 매니페스트가 없으니 통째로 폴백이다
        const piano = new PianoSynth({
          fetch: () => Promise.resolve({ ok: false, status: 404 } as Response),
        });
        await piano.load();
        const handle = piano.playSequence([{ midi: 60, startSec: 0, endSec: 1 }]);
        expect(handle.positionSec()).not.toBeNull();
        // 피아노를 멈추면 폴백도 함께 멈춘다 — 손잡이가 그것을 안다
        piano.stop();
        expect(handle.positionSec()).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  /**
   * 자유 연주 경로. **`playNotes`와 정면으로 다른 규칙 하나**를 여기서 못박는다 —
   * 새 음이 앞의 음을 끊으면 화음이 나지 않는다.
   */
  describe("noteOn — 누르고 있는 동안", () => {
    function loaded() {
      return new PianoSynth({
        fetch: (input) =>
          Promise.resolve(
            String(input).endsWith("manifest.json") ? jsonResponse(MANIFEST) : bytesResponse(),
          ),
      });
    }

    test("앞의 음을 끊지 않는다 — 화음이 난다", async () => {
      const { played, stops } = stubAudio();
      try {
        const piano = loaded();
        await piano.load();
        piano.noteOn(60);
        piano.noteOn(64);
        piano.noteOn(67);
        expect(played).toHaveLength(3);
        // 아무것도 끝나지 않았다. playNotes였다면 앞의 둘이 여기서 죽는다.
        expect(stops).toHaveLength(0);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    test("release가 게인을 0까지 내리고 소스를 끝낸다", async () => {
      const { stops, ramps } = stubAudio();
      try {
        const piano = loaded();
        await piano.load();
        const note = piano.noteOn(60);
        expect(ramps).toHaveLength(0);
        note.release();
        expect(ramps.at(-1)!.value).toBe(0);
        // 매니페스트의 release(0.6초)만큼 여운을 준 뒤 끝난다
        expect(ramps.at(-1)!.time).toBeCloseTo(MANIFEST.release, 6);
        expect(stops).toHaveLength(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    test("두 번 떼도 한 번만 처리한다 — 자판·마우스·MIDI가 같은 음을 잡는다", async () => {
      const { stops } = stubAudio();
      try {
        const piano = loaded();
        await piano.load();
        const note = piano.noteOn(60);
        note.release();
        note.release();
        expect(stops).toHaveLength(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    test("음원이 없는 음은 **그 음만** 사인으로 난다", async () => {
      const { played, sine } = stubAudio();
      try {
        const piano = loaded();
        await piano.load();
        piano.noteOn(60); // 샘플 있음
        piano.noteOn(20); // 어느 region에도 없다
        expect(played).toHaveLength(1);
        expect(sine.length).toBeGreaterThan(0);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  // 사인 신스를 주면 안 된다 — 그쪽도 AudioContext를 만들기 때문에 첫 재생에서
  // 터진다. 조용히 나는 것과 예외를 던지는 것은 다르다.
  test("오디오가 아예 없는 환경에서는 소리 없는 백엔드를 준다", () => {
    const backend = makeAudioBackend();
    expect(backend).toBeInstanceOf(NullSynth);
    expect(() => backend.playNotes([60], 1)).not.toThrow();
  });
});
