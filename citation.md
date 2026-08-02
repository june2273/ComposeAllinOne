# 외부 소스 출처 기록

이 프로젝트가 사용하는 모든 외부 저작물의 출처·저작자·라이선스와, 그것이
코드 어디에 어떻게 쓰였는지를 남긴다. **외부 소스를 새로 도입하면 반드시 여기에
먼저 추가한다.** [CLAUDE.md](CLAUDE.md)에는 요약만 두고 상세 내용은 이 파일에 적는다.

라이선스 정보는 추측하지 않고 설치된 패키지 메타데이터와 배포처 원문에서 직접
확인한 값이다. 확인 방법과 날짜는 각 항목의 "확인" 줄에 적었다.

최종 갱신: 2026-08-03 (웹 프론트엔드 착수)

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

- [download_assets.py](download_assets.py) — GitHub `main` 브랜치 tarball에서 SFZ·FLAC·LICENSE를
  `assets/UprightPianoKW/`로 내려받는다. 용량이 31MiB라 저장소에 커밋하지 않고
  `.gitignore`로 제외했다.
- [audio.py](audio.py)의 `SampleSynth` — 청음 문제의 소리를 내는 기본 오디오 백엔드.
  FLAC을 `soundfile`로 읽어 요청된 음높이로 리샘플링한 뒤 numpy로 섞어
  `sounddevice`로 재생한다. `fluidsynth`를 쓰지 않고 샘플을 직접 다룬다.
- [sfz.py](sfz.py) — 이 음원의 `.sfz` 매핑 파일을 읽어 건반·벨로시티별 샘플을 찾는다.

**의무 사항**: CC0이므로 **없다.** 저작자 표시 없이 수정·배포·상업적 이용이 모두
가능하다. 위 표기는 의무가 아니라 예의로 남긴 것이다.

**실측 특성**: 원본 녹음의 음정이 평균 2~6센트 낮다(A2는 −17센트). 실제 어쿠스틱
업라이트라 정상 범위이며 상대음감·화성 훈련에는 무해하다. 절대음고를 센트 단위로
다루는 기능에는 `SineSynth`가 더 정확하다.

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

## 2. 파이썬 라이브러리

모두 `.venv`에 설치되어 있다. 라이선스는 설치된 배포판의
`importlib.metadata`(License / License-Expression / Classifier 필드)에서 직접 읽었다.
확인일: 2026-08-02.

### 직접 의존성

