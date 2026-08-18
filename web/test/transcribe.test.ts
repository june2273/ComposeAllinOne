/**
 * 전사 검증 — **답을 아는 합성 f0를 넣는다.**
 *
 * 실제 보컬로는 "맞았는가"를 말할 수 없다(채보 정답이 없다). 대신 정의상
 * 답이 정해진 커브를 만든다 — A4를 1초 유지한 커브의 음표는 A4 하나이고,
 * 120BPM 격자에 4분음표로 놓은 음의 칸 번호는 4의 배수다. `analysis.test.ts`가
 * 클릭 트랙을 쓰는 것과 같은 논법이고, **실제 음원 정확도는 이 테스트가
 * 말해 주지 않는다.**
 */

import { describe, expect, test } from "vitest";

import {
  buildGrid,
  estimateOffsetCurve,
  estimateOffsetMs,
  fromNotes,
  fromQuantized,
  hzToMidi,
  keyAlter,
  keyFifths,
  metricalCost,
  midiToHz,
  notatePiece,
  type NoteEvent,
  offsetAtMs,
  type OnsetCurve,
  type PitchCurve,
  quantizeNotes,
  segmentNotes,
  splitDuration,
  TICKS_PER_BEAT,
  toMidiFiles,
  toMusicXml,
  transcribe,
  tuningDriftCents,
  writeVarLen,
} from "../src/core/transcribe";

const HOP_MS = 10;

/** 초 → 프레임 수 */
function frames(seconds: number): number {
  return Math.round((seconds * 1000) / HOP_MS);
}

/**
 * 커브 만들기. 구간은 `[초, MIDI번호 또는 null(무성)]`.
 * `shape`로 프레임마다 센트를 흔들 수 있다(비브라토·이탈 주입).
 */
function curveOf(
  spans: readonly [number, number | null][],
  shape?: (index: number, midi: number) => number,
): PitchCurve {
  const f0: number[] = [];
  for (const [seconds, midi] of spans) {
    for (let i = 0; i < frames(seconds); i += 1) {
      if (midi === null) {
        f0.push(0);
        continue;
      }
      const cents = shape ? shape(f0.length, midi) : 0;
      f0.push(midiToHz(midi + cents / 100));
    }
  }
  return { hopMs: HOP_MS, f0 };
}

describe("1. 음표 분할 — f0 커브에서 음을 자른다", () => {
  test("한 음을 유지하면 음표 하나가 나온다", () => {
    const notes = segmentNotes(curveOf([[1, 69]]));
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(69);
    expect(notes[0].startSec).toBeCloseTo(0, 2);
    expect(notes[0].endSec).toBeCloseTo(1, 2);
  });

  test("무성 구간이 음을 가른다", () => {
    const notes = segmentNotes(
      curveOf([
        [0.5, 60],
        [0.3, null],
        [0.5, 64],
      ]),
    );
    expect(notes.map((n) => n.midi)).toEqual([60, 64]);
    expect(notes[1].startSec).toBeGreaterThan(notes[0].endSec);
  });

  test("쉼표 없이 음이 바뀌어도 갈린다", () => {
    const notes = segmentNotes(
      curveOf([
        [0.5, 60],
        [0.5, 62],
        [0.5, 64],
      ]),
    );
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64]);
  });

  test("비브라토 ±50센트는 음을 쪼개지 않는다", () => {
    // 6Hz, 진폭 50센트 — 반음의 절반을 왕복한다. 임계값으로 자르면 부서진다.
    const notes = segmentNotes(
      curveOf([[1.5, 69]], (i) => 50 * Math.sin((2 * Math.PI * 6 * i * HOP_MS) / 1000)),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(69);
  });

  test("짧은 옥타브 점프를 따라가지 않는다", () => {
    // f0 추정의 고전적 실패(사양서 §8). 30ms 동안 한 옥타브 위로 튄다.
    const notes = segmentNotes(
      curveOf([[1, 69]], (i) => (i >= 50 && i < 53 ? 1200 : 0)),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(69);
  });

  test("긴 옥타브 이동은 따라간다 — 이탈이 아니라 노래다", () => {
    const notes = segmentNotes(
      curveOf([
        [0.6, 60],
        [0.6, 72],
      ]),
    );
    expect(notes.map((n) => n.midi)).toEqual([60, 72]);
  });

  test("minNoteMs보다 짧은 음은 버린다", () => {
    const notes = segmentNotes(
      curveOf([
        [0.5, 60],
        [0.03, null],
        [0.04, 67],
        [0.03, null],
        [0.5, 60],
      ]),
      { minNoteMs: 100 },
    );
    expect(notes.every((n) => n.midi === 60)).toBe(true);
  });

  test("조율 편차를 보정한다 — 안 하면 절반이 옆 음으로 떨어진다", () => {
    // 곡 전체가 40센트 높게 녹음된 경우. 보정 없이 반올림하면 위태롭다.
    const sharp = curveOf([[1, 69]], () => 40);
    expect(segmentNotes(sharp, { tuningCents: 40 })[0].midi).toBe(69);
    // 보정값을 잘못 넣으면(부호 반대) 벗어난 채로 남는다
    const off = segmentNotes(sharp, { tuningCents: 0 })[0];
    expect(Math.abs(off.centsOffset)).toBeGreaterThan(20);
  });

  test("신뢰도가 낮은 프레임은 무성으로 본다", () => {
    const base = curveOf([[1, 69]]);
    const curve: PitchCurve = {
      ...base,
      confidence: base.f0.map((_, i) => (i < 50 ? 0.05 : 0.9)),
    };
    const notes = segmentNotes(curve, { minConfidence: 0.3 });
    expect(notes).toHaveLength(1);
    expect(notes[0].startSec).toBeGreaterThan(0.3);
  });

  test("음표가 한쪽으로 쏠려 있으면 조율 편차로 읽는다", () => {
    // 곡 전체가 +30센트 올라간 노래. 보정하지 않으면 위태롭다
    const spans: [number, number | null][] = [];
    for (const midi of [60, 64, 67, 62, 65, 69, 60, 64, 67, 62, 65, 69, 71, 72]) {
      spans.push([0.4, midi], [0.1, null]);
    }
    const sharp = segmentNotes(curveOf(spans, () => 30));
    expect(tuningDriftCents(sharp)).toBeCloseTo(30, -1);
    // 맞게 조율된 노래는 0 근처
    expect(Math.abs(tuningDriftCents(segmentNotes(curveOf(spans))) ?? 99)).toBeLessThan(6);
  });

  test("비브라토는 조율 판단을 흔들지 않는다 — 음표 단위로 세기 때문", () => {
    // 프레임을 그대로 모으면 비브라토는 기울기가 0인 양 끝에 프레임이 몰려
    // ±50센트에 가짜 봉우리를 만든다. 음표의 평균을 쓰면 상쇄된다.
    const spans: [number, number | null][] = [];
    for (const midi of [60, 64, 67, 62, 65, 69, 60, 64, 67, 62, 65, 69, 71, 72]) {
      spans.push([0.4, midi], [0.1, null]);
    }
    const wobble = segmentNotes(
      curveOf(spans, (i) => 50 * Math.sin((2 * Math.PI * i * HOP_MS) / 1000 * 6)),
    );
    expect(Math.abs(tuningDriftCents(wobble) ?? 99)).toBeLessThan(10);
  });

  test("표본이 모자라면 null이다 — 없는 값을 지어내지 않는다", () => {
    expect(tuningDriftCents(segmentNotes(curveOf([[0.5, 60]])))).toBeNull();
  });

  test("빈 커브는 빈 결과다", () => {
    expect(segmentNotes({ hopMs: 10, f0: [] })).toEqual([]);
    expect(segmentNotes(curveOf([[1, null]]))).toEqual([]);
  });

  test("hzToMidi와 midiToHz는 서로의 역이다", () => {
    for (const midi of [36, 60, 69, 96]) {
      expect(hzToMidi(midiToHz(midi))).toBeCloseTo(midi, 6);
    }
    expect(hzToMidi(440)).toBe(69);
  });
});

