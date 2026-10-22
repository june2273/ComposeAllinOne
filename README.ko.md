[English](README.md)

# ComposeAllinOne

팝 음원 하나를 열면 템포·박자·조성, 분리된 스템, 보컬 멜로디(MIDI · MusicXML · Synthesizer V 프로젝트), 드럼 루프와 필인이 나온다.

## 구성

학습된 모델은 로컬 파이썬 사이드카(`server/`)에만 두고, 음악적 판단은 전부 브라우저 쪽 TypeScript 순수 로직(`web/src/core/`)이 한다. 모델을 바꿔도 웹 코드는 그대로다.

- 사이드카: htdemucs(스템), RMVPE 2패스(보컬 f0), Beat This!(비트·다운비트), All-In-One(구간, 기본 꺼짐)
- 웹: 직접 짠 FFT/STFT로 조성·박자, Viterbi 음표 분할, 메트리컬 DP 양자화, MIDI·MusicXML·.svp 내보내기, 드럼 루프·필인

## 결과

정답은 직접 귀로 딴 채보다. 곡 수가 적어서(멜로디 5곡·6판, 템포 14곡) 일반화된 수치로 읽으면 안 된다.

| 바꾼 것 | 전 → 후 |
|---|---|
| 멜로디 모델 basic-pitch → RMVPE (1곡, 정답 783음) | 정확 189 → 515 |
| 반올림 대신 메트리컬 양자화 (139BPM 커버) | 자리 일치 58% → 93% |
| 비트 추적 자기상관 → Beat This! (14곡) | BPM 정답 11/14 → 14/14 |
| 고음 음역 분할 (정답 6판) | 맞은 음표 1621 → 1797 (+10.9%) |

코드 인식은 돌지만 화면에서는 닫아 두었다. 코드 정답이 한 곡도 없어 정확도를 말할 수 없기 때문이다.

## 실행

```bash
cd web && npm install && npm run dev
```

사이드카 설치와 피아노 음원은 [README.md](README.md)의 Run 절을 볼 것. 개발 기록과 설계 결정은 [CLAUDE.md](CLAUDE.md), 미해결 문제는 [docs/](docs/)에 있다.

## 참고

Studied with J. Nam's public course materials: CTP431 / GCT731.

출처·라이선스 전체 목록은 [citation.md](citation.md).
