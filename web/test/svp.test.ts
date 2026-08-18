/**
 * 피치 커브 내보내기 — **답을 아는 합성 커브로 검증한다.**
 *
 * `transcribe.test.ts`와 같은 논법이다. A4를 1초 유지한 커브의 컨트롤 점은
 * 전부 69여야 하고, 5Hz로 ±50센트 흔든 커브의 점들은 그 진폭을 그대로 갖고
 * 있어야 한다(줄이기가 봉우리를 깎으면 안 된다).
 *
 * **`.svp`가 신스V에서 실제로 그 커브대로 소리 나는지는 여기서 말할 수 없다.**
 * 그건 렌더 → f0 재추출 왕복으로만 잴 수 있고, 이 파일이 보증하는 것은
 * "형식이 맞는가"와 "시간축이 어긋나지 않는가"까지다.
 */

import { describe, expect, test } from "vitest";

import {
  BLICKS_PER_QUARTER,
  buildGrid,
  buildPitchTrack,
  midiToHz,
  type NoteEvent,
  type PitchCurve,
  segmentNotes,
  toSvp,
  transcribe,
} from "../src/core/transcribe";

const HOP_MS = 10;

function frames(seconds: number): number {
  return Math.round((seconds * 1000) / HOP_MS);
}

/** 구간은 `[초, MIDI 또는 null(무성)]`. `shape`가 프레임마다 센트를 얹는다 */
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
      f0.push(midiToHz(midi + (shape ? shape(f0.length, midi) : 0) / 100));
    }
  }
  return { hopMs: HOP_MS, f0 };
}

function noteOf(midi: number, startSec: number, endSec: number): NoteEvent {
  return { midi, startSec, endSec, velocity: 80, centsOffset: 0 };
}

/** 120BPM = 0.5초 간격, 4/4 */
function metronome(bars = 4): { beats: number[]; downbeats: number[] } {
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let i = 0; i < bars * 4; i += 1) {
    beats.push(i * 0.5);
    if (i % 4 === 0) downbeats.push(i * 0.5);
  }
  return { beats, downbeats };
}

describe("1. 컨트롤 점 — 커브를 음표에 정합시킨다", () => {
  test("유지음은 점 둘로 줄어든다", () => {
    const curve = curveOf([[1, 69]]);
    const track = buildPitchTrack([noteOf(69, 0, 1)], curve);

    expect(track.rawCount).toBe(100);
    expect(track.points.length).toBe(2);
    for (const point of track.points) expect(point.midi).toBeCloseTo(69, 6);
  });

  test("비브라토의 진폭이 살아남는다 — 줄이기가 봉우리를 깎지 않는다", () => {
    // 5Hz, ±50센트
    const curve = curveOf([[2, 69]], (i) =>
      50 * Math.sin((2 * Math.PI * 5 * i * HOP_MS) / 1000),
    );
    const track = buildPitchTrack([noteOf(69, 0, 2)], curve);

    const highest = Math.max(...track.points.map((p) => p.midi));
    const lowest = Math.min(...track.points.map((p) => p.midi));
    // 봉우리에서 골까지 100센트 = 1반음
    expect((highest - lowest) * 100).toBeGreaterThan(95);

    // 그런데 프레임 전부를 쓰지는 않는다
    expect(track.rawCount).toBe(200);
    expect(track.points.length).toBeLessThan(150);
    // 봉우리·골이 20개(2초 × 5Hz × 2)이므로 그보다는 많아야 한다
    expect(track.points.length).toBeGreaterThan(20);
  });

  test("한 옥타브 튄 프레임을 음표 쪽으로 끌어당긴다", () => {
    // 가운데 0.2초만 한 옥타브 아래로 떨어진다
    const curve = curveOf([
      [0.4, 69],
      [0.2, 57],
      [0.4, 69],
    ]);
    const track = buildPitchTrack([noteOf(69, 0, 1)], curve);

    expect(track.octaveSnapped).toBe(frames(0.2));
    for (const point of track.points) expect(point.midi).toBeCloseTo(69, 6);
  });

  test("반옥타브 안의 이탈은 그대로 둔다 — 스쿠핑을 지우면 안 된다", () => {
    const curve = curveOf([
      [0.2, 64], // 5반음 아래에서 미끄러져 올라온다
      [0.8, 69],
    ]);
    const track = buildPitchTrack([noteOf(69, 0, 1)], curve);

    expect(track.octaveSnapped).toBe(0);
    expect(Math.min(...track.points.map((p) => p.midi))).toBeCloseTo(64, 6);
  });

  test("조율 보정이 정확히 한 번 걸린다", () => {
    const curve = curveOf([[1, 69]]);
    const plain = buildPitchTrack([noteOf(69, 0, 1)], curve);
    const shifted = buildPitchTrack([noteOf(69, 0, 1)], curve, {
      tuningCents: 50,
    });

    expect(plain.points[0].midi).toBeCloseTo(69, 6);
    // 두 번 걸리면 68.0이 된다
    expect(shifted.points[0].midi).toBeCloseTo(68.5, 6);
  });

  test("무성 구간에는 점을 찍지 않는다 — 없는 포르타멘토를 만들지 않는다", () => {
    const curve = curveOf([
      [0.4, 69],
      [0.2, null],
      [0.4, 69],
    ]);
    const track = buildPitchTrack([noteOf(69, 0, 1)], curve);

    const inGap = track.points.filter((p) => p.sec > 0.41 && p.sec < 0.59);
    expect(inGap).toHaveLength(0);
    // 런이 둘이므로 끝점이 넷이다
    expect(track.points.length).toBe(4);
  });

  test("음표 밖의 프레임은 버린다", () => {
    const curve = curveOf([[2, 69]]);
    // 음표는 앞쪽 0.5초뿐이다
    const track = buildPitchTrack([noteOf(69, 0, 0.5)], curve);

    expect(track.rawCount).toBe(50);
    expect(Math.max(...track.points.map((p) => p.sec))).toBeLessThan(0.5);
  });

  test("음표가 없으면 점도 없다", () => {
    expect(buildPitchTrack([], curveOf([[1, 69]])).points).toHaveLength(0);
  });
});