// --- 온셋 경계 ----------------------------------------------------------------

/** ODF 홉. 일부러 f0(10ms)와 다르게 둔다 — 시간으로 맞추는지 보려고 */
const ODF_HOP_MS = 11.6;

/** `초 → 강도` 자리에 봉우리를 세운 온셋 곡선 */
function onsetAt(seconds: readonly number[], durationSec: number, height = 5): OnsetCurve {
  const strength = new Float32Array(Math.ceil((durationSec * 1000) / ODF_HOP_MS));
  for (const at of seconds) {
    const frame = Math.round((at * 1000) / ODF_HOP_MS);
    if (frame >= 0 && frame < strength.length) strength[frame] = height;
  }
  return { hopMs: ODF_HOP_MS, strength };
}

describe("1-b. 온셋 경계 — f0가 표현할 수 없는 재발음", () => {
  /** 같은 음을 1초 내내 유지한 커브. f0만으로는 한 음이다 */
  const held = curveOf([[1, 69]]);

  test("온셋을 안 주면 예전과 똑같다 — 같은 음은 하나로 뭉친다", () => {
    expect(segmentNotes(held)).toHaveLength(1);
  });

  test("온셋이 있으면 같은 음도 갈린다", () => {
    const notes = segmentNotes(held, { onset: onsetAt([0.5], 1) });
    expect(notes.map((n) => n.midi)).toEqual([69, 69]);
    expect(notes[0].endSec).toBeCloseTo(0.5, 1);
    expect(notes[1].startSec).toBeCloseTo(notes[0].endSec, 6);
  });

  test("홉이 달라도 시각으로 맞춘다 — 프레임 번호로 맞추면 곡 끝에서 어긋난다", () => {
    // 11.6ms 격자의 0.9초는 78프레임. 그 번호를 10ms 커브에 그대로 쓰면 0.78초다
    const notes = segmentNotes(held, { onset: onsetAt([0.9], 1) });
    expect(notes).toHaveLength(2);
    expect(notes[0].endSec).toBeCloseTo(0.9, 1);
  });

  test("문턱 아래 봉우리는 경계가 아니다", () => {
    const weak = onsetAt([0.5], 1, 0.4);
    expect(segmentNotes(held, { onset: weak })).toHaveLength(1);
    expect(segmentNotes(held, { onset: weak, onsetStrength: 0.3 })).toHaveLength(2);
  });

  test("양쪽이 최소 길이를 넘을 때만 자른다 — 아니면 조각이 사라져 구멍이 난다", () => {
    // 0.03초 자리에서 자르면 앞 조각이 minNoteMs에 걸려 버려진다.
    // 그러면 자르지 않은 것보다 나빠진다 — 음표가 30ms 늦게 시작한 것도 아니고
    // 아예 없어지므로.
    const notes = segmentNotes(held, { onset: onsetAt([0.03], 1), minNoteMs: 80 });
    expect(notes).toHaveLength(1);
    expect(notes[0].startSec).toBeCloseTo(0, 2);
    expect(notes[0].endSec).toBeCloseTo(1, 2);
  });

  test("음이 바뀌는 자리의 온셋은 아무것도 바꾸지 않는다 — 이미 경계다", () => {
    const changing = curveOf([
      [0.5, 60],
      [0.5, 64],
    ]);
    const plain = segmentNotes(changing);
    const withOnset = segmentNotes(changing, { onset: onsetAt([0.5], 1) });
    expect(withOnset).toEqual(plain);
  });

  test("봉우리 하나가 여러 프레임에 걸쳐도 경계는 하나다", () => {
    // ODF는 온셋 하나를 여러 프레임에 걸쳐 올린다. 그걸 다 세우면 조각이 쏟아진다
    const strength = new Float32Array(Math.ceil(1000 / ODF_HOP_MS));
    for (let i = 40; i <= 46; i += 1) strength[i] = 5 + (i === 43 ? 1 : 0);
    expect(segmentNotes(held, { onset: { hopMs: ODF_HOP_MS, strength } })).toHaveLength(2);
  });

  test("불응기 — 촘촘한 봉우리는 하나로 친다", () => {
    // 40ms 간격으로 셋. 다 세우면 40ms짜리 음표가 생기는데 그건 minNoteMs가
    // 버려서 오히려 구멍이 된다. 애초에 봉우리 단계에서 거른다.
    const notes = segmentNotes(held, { onset: onsetAt([0.4, 0.44, 0.48], 1) });
    expect(notes).toHaveLength(2);
  });

  test("무성 구간의 온셋은 음표를 만들지 않는다", () => {
    const gap = curveOf([
      [0.4, 69],
      [0.3, null],
      [0.4, 69],
    ]);
    const notes = segmentNotes(gap, { onset: onsetAt([0.55], 1.1) });
    expect(notes.map((n) => n.midi)).toEqual([69, 69]);
  });

  test("빈 온셋 곡선은 무시된다", () => {
    expect(segmentNotes(held, { onset: { hopMs: 0, strength: [] } })).toHaveLength(1);
    expect(segmentNotes(held, { onset: { hopMs: ODF_HOP_MS, strength: [] } })).toHaveLength(1);
  });

  test("centsOffset은 조각마다 다시 잰다 — 앞 조각의 값을 물려받지 않는다", () => {
    // 앞 절반은 +40센트, 뒤 절반은 −40센트로 부른 음
    const bent = curveOf([[1, 69]], (i) => (i < 50 ? 40 : -40));
    const notes = segmentNotes(bent, { onset: onsetAt([0.5], 1) });
    expect(notes).toHaveLength(2);
    expect(notes[0].centsOffset).toBeCloseTo(40, 0);
    expect(notes[1].centsOffset).toBeCloseTo(-40, 0);
  });
});

// --- 격자 -------------------------------------------------------------------

/** 120BPM = 0.5초 간격. 4/4 */
function metronome(bars = 4): { beats: number[]; downbeats: number[] } {
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let i = 0; i < bars * 4; i += 1) {
    beats.push(i * 0.5);
    if (i % 4 === 0) downbeats.push(i * 0.5);
  }
  return { beats, downbeats };
}

