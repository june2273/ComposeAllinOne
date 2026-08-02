/**
 * 채점 — Strategy.
 *
 * 기술검토서 5절: "하나의 정답 판정 함수로 모든 상황을 커버하려 하면 실패한다.
 * 모드로 분리한다." 그래서 모드마다 클래스를 하나씩 둔다. 세션은
 * `Grader` 인터페이스만 알고, 어떤 모드인지 묻지 않는다.
 *
 * 텐션 화음의 생략음 규칙(필수음 전부 있으면 통과)은 `Question`이 들고 있는
 * requiredPcs / optionalPcs로 처리한다. 판정기가 화음 종류를 알 필요가 없다.
 */

import { GradingMode } from "./config";
import {
  type IntervalQuestion,
  type Question,
  bassOf,
  isIntervalQuestion,
  isIntervalResponse,
  responseText,
} from "./questions";
import { noteName, pitchClasses } from "./theory";

export interface Judgement {
  readonly correct: boolean;
  readonly detail: string;
}

export interface Grader {
  readonly mode: GradingMode;
  /**
   * played의 타입은 스테이지가 정한다. 청음은 MIDI 번호 배열, 화성학은
   * 화면에서 만든 응답 객체(IntervalResponse)가 온다. 생성기·채점기·화면이
   * 스테이지 단위로 함께 정해지므로 짝이 어긋날 일은 없다.
   */
  grade(question: Question, played: unknown): Judgement;
}

function asNotes(played: unknown): number[] | null {
  return Array.isArray(played) && played.every((n) => typeof n === "number")
    ? (played as number[])
    : null;
}

function wrong(question: Question, played: number[]): Judgement {
  const heard = played.length
    ? [...played].sort((a, b) => a - b).map(noteName).join(" ")
    : "없음";
  return { correct: false, detail: `정답 ${question.answerText} / 친 음 ${heard}` };
}

function right(question: Question): Judgement {
  return { correct: true, detail: question.answerText };
}

function isSubset(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * 옥타브·전위·중복을 무시하고 음고류만 본다. 코드 구성음 암기용.
 *
 * 기술검토서 3절 방침 A의 기본 채점기이기도 하다 — 이명동음을 건반 위에서
 * 구별할 수 없으므로 음고류로 채점하고 스펠링은 화면에 보여준다.
 */
export class PitchClassGrader implements Grader {
  readonly mode = GradingMode.PitchClass;
  grade(question: Question, played: unknown): Judgement {
    const notes = asNotes(played);
    if (!notes) return wrong(question, []);
    const heard = pitchClasses(notes);
    if (!isSubset(question.requiredPcs, heard)) return wrong(question, notes);
    // 생략 가능음 외의 군더더기가 섞이면 오답
    const allowed = new Set([...question.requiredPcs, ...question.optionalPcs]);
    if (!isSubset(heard, allowed)) return wrong(question, notes);
    return right(question);
  }
}

/** 음고류 + 최저음까지. 전위 훈련용. */
export class BassNoteGrader implements Grader {
  readonly mode = GradingMode.BassNote;
  private readonly pcs = new PitchClassGrader();
  grade(question: Question, played: unknown): Judgement {
    const notes = asNotes(played);
    if (!notes) return wrong(question, []);
    if (!this.pcs.grade(question, notes).correct) return wrong(question, notes);
    if (!notes.length || Math.min(...notes) % 12 !== bassOf(question) % 12) {
      return wrong(question, notes);
    }
    return right(question);
  }
}

/**
 * 보이싱까지 일치. 4성부 화성법용.
 *
 * 음 사이의 간격 배치가 같으면 전체가 옥타브 단위로 통째 이동한 것은
 * 허용한다. 옥타브까지 고정하려면 AbsolutePitch를 쓴다.
 */
export class ExactVoicingGrader implements Grader {
  readonly mode = GradingMode.ExactVoicing;
  grade(question: Question, played: unknown): Judgement {
    const notes = asNotes(played);
    if (!notes) return wrong(question, []);
    const want = [...new Set(question.answerNotes)].sort((a, b) => a - b);
    const got = [...new Set(notes)].sort((a, b) => a - b);
    if (want.length !== got.length || got.length === 0) return wrong(question, notes);
    const shift = got[0] - want[0];
    if (((shift % 12) + 12) % 12 !== 0) return wrong(question, notes);
    if (got.some((g, i) => g - want[i] !== shift)) return wrong(question, notes);
    return right(question);
  }
}

/** MIDI 번호 집합이 정확히 일치. 절대적 음높이 훈련용. */
export class AbsolutePitchGrader implements Grader {
  readonly mode = GradingMode.AbsolutePitch;
  grade(question: Question, played: unknown): Judgement {
    const notes = asNotes(played);
    if (!notes) return wrong(question, []);
    const want = new Set(question.answerNotes);
    const got = new Set(notes);
    if (want.size !== got.size || !isSubset(want, got)) return wrong(question, notes);
    return right(question);
  }
}

/**
 * 음정 세 항목(도수·반음 수·성질)을 채점한다.
 *
 * 세 항목은 서로 독립이 아니다 — 도수와 성질이 정해지면 반음 수는 하나로
 * 결정된다. 그래도 셋을 다 묻는 이유는 **반음을 세는 과정을 강제**하기
 * 위해서고, 덕분에 어디서 틀렸는지를 짚어줄 수 있다.
 *
 *   도수가 틀렸다            → 줄·칸을 잘못 셌다
 *   도수는 맞고 반음이 틀렸다  → 임시표나 반음 자리(E–F, B–C)를 놓쳤다
 *   둘 다 맞고 성질이 틀렸다   → 계산은 맞고 음정표를 못 외웠다
 */
export class IntervalGrader implements Grader {
  readonly mode = GradingMode.IntervalForm;
  grade(question: Question, played: unknown): Judgement {
    if (!isIntervalQuestion(question)) {
      throw new Error("IntervalGrader는 음정 문제에만 쓸 수 있습니다");
    }
    if (!isIntervalResponse(played)) {
      return { correct: false, detail: `정답: ${question.answerText}` };
    }

    const want = (question as IntervalQuestion).interval;
    const rightNumber = played.number === want.number;
    const rightSemitones = played.semitones === want.semitones;
    const rightQuality = played.quality === want.quality;

    if (rightNumber && rightSemitones && rightQuality) {
      return { correct: true, detail: question.answerText };
    }

    let hint: string;
    if (!rightNumber) {
      hint = "도수부터 다시 — 아래 음을 1로 두고 줄·칸을 세어 보세요";
    } else if (!rightSemitones) {
      hint = "도수는 맞습니다. 반음 자리(E–F, B–C)를 빠뜨렸는지 보세요";
    } else {
      hint = "도수와 반음 수는 맞습니다. 성질만 다시 보세요";
    }
    return {
      correct: false,
      detail: `정답: ${question.answerText}\n낸 답: ${responseText(played)} · ${hint}`,
    };
  }
}

const GRADERS: Record<GradingMode, () => Grader> = {
  [GradingMode.PitchClass]: () => new PitchClassGrader(),
  [GradingMode.BassNote]: () => new BassNoteGrader(),
  [GradingMode.ExactVoicing]: () => new ExactVoicingGrader(),
  [GradingMode.AbsolutePitch]: () => new AbsolutePitchGrader(),
  [GradingMode.IntervalForm]: () => new IntervalGrader(),
};

export function makeGrader(mode: GradingMode): Grader {
  const make = GRADERS[mode];
  if (!make) throw new Error(`알 수 없는 채점 모드: ${mode}`);
  return make();
}
