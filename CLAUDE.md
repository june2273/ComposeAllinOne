# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 이 저장소의 현재 상태

**Phase 1 프로토타입(1음 청음)까지 구현되어 있다.** 커밋 이력은 아직 없다.

**활동 15개가 카탈로그에 올라 있고 그중 2개가 동작한다** — 단일음 청음(MIDI 입력)과 온음정(악보 + 화면 입력). 나머지는 "준비 중" 화면이 무엇을 할 것이고 무엇이 필요한지를 보여준다. 커밋 이력은 아직 없다.

의존성은 아래 순서로 한 방향으로만 흐른다. 위쪽 모듈은 아래쪽을 import하지 않는다 — 순환이 생기면 배치를 잘못한 것이다.

| 파일 | 역할 | import 하는 것 |
|---|---|---|
| [main.py](main.py) | PySide6 UI(홈·목록·문항형·준비중·결과) + `StageView` + `SessionController` | 전부 |
| [catalog.py](catalog.py) | **활동 목록.** 무엇을 연습·분석할 수 있는지의 단일 출처 | config |
| [session.py](session.py) | `Session` 상태 기계, `NoteCollector`, `Result` — **Qt를 모른다** | config, questions, grading |
| [grading.py](grading.py) | `Grader` 5종 (채점 엄격도 4종 + 음정 폼) | config, questions, theory |
| [questions.py](questions.py) | `Question` + `QuestionGenerator` 전략 + 태그 부착 | config, theory |
| [score.py](score.py) | verovio 악보. MusicXML 생성 + **Qt용 SVG 후처리** | theory |
| [audio.py](audio.py) | `AudioBackend` Protocol, `Synth` 기반 클래스, `SampleSynth`/`SineSynth`/`NullSynth` | config, sfz |
| [config.py](config.py) | `Stage` + `DifficultyAxes`(8축) + `SessionConfig` + 프리셋·스테이지 | 없음 |
| [theory.py](theory.py) | 음이름·음고류 순수 함수, **`Pitch`(표기)와 `Interval`(음정)** | 없음 |
| [midi_input.py](midi_input.py) | `MidiInput` — rtmidi 콜백을 Qt 시그널로 넘기는 경계, 포트 순위 | (Qt만) |
| [sfz.py](sfz.py) | 최소 SFZ 파서 — 이 음원이 쓰는 opcode만 처리 | 없음 |
| [download_assets.py](download_assets.py) | 피아노 음원 내려받기 | — |

아직 없는 것: music21 연동, **화음·텐션 문제 생성기**, SQLite 기록, 테스트 프레임워크.

화음 관련해서 헷갈리기 쉬운 지점: **입력 쪽 화음 그룹핑(문서 4절 70ms 규칙)은 구현되어 있다** — `session.NoteCollector`가 누적하고 `SessionController._confirm` 타이머가 확정한다. `SessionConfig.chord_hold_ms`가 기본 0이라 1음 청음에서는 첫 note-on을 즉시 채점할 뿐이다. 없는 것은 그룹핑이 아니라 **화음을 내는 문제 생성기**(`questions.make_generator`가 `chord_pool`에 대해 `NotImplementedError`)다.

빌드·린트 도구는 도입하지 않았다. 도입할 때 이 파일도 함께 갱신할 것.

## 카탈로그와 활동 종류

[catalog.py](catalog.py)가 **이 앱이 무엇을 하는지의 단일 목록**이다. 새 연습·도구를 추가할 때 가장 먼저 손대는 곳이고, `Activity` 한 줄을 넣으면 홈·목록 화면에 자동으로 나타난다. `status`가 `PLANNED`이면 `PlannedPage`가 그 설명(`features`·`requires`)을 그대로 보여주므로 **카탈로그 항목이 곧 명세다.**

도메인은 셋(청음 / 화성학 / 음악분석도구)이지만, 설계상 중요한 축은 도메인이 아니라 **`Kind`**다.