describe("2. 양자화 — 잡힌 비트가 격자다", () => {
  const { beats, downbeats } = metronome();
  const grid = buildGrid({ beats, downbeats, beatsPerBar: 4 });

  test("한 박이 stepsPerBeat칸이다", () => {
    expect(grid.stepsPerBeat).toBe(4);
    // 첫 다운비트가 0번 칸
    expect(grid.origin).toBe(0);
  });

  test("정박에 놓인 음은 칸 번호가 4의 배수다", () => {
    const notes: NoteEvent[] = [0, 0.5, 1, 1.5].map((t) => ({
      midi: 60,
      startSec: t,
      endSec: t + 0.5,
      velocity: 80,
      centsOffset: 0,
    }));
    const q = quantizeNotes(notes, grid);
    expect(q.map((n) => n.startStep)).toEqual([0, 4, 8, 12]);
    expect(q.map((n) => n.endStep)).toEqual([4, 8, 12, 16]);
  });

  test("조금 밀린 음도 같은 칸으로 간다", () => {
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 0.53, endSec: 0.98, velocity: 80, centsOffset: 0 },
    ];
    expect(quantizeNotes(notes, grid)[0].startStep).toBe(4);
  });

  test("앞 음표를 침범하지 않는다", () => {
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 0, endSec: 0.49, velocity: 80, centsOffset: 0 },
      { midi: 62, startSec: 0.49, endSec: 0.52, velocity: 80, centsOffset: 0 },
      { midi: 64, startSec: 0.52, endSec: 1.0, velocity: 80, centsOffset: 0 },
    ];
    const q = quantizeNotes(notes, grid);
    for (let i = 1; i < q.length; i += 1) {
      expect(q[i].startStep).toBeGreaterThanOrEqual(q[i - 1].endStep);
    }
    // 길이 0짜리 음표는 나오지 않는다
    expect(q.every((n) => n.endStep > n.startStep)).toBe(true);
  });

  test("음가는 발성 길이가 아니라 IOI다 — 아티큘레이션 틈은 사라진다", () => {
    // 사람은 음을 붙여 부르지 않는다. 0.44초 발성 + 0.06초 틈을 그대로 적으면
    // 악보가 `16분쉼표 + 점8분음표`의 연속이 된다(실측).
    const notes: NoteEvent[] = [0, 0.5, 1.0].map((t) => ({
      midi: 60,
      startSec: t,
      endSec: t + 0.44,
      velocity: 80,
      centsOffset: 0,
    }));
    const q = quantizeNotes(notes, grid);
    expect(q.map((n) => [n.startStep, n.endStep])).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
    ]);
  });

  test("실제로 쉰 자리는 쉼표로 남는다", () => {
    // 틈이 IOI의 60%다. 아티큘레이션이라고 볼 수 없다.
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 0, endSec: 0.2, velocity: 80, centsOffset: 0 },
      { midi: 62, startSec: 0.5, endSec: 0.7, velocity: 80, centsOffset: 0 },
    ];
    const q = quantizeNotes(notes, grid);
    expect(q[1].startStep - q[0].endStep).toBeGreaterThan(0);
  });

  test("쉼표 판정은 절대 시간이 아니라 IOI 대비 비율이다", () => {
    // 같은 100ms 틈이라도 4분음표 뒤에서는 아티큘레이션이고 16분음표 뒤에서는
    // 진짜 쉼표다. 절대 시간만으로는 이 둘을 가를 수 없다.
    const afterLong: NoteEvent[] = [
      { midi: 60, startSec: 0, endSec: 0.4, velocity: 80, centsOffset: 0 },
      { midi: 62, startSec: 0.5, endSec: 0.9, velocity: 80, centsOffset: 0 },
    ];
    const afterShort: NoteEvent[] = [
      { midi: 60, startSec: 0, endSec: 0.03, velocity: 80, centsOffset: 0 },
      { midi: 62, startSec: 0.25, endSec: 0.5, velocity: 80, centsOffset: 0 },
    ];
    // 500ms IOI의 100ms = 20% → 아티큘레이션
    const long = quantizeNotes(afterLong, grid);
    expect(long[0].endStep).toBe(long[1].startStep);
    // 250ms IOI의 220ms = 88% → 쉼표
    const short = quantizeNotes(afterShort, grid);
    expect(short[1].startStep - short[0].endStep).toBeGreaterThan(0);
  });

  test("마지막 음표만 발성 길이를 쓴다 — 뒤에 IOI가 없다", () => {
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 0, endSec: 0.44, velocity: 80, centsOffset: 0 },
      { midi: 62, startSec: 0.5, endSec: 1.48, velocity: 80, centsOffset: 0 },
    ];
    const q = quantizeNotes(notes, grid);
    expect(q[1].endStep).toBe(12); // 0.5~1.48초 ≈ 2박
  });

  // --- 반올림이 아니라 DP ------------------------------------------------------

  /** 시작 시각들로 음표를 만든다. 길이는 다음 음까지의 90% */
  function melody(times: readonly number[], span = 0.5): NoteEvent[] {
    return times.map((t, i) => ({
      midi: 60 + (i % 5),
      startSec: t,
      endSec: t + span * 0.9,
      velocity: 80,
      centsOffset: 0,
    }));
  }

  test("체계적으로 늦은 노래를 정박으로 되돌린다", () => {
    // 보컬이 통째로 60ms 늦다. 최근접 반올림이면 절반이 16분 뒤로 밀려
    // 악보 전체가 당김음이 된다 — 이 저장소가 실측으로 겪은 그 증상이다.
    const late = melody([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5].map((t) => t + 0.06));
    const q = quantizeNotes(late, grid);
    expect(q.map((n) => n.startStep)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });

  test("오프셋 추정이 그 밀림을 실제로 찾아낸다", () => {
    const late = melody([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0].map((t) => t + 0.06));
    expect(estimateOffsetMs(late, grid)).toBeCloseTo(60, -1);
    const early = melody([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0].map((t) => t - 0.04));
    expect(estimateOffsetMs(early, grid)).toBeLessThan(0);
  });

  test("지터가 있어도 16분 오프비트로 새지 않는다", () => {
    // 정박 ±35ms로 흔들리는 노래. 반올림이면 일부가 16분 칸(0.125초)으로 간다.
    const jitter = [0.03, -0.035, 0.02, -0.03, 0.035, -0.02, 0.025, -0.033];
    const notes = melody([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5].map((t, i) => t + jitter[i]));
    const q = quantizeNotes(notes, grid);
    expect(q.every((n) => n.startStep % 4 === 0)).toBe(true);
  });

  test("진짜 당김음은 살아남는다 — 임계값이 아니라 저울이다", () => {
    // 8분 오프비트(0.25초 자리)에 일관되게 놓인 음. 편차 비용이 박절 벌점을
    // 이기므로 정박으로 끌려오지 않는다.
    const notes = melody([0.25, 0.75, 1.25, 1.75, 2.25], 0.5);
    const q = quantizeNotes(notes, grid);
    expect(q.map((n) => n.startStep)).toEqual([2, 6, 10, 14, 18]);
  });

  test("드리프트를 따라간다 — 상수 오프셋으로는 못 잡는 밀림", () => {
    // 곡 안에서 밀림의 방향이 뒤집힌다. 앞은 60ms 늦고 뒤는 60ms 이르다.
    // 상수 오프셋 하나로는 어느 쪽도 못 맞춘다(실측: 실곡에서 −56~+60ms).
    const long = buildGrid({ ...metronome(16), beatsPerBar: 4 });
    const times: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const at = i * 0.5;
      times.push(at + 0.06 * Math.cos((Math.PI * at) / 8));
    }
    const notes = melody(times, 0.5);
    const q = quantizeNotes(notes, long);
    // 전부 정박이어야 한다. 16분 자리로 샌 것이 하나도 없어야 한다
    expect(q.filter((n) => n.startStep % 4 !== 0)).toHaveLength(0);
  });

  test("드리프트 곡선이 실제로 그 모양을 그린다", () => {
    const long = buildGrid({ ...metronome(16), beatsPerBar: 4 });
    const times: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const at = i * 0.5;
      times.push(at + 0.05 * Math.cos((Math.PI * at) / 8));
    }
    const curve = estimateOffsetCurve(melody(times, 0.5), long);
    // 앞쪽은 늦고(+), 반주기 뒤에는 일러야(−) 한다
    expect(offsetAtMs(curve, 0.5)).toBeGreaterThan(10);
    expect(offsetAtMs(curve, 8.5)).toBeLessThan(-10);
    // 상수였다면 둘이 같았을 것이다
    expect(offsetAtMs(curve, 0.5)).not.toBeCloseTo(offsetAtMs(curve, 8.5), 0);
  });

  test("곡선이 한 칸을 통째로 밀지 못한다 — 그러면 노래가 달라진다", () => {
    // 격자 한 칸(125ms)만큼 밀린 노래. 다 걷어내면 곡 전체가 16분음표 하나
    // 만큼 밀리는데, 편차 비용이 정확히 같아 그 해를 고를 근거가 없다.
    const long = buildGrid({ ...metronome(16), beatsPerBar: 4 });
    const times = Array.from({ length: 40 }, (_, i) => i * 0.5 + 0.125);
    const curve = estimateOffsetCurve(melody(times, 0.5), long);
    for (const ms of curve.offsetMs) expect(Math.abs(ms)).toBeLessThanOrEqual(63);
  });

  test("드리프트가 있어도 진짜 당김음은 오프비트에 남는다", () => {
    const long = buildGrid({ ...metronome(16), beatsPerBar: 4 });
    const times: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const at = 0.25 + i * 0.5; // 8분 오프비트에 일관되게
      times.push(at + 0.04 * Math.cos((Math.PI * at) / 8));
    }
    const q = quantizeNotes(melody(times, 0.5), long);
    // 전부 8분 자리(짝수 칸이되 4의 배수는 아니다)
    expect(q.every((n) => n.startStep % 4 === 2)).toBe(true);
  });

  test("음표가 적으면 곡선을 만들지 않는다 — 표본이 없다", () => {
    const few = melody([0, 0.5, 1.0], 0.5);
    const curve = estimateOffsetCurve(few, grid);
    expect(curve.atSec).toHaveLength(0);
    // 상수로 떨어져도 값은 나온다
    expect(Number.isFinite(offsetAtMs(curve, 1.0))).toBe(true);
  });

  test("16분 자리는 더 비싸다 — 그래도 정확히 놓인 16분은 산다", () => {
    // 16분 자리(0.125초)에 정확히 놓인 음은 벌점을 물고도 이긴다
    const exact = melody([0.125, 0.625, 1.125], 0.5);
    expect(quantizeNotes(exact, grid, { offsetMs: 0 }).map((n) => n.startStep)).toEqual(
      [1, 5, 9],
    );
    // 배수를 끄면 결과가 같아야 한다(진짜 16분은 배수와 무관하다)
    expect(
      quantizeNotes(exact, grid, { offsetMs: 0, fineBoost: 1 }).map((n) => n.startStep),
    ).toEqual([1, 5, 9]);
  });

  test("박절 비용은 다운비트 < 박 < 8분 < 16분 순이다", () => {
    expect(metricalCost(0, grid)).toBe(0);
    expect(metricalCost(4, grid)).toBeGreaterThan(metricalCost(0, grid));
    expect(metricalCost(2, grid)).toBeGreaterThan(metricalCost(4, grid));
    expect(metricalCost(1, grid)).toBeGreaterThan(metricalCost(2, grid));
    // 못갖춘마디의 음수 칸도 제자리를 찾는다
    expect(metricalCost(-16, grid)).toBe(0);
  });

  test("박절 무게를 0으로 하면 순수 반올림으로 돌아간다", () => {
    const late = melody([0.06, 0.56, 1.06], 0.5);
    const plain = quantizeNotes(late, grid, { metricalWeight: 0, offsetMs: 0 });
    // 0.06초는 0칸(0)과 1칸(0.125) 중 0에 가깝다 — 여기서는 아직 안 밀린다
    expect(plain[0].startStep).toBe(0);
    // 더 밀면 반올림은 넘어가고, 박절 무게가 있으면 버틴다
    const later = melody([0.07, 0.57, 1.07], 0.5);
    expect(quantizeNotes(later, grid, { metricalWeight: 0, offsetMs: 0 })[0].startStep).toBe(1);
    expect(quantizeNotes(later, grid, { offsetMs: 0 })[0].startStep).toBe(0);
  });

  test("음표가 겹치지 않는다 — 빠른 연속에서도", () => {
    const notes = melody([0, 0.1, 0.2, 0.3, 0.4, 0.5], 0.1);
    const q = quantizeNotes(notes, grid);
    for (let i = 1; i < q.length; i += 1) {
      expect(q[i].startStep).toBeGreaterThan(q[i - 1].startStep);
      expect(q[i].startStep).toBeGreaterThanOrEqual(q[i - 1].endStep);
    }
  });

  test("첫 다운비트 이전은 음수 칸이다 — 못갖춘마디", () => {
    const late = buildGrid({
      beats: beats.map((b) => b + 1),
      downbeats: downbeats.map((b) => b + 1),
      beatsPerBar: 4,
    });
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 0.5, endSec: 1.0, velocity: 80, centsOffset: 0 },
    ];
    expect(quantizeNotes(notes, late)[0].startStep).toBeLessThan(0);
  });

  test("비트가 모자라면 빈 격자다", () => {
    const empty = buildGrid({ beats: [1], downbeats: [], beatsPerBar: 4 });
    expect(empty.times).toEqual([]);
    expect(quantizeNotes([], empty)).toEqual([]);
  });

  /**
   * 겹친 비트가 들어오면 중앙값 간격이 0이 되고, 격자 바깥을 그 간격으로
   * 늘리려 들면 **개수가 Infinity가 되어 탭이 멈춘다.** 나쁜 격자를 내주는
   * 것과 브라우저가 죽는 것은 값이 다르다.
   */
  test("비트가 겹쳐 들어와도 멈추지 않는다", () => {
    const degenerate = buildGrid({
      beats: [2, 2, 2, 2],
      downbeats: [2],
      beatsPerBar: 4,
    });
    expect(degenerate.times.length).toBeGreaterThan(0);
    expect(degenerate.times.every((t) => Number.isFinite(t))).toBe(true);
    expect(Number.isFinite(degenerate.origin)).toBe(true);
  });
});

