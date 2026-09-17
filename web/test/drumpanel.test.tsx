/**
 * 드럼 칸 — **소리 없이, 오디오 없이 검증한다.**
 *
 * 검출기는 가짜로 갈아끼우고(`detect`) 재생기도 갈아끼운다(`clip`). 여기서
 * 보는 것은 **결선**뿐이다 — 그리드가 옳은 칸을 칠하는가, 구간을 바꾸면
 * 소리가 먼저 멎는가, 화면을 떠날 때 소리가 남지 않는가.
 *
 * 검출 정확도는 `drums.test.ts`(합성 신호)와 `scripts/eval/drums.eval.ts`(실곡)의
 * 일이다. 섞으면 "화면이 틀렸다"와 "귀가 틀렸다"를 구별할 수 없다.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalysisReport } from "../src/core/analysis";
import type { DrumClass, DrumDetection, DrumHit } from "../src/core/drums";
import type { Clip, ClipPlayer } from "../src/platform/clip";
import { DrumPanel } from "../src/ui/drums";

const BPM = 120;
const BEAT = 0.5;
const BEATS_PER_BAR = 4;
const STEPS_PER_BAR = 16;
const STEP = BEAT / 4;

function report(bars: number): AnalysisReport {
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let b = 0; b < bars * BEATS_PER_BAR + 1; b += 1) {
    beats.push(b * BEAT);
    if (b % BEATS_PER_BAR === 0) downbeats.push(b * BEAT);
  }
  return {
    durationSec: bars * BEATS_PER_BAR * BEAT,
    tempo: { bpm: BPM, confidence: 1, candidates: [], steadiness: 1 },
    meter: {
      value: "4/4",
      beatsPerBar: BEATS_PER_BAR,
      phase: 0,
      subdivision: "simple",
      shuffle: false,
      confidence: 1,
      candidates: [],
      downbeats,
    },
    key: { tonic: 0, mode: "major", confidence: 1, name: "C major", candidates: [] },
    tuningCents: 0,
    beats,
    downbeats,
    chords: [],
    chordConfidence: 0,
  } as unknown as AnalysisReport;
}

function hit(bar: number, step: number, cls: DrumClass): DrumHit {
  return {
    atSec: ((bar - 1) * STEPS_PER_BAR + step) * STEP,
    cls,
    gm: 0,
    velocity: 100,
    confidence: 1,
    bands: [],
  };
}

/** 킥 1·3박, 스네어 2·4박, 하이햇 8분 — 여덟 마디 내내 같다 */
function groove(bars: number): DrumHit[] {
  const out: DrumHit[] = [];
  for (let bar = 1; bar <= bars; bar += 1) {
    out.push(hit(bar, 0, "kick"), hit(bar, 8, "kick"));
    out.push(hit(bar, 4, "snare"), hit(bar, 12, "snare"));
    for (let s = 0; s < STEPS_PER_BAR; s += 2) out.push(hit(bar, s, "hihat"));
  }
  return out.toSorted((a, b) => a.atSec - b.atSec);
}

function detection(hits: DrumHit[]): DrumDetection {
  return {
    hits,
    fps: 86,
    bandsHz: [30, 110, 220, 900, 2500, 5000, 8000, 11_000],
    peakCounts: { low: hits.length, mid: hits.length, high: hits.length },
    rejected: { low: 0, mid: 0, high: 0 },
  };
}

/** 소리를 안 내는 재생기. 무엇이 불렸는지만 적는다 */
function fakePlayer() {
  const calls: { from: number; to: number; clicks: number }[] = [];
  let stopped = true;
  let position = 0;
  const player: ClipPlayer = {
    load: () => Promise.resolve(),
    durationSec: () => 60,
    loop(from, to, clicks) {
      calls.push({ from, to, clicks: clicks?.length ?? 0 });
      stopped = false;
      const handle: Clip = {
        positionSec: () => (stopped ? null : position),
        stop: () => {
          stopped = true;
        },
      };
      return handle;
    },
    stop: () => {
      stopped = true;
    },
    dispose: vi.fn(() => {
      stopped = true;
    }),
  };
  return {
    player,
    calls,
    isStopped: () => stopped,
    seek: (at: number) => {
      position = at;
    },
  };
}

