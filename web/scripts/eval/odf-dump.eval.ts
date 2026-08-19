/**
 * 우리 ODF를 JSON으로 떨어뜨린다 — **다른 비트 추적기에 먹여 보기 위해서.**
 *
 * 우리 비트 추적은 `Ellis 2007 DP`인데, 그 자리에 madmom의 DBN을 끼워 보면
 * **특징(ODF)은 그대로 두고 추적기만 갈아끼운 비교**가 된다. DBN은 임의의 활성
 * 곡선을 받으므로(`DBNBeatTrackingProcessor(min_bpm, max_bpm, ...)`) 우리 곡선을
 * 그대로 넣을 수 있다.
 *
 * **왜 이 비교가 흥미로운가**: 우리 `estimateTempo`는 자기상관에 **120 중심
 * 로그정규 prior**를 곱하는데, 곡D는 **생 ODF 자기상관이 정답(84)을 1.6%로
 * 맞히고 있었고 그 prior가 뒤집은** 경우다. DBN에는 그 prior가 없다 — 55~215
 * 상태공간 위의 전이 벌점뿐이다.
 *
 * `server/scripts/dbn_beats.py`가 이 JSON을 받아 DBN을 돌린다.
 *
 * ```bash
 * EVAL_ODF_ONLY=곡D npx vitest run --config vitest.eval.config.ts odf-dump
 * ```
 */

import { writeFileSync } from "node:fs";
import { test } from "vitest";

import { ANALYSIS_RATE, extractFeatures, normalizeOnset } from "../../src/core/analysis/features";
import { estimateTempo, trackBeats } from "../../src/core/analysis/tempo";
import { evalSongs } from "./truth";
import { loadMono } from "./wav";

const OUT = process.env.EVAL_OUT ?? "/tmp/odf";
const ONLY = process.env.EVAL_ODF_ONLY ?? "";

test("ODF를 JSON으로", { timeout: 30 * 60_000 }, () => {
  const out: Record<string, unknown>[] = [];
  for (const song of evalSongs()) {
    if (song.truthBpm === null) continue;
    if (ONLY && !song.name.includes(ONLY)) continue;

    const samples = loadMono(song.audio);
    const features = extractFeatures(samples, ANALYSIS_RATE);
    const onset = normalizeOnset(features.onset, features.fps);
    // 우리 답도 함께 실어 보낸다 — 대조 상대가 같은 파일 안에 있어야 한다
    const tempo = estimateTempo(onset, features.fps);
    const track = trackBeats(onset, features.fps, tempo.bpm);

    out.push({
      slot: song.slot,
      name: song.name,
      truthBpm: song.truthBpm,
      fps: features.fps,
      oursBpm: track.bpm > 0 ? track.bpm : tempo.bpm,
      acfTopBpm: tempo.candidates[0]?.bpm ?? 0,
      // **정규화된 곡선을 보낸다.** DBN의 관측 모델은 활성값이 0~1 근처인 것을
      // 기대하므로, 원시 플럭스를 그대로 주면 문턱이 뜻을 잃는다
      onset: [...onset].map((v) => Number(v.toFixed(4))),
    });
  }
  writeFileSync(`${OUT}.json`, JSON.stringify(out) + "\n");
  writeFileSync(
    `${OUT}.txt`,
    out.map((r) => `${r.name} · fps ${r.fps} · 프레임 ${(r.onset as number[]).length}`).join("\n") + "\n",
  );
});
