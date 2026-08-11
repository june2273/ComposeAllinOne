/** UI 결선 검증 — 훅·타이머·채점·결과가 실제로 이어지는가. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import App from "../src/App";
import { NullSynth } from "../src/core/audio";
import {
  DIATONIC_INTERVALS,
  INTERMEDIATE,
  INTERVAL_HALF_STEPS,
  INTERVAL_TABLE,
  ROUND_STEPS,
  TIME_STEPS,
} from "../src/core/config";
import type { IntervalQuestion } from "../src/core/questions";
import type { Result } from "../src/core/session";
import { ShareBars } from "../src/ds";
import { QuizPage } from "../src/ui/pages";
import {
  MAJOR_MINOR_TABLE,
  PERFECT_TABLE,
  QUALITIES,
} from "../src/ui/stages";

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

/** 왼쪽 메뉴에서 고른다. 고른 항목은 오른쪽 제목으로도 나오므로 역할로 집는다. */
function pickMenu(title: string) {
  act(() => {
    screen.getByRole("button", { name: new RegExp(title) }).click();
  });
}

/** 슬라이더를 눈금 index로 옮긴다. */
function slide(label: string, index: number) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  act(() => {
    fireEvent.change(input, { target: { value: String(index) } });
  });
}

/**
 * 성질 선택지 버튼을 누른다.
 *
 * 성질 이름은 키캡 설명에도 나오므로 **글자만으로는 두 곳이 잡힌다.** 버튼의
 * 접근명("완전 Perfect")으로 집어 선택지 쪽만 고른다.
 */
function pickQuality(quality: string) {
  const { label } = QUALITIES.find((q) => q.quality === quality)!;
  act(() => {
    screen.getByRole("button", { name: `${quality} ${label}` }).click();
  });
}

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/**
 * 키를 **한 태스크에 몰아서** 보낸다 — 사이에 렌더가 없다.
 *
 * 핸들러가 클로저에 담긴 입력 상태를 보고 제출 여부를 판단하면 여기서 깨진다
 * (실측: 6·1·Enter를 한 번에 보내면 Enter가 빈 상태를 봤다). 브라우저 자동
 * 입력이나 빠른 연타가 실제로 이 모양이다.
 */
function pressAll(...keys: string[]) {
  act(() => {
    for (const key of keys) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
  });
}

describe("음정 본 단계", () => {
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

  test("도수만 넣으면 제출되지 않는다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    press("3");
    expect(screen.getByText(/성질을 고르세요/)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByText("오답")).toBeNull();
    expect(screen.queryByText("정답")).toBeNull();
  });

  test("성질을 먼저 골라도 되고, 도수가 차는 순간 제출된다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    press("M"); // 성질 먼저
    expect(screen.getByText(/도수를 숫자 키로 입력하세요/)).toBeTruthy();
    expect(screen.queryByText("오답")).toBeNull();

    press("1"); // 1도는 출제되지 않으므로 반드시 오답
    const judged =
      screen.queryByText("정답") !== null || screen.queryByText("오답") !== null;
    expect(judged).toBe(true);
  });

  test("성질과 도수가 한꺼번에 들어와도 제출된다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    pressAll("M", "1"); // 1도는 출제되지 않으므로 반드시 오답
    expect(screen.getByText("오답")).toBeTruthy();
  });

  test("입력 칸이 '장 3도' 순서다 — 성질이 도수보다 앞", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    press("M");
    // 음정의 이름은 "장3도"다. 칸 순서가 반대면 답을 만드는 동안 본 것과
    // 채점 결과에 적힌 것이 뒤집혀 보인다.
    const fields = [...document.querySelectorAll(".interval__fields .field")];
    expect(fields.map((el) => el.textContent)).toEqual(["장", "–"]);
  });

  test("선택지는 원어 이름을 달고, 단축키는 키캡이 따로 설명한다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    // 버튼에는 무엇을 고르는지가, 키캡에는 어느 키인지가 있다.
    expect(screen.getByRole("button", { name: "단 minor" })).toBeTruthy();
    // N이 minor의 N이라는 것은 이 한 줄이 유일한 설명이다 (M을 장이 가져갔다)
    const cap = screen.getByRole("button", { name: "N 키 — 단" });
    act(() => cap.click());
    expect(screen.getByText(/도수를 숫자 키로 입력하세요/)).toBeTruthy();
  });

  test("반음은 입력하지 않는다 — 칸이 도수와 성질뿐이다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    expect(screen.queryByText("반음")).toBeNull();
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

describe("음정 연습 1 — 반음 계산법", () => {
  test("Enter 전에는 제출되지 않고, Enter를 눌러야 채점된다", async () => {
    render(
      <QuizPage config={INTERVAL_HALF_STEPS} audio={audio} onFinished={() => {}} />,
    );
    await pastLockout();
    press("9"); // 도수 (9도는 출제되지 않으므로 반드시 오답)
    press("9"); // 반음 개수
    expect(screen.queryByText("오답")).toBeNull();
    expect(screen.queryByText("정답")).toBeNull();

    press("Enter");
    expect(screen.getByText("오답")).toBeTruthy();
  });

  test("숫자와 Enter가 한꺼번에 들어와도 제출된다", async () => {
    render(
      <QuizPage config={INTERVAL_HALF_STEPS} audio={audio} onFinished={() => {}} />,
    );
    await pastLockout();
    pressAll("9", "9", "Enter");
    expect(screen.getByText("오답")).toBeTruthy();
  });

  test("성질은 묻지 않는다 — 버튼이 없다", async () => {
    render(
      <QuizPage config={INTERVAL_HALF_STEPS} audio={audio} onFinished={() => {}} />,
    );
    await pastLockout();
    expect(screen.queryByText(/완전/)).toBeNull();
    expect(screen.getByText("반음")).toBeTruthy();
    expect(screen.getByText("도")).toBeTruthy();
  });

  test("실제로 세어 맞히면 정답이다", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useSession } = await import("../src/ui/useSession");

    const { result } = renderHook(() => useSession(INTERVAL_HALF_STEPS, audio, 11));
    act(() => result.current.start());
    await pastLockout();

    const q = result.current.view.question as IntervalQuestion;
    act(() =>
      result.current.respond({
        form: "count",
        number: q.interval.number,
        halfSteps: q.halfSteps,
      }),
    );
    expect(result.current.view.result?.correct).toBe(true);
  });
});

