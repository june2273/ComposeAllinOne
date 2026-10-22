/**
 * 세션 설정 — 기술검토서 6절의 난이도 8축과 그 프리셋.
 *
 * 이 모듈은 거의 뿌리다 — questions·grading·audio·session이 전부 여기를 바라보므로
 * **여기서 import하는 것은 반드시 더 아래여야 한다.** 지금 하나뿐이고
 * (`harmony/scales`의 `ScaleKind`) 그쪽은 `theory.ts`만 보므로 어느 방향으로도
 * 순환이 없다. **config를 import하는 모듈을 여기서 들여오지 말 것.**
 *
 * "초급/중급/고급"은 난이도 값이 아니라 **축 값들의 묶음에 붙인 이름**일 뿐이다.
 */

import { CIRCLE_MODES, KEY_KINDS, KeyKind, type KeyMode } from "./harmony/keys";
import { SCALE_KINDS, ScaleKind } from "./harmony/scales";

/** 기술검토서 7절의 AudioBackend 인터페이스가 이 값을 그대로 쓴다. */
export type PlayMode = "block" | "arpeggio_up" | "melody";

/** 연습 스테이지. 문제를 어떻게 내고 무엇으로 답하는지가 여기서 갈린다. */
/**
 * 연습 스테이지.
 *
 * 음정 셋은 **한 과목을 세 단계로 쪼갠 것**이다. 문제(두 음)는 셋이 같고 무엇을
 * 묻는지만 다르다 — 그래서 생성기 하나를 셋이 공유하고 채점기와 화면만 갈린다.
 *
 * ```
 * IntervalCount  두 음 → "몇 도, 반음 몇 개"   숫자 입력    (연습 1 — 골격을 센다)
 * IntervalTable  거기에 성질까지               타이핑       (연습 2)
 * IntervalId     두 음 → 성질 + 도수           타이핑       (본)
 * IntervalBuild  음 하나 + 음정 + 방향 → 나머지 음   건반      (해석 — 방향이 반대다)
 * ```
 *
 * **넷이 활동 하나에 묶여 있다.** 카탈로그의 `harmony.interval` 한 줄이 "단계"와
 * "음정 해석" 옵션으로 이 중 하나를 고른다 — 활동과 스테이지가 1:1이 아닌
 * 유일한 자리다.
 *
 * **`IntervalBuild`만 건반으로 답한다.** 앞의 셋은 음정을 *읽고* 이쪽은 *만든다* —
 * 그래서 화면이 있으면서 동시에 MIDI·가상 건반을 쓰는 첫 스테이지다
 * (`stages.usesMidiInput` 주석 참조).
 */
