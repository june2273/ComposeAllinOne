# 외부 소스 출처 기록

이 프로젝트가 사용하는 모든 외부 저작물의 출처·저작자·라이선스와, 그것이
코드 어디에 어떻게 쓰였는지를 남긴다. **외부 소스를 새로 도입하면 반드시 여기에
먼저 추가한다.** [CLAUDE.md](CLAUDE.md)에는 요약만 두고 상세 내용은 이 파일에 적는다.

라이선스 정보는 추측하지 않고 설치된 패키지 메타데이터와 배포처 원문에서 직접
확인한 값이다. 확인 방법과 날짜는 각 항목의 "확인" 줄에 적었다.

최종 갱신: 2026-08-03 (분석 콘솔 — BPM·박자·조성 알고리즘 출처 추가)

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

라이선스는 설치된 배포판의 `importlib.metadata`에서 직접 읽었다. 확인일 2026-08-02.

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
| [verovio](https://www.verovio.org) (npm) | 6.2 | **LGPL-3.0** | RISM Digital Switzerland | `web/src/core/score.ts` — 악보 |
| [Vitest](https://vitest.dev) | 4.1 | MIT | Vitest 팀 | 테스트 |
| [Testing Library](https://testing-library.com) | — | MIT | Kent C. Dodds 및 기여자 | UI 테스트 |
| [oxlint](https://oxc.rs) | 1.x | MIT | Boshen 및 기여자 | 린트 (Vite 템플릿 기본) |

**verovio npm판은 Python판과 같은 프로젝트·같은 라이선스(LGPL-3.0)이고, 동봉한
SMuFL 악보 폰트 5종의 라이선스가 미확인인 것도 동일하다.** 위 verovio 항목의
주의사항이 그대로 적용된다.

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

## 3-1. 오디오 분석 알고리즘 (논문·강의 — 코드 미사용)

`web/src/core/analysis/`(BPM·박자·조성)는 **라이브러리를 하나도 쓰지 않는다.**
FFT까지 직접 짰다. 따라서 여기에 걸리는 라이선스는 없지만, **알고리즘의
출처는 남긴다** — 이 프로젝트의 기록 규칙이 "코드 조각"까지 포함하기 때문이고,
나중에 파라미터를 다시 맞출 때 원문을 찾아가야 하기 때문이다.

아래 어느 항목에서도 **코드·의사코드·그림을 옮기지 않았다.** 논문과 강의가
서술한 방법을 읽고 TypeScript로 새로 구현했다.

| 알고리즘 | 출처 | 우리 코드 |
|---|---|---|
| SuperFlux 온셋 검출 (로그주파수 필터뱅크 + 주파수축 max-filter + 지연 차분) | Böck & Widmer, "Maximum Filter Vibrato Suppression for Onset Detection", DAFx 2013 | `analysis/features.ts` |
| 자기상관 × 로그정규 템포 prior | Klapuri et al. 계열. 강의 08(음악 정보학, GCT731)이 정리한 형태를 따랐다 | `analysis/tempo.ts` `estimateTempo` |
| 동적 계획법 비트 추적 (`D(t)=onset(t)+max{D(τ)−λ·log²(Δ/T)}`) | Ellis, "Beat Tracking by Dynamic Programming", J. New Music Research 36(1), 2007 | `analysis/tempo.ts` `trackBeats` |
| Krumhansl–Schmuckler 조성 판정 (크로마 × 프로파일 상관) | Krumhansl, *Cognitive Foundations of Musical Pitch*, 1990 (프로파일은 Krumhansl & Kessler 1982) | `analysis/key.ts` |
| Temperley 조성 프로파일 | Temperley, *The Cognition of Basic Musical Structures*, MIT Press 2001 (Kostka-Payne 코퍼스 기반) | `analysis/key.ts` `TEMPERLEY` |
| 크로마 = 옥타브 등가성으로 접기 | 강의 03(음악 정보학) · Bartsch & Wakefield, WASPAA 2001 | `analysis/features.ts` |

**프로파일 숫자 24개는 논문에서 그대로 가져온 값이다.** 알고리즘 서술과 달리
이것은 데이터라 따로 적어 둔다 — 실험으로 얻은 수치이고, MIR 도구(librosa·
Essentia 등)에 널리 재수록되어 사실상 표준 상수로 쓰인다. 출판된 학술 수치를
인용한 것이며 저작물을 복제한 것이 아니라고 보지만, **배포 시점에 다시 확인할
것.**

박자표 판정(축 A·B)에는 출처가 없다. 표준 해법이 없는 영역이라
`rise/PIPELINE_SPEC.md`(이 저장소 밖) §5의 분해 방침만 따르고 판정 규칙과 임계값은 직접
정했다 — 근거 없는 상수라는 뜻이므로 평가셋이 생기면 다시 맞춰야 한다.

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
