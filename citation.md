# 외부 소스 출처 기록

이 프로젝트가 사용하는 모든 외부 저작물의 출처·저작자·라이선스와, 그것이
코드 어디에 어떻게 쓰였는지를 남긴다. **외부 소스를 새로 도입하면 반드시 여기에
먼저 추가한다.** [CLAUDE.md](CLAUDE.md)에는 요약만 두고 상세 내용은 이 파일에 적는다.

라이선스 정보는 추측하지 않고 설치된 패키지 메타데이터와 배포처 원문에서 직접
확인한 값이다. 확인 방법과 날짜는 각 항목의 "확인" 줄에 적었다.

최종 갱신: 2026-09-12 (템포·박자를 자기상관 → Beat This!로 교체)

---

## 1. 오디오 음원

### Upright Piano KW

| 항목 | 내용 |
|---|---|
| 종류 | 피아노 샘플 세트 (SFZ + FLAC, 66개 샘플) |
| 버전 | 2022-02-21 |
| 라이선스 | **Creative Commons CC0 1.0 Universal** (퍼블릭 도메인 헌정) |
| 배포처 | https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW |
| 소스 저장소 | https://github.com/freepats/upright-piano-KW |
| 라이선스 원문 | https://creativecommons.org/publicdomain/zero/1.0/ |

**원저작자**

- **녹음**: Gonzalo (humanogonzalo@gmail.com), Roberto (roberto@zenvoid.org) — 2017년 1월
- **편집·가공**: Roberto (자유 소프트웨어 사용)
- **배포**: FreePats 프로젝트
- **감사 표기**: Inma Martínez de Miguel — 자택의 Kawai 업라이트 피아노 녹음을 허락

**녹음 정보**: 거실에 놓인 Kawai 업라이트 피아노를 Zoom H1 휴대용 레코더로 녹음.
삼각대를 피아노 정면, 연주자의 머리 높이쯤에 세워 수음. 44100Hz / 24bit / 스테레오,
벨로시티 2레이어, 3반음 간격 샘플링.

**활용처**

- `web/scripts/download_assets.py` — GitHub `main` 브랜치 tarball에서 SFZ·FLAC·LICENSE를
  `assets/UprightPianoKW/`로 내려받는다. 용량이 31MiB라 저장소에 커밋하지 않고
  `.gitignore`로 제외했다.
- `web/scripts/sfz.py` — 이 음원의 `.sfz` 매핑 파일을 읽어 건반·벨로시티별 샘플을 찾는다.
- `web/scripts/prepare_web_piano.py` — **웹용 파생물을 굽는다.** 원본
  FLAC(24bit 스테레오 약 7초, 합계 31MiB)을 모노 3초 AAC 64kbps로 변환해
  `web/public/piano/`에 넣는다(66개, 합계 **1.3MiB**). SFZ 해석은 SFZ 해석은 옆의 `sfz.py`가 맡는다.
  결과물은 저장소에 커밋하지 않는다(`web/.gitignore`).
- `web/src/platform/piano.ts` — 위에서 구운
  `manifest.json`을 읽어 브라우저에서 재생한다. **런타임 SFZ 파서는 없다.**
  피치 시프트는 `AudioBufferSourceNode.playbackRate`가 처리한다(원본이 3반음
  간격이라 최대 ±1반음).

**파생물의 라이선스**: 원본이 CC0이므로 변환본에도 아무 의무가 없다. AAC로
인코딩했다고 해서 코덱 쪽 권리가 오디오 콘텐츠에 붙지는 않는다.

**의무 사항**: CC0이므로 **없다.** 저작자 표시 없이 수정·배포·상업적 이용이 모두
가능하다. 위 표기는 의무가 아니라 예의로 남긴 것이다.

**실측 특성 (2026-08-03, 66개 샘플 전수 측정)**: 조율이 평균율에서 벗어나 있는데
**대부분 Railsback 곡선**이다 — 저음 −94~−25센트, 중음 ±13센트, 고음 +14~+35센트.
현의 강성 때문에 실제 피아노는 저음을 일부러 낮게, 고음을 높게 조율하므로 이는
녹음 결함이 아니라 정상이다. 앱이 실제로 쓰는 C3~C6 구간은 중앙값 −2.9센트.

웹판은 음정 훈련용이라 평균율로 당긴다(`prepare_web_piano.py`가 센트 값을 재어
매니페스트에 넣고, 재생 시 `playbackRate`로 되민다). **오디오 파일 자체는 변형하지
않는다** — `web/public/piano/*.m4a`는 포맷만 바꾼 녹음 그대로이고, 보정은 재생
시점에만 걸린다. 절대음고를 센트 단위로 다루는 기능에는 여전히 `SineSynth`가
더 정확하다.

**검토했으나 채택하지 않은 대안** (2026-08-02 조사)

