/**
 * 오프라인 전사 드라이버 — 브라우저 없이 f0 커브를 MIDI까지 끌고 간다.
 *
 * **왜 필요한가.** 지금까지 우리 MIDI를 얻으려면 앱을 띄우고 파일을 열고
 * 내려받아야 했다. 엔진 2종 × 입력 3종 × 곡 여럿을 그렇게 잴 수는 없다.
 * 여기서 하는 일은 `ui/transcription.tsx`가 하는 결선과 **똑같다** —
 * `analyzeAudio` → `transcribe` → `toMidiFiles`. 새 로직은 한 줄도 없고,
 * 그래서 여기서 나온 MIDI는 앱이 내는 것과 같다.
 *
 * 나온 MIDI는 `web/scripts/eval_transcribe.py`가 정답 MIDI와 대조한다.
 *
 * **일부러 `npm test`에서 빼 두었다**(`vitest.eval.config.ts`). 255개 단위
 * 테스트는 몇 초 안에 끝나야 하는데 이건 실곡 수백 MB를 읽는다.
 *
 * ```bash
 * cd web
 * EVAL_F0=/tmp/f0 EVAL_OUT=/tmp/eval npx vitest run --config vitest.eval.config.ts
 * ```
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

import { expect, test } from "vitest";

import {
  ANALYSIS_RATE,
  analyzeAudio,
  extractOnsetCurve,
  type AnalysisReport,
} from "../../src/core/analysis";
import {
  type OnsetCurve,
  toMidiFiles,
  toSvp,
  transcribe,
  type PitchCurve,
} from "../../src/core/transcribe";
import { gridFor } from "./truth";
import { loadMono } from "./wav";

const CACHE = process.env.EVAL_CACHE ?? "../server/cache";
const F0_DIR = process.env.EVAL_F0 ?? "/tmp/f0";
const OUT_DIR = process.env.EVAL_OUT ?? "/tmp/eval";
/**
 * 온셋을 뽑을 스템 파일(슬롯 안의 상대 경로). 비우면 온셋 없이 예전처럼 돈다.
 * 예: `vocal_processed.wav` · `stems/vocals.wav`
 */
const ONSET_FROM = process.env.EVAL_ONSET ?? "";
/** 훑을 문턱들. 온셋 곡선은 한 번만 뽑으므로 값을 늘려도 거의 공짜다 */
const STRENGTHS = (process.env.EVAL_ONSET_STRENGTH ?? "2.0")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((s) => Number.isFinite(s));

/** `<슬롯>-<입력>-<엔진>[-t문턱].json` — `extract_f0.py`가 짓는 이름 */
function slotOf(file: string): string {
  return basename(file).split("-")[0];
}

/** 슬롯 안의 WAV 하나 */
function slotAudio(slot: string, name: string): Float32Array {
  return loadMono(join(CACHE, slot, name));
}

/**
 * 곡 하나의 브라우저측 분석. **슬롯마다 한 번만 한다** — 같은 곡의 커브가
 * 12벌이라도 비트 그리드는 하나다(그리고 이게 이 스크립트에서 제일 느리다).
 */
function analyzeSlot(slot: string): AnalysisReport {
  return analyzeAudio(slotAudio(slot, "input.wav"), gridFor(slot), ANALYSIS_RATE);
}

/**
 * 보컬 스템의 온셋 곡선. **슬롯마다 한 번만** — 문턱을 몇 개 훑든 곡선은 하나다.
 */
function onsetOf(slot: string): OnsetCurve {
  return extractOnsetCurve(slotAudio(slot, ONSET_FROM), ANALYSIS_RATE);
}

test("캐시된 곡의 f0 커브를 전부 MIDI로 굽는다", { timeout: 30 * 60_000 }, () => {
  const files = readdirSync(F0_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
  expect(files.length, `${F0_DIR}에 커브가 없다`).toBeGreaterThan(0);
  mkdirSync(OUT_DIR, { recursive: true });

  const reports = new Map<string, AnalysisReport>();
  const onsets = new Map<string, OnsetCurve>();
  const rows: string[] = [];

  // 온셋을 안 주는 기준선은 늘 굽는다 — 비교 대상이 없으면 숫자를 읽을 수 없다
  const variants: { suffix: string; onset?: number }[] = [{ suffix: "" }];
  if (ONSET_FROM) {
    for (const s of STRENGTHS) variants.push({ suffix: `-on${s}`, onset: s });
  }

  for (const file of files) {
    const slot = slotOf(file);
    let report = reports.get(slot);
    if (!report) {
      report = analyzeSlot(slot);
      reports.set(slot, report);
      rows.push(
        `\n## ${slot} — ${report.tempo.bpm.toFixed(1)}BPM · ` +
          `${report.meter.beatsPerBar}/4 · 조율 ${report.tuningCents.toFixed(1)}센트 · ` +
          `비트 ${report.beats.length}개`,
      );
    }
    if (ONSET_FROM && !onsets.has(slot)) onsets.set(slot, onsetOf(slot));

    const curve = JSON.parse(readFileSync(join(F0_DIR, file), "utf-8")) as PitchCurve;
    const base = basename(file, ".json");

    for (const variant of variants) {
      const name = base + variant.suffix;
      const result = transcribe(
        curve,
        {
          bpm: report.tempo.bpm,
          beats: report.beats,
          downbeats: report.downbeats,
          beatsPerBar: report.meter.beatsPerBar,
          tuningCents: report.tuningCents,
          key: { tonic: report.key.tonic, mode: report.key.mode },
          title: name,
        },
        variant.onset === undefined
          ? {}
          : { onset: onsets.get(slot), onsetStrength: variant.onset },
      );
      const midi = toMidiFiles(result, {
        bpm: report.tempo.bpm,
        beatsPerBar: report.meter.beatsPerBar,
      });
      writeFileSync(join(OUT_DIR, `${name}-performed.mid`), midi.performed);
      writeFileSync(join(OUT_DIR, `${name}-quantized.mid`), midi.quantized);
      // 피치 커브까지 나가야 앱이 내는 것과 같은 산출물이 된다
      const svp = toSvp(result, {
        title: name,
        bpm: report.tempo.bpm,
        key: { tonic: report.key.tonic, mode: report.key.mode },
      });
      writeFileSync(join(OUT_DIR, `${name}.svp`), svp);
      const points = (JSON.parse(svp) as {
        library: { pitchControls: unknown[] }[];
      }).library[0].pitchControls.length;

      rows.push(
        `${name}: 음표 ${result.notes.length} · 격자 ${result.quantized.length} · ` +
          `컨트롤점 ${points} · ` +
          `드리프트 ${result.offsetMs.toFixed(0)}ms · 조율보정 ${result.tuningCents.toFixed(1)}센트`,
      );
      // 진행 상황을 바로 보여 준다 — 곡당 수십 초라 끝까지 침묵하면 멈춘 줄 안다
      console.log(rows[rows.length - 1]);
    }
  }

  writeFileSync(join(OUT_DIR, "summary.txt"), rows.join("\n") + "\n");
});
