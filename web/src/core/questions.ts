/**
 * 문제 생성 — Strategy.
 *
 * 문제 종류(1음/음정/화음/스케일/로마자)마다 생성 규칙이 전혀 다르므로,
 * 세션 컨트롤러가 종류별 분기를 갖는 대신 `QuestionGenerator` 하나만 알게 한다.
 * 새 종류를 추가할 때 손댈 곳은 이 파일과 팩토리 한 줄뿐이다.
 *
 * 태그를 넉넉히 붙이는 것이 이 파일의 또 다른 목적이다. 집중연습은
 * "태그로 거른 문제 큐"이므로 생성 시점에 붙여두면 거의 공짜로 구현되지만,
 * 나중에 태그를 추가하려면 생성기를 전부 다시 손대야 한다.
 */

import {
  type DifficultyAxes,
  type SessionConfig,
  Stage,
  axesAllow,
} from "./config";
import {
  type Interval,
  LETTERS,
  LETTER_PC,
  NOTE_NAMES,
  Pitch,
  diatonicHalfSteps,
  intervalBetween,
  isBlackKey,
  noteName,
  octaveOf,
  pitchClass,
  pitchClasses,
  withoutAlter,
} from "./theory";

/** 재현 가능한 난수 (mulberry32). 테스트가 시드를 고정할 수 있어야 한다. */
export class Rng {
  private state: number;
  constructor(seed = Date.now()) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  choice<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}

export interface Question {
  readonly kind: string;
  readonly answerNotes: readonly number[];
  /**
   * 들려줄 음. **없으면 `answerNotes`를 들려준다** — 청음·음정 세 단계처럼
   * "문제로 울리는 것이 곧 정답"인 스테이지는 이 필드가 필요 없다.
   *
   * 음정 해석은 갈라야 한다. 거기서 `answerNotes`는 **사용자가 눌러야 하는
   * 음**이라 그대로 울리면 답을 들려주는 셈이 된다.
   */
  readonly cueNotes?: readonly number[];
  readonly requiredPcs: ReadonlySet<number>;
  readonly optionalPcs: ReadonlySet<number>;
  /** 연습 화면에 띄울 안내 */
  readonly prompt: string;
  /** 정답 표시용 (스펠링이 생기면 여기가 바뀐다) */
  readonly answerText: string;
  readonly tags: readonly string[];
}

export function bassOf(question: Question): number {
  return Math.min(...question.answerNotes);
}

export function matchesTags(
  question: Question,
  wanted: readonly string[] | null,
): boolean {
  return wanted === null || wanted.some((t) => question.tags.includes(t));
}

export interface QuestionGenerator {
  readonly kind: string;
  generate(): Question;
}

// --- 청음: 1음 ---------------------------------------------------------------

/** 1음 청음. 직전 문제와 같은 음은 내지 않는다. */
export class SingleNoteGenerator implements QuestionGenerator {
  readonly kind = "ear_single";
  private last: number | null = null;
  private readonly pool: number[];
  private readonly axes: DifficultyAxes;
  private readonly rng: Rng;

  constructor(axes: DifficultyAxes, rng: Rng = new Rng()) {
    this.axes = axes;
    this.rng = rng;
    this.pool = [];
    for (let n = axes.noteLow; n <= axes.noteHigh; n += 1) {
      if (axesAllow(axes, n)) this.pool.push(n);
    }
    if (this.pool.length === 0) {
      throw new Error(
        `음역 ${axes.noteLow}~${axes.noteHigh}에 조성 조건을 만족하는 음이 없습니다`,
      );
    }
  }

