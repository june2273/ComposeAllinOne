/**
 * 스테이지별 "문제 표시 + 답 입력".
 *
 * 청음처럼 MIDI 건반으로 답하는 스테이지는 화면에 낼 것이 없고, 화성학처럼
 * 화면에서 답을 만드는 스테이지는 `onAnswer`로 응답을 올려보낸다.
 * `stageFor()`에 분기 한 줄을 더하면 새 스테이지가 붙는다.
 *
 * ## 음정 — 화면 넷
 *
 * 앞의 셋은 한 과목을 단계로 쪼갠 것이라 문제(두 음)가 같고 **무엇을 묻는가**만
 * 다르다. 음정을 구하는 순서의 세 토막이다(theory의 `diatonicHalfSteps` 주석
 * 참조) — 연습 1이 ②, 연습 2가 ②+④, 본 단계가 전부다.
 *
 * | 스테이지 | 묻는 것 | 입력 |
 * |---|---|---|
 * | `IntervalCountStage` | 도수 + 반음 개수 (골격) | 숫자 키 |
 * | `IntervalTableStage` | 성질 | 타이핑 |
 * | `IntervalStage` | 성질 + 도수 | 타이핑 |
 * | `IntervalBuildStage` | **나머지 음** | **건반** |
 *
 * 넷째(음정 해석)만 방향이 반대다 — 음정을 읽는 대신 만든다. 그래서 답도
 * 글자가 아니라 건반으로 받는다.
 *
 * **글자로 답하는 셋은 제출이 전부 Enter다.** 예전에는 "칸이 다 차면 제출"을 쓰는 화면이 있었는데,
 * 겹음정에서 도수가 두 자리가 되는 순간 그 규칙이 깨진다 — 13을 치려고 1을
 * 누르면 그때 제출된다. 규칙을 하나로 모았다.
 *
 * **성질은 버튼이 아니라 글자로 받는다.** 겹증·겹감·겹겹증까지 아홉이라 버튼으로는
 * 줄이 넘치고, 무엇보다 실제로 답을 적을 때 쓰는 형식이 "증5"다.
 */

import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";

import { Stage } from "../core/config";
import {
  type CountResponse,
  type IntervalBuildQuestion,
  type IntervalQuestion,
  type IntervalResponse,
  type QualityResponse,
  type Question,
  isIntervalBuildQuestion,
  isIntervalQuestion,
} from "../core/questions";
import {
  type IntervalAnswer,
  parseIntervalAnswer,
  qualityLadder,
} from "../core/theory";
import { Hint, Matrix, type MatrixProps, NumberField, TextField } from "../ds";
import { Staff } from "./components";

export interface StageProps {
  question: Question;
  /** 채점이 끝나 입력을 잠가야 하는 상태 */
  locked: boolean;
  /** 참고표를 함께 띄운다 (옵션에서 켠다) */
  showTable?: boolean;
  /** 도수 상한. 두 자리가 될 수 있는지를 이 값이 정한다 */
  maxNumber?: number;
  /** 음 하나에 붙은 임시표 수의 상한. 사다리 표의 폭을 정한다 */
  maxAlter?: number;
  onAnswer: (response: unknown) => void;
}

// --- 온음계적 음정표 (교재 unit 03) --------------------------------------------
//
// **세로축의 "반음"은 미–파·시–도의 개수**지 반음계적 거리가 아니다
// (theory.diatonicHalfSteps 주석 참조). 표 자체가 그 두 축의 교차표다.
//
// 표의 내용은 theory가 계산하는 것과 일치해야 한다 — 손으로 옮겨 적은
// 값이므로 테스트가 모든 칸을 intervalBetween()과 대조한다.

export const PERFECT_TABLE: MatrixProps = {
  caption: "1 · 4 · 5 · 8도 — 완전 / 증 / 감",
  columns: ["반음 \\ 도", "1도", "4도", "5도", "8도"],
  rows: [
    ["0개", "완전", "증", "", ""],
    ["1개", "", "완전", "완전", ""],
    ["2개", "", "", "감", "완전"],
  ],
};

export const MAJOR_MINOR_TABLE: MatrixProps = {
  caption: "2 · 3 · 6 · 7도 — 장 / 단",
  columns: ["반음 \\ 도", "2도", "3도", "6도", "7도"],
  rows: [
    ["0개", "장", "장", "", ""],
    ["1개", "단", "단", "장", "장"],
    ["2개", "", "", "단", "단"],
  ],
};

