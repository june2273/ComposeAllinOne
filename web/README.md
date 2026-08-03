# 화성학·청음 연습 앱 (React + Vite)

원래 PySide6 데스크톱 앱이었고 2026-08-03에 웹만 남겼다. Python판 코드가
필요하면 커밋 `10abd90`에 있다.

`scripts/`의 Python 셋은 **빌드 타임에 피아노 자산을 굽는 도구**다 — 앱이
실행 중에 Python을 부르는 곳은 없다.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 이론·세션·UI·MIDI·오디오·피아노·분석 (7파일 105개)
npm run build
```

## 구조

```
src/
  core/        React도 브라우저 API도 모르는 순수 로직
    theory.ts      음이름·음고류·Pitch·Interval
    config.ts      난이도 8축 + 프리셋
    catalog.ts     활동 목록 (무엇을 연습·분석할 수 있는가)
    questions.ts   문제 생성기 (Strategy)
    grading.ts     채점기 5종 (Strategy)
    session.ts     세션 상태 기계
    score.ts       verovio 악보
    audio.ts       Web Audio 백엔드
    analysis/      오디오 분석 — 의존성 없는 DSP
      fft.ts         FFT + STFT 프레임 (직접 구현)
      features.ts    SuperFlux ODF · 크로마 · 조율 추정
      tempo.ts       자기상관 템포 + DP 비트 추적
      meter.ts       박자표 (축A 세분화 × 축B 마디당 박)
      key.ts         Krumhansl–Schmuckler 조성
  platform/    브라우저가 어떻게 하는가. 음악적 판단 없음.
    midi.ts        Web MIDI — 포트 선택·메시지 해석
    piano.ts       샘플 피아노 (없으면 사인으로 폴백)
    analyze.ts     오디오 디코딩 + 분석 워커
    analysis.worker.ts
  ds/          디자인 시스템 — 도메인을 모르는 표시 부품
  ui/
    useSession.ts  타이머·입력을 Session에 잇는 훅 (문항형 전용)
    useMidi.ts     MIDI를 React 수명주기에 붙이는 훅
    pages.tsx      홈 / 목록 / 문항형 / 준비 중 / 결과
    stages.tsx     스테이지별 문제 표시 + 답 입력
    analysis.tsx   분석 콘솔 (도구형)
    components.tsx NavBar · Card · Staff
    styles/
      tokens.css   ← 브랜딩이 바뀔 때 손대는 유일한 파일
      app.css      컴포넌트 스타일 (값은 전부 토큰을 거친다)
scripts/       빌드 타임 자산 도구 (Python)
  download_assets.py   원본 음원 내려받기
  sfz.py               SFZ 파서
  prepare_web_piano.py 웹용 AAC + 매니페스트로 굽기