export const Stage = {
  EarSingle: "ear_single",           // 1음 청음 (MIDI 입력)
  EarChord: "ear_chord",             // 화음 청음 (MIDI 입력) — 미구현
  IntervalCount: "interval_count",   // 반음 계산법 (화면 입력)
  IntervalTable: "interval_table",   // 온음계적 음정표 외우기 (화면 입력)
  IntervalId: "interval_id",         // 온음계적 음정 구분 (화면 입력)
  IntervalBuild: "interval_build",   // 음정 해석 — 음을 쌓는다 (건반 입력)
  Scale: "scale",                    // 음계 연주 — 순서대로 친다 (건반 입력)
  KeySignature: "key_signature",     // 조표 읽기·쓰기 (글자 입력)
  Circle: "circle",                  // 5도권 채우기 (글자 입력)
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
  Scale: "scale",                      // 음계 — 순서가 맞고 실수가 0인가
  KeyField: "key_field",               // 조표·5도권 — 칸마다 맞는가
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

  // 아래 둘은 음정 문제 전용이고 위 8축의 짝이다. `allowedPitchClasses`가 "어느
  // 음이름을 쓰는가"를 정하면 `maxAlter`가 "거기에 임시표를 몇 개까지 붙이는가"를
  // 정하고, 음역 축이 "어떤 음이 나오는가"를 정하면 `maxIntervalNumber`가 "두 음이
  // 얼마나 벌어지는가"를 정한다.

  /** 음 하나에 붙일 임시표 수. 0 = 자연음만, 1 = ♯♭, 2 = ♯♯♭♭ */
  maxAlter: number;
  /** 도수 상한. 8 = 홑음정, 13 = 겹음정 */
  maxIntervalNumber: number;

  /**
   * 낼 음계 종류. **비어 있으면 음계 스테이지가 아니다**(`chordPool`의 짝).
   * 둘 이상이면 한 세션에 섞여 나온다.
   */
  scalePool: readonly ScaleKind[];

  /** 조표 활동이 낼 유형. 조표 스테이지가 아니면 뜻이 없다 */
  keyKind: KeyKind;
  /** 5도권 한 문제의 빈칸 수 */
  circleSpan: number;
  /**
   * 5도권을 어느 이름으로 채우는가. 둘이면 문제마다 섞여 나온다.
   *
   * **자리는 장조·단조가 똑같다**(나란한조가 같은 칸에 앉는다) — 이 축이 바꾸는
   * 것은 칸에 적는 이름뿐이다.
   */
  circleModes: readonly KeyMode[];
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
  maxAlter: 0,
  maxIntervalNumber: 8,
  scalePool: [],
  keyKind: KeyKind.Major,
  circleSpan: 4,
  circleModes: ["major"],
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
   * 입력의 형태 — `Session`이 수집기를 고르는 축이다.
   *
   * `"set"`은 화음처럼 **한 덩어리**로 받고(조용해지면 확정), `"sequence"`는
   * 음계처럼 **한 음씩 순서대로** 받는다(다 차면 확정, 틀린 음은 거부).
   * 자세한 것은 `session.InputCollector` 주석.
   */
  inputForm: "set" | "sequence";
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
  inputForm: "set",
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

/**
 * 음정 해석 — 음 하나와 음정을 주고 **나머지 음을 건반에서 찾게** 한다.
 *
 * 앞의 셋과 방향이 반대다. 읽는 것과 만드는 것은 같은 표를 쓰지만 실제로는
 * 따로 익혀야 하는 일이라, 단계가 아니라 별도 옵션으로 둔다.
 *
 * 채점이 `AbsolutePitch`인 것이 요점이다 — 음고류만 보면 A4 대신 A5를 눌러도
 * 통과해서 "위로·아래로"를 묻는 의미가 사라진다. 대신 이명동음은 건반에서
 * 구별할 수 없으므로(기술검토서 3절 방침 A) B♯4와 C5는 같은 답이 된다.
 */
export const INTERVAL_BUILD: SessionConfig = {
  ...BASE,
  stage: Stage.IntervalBuild,
  feedbackMs: 2200,
  difficulty: {
    ...DIATONIC_AXES,
    timeLimitSec: 20,      // 건반에서 음을 찾는 시간이 더 든다
    grading: GradingMode.AbsolutePitch,
  },
};

/**
 * 음계 연주 — 음계 이름을 주면 **건반으로 상행 8음을 순서대로** 친다.
 *
 * 음역이 C4~B5인 것은 계산해서 나온 값이다: 으뜸음을 옥타브 4에 두면 12조 ×
 * 4종류 48개 음계가 정확히 60~83에 들어간다(B 장음계의 꼭대기가 B5 = 83).
 *
 * - `inputForm: "sequence"` — 이 설정 하나가 `Session`의 수집기를 갈아끼운다.
 * - `echoBack: true` — **연주가 과제 자체**라 친 음이 들려야 한다. 전 스테이지에서
 *   꺼져 있는 축인데 여기서만 켠다(기술검토서 10절도 청음에서만 OFF를 권한다).
 * - `allowedPitchClasses: null` — 조성 축은 음계가 스스로 정한다.
 * - 제한시간이 긴 것은 여덟 음을 **찾아서** 치는 시간이기 때문이다.
 */
export const SCALE: SessionConfig = {
  ...BASE,
  stage: Stage.Scale,
  inputForm: "sequence",
  echoBack: true,
  feedbackMs: 2600,          // 완성된 음계를 눈에 남길 시간
  difficulty: {
    ...DEFAULT_AXES,
    noteLow: 60,             // C4
    noteHigh: 83,            // B5
    allowedPitchClasses: null,
    timeLimitSec: 40,
    grading: GradingMode.Scale,
    scalePool: [ScaleKind.Major],
  },
};

/**
 * 조표 — 오선지의 ♯·♭을 읽고 조를 말하거나, 거꾸로 조에서 조표를 쓴다.
 *
 * **건반을 안 쓴다**(`KEYBOARD_STAGES`에 넣지 않는다) — 답이 글자라 자판이
 * 입력 칸으로 바로 가야 한다. 소리도 안 난다: 조표는 보는 것이지 듣는 것이 아니다.
 */
export const KEY_SIGNATURE: SessionConfig = {
  ...BASE,
  stage: Stage.KeySignature,
  feedbackMs: 2600,
  difficulty: {
    ...DEFAULT_AXES,
    timeLimitSec: 30,
    grading: GradingMode.KeyField,
    keyKind: KeyKind.Major,
  },
};

/** 5도권 — 한 자리를 주면 이어지는 자리를 채운다 */
export const CIRCLE_OF_FIFTHS: SessionConfig = {
  ...BASE,
  stage: Stage.Circle,
  feedbackMs: 3000,          // 채운 원을 눈에 남길 시간
  difficulty: {
    ...DEFAULT_AXES,
    timeLimitSec: 45,        // 네 칸 이상을 치는 시간
    grading: GradingMode.KeyField,
    circleSpan: 4,
    circleModes: ["major"],
  },
};

/**
 * "단계" 옵션이 고르는 셋. **순서가 곧 학습 순서다** — 옵션의 눈금 번호가
 * 그대로 이 배열의 인덱스다. (음정 해석은 여기 없다 — 단계가 아니라 방향이라
 * 별도 옵션이 고른다.)
 */
export const LEVEL_CONFIGS: readonly SessionConfig[] = [
  INTERVAL_HALF_STEPS,
  INTERVAL_TABLE,
  DIATONIC_INTERVALS,
];

/** 카탈로그의 음정 활동이 드는 기본값. 본 단계에서 시작한다 */
export const INTERVALS = DIATONIC_INTERVALS;

/**
 * 음정 스테이지인가. 옵션이 어디까지 뜻을 갖는지 정하는 조건이 여기 하나뿐이다.
 *
 * **`LEVEL_CONFIGS`에서 유도하지 않는다** — 음정 해석이 거기 없어서, 유도하면
 * 그 스테이지에서 음 범위·겹음정 옵션이 통째로 죽는다.
 */
const INTERVAL_STAGES: ReadonlySet<Stage> = new Set([
  Stage.IntervalCount,
  Stage.IntervalTable,
  Stage.IntervalId,
  Stage.IntervalBuild,
]);

export function isIntervalStage(stage: Stage): boolean {
  return INTERVAL_STAGES.has(stage);
}

/** 음계 스테이지인가. 옵션 화면이 "음계 종류"를 낼지 정하는 조건이 여기 하나다 */
export function isScaleStage(stage: Stage): boolean {
  return stage === Stage.Scale;
}

/** "전부 섞어서" 눈금. 종류 넷 **다음** 칸이다 */
export const SCALE_MIX = SCALE_KINDS.length;

/** 조표 스테이지인가. 옵션 화면이 "유형"을 낼지 정하는 조건이 여기 하나다 */
export function isKeySignatureStage(stage: Stage): boolean {
  return stage === Stage.KeySignature;
}

/** 5도권 스테이지인가 */
export function isCircleStage(stage: Stage): boolean {
  return stage === Stage.Circle;
}

/** 5도권 빈칸 수 눈금. 사용자가 고른 4~6칸 */
export const CIRCLE_SPANS: readonly number[] = [4, 5, 6];

/** 5도권 "둘 다 섞어서" 눈금. 장조·단조 **다음** 칸이다(`SCALE_MIX`와 같은 수법) */
export const CIRCLE_MIX = CIRCLE_MODES.length;

/** 겹음정을 켰을 때의 음역 상한. E6 — 2옥타브가 있어야 13도 쌍이 넉넉히 나온다 */
const COMPOUND_NOTE_HIGH = 88;
const SIMPLE_MAX_NUMBER = 8;
const COMPOUND_MAX_NUMBER = 13;

/**
 * 낮은음자리표를 켰을 때의 음역 하한. **G2 — 낮은음자리표의 맨 아랫줄이다.**
 *
 * 자리표 자체는 이 값이 정하지 않는다. 음이 내려가면 `score.clefFor`가 알아서
 * 낮은음자리표로 그리므로, 옵션이 하는 일은 **낮은 자리의 음을 풀에 넣는 것**
 * 뿐이고 그래서 한 세션에 두 자리표가 섞여 나온다.
 */
const BASS_NOTE_LOW = 43;

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

  // 아래 셋은 음정 활동에서만 뜻이 있다(`isIntervalStage`).

  /** 단계 — `LEVEL_CONFIGS`의 인덱스. 0 연습 1 · 1 연습 2 · 2 음정 이름 */
  readonly level: number;
  /** 음 범위 — 0 온음계 · 1 반음계(♯♭) · 2 겹임시표(♯♯♭♭) */
  readonly maxAlter: number;
  /** 겹음정(9도 이상)을 낸다 */
  readonly compound: boolean;
  /** 낮은 자리의 음도 낸다 — 높은음자리표와 낮은음자리표가 섞인다 */
  readonly bassClef: boolean;
  /** 음정 해석 — 음정을 읽는 대신 건반에서 만든다 */
  readonly build: boolean;

  /**
   * 음계 종류 — `SCALE_KINDS`의 눈금 번호. **마지막 칸(= 길이)이 "전부 섞어서"다.**
   *
   * 토글을 따로 두지 않은 것은 "종류를 골라 놨는데 섞기가 켜져 있는" 모순 상태를
   * 만들지 않기 위해서다. 제한시간·라운드의 마지막 칸이 무한인 것과 같은 수법이다.
   */
  readonly scaleKind: number;

  /** 조표 유형 — `KEY_KINDS`의 눈금 번호 */
  readonly keyKind: number;
  /** 5도권 빈칸 수 — `CIRCLE_SPANS`의 눈금 번호 */
  readonly circleSpan: number;
  /** 5도권 조성 — `CIRCLE_MODES`의 눈금 번호. **마지막 칸이 "섞어서"다** */
  readonly circleMode: number;
}

