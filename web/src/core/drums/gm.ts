/**
 * GM 드럼맵 — **우리가 말할 수 있는 어휘의 표.**
 *
 * 이 파일이 드는 것과 검출기가 내는 것을 **일부러 가른다.**
 *
 * | | 무엇인가 | 지금 내용 |
 * |---|---|---|
 * | **표** (이 파일) | 우리가 **말할 수 있는** 것 | GM 35~81 전부 |
 * | **어휘** (`DrumClass`) | 우리가 **주장하는** 판정 | 여섯 + `unknown` |
 *
 * 47개를 어휘로 선언하고 여섯만 내는 것은 **재기 전에 주장하는 것**이다(규칙 1).
 * 같은 판단을 코드 인식에서 이미 한 번 내렸다 — `dim`·`aug`는 음 집합만으로
 * 근음이 안 정해져서 "어휘에서 빼는 것이 정직하다"로 끝냈고, 화면이 그 한계를
 * 한 문장 찍는다. 여기도 같다: **GM으로 말하고, 여섯을 듣는다.**
 *
 * 표를 전부 갖는 값은 실재한다 — MIDI 내보내기·타악 악보·손드럼 입력이 전부
 * 이 표를 보고, 검출기만 어휘를 본다. 검출기가 나중에 넓어져도 `DrumHit`의
 * 형식이 안 바뀐다.
 *
 * **오선 자리는 우리 몫이다.** verovio는 GM 번호 → 오선 자리를 안 해 준다
 * (번들에 `score-instrument`·`midi-unpitched` 처리기가 없다). `step`/`octave`는
 * MusicXML `<unpitched>`의 `<display-step>`/`<display-octave>`로 그대로 나가고,
 * 높이는 **높은음자리표 기준 자리**로 적는다 — 타악 음자리표는 음높이가 아니라
 * 자리만 뜻한다. 관례상 아래 배치다.
 *
 * ```
 *  A5 ── 크래시 · 스플래시              (x)
 *  G5 ─  하이햇                        (x / ⊗)
 *  F5 ── 라이드
 *  E5 ─  하이 톰
 *  D5 ── 하이미드 톰
 *  C5 ─  스네어
 *  B4 ── 로우미드 톰
 *  A4 ─  로우 톰
 *  G4 ── 하이 플로어 톰
 *  F4 ─  킥
 *  E4 ── 로우 플로어 톰
 *  D4 ─  페달 하이햇                   (x)
 * ```
 */

/**
 * 우리가 **주장하는** 판정. 표(GM 47종)와 다르다.
 *
 * 심벌 종류(크래시·라이드·열린하이햇)를 못 가르는 것은 알고리즘이 아니라
 * **분석 표본화율의 한계다** — `platform/analyze.ts`가 `ANALYSIS_RATE`(22050)로
 * 못박아 리샘플하고 `features.BANK_MAX_HZ`가 11000이라, 그 셋을 가르는 에너지가
 * 대부분 나이퀴스트 위에 있다. 44.1kHz로 올리는 선택지는 있지만 FFT 비용이 두
 * 배이고 **재 보기 전에는 이득을 모른다.**
 */
export type DrumClass =
  | "kick"
  | "snare"
  | "hihat"
  | "hihat-open"
  | "tom"
  | "cymbal"
  | "unknown";

/** 화면·MIDI가 도는 순서. 위에서 아래로 = 높은 자리에서 낮은 자리로 */
export const DRUM_CLASSES: readonly DrumClass[] = [
  "cymbal",
  "hihat-open",
  "hihat",
  "tom",
  "snare",
  "kick",
];

/** 사람이 읽는 이름. 그리드 행 이름이 된다 */
export const CLASS_NAMES: Readonly<Record<DrumClass, string>> = {
  kick: "킥",
  snare: "스네어",
  hihat: "하이햇",
  "hihat-open": "오픈 하이햇",
  tom: "톰",
  cymbal: "심벌",
  unknown: "미분류",
};

/**
 * 그리드 칸에 찍는 한 글자.
 *
 * **색만으로 구별하지 않기 위한 표식이다** — `ds.ShareBars`가 못박은 규칙과
 * 같다(고른 답을 색만으로 표시하지 않는다).
 */
