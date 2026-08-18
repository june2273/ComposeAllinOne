/**
 * 코드 인식을 실곡에 돌려 **눈으로 본다.**
 *
 * **왜 필요한가.** 합성 신호 테스트는 "알고리즘이 의도대로 도는가"까지만
 * 말한다(`test/analysis.test.ts`). 실곡에서 나오는 것이 그럴듯한 화성인지는
 * 사람이 봐야 알고, 그러려면 앱을 띄우고 파일을 열지 않고도 코드 열을 뽑을
 * 길이 있어야 한다 — `pipeline.eval.ts`가 f0에 대해 하는 것과 같은 자리다.
 *
 * **코드 정답셋이 아직 없다.** 그래서 여기서 재는 것은 정확도가 아니라
 * 분포다 — 몇 개가 나왔는가, 신뢰도가 얼마인가, 조성의 다이아토닉 화음에
 * 얼마나 들어맞는가(맞으면 맞는 것이 아니라 **덜 이상한** 것이다), 그리고
 * **분석 시간이 얼마나 늘었는가**. 정답이 붙으면 여기에 대조를 더한다.
 *
 * ```bash
 * cd web
 * npx vitest run --config vitest.eval.config.ts chords
 * EVAL_SLOTS=a27cc8ad15707049 npx vitest run --config vitest.eval.config.ts chords
 * ```
 */

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { ANALYSIS_RATE, analyzeAudio, type AnalysisReport } from "../../src/core/analysis";
import { loadMono } from "./wav";

const CACHE = process.env.EVAL_CACHE ?? "../server/cache";
/** 비우면 캐시의 슬롯을 전부 돈다 */
const SLOTS = (process.env.EVAL_SLOTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
/** 몇 마디까지 찍을 것인가. 곡 전체를 찍으면 읽을 수가 없다 */
const BARS = Number(process.env.EVAL_BARS ?? 16);

/** 장·단조의 다이아토닉 3화음 근음(으뜸음 기준 반음) */
const DIATONIC = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

function slots(): string[] {
  if (SLOTS.length) return SLOTS;
  if (!existsSync(CACHE)) return [];
  return readdirSync(CACHE).filter((name) =>
    existsSync(join(CACHE, name, "input.wav")),
  );
}

/** 코드 열을 마디 격자로 찍는다. `ui/chords.tsx`가 그리는 것과 같은 모양 */
function chart(report: AnalysisReport, bars: number): string {
  const perBar = report.meter.beatsPerBar;
  const phase = report.meter.phase;
  const lines: string[] = [];
  const cells = new Map<number, string[]>();
  for (const chord of report.chords) {
    const relative = chord.startBeat - phase;
    const bar = Math.floor(relative / perBar) + 1;
    const beat = relative - (bar - 1) * perBar;
    const row = cells.get(bar) ?? Array.from({ length: perBar }, () => "");
    row[beat] = chord.symbol;
    cells.set(bar, row);
  }
  const sorted = [...cells].sort((a, b) => a[0] - b[0]).slice(0, bars);
  for (const [bar, row] of sorted) {
    lines.push(
      `  ${String(bar).padStart(3)} | ${row.map((c) => (c || "·").padEnd(6)).join(" ")}`,
    );
  }
  return lines.join("\n");
}

/** 조성의 다이아토닉 화음에 들어맞는 비율(길이 가중). 정확도가 아니라 위생 검사다 */
function diatonicShare(report: AnalysisReport): number {
  const scale = DIATONIC[report.key.mode].map((d) => (report.key.tonic + d) % 12);
  let inKey = 0;
  let total = 0;
  for (const chord of report.chords) {
    const span = chord.endBeat - chord.startBeat;
    total += span;
    if (scale.includes(chord.root)) inKey += span;
  }
  return total > 0 ? inKey / total : 0;
}

const found = slots();
test.skipIf(found.length === 0)("실곡의 코드 열", () => {
  for (const slot of found) {
    const path = join(CACHE, slot, "input.wav");
    const samples = loadMono(path);
    const started = Date.now();
    const report = analyzeAudio(samples, ANALYSIS_RATE);
    const elapsed = (Date.now() - started) / 1000;

    const counts = new Map<string, number>();
    for (const chord of report.chords) {
      counts.set(chord.quality, (counts.get(chord.quality) ?? 0) + 1);
    }
    console.log(
      `\n=== ${slot} · ${report.durationSec.toFixed(0)}초 · ` +
        `${report.tempo.bpm.toFixed(1)}BPM ${report.meter.value} · ${report.key.name}`,
    );
    console.log(
      `    코드 ${report.chords.length}개 · 신뢰도 ${report.chordConfidence.toFixed(2)} · ` +
        `다이아토닉 ${(diatonicShare(report) * 100).toFixed(0)}% · ` +
        `분석 ${elapsed.toFixed(1)}초 (실시간 ${(report.durationSec / elapsed).toFixed(0)}배)`,
    );
    console.log(`    성질: ${[...counts].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    console.log(chart(report, BARS));

    expect(report.chords.length).toBeGreaterThan(0);
  }
});
