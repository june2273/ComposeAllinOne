/**
 * 온셋 진단 — **봉우리를 몇 개나 잡는가.**
 *
 * 정답 대조는 최종 MIDI에서만 나오는데, 그 숫자가 나쁠 때 원인이 ODF인지
 * 문턱인지 노트 분할인지 알 수 없다. 여기서는 그 앞단만 본다: 강도 분포와
 * 문턱별 봉우리 개수를 정답 음표 수와 나란히 놓는다.
 *
 * ```bash
 * EVAL_ONSET=vocal_processed.wav npx vitest run --config vitest.eval.config.ts onset
 * ```
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

import { ANALYSIS_RATE, extractOnsetCurve } from "../../src/core/analysis";
import { resample } from "../../src/platform/analyze";
import { decodeWav } from "./wav";

const CACHE = process.env.EVAL_CACHE ?? "../server/cache";
const FROM = process.env.EVAL_ONSET ?? "vocal_processed.wav";
const PEAK_MS = 35;
const REFRACTORY_MS = 80;

/** 정답이 있는 네 곡 + 정답 음표 수 */
const SONGS: [string, string, number][] = [
  ["8bd084445a7a01b7", "곡A", 408],
  ["30e3df84c075cdce", "곡E", 553],
  ["6dbbd01a0869e6bd", "곡D", 477],
  ["a27cc8ad15707049", "곡C", 623],
];

const STRENGTHS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0];

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

/** `notes.pickOnsets`와 같은 규칙. 저쪽은 비공개라 여기서 다시 적는다 */
function countPeaks(strength: Float32Array, hopMs: number, min: number): number {
  const radius = Math.max(1, Math.round(PEAK_MS / hopMs));
  const refractory = REFRACTORY_MS / hopMs;
  let last = -Infinity;
  let count = 0;
  for (let t = 0; t < strength.length; t += 1) {
    const value = strength[t];
    if (!(value >= min) || t - last < refractory) continue;
    let peak = true;
    for (let d = -radius; d <= radius && peak; d += 1) {
      const j = t + d;
      if (j < 0 || j >= strength.length || j === t) continue;
      if (d < 0 ? strength[j] >= value : strength[j] > value) peak = false;
    }
    if (!peak) continue;
    last = t;
    count += 1;
  }
  return count;
}

test("문턱별 온셋 봉우리 개수", { timeout: 30 * 60_000 }, () => {
  // vitest가 이 설정에서 console을 삼킨다. 파일로 낸다
  const lines = [
    `입력: ${FROM}`,
    ["곡".padEnd(20), "정답".padStart(6), ...STRENGTHS.map((s) => `≥${s}`.padStart(7))].join(""),
  ];
  for (const [slot, name, truth] of SONGS) {
    const bytes = readFileSync(join(CACHE, slot, FROM));
    const wav = decodeWav(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    const samples = resample(mono(wav.samples, wav.channels), wav.sampleRate, ANALYSIS_RATE);
    const { hopMs, strength } = extractOnsetCurve(samples, ANALYSIS_RATE);
    const counts = STRENGTHS.map((s) => countPeaks(strength, hopMs, s));

    const sorted = Float32Array.from(strength).sort();
    const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))].toFixed(2);
    lines.push(
      [name.padEnd(20), String(truth).padStart(6), ...counts.map((c) => String(c).padStart(7))].join("") +
        `   (중앙 ${q(0.5)} · 90% ${q(0.9)} · 99% ${q(0.99)} · 최대 ${sorted[sorted.length - 1].toFixed(1)})`,
    );
  }
  writeFileSync(process.env.EVAL_OUT ?? "/tmp/onset-peaks.txt", lines.join("\n") + "\n");
});
