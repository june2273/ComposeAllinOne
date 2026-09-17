/**
 * 드럼 검출 — **실곡 위생 지표.**
 *
 * `chords.eval.ts`와 같은 처지다: **정확도를 말할 수 없다.** 드럼 정답을 찍어
 * 둔 곡이 하나도 없고, `detect.ts`의 상수는 전부 추측이다. 여기서 나오는 것은
 * "맞았나"가 아니라 **"파국이 났나"**와 **"바꾸기 전후로 뭐가 움직였나"**다.
 *
 * 그래도 정답 없이 확정할 수 있는 것이 둘 있다.
 *
 * ## ① 쌍둥이 일치 — 정답 없이 "한쪽이 틀렸다"를 확정한다
 *
 * `곡F`와 `곡F (MR)`은 **반주가 같다**(보컬만 없다). `곡B`와
 * `커버2 sings 곡B`도 그렇다. 반주가 같으면 **드럼 패턴이 반드시 같아야
 * 한다.** 다르게 나오면 주석 없이 한쪽이 틀렸다는 것이 확정된다.
 *
 * CLAUDE.md가 이 쌍을 템포 문턱의 심판으로 쓴 것과 같은 논리다 — "반주가 같은
 * 두 판을 다르게 다루는 문턱은 정답을 몰라도 틀렸다고 말할 수 있다."
 *
 * ## ② 베이스 특이도 — 누설을 정면으로 잰다
 *
 * **같은 검출기를 `bass.wav`에 건다.** 베이스 스템에서 "킥"이 쏟아지면 킥 대역
 * (30~220Hz)이 베이스 음을 그대로 먹고 있다는 뜻이다. htdemucs 누설은 v1의 가장
 * 큰 오차원으로 짐작되는데, 이 검사는 **비용이 0이고 정답이 필요 없다.**
 *
 * ## 기준선 (2026-09-03, 캐시 19곡)
 *
 * **이 숫자를 비교 대상으로 쓴다.** 정확도가 아니라 "무엇이 움직였나"의 기준이다.
 *
 * | | 값 |
 * |---|---|
 * | 타점 밀도 | 1.8~5.3/초 (곡별) · 평균 3.97/초 |
 * | 어휘 분포 | 킥 2~37% · 스네어 20~57% · 하이햇 8~46% · 톰 0~1% |
 * | **쌍둥이** 곡F / (MR) | 밀도비 **0.98** · 분포거리 **0.015** (H 314/313 · S 382/383 · K 174/176) |
 * | **쌍둥이** 곡B / 커버2 | 밀도비 1.03 · 분포거리 0.081 |
 * | **베이스 특이도** | 베이스 스템 6149타점 중 킥 **67** (1.1%) |
 *
 * 개발 중에 이 표가 두 번 크게 움직였고, 둘 다 검출기의 실제 결함이었다:
 *
 * 1. **하이햇이 0~13%**였다 — 프로파일을 대역마다 흰색으로 만들지 않아 저역이
 *    독식했다(`detect.ts`의 실측 주석).
 * 2. **베이스 스템에서 킥이 4677개** 나왔다 — 킥 판정이 "저역이 크다"였는데
 *    베이스 음도 저역이 크다. "저역이 **중역을 이긴다**"로 바꿔 67개가 됐다.
 *
 * **톰이 0~1%인 것은 아직 설명되지 않았다.** 대중음악에서 톰이 드문 것은 맞지만
 * 19곡 전부에서 1% 이하인 것은 분류기가 사실상 그 가지를 안 쓴다는 뜻일 수 있다.
 * 드럼 정답이 생기기 전에는 어느 쪽인지 말할 수 없다.
 *
 * ```bash
 * npx vitest run --config vitest.eval.config.ts drums
 * ```
 */

import { existsSync, writeFileSync } from "node:fs";
import { test } from "vitest";

import { ANALYSIS_RATE } from "../../src/core/analysis/features";
import {
  CLASS_MARKS,
  detectDrums,
  DRUM_CLASSES,
  type DrumClass,
  type DrumDetection,
} from "../../src/core/drums";
import { evalSongs, stemPath } from "./truth";
import { loadMono } from "./wav";

