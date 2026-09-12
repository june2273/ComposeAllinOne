/**
 * 표준 MIDI 파일(SMF) 쓰기. **의존성 없이 100줄이면 끝난다.**
 *
 * 라이브러리를 넣지 않은 이유는 `analysis/fft.ts`와 같다 — 필요한 것이
 * 규격의 아주 작은 조각(Type-0, note on/off, 템포·박자 메타)뿐인데 범용
 * 라이브러리는 SysEx·다중 트랙·SMPTE까지 들고 온다.
 *
 * **두 벌을 낸다**(사양서 §9): 사람이 실제로 노래한 시각 그대로인 것과,
 * 격자에 스냅한 것. 전자는 되돌릴 수 없는 정보이므로 표기용 한 벌만 내면 안
 * 된다. `fromNotes`가 앞쪽, `fromQuantized`가 뒤쪽이다.
 */

import type { NoteEvent } from "./notes";
import type { Grid, QuantizedNote } from "./quantize";

/** 4분음표당 틱. 480은 시퀀서들의 관례값이고 3·4로 모두 나뉜다 */
export const TICKS_PER_BEAT = 480;

export interface MidiOptions {
  readonly bpm: number;
  readonly beatsPerBar?: number;
  /** 트랙 이름 메타. 없으면 넣지 않는다 */
  readonly name?: string;
  /**
   * MIDI 채널 0~15. 기본 0.
   *
   * **드럼은 9다**(사람이 세는 채널 10). GM에서 그 채널만 음높이가 아니라
   * 타악기 번호를 뜻하고, 어떤 시퀀서든 그 약속으로 읽는다. 드럼 타점을
   * 채널 0으로 내보내면 피아노 저음역이 울린다.
   */
  readonly channel?: number;
}

/** GM 드럼 채널. 사람이 세는 10번이 0부터 세면 9다 */
export const DRUM_CHANNEL = 9;

/** 가변 길이 수량(VLQ). MIDI의 델타타임 표현이다 */
export function writeVarLen(value: number): number[] {
  const v = Math.max(0, Math.round(value));
  const out = [v & 0x7f];
  let rest = v >> 7;
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return out;
}

function be32(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function be16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function chunk(type: string, body: number[]): number[] {
  return [...[...type].map((c) => c.charCodeAt(0)), ...be32(body.length), ...body];
}

interface TickEvent {
  readonly tick: number;
  /** note-off가 같은 틱의 note-on보다 먼저 나가야 같은 음의 연타가 살아난다 */
  readonly order: number;
  readonly bytes: readonly number[];
}

function build(events: TickEvent[], options: MidiOptions): Uint8Array {
  const bpm = options.bpm > 0 ? options.bpm : 120;
  const beatsPerBar = options.beatsPerBar ?? 4;

  const body: number[] = [];
  if (options.name) {
    const name = [...new TextEncoder().encode(options.name)];
    body.push(0x00, 0xff, 0x03, ...writeVarLen(name.length), ...name);
  }
  // 템포: 4분음표 하나의 마이크로초
  const usPerBeat = Math.round(60_000_000 / bpm);
  body.push(
    0x00, 0xff, 0x51, 0x03,
    (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff,
  );
  // 박자: 분모는 2의 지수로 적는다. 이 앱의 박은 늘 4분음표이므로 2다
  body.push(0x00, 0xff, 0x58, 0x04, beatsPerBar, 2, 24, 8);

  const sorted = [...events].sort(
    (a, b) => a.tick - b.tick || a.order - b.order,
  );
  let previous = 0;
  for (const event of sorted) {
    body.push(...writeVarLen(event.tick - previous), ...event.bytes);
    previous = event.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00); // end of track

  // Type-0(단일 트랙), 4분음표당 TICKS_PER_BEAT틱
  const header = chunk("MThd", [...be16(0), ...be16(1), ...be16(TICKS_PER_BEAT)]);
  return new Uint8Array([...header, ...chunk("MTrk", body)]);
}

function noteEvents(
  notes: readonly { midi: number; velocity: number }[],
  ticks: readonly [number, number][],
  channel = 0,
): TickEvent[] {
  // 못갖춘마디는 칸 번호가 음수다(quantize.ts). MIDI에 음수 틱은 없으므로
  // 전체를 밀어 0에서 시작하게 한다 — 곡의 시작이 어디인지는 악보 쪽이 안다.
  const lowest = ticks.reduce((min, [on]) => Math.min(min, on), 0);
  const events: TickEvent[] = [];
  notes.forEach((note, i) => {
    const on = ticks[i][0] - lowest;
    const off = ticks[i][1] - lowest;
    const key = Math.max(0, Math.min(127, Math.round(note.midi)));
    const velocity = Math.max(1, Math.min(127, Math.round(note.velocity)));
    const nibble = channel & 0x0f;
    events.push({ tick: on, order: 1, bytes: [0x90 | nibble, key, velocity] });
    events.push({ tick: Math.max(on + 1, off), order: 0, bytes: [0x80 | nibble, key, 0] });
  });
  return events;
}

/**
 * 원본 타이밍 그대로. 초 → 틱 변환에만 BPM을 쓴다.
 *
 * 격자에 맞지 않으므로 시퀀서에서 열면 음표가 마디선에 걸쳐 보인다 — **그것이
 * 실제로 노래한 모양이다.** 표기용이 아니라 참조용이다.
 */
export function fromNotes(
  notes: readonly NoteEvent[],
  options: MidiOptions,
): Uint8Array {
  const perSec = (options.bpm > 0 ? options.bpm : 120) / 60 * TICKS_PER_BEAT;
  const ticks = notes.map(
    (n) => [Math.round(n.startSec * perSec), Math.round(n.endSec * perSec)] as [number, number],
  );
  return build(noteEvents(notes, ticks, options.channel), options);
}

/** 격자에 스냅한 것. 이쪽이 악보와 같은 시각을 갖는다. */
export function fromQuantized(
  notes: readonly QuantizedNote[],
  grid: Grid,
  options: MidiOptions,
): Uint8Array {
  const perStep = TICKS_PER_BEAT / grid.stepsPerBeat;
  const ticks = notes.map(
    (n) => [Math.round(n.startStep * perStep), Math.round(n.endStep * perStep)] as [number, number],
  );
  return build(noteEvents(notes, ticks, options.channel), options);
}
