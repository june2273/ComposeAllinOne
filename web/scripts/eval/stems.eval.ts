/**
 * 스템이 템포에 도움이 되는가 — **아키텍처를 바꾸기 전에 먼저 재는 자리.**
 *
 * 지금 BPM은 원본 믹스에서 나온다. 믹스의 ODF에는 보컬·신스·리버브가 전부
 * 섞여 있어서, 비트 추적이 보는 "여기 타격이 있는가"가 흐려진다. 드럼·베이스
 * 스템으로 같은 것을 재면 나아질 것 같은데 — **그 짐작을 코드로 옮기기 전에
 * 숫자로 확인한다.**
 *
 * **스템은 이미 캐시에 있다.** 그래서 이 실험은 아키텍처를 하나도 안 바꾸고
 * 돈다. 여기서 이득이 없으면 사이드카 피드백을 논할 이유 자체가 없다.
 *
 * ## 보컬은 안 넣는다
 *
 * 재발음용 온셋(`vocal_processed`)을 격자에 먹이고 싶어지지만 **넣으면
 * 나빠진다.** 노래는 박에서 −56~+60ms를 오간다(양자화의 드리프트 곡선) —
 * 가수의 루바토를 비트 격자에 집어넣는 셈이다. 격자는 반주가 잡아야 한다.
 *
 * ## `resolveDupleMeter`는 빼고 잰다
 *
 * 그쪽은 박자 판정(=크로마)이 입력인데 드럼 스템의 크로마는 잡음이다. 여기서
 * 보는 것은 **템포 경로만**이다: 자기상관 → 비트 추적 → `resolveOctave`.
 *
 * ```bash
 * npx vitest run --config vitest.eval.config.ts stems
 * ```
 */

import { writeFileSync } from "node:fs";
import { test } from "vitest";

import { ANALYSIS_RATE, extractFeatures, normalizeOnset } from "../../src/core/analysis/features";
import {
  estimateTempo,
  halfBeatStrength,
  MAX_BPM,
  trackBeats,
  type BeatTrack,
  type TempoEstimate,
} from "../../src/core/analysis/tempo";
import { evalSongs, ratioName, stemPath } from "./truth";
import { loadMono } from "./wav";

const OUT = process.env.EVAL_OUT ?? "/tmp/stems";

/** `resolveOctave`의 상수. 여기서 게이트를 재현하려면 알아야 한다 */
const OCTAVE_RIVAL = 0.7;
const HALF_BEAT_STRONG = 0.4;
const OCTAVE_IMPROVE = 0.75;

interface Measured {
  acfTop: number;
  /** 비트 추적까지 마친 BPM */
  tracked: number;
  /** `resolveOctave`까지 마친 최종 BPM */
  final: number;
  rival2: number;
  slowHbs: number;
  fastHbs: number;
  octaveFired: boolean;
  steadiness: number;
}

/**
 * 신호 하나에서 템포 경로를 끝까지 돌린다. `analyzeAudio`의 템포 부분과 같은
 * 순서다 — 다른 것은 입력 신호뿐이어야 비교가 성립한다.
 */
function measure(samples: Float32Array): Measured | null {
  const features = extractFeatures(samples, ANALYSIS_RATE);
  const onset = normalizeOnset(features.onset, features.fps);
  const tempo: TempoEstimate = estimateTempo(onset, features.fps);
  if (tempo.bpm <= 0) return null;

  const track: BeatTrack = trackBeats(onset, features.fps, tempo.bpm);
  const slowHbs = halfBeatStrength(onset, features.fps, track.beats);

  // resolveOctave의 세 게이트를 그대로
  const doubled = track.bpm * 2;
  const rival = tempo.candidates.find(
    (c) => Math.abs(c.bpm / doubled - 1) < 0.06 && c.weight >= OCTAVE_RIVAL,
  );
  let final = track.bpm;
  let fastHbs = 0;
  let fired = false;
  if (track.beats.length >= 8 && track.bpm > 0 && doubled <= MAX_BPM && rival && slowHbs >= HALF_BEAT_STRONG) {
    const fast = trackBeats(onset, features.fps, doubled);
    if (fast.beats.length >= 8 && fast.bpm > 0) {
      fastHbs = halfBeatStrength(onset, features.fps, fast.beats);
      if (fastHbs <= slowHbs * OCTAVE_IMPROVE) {
        final = fast.bpm;
        fired = true;
      }
    }
  }
  const rival2 = tempo.candidates.find((c) => Math.abs(c.bpm / doubled - 1) < 0.06)?.weight ?? 0;
  return {
    acfTop: tempo.candidates[0]?.bpm ?? 0,
    tracked: track.bpm,
    final,
    rival2,
    slowHbs,
    fastHbs,
    octaveFired: fired,
    steadiness: track.steadiness,
  };
}

/** 두 신호를 더한다. 드럼+베이스 = 리듬 섹션 */
function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.min(a.length, b.length));
  for (let i = 0; i < out.length; i += 1) out[i] = a[i] + b[i];
  return out;
}

test("스템별 템포 — 믹스와 비교한다", { timeout: 60 * 60_000 }, () => {
  const rows: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const tally = new Map<string, { ok: number; n: number }>();

  for (const song of evalSongs()) {
    if (song.truthBpm === null) continue;
    const drums = stemPath(song.slot, "drums");
    const bass = stemPath(song.slot, "bass");
    if (!drums || !bass) continue;

    const drumSamples = loadMono(drums);
    const bassSamples = loadMono(bass);
    const sources: [string, Float32Array][] = [
      ["믹스", loadMono(song.audio)],
      ["드럼", drumSamples],
      ["베이스", bassSamples],
      ["드럼+베이스", mix(drumSamples, bassSamples)],
    ];

    const got: Record<string, Measured | null> = {};
    for (const [label, samples] of sources) {
      const m = measure(samples);
      got[label] = m;
      const slot = tally.get(label) ?? { ok: 0, n: 0 };
      if (m) {
        slot.n += 1;
        if (ratioName(m.final, song.truthBpm) === "정확") slot.ok += 1;
      }
      tally.set(label, slot);
    }
    rows.push({ slot: song.slot, name: song.name, truthBpm: song.truthBpm, sources: got });

    lines.push(`\n## ${song.name}  (정답 ${song.truthBpm})`);
    lines.push(
      ["  입력".padEnd(14), "ACF1위".padStart(8), "추적".padStart(8), "최종".padStart(8),
        "판정".padStart(7), "2배w".padStart(7), "hbs".padStart(7), "배증".padStart(5)].join(""),
    );
    for (const [label] of sources) {
      const m = got[label];
      if (!m) {
        lines.push(`  ${label.padEnd(12)}  (템포를 못 잡음)`);
        continue;
      }
      lines.push(
        [
          `  ${label}`.padEnd(14),
          m.acfTop.toFixed(1).padStart(8),
          m.tracked.toFixed(1).padStart(8),
          m.final.toFixed(1).padStart(8),
          ratioName(m.final, song.truthBpm).padStart(7),
          m.rival2.toFixed(3).padStart(7),
          m.slowHbs.toFixed(3).padStart(7),
          (m.octaveFired ? "YES" : "-").padStart(5),
        ].join(""),
      );
    }
  }

  lines.push("", "=".repeat(58), "입력별 정확도");
  for (const [label, { ok, n }] of tally) {
    lines.push(`  ${label.padEnd(12)} ${ok}/${n}`);
  }

  writeFileSync(`${OUT}.txt`, lines.join("\n") + "\n");
  writeFileSync(`${OUT}.json`, JSON.stringify(rows, null, 2) + "\n");
});
