# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 이 저장소의 현재 상태

**React + Vite 웹 앱이다.** 2026-08-03에 PySide6 Python 앱을 삭제하고 웹판만 남겼다. Python 앱의 코드가 필요하면 **커밋 `10abd90`에 전부 있다** — 다시 만들지 말고 거기서 꺼낼 것.

**활동 15개가 카탈로그에 올라 있고 그중 3개가 동작한다** — 단일음 청음(MIDI·자판 입력), 온음정(악보 + 화면 입력), 그리고 분석 콘솔(오디오 파일 → BPM·박자·조성). 나머지는 "준비 중" 화면이 무엇을 할 것이고 무엇이 필요한지를 보여준다.

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # 105개
npm run build      # dist/
npm run build:ds   # dist-ds/ — 디자인 시스템만
npm run lint
npx tsc -b --noEmit
```

피아노 음원은 저장소에 없다. 새 환경에서는 두 스크립트를 순서대로 돌린다(ffmpeg 필요):

```bash
.venv/bin/python web/scripts/download_assets.py
.venv/bin/python web/scripts/prepare_web_piano.py
```

**안 돌려도 앱은 뜬다** — 음원이 없으면 사인 신스로 난다.

### 의존성 방향

한 방향으로만 흐른다. 위쪽은 아래쪽을 import하지 않는다 — 순환이 생기면 배치를 잘못한 것이다.

| 파일 | 역할 | import 하는 것 |
|---|---|---|
| `web/src/App.tsx` | 앱 셸 — 화면 전환, 오디오 백엔드 주입 | 전부 |
| `web/src/ui/pages.tsx` | 홈·목록·문항형·준비중·결과 | core, platform, ds |
| `web/src/ui/analysis.tsx` | 분석 콘솔 화면 (도구형) | core/analysis, platform, ds |
| `web/src/ui/stages.tsx` | 스테이지별 문제 표시 + 답 입력 | core, ds |
| `web/src/ui/useSession.ts` | 타이머·입력을 `Session`에 잇는 훅 (문항형 전용) | core |
| `web/src/ui/useMidi.ts` | MIDI를 React 수명주기에 붙이는 훅 | platform |
| `web/src/ds/index.tsx` | **디자인 시스템** — 도메인을 모른다 | (없음) |
| `web/src/platform/midi.ts` | Web MIDI — 포트 선택·메시지 해석 | (없음) |
| `web/src/platform/piano.ts` | 샘플 피아노 재생 | core/audio, core/config |
| `web/src/platform/analyze.ts` | 오디오 파일 디코딩 + 분석 워커 띄우기 | core/analysis |
| `web/src/core/analysis/` | **BPM·박자·조성.** 의존성 없는 순수 DSP (FFT까지 직접) | (없음) |
| `web/src/core/catalog.ts` | **활동 목록.** 무엇을 연습·분석할 수 있는지의 단일 출처 | config |
| `web/src/core/session.ts` | `Session` 상태 기계, `NoteCollector`, `Result` — **React를 모른다** | config, questions, grading |
| `web/src/core/grading.ts` | `Grader` 5종 (채점 엄격도 4종 + 음정 폼) | config, questions, theory |
| `web/src/core/questions.ts` | `Question` + 생성기 전략 + 태그 부착 | config, theory |
| `web/src/core/score.ts` | verovio 악보 (MusicXML → SVG) | theory |
| `web/src/core/audio.ts` | `AudioBackend` 인터페이스 + `SineSynth`/`NullSynth` | config |
| `web/src/core/config.ts` | `Stage` + `DifficultyAxes`(8축) + `SessionConfig` + 프리셋 | 없음 |
| `web/src/core/theory.ts` | 음이름·음고류 순수 함수, **`Pitch`(표기)와 `Interval`(음정)** | 없음 |

**층의 뜻**:

- **`core/`** — React도 브라우저 API도 모르는 순수 로직. 그래서 브라우저 없이 테스트가 돈다. (`core/audio.ts`의 `SineSynth`가 `AudioContext`를 쓰는 것이 유일한 예외이자 **아직 정리 못 한 빚**이다. 인터페이스는 여기, 구현은 `platform/`이 맞다.)
- **`platform/`** — "브라우저가 어떻게 하는가"만. 음악적 판단은 한 줄도 없다. **Tauri로 갈 때 여기만 갈아끼우고 위층은 안 바뀌는 것**이 이 층의 존재 이유다.
- **`ds/`** — claude.ai/design에 올리는 표시 전용 부품. 아래 절 참조.

아직 없는 것: music21 연동, **화음·텐션 문제 생성기**, 기록 저장소(SQLite), 카탈로그의 나머지 12개.

화음 관련해서 헷갈리기 쉬운 지점: **입력 쪽 화음 그룹핑(문서 4절 70ms 규칙)은 구현되어 있다** — `session.NoteCollector`가 누적하고 `useSession`의 확정 타이머가 확정한다. `SessionConfig.chordHoldMs`가 기본 0이라 1음 청음에서는 첫 note-on을 즉시 채점할 뿐이다. 없는 것은 그룹핑이 아니라 **화음을 내는 문제 생성기**(`questions.makeGenerator`가 `chordPool`에 대해 던진다)다.

### `web/scripts/`의 Python 셋

`sfz.py`·`download_assets.py`·`prepare_web_piano.py`는 **빌드 타임에 한 번 돌려 피아노 자산을 굽는 도구**다. 앱이 실행 중에 Python을 부르는 곳은 없다. Python 앱을 지울 때 이것들을 함께 지우면 새 환경에서 피아노 소리를 만들 수 없게 되므로 남겼다.

`.venv`에는 아직 PySide6·mido·python-rtmidi·sounddevice가 남아 있는데 **이제 쓰지 않는다.** 파이프라인이 실제로 쓰는 것은 `numpy`·`soundfile`뿐이다.

## 카탈로그와 활동 종류

`web/src/core/catalog.ts`가 **이 앱이 무엇을 하는지의 단일 목록**이다. 새 연습·도구를 추가할 때 가장 먼저 손대는 곳이고, `Activity` 한 줄을 넣으면 홈·목록 화면에 자동으로 나타난다. `status`가 `Planned`이면 `PlannedPage`가 그 설명(`features`·`requires`)을 그대로 보여주므로 **카탈로그 항목이 곧 명세다.**

도메인은 셋(청음 / 화성학 / 음악분석도구)이지만, 설계상 중요한 축은 도메인이 아니라 **`Kind`**다.

| Kind | 시간 축 | 결과 | 쓰는 것 | 화면 |
|---|---|---|---|---|
| `Quiz` | 문제당 카운트다운 | 점수 N/10 | `core/session.ts` | `QuizPage` |
| `Performance` | 곡 전체가 흐르는 타임라인 | 타이밍 정확도(ms) | **미구현** — 트랜스포트 시계 | 미구현 |
| `Tool` | 없음 | 파일·데이터 | `core/analysis/` + 워커 | `AnalysisPage` |

**`Session`·`useSession`·`QuizPage`는 Quiz 전용이다.** 코드 학습(리듬 게임)은 문제 큐가 아니라 연속 타임라인이고 판정도 정답/오답이 아니라 빗나간 밀리초다. 분석 콘솔은 애초에 연습 세션이 아니다(점수·제한시간·문제가 없다) — 그래서 `Session`을 쓰지 않고 `AnalysisPage`가 상태를 직접 든다. **연주형을 `Session`에 태우려 하지 말 것** — 카탈로그에서 `Ready`로 올리기 전에 전용 시계와 화면을 먼저 만들어야 한다. 어느 화면으로 보낼지는 `App.tsx`의 `ActivityScreen` 한 곳이 정한다.

리듬 게임의 기준 시계는 `performance.now()`가 아니라 **`AudioContext.currentTime`**이어야 한다. `useSession`이 `performance.now()`를 쓰는 것은 문항형에서만 맞다.

### 문항형 스테이지 추가하기

`config.Stage`가 **문제 생성기·채점기·화면 세 가지를 함께 고른다.** 손댈 곳은 원칙적으로 넷이다.

1. `core/catalog.ts`에 `Activity` 한 줄 (+ `status: Ready`, `config`)
2. `core/config.ts`의 `Stage`에 값 + `SessionConfig` 프리셋
3. `core/questions.ts`에 생성기 + `makeGenerator()`에 분기 한 줄, 채점이 다르면 `core/grading.ts`에 `Grader` + `GradingMode`
4. 화면 입력이 필요하면 `ui/stages.tsx`에 컴포넌트 + `stageFor()`에 분기 한 줄

`core/session.ts`는 바뀌지 않아야 한다. **바뀌어야 한다면 추상화가 잘못 잡힌 것이니 그 자리를 고칠 것.**

**입력 경로는 셋, 게이트는 하나다.** MIDI와 자판 폴백은 `Session.collect()` → `submit()`, 화면 입력은 `Session.respond()`로 들어오는데 전부 `accepting` 게이트를 지나 `finish()` 하나로 모인다. 새 입력 경로를 만들 때도 반드시 이 게이트를 통과시킬 것(문서 4절 락아웃 규칙이 여기 한 곳에만 있다).

`Result.response`는 스테이지마다 타입이 다르다 — 청음은 MIDI 번호 배열, 음정은 `IntervalResponse`. 생성기·채점기·화면이 스테이지 단위로 함께 정해지므로 짝이 어긋날 일은 없다.

### 앞으로 반드시 손봐야 하는 것 세 가지

1. **`AudioBackend`가 음표만 낸다.** EQ·라우드니스·팬 청음은 "이 소리에 처리를 걸어 내라"가 필요한데 `playNotes(midiNotes, duration, mode, velocity)`로는 표현할 수 없다. 다행히 브라우저가 `BiquadFilterNode`·`GainNode`·`StereoPannerNode`를 기본 제공하므로 Python판에서 예상했던 것보다 훨씬 싸다. **인터페이스를 바꾸는 일이니 세 스테이지를 한꺼번에 설계하고 한 번에 고칠 것.**
2. **분석 도구의 무거운 의존성.** BPM·박자·조성은 **의존성 없이 브라우저 안에서 끝냈다**(아래 절). 남은 것 — 스템 분리, 코드 인식, 피치 추출 — 은 전부 학습된 모델이고 스템 분리는 수 분이 걸린다. **지연 로드**해서 없어도 나머지가 뜨게 하고, **메인 스레드에서 돌리지 말 것**(Web Worker, 또는 Tauri의 네이티브 쪽). 이 분야는 라이선스가 제각각이고 학습 데이터 출처가 불투명한 모델이 섞여 있으니 citation.md 기록을 특히 성실히 할 것.
3. **기록 저장소가 없다.** 활동이 15개가 되면 "무엇을 얼마나 했는가"가 필요해진다. 웹은 IndexedDB, Tauri는 SQLite — `session.Result`를 넘겨받는 포트 하나로 갈라야 한다.

## 디자인 시스템 (`web/src/ds/`)

**claude.ai/design에 올릴 대상이다.** 여기 부품은 **도메인을 import하지 않는다** — `Pitch`·`Question`·`SessionConfig`가 아니라 문자열·숫자·불리언만 받는다. 이 규칙이 깨지면 디자인 도구에서 그 부품을 쓸 수 없게 되므로, `ds/`에 `core/`를 import하는 줄이 생기면 잘못 넣은 것이다. `npm run build:ds` → `dist-ds/`.

색·간격·글자크기·모서리·서체는 전부 `web/src/ui/styles/tokens.css`의 CSS 변수를 거친다. 브랜드가 정해지면 그 파일만 갈아끼우면 앱 전체가 따라온다.

**`.staff svg svg { color; fill }`(app.css)를 지우지 말 것.** verovio가 악보 SVG 안쪽에 `color="black"`을 박아 넣어서, 이 두 줄이 없으면 어두운 테마에서 악보가 배경에 묻힌다. 오선은 `stroke`, 음표 글리프는 `fill`을 타므로 둘 다 필요하다(실측).

## MIDI 입력

**Chrome·Edge에서는 웹에서 바로 건반이 된다.** `platform/midi.ts`의 `WebMidiInput`이 Web MIDI를 읽고, `ui/useMidi.ts`가 React 수명주기에 붙이고, `QuizPage`가 `useSession.noteOn`으로 넘긴다 — **자판 폴백과 완전히 같은 경로**라 락아웃·화음 확정 규칙이 그대로 적용된다.

- **`PORT_AVOID`가 MCU/HUI 포트를 거른다.** KeyLab Essential 61 mk3는 포트를 4개 내보내는데 건반 노트는 `KL Essential 61 mk3 MIDI`에서만 나오고, `MCU/HUI` 포트는 트랜스포트 버튼을 노트 메시지로 보내 **오답을 유발한다**(실측).
- 배제되지 않은 포트를 **전부** 듣는다. 브라우저에서는 포트 열기 비용이 없어 포트 선택 UI가 필요 없다.
- **`stages.usesMidiInput()`이 MIDI와 자판 폴백을 함께 켜고 끈다.** 음정 스테이지는 숫자·성질 키를 쓰므로 둘 다 꺼진다 — 조건이 두 곳으로 갈라지면 건반 입력이 `IntervalGrader`에 MIDI 번호 배열로 들어가는 사고가 난다.
- `MidiHandlers.onNoteOn`은 `timeStamp`를 함께 넘긴다. 문항형은 안 쓰지만 **코드학습은 도착 시각이 아니라 이 값으로 판정해야 한다.**
- **스레드 경계가 없다.** `midimessage`는 메인 스레드로 들어온다 — **Tauri(Rust midir)로 가면 경계가 다시 생긴다.**
- Web MIDI가 없거나(Safari·Firefox) 권한이 거부돼도 앱은 그대로 뜬다. 상태를 `MidiSnapshot`으로 돌려주고 화면에 한 줄로 띄운다(`ds.DeviceStatus`). 자판 폴백은 `A W S E D F T G Y H U J K` = C4~C5.

## 오디오

**Upright Piano KW** (FreePats, Kawai 업라이트 녹음) — **CC0 퍼블릭 도메인**이라 저작자 표시 의무조차 없다. 대안 음원 비교와 미채택 사유는 [citation.md](citation.md) 1절에 있으니 교체할 일이 생기면 거기부터 볼 것.

- **31MiB 문제는 실제로는 없었다.** 원본이 24bit 스테레오 7초짜리라 컸을 뿐이고, 문제 재생이 2초인 이 앱에는 과했다. `prepare_web_piano.py`가 **모노 3초 AAC 64kbps**로 다시 구우면 88건반 × 벨로시티 2층 66개가 **1.3MiB**로 들어간다(실측: 브라우저 전송량 1.29MiB).
- **AAC를 쓰는 이유는 Safari다.** Ogg Vorbis를 Safari가 못 읽는다. Safari 사용자는 Web MIDI도 없어 자판으로 연습하는 쪽이라 소리까지 없으면 곤란하다. `soundfile`은 AAC를 못 써서 **ffmpeg가 빌드 타임 도구로 들어왔다**(GPL-3.0, 링크하지 않고 별도 프로세스로 실행 — citation.md 2절).
- **런타임에 SFZ를 파싱하지 않는다.** 빌드 타임에 `manifest.json`으로 굽고 브라우저는 표만 읽는다. `sfz.py`는 SFZ 규격의 일부만 구현하며 `loop_start`/`loop_end`/`loop_mode`는 **의도적으로 무시한다**(샘플이 문제 길이보다 길다).
- 샘플은 3반음 간격이라 피치 시프트가 최대 ±1반음. `AudioBufferSourceNode.playbackRate`가 처리한다.
- **음원이 없어도 앱은 돈다.** 매니페스트 404나 fetch 실패면 조용히 `SineSynth`로 간다.
- **한 문제 안에서 음색을 섞지 않는다.** 화음 중 한 음이라도 샘플이 없으면 그 재생은 전부 사인으로 낸다(`PianoSynth.canPlay`).
- **`App.tsx`에서 `useMemo`로 오디오 백엔드를 만들지 말 것 (실측).** StrictMode가 팩토리를 두 번 부르는데 백엔드는 AudioContext와 샘플 1.3MiB를 들고 있어 버려지는 쪽도 자원을 잡는다 — 샘플을 두 번 내려받는 것을 네트워크 로그로 확인했다. `useRef` + `??=`로 바꿨다.

### 사인 신스의 3배음을 키우지 말 것 (실측 2026-08-03)

배음 1·2·4는 옥타브라 기본음과 음이름이 같지만 **3배음은 12도 위라 음이름이 다르다.** 3배음이 0.22이고 끝까지 같은 레벨로 울렸더니 G4가 `G-G-D-G`로, 즉 파워코드로 들렸다(오실레이터 주파수 392·784·1176·1568Hz로 확인). 지금은 0.09로 낮추고 **배음마다 포락선을 따로 줘서 위 배음이 먼저 사라지게** 했다(실측: 3배음이 0.667초에 끝나고 기본음은 2초를 채운다). 음높이를 맞히는 앱에서 한 음이 화음으로 들리면 그 자체가 오답 요인이다.

### 이 녹음의 조율 — Railsback 곡선 (실측 2026-08-03)

**"음정이 낮다"는 것은 절반만 맞다.** 66개 샘플을 전부 재 봤더니 저음 −94~−25센트, 중음 ±13센트, 고음 +14~+35센트로 **Railsback 곡선 그대로**였다. 현의 강성(인하모니시티) 때문에 실제 피아노는 저음을 일부러 낮게, 고음을 높게 조율한다 — **조율 불량이 아니라 정상이다.**

**2026-08-03에 평균율 보정본으로 일원화했다.** 이 앱은 음정을 가르치는데, 예를 들어 D#3(−12.7센트)와 A3(−4.7센트)의 트라이톤은 8센트 어긋난 채로 들리기 때문이다. 다만 **실제 쓰는 C3~C6 구간은 중앙값 −2.9센트**라 보정 효과가 크지 않다는 점, 그리고 **스트레치 조율을 잃는 대가**가 있다는 점은 기억할 것 — 넓은 음역을 쓰는 스테이지가 생기면 다시 판단한다. 37건반 중 A7 하나는 측정이 불안정해 보정하지 않는다.

보정은 **오디오를 다시 굽지 않고** 매니페스트의 `tune`(센트)을 재생 시점에 `playbackRate`로 되미는 방식이다. 음질 손실이 없고 `public/piano/*.m4a`는 늘 녹음 원본이다. 되돌리려면 `tuning_table()`이 빈 표를 주게 하면 된다.

측정에서 두 번 틀렸으니 다시 잴 때 주의할 것:

1. **저음부는 기본음 피크가 잡음에 묻힌다**(A0의 상대 세기 0.00). 단순 FFT 최대점을 쓰면 −80센트 같은 헛값이 나온다 → 2·3배음을 보고 나눈다.
2. **배음열 피팅(f_n = n·f0·√(1+Bn²))은 불안정하다.** B가 음수로 나오는 샘플이 여럿이었고 거기서 값이 20센트 넘게 틀어졌다.
3. **검증 장치는 벨로시티 레이어다.** 같은 건반의 vL·vH는 같은 현이므로 조율이 같아야 한다. 8센트 넘게 어긋나면 측정이 틀린 것으로 보고 그 건반은 보정하지 않는다.

## 오디오 분석 (분석 콘솔)

`web/src/core/analysis/`가 오디오 파일에서 **BPM · 박자 · 조성**을 뽑는다. 파일을 열면 워커가 돌고 결과가 카드 세 장으로 나온다.

**라이브러리를 하나도 쓰지 않는다 — FFT까지 직접 짰다.** librosa/essentia에 해당하는 것을 브라우저에 들이면 수 MB에 라이선스도 제각각인데, 필요한 것은 2의 거듭제곱 실수 FFT 하나였다. 덕분에 배포물이 늘지 않았고 카피레프트 검토 대상도 그대로 verovio 하나다. 알고리즘의 출처(SuperFlux·Ellis·Krumhansl 등)는 citation.md 3-1절에 있다 — **논문을 읽고 새로 구현했지 코드를 옮기지 않았다.**

```
샘플 → [features] ODF·크로마·저역     한 번의 STFT 통과로 셋 다
         ↓
       [tempo] 자기상관 × 로그정규 prior → DP 비트 추적
         ↓
       [meter] 축A(세분화) × 축B(마디당 박)    [key] 크로마 × 프로파일
```

- **BPM은 추정값이 아니라 잡힌 비트에서 다시 뽑는다.** 비트열이 1차 자료고 BPM은 그 요약이다(사양서 §1.3이 못박은 것과 같은 이유). 그것도 중앙값이 아니라 **처음부터 끝까지의 길이 ÷ 주기 수**로 — 비트 시각이 11.6ms 프레임 격자에 묶여 있어 중앙값을 쓰면 150BPM이 153으로 나온다(실측).
- **STFT 창은 중심 정렬이다.** 안 하면 비트 시각이 창 길이의 절반만큼 늦게 잡힌다. 그래도 24ms쯤 이르게 잡히는데, 플럭스가 값이 아니라 기울기를 보기 때문이라 **보정하지 않는다**(편향 크기가 온셋 모양에 달려 있다). 허용 오차 70ms 안이다.
- **박자는 두 축을 섞지 말 것.** 축 B(마디당 박)에 6을 넣으면 4/4가 6으로 오검출되는 함정에 걸린다(madmom#402). 6/8은 축 A(3분할)의 물음이다. 셔플은 3분할 **가운데 자리가 비었는지**로 가른다.
- **크로마 하한이 200Hz인 것은 분해능 한계다.** 2048/22050에서 그 아래로는 빈 하나가 반음보다 넓어져 접는 순간 옆 칸으로 샌다. 베이스 근음이 빠지지만 배음이 채운다 — **코드 인식을 붙일 때는 이걸로 부족하다**(CQT나 더 긴 창이 필요).
- **조율을 먼저 재고 크로마를 접는다.** 실제 음원은 속도가 미세하게 어긋나 있을 때가 있고, 40센트 틀어지면 조성 판정이 통째로 흔들린다.
- **`estimateTempo`의 신뢰도는 ×2·÷2를 깎지 않는다.** 정수배는 같은 그리드의 다른 읽기지 오류가 아니라서 화면에 "다른 읽기"로 함께 띄운다. (`relatedTempo`가 비율 1을 빼먹어 최고 후보 자신이 경쟁자로 잡히고 신뢰도가 늘 0이 된 적이 있다. 회귀 시험 있음.)

**변박·전조·변속은 없다.** 곡 전체를 한 덩어리로 본다. 셋 다 "구간을 어떻게 나누는가"의 문제라 **구조 분석(섹션 경계)이 먼저** 필요하고, 특히 전조는 오디오가 아니라 **코드 시퀀스 위에서** 판정해야 한다.

임계값 상수들(`TRIPLE_MARGIN`·`COMPOUND_RATIO`·`SHUFFLE_RATIO` 등)은 **평가셋 없이 정한 값**이다. 실제 곡 20~30개와 채보 정답이 모이면 거기서 다시 맞춰야 한다 — 지금 테스트가 보증하는 것은 "알고리즘이 의도대로 도는가"까지고, 실제 음원 정확도가 아니다.

## 설계 문서가 사실상의 사양서다

[화성학_청음_앱_기술검토.md](화성학_청음_앱_기술검토.md)가 이 프로젝트의 유일한 사양서다. **코드를 쓰기 전에 반드시 전문을 읽을 것.**

오디오 분석 쪽은 별도 사양서가 있다 — `PIPELINE_SPEC.md`(이 저장소 밖). 스템 분리·코드 인식·멜로디를 붙일 때 먼저 읽을 것.

**단, 문서의 스택 부분은 과거형으로 읽을 것.** PySide6·mido·python-rtmidi·sounddevice·pyfluidsynth를 전제로 쓰였는데 지금은 전부 웹으로 대체됐다. 살아 있는 것은 **음악적 판정 규칙**(3~8절)이고, 그 부분이 이 문서의 값이다.

| 문서의 전제 | 지금 |
|---|---|
| PySide6 + QSvgWidget | React + Vite, SVG를 그대로 삽입 |
| mido + python-rtmidi (별도 스레드) | Web MIDI (메인 스레드) |
| sounddevice + numpy 미리 렌더 | Web Audio (오디오 스레드가 스케줄) |
| pyfluidsynth / SFZ 런타임 파싱 | 빌드 타임에 구운 AAC + 매니페스트 |
| music21 | 아직 없음 — 로마자 분석이 필요해지면 다시 판단 |

verovio만 그대로 살아남았다(브라우저가 원래 주 타깃이라 오히려 더 잘 맞는다).

## 외부 소스 기록 규칙

**외부 소스(라이브러리·음원·샘플·데이터·코드 조각)를 새로 도입하면 [citation.md](citation.md)에 빠짐없이 기록한다.** 링크·원저작자·라이선스·이 프로젝트의 어디에 어떻게 썼는지를 상세히 남긴다. 라이선스는 추측하지 말고 패키지 메타데이터나 배포처 원문에서 직접 확인하고, 확인 경로와 날짜도 함께 적는다.

이 파일에는 요약만 둔다. 상세 내용은 citation.md에 적는다.

현재 쓰는 것: React·Vite·TypeScript·Vitest·oxlint(MIT), **verovio(LGPLv3)**, 음원 Upright Piano KW(CC0), 빌드 타임 도구 **ffmpeg(GPL-3.0)**. 배포 시 검토가 필요한 것은 **verovio(LGPLv3)** 하나다 — PySide6와 libsndfile은 Python 앱과 함께 빠졌다. 여기에 더해 **verovio가 동봉한 SMuFL 악보 폰트 5종은 라이선스 미확인 상태**다 — 우리 SVG 출력에 글리프 외곽선이 그대로 박혀 나가므로 배포 전에 반드시 확인할 것(citation.md 2절).

## 객체지향 설계 방침

**패턴은 기본적으로 적용하지 않는다. 문서가 요구하는 변화 축이 실제로 있을 때만 넣는다.** 아래 표가 2026-08-02에 Python판에서 내린 판단이고 **TypeScript 이식에서 그대로 유지했다.** 새 패턴을 넣고 싶으면 같은 기준으로 따져서 이 표에 줄을 추가할 것 — "좋은 설계니까"는 근거가 아니다.

적용한 것:

| 패턴 / 원칙 | 어디 | 왜 남는 값이 있는가 |
|---|---|---|
| Strategy | `grading.Grader` 5종 | 문서 5절이 채점 엄격도를 **모드로 분리하라**고 못박았다. 판정 조건이 서로 겹치지 않아 분기로 두면 필연적으로 뒤엉킨다 |
| Strategy + Factory | `questions.QuestionGenerator`, `makeGenerator()` | 문서 8절의 문제 종류가 7가지. 종류마다 생성 규칙이 완전히 다르다 |
| SRP 분리 | `Session`을 UI에서 떼어냄 | 세션 규칙을 React 없이 테스트할 수 있다 |
| DIP | `Session(config, generator, grader)`, `QuizPage(config, audio, …)` | 테스트가 `NullSynth`·가짜 `MIDIAccess`·가짜 설정을 넣는다 |
| 파라미터 객체 | `SessionConfig` / `DifficultyAxes` | 문서 6절 8축. 프리셋은 축 값 묶음일 뿐이라 프리셋을 늘려도 코드는 안 바뀐다 |
| 포트/어댑터 | `platform/` | Tauri로 갈 때 갈아끼울 지점을 한 곳에 모은다 |

**검토했으나 적용하지 않은 것** (다시 꺼내기 전에 읽을 것):

| 후보 | 안 넣은 이유 | 다시 볼 조건 |
|---|---|---|
| State 패턴 (`Phase`) | 상태 5개가 한 방향으로만 흐른다 | 일시정지·복습처럼 전이가 갈라지면 |
| Abstract Factory (화면) | 화면이 5개, 변형 축이 없다 | 스킨·다국어 레이아웃이 생기면 |
| Command (실행 취소) | 되돌릴 동작이 없다 | 오답노트에서 판정 정정 기능이 생기면 |
| Singleton (오디오) | 전역 상태가 되어 테스트에서 갈아끼우기 어려워진다. 주입으로 충분 | 없음 |
| Repository (기록) | 저장소가 아직 없다 | IndexedDB / SQLite를 넣을 때 |
| 워크스페이스 분리 | 지금 타깃이 하나뿐이다 | 세 번째 타깃이 생기거나 `ds/`의 릴리스 주기가 갈릴 때 |

> Template Method(`audio.Synth`)와 Observer 항목은 Python판의 것이라 이식하면서 사라졌다. 신스가 하나로 줄었고, Qt 시그널 자리를 React 상태가 대신한다.

### 실측 — 이 구조를 고른 근거 (2026-08-02, Python판)

Python판에서 잰 값이지만 **구조가 그대로 이식됐으므로 근거도 그대로 유효하다.** 같은 기능(3화음 청음)을 옛 구조와 새 구조에 **각각 실제로 구현해서** 비교했다.

| | 옛 구조(신 클래스 하나) | 지금 구조 |
|---|---|---|
| **수정된 기존 단위** | **10개** | **1개** (`makeGenerator`의 분기 한 줄) |
| 기존 줄 삭제·변경 | −19줄 | −4줄 |
| 손댄 파일 | 1개(전부) | 1개(나머지 8개 무변경) |

핵심은 총량이 아니라 **이미 동작하던 코드를 건드린 양**이다. 옛 구조에서는 락아웃·채점·결과 표시가 한 클래스 안에 있어 화음을 넣으려면 그 전부를 다시 손대야 했다 — 회귀가 날 표면이 그만큼 넓다. 리팩터링 전후 파형 20종이 **비트 단위로 동일**했고(최대오차 0.0), 런타임은 오르지도 내리지도 않았다 — 패턴이 사는 값은 전부 변경 비용 쪽이다.

## 설정과 검증

세션 설정은 전부 `core/config.ts`의 `SessionConfig`에 있다. **다른 곳에 설정 상수를 다시 만들지 말 것.** 프리셋은 `PRESETS`("초급/중급/고급"). **활동 목록은 config가 아니라 `catalog.ts`에 있다** — 목록을 config에 두면 config가 화면 구성까지 알게 된다.

`npm test`가 105개를 돌린다(`web/test/`). 층이 셋이다.

- **`core.test.ts`** — 세션 규칙과 음악 이론. 브라우저 없이 돈다. `Session`을 직접 만들어 `nextQuestion()` → `beginListening()` → `collect()`/`respond()` → `submit()`을 부르면 세션 전체가 돈다. 시간은 인자로 넘기므로 실제로 기다릴 필요가 없다.
- **`ui.test.tsx` / `strict.test.tsx`** — jsdom + fake timers로 훅·타이머·채점·결과 결선. **StrictMode에서 반드시 돌려볼 것**(아래).
- **`audio.test.ts` / `midi.test.tsx` / `piano.test.ts`** — 가짜 `AudioContext`·`MIDIAccess`·`fetch`를 주입한다.
- **`analysis.test.ts`** — **답을 아는 신호를 합성해 넣는다.** 120BPM 클릭 트랙의 BPM은 정의상 정확하고, 화음 진행이 정하는 조성도 그렇다. 귀로도 눈으로도 검증할 수 없는 영역이라 이 방법 말고는 없다. 다만 **실제 음원 정확도는 이 테스트가 말해 주지 않는다.**

**악보는 눈으로 검증하지 말 것.** 3도와 6도를 구별하기 어렵다. SVG의 음표 y좌표 차이가 `(도수-1) × 한 계단`인지로 확인한다 — verovio 좌표계에서 한 계단은 90단위다.

### StrictMode에서 두 번 데였다

`main.tsx`가 `<StrictMode>`로 감싼다. **개발 중 업데이터·팩토리·이펙트가 두 번 실행된다.**

1. **`useState` 업데이터 안에서 다른 `setState`를 부르지 말 것.** 업데이터가 두 번 실행되어 숫자가 두 번 반영됐다 — `12`를 치면 `22`가 됐다. `useReducer`(순수)로 고쳤다.
2. **`useMemo`로 무거운 자원을 만들지 말 것.** 팩토리가 두 번 불려 오디오 백엔드가 두 개 생기고 샘플 1.3MiB를 두 번 받았다. `useRef` + `??=`로 고쳤다.
3. 비동기 초기화(`WebMidiInput.start()`)는 **세대 번호로 가드**한다. 정리 함수가 먼저 돌아도 진행 중이던 초기화가 뒤늦게 포트를 붙이면 노트가 두 번 들어간다.

## 설계상 되돌리기 어려운 결정들

이 프로젝트의 난점은 코드량이 아니라 음악적 판정 규칙이다. 아래 항목은 "나중에 처리"가 불가능하거나, 나중에 고치면 전면 수정이 되는 것들이다.

**이명동음(enharmonic) — 최대 리스크.** MIDI는 음이름을 전달하지 않으므로 `Ger65`와 `Ab7`은 건반 위에서 구별 불가능하다(둘 다 midi `[68,72,75,78]`). 감7화음 4종, 증3화음 3종도 마찬가지. 문서 3절의 권장 방침은 **A(음고류 기준 채점 + 정답 스펠링 화면 표시) + C(같은 세션에 충돌쌍을 함께 출제하지 않음)**, B(표기 확인 2단계)는 증6화음 집중연습 같은 특정 모드에서만. 이 방침이 데이터 모델과 채점기 양쪽을 규정하므로 먼저 확정할 것.

**채점 엄격도는 단일 함수가 아니라 모드로 분리한다.** 음고류 일치 / 최저음 지정 / 보이싱 완전 일치 / 절대 음역 — 4종(문서 5절). 텐션 화음의 생략음은 `Question.requiredPcs` / `optionalPcs`로 처리하므로 **판정기가 화음 종류를 알 필요가 없다** — 화음 정의를 데이터로 넣기만 하면 된다.

> 문서 5절 표만으로는 "보이싱 완전 일치"와 "절대 음역"의 차이가 모호하다. **`ExactVoicingGrader`는 전체가 옥타브 단위로 통째 이동한 것을 허용하고, `AbsolutePitchGrader`는 MIDI 번호까지 고정**으로 갈랐다. 사용자와 합의된 해석이 아니라 코드가 내린 판단이니 화성법 문제를 실제로 만들 때 다시 확인할 것.

**난이도는 슬라이더 하나가 아니다.** 음역·조성·재생 횟수·재생 방식·화음 풀·전위·제한시간·채점 엄격도 8개 축의 조합이며, "초급/중급/고급"은 그 축 값들의 프리셋 이름일 뿐이다(문서 6절). **조성 축은 지금 `allowedPitchClasses`(허용 음고류 집합)라는 임시 형태**다. 조(key)에서 유도하도록 바꿔야 한다.

**태그를 처음부터 넉넉히 붙인다.** 집중연습 기능은 "태그 필터링된 문제 큐"로 거의 공짜로 구현되지만, 나중에 태그를 추가하려면 기존 문제 생성기를 전부 다시 손대야 한다. `SingleNoteGenerator`가 6종을 붙이고 `SessionConfig.tagFilter`가 거른다. **새 생성기를 쓸 때 태그 붙이기를 빠뜨리지 말 것.**

## 구현 시 반드시 지킬 것

- **문제 전환 시 ~200ms 락아웃을 둘 것.** 빠뜨리면 이전 문제의 잔여 입력이 다음 문제 입력으로 오인되어 "문제가 저절로 틀린 채 넘어가는" 버그가 난다. 게이트는 **`Session.phase`(`Listening`일 때만 수용) 한 곳뿐**이다. **이 게이트를 우회해 `Session`의 내부나 UI를 직접 부르는 경로를 새로 만들지 말 것.**
- **화음 확정은 마지막 note-on 이후 T ms 무입력 기준.** `SessionConfig.chordHoldMs` — 기본 0(1음, 즉시 확정), 화음 70ms, 아르페지오 500~800ms. 타이머는 `Session`이 아니라 `useSession`이 갖는다(Session은 React를 몰라야 하므로). `collect()`가 false를 돌려주면 타이머를 (다시) 걸고, 만료 시 `submit()`을 부른다.
- **`AudioBackend`는 교체 가능한 인터페이스로 둔다.** `SineSynth` ↔ `PianoSynth`가 이미 그 축을 쓴다.

## Tauri로 가는 길 (아직 안 감)

Rust/Tauri는 설치하지 않았다. **MIDI는 더 이상 Tauri 사유가 아니다** — Chrome·Edge에서 이미 된다. 실제 사유는 셋이다: 분석도구의 무거운 네이티브 작업, 파일 시스템 접근, 그리고 Safari·Firefox 사용자.

붙이기 전에 정해야 할 것:

- **`tokens.css`의 `light-dark()`.** Tauri의 macOS WebView는 시스템 WKWebView라 사용자 OS 버전에 묶이는데, 구형에서 이 함수는 무효값이 되어 **색 변수 전체가 무너진다.** 지원 OS 하한을 올리든지 `@media (prefers-color-scheme)` 이중 정의로 되돌리든지 **브랜딩 전에** 정할 것.
- **CSP.** WASM 인스턴스화에 `script-src 'wasm-unsafe-eval'`이 필요하다. 기본 CSP를 그대로 두면 verovio 악보가 조용히 안 뜬다.
- **`vite.config.ts`에 `base: "./"`와 모드별 `build.target`**이 필요해진다.
- MIDI 타임스탬프는 **Rust가 찍어서 이벤트에 실어 보낸다.** IPC 도착 시각으로 판정하면 그 지터가 그대로 점수가 된다.

## 진행 순서

**개별 활동에 무엇이 필요한지는 `catalog.ts`의 `requires`에 적혀 있다.** 앱에서 그 활동을 열면 그대로 화면에 나오므로, 로드맵을 여기와 거기 두 곳에 중복해 적지 않는다.

권장 순서는 **싼 것부터**다. 앞의 셋은 기존 부품을 거의 그대로 쓴다.

1. **겹음정** — `theory.intervalBetween()`이 이미 9·10도를 계산한다. 생성기 상한과 음역만 넓히면 된다.
2. **화음 청음** — 입력 그룹핑(70ms)이 이미 동작한다. 생성기 하나 + 분기 한 줄.
3. **반음정 / 겹증·겹감** — theory는 계산까지 끝나 있고, 조표에서 `Pitch`를 유도하는 층과 UI 버튼 2개가 남았다.
4. **3화음 → 7화음 → 조표 다이아토닉 → 텐션 → 모드** — 이 지점에서 **music21에 해당하는 것이 필요한지 다시 판단**한다(로마자 분석이 핵심 기능이 되는 순간). JS 생태계에는 `tonal` 같은 대안이 있다.
5. **EQ·라우드니스·팬 청음** — `AudioBackend` 인터페이스 변경이 선행되어야 한다. 셋을 한꺼번에 설계할 것.
6. **코드 학습** — 트랜스포트 시계라는 새 기반이 필요하다. 가장 나중.

분석 콘솔은 **BPM·박자·조성까지 왔다.** 다음 칸은 순서대로 이렇다.

1. **구조 분석(섹션 경계)** — 변박·전조·변속이 전부 여기에 걸려 있다. 자기유사도 행렬이면 모델 없이도 어느 정도 간다.
2. **코드 인식** — 비트 동기 크로마는 이미 있다(`meter.ts`가 쓰는 것과 같은 것). 크로마 해상도부터 올려야 하고(위 200Hz 주석), 그다음이 템플릿 매칭 → HMM.
3. **스템 분리 · 멜로디 f0** — 학습된 모델이라 브라우저 밖으로 나가야 한다. Tauri를 부르는 진짜 이유가 이것이다.
