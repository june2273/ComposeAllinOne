# 화성학·청음 연습 앱 (React + Vite)

원래 PySide6 데스크톱 앱이었고 2026-08-03에 웹만 남겼다. Python판 코드가
필요하면 커밋 `10abd90`에 있다.

`scripts/`의 Python 셋은 **빌드 타임에 피아노 자산을 굽는 도구**다 — 앱이
실행 중에 Python을 부르는 곳은 없다.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 이론·세션·UI·MIDI·오디오·피아노·분석·전사 (9파일 207개)
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
    transcribe/    f0 커브 → 음표 → MIDI·악보. 모델을 부르지 않는다
      notes.ts       Viterbi로 음표 자르기 (비브라토·옥타브 점프에 강하다)
      quantize.ts    비트 격자에 얹기 (반올림이 아니라 메트리컬 DP)
      midi.ts        SMF 쓰기 (의존성 없이 직접)
      musicxml.ts    멜로디 한 줄 MusicXML
  platform/    브라우저가 어떻게 하는가. 음악적 판단 없음.
    midi.ts        Web MIDI — 포트 선택·메시지 해석
    piano.ts       샘플 피아노 (없으면 사인으로 폴백)
    analyze.ts     오디오 디코딩 + 분석 워커
    analysis.worker.ts
    sidecar.ts     로컬 분석 서버 (없으면 그 칸만 잠긴다)
  ds/          디자인 시스템 — 도메인을 모르는 표시 부품
  ui/
    useSession.ts  타이머·입력을 Session에 잇는 훅 (문항형 전용)
    useMidi.ts     MIDI를 React 수명주기에 붙이는 훅
    pages.tsx      홈 / 목록 / 문항형 / 준비 중 / 결과
    stages.tsx     스테이지별 문제 표시 + 답 입력
    analysis.tsx   분석 콘솔 (도구형)
    transcription.tsx  분석 콘솔의 AI 칸 (스템·멜로디·악보)
    components.tsx NavBar · Card · Staff
    styles/
      tokens.css   ← 브랜딩이 바뀔 때 손대는 유일한 파일
      app.css      컴포넌트 스타일 (값은 전부 토큰을 거친다)
scripts/       빌드 타임 자산 도구 (Python)
  download_assets.py   원본 음원 내려받기
  sfz.py               SFZ 파서
  prepare_web_piano.py 웹용 AAC + 매니페스트로 굽기
```

무거운 모델은 저장소 루트의 `server/`(별도 프로세스)에 있다 — 아래 참조.

의존성은 한 방향으로만 흐른다: `ui/` → `platform/` → `core/` → (없음).
`core/`는 React도 브라우저 API도 import하지 않고, `platform/`은 음악적 판단을
하지 않는다 — 그래서 브라우저 없이 테스트가 돈다.

## 분석 사이드카 (선택)

스템 분리와 멜로디 f0는 학습된 모델이라 브라우저 안에서 끝나지 않는다. 로컬
파이썬 서버가 맡는다. **파이썬 3.11이어야 한다**(3.14에서 basic-pitch가 깨진다).

```bash
cd ../server
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt   # torch 때문에 수 GB
.venv/bin/uvicorn app.main:app --port 8420
```

**안 띄워도 앱은 뜬다** — 분석 콘솔의 BPM·박자·조성은 그대로 나오고 AI 칸만
잠긴 채 실행 방법을 보여준다. 피아노 음원과 같은 방침이다.

서버는 기동 직후 모델을 한 번씩 굴려 보고(`app/health.py`), **안 깔린 것과
깔렸는데 안 도는 것을 갈라서** 화면에 알려준다 — 뒤쪽에는 `pip install` 대신
무엇이 터졌는지가 나온다.

서버가 하는 것은 신호 처리뿐이다(스템 WAV + f0 커브). 음표로 자르고 격자에
얹고 MIDI·악보로 만드는 것은 전부 `src/core/transcribe/`라, **모델을 갈아끼워도
웹은 안 바뀐다.**

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

오디오 파일을 열면 **BPM · 박자 · 조성**이 나온다. 이 셋은 전부 브라우저 안에서
돌고 파일은 어디로도 올라가지 않는다. **라이브러리를 쓰지 않는다 — FFT까지 직접
짰다**(`core/analysis/`). DSP는 워커에서 돌려 화면을 막지 않는다.

사이드카를 띄우면 여기에 **스템 분리 · 멜로디 전사(악보 · MIDI)**가 붙는다. 그때는
파일이 로컬 서버로 간다(바깥으로는 나가지 않는다).

없는 것: 코드 인식, 구조 분석(섹션 경계), 그리고 변박·전조·변속 — 뒤의 둘은 구간을
나누는 문제라 구조 분석이 먼저다. 곡 전체를 한 덩어리로 본다.

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
- 카탈로그 17개 중 12개 — `catalog.ts`의 `requires`에 각각 무엇이 필요한지
  적혀 있고, 앱에서 그 활동을 열면 그대로 화면에 나온다.
- **분석 쪽의 평가셋** — 지금 테스트가 보증하는 것은 "알고리즘이 의도대로 도는가"
  까지다. 전사 임계값들도 합성 신호로만 확인했다. 실곡과 채보 정답이 필요하다.

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
