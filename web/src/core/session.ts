/**
 * 세션 상태 기계 — React를 모른다.
 *
 * UI에서 분리한 이유는 두 가지다.
 *
 * 1. 테스트. 이 클래스만으로 세션 전체를 돌릴 수 있어서 브라우저를 띄우거나
 *    컴포넌트를 렌더할 필요가 없다.
 * 2. 기술검토서 4절의 락아웃·화음 확정 규칙이 이벤트 핸들러에 흩어지면
 *    "문제가 저절로 틀린 채 넘어가는" 버그를 재현·검증하기 어렵다.
 *    여기서는 `accepting` 게이트가 한 곳에만 있다.
 *
 * 시간은 이 클래스가 재지 않는다. 호출자(컨트롤러)가 경과 시간을 넘긴다 —
 * 실제 타이머든 테스트의 가짜 시계든 상관없게 하기 위해서다.
 */

import type { SessionConfig } from "./config";
import type { Grader } from "./grading";
import {
  type Question,
  type QuestionGenerator,
  type SequenceResponse,
  matchesTags,
} from "./questions";

export const Phase = {
  Idle: "idle",           // 시작 전
  Lockout: "lockout",     // 문제는 정해졌으나 입력을 받지 않는다 (4절)
  Listening: "listening", // 입력 대기
  Feedback: "feedback",   // 채점 결과 표시 중
  Paused: "paused",       // 일시정지 — 어디서든 들어오고 왔던 곳으로 돌아간다
  Finished: "finished",   // 세션 종료
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export interface Result {
  readonly index: number;
  readonly question: Question;
  /**
   * 사용자가 낸 답. 청음이면 MIDI 번호 배열, 화성학이면 응답 객체.
   * null이면 시간 초과다.
   */
  readonly response: unknown | null;
  readonly correct: boolean;
  readonly detail: string;
  readonly seconds: number;
}

export function timedOut(result: Result): boolean {
  return result.response === null;
}

/**
 * 건반 입력을 모으는 규칙 — **전략이다.**
 *
 * `Grader`·`QuestionGenerator`와 같은 자리에 있다. 입력의 **형태**가 스테이지마다
 * 다르기 때문이다: 화음은 **집합**(동시에 누른 것을 한 덩어리로)이고, 음계는
 * **순서**(한 음씩, 정해진 차례로, 길이로 끝난다)다. 분기로 두면 "언제 확정하는가"가
 * 뒤엉킨다 — 한쪽은 조용해지면 끝이고 다른 쪽은 다 차면 끝이다.
 *
 * 어느 것을 쓸지는 `SessionConfig.inputForm`이 정한다.
 *
 * **`reset`과 `discard`를 가른 것이 핵심이다.** 예전에는 `clear()` 하나였는데,
 * 그 하나가 "문제가 바뀐다"와 "멈추는 동안 버퍼를 비운다" 둘을 겸하고 있었다.
 * 순차 입력에서는 둘이 정반대다 — 일시정지가 실수 횟수까지 지우면 **ESC가 점수
 * 치트가 된다**(세 음 틀린 뒤 멈췄다 다시 치면 정답이 된다).
 */
export interface InputCollector {
  /** 받아들였고 **지금 확정해도 되면** true */
  add(note: number): boolean;
  /** 모은 것을 꺼내고 비운다 */
  take(): number[];
  /** 문제가 바뀐다 — 기대값을 갈아끼우고 진행·실수를 전부 지운다 */
  reset(expected?: readonly number[]): void;
  /** 버퍼에 남은 입력만 버린다(일시정지). **진행과 실수는 남는다** */
  discard(): void;
  readonly pending: boolean;
  /** 지금까지 받아들인 음 — 화면이 진행을 그린다 */
  readonly progress: readonly number[];
  /** 거부한 입력 횟수. 집합 수집기는 늘 0 */
  readonly mistakes: number;
}

/**
 * 기술검토서 4절 — 마지막 note-on 이후 holdMs 동안 조용하면 화음 확정.
 *
 * 타이머는 여기 없다. `add()`가 true를 돌려주면 즉시 확정, false면
 * 호출자가 holdMs짜리 타이머를 (다시) 걸고 만료 시 `take()`를 부른다.
 * holdMs=0이면 첫 음을 즉시 확정하므로 1음 청음의 현재 동작과 같다.
 *
 * **동작은 `InputCollector`가 생기기 전과 한 줄도 다르지 않다** — `reset`과
 * `discard`가 둘 다 예전의 `clear()`이고, 거부하는 입력이 없으므로 `mistakes`는
 * 늘 0이다.
 */
export class NoteCollector implements InputCollector {
  readonly holdMs: number;
  private notes: number[] = [];
  constructor(holdMs = 0) {
    this.holdMs = holdMs;
  }

  add(note: number): boolean {
    if (!this.notes.includes(note)) this.notes.push(note);
    return this.holdMs <= 0;
  }
  take(): number[] {
    const out = this.notes;
    this.notes = [];
    return out;
  }
  reset(): void {
    this.notes = [];
  }
  discard(): void {
    this.notes = [];
  }
  get pending(): boolean {
    return this.notes.length > 0;
  }
  get progress(): readonly number[] {
    return this.notes;
  }
  get mistakes(): number {
    return 0;
  }
}

/**
 * 순서대로 한 음씩 — 음계가 쓴다.
 *
 * `NoteCollector`와 셋이 다르고, 그래서 합치지 않았다.
 *
 * 1. **중복을 안 버린다.** 같은 음을 두 번 틀리면 두 번이다.
 *    (상행 한 옥타브에는 같은 음이 두 번 안 나오므로 지금은 안 걸리지만,
 *    하행을 넣으면 꼭대기 음이 두 번 나온다.)
 * 2. **반환값이 내용의 함수다.** 기대한 음이 와야 받고, 다 차야 true를 준다.
 * 3. **틀린 음을 받지 않는다.** 악보에 안 찍히고 진행도 안 가며, 횟수만 센다 —
 *    안내형 연습이라 사용자는 맞을 때까지 다시 친다.
 */
export class SequenceCollector implements InputCollector {
  private expected: readonly number[] = [];
  private accepted: number[] = [];
  private wrong = 0;
  /** 채점에 넘겼는가. 넘긴 뒤에도 **진행은 화면에 남는다**(아래 `take` 주석) */
  private consumed = false;

  add(note: number): boolean {
    // 다 찬 뒤의 입력은 실수로 세지 않는다 — 확정과 채점 사이의 잔여 입력이다
    if (this.consumed || this.accepted.length >= this.expected.length) return false;
    if (note !== this.expected[this.accepted.length]) {
      this.wrong += 1;
      return false;
    }
    this.accepted.push(note);
    return this.accepted.length === this.expected.length;
  }
  /**
   * **비우지 않는다.** `NoteCollector`는 꺼내면서 버리지만 여기서는 그러면
   * 완성된 음계가 채점되는 순간 악보에서 사라진다 — 다 친 음계를 피드백
   * 동안 눈에 남기는 것이 이 연습의 목적 자체다(실측으로 걸렸다).
   * 실제로 지우는 것은 다음 문제의 `reset()`이다.
   */
  take(): number[] {
    this.consumed = true;
    return [...this.accepted];
  }
  reset(expected: readonly number[] = this.expected): void {
    this.expected = expected;
    this.accepted = [];
    this.wrong = 0;
    this.consumed = false;
  }
  /** **아무것도 안 한다.** 받아들인 음은 버퍼가 아니라 이미 맞힌 진행이다 */
  discard(): void {}
  get pending(): boolean {
    return this.accepted.length > 0 && !this.consumed;
  }
  get progress(): readonly number[] {
    return this.accepted;
  }
  get mistakes(): number {
    return this.wrong;
  }
  /** 다음에 와야 하는 음. 다 찼으면 null */
  get next(): number | null {
    return this.accepted.length < this.expected.length
      ? this.expected[this.accepted.length]
      : null;
  }
}

/**
 * 문제 큐·점수·진행 상태. 생성자로 전략을 주입받는다(DIP).
 *
 * 생성기와 채점기를 밖에서 넣기 때문에, 화음 문제나 다른 채점 모드를
 * 붙일 때 이 클래스는 한 줄도 바뀌지 않는다.
 */
export class Session {
  readonly collector: InputCollector;
  phase: Phase = Phase.Idle;
  index = 0;
  score = 0;
  current: Question | null = null;
  results: Result[] = [];
  private plays = 0;

  readonly config: SessionConfig;
  private readonly generator: QuestionGenerator;
  private readonly grader: Grader;

  constructor(
    config: SessionConfig,
    generator: QuestionGenerator,
    grader: Grader,
  ) {
    this.config = config;
    this.generator = generator;
    this.grader = grader;
    // 입력의 형태가 수집기를 고른다. 새 스테이지가 늘어도 이 줄만 본다.
    this.collector =
      config.inputForm === "sequence"
        ? new SequenceCollector()
        : new NoteCollector(config.chordHoldMs);
  }

  // --- 진행 ---------------------------------------------------------------

  start(): void {
    this.phase = Phase.Idle;
    this.index = 0;
    this.score = 0;
    this.current = null;
    this.results = [];
    this.collector.reset([]);
    this.resumePhase = null;
  }

  /** 다음 문제를 뽑고 락아웃 상태로 들어간다. null이면 세션 종료. */
  nextQuestion(): Question | null {
    const limit = this.config.questionCount;
    // 무한 라운드(null)에서는 이 조건이 영영 참이 되지 않는다. 끝내는 것은
    // 사용자(ESC → 그만두기)뿐이다.
    if (limit !== null && this.index >= limit) {
      this.phase = Phase.Finished;
      this.current = null;
      return null;
    }
    this.index += 1;
    this.current = this.draw();
    this.phase = Phase.Lockout;
    this.plays = 0;
    // 순차 수집기는 **이 문제의 답 순서**를 알아야 받아들일지 정한다.
    // 집합 수집기는 인자를 무시하므로 분기가 필요 없다.
    this.collector.reset(this.current.answerNotes);
    return this.current;
  }

  /** 태그 필터를 만족하는 문제가 나올 때까지 생성기를 돌린다. */
  private draw(): Question {
    const wanted = this.config.tagFilter;
    for (let i = 0; i < 64; i += 1) {
      const q = this.generator.generate();
      if (matchesTags(q, wanted)) return q;
    }
    throw new Error(`태그 ${wanted}를 만족하는 문제를 뽑지 못했습니다`);
  }

  /** 락아웃 해제. 이 시점부터 입력을 받는다. */
  beginListening(): void {
    if (this.phase !== Phase.Lockout) return;
    this.phase = Phase.Listening;
  }

  get accepting(): boolean {
    return this.phase === Phase.Listening;
  }
  get finished(): boolean {
    return this.phase === Phase.Finished;
  }
  get paused(): boolean {
    return this.phase === Phase.Paused;
  }

  // --- 일시정지 --------------------------------------------------------------
  //
  // 국면 5개가 한 방향으로만 흐른다는 전제를 처음으로 깨는 자리다(무한 라운드에
  // 멈출 방법이 필요해서 들어왔다). 갈라지는 전이가 이 하나뿐이라 아직
  // State 패턴을 넣지 않고 되돌아갈 국면만 기억한다 — 두 번째가 생기면 그때
  // 다시 판단할 것.

  private resumePhase: Phase | null = null;

  /** 멈춘다. 시작 전·종료 후에는 아무 일도 없다(false). */
  pause(): boolean {
    if (
      this.phase === Phase.Idle ||
      this.phase === Phase.Finished ||
      this.phase === Phase.Paused
    ) {
      return false;
    }
    this.resumePhase = this.phase;
    this.phase = Phase.Paused;
    // 멈춰 있는 동안 눌린 건반이 재개 후의 답으로 새지 않게 버린다.
    // **`reset`이 아니라 `discard`다** — 순차 입력에서 여기서 실수 횟수까지
    // 지우면 ESC를 눌러 오답을 무르는 치트가 된다.
    this.collector.discard();
    return true;
  }

  /**
   * 재개한다. **어느 국면에서 멈췄는지**를 돌려주고 국면 자체는 락아웃으로
   * 놓는다 — 재개 직후의 잔여 입력을 4절 규칙대로 버리기 위해서다. 다음에
   * 무엇을 할지(문제를 다시 들려줄지, 다음 문제로 넘어갈지)는 호출자가 정한다.
   */
  resume(): Phase | null {
    if (this.phase !== Phase.Paused) return null;
    const from = this.resumePhase ?? Phase.Lockout;
    this.resumePhase = null;
    this.phase = Phase.Lockout;
    return from;
  }

  // --- 재생 횟수 축 ---------------------------------------------------------

  get replaysLeft(): number | null {
    const limit = this.config.difficulty.replayLimit;
    return limit === null ? null : Math.max(limit - this.plays, 0);
  }
  notePlayed(): void {
    this.plays += 1;
  }
  mayPlay(): boolean {
    const left = this.replaysLeft;
    return left === null || left > 0;
  }

  // --- 입력 -----------------------------------------------------------------

  /** note-on 하나를 누적한다. true면 지금 바로 확정해도 된다. */
  collect(note: number): boolean {
    if (!this.accepting) return false;
    return this.collector.add(note);
  }

  /**
   * 누적된 음을 채점한다. 누적된 게 없으면 null. (MIDI 경로)
   *
   * 순차 입력은 **실수 횟수를 함께 싣는다** — 채점기가 "끝까지 쳤는가"와
   * "틀리지 않고 쳤는가"를 둘 다 봐야 하는데, 받아들인 음만으로는 뒤쪽을
   * 알 수 없기 때문이다(틀린 음은 애초에 안 들어가 있다).
   */
  submit(seconds: number): Result | null {
    if (!this.accepting || !this.collector.pending) return null;
    const mistakes = this.collector.mistakes;
    const notes = this.collector.take();
    const response: unknown =
      this.config.inputForm === "sequence"
        ? ({ form: "sequence", notes, mistakes } satisfies SequenceResponse)
        : notes;
    return this.respond(response, seconds);
  }

  /** 지금 문제에서 받아들인 음. 화면이 진행을 그린다 */
  get progress(): readonly number[] {
    return this.collector.progress;
  }

  /** 지금 문제에서 거부한 입력 횟수 */
  get mistakes(): number {
    return this.collector.mistakes;
  }

  /**
   * 완성된 답을 그대로 채점한다. (화면 입력 경로)
   *
   * MIDI 경로와 이 경로가 만나는 곳은 `finish` 하나뿐이고, 두 경로 모두
   * `accepting` 게이트를 지난다. 기술검토서 4절의 락아웃 규칙이 한 군데서만
   * 지켜지도록 새 입력 경로를 만들 때도 반드시 여기를 통과시킬 것.
   */
  respond(response: unknown, seconds: number): Result | null {
    if (!this.accepting) return null;
    return this.finish(response, seconds);
  }

  timeOut(seconds: number): Result | null {
    if (!this.accepting) return null;
    this.collector.discard();
    return this.finish(null, seconds);
  }

  private finish(response: unknown | null, seconds: number): Result {
    const question = this.current;
    if (!question) throw new Error("현재 문제가 없습니다");
    const limit = this.config.difficulty.timeLimitSec;

    let correct: boolean;
    let detail: string;
    if (response === null) {
      correct = false;
      detail = `정답: ${question.answerText}`;
    } else {
      const judgement = this.grader.grade(question, response);
      correct = judgement.correct;
      detail = judgement.detail;
    }
    if (correct) this.score += 1;

    const result: Result = {
      index: this.index,
      question,
      response,
      correct,
      detail,
      seconds: limit === null ? seconds : Math.min(seconds, limit),
    };
    this.results.push(result);
    this.phase = Phase.Feedback;
    return result;
  }

  // --- 요약 -----------------------------------------------------------------

  get progressText(): string {
    const limit = this.config.questionCount;
    return limit === null ? `문제 ${this.index}` : `문제 ${this.index} / ${limit}`;
  }
}