  generate(): Question {
    const choices = this.pool.filter((n) => n !== this.last);
    const note = this.rng.choice(choices.length ? choices : this.pool);
    this.last = note;
    return {
      kind: this.kind,
      answerNotes: [note],
      requiredPcs: pitchClasses([note]),
      optionalPcs: new Set(),
      prompt: `${noteName(this.axes.noteLow)}~${noteName(this.axes.noteHigh)} 중 한 음`,
      answerText: noteName(note),
      tags: [
        "청음",
        "1음",
        `음이름:${NOTE_NAMES[pitchClass(note)]}`,
        `옥타브:${octaveOf(note)}`,
        isBlackKey(note) ? "검은건반" : "흰건반",
        `음역:${noteName(this.axes.noteLow)}-${noteName(this.axes.noteHigh)}`,
      ],
    };
  }
}

// --- 화성학: 음정 구분 --------------------------------------------------------

/**
 * 악보로 보여주고 소리로 들려주는 음정 문제.
 *
 * `answerNotes`(MIDI)만으로는 도수를 셀 수 없어서 표기를 함께 들고 있다.
 * C–E와 C–F♭은 둘 다 4반음이지만 각각 장3도와 감4도다.
 */
export interface IntervalQuestion extends Question {
  readonly lower: Pitch;
  readonly upper: Pitch;
  readonly interval: Interval;
  /**
   * 음정 안의 **온음계적 반음 개수**(미–파, 시–도). 교재 음정표의 세로축이다.
   * `interval.semitones`(반음계적 거리)와 다른 값이니 섞지 말 것 — theory의
   * `diatonicHalfSteps` 주석 참조.
   *
   * **임시표를 무시한 값이다.** 그래서 반음계 문제에서 이 값이 가리키는 성질은
   * `interval.quality`가 아니라 아래 `skeleton`의 것이다.
   */
  readonly halfSteps: number;
  /** 임시표를 뗀 골격 음정. 자연음 문제에서는 `interval`과 같다 */
  readonly skeleton: Interval;
}

/**
 * **`lower`까지 본다.** 음정 해석 문제도 `interval`을 들고 있어서, 그것만
 * 보면 두 음짜리 화면·채점기에 한 음짜리 문제가 통과해 버린다.
 */
export function isIntervalQuestion(q: Question): q is IntervalQuestion {
  return "lower" in q && "interval" in q;
}

// --- 화면에서 만든 답 ---------------------------------------------------------
//
// 스테이지마다 묻는 것이 달라 응답 모양도 다르다. **`form`으로 구분한다** —
// 필드 유무로 알아내려 하면(예전 `isIntervalResponse`가 그랬다) 스테이지가
// 늘어날 때마다 판별이 애매해진다.

/** 연습 1 — 도수와 반음 개수. */
export interface CountResponse {
  readonly form: "count";
  readonly number: number | null;
  readonly halfSteps: number | null;
}

/** 연습 2 — 성질만. 도수와 반음은 문제가 알려준다. */
export interface QualityResponse {
  readonly form: "quality";
  readonly quality: string | null;
}

/** 본 단계 — 도수와 성질. 반음은 머릿속에서만 센다. */
export interface IntervalResponse {
  readonly form: "interval";
  readonly number: number | null;
  readonly quality: string | null;
}

export type StageResponse = CountResponse | QualityResponse | IntervalResponse;

export function isStageResponse(v: unknown): v is StageResponse {
  if (typeof v !== "object" || v === null || !("form" in v)) return false;
  const form = (v as { form: unknown }).form;
  return form === "count" || form === "quality" || form === "interval";
}

export function responseText(r: StageResponse): string {
  switch (r.form) {
    case "count":
      return `${r.number ?? "?"}도 · 반음 ${r.halfSteps ?? "?"}개`;
    case "quality":
      return `${r.quality ?? "?"}음정`;
    case "interval":
      return `${r.quality ?? "?"}${r.number ?? "?"}도`;
  }
}

