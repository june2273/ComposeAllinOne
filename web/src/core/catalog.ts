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
 * | tool | 없음 | 파일·데이터 | (미구현) 백그라운드 작업 |
 *
 * `Session`은 quiz 전용이다. 코드 학습(리듬 게임)이나 분석 도구를 여기에
 * 태우려 하지 말 것 — 문제 큐·제한시간·정답 판정이 전부 맞지 않는다.
 */

import { DIATONIC_INTERVALS, INTERMEDIATE, type SessionConfig } from "./config";

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

const HARMONY: Activity[] = [
  {
    id: "harmony.interval_diatonic",
    domain: Domain.Harmony,
    kind: Kind.Quiz,
    title: "온음정",
    summary: "한 조의 음계음으로 만든 음정. 도수·반음 수·성질.",
    status: Status.Ready,
    config: DIATONIC_INTERVALS,
  },
  {
    id: "harmony.interval_chromatic",
    domain: Domain.Harmony,
    kind: Kind.Quiz,
    title: "반음정",
    summary: "임시표가 붙은 음정. 증·감이 본격적으로 나온다.",
    status: Status.Planned,
    features: ["증·감 음정", "겹증·겹감", "이명동음 구별"],
    requires: [
      "theory는 이미 계산한다 — 겹증·겹감까지 검증됨",
      "생성기가 natural()을 써서 검은건반을 거부한다. 조표에서 Pitch를 유도하는 층이 필요",
      "UI 성질 버튼 5개 → 7개",
    ],
  },
  {
    id: "harmony.interval_compound",
    domain: Domain.Harmony,
    kind: Kind.Quiz,
    title: "겹음정",
    summary: "옥타브를 넘는 음정. 9도·11도·13도.",
    status: Status.Planned,
    features: ["홑음정 환원", "9·11·13도", "텐션과의 연결"],
    requires: [
      "intervalBetween()이 이미 9·10도를 계산한다(검증됨)",
      "생성기의 MAX_NUMBER 상한과 음역 축만 넓히면 된다",
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
    title: "조표 다이아토닉",
    summary: "조표를 읽고 그 조의 다이아토닉 화음을 답한다.",
    status: Status.Planned,
    features: ["조표 읽기", "으뜸조/나란한조", "다이아토닉 7화음", "로마자"],
    requires: [
      "조(key) 개념이 필요 — allowedPitchClasses는 임시 형태다",
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
    requires: ["스케일 생성기 + 특성음 강조 재생"],
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
      "스템 분리 — 보컬·드럼·베이스·기타",
      "코드 진행 — 비트 동기 크로마 위에서",
      "MIDI 변환 — 오디오에서 음표 추출",
      "악보 변환 — MIDI에서 오선보 (score.ts 재사용)",
      "피치 커브 — 보컬 음정 궤적",
    ],
    requires: [
      "연습 세션이 아니다 — 점수·제한시간·문제가 없다. Session을 쓰지 않는다",
      "BPM·박자·조성은 순수 DSP라 브라우저에서 끝난다(core/analysis). 워커에서 돌린다",
      "변박·전조·변속은 '구간을 어떻게 나누는가'의 문제다 — 구조 분석이 먼저 필요하다",
      "스템 분리·코드 인식·멜로디는 무거운 모델이 필요하다. Tauri의 Rust 쪽이나 Python 사이드카로 내보낼 것. 수 분이 걸리므로 진행률과 취소가 필요하다",
      "도입하는 라이브러리·모델은 전부 citation.md에 기록 — 이 분야는 라이선스가 제각각이고 학습 데이터 출처가 불투명한 모델이 섞여 있다",
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
