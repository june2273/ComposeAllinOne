/**
 * 활동 카탈로그 — 이 앱이 무엇을 하는지의 단일 목록.
 *
 * **새 연습·도구를 추가할 때 가장 먼저 손대는 곳이다.** 여기에 `Activity` 한 줄을
 * 넣으면 홈·목록 화면에 자동으로 나타나고, `status`가 planned이면 "준비 중" 화면이
 * 그 설명을 그대로 보여준다. 구현이 끝나면 status를 ready로 바꾸고 화면을 잇는다.
 *
 * ## 활동은 세 종류다 — 이게 이 파일의 핵심
 *
 * 셋은 시간 축과 결과의 성격이 근본적으로 다르다. 하나의 세션 모델로 묶으면
 * 반드시 어그러진다.
 *
 * | 종류 | 시간 축 | 결과 | 쓰는 것 |
 * |---|---|---|---|
 * | quiz | 문제당 카운트다운 | 점수 N/10 | `Session` |
 * | performance | 곡 전체가 흐르는 타임라인 | 타이밍 정확도 | (미구현) 트랜스포트 시계 |
 * | tool | 없음 | 파일·데이터 | `core/analysis` + 워커 |
 * | free | 없음 | **없음** | `AudioBackend.noteOn` |
 *
 * `free`는 결과가 없다는 점에서 나머지 셋과 다르다. 자유 연주는 무엇을 남기려고
 * 하는 일이 아니라 소리를 내는 일 자체가 목적이라, 점수도 파일도 만들지 않는다.
 *
 * `Session`은 quiz 전용이다. 코드 학습(리듬 게임)이나 분석 도구를 여기에
 * 태우려 하지 말 것 — 문제 큐·제한시간·정답 판정이 전부 맞지 않는다.
 */

import {
  CIRCLE_OF_FIFTHS,
  INTERMEDIATE,
  INTERVALS,
  KEY_SIGNATURE,
  SCALE,
  type SessionConfig,
} from "./config";

export const Domain = {
  Ear: "청음",
  Harmony: "화성학",
  Analysis: "음악분석도구",
} as const;
export type Domain = (typeof Domain)[keyof typeof Domain];