/** 음정 활동이 아닌 곳에서 쓰는 옵션 기본값 */
export const DEFAULT_OPTIONS: PracticeOptions = {
  timeLimitSec: 10,
  rounds: 10,
  showTable: false,
  level: 2,
  maxAlter: 0,
  compound: false,
  bassClef: false,
  build: false,
  scaleKind: 0,
  keyKind: 0,
  circleSpan: 0,
  circleMode: 0,
};

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

/** 음계 풀 → 눈금 번호. 둘 이상이면 섞기 칸이다 */
function scaleKindStep(pool: readonly ScaleKind[]): number {
  if (pool.length !== 1) return pool.length > 1 ? SCALE_MIX : DEFAULT_OPTIONS.scaleKind;
  const at = SCALE_KINDS.indexOf(pool[0]);
  return at < 0 ? DEFAULT_OPTIONS.scaleKind : at;
}

/** `circleModes` → 눈금 번호. `scaleKindStep`과 같은 규칙이다 */
function circleModeStep(pool: readonly KeyMode[]): number {
  if (pool.length !== 1) return pool.length > 1 ? CIRCLE_MIX : DEFAULT_OPTIONS.circleMode;
  const at = CIRCLE_MODES.indexOf(pool[0]);
  return at < 0 ? DEFAULT_OPTIONS.circleMode : at;
}

