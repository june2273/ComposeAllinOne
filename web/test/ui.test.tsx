/** UI 결선 검증 — 훅·타이머·채점·결과가 실제로 이어지는가. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import App from "../src/App";
import { NullSynth } from "../src/core/audio";
import {
  DIATONIC_INTERVALS,
  INTERMEDIATE,
  INTERVAL_BUILD,
  INTERVAL_HALF_STEPS,
  INTERVAL_TABLE,
  ROUND_STEPS,
  TIME_STEPS,
} from "../src/core/config";
import type { IntervalQuestion } from "../src/core/questions";
import {
  LETTERS,
  Pitch,
  intervalBetween,
  noteName,
  parseIntervalAnswer,
} from "../src/core/theory";
import type { Result } from "../src/core/session";
import { Metric, ShareBars, StaffFigure } from "../src/ds";
import { QuizPage } from "../src/ui/pages";
import { MAJOR_MINOR_TABLE, PERFECT_TABLE } from "../src/ui/stages";

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

/** 답 칸에 글자를 넣는다. */
function typeAnswer(text: string) {
  const input = screen.getByLabelText("답") as HTMLInputElement;
  act(() => {
    fireEvent.change(input, { target: { value: text } });
  });
}

/**
 * Enter.
 *
 * `composing`이면 **입력기가 한글을 확정하는 중**이라 제출이 아니다. 이걸
 * 제출로 읽으면 "증"을 치는 첫 Enter가 늘 빈 답을 올린다.
 */
function enter(composing = false) {
  const input = screen.getByLabelText("답");
  act(() => {
    fireEvent.keyDown(input, { key: "Enter", isComposing: composing });
  });
}

function answer(text: string) {
  typeAnswer(text);
  enter();
}

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/**
 * 건반 자판 폴백은 **`code`로 잡는다**(한글 입력 상태에서 `key`는 `ㅁ`이 된다).
 * 성질·숫자 입력이 `key`를 쓰는 것과 갈리므로 헬퍼를 따로 둔다.
 */