// --- MIDI -------------------------------------------------------------------

interface ParsedNote {
  midi: number;
  on: number;
  off: number;
}

/** 쓴 것을 도로 읽는다. 자체 검증이라 규격 해석이 틀리면 둘 다 틀리지만,
 *  적어도 청크 길이·VLQ·이벤트 짝은 잡힌다. */
function parseMidi(bytes: Uint8Array): {
  division: number;
  usPerBeat: number;
  notes: ParsedNote[];
} {
  const text = (at: number, n: number) =>
    String.fromCharCode(...bytes.slice(at, at + n));
  expect(text(0, 4)).toBe("MThd");
  const division = (bytes[12] << 8) | bytes[13];
  expect(text(14, 4)).toBe("MTrk");
  const length = (bytes[18] << 24) | (bytes[19] << 16) | (bytes[20] << 8) | bytes[21];
  expect(22 + length).toBe(bytes.length);

  let at = 22;
  let tick = 0;
  let usPerBeat = 0;
  const open = new Map<number, number>();
  const notes: ParsedNote[] = [];
  while (at < bytes.length) {
    let delta = 0;
    for (;;) {
      const b = bytes[at++];
      delta = (delta << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    tick += delta;
    const status = bytes[at++];
    if (status === 0xff) {
      const type = bytes[at++];
      let size = 0;
      for (;;) {
        const b = bytes[at++];
        size = (size << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      if (type === 0x51) {
        usPerBeat = (bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2];
      }
      at += size;
      if (type === 0x2f) break;
    } else if ((status & 0xf0) === 0x90) {
      const key = bytes[at++];
      at++; // velocity
      open.set(key, tick);
    } else if ((status & 0xf0) === 0x80) {
      const key = bytes[at++];
      at++;
      const on = open.get(key);
      if (on !== undefined) {
        notes.push({ midi: key, on, off: tick });
        open.delete(key);
      }
    } else {
      throw new Error(`알 수 없는 상태 바이트 0x${status.toString(16)}`);
    }
  }
  expect(open.size).toBe(0); // 열린 채 끝난 음이 없어야 한다
  return { division, usPerBeat, notes };
}

describe("3. MIDI 쓰기", () => {
  test("가변 길이 수량", () => {
    expect(writeVarLen(0)).toEqual([0x00]);
    expect(writeVarLen(127)).toEqual([0x7f]);
    expect(writeVarLen(128)).toEqual([0x81, 0x00]);
    expect(writeVarLen(0x3fff)).toEqual([0xff, 0x7f]);
  });

  test("쓴 것을 도로 읽으면 같은 음이 나온다", () => {
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 0, endSec: 0.5, velocity: 80, centsOffset: 0 },
      { midi: 64, startSec: 0.5, endSec: 1.0, velocity: 80, centsOffset: 0 },
      { midi: 67, startSec: 1.0, endSec: 2.0, velocity: 80, centsOffset: 0 },
    ];
    const parsed = parseMidi(fromNotes(notes, { bpm: 120 }));
    expect(parsed.division).toBe(TICKS_PER_BEAT);
    expect(parsed.usPerBeat).toBe(500_000); // 120BPM
    expect(parsed.notes.map((n) => n.midi)).toEqual([60, 64, 67]);
    // 120BPM에서 0.5초 = 1박 = 480틱
    expect(parsed.notes[1].on).toBe(TICKS_PER_BEAT);
    expect(parsed.notes[2].off - parsed.notes[2].on).toBe(TICKS_PER_BEAT * 2);
  });

  test("같은 음 연타가 살아난다 — off가 on보다 먼저 나간다", () => {
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 0, endSec: 0.5, velocity: 80, centsOffset: 0 },
      { midi: 60, startSec: 0.5, endSec: 1.0, velocity: 80, centsOffset: 0 },
    ];
    const parsed = parseMidi(fromNotes(notes, { bpm: 120 }));
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes[0].off).toBe(parsed.notes[1].on);
  });

  test("못갖춘마디의 음수 칸을 0으로 민다", () => {
    const grid = buildGrid({ beats: [1, 1.5, 2, 2.5, 3], downbeats: [2], beatsPerBar: 4 });
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 1.0, endSec: 1.5, velocity: 80, centsOffset: 0 },
      { midi: 62, startSec: 2.0, endSec: 2.5, velocity: 80, centsOffset: 0 },
    ];
    const q = quantizeNotes(notes, grid);
    expect(q[0].startStep).toBeLessThan(0);
    const parsed = parseMidi(fromQuantized(q, grid, { bpm: 120 }));
    expect(parsed.notes[0].on).toBe(0);
    expect(parsed.notes.every((n) => n.on >= 0)).toBe(true);
  });

  test("빈 음표 목록도 읽을 수 있는 파일이 된다", () => {
    expect(parseMidi(fromNotes([], { bpm: 100 })).notes).toEqual([]);
  });
});

