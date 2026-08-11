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
/**
 * 연습 스테이지.
 *
 * 음정 셋은 **한 과목을 세 단계로 쪼갠 것**이다. 문제(두 자연음)는 셋이 같고
 * 무엇을 묻는지만 다르다 — 그래서 생성기 하나를 셋이 공유하고 채점기와 화면만
 * 갈린다.
 *
 * ```
 * IntervalCount  두 음 → "몇 도, 반음 몇 개"        숫자 입력      (연습)
 * IntervalTable  두 음 + "n도 m반음" → 성질          버튼 입력      (연습)
 * IntervalId     두 음 → 성질 + 도수                 버튼 + 숫자    (본)
 * ```
 */
export const Stage = {
  EarSingle: "ear_single",           // 1음 청음 (MIDI 입력)
  EarChord: "ear_chord",             // 화음 청음 (MIDI 입력) — 미구현
  IntervalCount: "interval_count",   // 반음 계산법 (화면 입력)
  IntervalTable: "interval_table",   // 온음계적 음정표 외우기 (화면 입력)
  IntervalId: "interval_id",         // 온음계적 음정 구분 (화면 입력)
} as const;
export type Stage = (typeof Stage)[keyof typeof Stage];

/** 기술검토서 5절 — 채점 엄격도. 단일 판정 함수로 뭉치지 않는다. */
export const GradingMode = {
  PitchClass: "pitch_class",         // 옥타브·전위·중복 무시
  BassNote: "bass_note",             // 음고류 + 최저음 일치
  ExactVoicing: "exact_voicing",     // 보이싱 일치(옥타브 통째 이동은 허용)
  AbsolutePitch: "absolute_pitch",   // MIDI 번호까지 완전 일치
  // 아래는 건반 입력이 아니라 화면에서 고른 답을 채점한다
  IntervalCount: "interval_count",     // 도수 + 온음계적 반음 개수
  IntervalQuality: "interval_quality", // 성질만 (도수·반음은 문제가 알려준다)
  IntervalForm: "interval_form",       // 도수 + 성질
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
  /** 라운드 수. **null이면 무한** — 끝나지 않고 ESC로 멈춘다 */
  questionCount: number | null;
  difficulty: DifficultyAxes;
  tagFilter: readonly string[] | null;   // 집중연습

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
  /**
   * 참고표(음정표)를 화면에 띄운다. **연습용 보조 장치**라 기본은 꺼짐이고,
   * 표가 있는 스테이지에서만 옵션으로 노출된다(`stages.usesTable()`).
   */
  showTable: boolean;
}

const BASE: Omit<SessionConfig, "stage" | "difficulty"> = {
  questionCount: 10,
  tagFilter: null,
  playDurationSec: 2,
  inputLockoutMs: 200,
  feedbackMs: 1200,
  chordHoldMs: 0,
  echoBack: false,
  showTable: false,
};

// --- 활동별 설정 ---------------------------------------------------------------
//
// 카탈로그의 활동이 이 중 하나를 골라 쓴다. "초급/중급/고급" 같은 난이도
// 프리셋은 두지 않는다 — 지금 화면에서 고칠 수 있는 축은 제한시간·라운드뿐이고
// (`PracticeOptions`), 나머지 6축을 묶어 파는 UI가 없으면 죽은 상수가 된다.

export const C_MAJOR_PCS: ReadonlySet<number> = new Set([0, 2, 4, 5, 7, 9, 11]);

/** 청음: 단일음. C4~C5 반음계, 절대 음높이 채점. */
export const INTERMEDIATE: SessionConfig = {
  ...BASE,
  stage: Stage.EarSingle,
  difficulty: { ...DEFAULT_AXES },
};

/**
 * 화성학 음정 3단계가 공유하는 난이도 축.
 *
 * 한 조(기본 C장조)의 음계음만으로 만드는 음정. 흰건반만 써도 완전·장·단·증·감
 * 다섯 성질이 모두 나온다 — F–B가 증4도, B–F가 감5도이기 때문이다.
 */
const DIATONIC_AXES: DifficultyAxes = {
  ...DEFAULT_AXES,
  noteLow: 60,               // C4
  noteHigh: 81,              // A5 — 두 음이 옥타브를 넘지 않게 여유를 둔다
  allowedPitchClasses: C_MAJOR_PCS,
  timeLimitSec: 10,
  grading: GradingMode.IntervalForm,
};

/**
 * 연습 1 — 반음 계산법. 성질은 묻지 않고 **도수와 반음 개수만** 센다.
 *
 * 제한시간이 본 단계보다 긴 것은 의도다. 이 단계에서 하는 일이 실제로 음표를
 * 하나씩 짚어 세는 것이라 시간이 더 든다.
 */
