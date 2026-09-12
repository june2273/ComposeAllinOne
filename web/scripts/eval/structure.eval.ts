/**
 * 구조 — **앱이 내는 것과 같은 섹션을 파일로 굽는다.**
 *
 * 사이드카가 캐시에 남긴 `structure.json`(모델의 원 출력)을 우리 마디 격자에
 * 얹고 pre-chorus를 붙여, 사람이 찍은 정답과 **같은 형식**으로 쓴다. 그래야
 * `eval_structure.py`가 둘을 나란히 놓을 수 있다.
 *
 * **새 로직이 한 줄도 없다.** `analyzeAudio` → `sectionsFromSegments`는
 * `ui/analysis.tsx`가 하는 것과 정확히 같은 결선이다 — 여기서 규칙을 다시 적으면
 * 조용히 갈라져서 재려던 것과 다른 것을 재게 된다(`onset.eval.ts`와 같은 방침).
 *
 * ```bash
 * cd web && EVAL_OUT=/tmp/structure npx vitest run --config vitest.eval.config.ts structure
 * python3 web/scripts/eval_structure.py evalset/truth/곡E.sections.json /tmp/structure/곡E.sections.json
 * ```
 *
 * **정답은 여기서 안 만든다.** 초안이 필요하면
 * `server/scripts/evalset.py sections --slot <slot>`이 모델의 원 출력을 그대로
 * 떠 준다 — 우리 결과로 우리를 채점하면 아무것도 못 잰다.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

import {
  ANALYSIS_RATE,
  analyzeAudio,
  type RawSegment,
  sectionsFromSegments,
} from "../../src/core/analysis";
import { gridFor } from "./truth";
import { loadMono } from "./wav";

const CACHE = process.env.EVAL_CACHE ?? "../server/cache";
const EVALSET = process.env.EVAL_SET ?? "../evalset";
const OUT = process.env.EVAL_OUT ?? "/tmp/structure";

/** `evalset/songs.json`이 곡 목록의 유일한 출처다(`onset.eval.ts`와 같은 이유). */
function songs(): { slot: string; name: string }[] {
  const raw = JSON.parse(readFileSync(join(EVALSET, "songs.json"), "utf-8")) as {
    songs?: { slot: string; name?: string }[];
  };
  return (raw.songs ?? []).map((s) => ({ slot: s.slot, name: s.name ?? s.slot }));
}

test("구조 — 우리 섹션을 정답 형식으로", { timeout: 60 * 60_000 }, () => {
  mkdirSync(OUT, { recursive: true });
  const report: string[] = [];

  for (const { slot, name } of songs()) {
    const structurePath = join(CACHE, slot, "structure.json");
    const audioPath = join(CACHE, slot, "input.wav");
    if (!existsSync(structurePath) || !existsSync(audioPath)) {
      report.push(`${name.padEnd(24)} — 건너뜀 (구조 결과나 오디오가 없다)`);
      continue;
    }

    const raw = JSON.parse(readFileSync(structurePath, "utf-8")) as {
      segments?: RawSegment[];
    };
    // 우리 다운비트가 필요하다 — 마디 좌표가 거기서 난다
    const analysis = analyzeAudio(loadMono(audioPath), gridFor(slot), ANALYSIS_RATE);
    const sections = sectionsFromSegments(
      raw.segments ?? [],
      analysis.downbeats,
      analysis.durationSec,
    );

    // 정답과 같은 모양으로. 마지막 줄은 곡의 끝을 닫는 센티널이다
    const rows = [
      ...sections.map((s) => ({ time: Number(s.time[0].toFixed(2)), label: s.label })),
      { time: Number(analysis.durationSec.toFixed(2)), label: "end" },
    ];
    writeFileSync(
      join(OUT, `${name}.sections.json`),
      JSON.stringify({ song: name, slot, sections: rows }, undefined, 2) + "\n",
    );

    const pre = sections.filter((s) => s.label === "pre-chorus").length;
    report.push(
      `${name.padEnd(24)} ${String(sections.length).padStart(3)}구간 · `
      + `pre-chorus ${pre} · ${analysis.tempo.bpm.toFixed(1)} BPM `
      + `(모델 ${(raw as { bpm?: number }).bpm ?? "?"})`,
    );
  }

  // vitest가 이 설정에서 console을 삼킨다. 파일로 낸다
  writeFileSync(join(OUT, "summary.txt"), report.join("\n") + "\n");
});
