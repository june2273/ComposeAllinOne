/**
 * 스테이지별 "문제 표시 + 답 입력".
 *
 * 청음처럼 MIDI 건반으로 답하는 스테이지는 화면에 낼 것이 없고, 화성학처럼
 * 화면에서 답을 만드는 스테이지는 `onAnswer`로 응답을 올려보낸다.
 * `stageFor()`에 분기 한 줄을 더하면 새 스테이지가 붙는다.
 */

import { useCallback, useEffect, useReducer } from "react";

import { Stage } from "../core/config";
import {
  type IntervalResponse,
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
import { ChoiceRow, Hint, NumberField } from "../ds";
import { Staff } from "./components";

export interface StageProps {
  question: Question;
  /** 채점이 끝나 입력을 잠가야 하는 상태 */
  locked: boolean;
  onAnswer: (response: unknown) => void;
}

/**
 * 성질 선택 단축키. 한글 입력기가 켜져 있어도 눌리도록 알파벳을 쓴다.
 * Perfect / Major / miNor / Augmented / Diminished
 */
export const QUALITY_KEYS: ReadonlyArray<readonly [string, string]> = [
  [PERFECT, "P"],
  [MAJOR, "M"],
  [MINOR, "N"],
  [AUGMENTED, "A"],
  [DIMINISHED, "D"],
];

/** MIDI 건반으로 답하는 스테이지. 화면에 낼 것이 없다. */
export function MidiStage(_: StageProps) {
  return null;
}

/**
 * 음정 구분 — 오선지 + 세 항목 입력.
 *
 * 입력 순서를 도수 → 반음 수 → 성질로 고정했다. 두 가지 이유가 있다.
 *
 * 1. 실제로 음정을 판별하는 순서와 같다(줄·칸을 세고, 반음을 세고, 표에서
 *    성질을 읽는다). 순서를 강제하는 것 자체가 연습이다.
 * 2. 성질 선택이 곧 제출이라 키를 서너 번만 누르면 끝난다. 반대로 자동
 *    제출을 "세 칸이 다 차면"으로 두면, 반음 수 12를 치려고 1을 누른
 *    순간 제출되어 버린다.
 *
 * 겹증·겹감을 넣을 때는 `QUALITY_KEYS`에 두 줄을 더하면 된다 — theory는
 * 이미 계산한다.
 */
interface InputState {
  number: number | null;      // 도수
  semitones: number | null;   // 반음 수
  field: 0 | 1;               // 지금 입력받는 칸 (0=도수, 1=반음)
  hint: string;
}

type InputAction =
  | { type: "reset" }
  | { type: "digit"; digit: number }
  | { type: "back" }
  | { type: "toggleField" }
  | { type: "needBoth" };

const FIRST_HINT = "도수를 세어 숫자 키로 입력하세요";
const EMPTY_INPUT: InputState = {
  number: null,
  semitones: null,
  field: 0,
  hint: FIRST_HINT,
};
const MAX_SEMITONES = 24;

/**
 * 입력 상태를 순수 함수 하나로 모은다.
 *
 * **`useState` 여러 개로 두면 안 된다**(실측). 이전 구현은 `setField`
 * 업데이터 안에서 `setSemitones`를 불렀는데, React는 StrictMode에서 업데이터를
 * 두 번 실행하므로 숫자가 두 번 반영됐다 — `12`를 치면 `22`가 됐다. 리듀서는
 * 순수해서 몇 번 실행돼도 결과가 같다.
 */
function reduceInput(state: InputState, action: InputAction): InputState {
  switch (action.type) {
    case "reset":
      return EMPTY_INPUT;

    case "digit": {
      if (state.field === 0) {
        if (action.digit < 1) return { ...state, hint: "도수는 1~9입니다" };
        // 도수는 한 자리라 바로 다음 칸으로
        return {
          ...state,
          number: action.digit,
          field: 1,
          hint: "반음 수를 세어 입력하세요 (두 자리 가능)",
        };
      }
      const grown =
        state.semitones === null
          ? action.digit
          : state.semitones * 10 + action.digit;
      return {
        ...state,
        semitones: grown <= MAX_SEMITONES ? grown : action.digit,
        hint: "성질을 고르면 제출됩니다",
      };
    }

    case "back":
      if (state.field === 1 && state.semitones !== null) {
        return {
          ...state,
          semitones: state.semitones < 10 ? null : Math.floor(state.semitones / 10),
        };
      }
      if (state.field === 1) return { ...state, field: 0 };
      return { ...state, number: null };

    case "toggleField":
      return { ...state, field: state.field === 0 ? 1 : 0 };

    case "needBoth":
      return { ...state, hint: "도수와 반음 수를 먼저 입력하세요" };
  }
}

export function IntervalStage({ question, locked, onAnswer }: StageProps) {
  const [input, dispatch] = useReducer(reduceInput, EMPTY_INPUT);

  // 새 문제가 오면 입력을 비운다
  const questionKey = question.answerText;
  useEffect(() => {
    dispatch({ type: "reset" });
  }, [questionKey]);

  const choose = useCallback(
    (quality: string) => {
      if (locked) return;
      if (input.number === null || input.semitones === null) {
        dispatch({ type: "needBoth" });
        return;
      }
      onAnswer({
        number: input.number,
        semitones: input.semitones,
        quality,
      } satisfies IntervalResponse);
    },
    [input.number, input.semitones, locked, onAnswer],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (locked) return;
      const key = event.key.toUpperCase();

      const quality = QUALITY_KEYS.find(([, letter]) => letter === key);
      if (quality) {
        event.preventDefault();
        choose(quality[0]);
        return;
      }
      if (/^[0-9]$/u.test(event.key)) {
        event.preventDefault();
        dispatch({ type: "digit", digit: Number(event.key) });
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        dispatch({ type: "back" });
        return;
      }
      if (["Tab", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        dispatch({ type: "toggleField" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, locked]);

  if (!isIntervalQuestion(question)) return null;

  return (
    <div className="stack">
      <Staff lower={question.lower} upper={question.upper} />

      <div className="interval__fields">
        <NumberField value={input.number} active={input.field === 0} unit="도" />
        <NumberField
          value={input.semitones}
          active={input.field === 1}
          unit="반음"
        />
      </div>

      <ChoiceRow choices={QUALITY_KEYS} disabled={locked} onPick={choose} />

      <Hint>{locked ? "" : input.hint}</Hint>
    </div>
  );
}

export function stageFor(stage: Stage) {
  return stage === Stage.IntervalId ? IntervalStage : MidiStage;
}
