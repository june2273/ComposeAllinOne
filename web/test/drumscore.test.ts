/**
 * 타악 악보 — **마디 안 음가 합이 박자와 맞는가.**
 *
 * `transcribe.test.ts`가 멜로디 악보에 대해 지키는 그 불변식이다. 어긋나면
 * verovio가 **그 마디부터 조용히 밀리고**, 오류가 안 나므로 눈으로 보기 전에는
 * 모른다.
 *
 * 진짜 렌더는 여기서 못 한다(jsdom에 verovio WASM이 없다). 그려지는지는
 * 브라우저 스파이크로 확인했고 그 결과가 `notation.ts` 앞머리에 있다.
 */

import { describe, expect, it } from "vitest";

import {
  analyzePattern,
  representative,
  toDrumMusicXml,
  type DrumClass,
  type DrumHit,
} from "../src/core/drums";
import { buildGrid } from "../src/core/transcribe/quantize";

const BEAT = 0.5;
const BEATS_PER_BAR = 4;
const STEPS_PER_BEAT = 4;
const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT;
const STEP = BEAT / STEPS_PER_BEAT;

function grid(bars: number) {
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let b = 0; b < bars * BEATS_PER_BAR + 1; b += 1) {
    beats.push(b * BEAT);
    if (b % BEATS_PER_BAR === 0) downbeats.push(b * BEAT);
  }
  return buildGrid({ beats, downbeats, beatsPerBar: BEATS_PER_BAR, stepsPerBeat: STEPS_PER_BEAT });
}

function hit(bar: number, step: number, cls: DrumClass): DrumHit {
  return {
    atSec: ((bar - 1) * STEPS_PER_BAR + step) * STEP,
    cls,
    gm: representative(cls),
    velocity: 100,
    confidence: 1,
    bands: [],
  };
}

function score(hits: DrumHit[], bars: number): string {
  const analysis = analyzePattern(
    hits.toSorted((a, b) => a.atSec - b.atSec),
    grid(bars),
  );
  return toDrumMusicXml(analysis.bars, {
    bpm: 120,
    beatsPerBar: BEATS_PER_BAR,
    stepsPerBeat: STEPS_PER_BEAT,
  });
}

/** 마디별 `<duration>` 합. `<chord/>`가 붙은 음표는 시간을 소비하지 않는다 */
function durations(xml: string): number[] {
  return [...xml.matchAll(/<measure[^>]*>(.*?)<\/measure>/gs)].map(([, body]) => {
    let sum = 0;
    for (const [, note] of body.matchAll(/<note>(.*?)<\/note>/gs)) {
      if (note.includes("<chord/>")) continue;
      sum += Number(/<duration>(\d+)<\/duration>/.exec(note)?.[1] ?? 0);
    }
    return sum;
  });
}

