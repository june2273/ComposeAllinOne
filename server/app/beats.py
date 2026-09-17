"""비트·다운비트 — Beat This!(Foscarin, Schlüter, Widmer, ISMIR 2024) 래퍼.

**이 저장소의 템포·박자는 전부 여기서 나온다.** 2026-09-12에 브라우저의 자기상관
경로(`estimateTempo`·`trackBeats`·`resolveOctave`)를 통째로 지우고 이걸로 갈아탔다.

## 왜 갈아탔는가

템포 배수 오류를 규칙으로 고치려는 시도가 **여덟 번** 죽었다
(`docs/템포_배수오류_미해결.md`). 마지막 H8이 결정적이었다 — prior 없는 madmom DBN에
우리 ODF를 먹여도 곡D가 166.6이라, **판정 규칙이 아니라 곡선이 이미 그렇게
생긴 것**이었다. 자기상관은 배수에 대해 자기닮음이라(지연 T에 봉우리가 서면 2T와
T/2에도 선다) 그 층에서는 원리적으로 못 가른다.

**정답 14곡에서 14/14다**(우리 11/14 · allin1 10/14). 박자도 14/14. 전사도 여섯 곡
전부에서 좋아진다(정확 841 → 1345음, 유령 649 → 361). 곡당 2~4초.

## 왜 문맥이 열쇠인가 (실측 2026-09-12)

문맥을 2초로 좁히면 **Beat This!도 곡D를 167.9로 낸다** — 우리와 같은 실패다.
5초에서 84.3, 10초부터 안정된다. 이기는 이유는 "학습된 모델이라서"가 아니라
**한 번에 30초(1500프레임)를 보기 때문**이고, 84BPM에서 2초는 2.8박이라 한 마디도
안 된다. `beat_this`의 `split_predict_aggregate(chunk_size=1500)`가 그 값이다.

## 신호만 내보낸다

`structure.py`·`melody.py`와 같은 규칙이다 — 여기서 나가는 것은 비트 시각과
다운비트뿐이고, 그것을 격자로 만들고 마디 번호를 붙이는 **음악적 판단은 웹의
`core/analysis`·`core/transcribe`가 한다.**

**단 하나 예외가 `fill_dropped_beats`다.** 그건 음악적 판단이 아니라 모델의 알려진
결함을 그 자리에서 메우는 것이고, 웹으로 넘기면 두 벌이 되기 쉬워서 여기 둔다
(아래 주석 참조).
"""

from __future__ import annotations

import json
import statistics
from collections import Counter
from pathlib import Path
from typing import Callable

#: `beats.json`에 적히는 엔진 이름. 캐시 무효화가 이걸 본다.
#: **모델 이름만이 아니라 후처리 구성까지 바뀌면 함께 바꿀 것** — `melody.ENGINE`이
#: `"rmvpe+mask+oct2cfp+hi69"`인 것과 같은 이유다. `fill`은 빠진 비트 채우기를 뜻하고,
#: 그걸 끄거나 규칙을 바꾸면 격자가 달라지므로 캐시가 무효가 되어야 한다.
ENGINE = "beatthis-final0+fill"

#: 가중치 이름. `final0`은 GTZAN을 뺀 18개 데이터셋 4,556곡으로 학습한 seed 0
#: 모델이고 논문의 기본값이다. **우리 평가셋(J-pop·보컬로이드)이 그 안에 들어갈
#: 자리는 없어 보이지만 곡 목록을 대조해 확인한 것은 아니다.**
MODEL = "final0"

#: **CPU로 고정한다.** 이 저장소는 "장치 자동 선택을 믿지 말 것"을 비싸게 배웠다
#: (`melody._DEVICE` — onnxruntime이 CoreML을 고르면 **긴 곡에서만** 죽어서 1초짜리
#: 자가진단을 통과하고 첫 실곡에서 터졌다). 곡당 2~4초라 값을 치를 이유가 없다.
_DEVICE = "cpu"

#: **환경 스위치를 두지 않는다.** `structure`는 `SIDECAR_STRUCTURE`로 끌 수 있지만
#: (느려서 기본 꺼짐) 이건 **템포·박자의 유일한 출처**라 끄면 앱이 아무것도 못 한다.
#: 끌 수 있게 만들면 "꺼진 채로 왜 BPM이 안 나오지"를 누군가 반드시 겪는다.

Progress = Callable[[str, float], None]


def available() -> bool:
    """Beat This!를 부를 수 있는가. **import를 시도하지 않고** 확인한다.

    import하면 torch가 딸려 올라와 수 초가 걸린다 — `/health`가 그 사이 굳는다.
    """
    from importlib.util import find_spec

    return find_spec("beat_this") is not None