// --- .svp 읽기 도우미 ---------------------------------------------------------

interface TempoEntry {
  position: number;
  bpm: number;
}

/** blick → 초. 템포맵을 실제로 걸어서 잰다 — 신스V가 하는 것과 같은 계산이다 */
function secAtBlick(tempo: readonly TempoEntry[], blick: number): number {
  let sec = 0;
  for (let i = 0; i < tempo.length; i += 1) {
    const start = tempo[i].position;
    const end = i + 1 < tempo.length ? tempo[i + 1].position : Infinity;
    if (blick <= start) break;
    sec += ((Math.min(blick, end) - start) / BLICKS_PER_QUARTER) *
      (60 / tempo[i].bpm);
    if (blick <= end) break;
  }
  return sec;
}

function parse(svp: string) {
  const project = JSON.parse(svp);
  return {
    project,
    group: project.library[0],
    track: project.tracks[0],
    tempo: project.time.tempo as TempoEntry[],
  };
}

describe("2. .svp 형식 — 실측한 구조를 그대로 낸다", () => {
  const { beats, downbeats } = metronome();
  const grid = buildGrid({ beats, downbeats, beatsPerBar: 4 });
  const curve = curveOf([[2, 69]]);
  const input = {
    notes: [noteOf(69, 0.5, 1.0), noteOf(71, 1.0, 2.0)],
    curve,
    grid,
    tuningCents: 0,
  };

  test("파싱되고 버전이 SV2다", () => {
    const { project } = parse(toSvp(input));
    expect(project.version).toBe(196);
    expect(Object.keys(project)).toEqual([
      "version",
      "uuid",
      "time",
      "library",
      "tracks",
      "renderConfig",
      "projectMixer",
    ]);
  });

  test("내용은 library에, mainGroup은 비어 있다", () => {
    const { group, track } = parse(toSvp(input));
    expect(group.notes).toHaveLength(2);
    expect(track.mainGroup.notes).toHaveLength(0);
    // mainRef는 자기 자신(빈 mainGroup)을 가리킨다
    expect(track.mainRef.groupID).toBe(track.mainGroup.uuid);
    // 실제 내용은 groups의 참조로 붙는다
    expect(track.groups).toHaveLength(1);
    expect(track.groups[0].groupID).toBe(group.uuid);
    expect(track.mainGroup.uuid).not.toBe(group.uuid);
  });

  /**
   * **아래 목록은 진짜 신스V 2 파일에서 베껴 온 것이다**(`staccato.svp` v196,
   * 2026-08-12 대조). 필드 하나가 빠져도 신스V가 어떻게 반응하는지 알 수 없으므로
   * 목록 자체를 못 박는다 — 이 테스트가 깨지면 형식을 바꾼 것이고, 바꿨다면
   * 실제 파일과 다시 대조해야 한다.
   */
  test("참조·그룹·음표의 키가 진짜 SV2 파일과 같다", () => {
    const { group, track } = parse(toSvp(input));
    const refKeys = [
      "blickAbsoluteBegin", "blickAbsoluteEnd", "blickOffset", "database",
      "dictionary", "groupID", "isInstrumental", "mute", "pitchOffset",
      "takes", "timestampLMR", "timestampLRSR", "uuid", "voice",
      "voicePresetName",
    ];
    expect(Object.keys(track.mainRef).sort()).toEqual(refKeys);
    expect(Object.keys(track.groups[0]).sort()).toEqual(refKeys);
    expect(Object.keys(group).sort()).toEqual([
      "musicalScale", "name", "notes", "parameters", "pitchControls", "uuid",
      "vocalModes",
    ]);
    expect(Object.keys(group.notes[0]).sort()).toEqual([
      "accent", "attributes", "detune", "duration", "lyrics", "musicalType",
      "onset", "phonemes", "pitch", "takes", "uuid",
    ]);
    expect(Object.keys(group.pitchControls[0]).sort()).toEqual([
      "id", "pitch", "pos", "type",
    ]);
    // mainRef만 열려 있고 내용 참조는 실제 끝을 갖는다
    expect(track.mainRef.blickAbsoluteEnd).toBe(-1);
    expect(track.groups[0].blickAbsoluteEnd).toBeGreaterThan(0);
    // 보이스를 지정하지 않는다 — 없는 라이브러리를 가리키면 프로젝트가 안 열린다
    expect(track.groups[0].database.name).toBe("");
  });

  /**
   * **이 검사는 원문 문자열을 본다.** `JSON.parse`를 지나면 `0`과 `0.0`이 같은
   * 값이 되어 버려서, 위의 다른 검사들은 이 오류를 **원리적으로 못 잡는다.**
   * 실제로 그렇게 빠져나갔다 — 형식·시간축 검사 24개를 전부 통과한 파일이
   * 신스V에서 템포가 120으로 떨어졌다(2026-08-12 왕복 검증, `svp.ts`의 `float`).
   */
  test("실수 필드가 정수로 나가지 않는다 — 신스V가 못 읽는다", () => {
    const raw = toSvp(input);
    // 템포를 죽인 바로 그 필드
    expect(raw).toContain('"startTimeSeconds":0.0');
    // 정확히 120.0인 곡에서도 실수여야 한다
    const flat = toSvp({
      ...input,
      grid: buildGrid({ ...metronome(), beatsPerBar: 4 }),
    });
    expect(flat).toContain('"bpm":120.0');
    // 믹서도 같은 부류다
    expect(raw).toContain('"gainDecibel":0.0');
    expect(raw).toContain('"pan":0.0');
    // 반대로 **정수 필드는 정수로** 나가야 한다
    expect(raw).toMatch(/"pitch":\d+,"detune":0,/);
    expect(raw).toContain('"version":196');
    // 표지가 새어 나가면 안 된다
    // 표지는 NUL로 시작한다. 원문에 NUL이 남아 있으면 벗기기가 샌 것이다
    expect(raw).not.toContain("svpFloat");
    expect(raw).not.toContain("\u0000");
  });

  test("pitchDelta는 비운다 — 컨트롤 점과 이중으로 걸린다", () => {
    const { group } = parse(toSvp(input));
    expect(group.parameters.pitchDelta.points).toHaveLength(0);
    expect(group.pitchControls.length).toBeGreaterThan(0);
  });

  test("컨트롤 점의 pos가 엄격히 증가한다", () => {
    const { group } = parse(toSvp(input));
    const positions = group.pitchControls.map((p: { pos: number }) => p.pos);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    for (const point of group.pitchControls) {
      expect(point.type).toBe("point");
      expect(typeof point.id).toBe("string");
    }
  });

  test("컨트롤 점이 절대 음고다 — 센트 편차가 아니다", () => {
    const { group } = parse(toSvp(input));
    for (const point of group.pitchControls) {
      expect(point.pitch).toBeGreaterThan(60);
      expect(point.pitch).toBeLessThan(80);
    }
  });

  test("같은 입력이면 같은 파일이 나온다", () => {
    expect(toSvp(input)).toBe(toSvp(input));
  });
});

