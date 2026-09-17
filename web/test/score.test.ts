/**
 * 악보 재생 커서의 순수 부분 — **verovio를 부르지 않는다.**
 *
 * jsdom에서는 verovio WASM이 뜨지 않아 다른 테스트가 전부 `ScoreRenderer`를
 * mock한다. 그래서 검증할 수 있는 로직은 전부 순수 함수로 빼 두었고, 여기서
 * 손으로 쓴 타임맵을 넣어 확인한다 — 이 셋이 틀리면 커서가 엉뚱한 음표를
 * 가리키는데, **소리는 멀쩡해서 눈으로 보기 전에는 모른다.**
 */
import { describe, expect, test } from "vitest";

import {
  type TimemapEntry,
  activeIdsAt,
  activeTracks,
  timeMapping,
  timemapMsAt,
} from "../src/core/score";

/** 4분음표 네 개, 500ms씩. verovio가 내는 모양 그대로다 */
const SIMPLE: TimemapEntry[] = [
  { tstamp: 0, on: ["n1"] },
  { tstamp: 500, on: ["n2"], off: ["n1"] },
  { tstamp: 1000, on: ["n3"], off: ["n2"] },
  { tstamp: 1500, on: ["n4"], off: ["n3"] },
  { tstamp: 2000, off: ["n4"] },
];

describe("1. activeTracks — 그때 울리는 것을 미리 쌓는다", () => {
  test("줄마다 그 시점에 울리는 id를 준다", () => {
    const tracks = activeTracks(SIMPLE);
    expect(tracks).toEqual([["n1"], ["n2"], ["n3"], ["n4"], []]);
  });

  test("겹치는 음(화음·붙임줄)도 함께 든다", () => {
    const tracks = activeTracks([
      { tstamp: 0, on: ["a"] },
      { tstamp: 100, on: ["b"] },
      { tstamp: 200, off: ["a"] },
      { tstamp: 300, off: ["b"] },
    ]);
    expect(tracks).toEqual([["a"], ["a", "b"], ["b"], []]);
  });

  test("같은 줄에서 끄고 켜면 끄는 것이 먼저다", () => {
    // verovio는 한 줄에 off와 on을 함께 싣는다. 순서를 뒤집으면 방금 켠 음이
    // 그 줄에서 곧바로 꺼져 커서가 한 칸씩 빈다.
    const tracks = activeTracks([{ tstamp: 0, on: ["x"] }, { tstamp: 10, on: ["x"], off: ["x"] }]);
    expect(tracks[1]).toEqual(["x"]);
  });

  test("빈 타임맵", () => {
    expect(activeTracks([])).toEqual([]);
  });
});

describe("2. activeIdsAt — 이분 탐색", () => {
  const tracks = activeTracks(SIMPLE);
  const at = (ms: number) => activeIdsAt(tracks, SIMPLE, ms);

  test("줄과 줄 사이는 앞 줄이 이긴다", () => {
    expect(at(0)).toEqual(["n1"]);
    expect(at(499)).toEqual(["n1"]);
    expect(at(500)).toEqual(["n2"]);
    expect(at(1499)).toEqual(["n3"]);
  });

  test("첫 줄보다 이르면 아무것도 아니다", () => {
    expect(activeIdsAt(tracks, SIMPLE, -1)).toEqual([]);
  });

  test("마지막 줄을 넘어가면 마지막 상태(= 전부 꺼짐)로 남는다", () => {
    expect(at(9999)).toEqual([]);
  });

  test("빈 타임맵에서도 안 터진다", () => {
    expect(activeIdsAt([], [], 100)).toEqual([]);
  });
});

describe("3. timeMapping — 끝점 둘로 직선을 맞춘다", () => {
  test("축척이 맞으면 항등에 가깝다", () => {
    // 첫 on 0ms ~ 마지막 off 2000ms를 0~2초에 건다
    const m = timeMapping(SIMPLE, 0, 2);
    expect(m.a).toBeCloseTo(1 / 1000, 9);
    expect(m.b).toBeCloseTo(0, 9);
  });

  test("verovio가 템포를 절반으로 읽어도 흡수한다", () => {
    // 같은 곡을 4초로 재생한다면 ms가 두 배로 늘어난 셈이다
    const m = timeMapping(SIMPLE, 0, 4);
    expect(m.a).toBeCloseTo(2 / 1000, 9);
    expect(timemapMsAt(m, 4)).toBeCloseTo(2000, 6);
  });

  test("못갖춘마디로 첫 음표가 0ms가 아니어도 오프셋이 흡수된다", () => {
    // 앞에 쉼표 한 마디(2000ms)가 있는 타임맵
    const withPickup: TimemapEntry[] = [
      { tstamp: 0 },
      { tstamp: 2000, on: ["n1"] },
      { tstamp: 4000, off: ["n1"] },
    ];
    const m = timeMapping(withPickup, 0, 2);
    // 우리 0초 ↔ 타임맵 2000ms, 우리 2초 ↔ 4000ms
    expect(timemapMsAt(m, 0)).toBeCloseTo(2000, 6);
    expect(timemapMsAt(m, 2)).toBeCloseTo(4000, 6);
  });

  test("끝점을 못 찾으면 그대로 두는 직선을 준다 — 재생이 막히지 않는다", () => {
    expect(timeMapping([], 0, 10)).toEqual({ a: 1 / 1000, b: 0 });
    // on만 있고 off가 없다
    expect(timeMapping([{ tstamp: 0, on: ["n"] }], 0, 10)).toEqual({
      a: 1 / 1000,
      b: 0,
    });
  });

  test("길이가 0이면 나눗셈을 피한다", () => {
    // 음표가 하나뿐이고 우리 쪽 길이가 0인 경우. 0으로 나누면 a가 Infinity가 되어
    // 커서 계산 전체가 NaN이 된다.
    expect(timeMapping(SIMPLE, 3, 3)).toEqual({ a: 1 / 1000, b: 0 });
  });

  test("timemapMsAt은 timeMapping의 역이다", () => {
    const m = timeMapping(SIMPLE, 0.25, 2.25);
    for (const sec of [0.25, 1, 2.25]) {
      expect(m.a * timemapMsAt(m, sec) + m.b).toBeCloseTo(sec, 9);
    }
  });
});
