/**
 * 드럼 타점 → **채널 10 GM 드럼 MIDI.**
 *
 * 새 작성기를 만들지 않는다. `core/transcribe/midi.ts`가 이미 SMF를 직접 쓰고
 * 있고(가변 길이 수량·템포·박자표 메타·틱 정렬), **동시타도 이미 견딘다** —
 * `build()`가 `(tick, order)`로 정렬하므로 한 틱에 여러 음이 서도 note-off가
 * note-on보다 먼저 나간다. 필요했던 것은 상태 바이트의 채널 니블 하나뿐이었다.
 *
 * ## 이것도 **검수 전제의 초안이다**
 *
 * CLAUDE.md가 악보에 대해 이미 정한 방침 그대로다 — "사람이 반드시 손봐야 하는
 * 초안". 드럼 정답이 하나도 없어서 정확도를 말할 수 없는데 `.mid`가 손에
 * 들어오면 "앱이 이게 드럼이라고 했다"가 된다. 파일 이름과 화면 문구가 초안임을
 * 말한다.
 *
 * **그리고 이 파일이 측정을 가능하게 한다.** 드럼 정답을 만드는 가장 싼 길이
 * "우리가 낸 채널10 MIDI를 DAW에서 고쳐 `evalset/truth/<곡>.drums.mid`로
 * 저장"이기 때문이다 — `evalset.py sections`가 구조 정답에 쓰는 그 수법이다.
 * 내보내기를 미루면 정답 만들기도 함께 미뤄진다.
 */

import {
  DRUM_CHANNEL,
  fromNotes,
  fromQuantized,
  type MidiOptions,
} from "../transcribe/midi";
import { nearestStep, type Grid, type QuantizedNote } from "../transcribe/quantize";
import type { NoteEvent } from "../transcribe/notes";

import type { DrumHit } from "./detect";
import type { LoopSpan } from "./pattern";

/**
 * 타점 하나의 길이(초). 드럼에는 음가가 없다.
 *
 * 짧게 두는 것이 요점이다 — 길면 시퀀서에서 음표가 서로 겹쳐 보여 **격자를
 * 읽을 수 없다.** 소리는 어차피 샘플이 끝까지 나므로 길이가 영향을 안 준다.
 */
const HIT_SEC = 0.05;
/** 격자판에서의 길이(칸). `quantize.MIN_STEPS`와 같은 관례 */
const HIT_STEPS = 1;

export interface DrumMidiOptions {
  readonly bpm: number;
  readonly beatsPerBar?: number;
}

function base(options: DrumMidiOptions, name: string): MidiOptions {
  return {
    bpm: options.bpm,
    beatsPerBar: options.beatsPerBar,
    name,
    channel: DRUM_CHANNEL,
  };
}

/** 타점 → 작성기가 아는 모양. 음가가 없으므로 짧은 고정 길이를 준다 */
function asNotes(hits: readonly DrumHit[]): NoteEvent[] {
  return hits.map((hit) => ({
    midi: hit.gm,
    startSec: hit.atSec,
    endSec: hit.atSec + HIT_SEC,
    velocity: hit.velocity,
    centsOffset: 0,
  }));
}

/**
 * 격자에 얹은 타점. **같은 칸·같은 악기가 둘이면 하나로 줄인다.**
 *
 * 안 그러면 한 틱에 같은 키의 note-on이 두 번 나가고 그 사이의 note-off가
 * 앞의 것을 끄면서 두 번째가 매달린다 — 시퀀서마다 다르게 해석하는 상태다.
 */
function asQuantized(hits: readonly DrumHit[], grid: Grid): QuantizedNote[] {
  const seen = new Set<string>();
  const out: QuantizedNote[] = [];
  for (const hit of hits) {
    const step = nearestStep(grid, hit.atSec);
    const key = `${step}:${hit.gm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      midi: hit.gm,
      startSec: hit.atSec,
      endSec: hit.atSec + HIT_SEC,
      velocity: hit.velocity,
      centsOffset: 0,
      startStep: step,
      endStep: step + HIT_STEPS,
    });
  }
  return out.sort((a, b) => a.startStep - b.startStep);
}

/**
 * 곡 전체. 두 벌이 나가는 이유는 멜로디와 같다 —
 * **친 그대로**와 **격자에 얹은 것**은 다른 물음에 답한다.
 */
export function toDrumMidi(
  hits: readonly DrumHit[],
  grid: Grid,
  options: DrumMidiOptions,
): { performed: Uint8Array; quantized: Uint8Array } {
  return {
    performed: fromNotes(asNotes(hits), base(options, "drums (performed)")),
    quantized: fromQuantized(asQuantized(hits, grid), grid, base(options, "drums (quantized)")),
  };
}

/**
 * 루프 한 구간만. **공부할 단위가 곧 이것이다** — 화면 그리드에 보이는 그 마디들.
 *
 * `bars`를 주면 구간의 앞 그만큼만 자른다(그리드가 최대 네 마디만 그리므로,
 * 눈으로 본 것과 내려받은 것이 같아야 한다).
 */
export function loopToMidi(
  hits: readonly DrumHit[],
  grid: Grid,
  span: LoopSpan,
  options: DrumMidiOptions & { readonly bars?: number },
): Uint8Array {
  const stepsPerBar = grid.stepsPerBeat * grid.beatsPerBar;
  const bars = Math.max(1, Math.min(options.bars ?? span.toBar - span.fromBar + 1, span.toBar - span.fromBar + 1));
  const from = (span.fromBar - 1) * stepsPerBar;
  const to = from + bars * stepsPerBar;
  const inside = hits.filter((hit) => {
    const step = nearestStep(grid, hit.atSec);
    return step >= from && step < to;
  });
  // 칸 번호를 0부터 다시 매긴다 — 루프 파일이 곡의 몇 마디째였는지는 뜻이 없다
  const notes = asQuantized(inside, grid).map((note) => ({
    ...note,
    startStep: note.startStep - from,
    endStep: note.endStep - from,
  }));
  return fromQuantized(notes, grid, base(options, `drums loop ${span.patternId}`));
}
