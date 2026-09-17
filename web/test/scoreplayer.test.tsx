/**
 * 악보 재생 — **결선과 순수 변환.**
 *
 * verovio는 여기서도 mock한다(jsdom에서 WASM이 뜨지 않는다). 그래서 커서 계산은
 * `score.test.ts`가 보고, 여기서는 두 가지를 본다.
 *
 * 1. `buildSequence` — 격자 칸이 초로 옳게 옮겨지는가. **격자 MIDI와 같은 식**을
 *    써야 재생과 내려받은 `.mid`가 어긋나지 않는다.
 * 2. **음이 매달리지 않는가.** 오디오 백엔드는 App이 들고 있어 화면과 함께
 *    버려지지 않는다 — 정지를 놓치면 화면을 떠나도 계속 울린다(자유 연주에서
 *    이미 겪은 함정이다).
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  AudioBackend,
  NoteHandle,
  Sequence,
  SequenceNote,
} from "../src/core/audio";
import { SILENT_NOTE } from "../src/core/audio";
import { transcribe, type Transcription } from "../src/core/transcribe";
import { ScorePlayer, buildSequence } from "../src/ui/scoreplayer";

// jsdom에는 verovio WASM이 없다. 다른 UI 테스트와 같은 mock이다.
vi.mock("../src/core/score", () => ({
  ScoreRenderer: { load: () => Promise.reject(new Error("jsdom")) },
}));

const BPM = 120;

/** 4분음표 여덟 개. 120BPM 4/4에서 답을 아는 신호다 */
function sample(): Transcription {
  const f0: number[] = [];
  for (const midi of [69, 71, 72, 74, 76, 77, 79, 81]) {
    for (let i = 0; i < 45; i++) f0.push(440 * 2 ** ((midi - 69) / 12));
    for (let i = 0; i < 5; i++) f0.push(0);
  }
  return transcribe(
    { hopMs: 10, f0 },
    {
      bpm: BPM,
      beats: Array.from({ length: 9 }, (_, i) => i * 0.5),
      downbeats: [0, 2],
      beatsPerBar: 4,
      title: "검증",
    },
  );
}

/** 무엇을 몇 번 예약하고 몇 번 멈췄는지만 센다. */
class RecordingBackend implements AudioBackend {
  readonly sequences: (readonly SequenceNote[])[] = [];
  stops = 0;
  playNotes(): void {}
  noteOn(): NoteHandle {
    return SILENT_NOTE;
  }
  playSequence(notes: readonly SequenceNote[]): Sequence {
    this.sequences.push(notes);
    let stopped = false;
    return {
      positionSec: () => (stopped ? null : 0),
      stop: () => {
        if (stopped) return;
        stopped = true;
        this.stops++;
      },
    };
  }
  stop(): void {}
}

describe("1. buildSequence — 격자를 초로", () => {
  const t = sample();

  test("칸 번호가 BPM 격자의 초가 된다 — 격자 MIDI와 같은 식", () => {
    const { notes, totalSec } = buildSequence(t, BPM, "score");
    expect(notes).toHaveLength(8);
    // 120BPM · 칸/박 4 → 한 칸 0.125초, 4분음표(4칸) 0.5초
    expect(notes[0].startSec).toBeCloseTo(0, 9);
    expect(notes[0].endSec).toBeCloseTo(0.5, 9);
    expect(notes[1].startSec).toBeCloseTo(0.5, 9);
    expect(notes.at(-1)!.endSec).toBeCloseTo(4, 9);
    expect(totalSec).toBeCloseTo(4, 9);
  });

  test("BPM이 두 배면 시간이 절반이다", () => {
    expect(buildSequence(t, BPM * 2, "score").totalSec).toBeCloseTo(2, 9);
  });

  test("노래한 그대로는 실제로 부른 초를 쓴다", () => {
    const { notes } = buildSequence(t, BPM, "performed");
    expect(notes).toHaveLength(t.notes.length);
    // 격자로 반올림되지 않은 값이다
    expect(notes[1].startSec).toBeCloseTo(
      t.notes[1].startSec - t.notes[0].startSec,
      9,
    );
  });

  /** 재생 버튼을 누르고 간주가 끝나기를 기다리게 만들 이유가 없다 */
  test("두 모드 모두 첫 음이 0초에서 시작한다", () => {
    for (const mode of ["score", "performed"] as const) {
      expect(buildSequence(t, BPM, mode).notes[0].startSec).toBeCloseTo(0, 9);
    }
  });

  test("BPM이 0이면 빈 시퀀스다 — 무한으로 나누지 않는다", () => {
    expect(buildSequence(t, 0, "score").notes).toHaveLength(0);
  });

  test("음표가 없으면 길이도 0이다", () => {
    const empty = transcribe(
      { hopMs: 10, f0: Array.from({ length: 100 }, () => 0) },
      { bpm: BPM, beats: [0, 0.5, 1], downbeats: [0], beatsPerBar: 4 },
    );
    expect(buildSequence(empty, BPM, "score")).toEqual({
      notes: [],
      totalSec: 0,
    });
  });
});