// --- MusicXML ---------------------------------------------------------------

/** 마디별 duration 합. 박자와 맞지 않으면 verovio가 조용히 밀린다 */
function measureSums(xml: string): number[] {
  return [...xml.matchAll(/<measure\b[^>]*>(.*?)<\/measure>/gsu)].map(([, body]) =>
    [...body.matchAll(/<duration>(\d+)<\/duration>/gu)].reduce(
      (sum, [, value]) => sum + Number(value),
      0,
    ),
  );
}

describe("4. MusicXML", () => {
  const { beats, downbeats } = metronome(2);
  const grid = buildGrid({ beats, downbeats, beatsPerBar: 4 });

  test("음가 분해는 합이 정확하다", () => {
    for (let units = 1; units <= 16; units += 1) {
      const sum = splitDuration(units).reduce((total, d) => total + d.units, 0);
      expect(sum).toBe(units);
    }
  });

  test("박 경계 분해도 합이 정확하다 — 어느 자리에서 시작하든", () => {
    for (let at = 0; at < 16; at += 1) {
      for (let units = 1; units + at <= 16; units += 1) {
        const sum = notatePiece(at, units).reduce((t, d) => t + d.units, 0);
        expect(sum).toBe(units);
      }
    }
  });

  test("박 위에서 시작하면 통짜로 적는다", () => {
    // 2분음표·점2분음표는 여러 박에 걸쳐도 관례상 하나로 적는다
    expect(notatePiece(0, 8).map((d) => d.type)).toEqual(["half"]);
    expect(notatePiece(4, 8).map((d) => d.type)).toEqual(["half"]);
    expect(notatePiece(0, 12).map((d) => [d.type, d.dots])).toEqual([["half", 1]]);
  });

  test("박을 넘는 조각은 박 위에서 시작할 때만 통짜다", () => {
    // 이것이 이 함수의 존재 이유다. 그리디만 쓰면 박 한가운데서 시작한 음이
    // 점음표 하나로 적혀 **박 경계가 보이지 않는다** — 실측한 악보가 점8분음표
    // 투성이였던 이유다.
    const PER_BEAT = 4;
    for (let at = 0; at < 16; at += 1) {
      let cursor = at;
      for (const piece of notatePiece(at, 16 - at)) {
        const startsOnBeat = cursor % PER_BEAT === 0;
        const crosses =
          Math.floor(cursor / PER_BEAT) !==
          Math.floor((cursor + piece.units - 1) / PER_BEAT);
        expect(startsOnBeat || !crosses).toBe(true);
        cursor += piece.units;
      }
    }
  });

  test("박을 넘으면 그 자리에서 갈린다", () => {
    // 16분 오프셋에서 5칸 — 박(4) 위를 지난다
    expect(notatePiece(1, 5).map((d) => [d.type, d.dots])).toEqual([
      ["eighth", 1], // 1~4, 박 경계에서 끝난다
      ["eighth", 0], // 4~6
    ]);
    // 8분 오프비트의 4분음표(관례적 당김음)는 붙임줄 둘로 갈린다 — v1 한계
    expect(notatePiece(2, 4).map((d) => d.type)).toEqual(["eighth", "eighth"]);
  });

  test("모든 마디의 음가 합이 박자와 같다", () => {
    const notes: NoteEvent[] = [0, 0.5, 1.0, 1.5, 2.0].map((t) => ({
      midi: 60 + t * 2,
      startSec: t,
      endSec: t + 0.5,
      velocity: 80,
      centsOffset: 0,
    }));
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
    });
    for (const sum of measureSums(xml)) expect(sum).toBe(16);
  });

  test("쉼표로 빈 자리를 메운다", () => {
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 1.0, endSec: 1.5, velocity: 80, centsOffset: 0 },
    ];
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
    });
    expect(xml).toContain("<rest/>");
    for (const sum of measureSums(xml)) expect(sum).toBe(16);
  });

  test("마디를 넘는 음은 붙임줄로 쪼갠다", () => {
    // 2박부터 4박 길이 = 다음 마디로 넘어간다
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 1.0, endSec: 3.0, velocity: 80, centsOffset: 0 },
    ];
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
    });
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
    for (const sum of measureSums(xml)) expect(sum).toBe(16);
  });

  test("템포가 들어간다 — 없으면 읽는 쪽이 120으로 연다", () => {
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 0, endSec: 0.5, velocity: 80, centsOffset: 0 },
    ];
    const q = quantizeNotes(notes, grid);
    const xml = toMusicXml(q, { beatsPerBar: 4, stepsPerBeat: 4, bpm: 139 });
    expect(xml).toContain("<per-minute>139</per-minute>");
    expect(xml).toContain('<sound tempo="139"/>');
    expect(xml).toContain("<beat-unit>quarter</beat-unit>");
    // <direction>은 <attributes> 뒤, 첫 <note> 앞이다
    expect(xml.indexOf("<direction")).toBeGreaterThan(xml.indexOf("</attributes>"));
    expect(xml.indexOf("<direction")).toBeLessThan(xml.indexOf("<note>"));
    // 안 주면 아예 안 나간다
    expect(toMusicXml(q, { beatsPerBar: 4, stepsPerBeat: 4 })).not.toContain("<sound");
  });

  test("가사는 기본으로 넣지 않는다 — 오선 아래가 la로 덮이면 읽기만 나쁘다", () => {
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 0, endSec: 0.5, velocity: 80, centsOffset: 0 },
    ];
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
    });
    expect(xml).not.toContain("<lyric>");
  });

  test("가사를 주면 음표마다 붙는다. 쉼표에는 안 붙는다", () => {
    // 음 셋 + 사이의 빈 자리(쉼표)
    const notes: NoteEvent[] = [0, 1.0, 2.0].map((t) => ({
      midi: 60,
      startSec: t,
      endSec: t + 0.5,
      velocity: 80,
      centsOffset: 0,
    }));
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
      lyric: "la",
    });
    expect(xml).toContain("<rest/>");
    expect([...xml.matchAll(/<lyric>/gu)]).toHaveLength(3);
    expect(xml).toContain("<lyric><syllabic>single</syllabic><text>la</text>");
    // <note>의 자식 순서 — lyric은 notations 뒤다
    expect(xml).not.toMatch(/<lyric>.*<notations>/su);
  });

  test("붙임줄로 이어받은 음에는 가사를 다시 붙이지 않는다", () => {
    // 마디를 넘는 음 하나 → <note>는 둘, 음절은 하나
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 1.0, endSec: 3.0, velocity: 80, centsOffset: 0 },
    ];
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
      lyric: "la",
    });
    expect(xml).toContain('<tie type="stop"/>');
    expect([...xml.matchAll(/<lyric>/gu)]).toHaveLength(1);
  });

  test("빔이 박 단위로 묶인다 — 악보에서 박을 드러내는 것은 빔이다", () => {
    // 8분음표 여덟 개. 박마다 둘씩, 네 묶음이어야 한다.
    const notes: NoteEvent[] = Array.from({ length: 8 }, (_, i) => ({
      midi: 60,
      startSec: i * 0.25,
      endSec: i * 0.25 + 0.25,
      velocity: 80,
      centsOffset: 0,
    }));
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
    });
    expect([...xml.matchAll(/<beam number="1">begin<\/beam>/gu)]).toHaveLength(4);
    expect([...xml.matchAll(/<beam number="1">end<\/beam>/gu)]).toHaveLength(4);
    // 박을 넘어 묶이지 않는다 — continue가 없어야 한다(묶음이 둘씩이므로)
    expect(xml).not.toContain('<beam number="1">continue</beam>');
  });

  test("쉼표가 빔 묶음을 끊는다", () => {
    // 8분 + 8분쉼표 + 8분. 가운데가 끊기므로 어느 것도 묶이지 않는다
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 0, endSec: 0.24, velocity: 80, centsOffset: 0 },
      { midi: 62, startSec: 0.5, endSec: 0.74, velocity: 80, centsOffset: 0 },
    ];
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
    });
    expect(xml).toContain("<rest/>");
    expect(xml).not.toContain("<beam");
  });

  test("16분음표는 겹빔이 걸린다", () => {
    const notes: NoteEvent[] = Array.from({ length: 4 }, (_, i) => ({
      midi: 60,
      startSec: i * 0.125,
      endSec: i * 0.125 + 0.125,
      velocity: 80,
      centsOffset: 0,
    }));
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
    });
    expect(xml).toContain('<beam number="2">begin</beam>');
  });

  test("조표가 표기를 고른다 — ♯계와 ♭계", () => {
    const notes: NoteEvent[] = [
      { midi: 61, startSec: 0, endSec: 0.5, velocity: 80, centsOffset: 0 },
    ];
    const q = quantizeNotes(notes, grid);
    const sharp = toMusicXml(q, { beatsPerBar: 4, stepsPerBeat: 4, fifths: 3 });
    const flat = toMusicXml(q, { beatsPerBar: 4, stepsPerBeat: 4, fifths: -3 });
    expect(sharp).toContain("<step>C</step><alter>1</alter>");
    expect(flat).toContain("<step>D</step><alter>-1</alter>");
  });

  test("조성에서 조표를 얻는다", () => {
    expect(keyFifths(0, "major")).toBe(0); // C 장조
    expect(keyFifths(7, "major")).toBe(1); // G 장조
    expect(keyFifths(5, "major")).toBe(-1); // F 장조
    expect(keyFifths(9, "minor")).toBe(0); // A 단조
    expect(keyFifths(1, "major")).toBe(-5); // D♭ 장조
  });

  test("♭계 단조의 이끎음은 ♯으로 적는다", () => {
    // D단조(♭1)의 이끎음은 C♯이다. 조표 방향만 따르면 D♭이 되어 —
    // 소리는 같지만 **읽는 것이 틀린다.** 단조 멜로디에서 거의 매 프레이즈 나온다.
    const notes: NoteEvent[] = [
      { midi: 61, startSec: 0, endSec: 0.5, velocity: 80, centsOffset: 0 },
    ];
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
      key: { tonic: 2, mode: "minor" },
    });
    expect(xml).toContain("<step>C</step><alter>1</alter>");
    expect(xml).toContain("<accidental>sharp</accidental>");
  });

  test("이끎음 예외는 그 음 하나뿐이다", () => {
    // G단조(♭2)에서 이끎음은 F♯. 같은 조의 E♭은 그대로 ♭계로 적혀야 한다.
    const notes: NoteEvent[] = [
      { midi: 66, startSec: 0, endSec: 0.5, velocity: 80, centsOffset: 0 }, // F♯
      { midi: 63, startSec: 0.5, endSec: 1.0, velocity: 80, centsOffset: 0 }, // E♭
    ];
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
      key: { tonic: 7, mode: "minor" },
    });
    expect(xml).toContain("<step>F</step><alter>1</alter>");
    expect(xml).toContain("<step>E</step><alter>-1</alter>");
  });

  test("조표가 바꾸는 음을 되돌리면 제자리표가 나간다", () => {
    // C단조(♭3)의 B♮. 제자리표 없이 내보내면 조표의 B♭이 살아 있어
    // **악보에는 B♭으로 보인다** — 소리는 맞는데 읽는 것이 틀린다.
    const notes: NoteEvent[] = [
      { midi: 71, startSec: 0, endSec: 0.5, velocity: 80, centsOffset: 0 },
    ];
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
      key: { tonic: 0, mode: "minor" },
    });
    expect(xml).toContain("<step>B</step>");
    expect(xml).toContain("<accidental>natural</accidental>");
  });

  test("조표에 이미 있는 음에는 임시표를 찍지 않는다", () => {
    // F장조(♭1)의 B♭. 조표가 이미 말하고 있으므로 기호가 붙으면 안 된다.
    const notes: NoteEvent[] = [
      { midi: 70, startSec: 0, endSec: 0.5, velocity: 80, centsOffset: 0 },
    ];
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
      key: { tonic: 5, mode: "major" },
    });
    expect(xml).toContain("<step>B</step><alter>-1</alter>");
    expect(xml).not.toContain("<accidental>");
  });

  test("마디가 바뀌면 임시표가 되살아난다", () => {
    // 임시표의 유효 범위는 마디 하나다. 다음 마디의 같은 음에는 다시 찍는다.
    const notes: NoteEvent[] = [0, 2.0].map((t) => ({
      midi: 61,
      startSec: t,
      endSec: t + 0.5,
      velocity: 80,
      centsOffset: 0,
    }));
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
      fifths: 0,
    });
    expect([...xml.matchAll(/<accidental>/gu)]).toHaveLength(2);
  });

  test("붙임줄로 이어받은 음에는 임시표를 다시 찍지 않는다", () => {
    // 마디를 넘어온 같은 음이라 새로 울리는 것이 아니다.
    const notes: NoteEvent[] = [
      { midi: 61, startSec: 1.0, endSec: 3.0, velocity: 80, centsOffset: 0 },
    ];
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
      fifths: 0,
    });
    expect(xml).toContain('<tie type="start"/>');
    expect([...xml.matchAll(/<accidental>/gu)]).toHaveLength(1);
  });

  test("조표 계산", () => {
    expect(keyAlter("B", -1)).toBe(-1); // F장조의 B♭
    expect(keyAlter("E", -1)).toBe(0);
    expect(keyAlter("F", 1)).toBe(1); // G장조의 F♯
    expect(keyAlter("C", 1)).toBe(0);
    expect(keyAlter("C", 0)).toBe(0);
  });

  test("같은 마디에서 임시표를 두 번 찍지 않는다", () => {
    const notes: NoteEvent[] = [0, 0.5].map((t) => ({
      midi: 61,
      startSec: t,
      endSec: t + 0.5,
      velocity: 80,
      centsOffset: 0,
    }));
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
      fifths: 0,
    });
    const first = xml.slice(0, xml.indexOf("</measure>"));
    expect([...first.matchAll(/<accidental>/gu)]).toHaveLength(1);
  });

  test("못갖춘마디는 0마디다 — 뒤의 번호가 밀리면 악보 대조가 어긋난다", () => {
    const late = buildGrid({
      beats: beats.map((b) => b + 2),
      downbeats: downbeats.map((b) => b + 2),
      beatsPerBar: 4,
    });
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 1.5, endSec: 2.0, velocity: 80, centsOffset: 0 },
      { midi: 62, startSec: 2.0, endSec: 2.5, velocity: 80, centsOffset: 0 },
    ];
    const q = quantizeNotes(notes, late);
    expect(q[0].startStep).toBeLessThan(0);
    const xml = toMusicXml(q, { beatsPerBar: 4, stepsPerBeat: 4 });
    expect(xml).toContain('<measure number="0">');
    expect(xml).toContain('<measure number="1">');
  });

  test("못갖춘마디가 없으면 1마디부터다", () => {
    const notes: NoteEvent[] = [
      { midi: 60, startSec: 0, endSec: 0.5, velocity: 80, centsOffset: 0 },
    ];
    const xml = toMusicXml(quantizeNotes(notes, grid), {
      beatsPerBar: 4,
      stepsPerBeat: 4,
    });
    expect(xml).toContain('<measure number="1">');
    expect(xml).not.toContain('<measure number="0">');
  });

  test("음이 하나도 없어도 악보가 나온다", () => {
    const xml = toMusicXml([], { beatsPerBar: 3, stepsPerBeat: 4 });
    expect(xml).toContain("<beats>3</beats>");
    expect(measureSums(xml)).toEqual([12]);
  });

  // --- 코드 심볼 ---------------------------------------------------------------

  describe("코드 심볼", () => {
    /** 4분음표 여덟 개 = 두 마디. 자리를 세기 쉬운 바탕이다 */
    const notes: NoteEvent[] = Array.from({ length: 8 }, (_, i) => ({
      midi: 60,
      startSec: i * 0.5,
      endSec: i * 0.5 + 0.5,
      velocity: 80,
      centsOffset: 0,
    }));
    const quantized = quantizeNotes(notes, grid);

    test("마디마다 첫 음표 앞에 붙는다", () => {
      const xml = toMusicXml(quantized, {
        beatsPerBar: 4,
        stepsPerBeat: 4,
        // 한 마디는 16칸이다(stepsPerBeat 4 × 4박) — 칸 번호는 박이 아니다
        harmony: [
          { step: 0, root: 0, kind: "major", text: "" },
          { step: 16, root: 7, kind: "dominant", text: "7" },
        ],
      });
      const bars = [...xml.matchAll(/<measure\b[^>]*>(.*?)<\/measure>/gsu)];
      expect(bars).toHaveLength(2);
      // 각 마디의 <harmony>가 그 마디 첫 <note>보다 앞이다
      for (const [, body] of bars) {
        expect(body.indexOf("<harmony")).toBeGreaterThanOrEqual(0);
        expect(body.indexOf("<harmony")).toBeLessThan(body.indexOf("<note>"));
      }
      expect(bars[0][1]).toContain("<root-step>C</root-step>");
      expect(bars[0][1]).toContain('<kind text="">major</kind>');
      expect(bars[1][1]).toContain("<root-step>G</root-step>");
      expect(bars[1][1]).toContain('<kind text="7">dominant</kind>');
    });

    /**
     * **`<harmony>`는 시간을 소비하지 않는다.** 마디 안 음가 합이 흔들리면
     * verovio가 그 마디부터 조용히 밀린다.
     */
    test("음가 합을 바꾸지 않는다", () => {
      const plain = toMusicXml(quantized, { beatsPerBar: 4, stepsPerBeat: 4 });
      const withChords = toMusicXml(quantized, {
        beatsPerBar: 4,
        stepsPerBeat: 4,
        harmony: [
          { step: 0, root: 0, kind: "major", text: "" },
          { step: 2, root: 5, kind: "major", text: "" },
          { step: 4, root: 7, kind: "dominant", text: "7" },
        ],
      });
      expect(measureSums(withChords)).toEqual(measureSums(plain));
    });

    /**
     * 코드가 음표 머리에 안 떨어지면 `<offset>`으로 민다. 기준은 **지금 커서**,
     * 즉 바로 뒤 음표의 자리다.
     */
    test("음표 사이에 떨어지면 offset으로 민다", () => {
      // 온음표 하나뿐인 마디 — 2박째에 코드가 온다
      const whole: NoteEvent[] = [
        { midi: 60, startSec: 0, endSec: 2, velocity: 80, centsOffset: 0 },
      ];
      const xml = toMusicXml(quantizeNotes(whole, grid), {
        beatsPerBar: 4,
        stepsPerBeat: 4,
        harmony: [{ step: 8, root: 5, kind: "minor", text: "m" }],
      });
      // 칸 8 = 2박 = divisions 8. 마디 머리의 커서에서 8만큼 떨어져 있다
      expect(xml).toContain("<offset>8</offset>");
      expect(xml).toContain("<root-step>F</root-step>");
      // 자식 순서는 규격이다 — root → kind → offset
      expect(xml).toMatch(/<root>.*<kind[^>]*>.*<\/kind><offset>/su);
    });

    test("머리에 정확히 떨어지면 offset을 안 낸다", () => {
      const xml = toMusicXml(quantized, {
        beatsPerBar: 4,
        stepsPerBeat: 4,
        harmony: [{ step: 0, root: 0, kind: "major", text: "" }],
      });
      expect(xml).not.toContain("<offset>");
    });

    /**
     * **근음 표기는 음표와 같은 규칙을 따라야 한다.** 악보 위의 `G♭`과 오선
     * 위의 `F♯`이 같은 음을 가리키면 읽는 사람이 둘 중 하나를 오타로 읽는다.
     */
    test("♭계 조에서는 근음도 ♭로 적는다", () => {
      const sharp = toMusicXml(quantized, {
        beatsPerBar: 4,
        stepsPerBeat: 4,
        fifths: 2,
        harmony: [{ step: 0, root: 6, kind: "major", text: "" }],
      });
      expect(sharp).toContain("<root-step>F</root-step><root-alter>1</root-alter>");

      const flat = toMusicXml(quantized, {
        beatsPerBar: 4,
        stepsPerBeat: 4,
        fifths: -2,
        harmony: [{ step: 0, root: 6, kind: "major", text: "" }],
      });
      expect(flat).toContain("<root-step>G</root-step><root-alter>-1</root-alter>");
    });

    /**
     * 단조의 이끎음 예외(`spellingFor`)는 **선율 표기 규칙**이다. 근음에 걸면
     * D단조에서 근음 D♭이 C♯으로 바뀌는 엉뚱한 일이 난다.
     */
    test("근음에는 단조 이끎음 예외를 걸지 않는다", () => {
      const xml = toMusicXml(quantized, {
        beatsPerBar: 4,
        stepsPerBeat: 4,
        key: { tonic: 2, mode: "minor" }, // D단조 → ♭계(fifths −1)
        harmony: [{ step: 0, root: 1, kind: "major", text: "" }],
      });
      expect(xml).toContain("<root-step>D</root-step><root-alter>-1</root-alter>");
      expect(xml).not.toContain("<root-step>C</root-step><root-alter>1</root-alter>");
    });

    test("근음이 흰건반이면 root-alter를 안 낸다", () => {
      const xml = toMusicXml(quantized, {
        beatsPerBar: 4,
        stepsPerBeat: 4,
        harmony: [{ step: 0, root: 4, kind: "minor", text: "m" }],
      });
      expect(xml).toContain("<root><root-step>E</root-step></root>");
      expect(xml).not.toContain("<root-alter>");
    });

    test("코드를 안 주면 <harmony>가 아예 안 나간다", () => {
      const xml = toMusicXml(quantized, { beatsPerBar: 4, stepsPerBeat: 4 });
      expect(xml).not.toContain("<harmony");
    });

    /**
     * 악보 범위 밖의 코드가 통째로 사라지면 곡의 첫 코드가 없어진다 —
     * 비트가 첫 다운비트보다 앞서면 칸 번호가 음수가 된다.
     */
    test("첫 마디보다 앞선 코드는 버리지 않고 당긴다", () => {
      const xml = toMusicXml(quantized, {
        beatsPerBar: 4,
        stepsPerBeat: 4,
        harmony: [{ step: -3, root: 9, kind: "minor", text: "m" }],
      });
      expect(xml).toContain("<root-step>A</root-step>");
      expect(measureSums(xml)).toEqual([16, 16]);
    });
  });
});