| Kind | 시간 축 | 결과 | 쓰는 것 | 화면 |
|---|---|---|---|---|
| `QUIZ` | 문제당 카운트다운 | 점수 N/10 | `session.Session` | `QuizPage` |
| `PERFORMANCE` | 곡 전체가 흐르는 타임라인 | 타이밍 정확도(ms) | **미구현** — 트랜스포트 시계 | 미구현 |
| `TOOL` | 없음 | 파일·데이터 | **미구현** — 백그라운드 작업 | 미구현 |

**`Session`·`SessionController`·`QuizPage`는 QUIZ 전용이다.** 코드 학습(리듬 게임)은 문제 큐가 아니라 연속 타임라인이고 판정도 정답/오답이 아니라 빗나간 밀리초다. 분석 콘솔은 애초에 연습 세션이 아니다(점수·제한시간·문제가 없다). **둘을 `Session`에 태우려 하지 말 것** — 카탈로그에서 `READY`로 올리기 전에 전용 컨트롤러와 화면을 먼저 만들어야 한다. `MainWindow.open_activity()`가 지금은 QUIZ가 아니면 `PlannedPage`로 보낸다.

### 문항형 스테이지 추가하기

`config.Stage`가 **문제 생성기·채점기·화면 세 가지를 함께 고른다.** 손댈 곳은 원칙적으로 넷이다.

1. `catalog.py`에 `Activity` 한 줄 (+ `status=READY`, `config=...`)
2. `config.Stage`에 값 + `SessionConfig` 프리셋
3. `questions.py`에 생성기 + `make_generator()`에 분기 한 줄, 채점이 다르면 `grading.py`에 `Grader` + `GradingMode`
4. 화면 입력이 필요하면 `main.py`에 `StageView` 하위 클래스 + `make_stage_view()`에 분기 한 줄

`session.py`는 바뀌지 않아야 한다. **바뀌어야 한다면 추상화가 잘못 잡힌 것이니 그 자리를 고칠 것.**

**입력 경로는 두 개, 게이트는 하나다.** MIDI는 `Session.collect()` → `submit()`, 화면 입력은 `Session.respond()`로 들어오는데 둘 다 `accepting` 게이트를 지나 `_finish()` 하나로 모인다. 새 입력 경로를 만들 때도 반드시 이 게이트를 통과시킬 것(문서 4절 락아웃 규칙이 여기 한 곳에만 있다).

`Result.response`는 스테이지마다 타입이 다르다 — 청음은 MIDI 번호 튜플, 음정은 `IntervalResponse`. 생성기·채점기·화면이 스테이지 단위로 함께 정해지므로 짝이 어긋날 일은 없다.

### 앞으로 반드시 손봐야 하는 것 세 가지

카탈로그를 채우다 보면 지금 구조로 감당이 안 되는 지점이 셋 있다. 미리 적어 둔다.

1. **`AudioBackend`가 음표만 낸다.** EQ·라우드니스·팬 청음은 "이 소리에 처리를 걸어 내라"가 필요한데 `play_notes(midi_notes, duration, mode, velocity)`로는 표현할 수 없다. 버퍼 재생 + 게인·정위·필터 파라미터가 들어가야 하고, `SineSynth`는 지금 모노라 팬 청음의 폴백이 안 된다. **Protocol을 바꾸는 일이니 세 스테이지를 한꺼번에 설계하고 한 번에 고칠 것.**
2. **분석 도구의 무거운 의존성.** BPM·키 검출, 스템 분리, 피치 추출은 전부 큰 라이브러리이고 스템 분리는 수 분이 걸린다. **선택 의존성으로 지연 임포트**해서 없어도 연습 기능이 뜨게 하고, **Qt 메인 스레드에서 돌리지 말 것**(앱이 얼어붙는다). 이 분야는 라이선스가 제각각이고 학습 데이터 출처가 불투명한 모델이 섞여 있으니 citation.md 기록을 특히 성실히 할 것.
3. **기록 저장소가 없다.** 활동이 15개가 되면 "무엇을 얼마나 했는가"가 필요해진다. 문서 로드맵의 Phase 3 SQLite가 여기서 실제로 필요해지고, `session.Result`를 넘겨받는 Repository 인터페이스가 그 자리다.