export const INTERVAL_HALF_STEPS: SessionConfig = {
  ...BASE,
  stage: Stage.IntervalCount,
  feedbackMs: 2200,          // 진단 문구를 읽을 시간이 필요하다
  difficulty: {
    ...DIATONIC_AXES,
    timeLimitSec: 20,
    grading: GradingMode.IntervalCount,
  },
};

/**
 * 연습 2 — 음정표 외우기. 도수와 반음 개수를 **문제가 알려주고** 성질만 묻는다.
 *
 * 계산은 빼고 표만 남긴 단계다. `showTable`을 켜면 표를 보면서 풀 수 있다.
 */
export const INTERVAL_TABLE: SessionConfig = {
  ...BASE,
  stage: Stage.IntervalTable,
  feedbackMs: 2000,
  difficulty: {
    ...DIATONIC_AXES,
    timeLimitSec: 15,
    grading: GradingMode.IntervalQuality,
  },
};

/** 본 단계 — 두 음만 보고 성질과 도수를 답한다. 앞의 두 연습을 합친 것. */
export const DIATONIC_INTERVALS: SessionConfig = {
  ...BASE,
  stage: Stage.IntervalId,
  feedbackMs: 2200,
  difficulty: { ...DIATONIC_AXES },
};

// --- 연습 옵션 ----------------------------------------------------------------

/**
 * 시작 화면에서 매번 고르는 두 값. **null이 "무한"이다** — 없음이 아니라 끝이 없음.
 *
 * 8축 중 둘(제한시간·문항 수)의 부분집합이지만 별도 타입으로 두는 이유는,
 * 이 둘만이 사용자가 매번 만지는 값이기 때문이다. 나머지 축은 활동이 정한다.
 * 축을 더 열고 싶어지면 여기에 필드를 늘리고 `withOptions`만 고치면 된다.
 */
export interface PracticeOptions {
  /** 문제당 제한시간(초). null이면 시간을 재지 않는다 */
  readonly timeLimitSec: number | null;
  /** 라운드 수. null이면 끝나지 않는다 */
  readonly rounds: number | null;
  /** 참고표 보기. 표가 있는 스테이지에서만 화면에 나온다 */
  readonly showTable: boolean;
}

/**
 * 제한시간 눈금. **10초~1분, 그 위 한 칸이 무한이다.**
 *
 * 자유 입력이 아니라 눈금인 이유: 3초나 900초처럼 연습이 성립하지 않는 값을
 * 애초에 고를 수 없게 하는 편이 검증 코드를 두는 것보다 싸다.
 */
export const TIME_STEPS: readonly (number | null)[] = [
  10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, null,
];

/** 라운드 눈금. 기본은 10이고 마지막 칸이 무한이다 */
export const ROUND_STEPS: readonly (number | null)[] = [5, 10, 15, 20, 30, 50, null];

/**
 * 값이 눈금 어디에 있는가. 눈금에 없는 값은 가장 가까운 칸으로 옮긴다 —
 * 프리셋이 눈금 밖의 값(ADVANCED의 8초)을 갖고 있어도 화면이 깨지지 않는다.
 */
export function stepIndex(
  steps: readonly (number | null)[],
  value: number | null,
): number {
  if (value === null) {
    const infinite = steps.indexOf(null);
    return infinite >= 0 ? infinite : steps.length - 1;
  }
  let best = 0;
  let bestGap = Infinity;
  steps.forEach((step, i) => {
    if (step === null) return;
    const gap = Math.abs(step - value);
    if (gap < bestGap) {
      best = i;
      bestGap = gap;
    }
  });
  return best;
}

export function optionsOf(config: SessionConfig): PracticeOptions {
  return {
    timeLimitSec: config.difficulty.timeLimitSec,
    rounds: config.questionCount,
    showTable: config.showTable,
  };
}

/** 옵션을 얹은 설정. 원본은 건드리지 않는다 — 프리셋은 공유 객체다. */
export function withOptions(
  config: SessionConfig,
  options: PracticeOptions,
): SessionConfig {
  return {
    ...config,
    questionCount: options.rounds,
    showTable: options.showTable,
    difficulty: { ...config.difficulty, timeLimitSec: options.timeLimitSec },
  };
}

// 어떤 연습·도구가 있는지는 catalog.ts가 갖는다. 이 파일은 "한 세션을 어떻게
// 돌릴지"만 안다 — 목록을 여기에 두면 config가 화면 구성까지 알게 된다.
