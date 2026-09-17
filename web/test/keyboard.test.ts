/**
 * 자유 연주 건반 배치 — 순수 규칙이라 브라우저도 오디오도 없이 전부 잡힌다.
 *
 * 여기서 못박는 것 둘: **어느 자판이 무슨 음인가**(사용자가 말한 배치 그대로)와
 * **음원 밖으로 나가지 않는가**.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import {
  DEFAULT_BASE,
  KEY_BINDINGS,
  NO_SHIFT,
  SAMPLE_HIGH,
  SAMPLE_LOW,
  SPAN,
  TRANSPOSE_LIMIT,
  baseNote,
  fits,
  layout,
  noteFor,
  octaveBounds,
  rangeKeys,
  transposeBounds,
  withOctave,
  withTranspose,
} from "../src/core/keyboard";
import type { PianoManifest } from "../src/platform/piano";
import { noteName } from "../src/core/theory";

describe("배치", () => {
  test("A S D F G가 도 레 미 파 솔 — 기본값에서 C4부터", () => {
    const notes = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG"].map((code) =>
      noteFor(NO_SHIFT, code),
    );
    expect(notes).toEqual([60, 62, 64, 65, 67]);
    expect(notes.map((n) => noteName(n!))).toEqual(["C4", "D4", "E4", "F4", "G4"]);
  });

  test("W E T Y U가 도♯ 레♯ 파♯ 솔♯ 라♯", () => {
    const notes = ["KeyW", "KeyE", "KeyT", "KeyY", "KeyU"].map(
      (code) => noteFor(NO_SHIFT, code)!,
    );
    expect(notes.map(noteName)).toEqual(["C#4", "D#4", "F#4", "G#4", "A#4"]);
  });

  test("맨 오른쪽 ' 는 F5", () => {
    expect(noteName(noteFor(NO_SHIFT, "Quote")!)).toBe("F5");
    expect(SPAN).toBe(17);
  });

  test("두 줄이 하나의 반음계다 — 0..17이 빠짐없이 한 번씩", () => {
    const offsets = KEY_BINDINGS.map((k) => k.offset).sort((a, b) => a - b);
    expect(offsets).toEqual(Array.from({ length: 18 }, (_, i) => i));
  });

  test("배치에 없는 키는 null — 옥타브 키(Z·X)가 음을 내면 안 된다", () => {
    for (const code of ["KeyZ", "KeyX", "ArrowLeft", "Space", "KeyQ", "KeyR"]) {
      expect(noteFor(NO_SHIFT, code)).toBeNull();
    }
  });

  test("검은건반 표시가 실제 음고류와 맞는다", () => {
    for (const key of layout(NO_SHIFT)) {
      expect(key.black).toBe(noteName(key.midi).includes("#"));
    }
  });

  test("QuizPage의 자판 폴백(A~K = C4~C5)을 그대로 물려받는다", () => {
    const fallback: Record<string, number> = {
      KeyA: 60, KeyW: 61, KeyS: 62, KeyE: 63, KeyD: 64, KeyF: 65, KeyT: 66,
      KeyG: 67, KeyY: 68, KeyH: 69, KeyU: 70, KeyJ: 71, KeyK: 72,
    };
    for (const [code, note] of Object.entries(fallback)) {
      expect(noteFor(NO_SHIFT, code)).toBe(note);
    }
  });
});

describe("옮기기", () => {
  test("옥타브는 12반음, 트랜스포즈는 1반음", () => {
    expect(baseNote(withOctave(NO_SHIFT, 1))).toBe(DEFAULT_BASE + 12);
    expect(baseNote(withOctave(NO_SHIFT, -1))).toBe(DEFAULT_BASE - 12);
    expect(baseNote(withTranspose(NO_SHIFT, 2))).toBe(DEFAULT_BASE + 2);
  });

  test("둘이 함께 걸린다", () => {
    const shift = withTranspose(withOctave(NO_SHIFT, -1), 3);
    expect(baseNote(shift)).toBe(DEFAULT_BASE - 12 + 3);
  });

  test("음원 밖으로는 못 나간다 — 넘겨도 경계에서 멈춘다", () => {
    expect(baseNote(withOctave(NO_SHIFT, -99))).toBeGreaterThanOrEqual(SAMPLE_LOW);
    expect(baseNote(withOctave(NO_SHIFT, 99)) + SPAN).toBeLessThanOrEqual(SAMPLE_HIGH);
    expect(baseNote(withTranspose(NO_SHIFT, 99)) + SPAN).toBeLessThanOrEqual(SAMPLE_HIGH);
  });

  test("어떤 조합으로 옮겨도 18개 건반이 전부 음원 안이다", () => {
    for (let octave = -9; octave <= 9; octave += 1) {
      for (let transpose = -20; transpose <= 20; transpose += 1) {
        const shift = withTranspose(withOctave(NO_SHIFT, octave), transpose);
        expect(fits(baseNote(shift))).toBe(true);
        for (const key of layout(shift)) {
          expect(key.midi).toBeGreaterThanOrEqual(SAMPLE_LOW);
          expect(key.midi).toBeLessThanOrEqual(SAMPLE_HIGH);
        }
      }
    }
  });

  test("트랜스포즈는 옥타브 안에서만 — ±12는 옥타브와 같은 말이다", () => {
    expect(withTranspose(NO_SHIFT, 12).transpose).toBe(TRANSPOSE_LIMIT);
    expect(withTranspose(NO_SHIFT, -12).transpose).toBe(-TRANSPOSE_LIMIT);
  });

  test("경계 값은 실제로 갈 수 있다 (버튼이 잠기는 자리와 같아야 한다)", () => {
    const [low, high] = octaveBounds(0);
    expect(withOctave(NO_SHIFT, low).octave).toBe(low);
    expect(withOctave(NO_SHIFT, high).octave).toBe(high);
    // 그 한 칸 밖은 막힌다
    expect(withOctave(NO_SHIFT, low - 1).octave).toBe(low);
    expect(withOctave(NO_SHIFT, high + 1).octave).toBe(high);
  });

  test("반음 이동이 옥타브 여유를 갉아먹는다", () => {
    // 맨 위 옥타브에서는 위로 더 못 민다
    const [, top] = octaveBounds(0);
    const [, transposeHigh] = transposeBounds(top);
    expect(transposeHigh).toBeLessThan(TRANSPOSE_LIMIT);
    expect(baseNote({ octave: top, transpose: transposeHigh }) + SPAN).toBe(SAMPLE_HIGH);
  });
});

/**
 * **음역 상수가 실제 음원과 맞는가.**
 *
 * `SAMPLE_LOW`·`SAMPLE_HIGH`는 손으로 적은 값이라 `prepare_web_piano.py`가 굽는
 * 매니페스트와 갈릴 수 있다. 갈리면 자유 연주의 양 끝이 조용히 사인 신스로 나거나
 * (좁게 적었으면) 반대로 못 가는 음이 생긴다 — 그 순간 이 시험이 먼저 깨진다.
 */