export const Kind = {
  Quiz: "quiz",               // 문항형 — Session이 돈다
  Performance: "performance", // 연주형 — 타임라인 위에서 친다
  Tool: "tool",               // 도구 — 입력을 분석·변환한다
  Free: "free",               // 자유 연주 — 시간 축도 결과도 없다
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export const Status = {
  Ready: "동작",
  Planned: "준비 중",
} as const;
export type Status = (typeof Status)[keyof typeof Status];

export const DOMAIN_SUMMARY: Record<Domain, string> = {
  [Domain.Ear]: "소리만 듣고 맞힌다. 음높이부터 EQ·음량·정위까지.",
  [Domain.Harmony]: "악보와 이론. 음정에서 텐션·모드까지, 그리고 코드 연주.",
  [Domain.Analysis]: "곡을 분석하고 변환한다. 연습이 아니라 작곡 도구.",
};

export interface Activity {
  readonly id: string;
  readonly domain: Domain;
  readonly kind: Kind;
  readonly title: string;
  readonly summary: string;
  readonly status: Status;
  /** quiz이면서 ready일 때만 채운다. */
  readonly config?: SessionConfig;
  readonly needsMidi?: boolean;
  /** 준비 중 화면에 그대로 보여줄 것들. 구현할 사람이 읽을 메모다. */
  readonly features?: readonly string[];
  readonly requires?: readonly string[];
}

export function isReady(a: Activity): boolean {
  return a.status === Status.Ready;
}

// --- 청음 -------------------------------------------------------------------

const EAR: Activity[] = [
  {
    id: "ear.single_note",
    domain: Domain.Ear,
    kind: Kind.Quiz,
    title: "단일음 청음",
    summary: "한 음을 듣고 건반에서 찾는다.",
    status: Status.Ready,
    config: INTERMEDIATE,
    needsMidi: true,
  },
  {
    id: "ear.chord",
    domain: Domain.Ear,
    kind: Kind.Quiz,
    title: "화음 청음",
    summary: "화음을 듣고 구성음을 전부 누른다.",
    status: Status.Planned,
    needsMidi: true,
    features: ["3화음", "7화음", "전위", "아르페지오 모드"],
    requires: [
      "questions.ts에 화음 생성기 (makeGenerator의 chordPool 분기)",
      "chordHoldMs = 70 — 입력 그룹핑은 이미 동작한다",
      "채점은 PitchClassGrader를 그대로 쓴다",
    ],
  },
  {
    id: "ear.eq",
    domain: Domain.Ear,
    kind: Kind.Quiz,
    title: "EQ 청음",
    summary: "어느 대역이 얼마나 부스트/컷됐는지 맞힌다.",
    status: Status.Planned,
    features: ["대역 맞히기", "게인 방향", "Q 폭", "A/B 비교 재생"],
    requires: [
      "Web Audio의 BiquadFilterNode — 브라우저가 기본 제공한다",
      "핑크 노이즈 또는 음악 소스 — 음원 라이선스 확인 필요",
      "응답 형식: 주파수 선택 + 게인 부호. IntervalResponse처럼 폼 응답",
    ],
  },
  {
    id: "ear.loudness",
    domain: Domain.Ear,
    kind: Kind.Quiz,
    title: "라우드니스 청음",
    summary: "두 소리의 음량 차이를 dB로 맞힌다.",
    status: Status.Planned,
    features: ["dB 차이 맞히기", "LUFS 감각", "피크 vs 라우드니스"],
    requires: [
      "Web Audio의 GainNode",
      "재생 레벨 교정 — 시스템 볼륨에 따라 체감이 달라진다",
    ],
  },
  {
    id: "ear.pan",
    domain: Domain.Ear,
    kind: Kind.Quiz,
    title: "팬 청음",
    summary: "소리가 좌우 어디에 놓였는지 맞힌다.",
    status: Status.Planned,
    features: ["정위 각도", "폭(스테레오 width)", "헤드폰 권장 안내"],
    requires: [
      "Web Audio의 StereoPannerNode",
      "출력이 스테레오인지 확인하는 절차",
    ],
  },
];

// --- 화성학 -----------------------------------------------------------------

// 음정은 **활동 하나에 옵션 넷**이다. 예전에는 다섯 줄이었는데(반음 계산법 ·
// 음정표 외우기 · 온음정 · 반음정 · 겹음정) 다섯이 한 과목이라 메뉴만 길었다.
// 단계·음 범위·겹음정이 옵션으로 내려갔고, 그래서 이 활동만 **스테이지 셋을
// 고를 수 있다**(`config.LEVEL_CONFIGS`).
const HARMONY: Activity[] = [
  {
    id: "harmony.interval",
    domain: Domain.Harmony,
    kind: Kind.Quiz,
    title: "음정",
    summary: "두 음을 보고 음정을 구한다. 거꾸로 음을 쌓기도 한다.",
    status: Status.Ready,
    config: INTERVALS,
    features: [
      "악보와 소리로 두 음을 준다. 답은 '증5'처럼 성질 + 도수를 친다 (도는 생략)",
      "단계 — 연습 1(도수·반음 세기) · 연습 2(성질까지) · 음정 이름(전부)",
      "음정 해석 — 방향이 반대다. 'G4 · 장2도 · 위로'에 건반으로 A4를 누른다",
      "음 범위 — 온음계 / 반음계(♯♭) / 겹임시표(♯♯♭♭). 켤수록 증·감이 늘어난다",
      "겹음정 — 9도 이상. 보이는 그대로 답한다 (E♭4–F5는 장9도)",
      "낮은음자리표 — 켜면 낮은 자리의 음도 나와 두 자리표가 섞인다",
      "여기서 '반음'은 미–파·시–도 자리의 개수다 — 임시표를 무시하고 센 골격 값이다",
      "한글 입력기가 꺼져 있어도 된다. P M N A D · AA DD · AAA DDD로도 친다",
    ],
  },
  {
    id: "harmony.scale",
    domain: Domain.Harmony,
    kind: Kind.Quiz,
    title: "음계",
    summary: "음계 이름을 보고 건반으로 상행 8음을 순서대로 친다.",
    status: Status.Ready,
    config: SCALE,
    needsMidi: true,
    features: [
      "'D Major scale'을 주면 레 미 파♯ 솔 라 시 도♯ 레를 차례로 친다",
      "한 음 칠 때마다 온음표로 악보에 찍혀서 다 치면 음계 한 줄이 남는다",
      "틀린 음은 받지 않는다 — 악보도 진행도 안 움직이고 맞을 때까지 다시 친다",
      "음계 종류 — 장음계 · Natural minor · Harmonic minor · Melodic minor · 전부 섞어서",
      "Harmonic minor는 Natural minor의 7음을, Melodic minor는 6·7음을 반음 올린 것",
      "12조 전부 나온다. **조표가 아니라 임시표**로 그린다 — 조표는 따로 다룬다",
      "MIDI 건반이 없으면 화면 건반을 마우스로 눌러도 된다",
    ],
  },
  {
    id: "harmony.keysig",
    domain: Domain.Harmony,
    kind: Kind.Quiz,
    title: "조표",
    summary: "조표를 보고 조를 읽고, 거꾸로 조에서 조표를 쓴다.",
    status: Status.Ready,
    config: KEY_SIGNATURE,
    features: [
      "오선지에 ♯이 둘이면 'D' — 그 조표의 으뜸음 이름을 친다",
      "유형 — 장조 으뜸음 · 단조 으뜸음 · 둘 다 · 조→조표 · 이명동음조",
      "'조→조표'는 붙는 음이름을 순서대로 친다 — ♯2면 'F C'(파도솔레라미시)",
      "이명동음조는 **♯ 개수 + ♭ 개수 = 12** 하나로 외운다. ♯5↔♭7 · ♯6↔♭6 · ♯7↔♭5",
      "이름 표기는 너그럽다 — D · d · D Major · D장조가 전부 같은 답이다",
      "표 보기를 켜면 이명동음조 세 쌍이 덧셈과 함께 나온다",
    ],
  },
  {
    id: "harmony.circle",
    domain: Domain.Harmony,
    kind: Kind.Quiz,
    title: "5도권",
    summary: "원의 한 자리를 주면 이어지는 자리를 채운다.",
    status: Status.Ready,
    config: CIRCLE_OF_FIFTHS,
    features: [
      "G에서 시계방향이면 D - A - E - B … 로 이어 간다",
      "빈칸 수를 4~6칸에서 고른다. 방향은 문제마다 섞인다",
      "B/C♭ · F♯/G♭ · C♯/D♭ 세 자리는 **어느 이름으로 써도 정답**이다",
      "그 세 자리가 ♯계와 ♭계가 만나 원이 닫히는 곳 — 이명동음조와 같은 사실이다",
    ],
  },
  {
    id: "harmony.triad",
    domain: Domain.Harmony,
    kind: Kind.Quiz,
    title: "3화음",
    summary: "장·단·증·감 3화음과 전위를 읽고 답한다.",
    status: Status.Planned,
    features: ["4종 성질", "1·2전위", "자리바꿈 표기"],
    requires: [
      "화음 응답 폼 — 근음 + 성질 + 전위. IntervalResponse와 같은 방식",
      "악보는 score.ts에 3음 이상 그리는 함수 추가 (지금은 2음 전용)",
    ],
  },
  {
    id: "harmony.key_diatonic",
    domain: Domain.Harmony,
    kind: Kind.Quiz,
    title: "다이아토닉 화음",
    summary: "조표를 읽고 그 조의 다이아토닉 화음을 답한다.",
    status: Status.Planned,
    features: ["다이아토닉 3화음·7화음", "로마자", "조표는 '조표' 활동에서 따로 익힌다"],
    requires: [
      "화음 자료구조 — 근음에서 도수로 쌓는 ChordSpec (3화음·7화음과 공유한다)",
      "조표 읽기는 이제 있다 (harmony/keys.ts) — 여기 남은 것은 화음뿐이다",
      "로마자 분석 라이브러리 도입을 여기서 검토할 것",
    ],
  },
  {
    id: "harmony.seventh",
    domain: Domain.Harmony,
    kind: Kind.Quiz,
    title: "7화음 연습",
    summary: "maj7·m7·7·m7♭5·dim7을 구별한다.",
    status: Status.Planned,
    features: ["5종 성질", "전위", "이명동음 함정(dim7)"],
    requires: [
      "dim7은 4종이 건반에서 동일하다 — 기술검토서 3절 이명동음 방침 A+C를 여기서 처음으로 실제 적용해야 한다",
    ],
  },
  {
    id: "harmony.tension",
    domain: Domain.Harmony,
    kind: Kind.Quiz,
    title: "텐션",
    summary: "9·11·13과 변화 텐션. 생략음을 허용한다.",
    status: Status.Planned,
    features: ["♭9·♯9·♯11·♭13", "생략 가능음", "어보이드 노트"],
    requires: [
      "requiredPcs / optionalPcs가 이미 이 규칙을 담는다 — 채점기는 손대지 않아도 된다",
      "화음 정의 테이블을 데이터로 넣는 작업이 대부분",
    ],
  },
  {
    id: "harmony.mode",
    domain: Domain.Harmony,
    kind: Kind.Quiz,
    title: "모드",
    summary: "7가지 교회선법을 듣고, 읽고, 구별한다.",
    status: Status.Planned,
    features: ["이오니안~로크리안", "특성음", "모달 인터체인지"],
    requires: [
      "스케일 생성기는 이제 있다 (harmony/scales.ts) — 패턴 배열에 일곱 줄을 더하면 된다",
      "남은 것은 특성음 강조 재생 — AudioBackend.playSequence가 음마다 velocity를 받는다",
    ],
  },
  {
    id: "harmony.free_piano",
    domain: Domain.Harmony,
    kind: Kind.Free,
    title: "가상 피아노",
    summary: "자판·마우스·MIDI 건반으로 자유롭게 친다. 문제도 점수도 없다.",
    status: Status.Ready,
    needsMidi: true,
    features: [
      "아랫줄 A S D F G H J K L ; ' 가 흰건반 — A가 도, 기본값은 C4",
      "윗줄 W E T Y U O P가 검은건반 — 도♯ 레♯ 파♯ 솔♯ 라♯",
      "옥타브(Z / X)와 트랜스포즈(← / →)로 음역을 옮긴다",
      "서스테인 — 켜면 건반을 떼도 소리가 남는다",
      "음역은 청음이 쓰는 피아노 음원이 덮는 만큼(A0~C8)이고 그 밖으로는 못 나간다",
    ],
  },
  {
    id: "harmony.chord_play",
    domain: Domain.Harmony,
    kind: Kind.Performance,
    title: "코드 학습",
    summary: "유명 곡의 코드 진행이 흐르면 박자에 맞춰 친다. 리듬 게임 방식.",
    status: Status.Planned,
    needsMidi: true,
    features: [
      "코드 진행이 화면을 가로질러 흐른다",
      "박자에 맞춰 MIDI 건반으로 해당 코드를 누른다",
      "타이밍 판정 (Perfect / Good / Miss)",
      "곡 선택 · BPM 조절 · 구간 반복",
    ],
    requires: [
      "Session을 쓰지 않는다. 문제 큐가 아니라 연속 타임라인이다",
      "트랜스포트 시계 — AudioContext.currentTime을 기준 시계로 삼는다. requestAnimationFrame은 화면 갱신용일 뿐 판정 기준이 되면 드리프트가 생긴다",
      "타이밍 판정기 — 정답/오답이 아니라 '얼마나 빗나갔나'(ms)",
      "곡 데이터 형식 — 코드 심볼 + 박자 위치. 저작권 주의: 코드 진행 자체는 보호 대상이 아니라는 견해가 일반적이나, 원곡 음원을 쓰면 별개 문제다",
    ],
  },
];

// --- 음악분석도구 -------------------------------------------------------------
// "올인원"이 요구사항이므로 기능별로 메뉴를 쪼개지 않는다. 파일을 한 번 열면
// 분석이 한꺼번에 돌고, 필요한 것만 꺼내 쓰는 형태가 맞다.

const ANALYSIS: Activity[] = [
  {
    id: "analysis.console",
    domain: Domain.Analysis,
    kind: Kind.Tool,
    title: "분석 콘솔",
    summary: "오디오 파일 하나를 열면 분석과 변환을 한자리에서.",
    status: Status.Ready,
    features: [
      "BPM 검출 — 템포와 박 위치 (동작)",
      "박자 검출 — 3/4·4/4와 셔플 (동작)",
      "키 검출 — 전역 조성 (동작)",
      "스템 분리 — 보컬·드럼·베이스·그 외·오프보컬 (동작 · 사이드카)",
      "피치 커브 — 보컬 음정 궤적 (동작 · 사이드카)",
      "MIDI 변환 — 노래한 그대로 / 격자에 얹은 것 두 벌 (동작)",
      "악보 변환 — 멜로디 오선보 (동작 · score.ts 재사용)",
      "악보 재생 — 분석한 BPM 격자 위에서, 재생 커서와 함께 (동작)",
      "PDF 내보내기 — A4 여러 쪽, 브라우저 인쇄 (동작)",
      "코드 진행 — 3화음·7화음, 악보에 코드 심볼로 (인식기는 있음 · 정확도를 재기 전이라 화면에서 닫아 둠)",
      "구조 분석 — intro·verse·pre-chorus·chorus 구간 (사이드카 · 느려서 기본 꺼짐)",
      "드럼 — 킥·스네어·하이햇 타점을 찾아 시퀀서 격자와 타악보로 (동작 · 스템 필요)",
      "드럼 루프·필인 — 반복되는 마디와 필인을 갈라서 목록으로 (동작)",
      "드럼 구간 반복 재생 — 눈으로 본 그 마디를 박 클릭과 함께 (동작)",
      "드럼 MIDI — 채널 10 GM 드럼맵. 곡 전체판과 루프 한 바퀴판 (동작)",
    ],
    requires: [
      "연습 세션이 아니다 — 점수·제한시간·문제가 없다. Session을 쓰지 않는다",
      "BPM·박자·조성은 순수 DSP라 브라우저에서 끝난다(core/analysis). 워커에서 돌린다",
      "스템 분리·멜로디·구조는 학습된 모델이라 브라우저 밖이다 — 로컬 Python 사이드카(server/). 꺼져 있으면 그 칸만 잠기고 나머지는 그대로 뜬다",
      "사이드카는 npm run dev가 함께 띄운다 — 처음 한 번만 cd server && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt",
      "노트 분할·양자화·MIDI·악보는 순수 로직이라 웹에 있다(core/transcribe). 모델을 갈아끼워도 여기는 안 바뀐다",
      "구조 라벨 중 pre-chorus는 모델이 못 낸다 — 학습 데이터(Harmonix)의 어휘에 없어서, 사비 직전 위치 규칙으로 우리가 붙인다(core/analysis/sections.ts)",
      "변박·전조·변속은 '구간을 어떻게 나누는가'의 문제다 — 구간은 생겼고 구간마다 다시 재는 일이 남았다",
      "드럼은 학습된 모델이 아니라 SuperFlux + 대역 규칙이라 브라우저에서 돈다(core/drums). 입력만 사이드카가 만든 드럼 스템이다",
      "드럼 어휘는 GM 드럼맵 전부를 표로 들되 귀로 가르는 것은 여섯이다 — 심벌 종류를 못 가르는 것은 분석 표본화율(22.05kHz)의 한계다",
      "드럼 정확도는 아직 말할 수 없다 — 정답을 찍어 둔 곡이 하나도 없고 임계값이 전부 근거 없는 값이다",
      "도입하는 라이브러리·모델은 전부 citation.md에 기록 — 이 분야는 라이선스가 제각각이고 학습 데이터 출처가 불투명한 모델이 섞여 있다",
    ],
  },
  {
    id: "analysis.pdf",
    domain: Domain.Analysis,
    kind: Kind.Tool,
    title: "PDF 악보",
    summary: "가지고 있는 PDF 악보를 열어 본다. 파일은 브라우저 밖으로 나가지 않는다.",
    status: Status.Ready,
    features: [
      "PDF 열기 — 끌어다 놓거나 골라서 (동작)",
      "쪽 이동·확대·검색·인쇄 — 브라우저 내장 뷰어가 그대로 준다 (동작)",
      "새 창에서 열기 — 내장 뷰어가 안 되는 환경의 탈출구 (동작)",
    ],
    requires: [
      "분석 콘솔과 갈라 둔 이유: 외부 악보를 보는 데 오디오 분석이 필요 없다. 콘솔 안에 넣으면 PDF 하나 보려고 곡을 먼저 분석해야 한다",
      "브라우저 내장 뷰어에 맡긴다 — pdfjs-dist는 1MB가 넘고, 지금 얻을 것은 쪽 번호·확대를 앱이 통제하는 것뿐이다",
      "파일은 blob URL로만 열린다. 어디에도 올라가지 않는다",
      "전사한 멜로디를 PDF로 만드는 것은 여기가 아니라 분석 콘솔의 악보 아래에 있다 — 그 악보는 콘솔 안에서만 존재한다",
    ],
  },
];

export const CATALOG: readonly Activity[] = [...EAR, ...HARMONY, ...ANALYSIS];

export const BY_ID: Record<string, Activity> = Object.fromEntries(
  CATALOG.map((a) => [a.id, a]),
);

export function byDomain(domain: Domain): Activity[] {
  return CATALOG.filter((a) => a.domain === domain);
}

export function readyActivities(): Activity[] {
  return CATALOG.filter(isReady);
}

/** [동작하는 것, 전체] */
export function counts(domain: Domain): [number, number] {
  const items = byDomain(domain);
  return [items.filter(isReady).length, items.length];
}
