/**
 * 비트 격자를 읽는 순수 함수들. **격자를 만들지는 않는다 — 밖에서 받는다.**
 *
 * 2026-09-12에 `tempo.ts`(자기상관 + 로그정규 prior + Ellis DP)를 통째로 지우고
 * 비트를 사이드카의 Beat This!에서 받게 됐다. 남은 것은 **받은 비트열을 어떻게
 * 읽는가**뿐이다.
 *
 * ## 왜 지웠는가
 *
 * 배수 오류를 규칙으로 고치려는 시도가 여덟 번 죽었다
 * (`docs/템포_배수오류_미해결.md`). 원인은 규칙이 아니라 **자기상관이 배수에
 * 대해 자기닮음**이라는 것이다 — 지연 T에 봉우리가 서면 2T와 T/2에도 선다.
 * 그 위에 무엇을 얹어도 원리적으로 못 가른다. H8이 그것을 확정했다: prior 없는
 * madmom DBN에 우리 ODF를 먹여도 같은 오답이었다.
 *
 * 정답 14곡에서 우리 11/14 → Beat This! **14/14**, 박자도 14/14, 전사는 여섯 곡
 * 전부에서 좋아졌다(정확 841 → 1345음).
 *
 * ## 여기 남은 것과 간 곳
 *
 * | | 어디로 |
 * |---|---|
 * | `refinePeriod`(비트열 → BPM) | **`server/app/beats.py`로 갔다** — BPM을 사이드카가 함께 낸다 |
 * | `estimateTempo`·`trackBeats`·`resolveOctave`·`halfBeatStrength` | 삭제 |
 * | `relatedTempo` | **여기 남는다** — 평가 하니스 다섯이 매달려 있고 후보 가족도 이 정의를 쓴다 |
 * | `MAX_BPM`·`TempoCandidate` | 여기 남는다 |
 */

/** 사람이 템포로 들을 수 있는 상한. 후보 가족을 자를 때 쓴다 */
export const MAX_BPM = 210;

/** 그 하한. 위와 짝이다 */
export const MIN_BPM = 50;

export interface TempoCandidate {
  readonly bpm: number;
  /** 화면의 막대 길이. 후보 가족에서는 균등하게 나눈 값이다(아래 주석) */
  readonly probability: number;
}

/**
 * 두 템포가 정수배(또는 3:2)로 얽혀 있는가 — 같은 그리드의 다른 해석이다.
 *
 * **1을 빼먹지 말 것.** 자기 자신도 "같은 그리드"다. 예전에 빠뜨렸다가 신뢰도
 * 계산이 최고 후보 자신을 경쟁자로 집어 늘 0이 된 적이 있다(실측으로 잡았다).
 *
 * **평가 하니스 다섯이 이 함수에 매달려 있다** — `scripts/eval/truth.ts`의
 * `ratioName`이 쓰고, 거기서 drums·tatum·tempo·odf-dump·stems가 import한다.
 * 지우면 템포와 무관한 하니스까지 import 시점에 죽는다.
 */
export function relatedTempo(a: number, b: number, tolerance = 0.04): boolean {
  const ratio = a / b;
  return [1, 0.5, 2, 1 / 3, 3, 2 / 3, 1.5, 0.25, 4].some(
    (r) => Math.abs(ratio / r - 1) < tolerance,
  );
}

/**
 * 사람이 고칠 수 있는 배수들. **후보가 "자기상관 봉우리"에서 "배수 가족"으로 바뀌었다.**
 *
 * 예전 후보 목록은 자기상관이 실제로 본 봉우리라 확률에 뜻이 있었다. 지금은
 * 모델이 답 하나를 주므로 그런 분포가 없다 — 대신 **모델이 틀렸다면 거의
 * 반드시 배수로 틀린다**는 사실을 그대로 화면에 낸다(MIREX가 `Accuracy 2`를
 * 따로 두는 이유이기도 하다).
 *
 * **확률을 균등하게 주지 않는다.** 고른 답에 몰아주고 나머지를 나눈다 — 막대가
 * 다 같으면 "모델이 뭘 골랐는지"가 안 보이고, 그게 이 그래프의 유일한 요점이다.
 */
