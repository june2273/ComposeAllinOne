/**
 * 스테이지별 "문제 표시 + 답 입력".
 *
 * 청음처럼 MIDI 건반으로 답하는 스테이지는 화면에 낼 것이 없고, 화성학처럼
 * 화면에서 답을 만드는 스테이지는 `onAnswer`로 응답을 올려보낸다.
 * `stageFor()`에 분기 한 줄을 더하면 새 스테이지가 붙는다.
 *
 * ## 음정 3단계
 *
 * 한 과목을 세 단계로 쪼갠 것이라 화면도 셋이다. 문제(두 자연음)는 같고
 * **무엇을 묻고 무엇으로 답하는가**만 다르다.
 *
 * | 스테이지 | 묻는 것 | 입력 | 제출 |
 * |---|---|---|---|
 * | `IntervalCountStage` | 도수 + 반음 개수 | 숫자 키 | Enter |
 * | `IntervalTableStage` | 성질 | 버튼(마우스)·글자 키 | 고르는 즉시 |
 * | `IntervalStage` | 도수 + 성질 | 숫자 키 + 버튼 | 둘 다 차면 |
 *
 * 제출 규칙이 스테이지마다 다른 것은 의도다. **여러 자리 숫자를 받는 칸이
 * 있으면 "칸이 다 차면 제출"을 쓸 수 없다** — 반음 개수 12를 치려고 1을 누른
 * 순간 제출된다. 지금은 도수도 반음 개수도 한 자리라 그 함정이 없지만,
 * 연습 1만은 오타를 고칠 여지를 두려고 Enter를 남겼다.
 */

import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
} from "react";

import { Stage } from "../core/config";
import {
  type CountResponse,
  type IntervalQuestion,
  type IntervalResponse,
  type QualityResponse,
  type Question,
  isIntervalQuestion,
} from "../core/questions";
import {
  AUGMENTED,
  DIMINISHED,
  MAJOR,
  MINOR,
  PERFECT,
} from "../core/theory";
import {
  ChoiceRow,
  Hint,
  KeyCaps,
  Matrix,
  type MatrixProps,
  NumberField,
} from "../ds";
import { Staff } from "./components";

export interface StageProps {
  question: Question;
  /** 채점이 끝나 입력을 잠가야 하는 상태 */
  locked: boolean;
  /** 참고표를 함께 띄운다 (옵션에서 켠다) */
  showTable?: boolean;
  onAnswer: (response: unknown) => void;
}

/**
 * 성질 다섯 가지 — 답으로 올라가는 값(`quality`), 원어 이름, 자판 단축키.
 *
 * 단축키에 알파벳을 쓰는 것은 한글 입력기가 켜져 있어도 눌리기 때문이다.
 * Perfect / Major / miNor / Augmented / Diminished.
 *
 * **단(minor)이 N인 것은 M을 장(Major)이 먼저 가져갔기 때문이다.** 교재
 * 표기로는 m이지만 대소문자로 가르면 Shift 여부가 정답을 바꾸게 된다. 그래서
 * 화면이 `N — 단`을 키캡으로 늘 함께 보인다(아래 `QualityPicker`).
 */
export const QUALITIES: ReadonlyArray<{
  readonly quality: string;
  readonly label: string;
  readonly key: string;
}> = [
  { quality: PERFECT, label: "Perfect", key: "P" },
  { quality: MAJOR, label: "Major", key: "M" },
  { quality: MINOR, label: "minor", key: "N" },
  { quality: AUGMENTED, label: "aug", key: "A" },
  { quality: DIMINISHED, label: "dim", key: "D" },
];

const QUALITY_CHOICES = QUALITIES.map(
  ({ quality, label }) => [quality, label] as const,
);
const QUALITY_CAPS = QUALITIES.map(({ key, quality }) => [key, quality] as const);

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

/** MIDI 건반으로 답하는 스테이지. 화면에 낼 것이 없다. */
export function MidiStage(_: StageProps) {
  return null;
}

// --- 세 음정 스테이지가 공유하는 부분 --------------------------------------------

const DIGIT = /^[0-9]$/u;
const ERASE = ["Backspace", "Delete"];
const MOVE = ["Tab", "ArrowLeft", "ArrowRight"];

