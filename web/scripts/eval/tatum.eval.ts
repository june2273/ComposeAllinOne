/**
 * Tatum과 밀도 — **배수를 가르는 것이 주기성인가 밀도인가.**
 *
 * 두 가설을 한 표에서 본다.
 *
 * **(A) Klapuri의 tatum 제약.** Klapuri, Eronen & Astola(2006)는 tatum(가장
 * 촘촘한 규칙 펄스) · tactus(박) · measure를 동시에 추정하고 셋의 관계를 사전지식으로
 * 묶는다. 거기서 제약 하나만 빌리면 — **"박은 tatum의 2~4배"** — 배수 오류가
 * 걸릴 수 있다. 우리가 두 배 빠르게 잡으면 박/tatum이 반으로 줄기 때문이다.
 *
 * **(B) 밀도.** 우리 로그정규 prior는 **곡을 보지 않는다.** 성긴 발라드든 빽빽한
 * 록이든 "120이 그럴듯하다"고 똑같이 말한다. 그런데 우리 오류 둘은 정확히
 * 반대편에 있다(곡D는 느려야 하고 곡B는 빨라야 한다) — **어떤 prior 중심도
 * 둘을 동시에 못 고친다는 것은 이미 계산으로 확인했다.** 사람이 가르는 단서가
 * 밀도라면, 밀도를 재서 prior를 곡에 반응하게 만들 수 있다.
 *
 * ## 읽는 법
 *
 * - (A)가 통하려면: **틀린 답의 박/tatum이 2~4 밖으로 나가야** 한다
 * - (B)가 통하려면: **밀도와 정답 BPM 사이에 단조 관계**가 있어야 한다
 *
 * ## 왜 `onsetPeaks`로 tatum을 안 재는가
 *
 * 기존 봉우리 고르기는 **불응기가 80ms**다(`notes.ts`). 185BPM의 16분음표가
 * 정확히 81ms라 **tatum 간격의 온셋을 스스로 지운다.** 그래서 자기상관을 짧은
 * 지연까지 내려서 본다 — `estimateTempo`와 같은 기계이고 탐색 구간만 다르다.
 * **prior는 걸지 않는다** — "박이 120에 가깝다"는 지식은 tatum에 뜻이 없다.
 *
 * ```bash
 * npx vitest run --config vitest.eval.config.ts tatum
 * ```
 */

import { writeFileSync } from "node:fs";
import { test } from "vitest";

import { analyzeAudio } from "../../src/core/analysis";
import { ANALYSIS_RATE, extractFeatures, normalizeOnset } from "../../src/core/analysis/features";
import { evalSongs, ratioName, gridFor} from "./truth";
import { loadMono } from "./wav";

const OUT = process.env.EVAL_OUT ?? "/tmp/tatum";

/** tatum이 들 수 있는 구간(ms). 200BPM의 32분음표 ~ 60BPM의 8분음표 */
const MIN_TATUM_MS = 40;
const MAX_TATUM_MS = 500;
/** 이 세기는 넘어야 "규칙 펄스가 있다"로 본다 (최고 봉우리를 1로 본 상대값) */
const TATUM_STRONG = 0.25;

interface Peak {
  ms: number;
  score: number;
}

/** 짧은 지연의 자기상관 봉우리들. prior 없음 */
function shortLagPeaks(onset: Float32Array, fps: number): Peak[] {
  const n = onset.length;
  const minLag = Math.max(2, Math.round((MIN_TATUM_MS / 1000) * fps));
  const maxLag = Math.min(n - 1, Math.round((MAX_TATUM_MS / 1000) * fps));
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += onset[i];
  mean /= n;

  const score = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < n; i += 1) sum += (onset[i] - mean) * (onset[i + lag] - mean);
    score[lag] = Math.max(0, sum / (n - lag));
  }
  const peaks: Peak[] = [];
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    if (score[lag] <= score[lag - 1] || score[lag] < score[lag + 1]) continue;
    const denom = score[lag - 1] - 2 * score[lag] + score[lag + 1];
    const delta = denom === 0 ? 0 : (0.5 * (score[lag - 1] - score[lag + 1])) / denom;
    peaks.push({ ms: ((lag + delta) / fps) * 1000, score: score[lag] });
  }
  const top = Math.max(...peaks.map((p) => p.score), 1e-12);
  return peaks
    .map((p) => ({ ms: p.ms, score: p.score / top }))
    .sort((a, b) => b.score - a.score);
}

/** 박 주기가 tatum의 몇 배인가 */
function multipleOf(beatMs: number, tatumMs: number): number {
  return tatumMs > 0 ? beatMs / tatumMs : 0;
}

test("tatum 비율과 밀도", { timeout: 60 * 60_000 }, () => {
  const rows: Record<string, unknown>[] = [];

  for (const song of evalSongs()) {
    if (song.truthBpm === null) continue;
    const samples = loadMono(song.audio);
    // **최종 BPM은 파이프라인 그대로 받는다** — resolveOctave·resolveDupleMeter가
    // 이미 손본 값이어야 "우리가 실제로 내는 답"과 대조가 된다
    const report = analyzeAudio(samples, gridFor(song.slot), ANALYSIS_RATE);
    const ourBpm = report.tempo.bpm;

    const features = extractFeatures(samples, ANALYSIS_RATE);
    const onset = normalizeOnset(features.onset, features.fps);
    const peaks = shortLagPeaks(onset, features.fps);
    // tatum = 규칙 펄스가 서는 **가장 짧은** 주기
    const tatum = [...peaks].filter((p) => p.score >= TATUM_STRONG).sort((a, b) => a.ms - b.ms)[0]?.ms ?? 0;

    // 밀도 — 세 가지를 함께 본다. 어느 것이 통하는지는 표를 보고 정한다
    let sum = 0;
    let above = 0;
    for (let i = 0; i < onset.length; i += 1) {
      sum += onset[i];
      if (onset[i] > 1) above += 1;
    }
    const meanOdf = sum / onset.length;
    // ODF가 RMS를 넘는 프레임의 비율 = "소리가 자주 새로 나는가"
    const busyRatio = above / onset.length;

    rows.push({
      name: song.name, truthBpm: song.truthBpm, ourBpm,
      verdict: ratioName(ourBpm, song.truthBpm),
      tatumMs: tatum,
      ourMult: multipleOf(60000 / ourBpm, tatum),
      truthMult: multipleOf(60000 / song.truthBpm, tatum),
      meanOdf, busyRatio,
      peaks: peaks.slice(0, 6).map((p) => ({ ms: Number(p.ms.toFixed(0)), s: Number(p.score.toFixed(2)) })),
    });
  }

  writeFileSync(`${OUT}.json`, JSON.stringify(rows, null, 2) + "\n");
});
