# 웹 프론트엔드 (React + Vite)

Python/PySide6 앱을 웹으로 옮긴 것. **기존 Python 앱은 저장소 루트에 그대로
있고 계속 동작한다.** 파이가 맞을 때까지 둘을 나란히 둔다.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 이식 검증 + UI 결선 (78개 검사)
npm run build
```

## 구조

```
src/
  core/        React를 모르는 순수 로직. Python판을 1:1로 옮겼다.
    theory.ts      음이름·음고류·Pitch·Interval
    config.ts      난이도 8축 + 프리셋
    catalog.ts     활동 목록 (무엇을 연습·분석할 수 있는가)
    questions.ts   문제 생성기 (Strategy)
    grading.ts     채점기 5종 (Strategy)
    session.ts     세션 상태 기계
    score.ts       verovio 악보
    audio.ts       Web Audio 백엔드
  ui/
    useSession.ts  타이머·입력을 Session에 잇는 훅 (문항형 전용)
    pages.tsx      홈 / 목록 / 문항형 / 준비 중 / 결과
    stages.tsx     스테이지별 문제 표시 + 답 입력
    components.tsx NavBar · Card · Staff
    styles/
      tokens.css   ← 브랜딩이 바뀔 때 손대는 유일한 파일
      app.css      컴포넌트 스타일 (값은 전부 토큰을 거친다)
```

의존성은 한 방향으로만 흐른다: `ui/` → `core/` → (없음). `core/`는 React를
import하지 않는다 — 그래서 브라우저 없이 테스트가 돈다.

## 디자인 시스템 (`src/ds/`)

**claude.ai/design에 넘기는 것은 이 폴더다.** 여기 있는 컴포넌트는 도메인을
모른다 — `Pitch`·`Question`·`SessionConfig` 같은 것을 받지 않고 문자열·숫자·
불리언만 받는다. 그래야 디자인 도구가 화성학을 몰라도 화면을 조립할 수 있다.

```bash
npm run build:ds   # dist-ds/{index.js, index.d.ts, index.css}
```

부품 17개: `Button` `Badge` `Card` `NavBar` `PageHeading` `Stack`
`SessionHeader` `TimerBar` `Verdict` `NumberField` `ChoiceRow` `Hint`
`StaffFigure` `ScoreRow` `ScoreSummary` `SpecSection` `PlannedNotice`

지켜야 할 규칙 셋 (`src/ds/index.tsx` 머리말에도 적어 뒀다):

1. **props는 원시 값과 콜백만.** 도메인 타입을 받는 순간 그 부품은 디자인
   도구에서 쓸 수 없게 된다.
2. **상태를 갖지 않는다.** 무엇을 보여줄지는 부르는 쪽이 정한다.
3. **색·간격·글자 크기를 직접 적지 않는다.** 전부 토큰을 거친다.

도메인과 잇는 일은 `src/ui/`가 한다. 예를 들어 `StaffFigure`는 SVG 문자열만
받고, `Pitch` 두 개를 verovio로 굽는 일은 `ui/components.tsx`의 `Staff`가 한다.

## 디자인을 맡길 때 알아야 할 것

**색·간격·글자크기·모서리·서체는 전부 `src/ui/styles/tokens.css`의 CSS 변수를
거친다.** 컴포넌트에는 하드코딩된 값이 없으므로, 브랜드가 정해지면 그 파일의
값만 갈아끼우면 앱 전체가 따라온다.

지금 토큰 값은 **의도적으로 중립적**이다. 정체성이 정해지기 전에 임의의 색을
넣어두면 그게 기준처럼 굳어버리기 때문이다.

바꿀 만한 것:

| 토큰 | 지금 | 브랜딩에서 |
|---|---|---|
| `--color-accent` | 파랑 | 브랜드 주색 |
| `--font-sans` | 시스템 서체 | 브랜드 서체 |
| `--radius-*` | 6~16px | 각지게 / 둥글게 |
| `--color-surface*` | 3단계 회색 | 배경 체계 |
| `--color-correct/wrong/timeout` | 초록/빨강/노랑 | 판정 색 |

`light-dark()`로 밝은 테마와 어두운 테마를 함께 정의한다. 한쪽만 바꾸면
다른 쪽이 깨진다.

### 손대면 안 되는 규칙 하나

`.staff svg svg { color; fill }` (app.css). verovio가 악보 SVG 안쪽에
`color="black"`을 박아 넣어서, 이 두 줄이 없으면 **어두운 테마에서 악보가
배경에 묻힌다.** 오선은 `stroke`, 음표 글리프는 `fill`을 타므로 둘 다
필요하다(실측). 색은 바꾸되 규칙 자체는 지우지 말 것.

## 아직 없는 것

- **MIDI 입력** — Tauri를 붙일 때 네이티브로 읽는다. 지금은 컴퓨터 자판
  `A W S E D F T G Y H U J K` = C4~C5 폴백만 있다.
- **샘플 피아노** — Upright Piano KW(CC0)가 31MiB라 웹 로딩 전략을 먼저
  정해야 한다. 지금은 사인파 가산합성.
- 카탈로그 15개 중 13개 — `catalog.ts`의 `requires`에 각각 무엇이 필요한지
  적혀 있고, 앱에서 그 활동을 열면 그대로 화면에 나온다.

## Python판과의 차이

계산 규칙은 한 줄도 바꾸지 않았다(같은 테스트 케이스로 검증). 사라진 것은
Qt 때문에 필요했던 우회들이다.

| Python/Qt에서 필요했던 것 | 웹에서 |
|---|---|
| verovio 중첩 `<svg>` 평탄화 | 브라우저가 그냥 처리 |
| 오선에 `stroke` 주입 | `<style>`이 그대로 먹는다 |
| 종횡비 유지용 커스텀 위젯 | `viewBox` + CSS 두 줄 |
| GIL 회피용 "미리 렌더 후 던지기" | Web Audio가 오디오 스레드에서 스케줄 |
