/** React StrictMode에서 입력이 어긋나지 않는가.
 *
 * 상태 업데이터 안에서 다른 setState를 부르면 StrictMode가 업데이터를 두 번
 * 실행하면서 값이 두 번 반영될 수 있다. 실제 앱은 StrictMode로 뜨므로
 * (src/main.tsx) 여기서 잡아야 한다. */
import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { NullSynth } from "../src/core/audio";
import { DIATONIC_INTERVALS, INTERVAL_HALF_STEPS } from "../src/core/config";
import { QuizPage } from "../src/ui/pages";

vi.mock("../src/core/score", () => ({
  ScoreRenderer: { load: () => Promise.reject(new Error("jsdom")) },
}));
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

const press = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

/** 본 단계는 답을 글자로 받는다. 치고 Enter를 누르는 것이 한 번의 제출이다 */
function answer(text: string) {
  const input = screen.getByLabelText("답");
  act(() => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: false });
  });
}

test("StrictMode에서 숫자가 두 번 반영되지 않는다 (연습 1)", async () => {
  render(
    <StrictMode>
      <QuizPage config={INTERVAL_HALF_STEPS} audio={new NullSynth()} onFinished={() => {}} />
    </StrictMode>,
  );
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
  press("6"); // 도수
  press("1"); // 반음 개수
  const shown = [...document.querySelectorAll(".field")].map((f) => f.textContent);
  console.log("  화면에 보이는 값:", shown);
  expect(shown).toEqual(["6", "1"]);
});

test("StrictMode에서 제출이 두 번 나가지 않는다 (본 단계)", async () => {
  const finished: unknown[][] = [];
  render(
    <StrictMode>
      <QuizPage
        config={{ ...DIATONIC_INTERVALS, questionCount: 2 }}
        audio={new NullSynth()}
        onFinished={(r) => finished.push(r)}
      />
    </StrictMode>,
  );
  // Enter 한 번이 제출 한 번이다. 이펙트가 두 번 돌면 두 번 나간다.
  for (let i = 0; i < 2; i += 1) {
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    answer("장3");
    await act(async () => {
      vi.advanceTimersByTime(2400);
    });
  }
  expect(finished).toHaveLength(1);
  expect(finished[0]).toHaveLength(2); // 4개가 되면 두 번 제출된 것이다
});

test("StrictMode에서도 문제 수와 채점이 어긋나지 않는다", async () => {
  const finished: unknown[][] = [];
  const seen: string[] = [];
  render(
    <StrictMode>
      <QuizPage
        config={DIATONIC_INTERVALS}
        audio={new NullSynth()}
        onFinished={(r) => finished.push(r)}
      />
    </StrictMode>,
  );

  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    seen.push(document.querySelector(".quiz__head span")?.textContent ?? "");
    answer("장2");
    await act(async () => {
      vi.advanceTimersByTime(2400);
    });
  }

  expect(seen).toEqual(
    Array.from({ length: 10 }, (_, i) => `문제 ${i + 1} / 10`),
  );
  expect(finished).toHaveLength(1);
  expect(finished[0]).toHaveLength(10);
});

test("StrictMode에서 락아웃 중 입력이 새지 않는다", async () => {
  render(
    <StrictMode>
      <QuizPage config={DIATONIC_INTERVALS} audio={new NullSynth()} onFinished={() => {}} />
    </StrictMode>,
  );
  // 락아웃(200ms) 안에서 답을 만들어 본다. 답 칸은 이때 잠겨 있다
  answer("장3");
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
  // 여전히 1번 문제여야 한다 (제출되지 않았다)
  expect(document.querySelector(".quiz__head span")?.textContent).toBe("문제 1 / 10");
  expect(document.querySelector(".quiz__status")?.textContent).toBe("들어보세요");
});