const OUT = process.env.EVAL_OUT ?? "/tmp/drums";

/**
 * 반주가 같은 슬롯 쌍. **CLAUDE.md와 `evalset/README.md`가 근거다.**
 *
 * 지금은 이 하니스만 쓰므로 여기 둔다. 두 번째 하니스가 필요해지면 `truth.ts`로
 * 옮긴다 — `ratioName`이 거기 있는 것과 같은 이유가 그때 생긴다.
 */
const TWINS: readonly (readonly [string, string])[] = [
  ["d58f9d7ae5209e69", "ae9eebd2fccd44b7"], // 곡F / 곡F (MR)
  ["fdea2e5cb75d2458", "a28bdc99379055e6"], // 곡B / 커버2 sings 곡B
];

interface Row {
  slot: string;
  name: string;
  seconds: number;
  hits: number;
  perSec: number;
  /** 어휘별 비율 (합 1) */
  share: Record<DrumClass, number>;
  counts: Record<DrumClass, number>;
  rejectedRatio: number;
  peaks: { low: number; mid: number; high: number };
  rejected: { low: number; mid: number; high: number };
  /** 평균 신뢰도 */
  confidence: number;
}

function tally(result: DrumDetection, seconds: number): Omit<Row, "slot" | "name"> {
  const counts = Object.fromEntries(
    [...DRUM_CLASSES, "unknown" as const].map((c) => [c, 0]),
  ) as Record<DrumClass, number>;
  let confidence = 0;
  for (const h of result.hits) {
    counts[h.cls] += 1;
    confidence += h.confidence;
  }
  const total = result.hits.length;
  const share = Object.fromEntries(
    Object.entries(counts).map(([c, n]) => [c, total ? n / total : 0]),
  ) as Record<DrumClass, number>;
  const raw = result.peakCounts.low + result.peakCounts.mid + result.peakCounts.high;
  const dropped = result.rejected.low + result.rejected.mid + result.rejected.high;
  return {
    seconds,
    hits: total,
    perSec: seconds > 0 ? total / seconds : 0,
    share,
    counts,
    rejectedRatio: raw > 0 ? dropped / raw : 0,
    peaks: result.peakCounts,
    rejected: result.rejected,
    confidence: total ? confidence / total : 0,
  };
}