export const CLASS_MARKS: Readonly<Record<DrumClass, string>> = {
  kick: "K",
  snare: "S",
  hihat: "H",
  "hihat-open": "O",
  tom: "T",
  cymbal: "C",
  unknown: "?",
};

export type NoteHead = "normal" | "x" | "circle-x" | "diamond" | "triangle";

export interface GmDrum {
  /** GM 번호 35~81 */
  readonly gm: number;
  readonly name: string;
  /** 이 번호가 속하는 **어휘**. 우리가 못 가르는 것은 `unknown`이다 */
  readonly cls: DrumClass;
  /** MusicXML `<display-step>` */
  readonly step: string;
  /** MusicXML `<display-octave>` */
  readonly octave: number;
  readonly head: NoteHead;
}

const TABLE: readonly GmDrum[] = [
  // --- 킥 ---
  { gm: 35, name: "어쿠스틱 베이스 드럼", cls: "kick", step: "F", octave: 4, head: "normal" },
  { gm: 36, name: "베이스 드럼 1", cls: "kick", step: "F", octave: 4, head: "normal" },
  // --- 스네어 계열 ---
  { gm: 37, name: "사이드 스틱", cls: "snare", step: "C", octave: 5, head: "x" },
  { gm: 38, name: "어쿠스틱 스네어", cls: "snare", step: "C", octave: 5, head: "normal" },
  { gm: 39, name: "핸드 클랩", cls: "snare", step: "C", octave: 5, head: "triangle" },
  { gm: 40, name: "일렉트릭 스네어", cls: "snare", step: "C", octave: 5, head: "normal" },
  // --- 톰 ---
  { gm: 41, name: "로우 플로어 톰", cls: "tom", step: "E", octave: 4, head: "normal" },
  { gm: 43, name: "하이 플로어 톰", cls: "tom", step: "G", octave: 4, head: "normal" },
  { gm: 45, name: "로우 톰", cls: "tom", step: "A", octave: 4, head: "normal" },
  { gm: 47, name: "로우미드 톰", cls: "tom", step: "B", octave: 4, head: "normal" },
  { gm: 48, name: "하이미드 톰", cls: "tom", step: "D", octave: 5, head: "normal" },
  { gm: 50, name: "하이 톰", cls: "tom", step: "E", octave: 5, head: "normal" },
  // --- 하이햇 ---
  { gm: 42, name: "클로즈드 하이햇", cls: "hihat", step: "G", octave: 5, head: "x" },
  { gm: 44, name: "페달 하이햇", cls: "hihat", step: "D", octave: 4, head: "x" },
  { gm: 46, name: "오픈 하이햇", cls: "hihat-open", step: "G", octave: 5, head: "circle-x" },
  // --- 심벌 ---
  { gm: 49, name: "크래시 심벌 1", cls: "cymbal", step: "A", octave: 5, head: "x" },
  { gm: 51, name: "라이드 심벌 1", cls: "cymbal", step: "F", octave: 5, head: "x" },
  { gm: 52, name: "차이니즈 심벌", cls: "cymbal", step: "B", octave: 5, head: "x" },
  { gm: 53, name: "라이드 벨", cls: "cymbal", step: "F", octave: 5, head: "diamond" },
  { gm: 55, name: "스플래시 심벌", cls: "cymbal", step: "A", octave: 5, head: "x" },
  { gm: 57, name: "크래시 심벌 2", cls: "cymbal", step: "A", octave: 5, head: "x" },
  { gm: 59, name: "라이드 심벌 2", cls: "cymbal", step: "F", octave: 5, head: "x" },

  // --- 그 밖의 타악. **표에는 있고 어휘에는 없다** ---
  //
  // 검출기가 이것들을 주장하지 않는다(`cls: "unknown"`). 이름을 붙일 수 있다는
  // 것과 귀로 가른다는 것은 다른 말이고, 그 둘을 섞으면 규칙 1을 어긴다.
  // 손드럼 입력·외부 MIDI는 이 줄들 덕분에 이름을 얻는다.
  { gm: 54, name: "탬버린", cls: "unknown", step: "G", octave: 5, head: "normal" },
  { gm: 56, name: "카우벨", cls: "unknown", step: "D", octave: 5, head: "triangle" },
  { gm: 58, name: "비브라슬랩", cls: "unknown", step: "D", octave: 5, head: "triangle" },
  { gm: 60, name: "하이 봉고", cls: "unknown", step: "E", octave: 5, head: "normal" },
  { gm: 61, name: "로우 봉고", cls: "unknown", step: "D", octave: 5, head: "normal" },
  { gm: 62, name: "뮤트 하이 콩가", cls: "unknown", step: "B", octave: 4, head: "normal" },
  { gm: 63, name: "오픈 하이 콩가", cls: "unknown", step: "A", octave: 4, head: "normal" },
  { gm: 64, name: "로우 콩가", cls: "unknown", step: "G", octave: 4, head: "normal" },
  { gm: 65, name: "하이 팀발레", cls: "unknown", step: "E", octave: 5, head: "normal" },
  { gm: 66, name: "로우 팀발레", cls: "unknown", step: "D", octave: 5, head: "normal" },
  { gm: 67, name: "하이 아고고", cls: "unknown", step: "E", octave: 5, head: "triangle" },
  { gm: 68, name: "로우 아고고", cls: "unknown", step: "D", octave: 5, head: "triangle" },
  { gm: 69, name: "카바사", cls: "unknown", step: "G", octave: 5, head: "x" },
  { gm: 70, name: "마라카스", cls: "unknown", step: "G", octave: 5, head: "x" },
  { gm: 71, name: "쇼트 휘슬", cls: "unknown", step: "A", octave: 5, head: "x" },
  { gm: 72, name: "롱 휘슬", cls: "unknown", step: "A", octave: 5, head: "x" },
  { gm: 73, name: "쇼트 기로", cls: "unknown", step: "G", octave: 5, head: "x" },
  { gm: 74, name: "롱 기로", cls: "unknown", step: "G", octave: 5, head: "x" },
  { gm: 75, name: "클라베스", cls: "unknown", step: "C", octave: 5, head: "triangle" },
  { gm: 76, name: "하이 우드블록", cls: "unknown", step: "E", octave: 5, head: "triangle" },
  { gm: 77, name: "로우 우드블록", cls: "unknown", step: "D", octave: 5, head: "triangle" },
  { gm: 78, name: "뮤트 쿠이카", cls: "unknown", step: "B", octave: 4, head: "normal" },
  { gm: 79, name: "오픈 쿠이카", cls: "unknown", step: "A", octave: 4, head: "normal" },
  { gm: 80, name: "뮤트 트라이앵글", cls: "unknown", step: "A", octave: 5, head: "triangle" },
  { gm: 81, name: "오픈 트라이앵글", cls: "unknown", step: "A", octave: 5, head: "triangle" },
];

