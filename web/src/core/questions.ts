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
  NOTE_NAMES,
  type Pitch,
  diatonicHalfSteps,
  intervalBetween,
  isBlackKey,
  natural,
  noteName,
  octaveOf,
  pitchClass,
  pitchClasses,
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
   */
  readonly halfSteps: number;
}

export function isIntervalQuestion(q: Question): q is IntervalQuestion {
  return "interval" in q;
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
 * 한 조의 음계음만으로 만드는 화성음정(두 음 동시).
 *
 * 흰건반(C장조)만 써도 F–B(증4도)와 B–F(감5도)가 나오므로 완전·장·단·증·감
 * 다섯 성질이 모두 등장한다.
 *
 * 완전1도(동음)는 내지 않는다 — 동시에 울리면 귀로 구별할 수 없고 악보에서도
 * 두 음표가 겹쳐 읽히지 않는다. 2도~8도만 출제한다.
 *
 * **음정 종류를 먼저 뽑고 그 다음에 실제 음을 고른다.** 음 쌍을 균등하게
 * 뽑으면 C4~A5 구간에서 증4도가 70쌍 중 2쌍, 감5도가 1쌍뿐이라 10문제 동안
 * 트라이톤이 한 번도 안 나온다 — 정작 가장 연습이 필요한 음정인데도.
 */
export class DiatonicIntervalGenerator implements QuestionGenerator {
  readonly kind: string;
  static readonly MIN_NUMBER = 2;
  static readonly MAX_NUMBER = 8;

  private readonly byInterval = new Map<
    string,
    Array<{ lower: Pitch; upper: Pitch; interval: Interval }>
  >();
  private readonly names: string[];
  private lastName: string | null = null;
  private readonly rng: Rng;
  private readonly prompt: string;

  /**
   * 음정 3단계가 **이 생성기 하나를 공유한다.** 문제(두 자연음)는 같고 무엇을
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
    const pcs = axes.allowedPitchClasses;
    if (pcs === null) {
      throw new Error(
        "온음계적 음정에는 조성 축이 필요합니다 (allowedPitchClasses를 지정하세요)",
      );
    }

    const scale: Pitch[] = [];
    for (let n = axes.noteLow; n <= axes.noteHigh; n += 1) {
      if (!pcs.has(((n % 12) + 12) % 12)) continue;
      try {
        scale.push(natural(n));
      } catch {
        // 검은건반이 섞인 조는 조표 처리가 필요하다
        throw new Error("아직 자연음(흰건반)으로만 이루어진 조성만 지원합니다");
      }
    }
    if (scale.length < DiatonicIntervalGenerator.MAX_NUMBER) {
      throw new Error(
        `음역 ${axes.noteLow}~${axes.noteHigh}이 좁아 8도를 만들 수 없습니다`,
      );
    }

    // 음정 이름 → 그 음정을 이루는 모든 음 쌍
    for (let i = 0; i < scale.length; i += 1) {
      for (
        let steps = DiatonicIntervalGenerator.MIN_NUMBER - 1;
        steps < DiatonicIntervalGenerator.MAX_NUMBER;
        steps += 1
      ) {
        if (i + steps >= scale.length) break;
        const lower = scale[i];
        const upper = scale[i + steps];
        const interval = intervalBetween(lower, upper);
        const bucket = this.byInterval.get(interval.name) ?? [];
        bucket.push({ lower, upper, interval });
        this.byInterval.set(interval.name, bucket);
      }
    }
    this.names = [...this.byInterval.keys()].sort();
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
    return {
      kind: this.kind,
      answerNotes: notes,
      requiredPcs: pitchClasses(notes),
      optionalPcs: new Set(),
      prompt: this.prompt,
      // 세 단계가 같은 문구를 쓴다. 무엇을 물었든 정답 전체를 보여주는 편이
      // 낫다 — 연습 1에서 성질까지 눈에 익히는 것이 다음 단계로 이어진다.
      answerText: `${interval.name} — ${lower.name}–${upper.name}, 반음 ${halfSteps}개`,
      tags: [
        "화성학",
        "음정",
        "온음계",
        "화성음정",          // 동시에 울림 (선율음정과 구분)
        `${interval.number}도`,
        interval.quality,
        `반음${halfSteps}개`,
      ],
      lower,
      upper,
      interval,
      halfSteps,
    };
  }
}

/**
 * 스테이지에 맞는 생성기를 고른다.
 *
 * 새 스테이지를 추가할 때 여기에 분기 한 줄을 더한다. 호출부(세션)는 바뀌지 않는다.
 */
export function makeGenerator(config: SessionConfig, rng?: Rng): QuestionGenerator {
  const axes = config.difficulty;
  if (config.stage === Stage.IntervalCount) {
    return new DiatonicIntervalGenerator(axes, rng, {
      kind: Stage.IntervalCount,
      prompt: "몇 도이고, 반음(미–파·시–도)은 몇 개인가?",
    });
  }
  if (config.stage === Stage.IntervalTable) {
    return new DiatonicIntervalGenerator(axes, rng, {
      kind: Stage.IntervalTable,
      prompt: "도수와 반음 개수를 보고 성질을 고르세요",
    });
  }
  if (config.stage === Stage.IntervalId) {
    return new DiatonicIntervalGenerator(axes, rng);
  }
  if (config.stage === Stage.EarChord || axes.chordPool.length > 0) {
    throw new Error("화음 문제 생성기는 아직 구현하지 않았다");
  }
  return new SingleNoteGenerator(axes, rng);
}