export function IntervalTables() {
  return (
    <div className="tables">
      <Matrix {...PERFECT_TABLE} />
      <Matrix {...MAJOR_MINOR_TABLE} />
    </div>
  );
}

/**
 * 교재 A표·B표 — 성질 사다리. 임시표가 붙은 문제에서 위 교차표 다음에 쓴다.
 *
 * **여기 적힌 이름은 `theory.qualityLadder()`가 준 것이다.** 위 교차표처럼 손으로
 * 옮기면 채점과 갈릴 수 있는데, 사다리는 `intervalBetween()`이 성질을 정할 때 쓰는
 * 바로 그 배열이라 갈릴 자리가 없다.
 */
export function LadderTables({ maxAlter = 1 }: { maxAlter?: number }) {
  return (
    <div className="tables">
      <Matrix
        caption="A표 [1 · 4 · 5 · 8]도 — 오른쪽으로 갈수록 넓다"
        columns={qualityLadder(1, maxAlter)}
        rows={[]}
      />
      <Matrix
        caption="B표 [2 · 3 · 6 · 7]도 — 오른쪽으로 갈수록 넓다"
        columns={qualityLadder(2, maxAlter)}
        rows={[]}
      />
    </div>
  );
}

/** MIDI 건반으로 답하는 스테이지. 화면에 낼 것이 없다. */
export function MidiStage(_: StageProps) {
  return null;
}

// --- 글자로 답하는 세 스테이지가 공유하는 부분 --------------------------------------------

const DIGIT = /^[0-9]$/u;
const ERASE = ["Backspace", "Delete"];
const MOVE = ["Tab", "ArrowLeft", "ArrowRight"];

const BOTH_HINT = "예: 장3 · 증5 · 겹감7 — 도는 생략. M3 · A5 · DD7로도 친다";
const QUALITY_HINT = "예: 장 · 증 · 겹감 — M · A · DD로도 친다";

/**
 * 성질(과 도수)을 글자로 받는 칸.
 *
 * 버튼을 쓰지 않는 이유는 개수가 아니라 **형식**이다. 음정의 이름은 "증5도"
 * 한 덩어리이고, 답을 그 모양 그대로 적게 하는 편이 성질과 도수를 따로 고르게
 * 하는 것보다 실제로 하는 일에 가깝다.
 *
 * 틀린 형식은 **제출하지 않고 그 자리에서 알려준다.** 오답으로 넘겨 버리면
 * 음정을 몰라서 틀린 것과 오타를 구별할 수 없다.
 */