describe("3. 시간축 — 템포맵이 추적된 비트를 담는다", () => {
  test("등속 120BPM은 항목 하나로 합쳐진다", () => {
    const { beats, downbeats } = metronome();
    const grid = buildGrid({ beats, downbeats, beatsPerBar: 4 });
    const { tempo } = parse(
      toSvp({ notes: [noteOf(69, 0, 0.5)], curve: curveOf([[1, 69]]), grid, tuningCents: 0 }),
    );

    expect(tempo).toHaveLength(1);
    expect(tempo[0].position).toBe(0);
    expect(tempo[0].bpm).toBeCloseTo(120, 4);
  });

  test("비트가 blick 격자에 정확히 떨어진다", () => {
    const { beats, downbeats } = metronome();
    const grid = buildGrid({ beats, downbeats, beatsPerBar: 4 });
    const { tempo } = parse(
      toSvp({ notes: [noteOf(69, 0, 0.5)], curve: curveOf([[1, 69]]), grid, tuningCents: 0 }),
    );

    for (let i = 0; i < beats.length; i += 1) {
      expect(secAtBlick(tempo, i * BLICKS_PER_QUARTER)).toBeCloseTo(beats[i], 6);
    }
  });

  test("변속에서도 비트가 맞는다 — 상수 BPM이면 끝에서 밀린다", () => {
    // 0.5초에서 0.4초로 서서히 빨라진다
    const beats: number[] = [];
    const downbeats: number[] = [];
    let at = 0;
    for (let i = 0; i < 32; i += 1) {
      beats.push(at);
      if (i % 4 === 0) downbeats.push(at);
      at += 0.5 - (0.1 * i) / 31;
    }
    const grid = buildGrid({ beats, downbeats, beatsPerBar: 4 });
    const notes = [noteOf(69, beats[8], beats[9])];
    const { tempo, group } = parse(
      toSvp({ notes, curve: curveOf([[16, 69]]), grid, tuningCents: 0 }),
    );

    expect(tempo.length).toBeGreaterThan(1);
    for (let i = 0; i < beats.length; i += 1) {
      // 1ms 안. 16분 칸이 100ms대인 곡에서 무시할 수 있는 양이다
      expect(secAtBlick(tempo, i * BLICKS_PER_QUARTER)).toBeCloseTo(beats[i], 3);
    }
    // 음표도 자기 자리에 있다
    expect(secAtBlick(tempo, group.notes[0].onset)).toBeCloseTo(beats[8], 3);
  });

  test("음표와 컨트롤 점이 같은 시계 위에 있다", () => {
    const { beats, downbeats } = metronome();
    const grid = buildGrid({ beats, downbeats, beatsPerBar: 4 });
    const notes = [noteOf(69, 0.5, 1.5)];
    const { tempo, group } = parse(
      toSvp({ notes, curve: curveOf([[2, 69]]), grid, tuningCents: 0 }),
    );

    const first = group.pitchControls[0];
    const last = group.pitchControls[group.pitchControls.length - 1];
    expect(secAtBlick(tempo, first.pos)).toBeCloseTo(0.5, 3);
    expect(secAtBlick(tempo, last.pos)).toBeLessThanOrEqual(1.5);
    expect(secAtBlick(tempo, group.notes[0].onset)).toBeCloseTo(0.5, 3);
  });

  test("음표 길이가 0이 되지 않는다", () => {
    const { beats, downbeats } = metronome();
    const grid = buildGrid({ beats, downbeats, beatsPerBar: 4 });
    const { group } = parse(
      toSvp({
        notes: [noteOf(69, 0.5, 0.5)],
        curve: curveOf([[1, 69]]),
        grid,
        tuningCents: 0,
      }),
    );
    expect(group.notes[0].duration).toBeGreaterThanOrEqual(1);
  });
});