/**
 * 화성음정(두 음 동시) 문제.
 *
 * 음 풀은 **조가 정하는 음이름 × 임시표**다. 조(`allowedPitchClasses`)가 어느
 * 글자를 쓸지 정하고 `maxAlter`가 거기에 임시표를 몇 개까지 붙일지 정한다.
 * `maxAlter: 0`이면 예전의 자연음 전용 생성기와 정확히 같은 집합이 나온다.
 *
 * 완전1도(동음)는 내지 않는다 — 동시에 울리면 귀로 구별할 수 없고 악보에서도
 * 두 음표가 겹쳐 읽히지 않는다. 같은 이유로 **위 음이 아래 음보다 높게 울리는
 * 쌍만 낸다**(C♯–D♭ 같은 것은 악보에서 뒤집혀 보인다).
 *
 * **음정 종류를 먼저 뽑고 그 다음에 실제 음을 고른다.** 음 쌍을 균등하게 뽑으면
 * C4~A5 구간에서 증4도가 70쌍 중 2쌍, 감5도가 1쌍뿐이라 10문제 동안 트라이톤이
 * 한 번도 안 나온다 — 정작 가장 연습이 필요한 음정인데도. 반음계를 켜면 같은
 * 이유로 증·감·겹증·겹감이 자주 나온다. 이 연습의 목적이 그 사다리라 일부러
 * 그렇게 둔다.
 */
export class IntervalGenerator implements QuestionGenerator {
  readonly kind: string;
  static readonly MIN_NUMBER = 2;

  private readonly byInterval = new Map<
    string,
    Array<{ lower: Pitch; upper: Pitch; interval: Interval }>
  >();
  private readonly names: string[];
  private lastName: string | null = null;
  private readonly rng: Rng;
  private readonly prompt: string;

  /**
   * 음정 세 단계가 **이 생성기 하나를 공유한다.** 문제(두 음)는 같고 무엇을
   * 묻는지만 다르므로, 다른 것은 `kind`와 안내 문구뿐이다. 스테이지마다 생성기를
   * 복제하면 출제 분포를 세 곳에서 따로 관리하게 된다.
   */
  constructor(
    axes: DifficultyAxes,
    rng: Rng = new Rng(),
    labels: { kind?: string; prompt?: string } = {},
  ) {
    this.rng = rng;
    this.kind = labels.kind ?? "interval_id";
    this.prompt = labels.prompt ?? "두 음 사이의 음정은?";

    const maxNumber = Math.max(
      IntervalGenerator.MIN_NUMBER,
      axes.maxIntervalNumber,
    );
    const byStep = new Map<number, Pitch[]>();
    for (const pitch of buildPool(axes)) {
      const bucket = byStep.get(pitch.step) ?? [];
      bucket.push(pitch);
      byStep.set(pitch.step, bucket);
    }

    // 음정 이름 → 그 음정을 이루는 모든 음 쌍.
    // **인덱스가 아니라 음이름 계단(step) 거리로 짝짓는다** — 같은 계단에
    // 임시표가 다른 음이 여럿 앉아 있어서 배열 인덱스는 도수가 아니다.
    for (const [step, lowers] of byStep) {
      for (let d = IntervalGenerator.MIN_NUMBER - 1; d < maxNumber; d += 1) {
        const uppers = byStep.get(step + d);
        if (!uppers) continue;
        this.addPairs(lowers, uppers);
      }
    }
    if (this.byInterval.size === 0) {
      throw new Error(
        `음역 ${axes.noteLow}~${axes.noteHigh}이 좁아 음정을 만들 수 없습니다`,
      );
    }
    this.names = [...this.byInterval.keys()].sort();
  }

  /** 한 계단 짝의 모든 조합을 이름별 통에 넣는다. */
  private addPairs(lowers: readonly Pitch[], uppers: readonly Pitch[]): void {
    for (const lower of lowers) {
      for (const upper of uppers) {
        if (upper.midi <= lower.midi) continue;
        let interval: Interval;
        try {
          interval = intervalBetween(lower, upper);
        } catch {
          // 겹겹증·겹겹감 바깥은 이름이 없다
          continue;
        }
        const bucket = this.byInterval.get(interval.name) ?? [];
        bucket.push({ lower, upper, interval });
        this.byInterval.set(interval.name, bucket);
      }
    }
  }