describe("음역을 정해 그리는 건반 (문항형의 가상 건반)", () => {
  test("양 끝을 포함한다", () => {
    const keys = rangeKeys(60, 72);
    expect(keys).toHaveLength(13);
    expect(keys[0].midi).toBe(60);
    expect(keys.at(-1)!.midi).toBe(72);
  });

  test("검은건반은 **실제 음고류**다 — 여기서는 절대 음높이를 고른다", () => {
    for (const key of rangeKeys(21, 108)) {
      expect(key.black).toBe(noteName(key.midi).includes("#"));
    }
  });

  test("자판이 닿는 음에는 그 글자가 붙는다", () => {
    const keys = rangeKeys(60, 72);
    expect(keys.map((k) => k.label)).toEqual(
      "A W S E D F T G Y H U J K".split(" "),
    );
  });

  test("배치 밖의 음은 글자가 없지만 건반은 그려진다 — 마우스로는 누른다", () => {
    const keys = rangeKeys(48, 59);
    expect(keys).toHaveLength(12);
    expect(keys.every((k) => k.label === "")).toBe(true);
  });

  test("붙는 글자가 noteFor와 어긋나지 않는다", () => {
    for (const key of rangeKeys(48, 84)) {
      if (!key.label) continue;
      expect(noteFor(NO_SHIFT, key.code)).toBe(key.midi);
    }
  });
});

const MANIFEST_PATH = "public/piano/manifest.json";

// **음원은 저장소에 없다**(prepare_web_piano.py가 굽는다). 새 환경에서 이 시험
// 하나 때문에 `npm test`가 빨개지면 안 되므로, 없으면 건너뛴다.
test.skipIf(!existsSync(MANIFEST_PATH))(
  "음역 상수가 피아노 매니페스트의 실제 커버리지와 같다",
  () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as PianoManifest;
    const low = Math.min(...manifest.regions.map((r) => r.lokey));
    const high = Math.max(...manifest.regions.map((r) => r.hikey));
    expect([low, high]).toEqual([SAMPLE_LOW, SAMPLE_HIGH]);
  },
);