/** GM 번호로 찾는 표. GM 타악 구간(35~81) 전부 든다 */
export const GM_DRUMS: Readonly<Record<number, GmDrum>> = Object.freeze(
  Object.fromEntries(TABLE.map((d) => [d.gm, d])),
);

/** 표에 있는 번호 전부. 오름차순 */
export const GM_NUMBERS: readonly number[] = TABLE.map((d) => d.gm).toSorted((a, b) => a - b);

/**
 * 어휘 하나를 내보낼 때 쓸 대표 GM 번호.
 *
 * 검출기는 어휘로 판정하지만 MIDI·악보는 번호를 요구한다. **그 변환이 한
 * 곳에만 있어야 한다** — 두 벌이 되면 악보의 스네어와 MIDI의 스네어가 갈린다.
 * `theory.noteNames()`를 두 곳에서 손으로 다시 구현했던 사고와 같은 종류다.
 */
const REPRESENTATIVE: Readonly<Record<DrumClass, number>> = {
  kick: 36,
  snare: 38,
  hihat: 42,
  "hihat-open": 46,
  tom: 47,
  cymbal: 49,
  // 미분류 타점은 사이드 스틱 자리에 찍는다 — 스네어 줄이되 머리표가 달라
  // 눈으로 바로 갈린다. 소리로도 원곡을 오해하게 만들지 않는다.
  unknown: 37,
};

export function representative(cls: DrumClass): number {
  return REPRESENTATIVE[cls];
}

/** GM 번호가 속한 어휘. 표에 없는 번호는 `unknown` */
export function classOf(gm: number): DrumClass {
  return GM_DRUMS[gm]?.cls ?? "unknown";
}
