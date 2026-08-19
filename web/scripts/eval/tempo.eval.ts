/**
 * 템포 진단 — **배수 오류를 실곡에서 센다.**
 *
 * 지금까지 템포는 정답과 대조된 적이 없다. `pipeline.eval.ts`가 BPM을 산문으로
 * 찍고 `eval_transcribe.py`가 두 값을 나란히 인쇄할 뿐, 비교하는 곳이 없었다.
 * 그런데 배수가 어긋나면 그 아래 지표(`자리 일치` 등)가 통째로 무의미해지므로
 * **먼저 재야 하는 것은 이쪽이다.**
 *
 * MIR 관례로 말하면 `Accuracy 1`(정확) 대 `Accuracy 2`(배수 허용)의 간격이
 * 곧 배수 오류율이다. 그 간격을 표로 낸다.
 *
 * ## effect(4) 대 effect(8)
 *
 * 함께 찍는 두 숫자가 이 하니스의 본론이다. 우리 격자가 두 배 빠르면 진짜
 * 4/4 마디가 **우리 박 8개**가 되는데, 축 B의 후보가 `[4,3,2]`뿐이라 8을
 * 물어볼 수 없어 4/4로 멀쩡하게 나온다. `barEffect(novelty, 8)`이
 * `barEffect(novelty, 4)`를 이기는지가 **"두 배 빠른가"의 직접 증거**이고,
 * 교정 함수를 짜기 전에 그 가설이 실곡에서 성립하는지를 여기서 먼저 본다.
 *
 * ```bash
 * npx vitest run --config vitest.eval.config.ts tempo
 * ```
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

import { ANALYSIS_RATE, analyzeAudio, barEffect, beatNovelty } from "../../src/core/analysis";
import { extractFeatures, normalizeOnset } from "../../src/core/analysis/features";
import { estimateMeter } from "../../src/core/analysis/meter";
import { halfBeatStrength, trackBeats } from "../../src/core/analysis/tempo";
import { evalSongs, ratioName } from "./truth";
import { loadMono } from "./wav";

const OUT = process.env.EVAL_OUT ?? "/tmp/tempo";

test("정답 있는 곡의 템포와 배수 오류", { timeout: 30 * 60_000 }, () => {
  const rows: Record<string, unknown>[] = [];
  const lines: string[] = [
    ["곡".padEnd(22), "정답".padStart(7), "우리".padStart(8), "비율".padStart(7),
      "신뢰".padStart(6), "박자".padStart(6), "정답박".padStart(7),
      "eff4".padStart(7), "eff8".padStart(7)].join(""),
  ];

  for (const { slot, name, audio, truthBpm, truthBar } of evalSongs()) {
    // 4초 결선 신호는 분석이 성립하지 않는다
    const samples = loadMono(audio);
    if (samples.length < ANALYSIS_RATE * 30) continue;
    const report = analyzeAudio(samples, ANALYSIS_RATE);

    // 최종 비트 격자 위에서 마디 증거를 다시 잰다. **`estimateMeter`와 같은
    // 재료여야 한다** — 그쪽은 정규화 안 한 raw onset을 받으므로 여기서도 그렇게.
    const features = extractFeatures(samples, ANALYSIS_RATE);
    const novelty = beatNovelty(
      report.beats, features.fps, features.onset, features.low, features.chroma,
    );
    const eff4 = barEffect(novelty, 4);
    const eff8 = barEffect(novelty, 8);

    // **절반으로 갈아타면 실제로 나아지는가** — 교정 함수가 걸 진짜 게이트다.
    // 화면 뒤에서 한 번 더 추적·판정해 보고 그 결과를 나란히 둔다.
    const onsetN = normalizeOnset(features.onset, features.fps);
    const halved = trackBeats(onsetN, features.fps, report.tempo.bpm / 2);
    const halvedMeter = halved.beats.length >= 8
      ? estimateMeter(halved.beats, features.fps, features.onset, features.low, features.chroma)
      : null;
    const halvedNovelty = halved.beats.length >= 8
      ? beatNovelty(halved.beats, features.fps, features.onset, features.low, features.chroma)
      : null;

    // 자기상관이 ÷2 후보에 준 무게 (최고 후보를 1로 본 상대값)
    const halfCand = report.tempo.candidates.find(
      (c) => Math.abs(c.bpm / (report.tempo.bpm / 2) - 1) < 0.06,
    );

    // **`resolveOctave`가 본 것을 그대로 재현한다.** 자기상관 1위 격자에서
    // 반박이 얼마나 셌고(slow), 2배로 갈아탄 뒤 얼마나 줄었는지(fast).
    // 갈아탈지 말지는 `fast <= slow * OCTAVE_IMPROVE(0.75)` 하나로 정해진다.
    const acfTop = report.tempo.candidates[0]?.bpm ?? 0;
    const atTop = acfTop > 0 ? trackBeats(onsetN, features.fps, acfTop) : null;
    const atDouble = acfTop > 0 ? trackBeats(onsetN, features.fps, acfTop * 2) : null;
    const slowHbs = atTop ? halfBeatStrength(onsetN, features.fps, atTop.beats) : 0;
    const fastHbs = atDouble ? halfBeatStrength(onsetN, features.fps, atDouble.beats) : 0;

    const ratio = truthBpm === null ? "—" : ratioName(report.tempo.bpm, truthBpm);
    rows.push({
      slot, name, truthBpm, truthBar,
      barOk: truthBar === null ? null : report.meter.beatsPerBar === truthBar,
      bpm: report.tempo.bpm,
      ratio,
      confidence: report.tempo.confidence,
      steadiness: report.tempo.steadiness,
      beatsPerBar: report.meter.beatsPerBar,
      meterConfidence: report.meter.confidence,
      beats: report.beats.length,
      effect4: eff4.score,
      effect8: eff8.score,
      effect8Over4: eff8.score / eff4.score,
      halfBeatStrength: halfBeatStrength(onsetN, features.fps, report.beats),
      halfCandWeight: halfCand?.weight ?? 0,
      acfTop,
      octaveFired: acfTop > 0 && Math.abs(acfTop / report.tempo.bpm - 1) > 0.06,
      slowHbs,
      fastHbs,
      hbsDrop: slowHbs > 0 ? fastHbs / slowHbs : 0,
      // 자기상관 1위 격자에서 박자가 무엇으로 나오는가. **2/4면
      // `resolveDupleMeter`가 템포를 두 배로 올린다** — `resolveOctave`와는
      // 다른 경로라 따로 봐야 한다.
      meterAtTop: atTop && atTop.beats.length >= 8
        ? estimateMeter(atTop.beats, features.fps, features.onset, features.low, features.chroma)
            .beatsPerBar
        : 0,
      halvedBpm: halved.bpm,
      halvedBeatsPerBar: halvedMeter?.beatsPerBar ?? 0,
      halvedMeterConfidence: halvedMeter?.confidence ?? 0,
      halvedEffect4: halvedNovelty ? barEffect(halvedNovelty, 4).score : 0,
      halvedSteadiness: halved.steadiness,
      candidates: report.tempo.candidates.map((c) => ({ bpm: c.bpm, weight: c.weight, p: c.probability })),
    });

    lines.push(
      [
        name.padEnd(22),
        (truthBpm === null ? "?" : truthBpm.toFixed(1)).padStart(7),
        report.tempo.bpm.toFixed(1).padStart(8),
        ratio.padStart(7),
        report.tempo.confidence.toFixed(2).padStart(6),
        `${report.meter.beatsPerBar}/4`.padStart(6),
        (truthBar === null
          ? "?"
          : `${truthBar}/4${report.meter.beatsPerBar === truthBar ? "" : " ✗"}`).padStart(7),
        eff4.score.toFixed(3).padStart(7),
        eff8.score.toFixed(3).padStart(7),
      ].join(""),
    );
  }

  const scored = rows.filter((r) => r.truthBpm !== null);
  const exact = scored.filter((r) => r.ratio === "정확").length;
  const octave = scored.filter((r) => r.ratio === "×2" || r.ratio === "÷2").length;
  const barScored = rows.filter((r) => r.truthBar !== null);
  const barOk = barScored.filter((r) => r.barOk).length;
  lines.push(
    "",
    `템포 정확 ${exact}/${scored.length} · 배수 오류 ${octave} · 나머지 ${scored.length - exact - octave}`,
    `박자 정확 ${barOk}/${barScored.length}`,
    "",
    "eff8/eff4 > 1 이면 '마디가 우리 박 8개' = 템포가 두 배 빠르다는 증거다.",
  );

  writeFileSync(join(OUT + ".txt"), lines.join("\n") + "\n");
  writeFileSync(join(OUT + ".json"), JSON.stringify(rows, null, 2) + "\n");
});