function pressCode(code: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
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

/**
 * 화면의 가상 건반을 누른다.
 *
 * 건반의 이름표는 `caption (label)` = `자판글자 (음이름)`이고, 자판이 안 닿는
 * 음은 음이름뿐이다 — 그래서 이름표 안에 음이름이 들어 있는 것을 찾는다.
 */
function pressPitch(midi: number) {
  const name = noteName(midi);
  const keys = [...document.querySelectorAll(".pianokey")] as HTMLElement[];
  const key = keys.find((k) => (k.getAttribute("aria-label") ?? "").includes(name));
  if (!key) throw new Error(`가상 건반에 ${name}이 없다`);
  act(() => {
    fireEvent.pointerDown(key);
  });
}

/** 겹음정을 켠 연습 1 — 도수가 두 자리가 된다 */
const COMPOUND_COUNT = {
  ...INTERVAL_HALF_STEPS,
  difficulty: {
    ...INTERVAL_HALF_STEPS.difficulty,
    noteHigh: 88,
    maxIntervalNumber: 13,
  },
};

describe("음정 본 단계", () => {
  test("답을 적어 넣으면 10문제 뒤 결과가 나온다", async () => {
    const finished: Result[][] = [];
    render(
      <QuizPage
        config={DIATONIC_INTERVALS}
        audio={audio}
        onFinished={(r) => finished.push(r)}
      />,
    );

    for (let i = 0; i < 10; i += 1) {
      await pastLockout();
      // 정답은 DOM에 없으므로 화면만 보고는 알 수 없다. 1도는 출제되지
      // 않으므로 반드시 오답이고, 그 진단 문구로 결선을 확인한다.
      answer("완전1");
      await act(async () => {
        vi.advanceTimersByTime(2400); // 피드백 2200ms
      });
    }

    expect(finished.length).toBe(1);
    expect(finished[0]).toHaveLength(10);
    expect(finished[0].every((r) => !r.correct)).toBe(true);
    expect(finished[0][0].detail).toContain("정답:");
    expect(finished[0][0].detail).toContain("도수부터");
  });

  test("성질 없이 숫자만 치면 제출되지 않고 형식을 알려준다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    answer("3");
    expect(screen.getByText(/알 수 없는 답입니다/)).toBeTruthy();
    expect(screen.queryByText("오답")).toBeNull();
    expect(screen.queryByText("정답")).toBeNull();
  });

  test("성질만 치면 도수를 요구한다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    answer("장");
    expect(screen.getByText(/도수까지 적으세요/)).toBeTruthy();
    expect(screen.queryByText("오답")).toBeNull();
  });

  test("입력기 조합 중의 Enter는 제출이 아니다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    typeAnswer("장1");
    enter(true); // 한글을 확정하는 Enter
    expect(screen.queryByText("오답")).toBeNull();
    enter(false); // 두 번째 Enter가 제출이다
    expect(screen.getByText("오답")).toBeTruthy();
  });

  test("두 자리 도수를 적을 수 있다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    answer("장13"); // 13도는 이 설정에서 안 나오므로 반드시 오답
    expect(screen.getByText("오답")).toBeTruthy();
  });

  test("한글 입력기가 꺼져 있어도 답할 수 있다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    answer("P1"); // 완전1도 — 출제되지 않으므로 오답이지만 답으로는 읽힌다
    expect(screen.getByText("오답")).toBeTruthy();
    expect(screen.queryByText(/알 수 없는 답입니다/)).toBeNull();
  });

  test("예시가 성질 + 도수 순서다", async () => {
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    // 음정의 이름은 "장3도"지 "3도 장"이 아니다. 예시가 뒤집혀 있으면
    // 답을 만드는 동안 본 것과 채점 결과에 적힌 것이 어긋나 보인다.
    const input = screen.getByLabelText("답") as HTMLInputElement;
    expect(input.placeholder).toBe("증5");
    expect(screen.getByText(/장3 · 증5 · 겹감7/)).toBeTruthy();
  });

  test("답 칸에 초점이 있으면 Space가 다시 듣기를 부르지 않는다", async () => {
    const played = vi.spyOn(audio, "playNotes");
    render(<QuizPage config={DIATONIC_INTERVALS} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    played.mockClear();

    const input = screen.getByLabelText("답");
    act(() => {
      fireEvent.keyDown(input, { key: " ", code: "Space", bubbles: true });
    });
    expect(played).not.toHaveBeenCalled();
    played.mockRestore();
  });

  test("반음은 입력하지 않는다 — 칸이 하나뿐이다", async () => {
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

  test("겹음정이면 두 자리 도수가 중간에 제출되지 않는다", async () => {
    render(<QuizPage config={COMPOUND_COUNT} audio={audio} onFinished={() => {}} />);
    await pastLockout();
    press("1"); // 10~13이 될 수 있으므로 여기서 칸이 넘어가면 안 된다
    let fields = [...document.querySelectorAll(".interval__fields .field")];
    expect(fields[0].textContent).toBe("1");
    press("3");
    fields = [...document.querySelectorAll(".interval__fields .field")];
    expect(fields[0].textContent).toBe("13");

    pressAll("2", "Enter");
    const judged =
      screen.queryByText("정답") !== null || screen.queryByText("오답") !== null;
    expect(judged).toBe(true);
  });

  test("홑음정이면 한 자리에서 곧장 반음 칸으로 넘어간다", async () => {
    render(
      <QuizPage config={INTERVAL_HALF_STEPS} audio={audio} onFinished={() => {}} />,
    );
    await pastLockout();
    press("3");
    const active = [...document.querySelectorAll(".interval__fields .field")].findIndex(
      (el) => el.className.includes("field--active"),
    );
    expect(active).toBe(1);
  });

  test("성질은 묻지 않는다 — 답 칸이 숫자뿐이다", async () => {
    render(
      <QuizPage config={INTERVAL_HALF_STEPS} audio={audio} onFinished={() => {}} />,
    );
    await pastLockout();
    expect(screen.queryByLabelText("답")).toBeNull();
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
    answer(quality);
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
    answer(wrongOne);
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
    for (let i = 0; i < 40; i += 1) pressCode("KeyA");
    expect(screen.queryByText("오답")).toBeNull();
    expect(screen.queryByText("정답")).toBeNull();

    await pastLockout();
    pressCode("KeyA"); // C4
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

/**
 * 화면에 적힌 조건("G4 · 장2도 · 위로")을 풀어 정답 음을 구한다.
 *
 * 세션이 든 정답을 몰래 꺼내 오지 않는 것이 요점이다 — **사용자가 화면만 보고
 * 답을 낼 수 있는가**가 이 스테이지의 전부라, 테스트도 화면에서만 읽는다.
 */
function solveShown(): { given: Pitch; target: Pitch } {
  const line = document.querySelector(".given")?.textContent ?? "";
  const [givenName, intervalName, way] = line.split(" · ");
  const m = /^([A-G])(♯♯|♭♭|♯|♭)?(-?\d+)$/u.exec(givenName);
  if (!m) throw new Error(`음이름을 못 읽었다: ${line}`);
  const alters: Record<string, number> = { "♯": 1, "♯♯": 2, "♭": -1, "♭♭": -2 };
  const given = new Pitch(m[1], alters[m[2] ?? ""] ?? 0, Number(m[3]));

  const parsed = parseIntervalAnswer(intervalName);
  if (!parsed?.number) throw new Error(`음정을 못 읽었다: ${line}`);
  const up = way === "위로";
  const step = given.step + (up ? 1 : -1) * (parsed.number - 1);
  const letter = LETTERS[((step % 7) + 7) % 7];
  const octave = Math.floor(step / 7);

  for (let alter = -2; alter <= 2; alter += 1) {
    const target = new Pitch(letter, alter, octave);
    const [lower, upper] = up ? [given, target] : [target, given];
    if (upper.midi <= lower.midi) continue;
    try {
      if (intervalBetween(lower, upper).name === intervalName) return { given, target };
    } catch {
      // 이름이 없는 조합은 답이 아니다
    }
  }
  throw new Error(`정답을 못 구했다: ${line}`);
}

describe("음정 해석 — 건반으로 음을 쌓는다", () => {
  function startBuild() {
    const finished: Result[][] = [];
    render(
      <QuizPage
        config={{ ...INTERVAL_BUILD, questionCount: 3 }}
        audio={audio}
        onFinished={(r) => finished.push(r)}
      />,
    );
    return finished;
  }

  test("조건 세 가지를 보여주고 그대로 풀린다", async () => {
    startBuild();
    await pastLockout();

    const line = document.querySelector(".given")?.textContent ?? "";
    expect(line.split(" · ")).toHaveLength(3);
    expect(line).toMatch(/위로|아래로/u);
    expect(screen.getByText("건반에서 나머지 음을 누르세요")).toBeTruthy();
    // 답은 건반으로 낸다 — 글자를 치는 칸이 없어야 한다
    expect(screen.queryByLabelText("답")).toBeNull();
    expect(solveShown().target).toBeTruthy();
  });

  test("조건이 가리키는 음을 누르면 정답", async () => {
    startBuild();
    for (let i = 0; i < 3; i += 1) {
      await pastLockout();
      pressPitch(solveShown().target.midi);
      expect(screen.getByText("정답")).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(INTERVAL_BUILD.feedbackMs + 100);
      });
    }
    expect(screen.getByText("점수 3")).toBeTruthy();
  });

  /**
   * **음고류만 보면 안 된다.** A4 대신 A5를 눌러도 통과하면 "위로·아래로"를
   * 묻는 뜻이 사라진다 — 그래서 이 스테이지만 절대 음높이로 채점한다.
   */
  test("옥타브가 다르면 오답", async () => {
    startBuild();
    const { noteLow, noteHigh } = INTERVAL_BUILD.difficulty;

    // 음역이 22반음뿐이라 **정답의 옥타브 쌍둥이가 화면에 없는 문제도 있다**
    // (정답이 MIDI 70·71이면 ±12가 둘 다 음역 밖이다). 있는 문제가 나올
    // 때까지 넘긴다 — 22개 중 20개가 여기 해당한다.
    for (let i = 0; i < 5; i += 1) {
      await pastLockout();
      const { target } = solveShown();
      const twin = [target.midi - 12, target.midi + 12].find(
        (m) => m >= noteLow && m <= noteHigh,
      );
      if (twin !== undefined) {
        pressPitch(twin);
        expect(screen.getByText("오답")).toBeTruthy();
        return;
      }
      await act(async () => {
        vi.advanceTimersByTime(INTERVAL_BUILD.difficulty.timeLimitSec! * 1000 + INTERVAL_BUILD.feedbackMs + 200);
      });
    }
    throw new Error("옥타브 쌍둥이가 있는 문제가 안 나왔다");
  });
});

describe("2분할 메뉴와 옵션", () => {
  test("고른 옵션이 세션에 실제로 적용된다", async () => {
    render(<App />);
    act(() => screen.getByText("화성학").click());
    // 왼쪽 메뉴에서 고르면 오른쪽에 설명과 옵션이 뜬다
    pickMenu("음정");
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
    pickMenu("음정");

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

    pickMenu("음정");
    expect(screen.queryByText("표 보기")).toBeNull(); // 본 단계에는 없다
    slide("단계", 0);
    expect(screen.queryByText("표 보기")).toBeNull(); // 연습 1은 성질을 안 묻는다

    slide("단계", 1); // 연습 2 — 표를 읽는 단계
    const toggle = screen.getByLabelText("표 보기") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    act(() => {
      fireEvent.click(toggle);
    });

    act(() => screen.getByText("연습 시작").click());
    expect(screen.getByText(/1 · 4 · 5 · 8도/)).toBeTruthy();
  });

  test("음정 해석을 켜면 단계가 사라지고 건반으로 답하게 된다", async () => {
    render(<App />);
    act(() => screen.getByText("화성학").click());
    pickMenu("음정");
    expect(screen.getByLabelText("단계")).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByLabelText("음정 해석"));
    });
    // 스테이지가 하나뿐이라 단계 눈금이 아무것도 안 바꾼다 — 감춘다
    expect(screen.queryByLabelText("단계")).toBeNull();

    act(() => screen.getByText("연습 시작").click());
    await pastLockout();
    expect(screen.getByText("건반에서 나머지 음을 누르세요")).toBeTruthy();
    expect(screen.queryByLabelText("답")).toBeNull();
  });

  test("낮은음자리표를 켜면 낮은 자리의 음이 나온다", async () => {
    render(<App />);
    act(() => screen.getByText("화성학").click());
    pickMenu("음정");
    act(() => {
      fireEvent.click(screen.getByLabelText("낮은음자리표"));
    });
    act(() => screen.getByText("연습 시작").click());

    // 악보는 jsdom에서 안 뜨고 음이름으로 떨어진다. 20문제를 훑어 C4 아래가
    // 실제로 나오는지 본다 — 자리표 자체는 그 음을 보고 정해진다(core.test.ts).
    let sawLow = false;
    for (let i = 0; i < 20 && !sawLow; i += 1) {
      await pastLockout();
      const names = document.querySelector(".staff__fallback")?.textContent ?? "";
      sawLow = /[A-G](♯|♭)?[0-3]/u.test(names);
      answer("완전1"); // 2~8도만 나오므로 반드시 오답 — 다음 문제로 넘긴다
      await act(async () => {
        vi.advanceTimersByTime(DIATONIC_INTERVALS.feedbackMs + 100);
      });
    }
    expect(sawLow).toBe(true);
  });

  test("활동을 바꾸면 옵션이 그 활동의 기본값으로 돌아간다", () => {
    render(<App />);
    act(() => screen.getByText("화성학").click());
    pickMenu("음정");
    slide("라운드", 0); // 5라운드
    expect(screen.getByText("5라운드")).toBeTruthy();

    act(() => screen.getByText("텐션").click());
    pickMenu("음정");
    // 기본값 10라운드로 돌아와 있다
    expect(screen.getByText("10라운드")).toBeTruthy();
  });
});