## 웹 프론트엔드로 옮기는 중 (2026-08-03~)

**UI를 Claude Design에 맡기기로 해서 프론트엔드를 React로 다시 만들고 있다.** Qt 위젯은 브라우저에서 렌더되지 않으므로, 디자인을 넘기려면 웹이어야 한다는 것이 이유다. 최종 형태는 Tauri 데스크톱(네이티브 MIDI 때문에)이다.

- **`web/`** — React + Vite. `core/`에 로직을 1:1로 이식했고(계산 규칙 무변경, 같은 테스트 케이스로 검증), 화면은 `ui/`, **디자인 시스템은 `ds/`**에 있다. 상세는 [web/README.md](web/README.md).
- **`web/src/ds/`가 claude.ai/design에 올릴 대상이다.** 여기 부품은 **도메인을 import하지 않는다** — `Pitch`·`Question`·`SessionConfig`가 아니라 문자열·숫자·불리언만 받는다. 이 규칙이 깨지면 디자인 도구에서 그 부품을 쓸 수 없게 되므로, `ds/`에 `core/`를 import하는 줄이 생기면 잘못 넣은 것이다. `npm run build:ds` → `dist-ds/`.
- **루트의 Python 앱은 그대로 두고 계속 동작시킨다.** 웹판이 기능 파이를 따라잡을 때까지 둘을 나란히 둔다. **양쪽을 동시에 고치지 말 것** — 지금 단계에서 기능을 추가한다면 웹 쪽에만 넣고, Python 쪽은 참조용으로 둔다.
- 아직 웹에 없는 것: **MIDI 입력**(Tauri 붙일 때), **샘플 피아노**(31MiB 로딩 전략 필요), 카탈로그의 나머지 13개.
- Rust/Tauri는 아직 설치하지 않았다. 네이티브 MIDI가 필요해질 때 설치한다.

브라우저에서는 Qt 때문에 필요했던 우회가 전부 사라진다 — verovio 중첩 `<svg>` 평탄화, 오선 `stroke` 주입, 종횡비 유지 위젯, GIL 회피용 미리 렌더. 대신 **새 함정이 하나 있다**: verovio가 악보 SVG 안쪽에 `color="black"`을 박아 넣어서, CSS로 덮지 않으면 어두운 테마에서 악보가 배경에 묻힌다(`web/src/ui/styles/app.css`의 `.staff svg svg`).

## 설계 문서가 사실상의 사양서다

[화성학_청음_앱_기술검토.md](화성학_청음_앱_기술검토.md)가 이 프로젝트의 유일한 사양서다. **코드를 쓰기 전에 반드시 전문을 읽을 것.** 아래는 요약이 아니라, 문서 여러 절에 흩어져 있어 놓치기 쉬운 결정 사항의 색인이다.

만들려는 것: MIDI 키보드로 입력받는 화성학·청음 연습 데스크톱 앱(PySide6).

## 스택

| 역할 | 라이브러리 |
|---|---|
| MIDI 입력 | `mido` + `python-rtmidi` (rtmidi 콜백 = 별도 스레드) |
| 악보 렌더링 | `verovio` (MusicXML→SVG, 약 1.2ms/회) |
| 음악 이론 | `music21` (`RomanNumeral`로 정답 음 생성) |
| GUI | `PySide6` + `QSvgWidget` |
| 오디오 | `sounddevice` + `numpy` (내장 사인 신스 → 추후 SoundFont) |

`mido`·`python-rtmidi`·`sounddevice`·`numpy`·`PySide6`·`soundfile`·`verovio`는 `.venv`에 설치되어 있다. music21은 아직 넣지 않았다 — 라이선스가 아니라 **import에만 2~3초가 걸려** 문제당 10초짜리 앱에 부담이 크기 때문이다. 온음계 음정 계산은 [theory.py](theory.py)에 40줄로 직접 구현했고(`Pitch`·`Interval`), 로마자 분석·화음 스펠링이 필요한 Phase 3에서 다시 판단한다.