export function metricalFamily(bpm: number): TempoCandidate[] {
  if (!(bpm > 0)) return [];
  const ratios = [0.5, 1, 2];
  const inRange = ratios
    .map((r) => ({ ratio: r, bpm: bpm * r }))
    .filter((c) => c.bpm >= MIN_BPM && c.bpm <= MAX_BPM);
  // 고른 답 0.6, 나머지가 0.4를 나눈다. 하나뿐이면 1.0
  const others = inRange.length - 1;
  return inRange.map((c) => ({
    bpm: c.bpm,
    probability: c.ratio === 1 ? (others ? 0.6 : 1) : 0.4 / Math.max(1, others),
  }));
}

/**
 * 격자를 배수로 갈아탄다. **다시 분석하지 않는다.**
 *
 * 예전에는 사용자가 BPM을 고르면 워커를 다시 돌려 DP부터 새로 했다(`forceBpm`).
 * 비트를 밖에서 받는 지금은 그럴 이유가 없다 — 절반은 **하나씩 건너뛰고**,
 * 두 배는 **중점을 끼운다.** 왕복이 없어져 화면이 즉시 바뀌고, 몇 분 걸린
 * 스템 분리를 들고 있는 `TranscriptionPanel`을 흔들 일도 없다.
 *
 * **다운비트는 함께 옮긴다.** 안 옮기면 마디선이 비트 사이에 앉아 격자가
 * 통째로 어긋난다. 절반으로 갈 때는 **살아남은 비트 위의 다운비트만** 남긴다 —
 * 사라진 비트를 가리키던 다운비트는 그 마디의 첫 박이 없어진 것이라 뜻이 없다.
 *
 * @param ratio 2면 두 배(비트가 촘촘해진다), 0.5면 절반
 */
export function retimeBeats(
  beats: readonly number[],
  downbeats: readonly number[],
  ratio: number,
): { beats: number[]; downbeats: number[] } {
  if (ratio === 2) {
    const out: number[] = [];
    for (let i = 0; i < beats.length - 1; i += 1) {
      out.push(beats[i], (beats[i] + beats[i + 1]) / 2);
    }
    if (beats.length) out.push(beats[beats.length - 1]);
    // 다운비트는 원래 비트 위에 그대로 있다 — 마디는 그대로고 박만 잘아졌다
    return { beats: out, downbeats: [...downbeats] };
  }
  if (ratio === 0.5) {
    // **위상을 첫 다운비트에 맞춘다.** 그냥 짝수 번째를 집으면 마디 첫 박이
    // 통째로 빠질 수 있다(실측할 것도 없이 절반의 확률이다).
    const anchor = downbeats.length ? beats.indexOf(nearest(beats, downbeats[0])) : 0;
    const keep = beats.filter((_, i) => (i - Math.max(0, anchor)) % 2 === 0);
    const kept = new Set(keep);
    return { beats: keep, downbeats: downbeats.filter((d) => kept.has(nearest(keep, d))) };
  }
  return { beats: [...beats], downbeats: [...downbeats] };
}

/** 가장 가까운 값. 비트열은 정렬돼 있지만 길이가 수백이라 선형으로 충분하다 */
function nearest(values: readonly number[], target: number): number {
  let best = values[0] ?? target;
  for (const v of values) {
    if (Math.abs(v - target) < Math.abs(best - target)) best = v;
  }
  return best;
}

/**
 * 비트열이 말하는 BPM. **사이드카가 이미 준 값이 있으면 그걸 쓴다** — 이 함수는
 * 격자를 갈아탄 뒤처럼 다시 재야 할 때만 부른다.
 *
 * `server/app/beats.py`의 `refine_period`와 **같은 식이다.** 두 벌이 갈리면
 * 사용자가 후보를 눌렀을 때 숫자가 미묘하게 달라진다.
 */
export function bpmOf(beats: readonly number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i += 1) gaps.push(beats[i] - beats[i - 1]);
  if (!gaps.length) return 0;
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return 0;
  const inliers = gaps.filter((g) => Math.abs(g / median - 1) < 0.2);
  if (!inliers.length) return 60 / median;
  const mean = inliers.reduce((a, b) => a + b, 0) / inliers.length;

  const span = beats[beats.length - 1] - beats[0];
  const periods = Math.round(span / mean);
  if (periods < 1) return 60 / mean;
  const refined = span / periods;
  return 60 / (Math.abs(refined / mean - 1) < 0.2 ? refined : mean);
}