| 패키지 | 버전 | 라이선스 | 저작자 | 활용처 |
|---|---|---|---|---|
| [mido](https://github.com/mido/mido) | 1.3.3 | MIT | Ole Martin Bjørndalen | [midi_input.py](midi_input.py) — MIDI 포트 열거·열기, 콜백 등록, 메시지 파싱 |
| [python-rtmidi](https://github.com/SpotlightKid/python-rtmidi) | 1.5.8 | MIT | Christopher Arndt (2012–2023) | mido의 백엔드. macOS CoreMIDI로 실시간 입력을 받는다 |
| [sounddevice](https://github.com/spatialaudio/python-sounddevice) | 0.5.5 | MIT | Matthias Geier (2015–2025) | [audio.py](audio.py) — 렌더된 numpy 파형을 `sd.play()`로 출력 |
| [numpy](https://numpy.org/) | 2.4.6 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | Travis E. Oliphant 외 | [audio.py](audio.py) — 파형 합성, 리샘플링(선형 보간), FFT 저역통과, 믹싱 |
| [PySide6](https://www.qt.io/qt-for-python) | 6.11.1 | **LGPL-3.0-only OR GPL-2.0-only OR GPL-3.0-only** | The Qt Company / Qt for Python Team | [main.py](main.py) — 전체 GUI, 타이머, 스레드 간 시그널 |
| [soundfile](https://github.com/bastibe/python-soundfile) | 0.14.0 | BSD-3-Clause | Bastian Bechtold | [audio.py](audio.py) — 피아노 샘플 FLAC 디코딩 |
| [verovio](https://www.verovio.org) | 6.2.1 | **LGPL-3.0** | RISM Digital Switzerland | [score.py](score.py) — MusicXML → SVG 악보. 음정 문제의 오선지를 그린다 |

**verovio 확인 경로**: `verovio-6.2.1.dist-info/METADATA`의 `License: LGPLv3` 및
`Classifier: License :: OSI Approved :: GNU Lesser General Public License v3`.
라이선스 원문 두 개(`COPYING` = GPLv3, `COPYING.LESSER` = LGPLv3)가
`dist-info/licenses/`에 동봉되어 있다. 확인일 2026-08-02.

**verovio가 동봉한 악보 폰트 — 배포 전 확인 필요**

verovio 휠은 SMuFL 악보 폰트 5종(`Bravura`, `Gootville`, `Leipzig`, `Leland`,
`Petaluma`)을 `verovio/data/` 아래에 함께 담고 있다. 기본값은 **Leipzig**이고,
이 프로젝트는 기본값을 그대로 쓴다.

이게 중요한 이유: **verovio의 SVG 출력에는 폰트 글리프의 외곽선이 `<path>`
데이터로 그대로 박혀 나간다.** 즉 악보를 그릴 때마다 우리 출력물이 그 폰트의
글자 모양을 포함하게 된다. 앱을 배포하면 폰트도 함께 배포되는 셈이다.

**이 5종의 라이선스 파일은 휠 안에 들어 있지 않다**(`dist-info/licenses/`에는
verovio 본체의 GPL/LGPL 원문만 있다). 추측하지 않고 비워 둔다. 배포를 결정하면
verovio 저장소의 `fonts/` 디렉터리에서 각 폰트의 라이선스를 직접 확인할 것:
https://github.com/rism-digital/verovio/tree/develop/fonts

### 웹 프론트엔드 (`web/`)

Python 앱을 웹으로 옮기면서 새로 도입한 것들. 라이선스는 각 패키지의
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

### 전이 의존성 (직접 호출하지 않음)

| 패키지 | 버전 | 라이선스 | 저작자 | 비고 |
|---|---|---|---|---|
| shiboken6 | 6.11.1 | LGPL-3.0-only OR GPL-2.0-only OR GPL-3.0-only | Qt for Python Team | PySide6의 바인딩 생성기 런타임 |
| cffi | 2.1.0 | MIT-0 | Armin Rigo, Maciej Fijalkowski | soundfile이 libsndfile을 호출하는 데 사용 |
| pycparser | 3.0 | BSD-3-Clause | Eli Bendersky | cffi 의존 |
| packaging | 26.2 | Apache-2.0 OR BSD-2-Clause | Donald Stufft 외 | 빌드 유틸 |

### 휠에 포함된 네이티브 라이브러리

파이썬 패키지 안에 바이너리로 동봉되어 함께 배포되는 C 라이브러리다. **배포 시
라이선스 검토가 필요한 대상이므로 별도로 적어 둔다.**

| 라이브러리 | 버전 | 라이선스 | 원저작자 | 포함 경로 |
|---|---|---|---|---|
| [libsndfile](https://libsndfile.github.io/libsndfile/) | 1.2.2 | **LGPL-2.1** | Erik de Castro Lopo | `_soundfile_data/libsndfile_arm64.dylib` (라이선스 원문: `_soundfile_data/COPYING`) |
| [PortAudio](https://www.portaudio.com/) | (휠 동봉) | MIT | Ross Bencina, Phil Burk | `_sounddevice_data/portaudio-binaries/libportaudio.dylib` |
| [RtMidi](https://github.com/thestk/rtmidi) | (휠 동봉) | MIT 계열 | Gary P. Scavone | python-rtmidi 확장 모듈에 정적 링크 |

**배포 시 주의**: 카피레프트 계열이 셋이다 — **PySide6(LGPLv3), verovio(LGPLv3),
libsndfile(LGPL-2.1)**. 개인 사용에는 문제가 없으나, 앱을 배포한다면 셋 모두
**동적 링크 유지와 라이선스 고지** 조건을 확인해야 한다. 나머지(MIT/BSD)는
고지만 하면 된다. 여기에 더해 **verovio가 동봉한 악보 폰트의 라이선스**가
아직 미확인이다(위 참조). 이 지적은 설계 문서 1절의 라이선스 항목과 같은
맥락이며, 문서가 예상한 것보다 항목이 늘었다.

---

## 3. 참고한 문서·웹 자료

코드나 데이터를 가져오지 않았고, 사실 확인·의사결정 근거로만 참조한 것들이다.

| 자료 | 발행처 | 참조 시점 | 무엇에 썼는지 |
|---|---|---|---|
| [FreePats — Acoustic Grand Piano](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html) | FreePats 프로젝트 | 2026-08-02 | 피아노 음원 후보들의 라이선스·용량·포맷 비교. Upright Piano KW 선정 근거 |
| [freepats/upright-piano-KW](https://github.com/freepats/upright-piano-KW) | FreePats | 2026-08-02 | CC0 라이선스 확인, 저장소 구조 파악, 다운로드 경로 결정 |
| [MuseScore Handbook — SoundFonts and SFZ files](https://musescore.org/en/handbook/2/soundfonts-and-sfz-files) | MuseScore | 2026-08-02 | MuseScore_General의 MIT 라이선스 확인 (대안 검토) |
| [GeneralUser GS](https://www.schristiancollins.com/generaluser.php) | S. Christian Collins | 2026-08-02 | 라이선스 조건 및 샘플 출처 불확실성 확인 → 미채택 근거 |
| SFZ 포맷 | — | 2026-08-02 | [sfz.py](sfz.py) 작성 시 opcode 의미 파악. 규격 문서를 인용하거나 코드를 가져오지 않았고, 이 음원의 `.sfz` 파일에 실제로 등장하는 opcode만 구현했다 |
| [MusicXML 4.0](https://www.w3.org/2021/06/musicxml40/) | W3C Music Notation CG | 2026-08-02 | [score.py](score.py)가 만드는 악보 XML의 요소 이름(`score-partwise`·`note`·`chord`·`accidental` 등) 확인. 규격 문서를 인용하거나 코드·스키마를 가져오지 않았고, 두 음짜리 한 마디에 필요한 최소 요소만 직접 작성했다 |
| [SMuFL](https://www.smufl.org) | Steinberg / W3C Music Notation CG | 2026-08-02 | verovio가 쓰는 악보 폰트 규격. 우리가 직접 구현하지 않았고, verovio 출력 SVG를 후처리할 때 배경 지식으로만 참조했다 |

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
[theory.py](theory.py)에 40줄로 직접 구현했다. 로마자 분석·화음 스펠링이
필요해지는 Phase 3에서 다시 판단한다.
