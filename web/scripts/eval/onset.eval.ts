/**
 * 온셋 진단 — **봉우리를 몇 개나 잡는가.**
 *
 * 정답 대조는 최종 MIDI에서만 나오는데, 그 숫자가 나쁠 때 원인이 ODF인지
 * 문턱인지 노트 분할인지 알 수 없다. 여기서는 그 앞단만 본다: 문턱별 봉우리
 * 개수를 정답 음표 수와 나란히 놓는다.
 *
 * **판정 규칙을 다시 적지 않는다.** `notes.onsetPeaks`를 그대로 부른다 —
 * 여기에 같은 규칙을 옮겨 적으면 조용히 갈라져서 재려던 것과 다른 것을 재게 된다.
 *
 * ```bash
 * EVAL_ONSET=vocal_processed.wav npx vitest run --config vitest.eval.config.ts onset
 * ```
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

import { ANALYSIS_RATE, extractOnsetCurve } from "../../src/core/analysis";
import { onsetPeaks } from "../../src/core/transcribe";
import { loadMono } from "./wav";

const CACHE = process.env.EVAL_CACHE ?? "../server/cache";
const EVALSET = process.env.EVAL_SET ?? "../evalset";
const FROM = process.env.EVAL_ONSET ?? "vocal_processed.wav";
const OUT = process.env.EVAL_OUT ?? "/tmp/onset-peaks.txt";

const STRENGTHS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0];

/**
 * 정답이 있는 곡들. **`evalset/songs.json`이 유일한 출처다** — 여기에 슬롯과
 * 이름을 다시 적으면 곡을 갈아끼울 때 한쪽만 고쳐져서, 이 저장소가 이미 한 번
 * 겪은 "측정값은 맞는데 곡 이름이 틀린" 상태가 된다.
 */
function truthSongs(): { slot: string; name: string; notes: number }[] {
  const raw = JSON.parse(readFileSync(join(EVALSET, "songs.json"), "utf-8")) as {
    songs?: {
      slot: string;
      name?: string;
      truth?: string | null;
      /** 정답 음표 수. `evalset.py truth`가 구울 때 적는다 */
      truthNotes?: number;
    }[];
  };
  return (raw.songs ?? [])
    .filter((s) => s.truth)
    .map((s) => ({ slot: s.slot, name: s.name ?? s.slot, notes: s.truthNotes ?? 0 }));
}

test("문턱별 온셋 봉우리 개수", { timeout: 30 * 60_000 }, () => {
  // vitest가 이 설정에서 console을 삼킨다. 파일로 낸다
  const lines = [
    `입력: ${FROM}`,
    ["곡".padEnd(20), "정답".padStart(6), ...STRENGTHS.map((s) => `≥${s}`.padStart(7))].join(""),
  ];
  for (const { slot, name, notes } of truthSongs()) {
    const curve = extractOnsetCurve(loadMono(join(CACHE, slot, FROM)), ANALYSIS_RATE);
    const counts = STRENGTHS.map((s) => onsetPeaks(curve, s).length);

    const sorted = Float32Array.from(curve.strength).sort();
    const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))].toFixed(2);
    lines.push(
      [
        name.padEnd(20),
        String(notes).padStart(6),
        ...counts.map((c) => String(c).padStart(7)),
      ].join("") +
        `   (중앙 ${q(0.5)} · 90% ${q(0.9)} · 99% ${q(0.99)} · 최대 ${q(1)})`,
    );
  }
  writeFileSync(OUT, lines.join("\n") + "\n");
});
