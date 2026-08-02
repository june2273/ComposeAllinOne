/**
 * 세션 설정 — 기술검토서 6절의 난이도 8축과 그 프리셋.
 *
 * 이 모듈은 프로젝트 안의 어떤 것에도 의존하지 않는다(의존성 그래프의 뿌리).
 * questions·grading·audio·session이 전부 여기를 바라보므로, 여기서 무언가를
 * import하면 순환이 생긴다.
 *
 * "초급/중급/고급"은 난이도 값이 아니라 **축 값들의 묶음에 붙인 이름**일 뿐이다.
 */

/** 기술검토서 7절의 AudioBackend 인터페이스가 이 값을 그대로 쓴다. */
export type PlayMode = "block" | "arpeggio_up" | "melody";

/** 연습 스테이지. 문제를 어떻게 내고 무엇으로 답하는지가 여기서 갈린다. */
export const Stage = {
  EarSingle: "ear_single",     // 1음 청음 (MIDI 입력)
  EarChord: "ear_chord",       // 화음 청음 (MIDI 입력) — 미구현
  IntervalId: "interval_id",   // 온음계적 음정 구분 (화면 입력)
} as const;
export type Stage = (typeof Stage)[keyof typeof Stage];

/** 기술검토서 5절 — 채점 엄격도. 단일 판정 함수로 뭉치지 않는다. */
export const GradingMode = {
  PitchClass: "pitch_class",         // 옥타브·전위·중복 무시
  BassNote: "bass_note",             // 음고류 + 최저음 일치
  ExactVoicing: "exact_voicing",     // 보이싱 일치(옥타브 통째 이동은 허용)
  AbsolutePitch: "absolute_pitch",   // MIDI 번호까지 완전 일치
  // 아래는 건반 입력이 아니라 화면에서 고른 답을 채점한다
  IntervalForm: "interval_form",     // 도수 + 반음 수 + 성질 세 항목
} as const;
export type GradingMode = (typeof GradingMode)[keyof typeof GradingMode];

/** 기술검토서 6절의 8축. 슬라이더 하나로 뭉치지 않는다. */
export interface DifficultyAxes {
  /** 1. 음역 제한 */
  noteLow: number;
  noteHigh: number;
  /**
   * 2. 조성 — 지금은 "허용 음고류 집합"이 조성 축의 구체형이다.
   *    null이면 제한 없음(반음계).
   */
  allowedPitchClasses: ReadonlySet<number> | null;
  /** 3. 재생 횟수 제한 (null = 무제한) */
  replayLimit: number | null;
  /** 4. 재생 방식 */
  playMode: PlayMode;
  /** 5. 화음 종류 풀 — 비어 있으면 1음 청음 */
  chordPool: readonly string[];
  /** 6. 전위 포함 여부 */
  allowInversions: boolean;
  /** 7. 문제당 제한시간 (null = 무제한) */
  timeLimitSec: number | null;
  /** 8. 채점 엄격도 */
  grading: GradingMode;
}

export const DEFAULT_AXES: DifficultyAxes = {
  noteLow: 60,
  noteHigh: 72,
  allowedPitchClasses: null,
  replayLimit: null,
  playMode: "block",
  chordPool: [],
  allowInversions: false,
  timeLimitSec: 10,
  grading: GradingMode.AbsolutePitch,
};

export function axesAllow(axes: DifficultyAxes, midiNote: number): boolean {
  if (midiNote < axes.noteLow || midiNote > axes.noteHigh) return false;
  if (axes.allowedPitchClasses === null) return true;
  return axes.allowedPitchClasses.has(((midiNote % 12) + 12) % 12);
}

/**
 * 한 세션의 전부. 기술검토서 8절 데이터 모델을 따른다.
 *
 * 타이밍 상수까지 여기 모은 이유: 테스트가 모듈 전역을 덮어쓰는 대신
 * 설정 객체 하나만 바꾸면 되기 때문이다.
 */
export interface SessionConfig {
  stage: Stage;
  questionCount: number;
  difficulty: DifficultyAxes;
  tagFilter: readonly string[] | null;   // 집중연습
  wrongOnly: boolean;                    // 오답 재출제

  playDurationSec: number;
  /** 문제 전환 직후 잔여 입력을 무시한다 (기술검토서 4절) */
  inputLockoutMs: number;
  feedbackMs: number;
  /**
   * 마지막 note-on 이후 이만큼 조용하면 화음 확정. 0이면 첫 음을 즉시 채점한다.
   * 기술검토서 4절 권장값은 화음 70ms, 아르페지오 모드 500~800ms.
   */
  chordHoldMs: number;
  echoBack: boolean;                     // 기술검토서 10절 권장: OFF
}

const BASE: Omit<SessionConfig, "stage" | "difficulty"> = {
  questionCount: 10,
  tagFilter: null,
  wrongOnly: false,
  playDurationSec: 2,
  inputLockoutMs: 200,
  feedbackMs: 1200,
  chordHoldMs: 0,
  echoBack: false,
};

// --- 프리셋 ------------------------------------------------------------------

export const C_MAJOR_PCS: ReadonlySet<number> = new Set([0, 2, 4, 5, 7, 9, 11]);

export const BEGINNER: SessionConfig = {
  ...BASE,
  stage: Stage.EarSingle,
  difficulty: {
    ...DEFAULT_AXES,
    allowedPitchClasses: C_MAJOR_PCS,
    timeLimitSec: 15,
    grading: GradingMode.PitchClass,
  },
};

/** 프로토타입이 지금까지 돌던 설정. */
export const INTERMEDIATE: SessionConfig = {
  ...BASE,
  stage: Stage.EarSingle,
  difficulty: { ...DEFAULT_AXES },
};

export const ADVANCED: SessionConfig = {
  ...BASE,
  stage: Stage.EarSingle,
  questionCount: 20,
  difficulty: {
    ...DEFAULT_AXES,
    noteLow: 48,
    noteHigh: 84,
    replayLimit: 1,
    timeLimitSec: 8,
  },
};

/**
 * 화성학: 온음계적 음정 구분.
 *
 * 한 조(기본 C장조)의 음계음만으로 만드는 음정. 흰건반만 써도 완전·장·단·증·감
 * 다섯 성질이 모두 나온다 — F–B가 증4도, B–F가 감5도이기 때문이다.
 */
export const DIATONIC_INTERVALS: SessionConfig = {
  ...BASE,
  stage: Stage.IntervalId,
  feedbackMs: 2200,          // 진단 문구를 읽을 시간이 필요하다
  difficulty: {
    ...DEFAULT_AXES,
    noteLow: 60,             // C4
    noteHigh: 81,            // A5 — 두 음이 옥타브를 넘지 않게 여유를 둔다
    allowedPitchClasses: C_MAJOR_PCS,
    timeLimitSec: 10,
    grading: GradingMode.IntervalForm,
  },
};

export const PRESETS: Record<string, SessionConfig> = {
  초급: BEGINNER,
  중급: INTERMEDIATE,
  고급: ADVANCED,
};

// 어떤 연습·도구가 있는지는 catalog.ts가 갖는다. 이 파일은 "한 세션을 어떻게
// 돌릴지"만 안다 — 목록을 여기에 두면 config가 화면 구성까지 알게 된다.