음원은 저장소에 없다(31MiB, `.gitignore`). 새 환경에서는 먼저 받아야 한다:

```bash
.venv/bin/python download_assets.py
```

```bash
.venv/bin/python main.py
```

## 외부 소스 기록 규칙

**외부 소스(라이브러리·음원·샘플·데이터·코드 조각)를 새로 도입하면 [citation.md](citation.md)에 빠짐없이 기록한다.** 링크·원저작자·라이선스·이 프로젝트의 어디에 어떻게 썼는지를 상세히 남긴다. 라이선스는 추측하지 말고 패키지 메타데이터나 배포처 원문에서 직접 확인하고, 확인 경로와 날짜도 함께 적는다.

이 파일에는 요약만 둔다. 상세 내용은 citation.md에 적는다.

현재 쓰는 것: mido·python-rtmidi·sounddevice·numpy·soundfile(전부 MIT/BSD), PySide6(LGPLv3), verovio(LGPLv3), 그리고 음원 Upright Piano KW(CC0). 배포 시 카피레프트 검토가 필요한 것은 **PySide6·verovio(LGPLv3)와 soundfile이 동봉한 libsndfile(LGPL-2.1)** 셋이다. 여기에 더해 **verovio가 동봉한 SMuFL 악보 폰트 5종은 라이선스 파일이 휠에 없어 미확인 상태**다 — 우리 SVG 출력에 글리프 외곽선이 그대로 박혀 나가므로 배포 전에 반드시 확인할 것(citation.md 2절).

## 오디오 음원

**Upright Piano KW** (FreePats, Kawai 업라이트 녹음) — **CC0 퍼블릭 도메인**이라 저작자 표시 의무조차 없다. 대안 음원 비교와 미채택 사유는 [citation.md](citation.md) 1절에 정리해 두었으니 교체할 일이 생기면 거기부터 볼 것.

`pyfluidsynth`(문서 1절의 원안) 대신 **SFZ+FLAC을 직접 읽어 numpy로 섞는다.** `soundfile`이 libsndfile을 번들로 들고 오므로 `brew install fluidsynth` 같은 네이티브 의존성이 0이고, 배포 시 dylib을 묶을 필요도 없다. 기존의 "미리 렌더 → `sd.play()`" 구조에 그대로 얹힌다.

- 샘플은 3반음 간격이라 피치 시프트가 최대 ±1반음. 선형 보간으로 충분하다(실측 오차 0.1센트 미만).
- **원본 녹음이 평균 2~6센트 낮다**(A2는 −17센트). 실제 어쿠스틱 업라이트라 정상 범위이고 상대음감·화성 훈련에는 무해하지만, 절대음고를 센트 단위로 다뤄야 하는 기능을 만든다면 `SineSynth`가 오히려 정확하다.
- `sfz.py`는 SFZ 규격의 일부만 구현한다. `loop_start`/`loop_end`/`loop_mode`는 **의도적으로 무시한다** — 샘플이 문제 길이보다 길어서 필요가 없다. 긴 음을 내야 하는 기능이 생기면 그때 루프를 구현할 것.
- 음원이 없거나 깨졌으면 `make_default_backend()`가 `SineSynth`로 자동 폴백한다. 앱은 음원 없이도 뜬다.

## 객체지향 설계 방침

**패턴은 기본적으로 적용하지 않는다. 문서가 요구하는 변화 축이 실제로 있을 때만 넣는다.** 아래 표가 2026-08-02에 내린 판단이고, 새 패턴을 넣고 싶으면 같은 기준으로 따져서 이 표에 줄을 추가할 것 — "좋은 설계니까"는 근거가 아니다.

적용한 것:

| 패턴 / 원칙 | 어디 | 왜 남는 값이 있는가 |
|---|---|---|
| Strategy | `grading.Grader` 4종 | 문서 5절이 채점 엄격도를 **모드로 분리하라**고 못박았다. 판정 조건이 서로 겹치지 않아 분기로 두면 필연적으로 뒤엉킨다 |
| Strategy + Factory | `questions.QuestionGenerator`, `make_generator()` | 문서 8절의 문제 종류가 7가지. 종류마다 생성 규칙이 완전히 다르다 |
| Template Method | `audio.Synth` | 두 신스가 믹싱·스태거·피크 처리를 그대로 복제하고 있었다. 백엔드는 앞으로도 늘어난다(SoundFont) |
| SRP 분리 | `session.Session`을 Qt에서 떼어냄 | 세션 규칙을 Qt 없이 테스트할 수 있다. verovio 위젯이 붙어도 세션 로직은 안 바뀐다 |
| DIP | `SessionController(config, audio, midi)`, `Session(config, generator, grader)` | 테스트가 `NullSynth`·가짜 설정을 넣는다. 모듈 전역을 런타임에 덮어쓰던 것을 없앴다 |
| 파라미터 객체 | `SessionConfig` / `DifficultyAxes` | 문서 6절 8축. 프리셋은 축 값 묶음일 뿐이라 프리셋을 늘려도 코드는 안 바뀐다 |

**검토했으나 적용하지 않은 것** (다시 꺼내기 전에 읽을 것):

| 후보 | 안 넣은 이유 | 다시 볼 조건 |
|---|---|---|
| State 패턴 (`Phase`) | 상태 5개가 한 방향으로만 흐른다. 클래스 5개 + 컨텍스트가 Enum 하나가 하는 일을 대신할 뿐 | 일시정지·복습처럼 전이가 갈라지면 |
| Observer 자작 | Qt 시그널이 이미 Observer다. 한 겹 더 얹으면 스레드 경계 규칙이 두 곳으로 흩어진다 | Qt를 걷어낼 때 |
| Abstract Factory (화면) | 화면이 3개, 변형 축이 없다 | 스킨·다국어 레이아웃이 생기면 |
| Command (실행 취소) | 되돌릴 동작이 없다 | 오답노트에서 판정 정정 기능이 생기면 |
| Singleton (오디오) | 전역 상태가 되어 테스트에서 갈아끼우기 어려워진다. 주입으로 충분 | 없음 |
| Repository (기록) | 저장소가 아직 없다 | Phase 3 SQLite. 그때 `session.Result`를 넘겨받는 인터페이스로 |

### 실측 (2026-08-02)

**런타임**: 파형 20종이 리팩터링 전후 **비트 단위로 동일**(최대오차 0.0), 렌더 시간 변화 ±2% 이내(측정 노이즈). 런타임 효율은 오르지도 내리지도 않았다 — 패턴이 사는 값은 전부 변경 비용 쪽이다.

**변경 비용**: 같은 기능(3화음 청음: 문제 생성 + 70ms 그룹핑 + 음고류 채점 + 결과 표시)을 옛 구조와 새 구조에 **각각 실제로 구현해서** 비교했다. 둘 다 offscreen 테스트로 10/10 동작을 확인한 뒤 잰 값이다.

| | 옛 구조 | 새 구조 |
|---|---|---|
| **수정된 기존 단위** | **10개** (`EarTrainer` + 그 메서드 8개 + `Result`) | **1개** (`make_generator`의 분기 한 줄) |
| 새로 추가된 단위 | 4개 | 3개 (전부 `TriadGenerator` 안) |
| 기존 줄 삭제·변경 | −19줄 | −4줄 |
| 추가 줄 | +63줄 | +43줄 |
| 손댄 파일 | main.py | questions.py (나머지 8개 파일 무변경) |

핵심은 총량(63 → 43줄)이 아니라 **이미 동작하던 코드를 건드린 양**이다. 옛 구조에서는 락아웃·채점·결과 표시가 모두 `EarTrainer` 안에 있어 화음을 넣으려면 그 전부를 다시 손대야 했다 — 회귀가 날 표면이 그만큼 넓다.

**구조 지표**:

| 지표 | 이전 | 이후 |
|---|---|---|
| 최대 클래스 | `EarTrainer` 309줄 / 메서드 17 / `self` 속성 37 | `Session` 140줄 / 16 / 14 |
| 최대 클래스 순환복잡도 | 39 | 31 |
| 함수당 평균 순환복잡도 | 2.69 | 2.16 |
| **Qt 없이 검증 가능한 로직** | 67/132 = **51%** | 159/242 = **66%** |
| 신스 추가 시 복제할 믹싱 코드 | 약 18줄 (두 `play_notes`가 82% 동일) | 0줄 |

**대가**: 코드는 798줄 → 1594줄. 절반가량은 구조가 아니라 이번에 실제로 배선된 기능(채점 4모드·난이도 8축·프리셋·태그 필터·화음 확정 타이머)이지만, 파일이 4개에서 9개로 늘어 처음 읽는 사람이 훑어야 할 범위는 넓어졌다. `main.py`의 Qt 쪽 복잡도는 45 → 63으로 **올랐다**(화면 3분할 보일러플레이트 + 시그널 배선). 순수한 손해이고, 화면이 더 늘지 않으면 회수되지 않는다.

## 설정과 검증

세션 설정은 전부 [config.py](config.py)의 `SessionConfig`에 있다. **`main.py`에 설정 상수를 다시 만들지 말 것.** 프리셋은 `config.PRESETS`("초급/중급/고급"). **활동 목록은 config가 아니라 [catalog.py](catalog.py)에 있다** — 목록을 config에 두면 config가 화면 구성까지 알게 된다.

검증은 두 층으로 한다.

- **세션 규칙**: Qt를 띄우지 않는다. `Session`을 직접 만들어 `next_question()` → `begin_listening()` → `collect()`/`respond()` → `submit()`을 부르면 세션 전체가 돈다. 시간은 `submit(seconds)`로 넘기므로 실제로 기다릴 필요가 없다.
- **UI 결선**: `QT_QPA_PLATFORM=offscreen` + `MainWindow(NullSynth())` → `win.open_activity(activity)`. 타이밍은 활동을 통째로 바꿔 줄인다: `dataclasses.replace(act, config=replace(act.config, input_lockout_ms=20, feedback_ms=20))`. `audio.NullSynth`가 오디오 장치를 피한다. `open_activity()`가 화면 전환까지 하므로 **키보드 경로**(자판 폴백, 음정 스테이지의 숫자·성질 키)가 바로 산다.
- **악보**: 눈으로는 3도와 6도를 구별하기 어렵다. SVG의 음표 y좌표 차이가 `(도수-1) × 한 계단`인지로 검증할 것 — verovio 좌표계에서 한 계단은 90단위다.

## 개발 환경 실측 (2026-08-02, macOS)

- MIDI 컨트롤러: **Arturia KeyLab Essential 61 mk3**. 포트를 4개 내보내며 건반 노트는 `KL Essential 61 mk3 MIDI`에서만 나온다. `MCU/HUI` 포트는 트랜스포트 버튼을 노트 메시지로 보내므로 붙이면 오답이 유발된다 — `midi_input.rank_port()`가 이 정렬을 처리한다(포트 이름 해석은 MIDI의 관심사라 UI가 아니라 거기 둔다).
- CoreMIDI 권한 문제 없이 포트가 열린다. 다만 **장치를 나중에 연결하면 `mido.get_input_names()`가 즉시 반영되지 않을 수 있다** — 실제로 첫 조회에서 0개, 이후 4개가 잡힌 적이 있다. 그래서 설정 화면에 재검색 버튼이 있다.
- `sounddevice` 기본 출력으로 재생 정상.

## 설계상 되돌리기 어려운 결정들

이 프로젝트의 난점은 코드량이 아니라 음악적 판정 규칙이다. 아래 항목은 "나중에 처리"가 불가능하거나, 나중에 고치면 전면 수정이 되는 것들이다.