def device() -> str:
    return _DEVICE


def selftest() -> None:
    """이 환경에서 도는가. 실패하면 그대로 던진다.

    **`File2Beats`를 만들지 않는다.** 생성자가 체크포인트 77MB를 내려받으므로,
    서버를 띄웠을 뿐인 사용자에게 그런 일이 조용히 일어나면 안 된다 —
    `stems.selftest`가 htdemucs에, `melody.selftest`가 RMVPE 가중치에 대해
    지키는 규칙과 같다.

    그래서 이 자가진단이 잡는 것은 "import가 되는가"까지다. `melody` 쪽이 1초짜리
    사인파로 추론을 실제로 돌리는 것과 갈리는데, **거기는 가중치가 이미 있을 때만
    그렇게 한다.** 여기도 가중치가 캐시에 있으면 돌려 볼 수 있지만 그러면
    자가진단 결과가 캐시 상태에 따라 달라져 재현되지 않는다.
    """
    import beat_this.inference  # noqa: F401


def refine_period(beats: list[float]) -> float:
    """비트열 → 주기(초). **BPM은 추정값이 아니라 잡힌 비트에서 되뽑는다.**

    비트열이 1차 자료고 BPM은 그 요약이다(사양서 §1.3). 중앙값을 쓰면 치우치므로
    세 단계를 거친다.

    1. 중앙값에서 20% 넘게 벗어난 간격을 뺀다 — 놓친 비트가 만든 두 배 간격
    2. 남은 것의 **평균**을 쓴다 — 프레임 격자 양자화 오차가 상쇄된다
    3. 전체 길이를 그 평균이 말하는 주기 수로 나눈다 — 오차가 양 끝에만 남는다

    > **이 함수는 원래 `tempo.ts`의 `refinePeriod`였다.** 비트가 사이드카에서
    > 오게 되면서 이쪽으로 왔다. 평가 하니스(`scripts/beatthis_bpm.py`)도 여기서
    > import한다 — 두 벌이 되면 하니스와 앱이 다른 BPM을 낸다.
    """
    gaps = [b - a for a, b in zip(beats, beats[1:])]
    if not gaps:
        return 0.0
    median = statistics.median(gaps)
    if median <= 0:
        return 0.0
    inliers = [g for g in gaps if abs(g / median - 1) < 0.2]
    if not inliers:
        return median
    mean = sum(inliers) / len(inliers)

    span = beats[-1] - beats[0]
    periods = round(span / mean)
    if periods < 1:
        return mean
    refined = span / periods
    # 크게 어긋나면(변속이거나 추적 실패) 평균으로 물러난다
    return refined if abs(refined / mean - 1) < 0.2 else mean


#: 빠진 비트를 채울 때 간격이 주기의 정수배에 이만큼 안에 들어야 한다.
#: 느슨하게 잡으면 진짜 쉼(간주·브레이크)에 없던 비트를 그린다.
_FILL_TOLERANCE = 0.12

#: 이보다 많이 빠진 자리는 안 채운다. 연속 4박을 통째로 놓쳤다면 그건 놓친 것이
#: 아니라 **소리가 없는 것**일 가능성이 높다.
_FILL_MAX = 4


def fill_dropped_beats(beats: list[float]) -> list[float]:
    """**빠진 비트를 채운다.** 간격이 주기의 정수배면 그만큼 놓친 것이다.

    Beat This!는 한 곡 안에서 **절반 템포로 미끄러지는 구간**을 만든다. 이 모델의
    알려진 결함이고 — masked diffusion 논문(arXiv 2608.04624)이 "곡당 배증·반감
    0.75건"으로 정량화하고 바로 그것을 고치려고 쓰였다 — 우리 평가셋에서도 실제로
    났다: **곡A의 149.0~178.2초 29초 구간이 통째로 절반이다**(간격 0.34 → 0.70초).

    **BPM 지표로는 안 잡힌다.** 그 곡의 BPM은 173.0으로 맞게 나온다 —
    `refine_period`의 20% 거르기가 그 45개 간격을 버리기 때문이다. 격자만 깨져
    있어서 전사가 나빠진다(실측: 정확 149 → 113, 채우면 157).

    **템포를 새로 주장하지 않는다.** 주기는 `refine_period`가 이미 낸 값 그대로다 —
    BPM이 거기서 나오므로 격자와 BPM이 갈릴 자리가 없다. 정수배에 안 맞는 간격은
    손대지 않는데, 그것이 **진짜 쉼과 놓친 비트를 가르는 유일한 조건**이다.

    실측(정답 14곡): 안쪽 간격이 곡A 93 → **100%**, 곡B 44 → **85%**,
    곡B(커버2) 53 → **80%**, 곡H 84 → **95%**. **이미 완전한 격자는
    한 개도 안 건드린다**(곡D·곡E·곡C·곡N이 채움 0). BPM은
    14/14 그대로다.

    > **국소 주기로 재려다 한 번 틀렸다.** 창 안 "짧은 쪽 절반"의 중앙값을 주기로
    > 썼더니 주기가 짧게 잡혀 **과채움**이 났다 — 곡B의 안쪽 간격이 44%에서
    > **30%로 오히려 내려갔다.** 전역 주기가 단순하고, 무엇보다 14곡에서 이미
    > 검증된 값이다.
    """
    if len(beats) < 3:
        return list(beats)
    period = refine_period(beats)
    if period <= 0:
        return list(beats)
    out = [beats[0]]
    for start, end in zip(beats, beats[1:]):
        gap = end - start
        k = round(gap / period)
        if 2 <= k <= _FILL_MAX and abs(gap / (k * period) - 1) < _FILL_TOLERANCE:
            for j in range(1, k):
                out.append(start + gap * j / k)
        out.append(end)
    return out


