/**
 * 정답 BPM·박자 대조 — **파이프라인이 실제로 내는 값을 잰다.**
 *
 * 2026-09-12에 통째로 다시 썼다. 예전 판은 자기상관 경로의 진단(반박 세기 ·
 * 2배 후보 무게 · `effect(8)/effect(4)` · 절반으로 갈아탔을 때의 값)을 잔뜩
 * 찍었는데, **그 경로가 사라졌으므로 그 숫자들도 뜻이 없다.** 죽은 가설의
 * 기록은 `docs/템포_배수오류_미해결.md`에 남아 있다.
 *
 * 여기서 재는 것은 둘뿐이다: **BPM이 정답의 몇 배인가**, **박자가 맞는가.**
 *
 * ## 두 곳을 함께 본다
 *
 * `beatthis_bpm.py`도 BPM을 재는데 **그건 사이드카 모듈만 본다.** 이쪽은
 * `analyzeAudio`를 통과한 값이라 격자 변환·박자 판정·코드까지 얹힌 뒤의
 * 결과다. 둘이 갈리면 사이드카가 아니라 **웹 쪽 결선이 틀린 것**이고, 그
 * 구분이 이 하니스의 값이다.
 *
 * ```bash
 * cd server && .venv/bin/python scripts/beatthis_bpm.py --beats-dir /tmp/btbeats
 * cd web && npx vitest run --config vitest.eval.config.ts tempo
 * ```
 */

import { writeFileSync } from "node:fs";
import { test } from "vitest";

import { ANALYSIS_RATE, analyzeAudio } from "../../src/core/analysis";
import { evalSongs, gridFor, ratioName } from "./truth";
import { loadMono } from "./wav";

const OUT = process.env.EVAL_OUT ?? "/tmp/tempo";

test("정답 있는 곡의 템포와 박자", { timeout: 60 * 60_000 }, () => {
  const rows: Record<string, unknown>[] = [];
  const lines: string[] = [];
  let bpmOk = 0;
  let bpmTotal = 0;
  let barOk = 0;
  let barTotal = 0;

  const header = [
    "  곡".padEnd(26), "정답".padStart(7), "우리".padStart(9), "판정".padStart(7),
    "박자".padStart(7), "고름".padStart(7), "비트".padStart(7),
  ].join("");
  lines.push(header, "-".repeat(header.length));

  for (const song of evalSongs()) {
    const report = analyzeAudio(loadMono(song.audio), gridFor(song.slot), ANALYSIS_RATE);
    const verdict = song.truthBpm === null ? "?" : ratioName(report.tempo.bpm, song.truthBpm);
    if (song.truthBpm !== null) {
      bpmTotal += 1;
      if (verdict === "정확") bpmOk += 1;
    }
    // **박자는 정답이 있는 곡이 BPM보다 많다**(18곡). 따로 센다.
    let bar = "—";
    if (song.truthBar !== null) {
      barTotal += 1;
      const hit = report.meter.beatsPerBar === song.truthBar;
      if (hit) barOk += 1;
      bar = `${report.meter.beatsPerBar}/${song.truthBar}${hit ? "" : " ❌"}`;
    }

    rows.push({
      slot: song.slot,
      name: song.name,
      truthBpm: song.truthBpm,
      bpm: report.tempo.bpm,
      verdict,
      truthBar: song.truthBar,
      beatsPerBar: report.meter.beatsPerBar,
      meterConfidence: report.meter.confidence,
      steadiness: report.tempo.steadiness,
      beats: report.beats.length,
      downbeats: report.downbeats.length,
    });

    lines.push(
      [
        `  ${song.name}`.slice(0, 26).padEnd(26),
        (song.truthBpm ?? 0).toFixed(0).padStart(7),
        report.tempo.bpm.toFixed(1).padStart(9),
        verdict.padStart(7),
        bar.padStart(7),
        report.tempo.steadiness.toFixed(2).padStart(7),
        String(report.beats.length).padStart(7),
      ].join(""),
    );
    console.log(lines[lines.length - 1]);
  }

  lines.push("", `BPM 정확 ${bpmOk}/${bpmTotal}`, `박자 정확 ${barOk}/${barTotal}`);
  console.log(lines.slice(-3).join("\n"));

  writeFileSync(`${OUT}.txt`, lines.join("\n") + "\n");
  writeFileSync(`${OUT}.json`, JSON.stringify(rows, null, 2) + "\n");
});