function fakeFetch() {
  return vi.fn(() =>
    Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob()) } as unknown as Response),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function mount(hits: DrumHit[], bars: number, extra: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", fakeFetch());
  const view = render(
    <DrumPanel
      jobId="job1"
      report={report(bars)}
      detect={() => Promise.resolve(detection(hits))}
      {...extra}
    />,
  );
  // **`/루프/`로 기다리면 안 된다** — 지표 이름("루프")과 표 제목("루프와 필인")
  // 둘 다 걸려 모호해진다. 그리드가 그려졌는지로 본다.
  await waitFor(() => expect(view.container.querySelector(".stepgrid__table")).toBeTruthy());
  return view;
}

describe("드럼 칸", () => {
  it("루프 길이와 타점 수를 낸다", async () => {
    await mount(groove(8), 8);
    expect(screen.getByText("1마디")).toBeTruthy();
    expect(screen.getByText(String(groove(8).length))).toBeTruthy();
  });

  it("쓰인 어휘만 행으로 그린다 — 없는 악기 줄을 만들지 않는다", async () => {
    await mount(groove(8), 8);
    expect(screen.getByText("킥")).toBeTruthy();
    expect(screen.getByText("스네어")).toBeTruthy();
    expect(screen.getByText("하이햇")).toBeTruthy();
    // 곡에 톰이 없으므로 줄도 없어야 한다
    expect(screen.queryByText("톰")).toBeNull();
  });

  it("킥이 1·3박 칸에만 칠해진다", async () => {
    const { container } = await mount(groove(8), 8);
    const rows = [...container.querySelectorAll(".stepgrid__table tbody tr")];
    const kickRow = rows.find((r) => r.querySelector("th")?.textContent === "킥");
    const cells = [...(kickRow?.querySelectorAll("td") ?? [])];
    expect(cells).toHaveLength(STEPS_PER_BAR);
    const on = cells.flatMap((c, i) => (c.classList.contains("stepgrid__cell--on") ? [i] : []));
    expect(on).toEqual([0, 8]);
  });

  it("정확도를 말할 수 없다는 것을 화면이 말한다", async () => {
    await mount(groove(8), 8);
    expect(screen.getByText(/정확도는 아직 말할 수 없다/)).toBeTruthy();
  });

  it("사이드카가 스템을 안 주면 그 사실을 적는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 404 } as unknown as Response)),
    );
    render(<DrumPanel jobId="job1" report={report(8)} detect={() => Promise.resolve(detection([]))} />);
    await waitFor(() => expect(screen.getByText(/드럼 분석에 실패했다/)).toBeTruthy());
  });
});

describe("구간 반복 재생", () => {
  it("보이는 마디를 그대로 재생한다 — 눈과 귀가 같은 자리를 본다", async () => {
    const audio = fakePlayer();
    await mount(groove(8), 8, { clip: () => audio.player });
    await act(async () => {
      fireEvent.click(screen.getByText("이 구간 반복 재생"));
    });
    await waitFor(() => expect(audio.calls).toHaveLength(1));
    // 1마디 루프 → 0초부터 2초(120BPM 4/4 한 마디)
    expect(audio.calls[0].from).toBeCloseTo(0, 6);
    expect(audio.calls[0].to).toBeCloseTo(2, 6);
    // 박마다 클릭 — 한 마디면 넷
    expect(audio.calls[0].clicks).toBe(4);
  });

  it("멈추면 손잡이가 멎는다", async () => {
    const audio = fakePlayer();
    await mount(groove(8), 8, { clip: () => audio.player });
    await act(async () => {
      fireEvent.click(screen.getByText("이 구간 반복 재생"));
    });
    await waitFor(() => expect(screen.queryByText("멈춤")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("멈춤"));
    });
    expect(audio.isStopped()).toBe(true);
  });

  /**
   * **화면을 떠나도 소리가 나면 안 된다.**
   *
   * 자유 연주에서 음이 매달리는 자리를 넷 찾아 회귀 시험을 걸어 둔 것과 같은
   * 종류다. 여기서는 재생기가 `AudioContext`를 들고 있어 언마운트로 저절로
   * 닫히지 않는다.
   */
  it("화면을 떠나면 소리를 끄고 컨텍스트를 닫는다", async () => {
    const audio = fakePlayer();
    const { unmount } = await mount(groove(8), 8, { clip: () => audio.player });
    await act(async () => {
      fireEvent.click(screen.getByText("이 구간 반복 재생"));
    });
    await waitFor(() => expect(audio.calls).toHaveLength(1));
    unmount();
    expect(audio.isStopped()).toBe(true);
    expect(audio.player.dispose).toHaveBeenCalled();
  });
});