**이명동음(enharmonic) — 최대 리스크.** MIDI는 음이름을 전달하지 않으므로 `Ger65`와 `Ab7`은 건반 위에서 구별 불가능하다(둘 다 midi `[68,72,75,78]`). 감7화음 4종, 증3화음 3종도 마찬가지. 문서 3절의 권장 방침은 **A(음고류 기준 채점 + 정답 스펠링 화면 표시) + C(같은 세션에 충돌쌍을 함께 출제하지 않음)**, B(표기 확인 2단계)는 증6화음 집중연습 같은 특정 모드에서만. 이 방침이 데이터 모델과 채점기 양쪽을 규정하므로 먼저 확정할 것.

**채점 엄격도는 단일 함수가 아니라 모드로 분리한다.** 음고류 일치 / 최저음 지정 / 보이싱 완전 일치 / 절대 음역 — 4종(문서 5절). → [grading.py](grading.py)에 구현됨. 텐션 화음의 생략음은 `Question.required_pcs` / `optional_pcs`로 처리하므로 **판정기가 화음 종류를 알 필요가 없다** — 화음 정의를 데이터로 넣기만 하면 된다.

> 문서 5절 표만으로는 "보이싱 완전 일치"와 "절대 음역"의 차이가 모호하다. **`ExactVoicingGrader`는 전체가 옥타브 단위로 통째 이동한 것을 허용하고, `AbsolutePitchGrader`는 MIDI 번호까지 고정**으로 갈랐다. 사용자와 합의된 해석이 아니라 코드가 내린 판단이니 화성법 문제를 실제로 만들 때 다시 확인할 것.

**난이도는 슬라이더 하나가 아니다.** 음역·조성·재생 횟수·재생 방식·화음 풀·전위·제한시간·채점 엄격도 8개 축의 조합이며, "초급/중급/고급"은 그 축 값들의 프리셋 이름일 뿐이다(문서 6절). → `config.DifficultyAxes`. **조성 축은 지금 `allowed_pitch_classes`(허용 음고류 집합)라는 임시 형태**다. music21이 들어오면 조(key)에서 유도하도록 바꿔야 한다.

**태그를 처음부터 넉넉히 붙인다.** 집중연습 기능은 "태그 필터링된 문제 큐"로 거의 공짜로 구현되지만, 나중에 태그를 추가하려면 기존 문제 생성기를 전부 다시 손대야 한다. → `SingleNoteGenerator._tags()`가 6종을 붙이고 `SessionConfig.tag_filter`가 거른다. **새 생성기를 쓸 때 태그 붙이기를 빠뜨리지 말 것.**

## 구현 시 반드시 지킬 것

- **MIDI 콜백에서 Qt UI를 직접 건드리지 말 것.** rtmidi 콜백은 별도 스레드다. `QObject` 시그널로 메인 스레드에 넘긴다. 어기면 간헐적 크래시가 나고 원인 추적이 매우 어렵다.
- **문제 전환 시 입력 버퍼를 비우고 ~200ms 락아웃을 둘 것.** 빠뜨리면 이전 문제의 잔여 note-off가 다음 문제 입력으로 오인되어 "문제가 저절로 틀린 채 넘어가는" 버그가 난다. 게이트는 **`Session.phase`(`Phase.LISTENING`일 때만 수용) 한 곳뿐**이고, 입력은 반드시 `Session.collect()`를 거친다(mido 콜백 방식이라 별도 큐가 없어 비울 버퍼 자체는 없다). **이 게이트를 우회해 `Session._finish()`나 UI를 직접 부르는 경로를 새로 만들지 말 것.**
- **화음 확정은 마지막 note-on 이후 T ms 무입력 기준.** `SessionConfig.chord_hold_ms` — 기본 0(1음, 즉시 확정), 화음 70ms, 아르페지오 모드 500~800ms. 타이머는 `session`이 아니라 `SessionController`가 갖는다(Session은 Qt를 몰라야 하므로). `collect()`가 False를 돌려주면 타이머를 (다시) 걸고, 만료 시 `submit()`을 부른다.
- **오디오 콜백 안에서 무거운 연산 금지(GIL 글리치).** 재생 버튼 시점에 전체 파형을 numpy로 미리 렌더한 뒤 `sd.play()`로 던진다. 콜백 스트림은 에코백 기능에만 필요하다.
- `AudioBackend`는 교체 가능한 Protocol로 두고 시작한다(문서 7절에 시그니처 있음). `SineSynth` → 추후 `SoundFontSynth`.