describe("음정 연습 2 — 음정표", () => {
  /** 화면에 주어진 "n도 · 반음 m개"를 읽는다. */
  function given(): { number: number; halfSteps: number } {
    const text = document.querySelector(".given")?.textContent ?? "";
    const m = /(?<n>\d+)도 · 반음 (?<h>\d+)개/u.exec(text);
    if (!m?.groups) throw new Error(`문제 문구를 못 읽었다: ${text}`);
    return { number: Number(m.groups.n), halfSteps: Number(m.groups.h) };
  }

  /** 화면에 띄우는 그 표에서 답을 찾는다. 표가 틀리면 이 테스트가 먼저 깨진다. */
  function fromTable(number: number, halfSteps: number): string {
    for (const t of [PERFECT_TABLE, MAJOR_MINOR_TABLE]) {
      const col = t.columns.indexOf(`${number}도`);
      if (col < 0) continue;
      const row = t.rows.find((r) => r[0] === `${halfSteps}개`);
      if (row?.[col]) return row[col];
    }
    throw new Error(`표에 ${number}도 / 반음 ${halfSteps}개가 없다`);
  }

  test("주어진 도수·반음으로 표에서 성질을 고르면 정답이다", async () => {
    render(<QuizPage config={INTERVAL_TABLE} audio={audio} onFinished={() => {}} />);
    await pastLockout();

    const { number, halfSteps } = given();
    const quality = fromTable(number, halfSteps);
    pickQuality(quality);
    expect(screen.getByText("정답")).toBeTruthy();
  });

  test("표 보기가 꺼져 있으면 표가 안 보이고, 켜면 보인다", async () => {
    const { rerender } = render(
      <QuizPage config={INTERVAL_TABLE} audio={audio} onFinished={() => {}} />,
    );
    await pastLockout();
    expect(screen.queryByText(/1 · 4 · 5 · 8도/)).toBeNull();

    rerender(
      <QuizPage
        config={{ ...INTERVAL_TABLE, showTable: true }}
        audio={audio}
        onFinished={() => {}}
      />,
    );
    expect(screen.getByText(/1 · 4 · 5 · 8도/)).toBeTruthy();
    expect(screen.getByText(/2 · 3 · 6 · 7도/)).toBeTruthy();
  });

  test("틀리면 표의 어느 칸이었는지 알려준다", async () => {
    render(<QuizPage config={INTERVAL_TABLE} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    const { number, halfSteps } = given();
    const right = fromTable(number, halfSteps);
    const wrongOne = right === "감" ? "증" : "감";
    pickQuality(wrongOne);
    expect(screen.getByText("오답")).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`${number}도에 반음 ${halfSteps}개`, "u")),
    ).toBeTruthy();
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
    // 카탈로그의 requires가 그대로 오른쪽 칸에 나온다
    expect(screen.getByText(/requiredPcs \/ optionalPcs/)).toBeTruthy();
    // 준비 중은 시작할 수 없다
    expect(screen.getByText("준비 중", { selector: "button" })).toBeTruthy();
  });

  test("도구형은 문항형 화면으로 가지 않는다", () => {
    render(<App />);
    act(() => screen.getByText("음악분석도구").click());
    // 도구는 옵션이 없다 — 제한시간·라운드 슬라이더가 뜨면 안 된다
    expect(screen.queryByText("옵션 설정")).toBeNull();
    act(() => screen.getByText("열기").click());
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

describe("2분할 메뉴와 옵션", () => {
  test("고른 옵션이 세션에 실제로 적용된다", async () => {
    render(<App />);
    act(() => screen.getByText("화성학").click());
    // 왼쪽 메뉴에서 고르면 오른쪽에 설명과 옵션이 뜬다
    pickMenu("온음정");
    expect(screen.getByText("옵션 설정")).toBeTruthy();

    // 제한시간 눈금 0 = 10초, 라운드 눈금 0 = 5라운드
    slide("제한시간", 0);
    slide("라운드", 0);
    expect(screen.getByText("10초")).toBeTruthy();
    expect(screen.getByText("5라운드")).toBeTruthy();

    act(() => screen.getByText("연습 시작").click());
    expect(screen.getByText("문제 1 / 5")).toBeTruthy();
  });

  test("무한 눈금은 제한시간도 라운드도 끝을 없앤다", async () => {
    render(<App />);
    act(() => screen.getByText("화성학").click());
    pickMenu("온음정");

    slide("제한시간", TIME_STEPS.length - 1);
    slide("라운드", ROUND_STEPS.length - 1);
    act(() => screen.getByText("연습 시작").click());

    // 라운드 무한이면 진행 표시에 분모가 없다
    expect(screen.getByText("문제 1")).toBeTruthy();
    expect(screen.getByText("시간 무제한")).toBeTruthy();

    // 제한시간이 무한이면 한참 지나도 시간 초과가 나지 않는다
    await pastLockout();
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.queryByText("시간 초과")).toBeNull();
    expect(screen.getByText("문제 1")).toBeTruthy();
  });

  test("표 보기는 표가 있는 스테이지에서만 나오고, 켜면 문제 화면에 뜬다", () => {
    render(<App />);
    act(() => screen.getByText("화성학").click());

    pickMenu("온음정");
    expect(screen.queryByText("표 보기")).toBeNull(); // 본 단계에는 없다
    pickMenu("반음 계산법");
    expect(screen.queryByText("표 보기")).toBeNull(); // 성질을 안 묻는다

    pickMenu("음정표 외우기");
    const toggle = screen.getByLabelText("표 보기") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    act(() => {
      fireEvent.click(toggle);
    });

    act(() => screen.getByText("연습 시작").click());
    expect(screen.getByText(/1 · 4 · 5 · 8도/)).toBeTruthy();
  });

  test("활동을 바꾸면 옵션이 그 활동의 기본값으로 돌아간다", () => {
    render(<App />);
    act(() => screen.getByText("화성학").click());
    pickMenu("온음정");
    slide("라운드", 0); // 5라운드
    expect(screen.getByText("5라운드")).toBeTruthy();

    act(() => screen.getByText("텐션").click());
    pickMenu("온음정");
    // 기본값 10라운드로 돌아와 있다
    expect(screen.getByText("10라운드")).toBeTruthy();
  });
});

describe("일시정지 (ESC)", () => {
  function startInterval() {
    render(<App />);
    act(() => screen.getByText("화성학").click());
    pickMenu("온음정");
    act(() => screen.getByText("연습 시작").click());
  }

  test("ESC로 멈추면 타이머가 서고 입력이 막힌다", async () => {
    startInterval();
    await pastLockout();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    press("Escape");
    expect(screen.getByText("일시정지")).toBeTruthy();

    // 멈춰 있는 동안에는 시간이 흐르지 않는다 — 제한시간(10초)을 훌쩍 넘겨도
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByText("시간 초과")).toBeNull();

    // 답을 넣어도 채점되지 않는다
    press("3");
    press("4");
    press("M");
    expect(screen.queryByText("정답")).toBeNull();
    expect(screen.queryByText("오답")).toBeNull();
  });

  test("계속 진행하기는 멈춘 지점의 남은 시간부터 다시 흐른다", async () => {
    startInterval();
    await pastLockout();
    await act(async () => {
      vi.advanceTimersByTime(3000); // 7초 남음
    });
    press("Escape");
    await act(async () => {
      vi.advanceTimersByTime(60_000); // 멈춘 채로 한참
    });

    act(() => screen.getByText("계속 진행하기 (ESC)").click());
    expect(screen.queryByText("일시정지")).toBeNull();
    // 재개 락아웃(200ms) + 남은 6초로는 아직 시간 초과가 아니다
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText("시간 초과")).toBeNull();
    // 나머지 1초가 지나면 초과된다
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByText("시간 초과")).toBeTruthy();
  });

  test("피드백 중에 멈추면 재개할 때 다음 문제로 간다", async () => {
    startInterval();
    await pastLockout();
    press("1");
    press("0");
    press("P"); // 2~8도만 나오므로 반드시 오답
    expect(screen.getByText("오답")).toBeTruthy();

    // 피드백(2200ms)이 끝나기 전에 멈춘다
    press("Escape");
    expect(screen.getByText("일시정지")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText("문제 1 / 10")).toBeTruthy(); // 멈춰 있는 동안은 그대로

    press("Escape");
    expect(screen.getByText("문제 2 / 10")).toBeTruthy();
  });

  test("처음부터 다시는 점수와 진행을 0에서 시작한다", async () => {
    startInterval();
    await pastLockout();
    // 한 문제를 시간 초과로 흘려보낸다
    await act(async () => {
      vi.advanceTimersByTime(10_500 + 2400);
    });
    expect(screen.getByText("문제 2 / 10")).toBeTruthy();

    press("Escape");
    act(() => screen.getByText("처음부터 다시").click());
    expect(screen.queryByText("일시정지")).toBeNull();
    expect(screen.getByText("문제 1 / 10")).toBeTruthy();
    expect(screen.getByText("점수 0")).toBeTruthy();
  });

  test("옵션 설정은 고른 항목과 값을 든 채 메뉴로 돌아간다", async () => {
    render(<App />);
    act(() => screen.getByText("화성학").click());
    pickMenu("온음정");
    slide("라운드", 0);
    act(() => screen.getByText("연습 시작").click());
    await pastLockout();

    press("Escape");
    act(() => screen.getByText("옵션 설정").click());
    // 메뉴로 돌아왔고, 고른 항목과 값이 그대로다
    expect(screen.getByText("옵션 설정")).toBeTruthy();
    expect(screen.getByText("5라운드")).toBeTruthy();
    expect(screen.getByText("연습 시작")).toBeTruthy();
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
          form: "interval",
          number: iv.number,
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

  test("성질만 틀리면 반음 개수를 짚어 준다", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useSession } = await import("../src/ui/useSession");

    const { result } = renderHook(() => useSession(DIATONIC_INTERVALS, audio, 7));
    act(() => result.current.start());
    await pastLockout();
    const iv = (result.current.view.question as IntervalQuestion).interval;
    const wrong = iv.quality === "감" ? "증" : "감";
    act(() =>
      result.current.respond({ form: "interval", number: iv.number, quality: wrong }),
    );
    expect(result.current.view.result?.correct).toBe(false);
    expect(result.current.view.result?.detail).toContain("반음이");
    expect(result.current.view.result?.detail).toContain("도수는 맞습니다");
  });
});