function TypedAnswer({
  question,
  locked,
  needNumber,
  onDone,
}: {
  question: IntervalQuestion;
  locked: boolean;
  /** 도수까지 받는가. 연습 2는 성질만 묻는다 */
  needNumber: boolean;
  onDone: (answer: IntervalAnswer) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const key = question.answerText;

  useEffect(() => {
    setText("");
    setError("");
  }, [key]);

  const format = needNumber ? BOTH_HINT : QUALITY_HINT;
  return (
    <TextField
      value={text}
      placeholder={needNumber ? "증5" : "증"}
      hint={locked ? "" : error || format}
      disabled={locked}
      focusKey={key}
      onChange={(value) => {
        setText(value);
        setError("");
      }}
      onSubmit={() => {
        const answer = parseIntervalAnswer(text);
        if (!answer) {
          setError(`알 수 없는 답입니다. ${format}`);
          return;
        }
        if (needNumber && answer.number === null) {
          setError(`도수까지 적으세요. ${format}`);
          return;
        }
        onDone(answer);
      }}
    />
  );
}

/**
 * 새 문제가 오면 입력을 비운다.
 *
 * `dispatch`는 리듀서의 것이라 늘 같은 함수다 — 그래서 의존성에 넣어도
 * 매 렌더마다 다시 걸리지 않는다.
 */
function useResetOnQuestion<A extends { type: "reset" }>(
  question: Question,
  dispatch: (action: A) => void,
) {
  const key = question.answerText;
  useEffect(() => {
    dispatch({ type: "reset" } as A);
  }, [dispatch, key]);
}

/**
 * 창 전체의 키 입력. **잠겨 있으면 아예 붙이지 않는다** — 채점 직후의 입력이
 * 다음 문제로 새지 않게 하는 것이 문서 4절 락아웃 규칙의 취지다.
 *
 * `handle`이 true를 돌려주면 그 키를 처리한 것으로 보고 기본 동작을 막는다
 * (Tab이 초점을 옮기거나 Backspace가 뒤로 가는 것을 막아야 한다).
 * 매 렌더마다 다시 붙지 않도록 **`useCallback`으로 안정시켜 넘길 것.**
 */
function useKeys(locked: boolean, handle: (event: KeyboardEvent) => boolean) {
  useEffect(() => {
    if (locked) return;
    const onKey = (event: KeyboardEvent) => {
      if (handle(event)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handle, locked]);
}

/** 악보 → 입력 → 안내. 셋의 겉모습이 같아야 단계를 옮겨도 헷갈리지 않는다. */
function IntervalFrame({
  question,
  hint,
  children,
}: {
  question: IntervalQuestion;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="stack">
      <Staff lower={question.lower} upper={question.upper} />
      {children}
      <Hint>{hint}</Hint>
    </div>
  );
}

// --- 연습 1: 반음 계산법 --------------------------------------------------------

interface CountState {
  number: number | null;      // 도수
  halfSteps: number | null;   // 온음계적 반음 개수
  field: 0 | 1;
  hint: string;
  /** Enter를 눌러 제출이 확정됐다. 실제 제출은 이펙트가 한다 (아래 주석) */
  sent: boolean;
}

type CountAction =
  | { type: "reset" }
  | { type: "digit"; digit: number; maxNumber: number }
  | { type: "back" }
  | { type: "toggleField" }
  | { type: "submit" };

const COUNT_FIRST_HINT = "도수를 세어 숫자 키로 입력하세요";
const COUNT_SECOND_HINT = "반음(미–파·시–도)이 몇 개인지 입력하세요. 임시표는 무시한다";
const EMPTY_COUNT: CountState = {
  number: null,
  halfSteps: null,
  field: 0,
  hint: COUNT_FIRST_HINT,
  sent: false,
};

/**
 * 입력 상태를 순수 함수 하나로 모은다.
 *
 * **`useState` 여러 개로 두면 안 된다**(실측). 이전 구현은 `setField`
 * 업데이터 안에서 다른 setter를 불렀는데, React는 StrictMode에서 업데이터를
 * 두 번 실행하므로 숫자가 두 번 반영됐다 — `12`를 치면 `22`가 됐다. 리듀서는
 * 순수해서 몇 번 실행돼도 결과가 같다.
 */
function reduceCount(state: CountState, action: CountAction): CountState {
  switch (action.type) {
    case "reset":
      return EMPTY_COUNT;

    case "digit": {
      if (state.field === 1) {
        // 반음 개수는 한 자리다(13도라도 최대 4개). 덧쓰기로 둔다.
        return { ...state, halfSteps: action.digit, hint: "Enter로 제출합니다" };
      }
      if (state.number === null && action.digit < 1) {
        return { ...state, hint: "도수는 1부터입니다" };
      }
      const grown =
        state.number === null ? action.digit : state.number * 10 + action.digit;
      const number = grown <= action.maxNumber ? grown : action.digit;
      /*
        **더 이어 붙일 수 없을 때 넘어간다.** 상한이 8이면 어느 숫자를 쳐도 곧장
        반음 칸으로 가고(예전과 같다), 겹음정이라 상한이 13이면 1에서만 기다린다.
        규칙 하나로 두 경우가 다 맞는다 — 옵션마다 분기를 두면 13을 치려다 1에서
        칸이 넘어가는 사고가 한쪽에 남는다.
      */
      return number * 10 > action.maxNumber
        ? { ...state, number, field: 1, hint: COUNT_SECOND_HINT }
        : { ...state, number, hint: "도수를 마저 치거나 Tab으로 넘어가세요" };
    }

    case "back":
      if (state.field === 1 && state.halfSteps !== null) {
        return { ...state, halfSteps: null };
      }
      if (state.field === 1) return { ...state, field: 0, hint: COUNT_FIRST_HINT };
      return { ...state, number: null };

    case "toggleField":
      return { ...state, field: state.field === 0 ? 1 : 0 };

    case "submit":
      if (state.number === null || state.halfSteps === null) {
        return { ...state, hint: "도수와 반음 개수를 모두 입력한 뒤 Enter" };
      }
      return { ...state, sent: true };
  }
}

/**
 * 연습 1 — 두 음이 몇 도이고 반음이 몇 개인지 센다.
 *
 * 성질은 묻지 않는다. 표를 외우기 전에 **세는 법**만 몸에 익히는 단계다.
 * 임시표가 붙어 있어도 세는 것은 음이름 사다리뿐이다 — E♭4–F4도 2도·반음 1개다.
 */
export function IntervalCountStage({
  question,
  locked,
  maxNumber = 8,
  onAnswer,
}: StageProps) {
  const [input, dispatch] = useReducer(reduceCount, EMPTY_COUNT);
  useResetOnQuestion(question, dispatch);

  /**
   * **제출은 리듀서가 정하고 이펙트가 실행한다.**
   *
   * 키 핸들러 안에서 바로 `onAnswer`를 부르면 그 클로저가 든 `input`은 이번
   * 렌더의 값이다. 숫자 두 개와 Enter가 **같은 태스크에 묶여 들어오면**(브라우저
   * 자동 입력, 테스트의 연속 dispatch) 그 사이에 렌더가 없어서 Enter가 빈
   * 상태를 보고 "덜 입력했다"고 판단한다. 리듀서는 늘 최신 상태를 받으므로
   * 판단을 그쪽에 두고, 결과만 여기서 내보낸다.
   */
  useEffect(() => {
    if (!input.sent || locked) return;
    if (input.number === null || input.halfSteps === null) return;
    onAnswer({
      form: "count",
      number: input.number,
      halfSteps: input.halfSteps,
    } satisfies CountResponse);
  }, [input.halfSteps, input.number, input.sent, locked, onAnswer]);

  useKeys(
    locked,
    useCallback(
      ({ key }: KeyboardEvent) => {
        if (key === "Enter") dispatch({ type: "submit" });
        else if (DIGIT.test(key)) {
          dispatch({ type: "digit", digit: Number(key), maxNumber });
        } else if (ERASE.includes(key)) dispatch({ type: "back" });
        else if (MOVE.includes(key)) dispatch({ type: "toggleField" });
        else return false;
        return true;
      },
      [maxNumber],
    ),
  );

  if (!isIntervalQuestion(question)) return null;

  return (
    <IntervalFrame question={question} hint={locked ? "" : input.hint}>
      <div className="interval__fields">
        <NumberField value={input.number} active={input.field === 0} unit="도" />
        <NumberField
          value={input.halfSteps}
          active={input.field === 1}
          unit="반음"
        />
      </div>
    </IntervalFrame>
  );
}

// --- 연습 2: 음정표 외우기 ------------------------------------------------------

/**
 * 연습 2 — 도수와 반음 개수를 **주고** 성질만 묻는다.
 *
 * 세는 것을 빼고 표만 남긴 단계다. 온음계에서는 교차표 한 번으로 끝나지만,
 * 임시표가 붙으면 그 표가 주는 것은 **골격**이고 A·B 사다리를 한 번 더 거쳐야
 * 답이 된다 — C4–G♯4는 `5도 · 반음 1개`(완전5도)에서 한 칸 옮겨 증5도다.
 * 그래서 임시표가 있으면 표를 두 벌 보인다.
 */
export function IntervalTableStage({
  question,
  locked,
  showTable,
  maxAlter = 0,
  onAnswer,
}: StageProps) {
  const done = useCallback(
    (answer: IntervalAnswer) => {
      onAnswer({ form: "quality", quality: answer.quality } satisfies QualityResponse);
    },
    [onAnswer],
  );

  if (!isIntervalQuestion(question)) return null;

  return (
    <IntervalFrame
      question={question}
      hint={locked ? "" : "성질을 적고 Enter"}
    >
      <p className="given">
        {question.interval.number}도 · 반음 {question.halfSteps}개
      </p>
      <TypedAnswer
        question={question}
        locked={locked}
        needNumber={false}
        onDone={done}
      />
      {showTable && (
        <>
          <IntervalTables />
          {maxAlter > 0 && <LadderTables maxAlter={maxAlter} />}
        </>
      )}
    </IntervalFrame>
  );
}

// --- 본 단계: 음정 구분 ---------------------------------------------------------

/**
 * 본 단계 — 두 음만 보고 음정 이름을 적는다.
 *
 * 반음 개수는 입력하지 않는다. 세는 것은 머릿속에서 끝내야 하고, 화면에
 * 적게 하면 연습 1로 되돌아가는 셈이 된다.
 */
export function IntervalStage({ question, locked, onAnswer }: StageProps) {
  const done = useCallback(
    (answer: IntervalAnswer) => {
      onAnswer({
        form: "interval",
        number: answer.number,
        quality: answer.quality,
      } satisfies IntervalResponse);
    },
    [onAnswer],
  );

  if (!isIntervalQuestion(question)) return null;

  return (
    <IntervalFrame
      question={question}
      hint={locked ? "" : "음정 이름을 적고 Enter"}
    >
      <TypedAnswer
        question={question}
        locked={locked}
        needNumber
        onDone={done}
      />
    </IntervalFrame>
  );
}

// --- 음정 해석: 음을 쌓는다 ------------------------------------------------------

/**
 * 음정 해석 — 음 하나와 음정을 주고 **나머지 음을 건반에서** 받는다.
 *
 * 앞의 셋과 방향이 반대다. `G4 · 장2도 · 위로`면 A4를 누르는 것이 정답이고,
 * `아래로`면 F4다. 위·아래가 섞여 나오므로 방향을 먼저 읽어야 한다.
 *
 * **이 화면에는 입력이 없다.** 답은 `QuizPage`가 건반(MIDI·자판·가상 건반)에서
 * 받아 `Session.collect()`로 넣는다 — 청음과 완전히 같은 경로라 락아웃 규칙이
 * 그대로 걸린다.
 */
export function IntervalBuildStage({ question, locked }: StageProps) {
  if (!isIntervalBuildQuestion(question)) return null;
  const q: IntervalBuildQuestion = question;
  return (
    <div className="stack">
      <Staff lower={q.given} />
      <p className="given">
        {q.given.name} · {q.interval.name} · {q.up ? "위로" : "아래로"}
      </p>
      <Hint>{locked ? "" : "건반에서 나머지 음을 누르세요"}</Hint>
    </div>
  );
}

const STAGE_VIEWS: Partial<
  Record<Stage, (props: StageProps) => ReactElement | null>
> = {
  [Stage.IntervalCount]: IntervalCountStage,
  [Stage.IntervalTable]: IntervalTableStage,
  [Stage.IntervalId]: IntervalStage,
  [Stage.IntervalBuild]: IntervalBuildStage,
};

export function stageFor(stage: Stage) {
  return STAGE_VIEWS[stage] ?? MidiStage;
}

/**
 * 이 스테이지가 건반으로 답하는가.
 *
 * MIDI 입력과 자판 폴백이 **같은 조건**을 봐야 한다. 음정 세 단계는 숫자·성질
 * 키를 쓰므로 자판 폴백이 꺼져 있는데, 거기서 MIDI만 살아 있으면 건반을 누르는
 * 순간 엉뚱한 응답이 `Session.collect()`로 들어간다 — 채점기가 기대하는 것은
 * 화면 응답인데 MIDI 번호 배열이 오게 된다. 조건을 한 곳에 둔다.
 *
 * **"화면이 있는가"로 판정하지 않는다.** 예전에는 `STAGE_VIEWS`에 없는 것을
 * 건반 스테이지로 봤는데, 음정 해석이 화면과 건반을 **둘 다** 쓰면서 그 규칙이
 * 깨졌다(그대로 두면 그 스테이지에서 건반이 통째로 죽는다).
 */
const KEYBOARD_STAGES: ReadonlySet<Stage> = new Set([
  Stage.EarSingle,
  Stage.EarChord,
  Stage.IntervalBuild,
]);

export function usesMidiInput(stage: Stage): boolean {
  return KEYBOARD_STAGES.has(stage);
}

/** 이 스테이지에 참고표가 있는가. 옵션 화면이 "표 보기"를 낼지 정한다. */
export function usesTable(stage: Stage): boolean {
  return stage === Stage.IntervalTable;
}