describe("4. transcribe()와의 결선", () => {
  const { beats, downbeats } = metronome();
  const curve = curveOf([
    [0.5, null],
    [0.5, 69],
    [0.5, 71],
    [0.5, 72],
  ]);
  const result = transcribe(curve, {
    bpm: 120,
    beats,
    downbeats,
    beatsPerBar: 4,
  });

  test("결과가 원본 커브를 그대로 들고 있다", () => {
    expect(result.curve).toBe(curve);
  });

  test("전사 결과를 그대로 넣을 수 있다", () => {
    const { group } = parse(toSvp(result, { title: "테스트" }));
    expect(group.notes).toHaveLength(result.notes.length);
    expect(group.notes.length).toBeGreaterThan(0);
    expect(group.pitchControls.length).toBeGreaterThan(0);
    expect(group.name).toBe("테스트");
    for (const note of group.notes) expect(note.lyrics).toBe("la");
  });

  test("음표의 음고가 전사와 일치한다", () => {
    const { group } = parse(toSvp(result));
    expect(group.notes.map((n: { pitch: number }) => n.pitch)).toEqual(
      result.notes.map((n) => n.midi),
    );
  });

  test("커브가 실곡처럼 길어도 점이 프레임 수보다 훨씬 적다", () => {
    // 4분짜리 — 24,000프레임
    const long = curveOf([[240, 69]], (i) =>
      40 * Math.sin((2 * Math.PI * 5.5 * i * HOP_MS) / 1000),
    );
    const notes = segmentNotes(long);
    const track = buildPitchTrack(notes, long);

    expect(track.rawCount).toBeGreaterThan(20_000);
    // 사용자의 실제 신스V 파일이 2~4분에 1,200~3,600점이다. 같은 자릿수여야 한다
    expect(track.points.length).toBeLessThan(8_000);
  });
});