export function optionsOf(config: SessionConfig): PracticeOptions {
  const level = LEVEL_CONFIGS.findIndex((c) => c.stage === config.stage);
  return {
    timeLimitSec: config.difficulty.timeLimitSec,
    rounds: config.questionCount,
    showTable: config.showTable,
    level: level < 0 ? DEFAULT_OPTIONS.level : level,
    maxAlter: config.difficulty.maxAlter,
    compound: config.difficulty.maxIntervalNumber > SIMPLE_MAX_NUMBER,
    bassClef: config.difficulty.noteLow < DIATONIC_AXES.noteLow,
    build: config.stage === Stage.IntervalBuild,
    scaleKind: scaleKindStep(config.difficulty.scalePool),
    keyKind: Math.max(0, KEY_KINDS.indexOf(config.difficulty.keyKind)),
    circleSpan: Math.max(0, CIRCLE_SPANS.indexOf(config.difficulty.circleSpan)),
    circleMode: circleModeStep(config.difficulty.circleModes),
  };
}

/**
 * 옵션을 얹은 설정. 원본은 건드리지 않는다 — 프리셋은 공유 객체다.
 *
 * 음정 활동에서는 **단계 옵션이 프리셋 자체를 고른다.** 스테이지가 바뀌면
 * 생성기·채점기·화면이 함께 바뀌므로(그 셋을 `Stage`가 함께 정한다) 여기서
 * 갈아끼우는 것만으로 끝난다.
 */