/** 눌린 키가 성질 단축키면 그 성질. 대소문자를 가리지 않는다. */
function qualityForKey(key: string): string | undefined {
  const upper = key.toUpperCase();
  return QUALITIES.find((q) => q.key === upper)?.quality;
}

/** 그 성질의 단축키 글자. 키캡을 어디에 불 켤지 정한다. */
function keyForQuality(quality: string | null): string | null {
  return QUALITIES.find((q) => q.quality === quality)?.key ?? null;
}

/**
 * 성질 고르기 — 선택지 버튼 + 그 아래 자판 안내.
 *
 * 두 줄이 같은 `onPick`으로 모이므로 **마우스와 자판이 같은 동작**이다.
 * 키캡을 눌러도 되고 실제 키를 눌러도 된다.
 */
function QualityPicker({
  selected,
  disabled,
  onPick,
}: {
  selected?: string | null;
  disabled?: boolean;
  onPick: (quality: string) => void;
}) {
  return (
    <div className="answer">
      <ChoiceRow
        choices={QUALITY_CHOICES}
        selected={selected}
        disabled={disabled}
        onPick={onPick}
      />
      <KeyCaps
        keys={QUALITY_CAPS}
        active={keyForQuality(selected ?? null)}
        disabled={disabled}
        onPress={(key) => {
          const quality = qualityForKey(key);
          if (quality) onPick(quality);
        }}
      />
    </div>
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
  | { type: "digit"; digit: number }
  | { type: "back" }
  | { type: "toggleField" }
  | { type: "submit" };

const COUNT_FIRST_HINT = "도수를 세어 숫자 키로 입력하세요";
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

    case "digit":
      if (state.field === 0) {
        if (action.digit < 1) return { ...state, hint: "도수는 1~9입니다" };
        return {
          ...state,
          number: action.digit,
          field: 1,
          hint: "반음(미–파·시–도)이 몇 개인지 입력하세요",
        };
      }
      // 반음 개수는 한 자리다(홑음정에서 최대 2개). 덧쓰기로 둔다.
      return { ...state, halfSteps: action.digit, hint: "Enter로 제출합니다" };

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
 */
export function IntervalCountStage({ question, locked, onAnswer }: StageProps) {
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
    useCallback(({ key }: KeyboardEvent) => {
      if (key === "Enter") dispatch({ type: "submit" });
      else if (DIGIT.test(key)) dispatch({ type: "digit", digit: Number(key) });
      else if (ERASE.includes(key)) dispatch({ type: "back" });
      else if (MOVE.includes(key)) dispatch({ type: "toggleField" });
      else return false;
      return true;
    }, []),
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
 * 계산을 빼고 표만 남긴 단계다. 옵션에서 표 보기를 켜면 보면서 풀 수 있다 —
 * 처음에는 보고 고르다가, 익으면 끄는 것이 이 스테이지의 쓰임새다.
 */
export function IntervalTableStage({
  question,
  locked,
  showTable,
  onAnswer,
}: StageProps) {
  const choose = useCallback(
    (quality: string) => {
      onAnswer({ form: "quality", quality } satisfies QualityResponse);
    },
    [onAnswer],
  );

  useKeys(
    locked,
    useCallback(
      ({ key }: KeyboardEvent) => {
        const quality = qualityForKey(key);
        if (quality) choose(quality);
        return quality !== undefined;
      },
      [choose],
    ),
  );

  if (!isIntervalQuestion(question)) return null;

  return (
    <IntervalFrame
      question={question}
      hint={locked ? "" : "표에서 성질을 찾아 고르세요"}
    >
      <p className="given">
        {question.interval.number}도 · 반음 {question.halfSteps}개
      </p>
      <QualityPicker disabled={locked} onPick={choose} />
      {showTable && <IntervalTables />}
    </IntervalFrame>
  );
}

// --- 본 단계: 음정 구분 ---------------------------------------------------------

/**
 * 본 단계 — 두 음만 보고 성질과 도수를 답한다.
 *
 * 반음 개수는 입력하지 않는다. 세는 것은 머릿속에서 끝내야 하고, 화면에
 * 적게 하면 연습 1로 되돌아가는 셈이 된다.
 *
 * 순서를 강제하지 않는 것도 의도다 — 성질을 먼저 고르든 도수를 먼저 치든
 * **둘이 다 차는 순간 제출된다.** 둘 다 한 번의 동작이라(클릭 하나, 숫자 하나)
 * 여러 자리 입력이 중간에 잘리는 문제가 없다.
 */
interface PickState {
  number: number | null;
  quality: string | null;
}

type PickAction =
  | { type: "reset" }
  | { type: "digit"; digit: number }
  | { type: "quality"; quality: string };

const EMPTY_PICK: PickState = { number: null, quality: null };

function reducePick(state: PickState, action: PickAction): PickState {
  switch (action.type) {
    case "reset":
      return EMPTY_PICK;
    case "digit":
      return action.digit < 1 ? state : { ...state, number: action.digit };
    case "quality":
      return { ...state, quality: action.quality };
  }
}

export function IntervalStage({ question, locked, onAnswer }: StageProps) {
  const [input, dispatch] = useReducer(reducePick, EMPTY_PICK);
  useResetOnQuestion(question, dispatch);

  // 연습 1과 같은 이유로 제출을 이펙트에 둔다 — 두 입력이 한 태스크에 묶여도
  // 리듀서를 거친 최신 상태만 보고 판단한다.
  useEffect(() => {
    if (locked || input.number === null || input.quality === null) return;
    onAnswer({
      form: "interval",
      number: input.number,
      quality: input.quality,
    } satisfies IntervalResponse);
  }, [input.number, input.quality, locked, onAnswer]);

  const choose = useCallback((quality: string) => {
    dispatch({ type: "quality", quality });
  }, []);

  useKeys(
    locked,
    useCallback(({ key }: KeyboardEvent) => {
      const quality = qualityForKey(key);
      if (quality) dispatch({ type: "quality", quality });
      else if (DIGIT.test(key)) dispatch({ type: "digit", digit: Number(key) });
      else if (ERASE.includes(key)) dispatch({ type: "reset" });
      else return false;
      return true;
    }, []),
  );

  if (!isIntervalQuestion(question)) return null;

  return (
    <IntervalFrame
      question={question}
      hint={
        locked
          ? ""
          : input.quality === null
            ? "성질을 고르세요"
            : "도수를 숫자 키로 입력하세요"
      }
    >
      {/*
        **성질이 먼저다.** 음정의 이름은 "장3도"지 "3도 장"이 아니다 —
        `Interval.name`도 `responseText`도 그 순서로 적으므로, 입력 칸만 반대면
        답을 만드는 동안 본 것과 채점 결과에 적힌 것이 뒤집혀 보인다.
        (고르는 순서는 여전히 자유다. 보이는 순서만 고정한 것이다.)
      */}
      <div className="interval__fields">
        <span
          className={`field field--text${input.quality ? "" : " field--empty field--active"}`}
        >
          {input.quality ?? "–"}
        </span>
        <NumberField value={input.number} active={input.number === null} unit="도" />
      </div>
      <QualityPicker
        selected={input.quality}
        disabled={locked}
        onPick={choose}
      />
    </IntervalFrame>
  );
}

const STAGE_VIEWS: Partial<
  Record<Stage, (props: StageProps) => ReactElement | null>
> = {
  [Stage.IntervalCount]: IntervalCountStage,
  [Stage.IntervalTable]: IntervalTableStage,
  [Stage.IntervalId]: IntervalStage,
};

export function stageFor(stage: Stage) {
  return STAGE_VIEWS[stage] ?? MidiStage;
}

/**
 * 이 스테이지가 건반으로 답하는가.
 *
 * MIDI 입력과 자판 폴백이 **같은 조건**을 봐야 한다. 음정 스테이지는 숫자·성질
 * 키를 쓰므로 자판 폴백이 꺼져 있는데, 거기서 MIDI만 살아 있으면 건반을 누르는
 * 순간 엉뚱한 응답이 `Session.collect()`로 들어간다 — 채점기가 기대하는 것은
 * 화면 응답인데 MIDI 번호 배열이 오게 된다. 조건을 한 곳에 둔다.
 */
export function usesMidiInput(stage: Stage): boolean {
  return !(stage in STAGE_VIEWS);
}

/** 이 스테이지에 참고표가 있는가. 옵션 화면이 "표 보기"를 낼지 정한다. */
export function usesTable(stage: Stage): boolean {
  return stage === Stage.IntervalTable;
}
