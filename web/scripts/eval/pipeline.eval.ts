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

import { ANALYSIS_RATE, analyzeAudio, type AnalysisReport } from "../../src/core/analysis";
import { toMidiFiles, transcribe, type PitchCurve } from "../../src/core/transcribe";
import { resample } from "../../src/platform/analyze";
import { decodeWav } from "./wav";

const CACHE = process.env.EVAL_CACHE ?? "../server/cache";
const F0_DIR = process.env.EVAL_F0 ?? "/tmp/f0";
const OUT_DIR = process.env.EVAL_OUT ?? "/tmp/eval";

/** `<슬롯>-<입력>-<엔진>[-t문턱].json` — `extract_f0.py`가 짓는 이름 */
function slotOf(file: string): string {
  return basename(file).split("-")[0];
}

/** 인터리브 다채널 → 모노. 채널 평균은 브라우저 `downmix`와 같은 규칙이다 */
function mono(samples: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return samples;
  const out = new Float32Array(Math.floor(samples.length / channels));
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += samples[i * channels + c];
    out[i] = sum / channels;
  }
  return out;
}

/**
 * 곡 하나의 브라우저측 분석. **슬롯마다 한 번만 한다** — 같은 곡의 커브가
 * 12벌이라도 비트 그리드는 하나다(그리고 이게 이 스크립트에서 제일 느리다).
 */
function analyzeSlot(slot: string): AnalysisReport {
  const bytes = readFileSync(join(CACHE, slot, "input.wav"));
  const wav = decodeWav(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const samples = resample(mono(wav.samples, wav.channels), wav.sampleRate, ANALYSIS_RATE);
  return analyzeAudio(samples, ANALYSIS_RATE);
}

test("캐시된 곡의 f0 커브를 전부 MIDI로 굽는다", { timeout: 30 * 60_000 }, () => {
  const files = readdirSync(F0_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
  expect(files.length, `${F0_DIR}에 커브가 없다`).toBeGreaterThan(0);
  mkdirSync(OUT_DIR, { recursive: true });

  const reports = new Map<string, AnalysisReport>();
  const rows: string[] = [];

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

    const curve = JSON.parse(readFileSync(join(F0_DIR, file), "utf-8")) as PitchCurve;
    const name = basename(file, ".json");
    const result = transcribe(curve, {
      bpm: report.tempo.bpm,
      beats: report.beats,
      downbeats: report.downbeats,
      beatsPerBar: report.meter.beatsPerBar,
      tuningCents: report.tuningCents,
      key: { tonic: report.key.tonic, mode: report.key.mode },
      title: name,
    });
    const midi = toMidiFiles(result, {
      bpm: report.tempo.bpm,
      beatsPerBar: report.meter.beatsPerBar,
    });
    writeFileSync(join(OUT_DIR, `${name}-performed.mid`), midi.performed);
    writeFileSync(join(OUT_DIR, `${name}-quantized.mid`), midi.quantized);

    rows.push(
      `${name}: 음표 ${result.notes.length} · 격자 ${result.quantized.length} · ` +
        `드리프트 ${result.offsetMs.toFixed(0)}ms · 조율보정 ${result.tuningCents.toFixed(1)}센트`,
    );
    // 진행 상황을 바로 보여 준다 — 곡당 수십 초라 끝까지 침묵하면 멈춘 줄 안다
    console.log(rows[rows.length - 1]);
  }

  writeFileSync(join(OUT_DIR, "summary.txt"), rows.join("\n") + "\n");
});