| 음원 | 라이선스 | 미채택 사유 |
|---|---|---|
| [YDP Grand Piano](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html) | CC-BY 3.0 | 그랜드 음색이나 저작자 표시 의무가 붙는다 |
| [Salamander Grand Piano](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html) | CC-BY 3.0 | Yamaha C5·16레이어로 품질 최상이지만 SF2가 296MiB. 표시 의무 |
| [MuseScore_General](https://musescore.org/en/handbook/2/soundfonts-and-sfz-files) | MIT | GM 128음색 세트. 라이선스 문구 동봉 의무 |
| [GeneralUser GS](https://www.schristiancollins.com/generaluser.php) | 독자 라이선스 | **비권장.** 제작자 S. Christian Collins가 일부 샘플의 출처를 100% 확신할 수 없다고 명시 |

> 조사 중 확인한 오류: "Salamander가 2022년 4월부터 퍼블릭 도메인이 되었다"는
> 검색 요약이 있으나, FreePats 배포 페이지 원문은 **CC-BY 3.0**으로 표기하고 있다.
> 표시 의무가 살아 있으므로 그대로 인용하지 말 것.

---

## 2. 파이썬 — 자산 파이프라인 전용

**2026-08-03에 PySide6 앱을 삭제했다.** 그와 함께 `mido`·`python-rtmidi`·
`sounddevice`·`PySide6`·`verovio`(파이썬 휠)가 **이 프로젝트의 의존성에서 빠졌다.**
그 기록은 커밋 `10abd90`과 이 파일의 이전 판에 남아 있다.

남은 Python은 `web/scripts/` 셋(`sfz.py`·`download_assets.py`·
`prepare_web_piano.py`)뿐이고, **빌드 타임에 피아노 자산을 굽는 도구다.**
앱이 실행 중에 Python을 부르는 곳은 없고, 배포물에도 들어가지 않는다.

| 패키지 | 버전 | 라이선스 | 저작자 | 활용처 |
|---|---|---|---|---|
| [numpy](https://numpy.org/) | 2.4.6 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | Travis E. Oliphant 외 | `prepare_web_piano.py` — 모노 믹스, 페이드, 조율 측정용 FFT |
| [soundfile](https://github.com/bastibe/python-soundfile) | 0.14.0 | BSD-3-Clause | Bastian Bechtold | `prepare_web_piano.py` — 원본 FLAC 디코딩, 중간 WAV 쓰기 |
| [mido](https://github.com/mido/mido) | 1.3.3 | MIT | Ole Martin Bjørndalen | `eval_transcribe.py` — 정답 MIDI와 우리 MIDI를 읽어 대조 |

라이선스는 설치된 배포판의 `importlib.metadata`에서 직접 읽었다. 확인일 2026-08-02
(mido는 2026-08-10 — `Classifier: License :: OSI Approved :: MIT License`와
`dist-info/LICENSE` 원문을 함께 확인했다).

> **mido는 한 번 빠졌다가 돌아왔다.** PySide6 앱에서 MIDI 입력용으로 쓰다가
> 2026-08-03에 함께 지웠는데, 2026-08-10에 **평가 하니스**가 다시 들여왔다.
> 용도가 다르다 — 실시간 입력이 아니라 파일 대조이고, `python-rtmidi`
> (백엔드) 없이 순수 파서로만 쓴다. 앱 배포물에는 여전히 들어가지 않는다.

> `soundfile`이 동봉한 **libsndfile(LGPL-2.1)**도 함께 빠졌다 — 빌드 타임에만
> 쓰이고 배포물에 들어가지 않으므로 카피레프트 검토 대상이 아니다. 아래 4절의
> 기록은 참고용으로 남긴다.

**verovio가 동봉한 악보 폰트 — 배포 전 확인 필요** (npm `verovio`에도 그대로 해당)

verovio는 SMuFL 악보 폰트 5종(`Bravura`, `Gootville`, `Leipzig`, `Leland`,
`Petaluma`)을 함께 담고 있다. 기본값은 **Leipzig**이고, 이 프로젝트는 기본값을
그대로 쓴다. (npm 패키지 쪽도 같은 폰트를 담는다.)

이게 중요한 이유: **verovio의 SVG 출력에는 폰트 글리프의 외곽선이 `<path>`
데이터로 그대로 박혀 나간다.** 즉 악보를 그릴 때마다 우리 출력물이 그 폰트의
글자 모양을 포함하게 된다. 앱을 배포하면 폰트도 함께 배포되는 셈이다.

**이 5종의 라이선스 파일은 휠 안에 들어 있지 않다**(`dist-info/licenses/`에는
verovio 본체의 GPL/LGPL 원문만 있다). 추측하지 않고 비워 둔다. 배포를 결정하면
verovio 저장소의 `fonts/` 디렉터리에서 각 폰트의 라이선스를 직접 확인할 것:
https://github.com/rism-digital/verovio/tree/develop/fonts

## 2-1. 웹 프론트엔드 (`web/`)

앱 코드가 실제로 쓰는 의존성은 전부 여기다. 라이선스는 각 패키지의
`package.json` `license` 필드에서 직접 읽었다. 확인일: 2026-08-03.

| 패키지 | 버전 | 라이선스 | 저작자 | 활용처 |
|---|---|---|---|---|
| [React](https://react.dev) | 19.2 | MIT | Meta 및 기여자 | `web/src/ui/` — 전체 UI |
| [Vite](https://vite.dev) | 8.2 | MIT | Evan You 및 기여자 | 개발 서버·번들러 |
| [TypeScript](https://www.typescriptlang.org) | 6.0 | Apache-2.0 | Microsoft | 전체 |
| [verovio](https://www.verovio.org) (npm) | 6.2 | **LGPL-3.0** | RISM Digital Switzerland | `web/src/core/score.ts` — 악보 SVG · 재생 타임맵 · 인쇄용 쪽 |
| [Vitest](https://vitest.dev) | 4.1 | MIT | Vitest 팀 | 테스트 |
| [Testing Library](https://testing-library.com) | — | MIT | Kent C. Dodds 및 기여자 | UI 테스트 |
| [oxlint](https://oxc.rs) | 1.x | MIT | Boshen 및 기여자 | 린트 (Vite 템플릿 기본) |

**verovio npm판은 Python판과 같은 프로젝트·같은 라이선스(LGPL-3.0)이고, 동봉한
SMuFL 악보 폰트 5종의 라이선스가 미확인인 것도 동일하다.** 위 verovio 항목의
주의사항이 그대로 적용된다.

**2026-08-28에 verovio에서 쓰는 API가 늘었다** — `renderToTimemap()`(재생 커서용
음표 id ↔ 시각 표)과 `getPageCount()` + 쪽별 `renderToSVG(n)`(인쇄용 A4 여러 쪽).
**새 의존성도 새 라이선스도 없다** — 이미 번들에 들어 있는 같은 툴킷의 다른
메서드일 뿐이다. `renderToPDF`는 verovio의 C++ CLI에만 있고 WASM 툴킷에는 없어서
(패키지 전체 grep으로 확인), PDF 만들기는 라이브러리 없이 **브라우저 인쇄**로
간다(`web/src/platform/print.ts`).

> **그런데 폰트 미확인 건이 이것으로 한 칸 무거워졌다.** 지금까지 글리프
> 외곽선은 화면 SVG에만 실려 나갔는데, 이제 **사용자가 저장하는 PDF 파일에
> 그대로 들어간다.** 인쇄는 사용자 로컬에서 일어나므로 우리가 그 파일을
> 배포하는 것은 아니지만, 앱을 배포하면 "그 폰트 모양을 담은 PDF를 만들어 주는
> 도구"를 배포하는 셈이 된다. 배포 전 확인 항목은 그대로이고 **범위만 넓어졌다.**

### 빌드 타임 도구 (배포물에 포함되지 않음)

#### FFmpeg

| 항목 | 내용 |
|---|---|
| 버전 | 8.1.1 (Homebrew, arm64 macOS) |
| 라이선스 | **GPL-3.0-or-later** — `--enable-gpl --enable-version3`로 빌드된 배포판 |
| 배포처 | https://ffmpeg.org / `brew install ffmpeg` |
| 확인 | `ffmpeg -L`이 GPL v3 본문을 출력, `ffmpeg -version`의 configuration에 `--enable-gpl` `--enable-version3`, `brew info --json ffmpeg`의 `license` 필드가 `GPL-3.0-or-later` (2026-08-03 확인) |

**활용처**: [prepare_web_piano.py](web/scripts/prepare_web_piano.py)가 피아노 샘플을 AAC로
인코딩할 때 서브프로세스로 호출한다.

**왜 카피레프트 문제가 아닌가**: FFmpeg를 **링크하지 않고 별도 프로세스로
실행**하며, 저장소에 동봉하지도 배포하지도 않는다. GPL은 프로그램의 배포에
붙는 조건이므로, 도구를 써서 만든 출력물(CC0 오디오)에는 전파되지 않는다.
음원을 다시 굽지 않는 한 이 도구 없이도 앱이 빌드·실행된다.

> 대안으로 `soundfile`(libsndfile)만으로 인코딩하는 방법도 검토했다. 쓰기 가능
> 포맷이 FLAC/OGG/WAV뿐인데, **Ogg Vorbis는 Safari가 재생하지 못한다.** Safari
> 사용자는 Web MIDI가 없어 자판으로 연습하는 쪽이라 소리까지 안 나면 곤란하므로,
> 모든 브라우저가 읽는 AAC를 택하고 FFmpeg를 빌드 타임 도구로 받아들였다.

### 전이 의존성 (빌드 타임에만)

| 패키지 | 버전 | 라이선스 | 저작자 | 비고 |
|---|---|---|---|---|
| cffi | 2.1.0 | MIT-0 | Armin Rigo, Maciej Fijalkowski | soundfile이 libsndfile을 호출하는 데 사용 |
| pycparser | 3.0 | BSD-3-Clause | Eli Bendersky | cffi 의존 |
| [libsndfile](https://libsndfile.github.io/libsndfile/) | 1.2.2 | LGPL-2.1 | Erik de Castro Lopo | soundfile 휠에 동봉(`_soundfile_data/libsndfile_arm64.dylib`). **자산을 굽는 데만 쓰이고 배포물에 들어가지 않는다** |

> Python 앱과 함께 빠진 것: `shiboken6`(PySide6 바인딩), PortAudio(sounddevice
> 휠 동봉, MIT), RtMidi(python-rtmidi에 정적 링크, MIT 계열). 되살릴 일이 생기면
> 커밋 `10abd90`의 citation.md에 상세가 있다.

### 배포 시 주의 — 지금 남은 카피레프트

**verovio(LGPL-3.0) 하나다.** PySide6와 libsndfile은 Python 앱을 지우면서
배포 경로에서 빠졌다(libsndfile은 빌드 타임에만 쓴다). ffmpeg(GPL-3.0)도
별도 프로세스로 부르는 빌드 도구라 전파되지 않는다.

verovio는 **웹 번들에 통째로 들어간다**(`dist/assets/verovio-module-*.js`,
약 7.9MB). LGPL의 "교체 가능성" 요구를 번들된 단일 JS에서 어떻게 만족시킬지는
배포 형태(정적 호스팅 / Tauri 설치본)에 따라 답이 다르므로 배포 전에 정할 것.

여기에 더해 **verovio가 동봉한 악보 폰트의 라이선스**가 아직 미확인이다(위 참조).
우리 SVG 출력에 글리프 외곽선이 그대로 박혀 나가므로 이쪽이 더 급하다.

---

## 2-2. 파이썬 — 분석 사이드카 (`server/`)

**2026-08-09에 새로 들어왔다.** 스템 분리와 멜로디 f0는 학습된 모델이라 브라우저
안에서 끝나지 않아, 로컬 FastAPI 서버 하나를 두고 거기서 돌린다. **앱의 배포물에는
들어가지 않는다** — 사용자가 직접 띄우는 별도 프로세스이고, 꺼져 있으면 웹은 그
칸만 잠근 채 그대로 동작한다.

`server/.venv`는 위 2절의 `.venv`와 **별개다.** torch가 수 GB라 자산 파이프라인용
환경을 오염시키지 않는다.

라이선스는 설치된 배포판의 `importlib.metadata`(`License-Expression` 우선,
없으면 `Classifier`)와 `dist-info/licenses/LICENSE` 원문에서 직접 읽었다.
확인일: 2026-08-09.

### 서버 뼈대

| 패키지 | 버전 | 라이선스 | 저작자 | 활용처 |
|---|---|---|---|---|
| [fastapi](https://fastapi.tiangolo.com/) | 0.141.1 | MIT | Sebastián Ramírez | `server/app/main.py` — HTTP 라우팅 |
| [starlette](https://www.starlette.io/) | 1.6.0 | BSD-3-Clause | Encode | fastapi가 끌고 온다. CORS·파일 응답 |
| [pydantic](https://docs.pydantic.dev/) | 2.13.4 | MIT | Samuel Colvin 외 | fastapi가 끌고 온다 |
| [uvicorn](https://www.uvicorn.org/) | 0.52.1 | BSD-3-Clause | Encode | ASGI 서버 |
| [python-multipart](https://github.com/Kludex/python-multipart) | 0.0.32 | Apache-2.0 | Andrew Dunham 외 | `POST /jobs`의 파일 업로드 파싱. **없으면 500이 난다** |
| [numpy](https://numpy.org/) | 2.4.6 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | Travis E. Oliphant 외 | `app/audio.py` — 고역통과·게이트·정규화·리샘플 |
| [soundfile](https://github.com/bastibe/python-soundfile) | 0.14.0 | BSD-3-Clause | Bastian Bechtold | 스템 WAV 읽기·쓰기 |
| [pytest](https://pytest.org/) | 9.1.1 | MIT | Holger Krekel 외 | `server/test_sidecar.py` (개발 전용) |
| [httpx](https://www.python-httpx.org/) | 0.28.1 | BSD-3-Clause | Encode | fastapi `TestClient`가 쓴다 (개발 전용) |

### 모델

| 패키지 | 버전 | 코드 라이선스 | 가중치 | 활용처 |
|---|---|---|---|---|
| [beat-this](https://github.com/CPJKU/beat_this) | 1.1.0 | **MIT** (`dist-info/licenses/LICENSE` 원문: "Copyright (c) 2024 Institute of Computational Perception, JKU Linz, Austria" + MIT 전문) | 아래 참조 — **이번에도 미확인이 아니다** | `app/beats.py` — 비트·다운비트. **템포·박자의 유일한 출처다** |
| [demucs](https://github.com/adefossez/demucs) | 4.1.0 | **MIT** (`dist-info/licenses/LICENSE` 원문 확인) | 아래 참조 | `app/stems.py` — htdemucs 4스템 분리 |
| [rmvpe-onnx](https://github.com/NewComer00/rmvpe-onnx) | 0.2.3 | **MIT** (`dist-info/licenses/LICENSE` 원문: "Copyright (c) 2026 NewComer00" + MIT 전문) | 아래 참조 (별도 다운로드) | `app/melody.py` — 보컬 f0 커브 |
| [allin1](https://github.com/mir-aidj/all-in-one) | 1.1.0 | **MIT** (`dist-info/licenses/LICENSE` 원문: "Copyright (c) 2023 Taejun Kim" + MIT 전문) | 아래 참조 | `app/structure.py` — 구간(intro/verse/chorus…)·비트·다운비트 |
| [torch](https://pytorch.org/) | 2.13.0 | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT | — | demucs가 쓴다. Apple Silicon에서 MPS 가속 |
| [onnxruntime](https://onnxruntime.ai/) | 1.28.0 | MIT | — | rmvpe-onnx의 추론 백엔드 |

**Beat This! (비트·다운비트) — 2026-09-12에 들어왔고, 브라우저의 자기상관
경로를 대체했다**

Foscarin, Schlüter & Widmer, "Beat this! Accurate beat tracking without DBN
postprocessing", ISMIR 2024 ([arXiv 2407.21658](https://arxiv.org/abs/2407.21658)).
CPJKU(요하네스 케플러 대학 린츠 계산지각연구소)가 냈다.

**가중치도 MIT다 — 이번에도 미확인이 아니다.** 저장소 README가 코드와 가중치를
**함께** 명시한다: *"The code and the published model weights are released under
the MIT license."*
([GitHub raw README](https://raw.githubusercontent.com/CPJKU/beat_this/main/README.md)를
직접 읽어 확인, 2026-09-11). htdemucs·RMVPE가 "코드만 MIT이고 가중치 문서는 못
봤다"인 것과 갈리는 지점이고, All-In-One 체크포인트를 HF API로 확인한 것과 같은 급이다.

다만 **학습 데이터의 사슬은 여기서 끊긴다.** 같은 README가 스스로 밝힌다:
*"Note that some of the training files are fully copyrighted or under limited
Creative Commons licenses, and it is up to the user to assess whether this may
impact their use case."* 학습은 18개 데이터셋 4,556곡이다. allin1의 Harmonix Set
항목과 같은 종류의 단서라 같은 자리에 적어 둔다.

**체크포인트는 패키지에 동봉되지 않는다** — `final0`(77MB)을 첫 사용 때 JKU
클라우드에서 받아 `~/.cache/torch/hub/checkpoints/`에 둔다. RMVPE 가중치가
362MB를 따로 받는 것과 같은 구조라, 기동 자가진단이 **import까지만** 본다
(`app/beats.py`의 `selftest` — 진단하겠다고 77MB를 받으면 안 된다).

| 딸려 오는 것 | 버전 | 라이선스 | 메모 |
|---|---|---|---|
| [rotary-embedding-torch](https://github.com/lucidrains/rotary-embedding-torch) | 0.9.1 | **MIT** (`dist-info` METADATA의 `License: MIT` + `Classifier: License :: OSI Approved :: MIT License`, 저작자 Phil Wang) | 트랜스포머의 회전 위치 임베딩. **새로 늘어난 의존성은 이것 하나다** — torch·einops·soxr·numpy는 이미 있었다 |

> **왜 갈아탔는지는 라이선스와 무관하다.** 자기상관은 배수에 대해 자기닮음이라
> 템포 배수 오류를 원리적으로 못 가른다. 규칙으로 고치려는 시도가 여덟 번 죽은
> 뒤 이걸 정답 14곡에 재서 **14/14**(우리 11/14 · allin1 10/14)가 나왔고,
> 전사도 여섯 곡 전부에서 좋아졌다(정확 841 → 1345음). 자세한 것은
> `docs/템포_배수오류_미해결.md` §3-3.

**All-In-One (곡 구조) — 2026-08-12에 들어왔다**

Kim & Nam, "All-In-One Metrical And Functional Structure Analysis With
Neighborhood Attentions on Demixed Audio", WASPAA 2023
([arXiv 2307.16425](https://arxiv.org/abs/2307.16425)). 사양서 §2가 구조 분석의
주 도구로 지목한 것이다.

**가중치는 이번에는 미확인이 아니다.** `harmonix-all` 체크포인트를 HuggingFace
[`taejunkim/allinone`](https://huggingface.co/taejunkim/allinone)에서 첫 사용 때
받는데, 그 저장소의 `cardData.license`와 태그가 **둘 다 `mit`**이다(HF API
`https://huggingface.co/api/models/taejunkim/allinone`로 직접 확인, 2026-08-12).
htdemucs·RMVPE 가중치가 "코드만 MIT이고 가중치 문서는 못 봤다"인 것과 이 점이
다르다.

다만 **학습 데이터인 [Harmonix Set](https://github.com/urinieto/harmonixset)은
주석만 공개된 것**이라(오디오는 없다) 데이터 출처의 사슬은 여기서 끊긴다.

| 딸려 오는 것 | 버전 | 라이선스 | 메모 |
|---|---|---|---|
| [natten](https://github.com/SHI-Labs/NATTEN) | **0.17.5 (핀)** | MIT (`licenses/LICENSE` 원문: "Copyright (c) 2022 - 2025 Ali Hassani") | Dilated Neighborhood Attention 커널. **버전을 올리지 말 것** — 아래 환경 제약 |
| [madmom](https://github.com/CPJKU/madmom) | 0.17.dev0 (git) | **소스는 BSD-3-Clause, 데이터·모델 파일은 CC BY-NC-SA 4.0** | 아래 |
| [hydra-core](https://github.com/facebookresearch/hydra) | 1.3.5 | MIT | allin1의 설정 관리 |
| [omegaconf](https://github.com/omry/omegaconf) | 2.3.1 | BSD-3-Clause | hydra가 끌고 온다 |
| [matplotlib](https://matplotlib.org/) | 3.11.1 | PSF-based (matplotlib 고유 라이선스) | allin1의 `visualize=True` 전용. **우리는 끄고 쓴다** |

> **madmom의 라이선스가 둘로 갈려 있다** (LICENSE 원문 직접 확인, 2026-08-12).
> `.py`/`.pyx` 같은 소스는 BSD-3-Clause인데, `.npy`·`.npz`·`.h5`·`.pkl` 같은
> **데이터·모델 파일은 CC BY-NC-SA 4.0(비상업·동일조건)**이고 LICENSE가 상업적
> 이용은 저자에게 연락하라고 적어 두었다.
>
> **우리 실행 경로는 소스만 탄다.** allin1이 madmom에서 부르는 것은
> `audio.signal`·`audio.stft`·`audio.spectrogram`·`processors`뿐이고(실측:
> `grep madmom allin1/**/*.py`), 그건 전부 순수 DSP 소스다. 모델 파일을 쓰는
> `madmom.evaluation.beats`는 `allin1/training/` 아래에서만 import되는데 우리는
> 그 모듈을 부르지 않는다. **다만 패키지 자체에는 그 파일들이 함께 들어 있으므로,
> 사이드카 환경을 통째로 재배포하는 형태가 되면 다시 볼 것.** 성격이 GAME
> 가중치와 같은 부류다(아래 3-1절).

> **basic-pitch(0.4.0, Apache-2.0, Spotify AB)는 2026-08-11에 제거했다.** 멜로디
> f0를 RMVPE로 갈아끼우면서 빠졌다 — 실곡 대조에서 정확 매칭이 189 → 515로
> 올랐다(CLAUDE.md의 측정 표). 함께 빠진 것: `resampy`(basic-pitch 전용
> 의존성)·`pretty_midi`(쓰지 않았다). **`setuptools<81` 핀도 이때 사라졌다** —
> `pkg_resources`를 부르던 것이 resampy 하나뿐이었기 때문이다.
> 그 시절 확인해 둔 사실 하나는 남겨 둔다: basic-pitch는 메타데이터의
> `License-Expression`도 `Classifier`도 비어 있어서 휠 안의 `LICENSE` 원문을
> 직접 읽어야 라이선스를 알 수 있었다. **메타데이터가 비었다고 라이선스가 없는
> 것이 아니므로 추측하지 말고 늘 원문을 볼 것.**

**RMVPE의 라이선스 사슬 — 3단이다** (확인일 2026-08-11)

이 패키지는 **남의 코드를 감싸고 남의 가중치를 받아 오는** 구조라, 우리가 확인할
것이 하나가 아니다. 세 단을 각각 원문에서 봤다.

1. **패키지(`rmvpe-onnx`)** — MIT. `dist-info/licenses/LICENSE`에 MIT 전문,
   저작권자 NewComer00. `importlib.metadata`의 `License` 필드도 MIT.
2. **감싼 코드** — RVC 프로젝트([RVC-Project/Retrieval-based-Voice-Conversion](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion))의
   `rvc/lib/rmvpe.py`에서 왔다고 `model.py` 헤더가 밝힌다(MIT, Copyright 2023
   liujing04 · 源文雨 · Ftps).
3. **가중치(`rmvpe.onnx`, 362MB)** — HuggingFace [`lj1995/VoiceConversionWebUI`](https://huggingface.co/lj1995/VoiceConversionWebUI)에서
   **첫 사용 때 내려받는다**(SHA-256 `5370e71a…3660fd` 고정 검증, 우리 쪽에서도
   일치 확인). 패키지 헤더는 이 저장소를 MIT로 적는다.

원 모델은 **[Dream-High/RMVPE](https://github.com/Dream-High/RMVPE) — Apache-2.0**
(GitHub API의 `license.spdx_id`로 확인). 논문은 Wei et al., "RMVPE: A Robust Model
for Vocal Pitch Estimation in Polyphonic Music", Interspeech 2023
([arXiv 2306.15412](https://arxiv.org/abs/2306.15412)).

**가중치는 htdemucs와 같은 부류의 미확인 항목으로 둔다.** 위 3단은 전부 "코드
저장소가 자기 라이선스를 뭐라고 적었는가"이고, **가중치 파일 자체에 붙은 라이선스
문서를 본 것이 아니다.** 개인 사용에는 문제가 없지만 배포·수익화 시점에 반드시
다시 확인할 것 — 특히 원 모델(Apache-2.0)에서 변환된 파일이 재배포 저장소의
MIT 표기 아래 있는 것이 맞는지.

**모델 가중치**

- **htdemucs**: 코드가 아니라 HuggingFace(`adefossez/HTDemucs`)에서 **실행 시점에
  내려받는다** — `~/.cache/huggingface/hub/models--adefossez--HTDemucs/`. demucs
  저장소의 README는 코드에 대해 MIT를 명시하지만 **가중치 파일 자체의 라이선스는
  별도로 확인하지 않았다.** 개인 사용에는 문제가 없고, 배포·수익화 시점에 반드시
  원문을 확인할 것(사양서 §10의 같은 경고).
- **RMVPE**: 위 3단 참조. 패키지에 **동봉되지 않고** 첫 사용 때
  `rmvpe_onnx/data/rmvpe.onnx`로 받는다(362MB). basic-pitch가 2.5MB짜리를 동봉해
  오던 것과 정반대라, 기동 자가진단이 "가중치가 있을 때만 추론해 본다"로 바뀌었다
  (`app/melody.py`의 `selftest`).

### 딸려 오는 것 중 주의할 것

| 패키지 | 버전 | 라이선스 | 메모 |
|---|---|---|---|
| [lameenc](https://github.com/chrisstaite/lameenc) | 1.8.4 | **LGPL-3.0-or-later** | demucs가 MP3로 내보낼 때만 쓴다. **우리는 WAV만 쓰므로 부르지 않는다.** 배포 형태를 정할 때 이 의존성을 뺄 수 있는지 볼 것 |
| [librosa](https://librosa.org/) | 0.11.0 | ISC | **rmvpe-onnx가 직접 요구한다**(리샘플·모노 다운믹스). 예전에는 basic-pitch가 끌고 오던 것이다. 우리 코드는 직접 부르지 않는다 |
| [scipy](https://scipy.org/) | 1.17.1 | BSD-3-Clause | rmvpe-onnx(창 함수)와 librosa가 요구한다 |
| [huggingface-hub](https://github.com/huggingface/huggingface_hub) | 1.27.0 | Apache-2.0 | rmvpe-onnx가 가중치를 받을 때, demucs가 htdemucs를 받을 때 |
| [julius](https://github.com/adefossez/julius) | 0.2.8 | MIT | demucs의 리샘플러 |
| [einops](https://github.com/arogozhnikov/einops) | 0.8.2 | MIT | demucs |

> 2026-08-11에 함께 빠진 것: **resampy**(ISC — basic-pitch 전용이었다),
> **pretty_midi**(MIT — 쓰지 않았다), **setuptools 버전 핀**.

### 환경 제약 (실측 2026-08-09, 2026-08-11 갱신)

- **Python 3.11이 필요하다.** 처음 이걸 확인한 것은 basic-pitch가 3.14에서 낡은
  `numpy`를 소스 빌드하려다 실패했을 때다(`pkgutil.ImpImporter` 제거). 그 패키지는
  빠졌지만 **제약은 유지한다** — torch 계열도 파이썬 릴리스를 늦게 따라온다.
  패키지 하나의 사정이 아니라 ML 생태계 전반의 사정이었다.
- **`setuptools<81` 핀은 없앴다**(2026-08-11). `pkg_resources`를 import하던 것은
  `resampy`뿐이었고(librosa는 테스트 extra에서만 요구한다 — 실측), resampy를
  요구하던 것은 basic-pitch뿐이었다. 지금은 의존성 전체를 import해도
  `sys.modules`에 `pkg_resources`가 올라오지 않는다(실측).
- **natten을 `0.17.5`에 핀했다** (실측 2026-08-12). allin1 1.1.0은 2023년의
  natten API(`natten1dqkrpb`·`natten1dav`·2D 짝)로 쓰였는데 그 사이 두 번
  갈렸다. **0.21.7**(최신)은 rpb를 받는 분리형 API를 아예 없애서 못 쓴다 —
  rpb는 가중치에 들어 있는 학습된 값이라 버릴 수 없다. **0.14.6**(원래 버전)은
  torch 2.13 헤더에서 컴파일이 깨진다(`ATen/cpu/vec/functional_bfloat16.h`의
  `convert_to_float` 시그니처 변경). **0.17.5만 둘 다 만족한다** — 같은 함수가
  `na1d_qk(..., rpb=)`로 이름만 바뀌어 남아 있다. 이름을 다시 붙이는 shim이
  `app/structure.py`의 `_prepare_natten()`이고, 거기 셋 중 나머지 둘도 같은
  성격이다(torch가 없앤 `torch.cuda._device_t`, natten이 import 시점에 부르는
  CUDA 능력치 조회). **셋 다 import 시점에 시끄럽게 터지는 종류라** 조용히 틀린
  결과를 내지 않는다.
- **natten 0.17.5는 소스 빌드다.** macOS arm64용 휠이 없어 clang이 돈다 —
  `pip install --no-build-isolation "natten==0.17.5"`(격리를 끄지 않으면 빌드
  환경에 torch가 없어 setup.py가 죽는다).
- **allin1도 CPU로 돌린다**(`structure._DEVICE`). natten 커널이 MPS를 지원하지
  않는다. 실측: 234초 곡에 205초(자기 htdemucs 분리 포함).
- **RMVPE는 CPU로 돌린다.** onnxruntime이 Apple Silicon에서 CoreML을 고르면
  긴 곡에서 죽는다 — 255초(25502프레임)에서 `Error executing model: Error in
  building plan`(실측). **1초짜리 사인파로는 멀쩡히 돌아서** 자가진단을 통과하고
  첫 실곡에서 터진다. CPU가 같은 곡을 3.9초에 끝내므로(약 65배속) 장치를 고정했다.

---

## 3. 참고한 문서·웹 자료

코드나 데이터를 가져오지 않았고, 사실 확인·의사결정 근거로만 참조한 것들이다.

| 자료 | 발행처 | 참조 시점 | 무엇에 썼는지 |
|---|---|---|---|
| [FreePats — Acoustic Grand Piano](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html) | FreePats 프로젝트 | 2026-08-02 | 피아노 음원 후보들의 라이선스·용량·포맷 비교. Upright Piano KW 선정 근거 |
| [freepats/upright-piano-KW](https://github.com/freepats/upright-piano-KW) | FreePats | 2026-08-02 | CC0 라이선스 확인, 저장소 구조 파악, 다운로드 경로 결정 |
| [MuseScore Handbook — SoundFonts and SFZ files](https://musescore.org/en/handbook/2/soundfonts-and-sfz-files) | MuseScore | 2026-08-02 | MuseScore_General의 MIT 라이선스 확인 (대안 검토) |
| [GeneralUser GS](https://www.schristiancollins.com/generaluser.php) | S. Christian Collins | 2026-08-02 | 라이선스 조건 및 샘플 출처 불확실성 확인 → 미채택 근거 |
| SFZ 포맷 | — | 2026-08-02 | [sfz.py](web/scripts/sfz.py) 작성 시 opcode 의미 파악. 규격 문서를 인용하거나 코드를 가져오지 않았고, 이 음원의 `.sfz` 파일에 실제로 등장하는 opcode만 구현했다 |
| [MusicXML 4.0](https://www.w3.org/2021/06/musicxml40/) | W3C Music Notation CG | 2026-08-02 | `web/src/core/score.ts`가 만드는 악보 XML의 요소 이름(`score-partwise`·`note`·`chord`·`accidental` 등) 확인. 규격 문서를 인용하거나 코드·스키마를 가져오지 않았고, 두 음짜리 한 마디에 필요한 최소 요소만 직접 작성했다 |
| [SMuFL](https://www.smufl.org) | Steinberg / W3C Music Notation CG | 2026-08-02 | verovio가 쓰는 악보 폰트 규격. 우리가 직접 구현하지 않았고, verovio 출력 SVG를 후처리할 때 배경 지식으로만 참조했다 |

---

## 3-1. 오디오 분석·전사 알고리즘 (논문·강의 — 코드 미사용)

`web/src/core/analysis/`(BPM·박자·조성)와 `web/src/core/transcribe/`(음표·양자화·
악보)는 **라이브러리를 하나도 쓰지 않는다.**
FFT까지 직접 짰다. 따라서 여기에 걸리는 라이선스는 없지만, **알고리즘의
출처는 남긴다** — 이 프로젝트의 기록 규칙이 "코드 조각"까지 포함하기 때문이고,
나중에 파라미터를 다시 맞출 때 원문을 찾아가야 하기 때문이다.

아래 어느 항목에서도 **코드·의사코드·그림을 옮기지 않았다.** 논문과 강의가
서술한 방법을 읽고 TypeScript로 새로 구현했다.

| 알고리즘 | 출처 | 우리 코드 |
|---|---|---|
| SuperFlux 온셋 검출 (로그주파수 필터뱅크 + 주파수축 max-filter + 지연 차분) | Böck & Widmer, "Maximum Filter Vibrato Suppression for Onset Detection", DAFx 2013 | `analysis/features.ts` |
| 온셋 봉우리 고르기 (국소 최대 + 문턱 + 불응기) | Böck, Krebs & Schedl, "Evaluating the Online Capabilities of Onset Detection Methods", ISMIR 2012 (§2.3의 peak-picking) | `transcribe/notes.ts` `pickOnsets` |
| 자기상관 × 로그정규 템포 prior | Klapuri et al. 계열. 강의 08(음악 정보학, GCT731)이 정리한 형태를 따랐다 | `analysis/tempo.ts` `estimateTempo` |
| 동적 계획법 비트 추적 (`D(t)=onset(t)+max{D(τ)−λ·log²(Δ/T)}`) | Ellis, "Beat Tracking by Dynamic Programming", J. New Music Research 36(1), 2007 | ~~`analysis/tempo.ts` `trackBeats`~~ **2026-09-12에 제거** — 비트를 Beat This!가 낸다(위 2-2절). 자기상관 템포 추정과 배수 교정 규칙이 함께 빠졌다 |
| Krumhansl–Schmuckler 조성 판정 (크로마 × 프로파일 상관) | Krumhansl, *Cognitive Foundations of Musical Pitch*, 1990 (프로파일은 Krumhansl & Kessler 1982) | `analysis/key.ts` |
| Temperley 조성 프로파일 | Temperley, *The Cognition of Basic Musical Structures*, MIT Press 2001 (Kostka-Payne 코퍼스 기반) | `analysis/key.ts` `TEMPERLEY` |
| 크로마 = 옥타브 등가성으로 접기 | 강의 03(음악 정보학) · Bartsch & Wakefield, WASPAA 2001 | `analysis/features.ts` |

**템포 배수(옥타브) 오류 — 읽기만 하고 채택하지 않은 것들**(2026-08-18).
절반 방향 교정을 설계하면서 선행 연구를 훑었다. **어느 것도 구현하지 않았다** —
전부 학습된 판정기라 정답 BPM 9곡으로는 성립하지 않는다. 아래는 "왜 안 했는가"의
근거이고, 평가셋이 커지면 다시 볼 목록이다. 검토 경위와 죽은 가설은
`docs/템포_배수오류_미해결.md`에 있다.

| 문헌 | 무엇을 하는가 | 왜 안 썼나 |
|---|---|---|
| Peeters & Papadopoulos, "Beat Critic: Beat Tracking Octave Error Identification by Metrical Profile Analysis", ISMIR 2010 ([PDF](https://archives.ismir.net/ismir2010/paper/000019.pdf)) | 스펙트럼 부대역별 metrical profile로 배수 오류를 **양방향 대칭** 판정 | 분류기를 학습시킨다. **부대역으로 나눈다는 축은 우리가 아직 안 해 봤다** |
| Klapuri, Eronen & Astola, "Analysis of the Meter of Acoustic Musical Signals", IEEE TSALP 14(1), 2006 ([PDF](https://www.iro.umontreal.ca/~pift6080/H09/documents/papers/klapuri_meter.pdf)) | tatum·tactus·measure를 확률 모형으로 **동시 추정** | 우리 캐스케이드가 일방향인 것의 정반대라 통째로 갈아엎는 일이 된다 |
| Schreiber & Müller, "Exploiting Global Features for Tempo Octave Correction", ICASSP 2014 ([PDF](https://www.audiolabs-erlangen.de/content/05_fau/professor/00_mueller/03_publications/2014_SchreiberMueller_TempoEstimation_ICASSP.pdf)) | 평균 스펙트럼 노벨티라는 전역 특징으로 옥타브 교정 | 특징과 지각 템포의 관계를 데이터로 맞춰야 한다 |
| Percival & Tzanetakis, "Streamlined Tempo Estimation Based on Autocorrelation and Cross-correlation With Pulses", IEEE TASLP 22(12), 2014 | 자기상관 + 펄스열 교차상관. 옥타브 교정을 "아주 단순한 휴리스틱"으로 | **의존성 없는 계열이라 우리와 가장 가깝다.** 실제 휴리스틱을 아직 확인 못 했다 — 다음에 볼 때 여기부터 |

**코드 인식**(2026-08-13 추가). 강의 07(chord recognition, GCT731)이
정리한 고전 파이프라인 — **크로마 → 이진 템플릿 → HMM Viterbi** — 을 그대로
세웠다. 학습된 모델도 학습 데이터도 쓰지 않으므로 새 의존성이 없다.

| 알고리즘 | 출처 | 우리 코드 |
|---|---|---|
| 이진 코드 템플릿 매칭 (12 장 + 12 단 = 24개, 크로마와의 상관) | Fujishima, "Realtime Chord Recognition of Musical Sound: a System Using Common Lisp Music", ICMC 1999 · Müller, *Fundamentals of Music Processing* 5장 · 강의 07 | `analysis/chords.ts` `chordTemplates` |
| 코드 열의 HMM/Viterbi 후처리 (프레임 단위 최댓값은 시간 의존성을 못 본다) | Sheh & Ellis, "Chord Segmentation and Recognition using EM-Trained HMMs", ISMIR 2003 · 강의 07 | `analysis/chords.ts` `decode` |
| **비트 동기 크로마** — 코드 인식은 프레임이 아니라 비트 위에서 돈다 | Bartsch & Wakefield, WASPAA 2001 (위 표에도 있다) | `analysis/meter.ts` `beatChroma` |
| 로그 압축 크로마 `log(1 + γ·‖X‖)` — 센 배음 하나가 12칸을 독식하는 것을 막는다 | Müller & Ewert, "Towards Timbre-Invariant Audio Features for Harmony-Based Music", IEEE TASLP 18(3), 2010 · 위 *FMP* 3장 | `analysis/features.ts` `extractChordChroma` |

**직접 정한 것 넷**(강의에도 문헌에도 없다. 근거는 실측이거나 사양서다):

1. **창을 8192로 넓힌 것** — 옛 크로마의 하한 200Hz는 빈 간격(10.8Hz)이
   반음보다 넓어지는 분해능 한계였다. 네 배로 늘려 C2(65Hz)까지 내려간다.
   CQT가 정석이지만 커널 기계를 통째로 들여야 해서, 필요한 것(근음이 옆 칸으로
   안 새는 것)만 얻는 쪽을 골랐다.
2. **마디선에서 코드 변경이 싸다** — 학습된 전이 행렬(강의 그림의 Beatles
   행렬)은 데이터가 있어야 나온다. 대신 "코드는 마디선에서 바뀐다"만 썼다.
   `transcribe/quantize.ts`의 박절 사전과 같은 종류의 지식이다.
3. **베이스 음역(65~200Hz)으로 근음을 가른다** — `Dm7`(D F A C)과
   `F6`(F A C D)은 음고류 집합이 같아 원리적으로 안 갈린다(사양서 §6이
   aug·dim7에 대해 말한 대칭과 같은 종류). 실측: 베이스 항이 없으면 `F`,
   있으면 `Dm7`이 나왔다.
4. **비트 안쪽에 무게를 더 준다** — 창(371ms)이 비트(120BPM에서 500ms)보다
   짧지 않아 비트 머리의 프레임이 앞 코드를 함께 본다. 실측: 이게 없으면
   합성 왕도진행에서 `G7`과 `Em7`이 한 덩어리로 뭉갰다.

상수(`NO_CHORD_SCORE`·`CHANGE_COST_*`·`SEVENTH_RATIO`·`BASS_WEIGHT`)는
**전부 평가셋 없이 정했다** — 코드 정답을 찍어 둔 곡이 아직 하나도 없다.

**리듬 양자화**(2026-08-10 추가). 실곡에서 `점8분쉼표 + 16분음표`가 남발되는
증상을 고치며 문헌을 확인했다. 최근접 반올림이 실패하는 것은 알려진 문제이고,
해법의 계보는 아래와 같다. **아이디어(비용의 구성)만 가져왔고 수식·코드·파라미터는
옮기지 않았다** — 아래 구현의 상수는 전부 직접 정한 값이다.

| 알고리즘 | 출처 | 우리 코드 |
|---|---|---|
| 리듬 전사를 HMM/Viterbi로 (타이밍 편차 모델 × 음가 문법) — 최초 | Takeda, Nishimoto, Sagayama, "Rhythm and Tempo Analysis Toward Automatic Music Transcription", ICASSP 2007 / Takeda et al., "Hidden Markov Model for Automatic Transcription of MIDI Signals", MMSP 2002 | `transcribe/quantize.ts` `viterbiOnsets` |
| **메트리컬 HMM** — 박절 위치를 상태 사전확률로 두어 문법적으로 불가능한 표기를 피한다 | Nakamura, Yoshii, Sagayama, "Rhythm Transcription of Polyphonic Piano Music Based on Merged-Output HMM for Multiple Voices", IEEE/ACM TASLP 25(4), 2017 — [arXiv 1701.08343](https://arxiv.org/abs/1701.08343) | `transcribe/quantize.ts` `metricalCost` |
| **음가 인식을 온셋 양자화와 분리** — 음가는 발성 길이가 아니라 IOI에서 얻는다 | 위 Nakamura 2017의 note value recognition 단계 | `transcribe/quantize.ts` `withDurations` |
| 강한 박절 위치에 음표가 몰린다는 관찰(박절 가중치의 근거) | Povel & Essens, "Perception of Temporal Patterns", Music Perception 2(4), 1985 | `transcribe/quantize.ts` `metricalCost` |
| 비트·다운비트를 선지식으로 주고 양자화 — 구조의 타당성 확인 | Liu, Kong, Benetos et al., "Performance MIDI-to-Score Conversion by Neural Beat Tracking", ISMIR 2022 · "Beat-Based Rhythm Quantization of MIDI Performances", [arXiv 2508.19262](https://arxiv.org/abs/2508.19262) | (구조만 참고) |
| "f0 추정 → 타텀 반올림" 캐스케이드가 노래에서 실패하는 이유 | Nishikimi, Nakamura, Yoshii et al., "Audio-to-score singing transcription based on a CRNN-HSMM hybrid model", APSIPA Trans. 2021 | (문제 진단) |
| 가수의 타이밍 편차는 표현이자 습관 — 악보 시작 ≠ 발성 시작 | Hono et al., "Singing Voice Synthesis Based on Frame-Level Sequence-to-Sequence Models Considering Vocal Timing Deviation", [arXiv 2301.02262](https://arxiv.org/abs/2301.02262) | `transcribe/quantize.ts` `estimateOffsetMs` |
| **클록 드리프트** — 밀린 양이 곡 안에서 변한다. 양자화와 템포/오프셋 곡선을 함께 푼다 | Cemgil & Kappen, "Monte Carlo Methods for Tempo Tracking and Rhythm Quantization", *JAIR* 18, 2003 — [doi:10.1613/jair.1121](https://doi.org/10.1613/jair.1121) · 위 Nakamura 2017도 드리프트 변수를 둔다 | `transcribe/quantize.ts` `estimateOffsetCurve` (2026-08-10 추가) |

| **CFP(Combined Frequency and Periodicity)** — 스펙트럼 × 켑스트럼. 스펙트럼은 반토막에, 켑스트럼은 두 배에 속으므로 곱하면 서로의 옥타브 오류가 상쇄된다. 옥타브 심판으로 쓴다 | Su & Yang, "Combining Spectral and Temporal Representations for Multipitch Estimation of Polyphonic Music", *IEEE/ACM TASLP* 23(10), 2015 — [doi:10.1109/TASLP.2015.2442411](https://doi.org/10.1109/TASLP.2015.2442411) | `server/app/cfp.py` (2026-08-18 추가) |
| **다각선 단순화(RDP)** — 극점을 남기며 점을 줄인다. 피치 컨트롤 점 개수를 한 자릿수 줄이는 데 쓴다 | Ramer, "An iterative procedure for the polygonal approximation of plane curves", *CGIP* 1(3), 1972 · Douglas & Peucker, *Cartographica* 10(2), 1973 | `transcribe/curve.ts` `simplify` (2026-08-12 추가) |

**RDP는 세로거리로 잰다.** 원 알고리즘은 선분까지의 수직거리를 쓰지만 우리 축은
가로가 초·세로가 반음이라 수직거리에 뜻이 없다. 지키려는 양이 "그 시각의 음높이가
얼마나 틀리는가"이므로 **같은 시각의 세로 오차(센트)**로 바꿔 썼다. 코드는 옮기지
않았고 반복 절차만 따랐다(재귀 대신 명시적 스택).

### 드럼 (2026-09-04 추가)

**새 라이브러리도 새 모델도 없다.** 온셋은 이미 있던 SuperFlux ODF(위 표)를 그대로
쓰고, 분류는 대역 에너지 규칙이며, 반복 압축은 사양서 §10의 알고리즘을 코드 심볼
대신 마디 심볼에 적용한 것이다. 그래서 **배포물이 한 바이트도 안 늘었다.**

| 무엇 | 출처 | 우리 코드 |
|---|---|---|
| **GM 드럼맵**(채널 10, 번호 35~81) — 번호와 악기 이름의 대응 | MIDI Manufacturers Association, *General MIDI System Level 1* — [midi.org/gm-level-1-sound-set](https://midi.org/gm-level-1-sound-set) (규격 문서. 표를 보고 옮겨 적었고 코드·데이터 파일은 가져오지 않았다) | `core/drums/gm.ts` |
| 드럼 온셋은 "Hard" 유형이라 단순 spectral flux로 충분하다는 판단 | 사양서 `PIPELINE_SPEC.md` §4[2] | `core/drums/detect.ts` |
| **반복 압축** — 마디 단위 심볼 열 → 주기 탐색 → 편집 거리 클러스터링 → `A / A′ / A″` | 사양서 `PIPELINE_SPEC.md` §10. 계보는 COSIATEC / SIATECCompress (Meredith), MIREX "Discovery of Repeated Themes and Sections" | `core/drums/pattern.ts` |
| 드럼 기보의 오선 자리·머리표 관례(킥 F4, 스네어 C5, 하이햇 G5 x머리표 …) | 관례. 특정 저작물을 옮긴 것이 아니라 널리 쓰이는 배치를 적었다 | `core/drums/gm.ts`의 `step`/`octave`/`head` |

**오선 자리는 verovio에 직접 재서 확인했다** — 번들에 GM 번호 → 자리 매핑이 없어서
(`score-instrument`·`midi-unpitched` 처리기가 없다) 우리가 정해야 했고, `<unpitched>`가
`<pitch>`와 같은 자리에 앉는다는 것을 렌더해서 확인했다. 측정 결과는
`core/drums/notation.ts` 앞머리에 있다.

### CFP — 참조 구현을 읽었다는 것을 밝혀 둔다

**이 항목만은 "논문만 읽었다"가 아니다.** 위 표의 다른 줄과 성격이 다르므로 따로 적는다.

- **알고리즘의 출처는 논문**(Su & Yang 2015)이고, 층 구조("스펙트럼 → 켑스트럼 →
  스펙트럼의 켑스트럼, 층마다 거듭제곱과 양 끝 절단")도 논문이 서술한 것이다.
- **파라미터 값과 절단의 정확한 의미는 참조 구현에서 확인했다** —
  [omnizart](https://github.com/Music-and-Culture-Technology-Lab/omnizart)의
  `omnizart/feature/cfp.py`(**MIT**, 2026-08-18 GitHub API로 라이선스 직접 확인).
  거기서 가져온 것은 `GAMMA = (0.24, 0.6, 1.0)`과 "음수를 0으로, 양 끝 `cutoff`를
  0으로, 그 다음 거듭제곱"이라는 비선형 변환의 순서다.
- **코드는 옮기지 않았다.** omnizart는 전체 로그주파수 필터뱅크를 만들지만
  우리는 **점 질의만 한다**(`salience(time, freqs)`) — 심판이 프레임마다 후보
  둘만 보므로 분쟁 프레임에서만 돌릴 수 있고, 그것이 비용을 곡당 1초 안쪽으로
  묶는다. 창 길이(372ms)는 우리 평가셋에서 AUC로 다시 정했다(omnizart 기본값은 180ms).
- scipy를 끌어오지 않으려고 **블랙만-해리스 창은 직접 적었다**(4항 코사인).
  새 의존성이 없다.

> **MIT라 옮겨도 법적으로는 문제가 없었다.** 그래도 새로 구현한 것은 필요한
> 것(점 질의)이 참조 구현이 하는 것(필터뱅크)보다 훨씬 작아서다 — 옮겼다면
> 안 쓰는 코드를 함께 들이고 비용도 두 자릿수 늘었다.

**드리프트는 2026-08-10에 실측으로 필요성이 확인되고 추가됐다** — 정답 MIDI가
있는 실곡에서 밀린 양이 −56~+60ms를 오갔다(16분 한 칸이 108ms). Cemgil은
Monte Carlo로 풀지만 우리는 **표본 잘라내기 + 슬라이딩 중앙값 + 기울기 제한**의
강건 필터로 대신했다. 구조(시변 오프셋을 상태로 둔다)만 같고 추론 방법은 다르다.

**신경망 계열(PM2S·T5 양자화)은 채택하지 않았다.** 학습 데이터와 런타임이 필요한데
이 저장소는 순수 TypeScript에 의존성이 없다. 같은 구조를 **학습 없이** 세울 수 있어서
비용 항만 직접 설계했다 — 대신 정확도는 그만큼 못 미치고, 상수들은 평가셋이 생겨야
근거를 갖는다.

**프로파일 숫자 24개는 논문에서 그대로 가져온 값이다.** 알고리즘 서술과 달리
이것은 데이터라 따로 적어 둔다 — 실험으로 얻은 수치이고, MIR 도구(librosa·
Essentia 등)에 널리 재수록되어 사실상 표준 상수로 쓰인다. 출판된 학술 수치를
인용한 것이며 저작물을 복제한 것이 아니라고 보지만, **배포 시점에 다시 확인할
것.**

박자표 판정(축 A·B)에는 출처가 없다. 표준 해법이 없는 영역이라
`rise/PIPELINE_SPEC.md`(이 저장소 밖) §5의 분해 방침만 따르고 판정 규칙과 임계값은 직접
정했다 — 근거 없는 상수라는 뜻이므로 평가셋이 생기면 다시 맞춰야 한다.

### Synthesizer V 프로젝트 형식(`.svp`) — 실측으로 알아낸 것

`web/src/core/transcribe/svp.ts`가 신스V 2 프로젝트 파일을 쓴다. **공식 형식
명세는 공개돼 있지 않고, Dreamtonics의 문서 사이트는 자동 조회를 막는다(HTTP 403).**
그래서 **사용자 본인의 작업 파일 6개를 열어 구조를 관찰했다**(2026-08-12):
`/Volumes/june2_07ssd/신스비/`의 `밤파이아`·`붸게`·`staccato`·`널따라`(v196)와
`Charles`·`열이상`(v182·v187).

- **저작물을 가져오지 않았다.** 읽은 것은 JSON의 **키 이름과 값의 형태**이고,
  음악 내용(음표·가사·피치)은 쓰지 않았다. 파일은 저장소에 복사하지 않았다.
- 저장소 안에 이미 읽는 쪽 구현이 있었다 — `server/scripts/evalset.py`의
  `svp_tracks()`가 정답 MIDI를 굽느라 같은 형식을 파싱한다. `BLICKS_PER_QUARTER
  = 705,600,000`은 거기서 왔다.
- 기능 설명(Smart Pitch Controls, "Extract Notes from Audio"의 제약)은 공개
  매뉴얼에서 확인했다 — [Voice-to-MIDI Conversion](https://manual.synthv.info/ai-functions/voice-to-midi/)
  (비공식 매뉴얼) 및 Dreamtonics 공식 문서의 검색 요약. **본문을 옮기지 않았다.**
- **형식은 언제든 바뀔 수 있다.** 관찰로 얻은 규약이므로 신스V가 판올림하면
  깨질 수 있다. 회귀 시험(`web/test/svp.test.ts`)이 참조·그룹·음표의 키 목록을
  못 박아 두었으니, 그 테스트가 깨지면 실제 파일과 다시 대조할 것.

### 강의 자료

강의 PDF는 이 저장소로 복사해 오지 않았고, 인용문·그림·표를 옮기지도
않았다. 위 표의 "강의 08" 같은 표기는 어디서 그 방법을 배웠는지를 가리키는
것일 뿐이다. **강의 자료 자체는 재배포 대상이 아니다.**

---

## 4. 설계 참고 (코드·자산 미사용)

[화성학_청음_앱_기술검토.md](화성학_청음_앱_기술검토.md) 부록이 설계 참고용으로 든
프로젝트들이다. **현재까지 코드나 자산을 가져온 바 없다.** 향후 참고하게 되면
그 사실을 이 절에 기록할 것.

| 프로젝트 | 링크 | 참고 의도 |
|---|---|---|
| Analytic Piano | https://github.com/ospreyelm/AnalyticPiano | 로마자 분석 UI, 연습 세션 구조 |
| KDE Minuet | https://minuet.kde.org/ | 청음 문제 카테고리 분류 체계 |
| LenMus | https://www.lenmus.org/ | 난이도 점진 제어 방식 |

---

## 5. 아직 도입하지 않은 예정 의존성

설계 문서가 Phase 2 이후에 쓰기로 한 것들이다. 실제로 설치할 때 위 2절로 옮기고
라이선스를 확인해 기록한다.

| 예정 | 용도 | 문서상 라이선스 (미검증) |
|---|---|---|
| music21 | 화성 이론 로직, 로마자 → 음 생성 | BSD |

verovio는 2026-08-02에 실제로 도입해 위 2절로 옮겼다.

music21을 아직 넣지 않은 이유는 라이선스가 아니라 성능이다 — import에만 2~3초가
걸려 문제당 10초짜리 앱의 기동에 부담이 크다. 온음계 음정 계산은
`web/src/core/theory.ts`에 직접 구현했다. 로마자 분석·화음 스펠링이
필요해지는 Phase 3에서 다시 판단한다.
