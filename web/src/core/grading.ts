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
  type KeyField,
  type Question,
  type StageResponse,
  bassOf,
  isIntervalQuestion,
  isKeyQuestion,
  isStageResponse,
  responseText,
} from "./questions";
import {
  normalizeKeyName,
  normalizeLetters,
  parseSignature,
} from "./harmony/keys";
import { noteNames, pitchClasses } from "./theory";

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
  const heard = noteNames(played, "없음");
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

// --- 음정 3단계 ---------------------------------------------------------------
//
// 셋 다 같은 문제(두 자연음)를 받고 묻는 것만 다르다. 공통 뼈대를 여기에 둔다.

/** 문제가 음정 문제임을 확인한다. 아니면 스테이지 배선이 잘못된 것이다. */
function intervalOf(question: Question): IntervalQuestion {
  if (!isIntervalQuestion(question)) {
    throw new Error("음정 채점기는 음정 문제에만 쓸 수 있습니다");
  }
  return question;
}

/**
 * 이 스테이지가 기대하는 모양의 응답인가. 아니면 `null`.
 *
 * null이 되는 경우는 둘이다 — 시간 초과(응답 자체가 없다)와 다른 스테이지의
 * 응답이 흘러든 경우. 어느 쪽이든 채점할 것이 없으므로 정답만 보여준다.
 */
function responseOf<F extends StageResponse["form"]>(
  played: unknown,
  form: F,
): Extract<StageResponse, { form: F }> | null {
  return isStageResponse(played) && played.form === form
    ? (played as Extract<StageResponse, { form: F }>)
    : null;
}

function answerOnly(question: Question): Judgement {
  return { correct: false, detail: `정답: ${question.answerText}` };
}

/** 임시표가 붙은 문제인가. 붙었으면 안내가 골격까지 짚어야 한다 */
function isAltered(q: IntervalQuestion): boolean {
  return q.lower.alter !== 0 || q.upper.alter !== 0;
}

/**
 * 골격에서 사다리를 몇 칸 옮겨야 하는지 짚어 준다.
 *
 * 반음계 문제에서 "반음이 n개이므로 X음정입니다"는 **틀린 안내다** — 그 반음
 * 개수가 가리키는 것은 임시표를 뗀 골격이기 때문이다(theory의
 * `diatonicHalfSteps` 주석의 ②). ④까지 말해 줘야 답이 된다.
 */
function ladderHint(q: IntervalQuestion): string {
  const shift = q.interval.semitones - q.skeleton.semitones;
  const way = shift > 0 ? "넓히므로" : "좁히므로";
  return (
    `${q.interval.number}도에 반음 ${q.halfSteps}개면 골격이 ${q.skeleton.name}이고, ` +
    `임시표가 ${Math.abs(shift)}칸 ${way} ${q.interval.name}입니다`
  );
}

/** 성질이 틀렸을 때의 안내. 임시표 유무로 갈린다 */
function qualityHint(q: IntervalQuestion): string {
  return isAltered(q)
    ? ladderHint(q)
    : `${q.interval.number}도에 반음 ${q.halfSteps}개는 ${q.interval.quality}음정입니다`;
}

function missed(question: Question, played: StageResponse, hint: string): Judgement {
  return {
    correct: false,
    detail: `정답: ${question.answerText}\n낸 답: ${responseText(played)} · ${hint}`,
  };
}

/**
 * 연습 1 — 도수와 **온음계적 반음 개수**를 채점한다.
 *
 * 성질을 묻지 않는 것이 이 단계의 전부다. 표를 외우기 전에 세는 법부터
 * 익히게 하려는 것이고, 그래서 틀린 자리도 둘 중 하나로만 짚어진다.
 */
export class IntervalCountGrader implements Grader {
  readonly mode = GradingMode.IntervalCount;
  grade(question: Question, played: unknown): Judgement {
    const want = intervalOf(question);
    const got = responseOf(played, "count");
    if (!got) return answerOnly(want);

    const rightNumber = got.number === want.interval.number;
    const rightHalf = got.halfSteps === want.halfSteps;
    if (rightNumber && rightHalf) return { correct: true, detail: want.answerText };

    return missed(
      want,
      got,
      rightNumber
        ? "도수는 맞습니다. 임시표는 빼고, 두 음 사이에 미–파와 시–도가 몇 번 " +
          "나오는지 다시 세어 보세요"
        : "도수부터 다시 — 아래 음을 1로 두고 줄·칸을 세어 보세요",
    );
  }
}

/**
 * 연습 2 — 성질만 채점한다. 도수와 반음 개수는 문제가 알려준 값이다.
 *
 * 계산이 빠졌으므로 틀렸다면 원인은 하나뿐이다: 표를 못 외웠다.
 */
export class IntervalQualityGrader implements Grader {
  readonly mode = GradingMode.IntervalQuality;
  grade(question: Question, played: unknown): Judgement {
    const want = intervalOf(question);
    const got = responseOf(played, "quality");
    if (!got) return answerOnly(want);

    if (got.quality === want.interval.quality) {
      return { correct: true, detail: want.answerText };
    }
    return missed(want, got, qualityHint(want));
  }
}

/**
 * 본 단계 — 도수와 성질을 채점한다.
 *
 * 반음 개수는 묻지 않는다. 머릿속에서 세는 것이 이 단계의 목표이므로 화면에
 * 적게 하면 오히려 연습 1로 되돌아간다. 대신 **틀렸을 때 반음 개수를 알려줘서**
 * 어느 단계로 돌아가야 하는지 보이게 한다.
 *
 *   도수가 틀렸다          → 줄·칸을 잘못 셌다 (연습 1)
 *   도수는 맞고 성질이 틀렸다 → 반음을 잘못 셌거나 표를 못 외웠다 (연습 1·2)
 */