  /** 이 설정에서 나올 수 있는 음정 종류. */
  get intervalNames(): string[] {
    return [...this.names];
  }

  generate(): IntervalQuestion {
    const pool = this.names.filter((n) => n !== this.lastName);
    const name = this.rng.choice(pool.length ? pool : this.names);
    this.lastName = name;
    const { lower, upper, interval } = this.rng.choice(this.byInterval.get(name)!);

    const notes = [lower.midi, upper.midi];
    const halfSteps = diatonicHalfSteps(lower, upper);
    const skeleton = intervalBetween(withoutAlter(lower), withoutAlter(upper));
    const altered = lower.alter !== 0 || upper.alter !== 0;
    return {
      kind: this.kind,
      answerNotes: notes,
      requiredPcs: pitchClasses(notes),
      optionalPcs: new Set(),
      prompt: this.prompt,
      // 세 단계가 같은 문구를 쓴다. 무엇을 물었든 정답 전체를 보여주는 편이
      // 낫다 — 연습 1에서 성질까지 눈에 익히는 것이 다음 단계로 이어진다.
      answerText: altered
        ? `${interval.name} — ${lower.name}–${upper.name}, ` +
          `골격 ${skeleton.name} · 반음 ${halfSteps}개`
        : `${interval.name} — ${lower.name}–${upper.name}, 반음 ${halfSteps}개`,
      tags: [
        "화성학",
        "음정",
        altered ? "임시표" : "온음계",
        "화성음정",          // 동시에 울림 (선율음정과 구분)
        `${interval.number}도`,
        interval.quality,
        `반음${halfSteps}개`,
        ...(interval.number > 8 ? ["겹음정"] : []),
      ],
      lower,
      upper,
      interval,
      halfSteps,
      skeleton,
    };
  }
}

// --- 화성학: 음정 해석 (음을 쌓는다) -------------------------------------------

/**
 * 음 하나와 음정을 주고 **나머지 음을 건반에서 찾게** 하는 문제.
 *
 * 앞의 세 단계가 두 음을 보고 이름을 붙이는 것이라면 이쪽은 반대 방향이다 —
 * `G4 · 장2도 · 위로`에 A4를 누르면 정답이다. 같은 표를 쓰지만 읽기와 쓰기는
 * 따로 익혀야 한다.
 */
export interface IntervalBuildQuestion extends Question {
  /** 화면에 그려 주는 음 */
  readonly given: Pitch;
  /** 눌러야 하는 음 */
  readonly target: Pitch;
  readonly interval: Interval;
  /** 위로 쌓는가. 아래면 `given`이 위 음이다 */
  readonly up: boolean;
}

export function isIntervalBuildQuestion(q: Question): q is IntervalBuildQuestion {
  return "target" in q && "given" in q;
}

/**
 * 음정 해석 문제 생성기.
 *
 * **음 쌍은 `IntervalGenerator`에서 그대로 받는다.** 음정 이름을 먼저 뽑아
 * 분포를 고르게 하는 장치, 음역·임시표·겹음정 옵션, 이름 없는 쌍을 거르는
 * 규칙이 전부 거기 있다 — 여기서 다시 만들면 두 벌이 갈린다. 이 클래스가
 * 더하는 것은 **둘 중 어느 쪽을 주고 어느 쪽을 묻는가** 하나뿐이다.
 *
 * 답이 반드시 음역 안에 드는 것도 그래서 공짜다. 두 음 다 풀에서 나왔으므로
 * 화면의 가상 건반(`rangeKeys(noteLow, noteHigh)`)에 늘 그려져 있다.
 */
export class IntervalBuildGenerator implements QuestionGenerator {
  readonly kind = Stage.IntervalBuild;
  private readonly pairs: IntervalGenerator;
  private readonly rng: Rng;

  constructor(axes: DifficultyAxes, rng: Rng = new Rng()) {
    this.rng = rng;
    this.pairs = new IntervalGenerator(axes, rng, { kind: Stage.IntervalBuild });
  }