describe("후보 몫 막대 (ds.ShareBars)", () => {
  test("이름과 백분율이 늘 보인다 — 마우스를 올려야 보이는 값이 없다", () => {
    render(
      <ShareBars
        caption="템포"
        rows={[
          { label: "86 BPM", value: 0.31 },
          { label: "172 BPM", value: 0.28, selected: true },
        ]}
      />,
    );
    expect(screen.getByText("템포")).toBeTruthy();
    expect(screen.getByText("86 BPM")).toBeTruthy();
    expect(screen.getByText(/31%/)).toBeTruthy();
  });

  test("고른 것을 색만으로 표시하지 않는다", () => {
    render(
      <ShareBars
        rows={[
          { label: "4/4", value: 0.52, selected: true },
          { label: "2/4", value: 0.4 },
        ]}
      />,
    );
    // 스크린리더가 읽을 문구가 함께 나간다
    expect(screen.getByText("선택됨")).toBeTruthy();
    expect(screen.getAllByText("선택됨")).toHaveLength(1);
  });

  test("1을 넘거나 음수인 값도 막대 밖으로 새지 않는다", () => {
    const { container } = render(
      <ShareBars rows={[{ label: "A", value: 1.8 }, { label: "B", value: -0.5 }]} />,
    );
    const fills = [...container.querySelectorAll<HTMLElement>(".shares__fill")];
    expect(fills.map((f) => f.style.width)).toEqual(["100%", "0%"]);
  });
});