## 악보 렌더링 — Phase 0 미검증 항목의 결론 (2026-08-02)

**Qt + verovio는 후처리 두 단계를 거치면 된다.** `QWebEngineView`도 `cairosvg`도 필요 없다. 우려대로 그냥 넣으면 깨지지만, 원인이 둘 다 국소적이었다. [score.py](score.py)의 `qt_safe_svg()`가 처리한다.

1. **중첩 `<svg>`** — verovio는 바깥 `<svg>` 안에 배율용 `<svg class="definition-scale">`을 하나 더 넣는다. SVG 1.2 Tiny는 중첩을 금지해서 Qt가 안쪽을 통째로 건너뛴다(`qt.svg: Skipping a nested svg element`) → **화면이 완전히 빈다.** 안쪽을 `<g transform="scale(...)">`로 바꾼다.
2. **색 없는 오선** — 오선·덧줄·마디선은 `<path stroke-width="13">`처럼 굵기만 있고 색은 `<style>` 안 CSS(`path {stroke:currentColor}`)에서 온다. Qt Tiny는 그 CSS를 적용하지 못한다 → **음표만 공중에 뜬 그림**이 나온다. 색 없는 path에 `stroke`를 직접 박는다. (실제로 이 단계를 빠뜨려서 한 번 겪었다.)

추가로 `<part-name>`을 비워 둔다. 내용이 있으면 verovio가 성부 이름을 `<tspan>` 중첩으로 찍는데 Qt가 거부하며 렌더마다 경고를 뱉는다.

**`QSvgWidget`을 쓰지 말 것.** SVG를 위젯 크기에 그대로 늘여서 오선이 세로로 눌리고, `QSvgRenderer.setAspectRatioMode()`를 걸어도 `QSvgWidget`이 돌려주는 렌더러에는 반영되지 않는다(실측). `main.StaffView`가 직접 그린다.

실측: 렌더 약 1.9ms/회(후처리 0.03ms 포함). 음표 세로 위치가 도수와 일치하는지는 SVG 좌표로 검증했다(한 계단 = 90단위, 2~8도 전수).

## 진행 순서

Phase 0은 전부 끝났다(MIDI·오디오·악보 렌더링). Phase 1(1음 청음 MVP) 완료.

**개별 활동에 무엇이 필요한지는 [catalog.py](catalog.py)의 `requires`에 적혀 있다.** 앱에서 그 활동을 열면 그대로 화면에 나오므로, 로드맵을 여기와 거기 두 곳에 중복해 적지 않는다.

권장 순서는 **싼 것부터**다. 앞의 셋은 기존 부품을 거의 그대로 쓴다.

1. **겹음정** — `theory.interval_between()`이 이미 9·10도를 계산한다. 생성기 상한과 음역만 넓히면 된다.
2. **화음 청음** — 입력 그룹핑(70ms)이 이미 동작한다. 생성기 하나 + 분기 한 줄.
3. **반음정 / 겹증·겹감** — theory는 계산까지 끝나 있고, 조표에서 `Pitch`를 유도하는 층과 UI 버튼 2개가 남았다.
4. **3화음 → 7화음 → 조표 다이아토닉 → 텐션 → 모드** — 이 지점에서 **music21 도입을 다시 판단**한다(로마자 분석이 핵심 기능이 되는 순간).
5. **EQ·라우드니스·팬 청음** — `AudioBackend` Protocol 변경이 선행되어야 한다. 셋을 한꺼번에 설계할 것.
6. **코드 학습 / 분석 콘솔** — 각각 트랜스포트 시계와 백그라운드 작업이라는 새 기반이 필요하다. 가장 나중.