export class IntervalGrader implements Grader {
  readonly mode = GradingMode.IntervalForm;
  grade(question: Question, played: unknown): Judgement {
    const want = intervalOf(question);
    const got = responseOf(played, "interval");
    if (!got) return answerOnly(want);

    const rightNumber = got.number === want.interval.number;
    const rightQuality = got.quality === want.interval.quality;
    if (rightNumber && rightQuality) return { correct: true, detail: want.answerText };

    return missed(
      want,
      got,
      rightNumber
        ? `도수는 맞습니다. ${qualityHint(want)}`
        : "도수부터 다시 — 아래 음을 1로 두고 줄·칸을 세어 보세요",
    );
  }
}

/**
 * 음계 — **순서가 맞고 실수가 0일 때만 정답이다.**
 *
 * 안내형 연습이라 틀린 음은 수집기가 애초에 거부한다. 그래서 사용자는 언제나
 * 여덟 음을 끝까지 치게 되고, 갈리는 것은 **가다가 몇 번 틀렸는가**뿐이다.
 * 그 값이 `SequenceResponse.mistakes`로 올라온다.
 *
 * 순서 검사는 실행 중에는 늘 참이다(거부된 음이 배열에 없으므로). **그래도
 * 둔다** — 수집기가 깨졌을 때 그것을 잡는 자리가 여기뿐이고, 진단 문구가
 * "순서가 다르다"로 나오면 버그의 위치가 바로 특정된다.
 */
export class ScaleGrader implements Grader {
  readonly mode = GradingMode.Scale;
  grade(question: Question, played: unknown): Judgement {
    const got = responseOf(played, "sequence");
    if (!got) return answerOnly(question);

    const want = question.answerNotes;
    if (got.notes.length !== want.length || got.notes.some((n, i) => n !== want[i])) {
      return {
        correct: false,
        detail: `정답: ${question.answerText}\n친 순서가 다릅니다`,
      };
    }
    if (got.mistakes > 0) {
      return {
        correct: false,
        detail:
          `정답: ${question.answerText}\n` +
          `끝까지 쳤지만 가는 동안 ${got.mistakes}번 틀렸습니다`,
      };
    }
    return { correct: true, detail: question.answerText };
  }
}

/**
 * 조표·5도권 — **칸마다 따로 본다.**
 *
 * 비교 규칙은 문제가 칸마다 들고 있고(`KeyField.kind`), 채점기는 그 규칙대로
 * 다듬어 `accept` 목록과 맞춰 볼 뿐이다 — **조표를 여기서 다시 계산하지 않는다.**
 * 계산이 두 곳에 있으면 갈린다.
 *
 * 틀렸을 때 **어느 칸이 틀렸는지 짚어 준다.** 두 칸짜리 유형에서 "둘 다 틀렸다"와
 * "나란한조만 틀렸다"는 다음에 무엇을 복습할지가 다르다.
 */
export class KeyFieldGrader implements Grader {
  readonly mode = GradingMode.KeyField;
  grade(question: Question, played: unknown): Judgement {
    const got = responseOf(played, "fields");
    if (!got || !isKeyQuestion(question)) return answerOnly(question);

    const fields = question.fields;
    const missed: string[] = [];
    fields.forEach((field, i) => {
      if (!matchesField(field, got.values[i] ?? "")) missed.push(field.label);
    });

    if (missed.length === 0) {
      return { correct: true, detail: question.answerText };
    }
    const which =
      missed.length === fields.length && fields.length > 1
        ? "전부"
        : `${missed.join("·")} 칸이`;
    return {
      correct: false,
      detail: `정답: ${question.answerText}\n${which} 틀렸습니다`,
    };
  }
}

/** 칸 하나를 규칙대로 다듬어 맞춰 본다 */
function matchesField(field: KeyField, typed: string): boolean {
  if (field.kind === "letters") {
    const want = field.accept.map((a) => normalizeLetters(a));
    const mine = normalizeLetters(typed);
    // "없음"을 빈칸이나 0으로 적는 것도 받아준다
    if (want.includes("")) return mine === "" || /^[0-]$/u.test(typed.trim());
    return mine !== "" && want.includes(mine);
  }
  if (field.kind === "signature") {
    const mine = parseSignature(typed);
    if (mine === null) return false;
    return field.accept.some((a) => parseSignature(a) === mine);
  }
  const mine = normalizeKeyName(typed);
  if (mine === "") return false;
  return field.accept.some((a) => normalizeKeyName(a) === mine);
}

const GRADERS: Record<GradingMode, () => Grader> = {
  [GradingMode.PitchClass]: () => new PitchClassGrader(),
  [GradingMode.BassNote]: () => new BassNoteGrader(),
  [GradingMode.ExactVoicing]: () => new ExactVoicingGrader(),
  [GradingMode.AbsolutePitch]: () => new AbsolutePitchGrader(),
  [GradingMode.IntervalCount]: () => new IntervalCountGrader(),
  [GradingMode.IntervalQuality]: () => new IntervalQualityGrader(),
  [GradingMode.IntervalForm]: () => new IntervalGrader(),
  [GradingMode.Scale]: () => new ScaleGrader(),
  [GradingMode.KeyField]: () => new KeyFieldGrader(),
};

export function makeGrader(mode: GradingMode): Grader {
  const make = GRADERS[mode];
  if (!make) throw new Error(`알 수 없는 채점 모드: ${mode}`);
  return make();
}