/** 어휘 분포 사이의 거리. 0이면 완전히 같다, 1이면 겹치는 것이 없다 */
function shareDistance(a: Record<DrumClass, number>, b: Record<DrumClass, number>): number {
  let sum = 0;
  for (const c of [...DRUM_CLASSES, "unknown" as const]) sum += Math.abs(a[c] - b[c]);
  return sum / 2;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

test("드럼 위생 지표", () => {
  const lines: string[] = [];
  const say = (m: string) => {
    lines.push(m);
    // eslint-disable-next-line no-console
    console.log(m);
  };

  const rows: Row[] = [];
  for (const song of evalSongs()) {
    const path = stemPath(song.slot, "drums");
    if (!path) continue;
    const samples = loadMono(path);
    const seconds = samples.length / ANALYSIS_RATE;
    rows.push({
      slot: song.slot,
      name: song.name,
      ...tally(detectDrums(samples, ANALYSIS_RATE), seconds),
    });
  }

  say(`\n=== 곡별 (${rows.length}곡) ===`);
  const head = DRUM_CLASSES.map((c) => CLASS_MARKS[c].padStart(4)).join("");
  say(`${"곡".padEnd(30)} ${"초".padStart(6)} ${"타점".padStart(6)} ${"/초".padStart(5)}${head} ${"기각".padStart(5)} ${"신뢰".padStart(5)}`);
  for (const r of rows.sort((a, b) => b.perSec - a.perSec)) {
    const share = DRUM_CLASSES.map((c) => pct(r.share[c]).padStart(4)).join("");
    say(
      `${r.name.slice(0, 30).padEnd(30)} ${r.seconds.toFixed(0).padStart(6)} ${String(r.hits).padStart(6)} ` +
        `${r.perSec.toFixed(1).padStart(5)}${share} ${pct(r.rejectedRatio).padStart(5)} ${r.confidence.toFixed(2).padStart(5)} ` +
        `봉우리 ${r.peaks.low}/${r.peaks.mid}/${r.peaks.high} 기각 ${r.rejected.low}/${r.rejected.mid}/${r.rejected.high}`,
    );
  }

  // --- ① 쌍둥이 일치 --------------------------------------------------------
  say(`\n=== 쌍둥이 일치 — 반주가 같으므로 드럼도 같아야 한다 ===`);
  for (const [a, b] of TWINS) {
    const left = rows.find((r) => r.slot === a);
    const right = rows.find((r) => r.slot === b);
    if (!left || !right) {
      say(`  ${a.slice(0, 8)} / ${b.slice(0, 8)}: 한쪽이 캐시에 없다 — 건너뜀`);
      continue;
    }
    const ratio = right.perSec > 0 ? left.perSec / right.perSec : Infinity;
    say(
      `  ${left.name.slice(0, 18).padEnd(18)} / ${right.name.slice(0, 18).padEnd(18)} ` +
        `밀도비=${ratio.toFixed(2)} 분포거리=${shareDistance(left.share, right.share).toFixed(3)}`,
    );
    say(
      `    ${DRUM_CLASSES.map((c) => `${CLASS_MARKS[c]} ${left.counts[c]}/${right.counts[c]}`).join("  ")}`,
    );
  }

  // --- ② 베이스 특이도 ------------------------------------------------------
  //
  // 킥 대역이 베이스 음을 먹는가. **정답이 필요 없는 검사다.**
  say(`\n=== 베이스 특이도 — 베이스 스템에서 나오면 전부 누설이다 ===`);
  let leakKick = 0;
  let leakTotal = 0;
  let bassSeconds = 0;
  for (const song of evalSongs()) {
    const path = stemPath(song.slot, "bass");
    if (!path || !existsSync(path)) continue;
    const samples = loadMono(path);
    const seconds = samples.length / ANALYSIS_RATE;
    const t = tally(detectDrums(samples, ANALYSIS_RATE), seconds);
    leakKick += t.counts.kick;
    leakTotal += t.hits;
    bassSeconds += seconds;
    say(
      `  ${song.name.slice(0, 30).padEnd(30)} 타점=${String(t.hits).padStart(5)} ` +
        `킥=${String(t.counts.kick).padStart(5)} (${t.perSec.toFixed(1)}/초)`,
    );
  }
  say(`  합계: ${leakTotal}타점 · 킥 ${leakKick} · ${(leakTotal / Math.max(1, bassSeconds)).toFixed(2)}/초`);
  const drumPerSec = rows.reduce((s, r) => s + r.hits, 0) / rows.reduce((s, r) => s + r.seconds, 1);
  say(`  드럼 스템은 ${drumPerSec.toFixed(2)}/초 — 베이스가 이보다 훨씬 낮아야 한다`);

  // --- 문턱 스윕 ------------------------------------------------------------
  //
  // **상수가 전부 추측이므로 어디쯤이 무릎인지는 훑어야 안다.** 온셋 문턱을
  // 훑을 때와 같은 방식이다(`onset.eval.ts`).
  say(`\n=== 문턱 스윕 (앞 5곡) ===`);
  const sweep = [0.7, 1.0, 1.3, 1.6, 2.0];
  const sample = rows.slice(0, 5);
  say(`${"곡".padEnd(30)}${sweep.map((s) => String(s).padStart(8)).join("")}`);
  for (const r of sample) {
    const path = stemPath(r.slot, "drums");
    if (!path) continue;
    const samples = loadMono(path);
    const cells = sweep.map((s) =>
      String(detectDrums(samples, ANALYSIS_RATE, { minStrength: s }).hits.length).padStart(8),
    );
    say(`${r.name.slice(0, 30).padEnd(30)}${cells.join("")}`);
  }

  writeFileSync(`${OUT}.txt`, `${lines.join("\n")}\n`);
  // eslint-disable-next-line no-console
  console.log(`\n→ ${OUT}.txt`);
});