describe("일시정지 (ESC)", () => {
  function startInterval() {
    render(<App />);
    act(() => screen.getByText("화성학").click());
    pickMenu("음정");
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
    answer("완전1"); // 2~8도만 나오므로 반드시 오답
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
    pickMenu("음정");
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
    expect(result.current.view.result?.detail).toContain("반음");
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

/**
 * `note`(신뢰도 꼬리표)와 `warning`(진단 한 줄)은 **자리가 달라야 한다** —
 * 한 곳에 합치면 둘 중 하나가 다른 하나를 덮는다.
 */
describe("ds.Metric — 경고", () => {
  test("경고는 note와 함께 나오고 서로를 덮지 않는다", () => {
    const { container } = render(
      <Metric label="BPM" value="139.0" detail="비트 562개" note="확인 필요"
        warning="2배 신호 — 실제 템포가 278 BPM일 수 있다" />,
    );
    expect(screen.getByText("확인 필요")).toBeTruthy();
    expect(screen.getByText(/2배 신호/)).toBeTruthy();
    // 색만으로 알리지 않는다 — 문장 자체가 화면에 있다
    expect(container.querySelector(".metric__warning")?.textContent).toContain("278 BPM");
  });

  test("경고가 없으면 자리도 안 만든다", () => {
    const { container } = render(<Metric label="BPM" value="120.0" />);
    expect(container.querySelector(".metric__warning")).toBeNull();
  });
});

/**
 * 재생 커서가 악보 위에 붙는 자리. **verovio를 부르지 않는다** — 우리가 하는
 * 일은 "받은 id에 클래스를 붙였다 떼는 것"뿐이고 그건 SVG 문자열만 있으면 된다.
 */
describe("StaffFigure — 재생 커서", () => {
  const SVG =
    '<svg><g id="n1"><path/></g><g id="n2"><path/></g><g id="n3"></g></svg>';

  test("강조한 id에만 클래스가 붙는다", () => {
    const { container } = render(<StaffFigure svg={SVG} highlight={["n2"]} />);
    expect(container.querySelector("#n2")!.classList.contains("staff__on")).toBe(true);
    expect(container.querySelector("#n1")!.classList.contains("staff__on")).toBe(false);
  });

  test("여러 개를 동시에 강조한다 — 화음·붙임줄", () => {
    const { container } = render(
      <StaffFigure svg={SVG} highlight={["n1", "n3"]} />,
    );
    const on = [...container.querySelectorAll(".staff__on")].map((e) => e.id);
    expect(on.sort()).toEqual(["n1", "n3"]);
  });

  /** 여기가 틀리면 지나간 음표가 계속 켜진 채 남아 악보가 통째로 물든다 */
  test("다음 음표로 넘어가면 앞의 것을 뗀다", () => {
    const { container, rerender } = render(
      <StaffFigure svg={SVG} highlight={["n1"]} />,
    );
    rerender(<StaffFigure svg={SVG} highlight={["n2"]} />);
    const on = [...container.querySelectorAll(".staff__on")].map((e) => e.id);
    expect(on).toEqual(["n2"]);
  });

  test("빈 목록이면 전부 뗀다 — 정지했을 때", () => {
    const { container, rerender } = render(
      <StaffFigure svg={SVG} highlight={["n1"]} />,
    );
    rerender(<StaffFigure svg={SVG} highlight={[]} />);
    expect(container.querySelectorAll(".staff__on")).toHaveLength(0);
  });

  test("없는 id를 줘도 던지지 않는다", () => {
    expect(() =>
      render(<StaffFigure svg={SVG} highlight={["없는것"]} />),
    ).not.toThrow();
  });

  test("악보가 없으면 fallback만 나온다", () => {
    const { container } = render(
      <StaffFigure fallback="악보를 그리는 중…" highlight={["n1"]} />,
    );
    expect(container.querySelector(".staff__fallback")!.textContent).toBe(
      "악보를 그리는 중…",
    );
  });
});

// --- 2박 신고 → BPM 경고 --------------------------------------------------------

/*
 * **`describe("2박 신고는 BPM 경고로 나간다")` 3개가 2026-09-12에 사라졌다.**
 * `tempoWarning`을 재던 것인데 축 B가 없어져 신고 자체가 안 나온다. 사람이
 * 배수를 고치는 길은 후보 막대로 그대로 남아 있다(위 "후보 몫 막대" 묶음).
 */
