# ComposeAllinOne 웹 (React + Vite)

분석 콘솔과 PDF 악보 뷰어다. 화성학·청음 연습은 2026-10-22에
[Chord-Tutor](https://github.com/june2273/Chord-Tutor)로 갈라 나갔다(분리 직전
상태는 태그 `pre-split`).

`scripts/`의 Python 셋은 **빌드 타임에 피아노 자산을 굽는 도구**다 — 앱이
실행 중에 Python을 부르는 곳은 없다. `scripts/eval/`과 `scripts/eval_*.py`는
평가 하니스다(앱에 안 들어간다).

```bash
npm install
npm run dev      # http://localhost:5173 — server/.venv가 있으면 사이드카도 함께 띄운다
npm test         # 431개
npm run build
```

## 구조

```
src/
  core/        React도 브라우저 API도 모르는 순수 로직
    analysis/      박자·조성·코드·구간 — 의존성 없는 DSP (FFT까지 직접)
    transcribe/    f0 커브 → 음표 → MIDI·MusicXML·.svp. 모델을 부르지 않는다
    drums/         드럼 스템 → 타점 → 루프·필인 → 타악보·채널10 MIDI
    score.ts       verovio 악보 (SVG·타임맵·인쇄용 쪽)
    audio.ts       AudioBackend 인터페이스
    theory.ts · config.ts · harmony/   음 이름과 PlayMode 등 오디오·악보가 쓰는 것
  platform/    브라우저가 어떻게 하는가. 음악적 판단 없음
    analyze.ts · analysis.worker.ts   오디오 디코딩 + 분석 워커
    sidecar.ts     로컬 분석 서버와 HTTP (감지·업로드·폴링·취소)
    piano.ts · synth.ts               샘플 피아노 (없으면 사인으로 폴백)
    clip.ts        구간 반복 재생
    print.ts       숨긴 iframe → 브라우저 인쇄 → PDF
    midi.ts · theme.ts
  ds/          디자인 시스템 — 도메인을 모르는 표시 부품
  ui/
    analysis.tsx       분석 콘솔
    transcription.tsx  AI 칸 (스템·멜로디·악보·내려받기)
    scoreplayer.tsx    전사 악보 재생·커서·인쇄
    chords.tsx · structure.tsx · drums.tsx
    pdfscore.tsx       PDF 악보 뷰어
    settings.tsx       설정 창 (테마·MIDI 장치)
    styles/tokens.css  ← 브랜딩이 바뀔 때 손대는 유일한 파일
```

의존성은 한 방향으로만 흐른다: `ui/` → `platform/` → `core/` → (없음).
`core/analysis`와 `core/transcribe`는 서로를 import하지 않는다 — 잇는 것은 위층의 일이다.

## 분석 사이드카

스템 분리(htdemucs)·멜로디 f0(RMVPE)·비트(Beat This!)는 학습된 모델이라 브라우저
안에서 끝나지 않는다. `../server/`의 로컬 파이썬 서버가 맡는다. **파이썬 3.11이어야
한다**(torch 계열이 새 파이썬을 늦게 따라온다).

```bash
cd ../server
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt   # torch 때문에 수 GB
```

**2026-09-12부터 BPM·박자가 사이드카에서 나온다** — 그래서 분석 콘솔은 사이드카가
켜져 있어야 제대로 돈다. 개발 중에는 `npm run dev`가 함께 띄우고(`vite-sidecar.ts`,
끄려면 `SIDECAR_AUTOSTART=0`), 빌드된 앱은 사이드카가 직접 서빙한다.

서버는 기동 직후 모델을 한 번씩 굴려 보고(`app/health.py`), **안 깔린 것과
깔렸는데 안 도는 것을 갈라서** 화면에 알려준다.

서버가 하는 것은 신호 처리뿐이다(스템 WAV + f0 커브 + 비트). 음표로 자르고 격자에
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

## 분석 콘솔

오디오 파일을 열면 **BPM · 박자 · 조성**과 구간이 나오고, 사이드카가 스템 분리 ·
멜로디 전사(악보 · MIDI · Synthesizer V `.svp`) · 드럼 루프와 필인을 붙인다.
파일은 로컬 서버까지만 간다(바깥으로는 나가지 않는다).

**코드 인식은 돌지만 화면에서 닫아 두었다** — 코드 정답을 찍어 둔 곡이 없어
정확도를 말할 수 없다. 스위치는 `ui/chords.tsx`의 `CHORDS_VISIBLE` 하나다.

알고리즘 출처는 [../citation.md](../citation.md) 3-1절 — 논문을 읽고 새로
구현했지 코드를 옮기지 않았다.

## 디자인 시스템 (`src/ds/`)

**claude.ai/design에 넘기는 것은 이 폴더다.** 여기 있는 컴포넌트는 도메인을
모른다 — `Pitch`·`Question`·`SessionConfig` 같은 것을 받지 않고 문자열·숫자·
불리언만 받는다. 그래야 디자인 도구가 화성학을 몰라도 화면을 조립할 수 있다.

```bash
npm run build:ds   # dist-ds/{index.js, index.d.ts, index.css}
```

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

- **코드·드럼·구간의 정확도** — 정답을 찍어 둔 곡이 없다. 지금 테스트가 보증하는
  것은 "알고리즘이 의도대로 도는가"까지다.
- **변박·전조·변속** — 구간은 생겼고, 구간마다 다시 재는 일이 남았다.
- 셋잇단·스윙 표기, 성부 분리. 전사 악보는 손봐야 하는 초안이다.