describe("2. 화면 결선", () => {
  const t = sample();

  test("재생을 누르면 시퀀스를 통째로 넘긴다", async () => {
    const audio = new RecordingBackend();
    render(<ScorePlayer transcription={t} bpm={BPM} audio={audio} title="곡" />);
    act(() => {
      screen.getByRole("button", { name: /재생/ }).click();
    });
    expect(audio.sequences).toHaveLength(1);
    expect(audio.sequences[0]).toHaveLength(8);
  });

  /**
   * **여기가 이 파일의 핵심이다.** 오디오 백엔드는 App이 들고 있어 화면과 함께
   * 버려지지 않는다 — 정지를 놓치면 다른 화면으로 가서도 계속 울린다.
   */
  test("화면을 떠나면 소리를 끊는다", () => {
    const audio = new RecordingBackend();
    const { unmount } = render(
      <ScorePlayer transcription={t} bpm={BPM} audio={audio} title="곡" />,
    );
    act(() => {
      screen.getByRole("button", { name: /재생/ }).click();
    });
    expect(audio.stops).toBe(0);
    unmount();
    expect(audio.stops).toBe(1);
  });

  test("정지 버튼이 소리를 끊고 다시 재생 버튼이 된다", () => {
    const audio = new RecordingBackend();
    render(<ScorePlayer transcription={t} bpm={BPM} audio={audio} title="곡" />);
    act(() => {
      screen.getByRole("button", { name: /재생/ }).click();
    });
    act(() => {
      screen.getByRole("button", { name: /정지/ }).click();
    });
    expect(audio.stops).toBe(1);
    expect(screen.getByRole("button", { name: /재생/ })).toBeTruthy();
  });

  test("모드를 바꾸면 울리던 것을 끊는다 — 두 벌이 겹쳐 나지 않게", () => {
    const audio = new RecordingBackend();
    render(<ScorePlayer transcription={t} bpm={BPM} audio={audio} title="곡" />);
    act(() => {
      screen.getByRole("button", { name: /재생/ }).click();
    });
    act(() => {
      screen.getByLabelText(/노래한 그대로/).click();
    });
    expect(audio.stops).toBe(1);
  });

  /**
   * verovio가 죽어도(사이드카가 없는 환경, 구형 브라우저) 화면은 떠야 한다 —
   * 소리는 악보 없이도 낼 수 있으므로 재생은 살아 있고 인쇄만 잠긴다.
   */
  test("악보를 못 그려도 재생은 되고 내보내기만 잠긴다", async () => {
    const audio = new RecordingBackend();
    render(<ScorePlayer transcription={t} bpm={BPM} audio={audio} title="곡" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole("button", { name: /재생/ }).hasAttribute("disabled"),
    ).toBe(false);
    expect(
      screen
        .getByRole("button", { name: /PDF로 내보내기/ })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