```

의존성은 한 방향으로만 흐른다: `ui/` → `platform/` → `core/` → (없음).
`core/`는 React도 브라우저 API도 import하지 않고, `platform/`은 음악적 판단을
하지 않는다 — 그래서 브라우저 없이 테스트가 돈다.

## 피아노 음원

저장소에 없다. 두 스크립트를 순서대로 돌리면 `public/piano/`에 생긴다.

```bash
.venv/bin/python web/scripts/download_assets.py      # 원본 31MiB
.venv/bin/python web/scripts/prepare_web_piano.py    # 웹용 1.3MiB로 굽는다 (ffmpeg 필요)
```

**안 돌려도 앱은 뜬다** — 음원이 없으면 사인 신스로 난다. 굽고 나면 다음
재생부터 피아노로 바뀐다.

### 조율

원본은 실제 어쿠스틱 업라이트라 **Railsback 곡선**을 따른다(저음 낮게, 고음
높게 — 조율 불량이 아니라 정상이다). 이 앱은 음정을 가르치므로 **평균율로
당긴다** — 두 음이 서로 다른 만큼 어긋나 있으면 그 음정이 맥놀이로 들린다.

**오디오는 다시 굽지 않는다.** `manifest.json`의 `tune`(센트)을 재생할 때
`playbackRate`로 되밀 뿐이라 음질 손실이 없고, **`public/piano/*.m4a`는 언제나
녹음 그대로**다. 보정을 끄려면 `prepare_web_piano.py`의 `tuning_table()`이 빈
표를 주게 하면 된다.

## MIDI 입력

**Chrome·Edge에서 건반이 바로 된다.** Safari·Firefox에는 Web MIDI가 없어서
자판 폴백으로 떨어지고, 그 사실을 화면 위 한 줄로 알려준다.

컨트롤러 하나가 포트를 여럿 내보내는 경우가 많은데, KeyLab의 `MCU/HUI` 포트는
트랜스포트 버튼을 노트 메시지로 보내 **오답을 유발한다.** `platform/midi.ts`의
`PORT_AVOID`가 이런 포트를 거른다.

MIDI와 자판 폴백은 `stages.usesMidiInput()` **하나로 함께** 켜지고 꺼진다.
음정 스테이지는 숫자·성질 키를 쓰므로 둘 다 꺼진다. 조건을 두 곳에 두면 건반
입력이 음정 채점기로 흘러들어간다.

## 분석 콘솔

오디오 파일을 열면 **BPM · 박자 · 조성**이 나온다. 전부 브라우저 안에서 돌고
파일은 어디로도 올라가지 않는다. **라이브러리를 쓰지 않는다 — FFT까지 직접
짰다**(`core/analysis/`). DSP는 워커에서 돌려 화면을 막지 않는다.

없는 것: 스템 분리·코드 인식·멜로디(학습된 모델이 필요하다), 그리고
변박·전조·변속(구간을 나누려면 구조 분석이 먼저다). 곡 전체를 한 덩어리로 본다.

알고리즘 출처는 [../citation.md](../citation.md) 3-1절 — 논문을 읽고 새로
구현했지 코드를 옮기지 않았다.

## 디자인 시스템 (`src/ds/`)

**claude.ai/design에 넘기는 것은 이 폴더다.** 여기 있는 컴포넌트는 도메인을
모른다 — `Pitch`·`Question`·`SessionConfig` 같은 것을 받지 않고 문자열·숫자·
불리언만 받는다. 그래야 디자인 도구가 화성학을 몰라도 화면을 조립할 수 있다.

```bash
npm run build:ds   # dist-ds/{index.js, index.d.ts, index.css}
```

부품 18개: `Button` `Badge` `Card` `NavBar` `PageHeading` `Stack` `DeviceStatus`
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

- **Safari·Firefox의 MIDI** — Web MIDI가 없다. Tauri를 붙일 때 네이티브로
  읽는다. 그 브라우저에서는 자판 `A W S E D F T G Y H U J K` = C4~C5 폴백.
- 카탈로그 15개 중 12개 — `catalog.ts`의 `requires`에 각각 무엇이 필요한지
  적혀 있고, 앱에서 그 활동을 열면 그대로 화면에 나온다.

## Python판에서 옮겨오며 사라진 것

계산 규칙은 한 줄도 바꾸지 않았다(같은 테스트 케이스로 검증). 사라진 것은
Qt 때문에 필요했던 우회들이다. 새로 짤 때 되살리지 말 것.

| Python/Qt에서 필요했던 것 | 웹에서 |
|---|---|
| MIDI 콜백 → Qt 시그널 (스레드 경계) | `midimessage`가 메인 스레드로 온다 |
| verovio 중첩 `<svg>` 평탄화 | 브라우저가 그냥 처리 |
| 오선에 `stroke` 주입 | `<style>`이 그대로 먹는다 |
| 종횡비 유지용 커스텀 위젯 | `viewBox` + CSS 두 줄 |
| GIL 회피용 "미리 렌더 후 던지기" | Web Audio가 오디오 스레드에서 스케줄 |
