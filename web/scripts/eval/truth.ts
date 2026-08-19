/**
 * 평가셋의 정답 — **곡 목록과 비율 분류의 단일 출처.**
 *
 * 템포 하니스와 스템 하니스가 같은 물음("우리 BPM이 정답의 몇 배인가")에
 * 답하는데, 각자 표를 들면 조용히 갈린다. `wav.ts`를 하나로 모은 것과 같은
 * 이유다.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { relatedTempo } from "../../src/core/analysis/tempo";

export const CACHE = process.env.EVAL_CACHE ?? "../server/cache";
export const EVALSET = process.env.EVAL_SET ?? "../evalset";

/** 정답과 이만큼 안에 들면 맞은 것으로 본다. MIREX 관례가 4%다 */
export const TOLERANCE = 0.04;

interface Raw {
  slot: string;
  name?: string;
  source?: string | null;
  truthBpm?: number;
  truthBeatsPerBar?: number;
  /** 있으면 평가에서 뺀다. 값은 왜 뺐는지 — `evalset/README.md`의 '제외한 곡' */
  exclude?: string;
}

export interface EvalSong {
  slot: string;
  name: string;
  /** 원본 믹스. 캐시에 없으면 `source` */
  audio: string;
  truthBpm: number | null;
  truthBar: number | null;
}

/**
 * 잴 곡들. **`evalset/songs.json`이 유일한 출처다.**
 *
 * **캐시가 없어도 잰다** — 템포·박자는 원본 오디오만 있으면 나오는데 캐시
 * 슬롯을 만들려면 스템 분리에 수 분이 든다.
 *
 * **`exclude`가 붙은 곡은 아예 안 돈다.** 변박·변속·전조가 든 곡과 애초에
 * 음원이 아닌 것(앞에 게임 튜토리얼이 붙은 녹음)이 거기 든다 — 표에 섞이면
 * 평균이 조용히 오염되고 왜 나쁜지 아무도 모르게 된다.
 */
export function evalSongs(): EvalSong[] {
  const raw = JSON.parse(readFileSync(join(EVALSET, "songs.json"), "utf-8")) as {
    songs?: Raw[];
  };
  return (raw.songs ?? [])
    .filter((s) => !s.exclude)
    .map((s) => {
      const cached = join(CACHE, s.slot, "input.wav");
      return {
        slot: s.slot,
        name: s.name ?? s.slot,
        audio: existsSync(cached) ? cached : (s.source ?? ""),
        truthBpm: typeof s.truthBpm === "number" ? s.truthBpm : null,
        truthBar: typeof s.truthBeatsPerBar === "number" ? s.truthBeatsPerBar : null,
      };
    })
    .filter((s) => s.audio !== "" && existsSync(s.audio));
}

/** 슬롯의 스템 경로. 없으면 `null` */
export function stemPath(slot: string, name: string): string | null {
  const path = join(CACHE, slot, "stems", `${name}.wav`);
  return existsSync(path) ? path : null;
}

/**
 * 우리 BPM이 정답의 몇 배인가 — 사람이 읽는 이름으로.
 *
 * **비율 이름을 새로 정하지 않는다.** `relatedTempo`가 이미 "같은 그리드의
 * 다른 읽기"의 정의를 들고 있고(그 목록이 신뢰도 계산에도 쓰인다), 여기서
 * 따로 표를 만들면 두 정의가 조용히 갈린다.
 */
export function ratioName(ours: number, truth: number): string {
  if (truth <= 0 || ours <= 0) return "?";
  const ratio = ours / truth;
  const named: [number, string][] = [
    [1, "정확"],
    [2, "×2"],
    [0.5, "÷2"],
    [3, "×3"],
    [1 / 3, "÷3"],
    [1.5, "×3/2"],
    [2 / 3, "×2/3"],
    [4, "×4"],
    [0.25, "÷4"],
  ];
  for (const [value, name] of named) {
    if (Math.abs(ratio / value - 1) < TOLERANCE) return name;
  }
  return relatedTempo(ours, truth, TOLERANCE) ? "배수(기타)" : "틀림";
}
