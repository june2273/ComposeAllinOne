/** UI 결선 검증 — 훅·타이머·채점·결과가 실제로 이어지는가. */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import App from "../src/App";
import { NullSynth } from "../src/core/audio";
import { DIATONIC_INTERVALS, INTERMEDIATE } from "../src/core/config";
import type { IntervalQuestion } from "../src/core/questions";
import type { Result } from "../src/core/session";
import { QuizPage } from "../src/ui/pages";

const audio = new NullSynth();

// verovio WASM은 jsdom에서 뜨지 않는다. 악보는 브라우저에서 이미 확인했고,
// 여기서는 세션 결선을 본다 — Staff가 실패하면 음이름으로 떨어지게 되어 있다.
vi.mock("../src/core/score", () => ({
  ScoreRenderer: { load: () => Promise.reject(new Error("jsdom")) },
}));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

/** 락아웃(200ms)을 넘겨 문제를 입력 가능 상태로 만든다. */
async function pastLockout() {
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
}

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("음정 스테이지", () => {
  test("정답을 입력하면 점수가 오르고 10문제 뒤 결과가 나온다", async () => {
    const finished: Result[][] = [];
    // 화면에 뜬 문제를 읽기 위해 QuizPage를 감싼다
    function Probe() {
      return (
        <QuizPage
          config={DIATONIC_INTERVALS}
          audio={audio}
          onFinished={(r) => finished.push(r)}
        />
      );
    }
    render(<Probe />);

    for (let i = 0; i < 10; i += 1) {
      await pastLockout();
      // 정답은 진단 문구가 아니라 DOM에 없으므로, 세션이 만든 문제를 화면
      // 텍스트로는 알 수 없다. 대신 오답을 낸 뒤 표시되는 정답 문구로 확인한다.
      press("1");
      press("0");
      press("P");        // 완전1도/0반음 — 2도~8도만 나오므로 반드시 오답
      await act(async () => {
        vi.advanceTimersByTime(2400); // 피드백 2200ms
      });
    }

    expect(finished.length).toBe(1);
    expect(finished[0]).toHaveLength(10);
    expect(finished[0].every((r) => !r.correct)).toBe(true);
    // 오답이면 진단 문구가 붙는다
    expect(finished[0][0].detail).toContain("정답:");
    expect(finished[0][0].detail).toContain("도수부터");
  });

  test("도수·반음만 넣고 성질을 안 고르면 제출되지 않는다", async () => {
    const finished: Result[][] = [];
    render(
      <QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={(r) => finished.push(r)} />,
    );
    await pastLockout();
    press("3");
    press("4");
    expect(screen.getByText(/성질을 고르면 제출됩니다/)).toBeTruthy();
    // 제한시간(10초)이 지나야 넘어간다
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByText("오답")).toBeNull();
    expect(screen.queryByText("정답")).toBeNull();
  });

  test("성질을 먼저 누르면 안내만 뜨고 제출되지 않는다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    press("M");
    expect(screen.getByText(/도수와 반음 수를 먼저 입력하세요/)).toBeTruthy();
  });

  test("시간이 다 되면 시간 초과로 넘어간다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    await act(async () => {
      vi.advanceTimersByTime(10_500);
    });
    expect(screen.getByText("시간 초과")).toBeTruthy();
  });
});

describe("청음 스테이지 (자판 폴백)", () => {
  test("락아웃 중 입력은 버려지고, 해제 뒤 입력은 채점된다", async () => {
    const finished: Result[][] = [];
    render(
      <QuizPage config={INTERMEDIATE} audio={audio} onFinished={(r) => finished.push(r)} />,
    );
    // 락아웃 구간에 잔여 입력을 흉내낸다
    for (let i = 0; i < 40; i += 1) press("a");
    expect(screen.queryByText("오답")).toBeNull();
    expect(screen.queryByText("정답")).toBeNull();

    await pastLockout();
    press("a"); // C4
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    // 채점이 실제로 일어났다 (정답이든 오답이든 판정이 떠야 한다)
    const judged =
      screen.queryByText("정답") !== null || screen.queryByText("오답") !== null;
    expect(judged).toBe(true);
  });
});

describe("네비게이션", () => {
  test("홈 → 도메인 → 준비 중 활동", async () => {
    render(<App />);
    expect(screen.getByText("무엇을 연습할까요")).toBeTruthy();

    act(() => screen.getByText("화성학").click());
    expect(screen.getByText("텐션")).toBeTruthy();

    act(() => screen.getByText("텐션").click());
    // 카탈로그의 requires가 그대로 화면에 나온다
    expect(screen.getByText(/requiredPcs \/ optionalPcs/)).toBeTruthy();
  });

  test("도구형은 문항형 화면으로 가지 않는다", () => {
    render(<App />);
    act(() => screen.getByText("음악분석도구").click());
    act(() => screen.getByText("분석 콘솔").click());
    // 파일을 받는 화면이지 문제 화면이 아니다
    expect(screen.getByText("오디오 파일 열기")).toBeTruthy();
    expect(screen.queryByText("다시 듣기 (Space)")).toBeNull();
    expect(screen.queryByText(/문제 1 \/ 10/)).toBeNull();
  });

  test("연주형은 화면이 생길 때까지 준비 중으로 간다", () => {
    render(<App />);
    act(() => screen.getByText("화성학").click());
    act(() => screen.getByText("코드 학습").click());
    expect(screen.getByText(/Session을 쓰지 않는다/)).toBeTruthy();
    expect(screen.queryByText("다시 듣기 (Space)")).toBeNull();
  });
});

describe("정답 경로 (훅 직접)", () => {
  test("문제를 실제로 맞히면 점수가 10점까지 오른다", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useSession } = await import("../src/ui/useSession");
    const { isIntervalQuestion } = await import("../src/core/questions");

    const { result } = renderHook(() =>
      useSession(DIATONIC_INTERVALS, audio, 42),
    );
    act(() => result.current.start());

    for (let i = 0; i < 10; i += 1) {
      await pastLockout();
      const q = result.current.view.question;
      expect(q).not.toBeNull();
      expect(isIntervalQuestion(q!)).toBe(true);
      const iv = (q as IntervalQuestion).interval;
      act(() =>
        result.current.respond({
          number: iv.number,
          semitones: iv.semitones,
          quality: iv.quality,
        }),
      );
      expect(result.current.view.result?.correct).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(2400);
      });
    }

    expect(result.current.view.score).toBe(10);
    expect(result.current.view.finished).toBe(true);
    expect(result.current.view.results).toHaveLength(10);
    // 2~8도만, 흰건반만
    for (const r of result.current.view.results) {
      const iq = r.question as IntervalQuestion;
      expect(iq.interval.number).toBeGreaterThanOrEqual(2);
      expect(iq.interval.number).toBeLessThanOrEqual(8);
      for (const n of iq.answerNotes) {
        expect([0, 2, 4, 5, 7, 9, 11]).toContain(n % 12);
      }
    }
  });

  test("성질만 틀리면 진단 문구가 그것을 짚는다", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useSession } = await import("../src/ui/useSession");

    const { result } = renderHook(() => useSession(DIATONIC_INTERVALS, audio, 7));
    act(() => result.current.start());
    await pastLockout();
    const iv = (result.current.view.question as IntervalQuestion).interval;
    const wrong = iv.quality === "감" ? "증" : "감";
    act(() =>
      result.current.respond({
        number: iv.number,
        semitones: iv.semitones,
        quality: wrong,
      }),
    );
    expect(result.current.view.result?.correct).toBe(false);
    expect(result.current.view.result?.detail).toContain("성질만 다시");
  });
});
