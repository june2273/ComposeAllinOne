/**
 * 구간 반복 재생기(`platform/clip.ts`).
 *
 * 소리 자체는 브라우저에서 귀로 확인한다. 여기서 보는 것은 **손잡이가 언제
 * 어디를 가리키는가**다 — 커서가 소리보다 앞서 가면 루프 경계를 눈으로
 * 확인할 수 없게 되는데, 그건 드럼 판정을 귀로 확정하는 경로 전체를 갉는다.
 */
import { describe, expect, test } from "vitest";

import { makeClipPlayer } from "../src/platform/clip";

/** 시간을 손으로 미는 가짜 컨텍스트 */
function fakeContext() {
  const started: number[] = [];
  const ctx = {
    currentTime: 0,
    state: "running",
    destination: {},
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
    decodeAudioData: () =>
      Promise.resolve({
        duration: 10,
        sampleRate: 48_000,
        numberOfChannels: 1,
      } as AudioBuffer),
    createBufferSource: () => ({
      buffer: null as AudioBuffer | null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      connect: (n: unknown) => n,
      disconnect: () => {},
      start: (_when: number, offset: number) => started.push(offset),
      stop: () => {},
    }),
  };
  return { ctx, started };
}

/** `startRendering`을 우리가 원할 때 끝낸다 */
function fakeOffline() {
  let finish: ((buffer: AudioBuffer) => void) | null = null;
  const make = () => ({
    destination: {},
    createBufferSource: () => ({
      buffer: null,
      connect: (n: unknown) => n,
      start: () => {},
    }),
    createOscillator: () => ({
      frequency: { value: 0 },
      connect: (n: unknown) => n,
      start: () => {},
      stop: () => {},
    }),
    createGain: () => ({
      connect: (n: unknown) => n,
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
    }),
    startRendering: () =>
      new Promise<AudioBuffer>((resolve) => {
        finish = resolve;
      }),
  });
  return {
    make: make as unknown as ClipOffline,
    done: (buffer: AudioBuffer) => finish?.(buffer),
  };
}

type ClipOffline = (
  channels: number,
  length: number,
  rate: number,
) => OfflineAudioContext;

async function loaded(env: Parameters<typeof makeClipPlayer>[0]) {
  const player = makeClipPlayer({
    ...env,
    fetch: () =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) } as Response),
  });
  await player.load("drums.wav");
  return player;
}

describe("구간 반복", () => {
  test("시간이 흐르면 구간 안에서 감긴다", async () => {
    const { ctx, started } = fakeContext();
    const player = await loaded({ context: () => ctx as unknown as AudioContext });

    const clip = player.loop(2, 4);
    expect(started).toEqual([2]);
    expect(clip.positionSec()).toBeCloseTo(2, 6);

    ctx.currentTime = 1.5;
    expect(clip.positionSec()).toBeCloseTo(3.5, 6);
    // 구간이 2초이므로 2.5초 뒤는 다시 머리에서 0.5초 지난 자리다
    ctx.currentTime = 2.5;
    expect(clip.positionSec()).toBeCloseTo(2.5, 6);
  });

  test("클릭을 섞는 동안에는 위치가 앞서 나가지 않는다", async () => {
    // **소리는 렌더가 끝나야 시작한다.** 부른 시각으로 위치를 재면 아무것도
    // 안 울리는 동안 커서가 흐르고, 그 뒤로도 렌더 시간만큼 계속 앞선다.
    const { ctx, started } = fakeContext();
    const offline = fakeOffline();
    const player = await loaded({
      context: () => ctx as unknown as AudioContext,
      offline: offline.make,
    });

    const clip = player.loop(2, 4, [2, 3]);
    ctx.currentTime = 0.3; // 렌더가 도는 동안 시간이 흘렀다
    expect(started).toEqual([]);
    expect(clip.positionSec()).toBeCloseTo(2, 6);

    offline.done({ duration: 2, sampleRate: 48_000, numberOfChannels: 1 } as AudioBuffer);
    // `render()`가 async라 마이크로태스크를 두 번 지나야 `begin()`에 닿는다
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(started).toEqual([0]); // 렌더된 버퍼는 구간 머리가 0이다

    ctx.currentTime = 0.8; // 시작하고 0.5초
    expect(clip.positionSec()).toBeCloseTo(2.5, 6);
  });

  test("새로 틀면 옛 손잡이는 멈춘 것으로 답한다", async () => {
    const { ctx } = fakeContext();
    const player = await loaded({ context: () => ctx as unknown as AudioContext });

    const first = player.loop(0, 2);
    const second = player.loop(4, 6);
    expect(first.positionSec()).toBeNull();
    expect(second.positionSec()).toBeCloseTo(4, 6);

    player.stop();
    expect(second.positionSec()).toBeNull();
  });
});