  generate(): IntervalBuildQuestion {
    const pair = this.pairs.generate();
    const up = this.rng.next() < 0.5;
    const given = up ? pair.lower : pair.upper;
    const target = up ? pair.upper : pair.lower;
    const way = up ? "위로" : "아래로";
    const { interval } = pair;

    return {
      kind: this.kind,
      answerNotes: [target.midi],
      // 들려주는 것은 **주어진 음**이다. 답을 울리면 문제가 되지 않는다
      cueNotes: [given.midi],
      requiredPcs: pitchClasses([target.midi]),
      optionalPcs: new Set(),
      prompt: `${given.name}에서 ${interval.name} ${way}`,
      answerText: `${target.name} — ${given.name}에서 ${interval.name} ${way}`,
      tags: [
        "화성학",
        "음정",
        "음정 해석",
        way,
        `${interval.number}도`,
        interval.quality,
        given.alter !== 0 || target.alter !== 0 ? "임시표" : "온음계",
        ...(interval.number > 8 ? ["겹음정"] : []),
      ],
      given,
      target,
      interval,
      up,
    };
  }
}

/**
 * 음 풀 — **조가 글자를 정하고 `maxAlter`가 임시표를 정한다.**
 *
 * 예전에는 음역을 훑으며 `theory.natural(midi)`를 불렀는데 그러면 검은건반에서
 * 던진다. MIDI 번호에서 표기를 되찾으려는 방향 자체가 이명동음 문제를 여기까지
 * 끌고 오므로, 반대로 **표기에서 쌓아 내려간다.**
 */
function buildPool(axes: DifficultyAxes): Pitch[] {
  const pcs = axes.allowedPitchClasses;
  const letters = [...LETTERS].filter(
    (letter) => pcs === null || pcs.has(LETTER_PC[letter]),
  );
  if (letters.length === 0) {
    throw new Error("조성 조건을 만족하는 음이름이 없습니다");
  }
  const maxAlter = Math.max(0, Math.min(2, axes.maxAlter));

  const pool: Pitch[] = [];
  // 임시표가 옥타브 경계를 넘길 수 있어 한 옥타브씩 넉넉히 훑고 음역으로 자른다
  for (let octave = octaveOf(axes.noteLow) - 1; octave <= octaveOf(axes.noteHigh) + 1; octave += 1) {
    for (const letter of letters) {
      for (let alter = -maxAlter; alter <= maxAlter; alter += 1) {
        const pitch = new Pitch(letter, alter, octave);
        if (pitch.midi < axes.noteLow || pitch.midi > axes.noteHigh) continue;
        pool.push(pitch);
      }
    }
  }
  return pool;
}

/**
 * 스테이지에 맞는 생성기를 고른다.
 *
 * 새 스테이지를 추가할 때 여기에 분기 한 줄을 더한다. 호출부(세션)는 바뀌지 않는다.
 */
export function makeGenerator(config: SessionConfig, rng?: Rng): QuestionGenerator {
  const axes = config.difficulty;
  if (config.stage === Stage.IntervalCount) {
    return new IntervalGenerator(axes, rng, {
      kind: Stage.IntervalCount,
      prompt: "몇 도이고, 반음(미–파·시–도)은 몇 개인가? 임시표는 무시한다",
    });
  }
  if (config.stage === Stage.IntervalTable) {
    return new IntervalGenerator(axes, rng, {
      kind: Stage.IntervalTable,
      prompt: "골격을 표에서 찾고, 임시표만큼 사다리를 옮기세요",
    });
  }
  if (config.stage === Stage.IntervalId) {
    return new IntervalGenerator(axes, rng);
  }
  if (config.stage === Stage.IntervalBuild) {
    return new IntervalBuildGenerator(axes, rng);
  }
  if (config.stage === Stage.EarChord || axes.chordPool.length > 0) {
    throw new Error("화음 문제 생성기는 아직 구현하지 않았다");
  }
  return new SingleNoteGenerator(axes, rng);
}