/**
 * 음정 옵션이 고르는 프리셋. **"음정 해석"이 "단계"를 이긴다** — 스테이지가
 * 하나뿐이라 단계는 거기서 뜻이 없고, 그래서 화면도 켜져 있는 동안 단계
 * 슬라이더를 감춘다.
 */
function intervalPreset(options: PracticeOptions): SessionConfig | undefined {
  return options.build ? INTERVAL_BUILD : LEVEL_CONFIGS[options.level];
}

export function withOptions(
  config: SessionConfig,
  options: PracticeOptions,
): SessionConfig {
  const interval = isIntervalStage(config.stage);
  const base = interval
    ? intervalPreset(options) ?? config
    : config;

  const difficulty: DifficultyAxes = {
    ...base.difficulty,
    timeLimitSec: options.timeLimitSec,
  };
  if (interval) {
    difficulty.maxAlter = options.maxAlter;
    difficulty.maxIntervalNumber = options.compound
      ? COMPOUND_MAX_NUMBER
      : SIMPLE_MAX_NUMBER;
    if (options.compound) difficulty.noteHigh = COMPOUND_NOTE_HIGH;
    if (options.bassClef) difficulty.noteLow = BASS_NOTE_LOW;
  }
  if (isScaleStage(base.stage)) {
    difficulty.scalePool =
      options.scaleKind >= SCALE_MIX
        ? SCALE_KINDS
        : [SCALE_KINDS[options.scaleKind] ?? SCALE_KINDS[0]];
  }
  if (isKeySignatureStage(base.stage)) {
    difficulty.keyKind = KEY_KINDS[options.keyKind] ?? KEY_KINDS[0];
  }
  if (isCircleStage(base.stage)) {
    difficulty.circleSpan = CIRCLE_SPANS[options.circleSpan] ?? CIRCLE_SPANS[0];
    difficulty.circleModes =
      options.circleMode >= CIRCLE_MIX
        ? CIRCLE_MODES
        : [CIRCLE_MODES[options.circleMode] ?? CIRCLE_MODES[0]];
  }

  return {
    ...base,
    questionCount: options.rounds,
    showTable: options.showTable,
    difficulty,
  };
}

// 어떤 연습·도구가 있는지는 catalog.ts가 갖는다. 이 파일은 "한 세션을 어떻게
// 돌릴지"만 안다 — 목록을 여기에 두면 config가 화면 구성까지 알게 된다.