// --- 종단 -------------------------------------------------------------------

describe("5. transcribe() 종단", () => {
  const { beats, downbeats } = metronome(2);

  test("커브 하나에서 음표·격자·악보가 한꺼번에 나온다", () => {
    const curve = curveOf([
      [0.5, 60],
      [0.5, 62],
      [0.5, 64],
      [0.5, 65],
    ]);
    const result = transcribe(curve, {
      bpm: 120,
      beats,
      downbeats,
      beatsPerBar: 4,
      key: { tonic: 0, mode: "major" },
    });
    expect(result.notes.map((n) => n.midi)).toEqual([60, 62, 64, 65]);
    expect(result.quantized.map((n) => n.startStep)).toEqual([0, 4, 8, 12]);
    expect(result.fifths).toBe(0);
    for (const sum of measureSums(result.musicXml)) expect(sum).toBe(16);
  });

  /**
   * **코드는 초로 들어와 격자 칸이 되어 나간다.** 호출부가 자기 격자를 짐작해
   * 칸 번호를 계산하면 두 격자가 갈려 코드가 음표와 다른 자리에 앉는다.
   */
  test("코드를 주면 악보에 심볼이 얹힌다 — 초가 격자 칸이 된다", () => {
    const curve = curveOf([
      [0.5, 60],
      [0.5, 62],
      [0.5, 64],
      [0.5, 65],
    ]);
    const result = transcribe(curve, {
      bpm: 120,
      beats,
      downbeats,
      beatsPerBar: 4,
      key: { tonic: 0, mode: "major" },
      // 0초 = 첫 다운비트, 1초 = 3박째
      chords: [
        { atSec: 0, root: 0, kind: "major", text: "" },
        { atSec: 1, root: 5, kind: "major", text: "" },
      ],
    });
    expect(result.musicXml).toContain("<root-step>C</root-step>");
    expect(result.musicXml).toContain("<root-step>F</root-step>");
    // 1초 = 3박째. 거기 4분음표가 하나 서 있으므로 **그 음표 바로 앞**에
    // 붙고 `<offset>`은 필요 없다(음표가 없는 자리일 때만 민다).
    const notes = [...result.musicXml.matchAll(/<harmony|<note>/gu)].map((m) => m[0]);
    expect(notes).toEqual(["<harmony", "<note>", "<note>", "<harmony", "<note>", "<note>"]);
    expect(result.musicXml).not.toContain("<offset>");
    // 음가 합은 그대로여야 한다
    for (const sum of measureSums(result.musicXml)) expect(sum).toBe(16);
  });

  /**
   * **가창 합성기용 파일에는 코드를 넣지 않는다.** 신스V가 읽는 것은 음표와
   * 음절이고, 코드 심볼은 거기서 쓰이지 않는다 — 화면 악보에 `la`를 안 거는
   * 것과 같은 방침이다.
   */
  test("코드는 악보에만, 가사판에는 안 들어간다", () => {
    const result = transcribe(curveOf([[0.5, 60]]), {
      bpm: 120,
      beats,
      downbeats,
      beatsPerBar: 4,
      chords: [{ atSec: 0, root: 0, kind: "major", text: "" }],
    });
    expect(result.musicXml).toContain("<harmony");
    expect(result.vocalXml).not.toContain("<harmony");
    expect(result.vocalXml).toContain("<lyric>");
  });

  test("체계적으로 늦게 부른 노래도 정박으로 적힌다", () => {
    // 이 작업 전체가 겨냥한 증상. 실곡에서는 이것이 악보 전체를 당김음으로
    // 만들었다(점8분쉼표 + 16분음표의 연속).
    const spans: [number, number | null][] = [[0.05, null]];
    for (const midi of [60, 62, 64, 65, 67, 69, 71, 72]) {
      spans.push([0.44, midi], [0.06, null]);
    }
    const result = transcribe(curveOf(spans), {
      bpm: 120,
      beats,
      downbeats,
      beatsPerBar: 4,
    });
    expect(result.offsetMs).toBeGreaterThan(20);
    expect(result.quantized.every((n) => n.startStep % 4 === 0)).toBe(true);
    expect(result.musicXml).not.toContain("<rest/>");
  });

  test("양자화 전 시각이 남아 있다 — 되돌릴 수 없는 정보다", () => {
    const curve = curveOf([
      [0.06, null],
      [0.47, 60],
    ]);
    const result = transcribe(curve, { bpm: 120, beats, downbeats, beatsPerBar: 4 });
    expect(result.notes[0].startSec).toBeCloseTo(0.06, 2);
    expect(result.quantized[0].startStep).toBe(0); // 격자에서는 정박
  });

  test("비트를 못 잡아도 BPM으로 격자를 세운다", () => {
    const result = transcribe(curveOf([[1, 69]]), {
      bpm: 120,
      beats: [],
      downbeats: [],
      beatsPerBar: 4,
    });
    expect(result.notes).toHaveLength(1);
    expect(result.grid.times.length).toBeGreaterThan(0);
    expect(result.musicXml).toContain("<score-partwise");
  });

  test("MIDI 두 벌 — 노래한 것과 격자에 얹은 것", () => {
    const curve = curveOf([
      [0.06, null],
      [0.47, 60],
      [0.5, 62],
    ]);
    const result = transcribe(curve, { bpm: 120, beats, downbeats, beatsPerBar: 4 });
    const files = toMidiFiles(result, { bpm: 120, beatsPerBar: 4 });
    const performed = parseMidi(files.performed);
    const quantized = parseMidi(files.quantized);
    expect(performed.notes.map((n) => n.midi)).toEqual(
      quantized.notes.map((n) => n.midi),
    );
    // 노래한 쪽은 정박이 아니고, 격자 쪽은 정박이다
    expect(performed.notes[0].on).not.toBe(0);
    expect(quantized.notes[0].on).toBe(0);
  });
});