describe("타악 악보", () => {
  it("모든 마디의 음가 합이 박자와 맞는다 — 8분 그루브", () => {
    const hits: DrumHit[] = [];
    for (let bar = 1; bar <= 4; bar += 1) {
      hits.push(hit(bar, 0, "kick"), hit(bar, 8, "kick"));
      hits.push(hit(bar, 4, "snare"), hit(bar, 12, "snare"));
      for (let s = 0; s < STEPS_PER_BAR; s += 2) hits.push(hit(bar, s, "hihat"));
    }
    const xml = score(hits, 4);
    // divisions = stepsPerBeat = 4 → 한 마디 = 16
    for (const sum of durations(xml)) expect(sum).toBe(STEPS_PER_BAR);
  });

  it("16분이 섞여도 합이 맞는다", () => {
    const hits: DrumHit[] = [];
    for (let bar = 1; bar <= 2; bar += 1) {
      hits.push(hit(bar, 0, "kick"), hit(bar, 7, "kick"), hit(bar, 11, "kick"));
      hits.push(hit(bar, 4, "snare"), hit(bar, 12, "snare"));
      for (let s = 0; s < STEPS_PER_BAR; s += 2) hits.push(hit(bar, s, "hihat"));
    }
    for (const sum of durations(score(hits, 2))) expect(sum).toBe(STEPS_PER_BAR);
  });

  it("빈 마디도 합이 맞는다 — 쉼표로 채운다", () => {
    const hits = [hit(1, 0, "kick"), hit(3, 0, "kick")];
    for (const sum of durations(score(hits, 3))) expect(sum).toBe(STEPS_PER_BAR);
  });

  it("동시타가 화음으로 나간다 — 두 번째부터 <chord/>", () => {
    const xml = score([hit(1, 0, "kick"), hit(1, 0, "hihat")], 1);
    const notes = [...xml.matchAll(/<note>(.*?)<\/note>/gs)].map(([, n]) => n);
    const withChord = notes.filter((n) => n.includes("<chord/>"));
    expect(withChord).toHaveLength(1);
  });

  it("타악 음자리표와 x머리표를 낸다 — 스파이크로 확인한 그 모양", () => {
    const xml = score([hit(1, 0, "hihat"), hit(1, 4, "snare")], 1);
    expect(xml).toContain("<sign>percussion</sign>");
    expect(xml).toContain("<notehead>x</notehead>");
    // 하이햇은 G5, 스네어는 C5 — `gm.ts`의 자리표 그대로
    expect(xml).toContain("<display-step>G</display-step><display-octave>5</display-octave>");
    expect(xml).toContain("<display-step>C</display-step><display-octave>5</display-octave>");
  });

  it("템포를 반드시 적는다 — 없으면 읽는 쪽이 120으로 연다", () => {
    const xml = score([hit(1, 0, "kick")], 1);
    expect(xml).toContain("<per-minute>120</per-minute>");
    expect(xml).toContain('<sound tempo="120"/>');
  });

  it("못갖춘마디는 0마디로 나간다", () => {
    const pickup: DrumHit = { ...hit(1, 0, "snare"), atSec: -STEP * 2 };
    const xml = score([pickup, hit(1, 0, "kick")], 2);
    expect(xml).toContain('<measure number="0">');
  });
});

/**
 * **verovio가 오류 없이 음표를 흘리는 두 자리.**
 *
 * 둘 다 실측으로 걸렸고(2026-09-04) 둘 다 `loadData`가 1을 돌려주고 로그도
 * 비어 있었다 — 브라우저에서 그려 보기 전에는 몰랐다. XML을 눈으로 봐도 안
 * 보이는 부류라 여기서 문자열로 못박는다.
 */
describe("verovio가 흘리는 자리", () => {
  /** 8분 하이햇을 16분 격자에 얹으면 박의 마지막 칸이 쉼표라 빔이 안 닫힌다 */
  it("빔은 열리면 반드시 닫힌다", () => {
    const hits: DrumHit[] = [];
    for (let bar = 1; bar <= 2; bar += 1) {
      // 16분 하나(킥 7)가 있어 해상도가 16분이 되고, 하이햇은 8분이다
      hits.push(hit(bar, 7, "kick"));
      for (let s = 0; s < STEPS_PER_BAR; s += 2) hits.push(hit(bar, s, "hihat"));
    }
    const xml = score(hits, 2);
    for (const [, body] of xml.matchAll(/<measure[^>]*>(.*?)<\/measure>/gs)) {
      let open = 0;
      for (const [, where] of body.matchAll(/<beam number="1">(\w+)<\/beam>/g)) {
        if (where === "begin") open += 1;
        else if (where === "end") open -= 1;
        expect(open, "continue·end가 begin보다 먼저 나왔다").toBeGreaterThanOrEqual(0);
      }
      expect(open, "빔이 열린 채 마디가 끝났다").toBe(0);
    }
  });

  /** 화음 구성음에 빔을 붙이면 그 마디의 나머지가 통째로 사라진다 */
  it("화음 구성음에는 빔을 안 붙인다", () => {
    const hits: DrumHit[] = [];
    for (let s = 0; s < STEPS_PER_BAR; s += 2) hits.push(hit(1, s, "hihat"));
    hits.push(hit(1, 0, "kick"), hit(1, 7, "snare"));
    const xml = score(hits, 1);
    for (const [, note] of xml.matchAll(/<note>(.*?)<\/note>/gs)) {
      if (!note.includes("<chord/>")) continue;
      expect(note).not.toContain("<beam");
    }
  });

  /** `<chord/>`는 `<note>`의 첫 자식이어야 한다 */
  it("chord가 note의 첫 자식이다", () => {
    const xml = score([hit(1, 0, "kick"), hit(1, 0, "hihat"), hit(1, 0, "cymbal")], 1);
    for (const [, note] of xml.matchAll(/<note>(.*?)<\/note>/gs)) {
      if (note.includes("<chord/>")) expect(note.startsWith("<chord/>")).toBe(true);
    }
  });
});