def beats_per_bar(beats: list[float], downbeats: list[float]) -> int:
    """다운비트 사이에 비트가 몇 개인가. **최빈값으로 센다.**

    평균을 쓰면 추적이 한 번 미끄러진 마디가 3.5 같은 값을 만들고, 그러면 4/4 곡이
    박자표 없는 곡으로 보인다. 도입부·아웃트로에서 한두 마디가 어긋나는 것은
    흔하므로 최빈값이 맞다.

    **이것이 예전 `meter.ts` 축 B(마디당 박 후보 탐색)를 대신한다.** 실측 14/14이고
    유일한 3/4(곡J)를 3으로 낸다. 축 A(셔플·3분할)는 다운비트가 답하지
    않는 물음이라 `meter.ts`에 그대로 남아 있다.
    """
    if len(downbeats) < 2:
        return 0
    counts: list[int] = []
    for start, end in zip(downbeats, downbeats[1:]):
        # 경계는 반개구간이다 — 다운비트 자신은 그 마디의 첫 박이다
        n = sum(1 for b in beats if start - 1e-6 <= b < end - 1e-6)
        if n:
            counts.append(n)
    if not counts:
        return 0
    # `statistics.mode`는 동점에서 먼저 나온 값을 주는데, 여기서는 **작은 쪽**이
    # 먼저 나올 이유가 없다. 세어서 가장 흔한 것을 명시적으로 고른다.
    return Counter(counts).most_common(1)[0][0]


def analyze(source: Path, progress: Progress | None = None,
            model: str = MODEL) -> dict:
    """오디오 하나에서 비트·다운비트·BPM·마디당 박을 뽑는다.

    **곡 전체를 한 번에 본다** — 진행률을 잘게 보고할 방법이 없다(`File2Beats`가
    블로킹 호출 하나다). 곡당 2~4초라 `structure.analyze`처럼 취소 지점을 촘촘히
    둘 이유가 없고, 앞뒤로 한 번씩만 보고한다.
    """
    from beat_this.inference import File2Beats

    if progress:
        progress("비트 추적", 0.0)
    # **매번 새로 만든다.** 첫 호출에서 체크포인트를 내려받아 torch hub 캐시에
    # 넣고 그 뒤로는 디스크에서 읽으므로, 모듈 수준에 들고 있어 import 시점에
    # 무거워지는 것보다 낫다.
    raw_beats, raw_downbeats = File2Beats(
        checkpoint_path=model, device=_DEVICE, dbn=False
    )(source)

    beats = fill_dropped_beats([float(t) for t in raw_beats])
    downbeats = [float(t) for t in raw_downbeats]
    period = refine_period(beats)

    if progress:
        progress("비트 추적", 1.0)

    return {
        "engine": ENGINE,
        "bpm": round(60.0 / period, 2) if period > 0 else 0.0,
        "beatsPerBar": beats_per_bar(beats, downbeats),
        "beats": [round(t, 4) for t in beats],
        "downbeats": [round(t, 4) for t in downbeats],
    }


def write(result: dict, out_dir: Path) -> Path:
    path = out_dir / "beats.json"
    path.write_text(json.dumps(result), encoding="utf-8")
    return path


def read(out_dir: Path) -> dict | None:
    """캐시된 격자. **엔진이 다르면 없는 것으로 친다.**

    무효화가 이 파일 하나 안에서 끝나는 것이 요점이다 — `meta.json`·`_cache_hit`에
    손대면 스템·f0 캐시를 깰 위험만 지고 얻는 것이 없다(수 분 대 2~4초).
    """
    path = out_dir / "beats.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if data.get("engine") == ENGINE else None
