/**
 * `.svp` 작성기 — **신스V 형식을 아는 유일한 파일.**
 *
 * `midi.ts`가 SMF 바이트를 아는 유일한 자리인 것과 같은 위치다. 위층
 * (`ui/transcription.tsx`)은 문자열 하나를 받아 내려받게 할 뿐이고, `platform/`도
 * `ds/`도 이 형식을 모른다.
 *
 * ## 왜 `pitchDelta`가 아니라 `pitchControls`인가 (실측 2026-08-12)
 *
 * 사용자의 실제 작업 파일 6개를 열어 확인한 것이다. **버전이 갈린다.**
 *
 * | | `Charles.svp` (v182 · SV1) | `밤파이아`·`붸게`·`staccato` (v196 · SV2) |
 * |---|---|---|
 * | `parameters.pitchDelta` | 498점 (센트 편차) | **전부 비어 있다** |
 * | `pitchControls` | 100점 | **714 / 3,346 / 1,235점** |
 *
 * 신스V 2가 Manual Mode를 없애고 Smart Pitch Controls로 갈아탔기 때문이다.
 * **`pitchDelta`에 값을 쓰면 안 된다** — 컨트롤 점과 이중으로 걸린다.
 *
 * 컨트롤 점의 모양은 정확히 이 넷이다(실측 키 합집합):
 * `{"pos": blick, "pitch": 소수 MIDI, "id": "문자열 정수", "type": "point"}`
 * `pitch`는 **센트 편차가 아니라 절대 음고**다(실측 3,282/3,346이 소수).
 *
 * ## 구조 규약 (실측, v187·v196 네 파일에서 모두 같았다)
 *
 * **내용은 `library`에 있고 `tracks[i].groups`가 그것을 참조한다.**
 * `mainGroup`은 **언제나 비어 있고** `mainRef.groupID`가 그 자신의 uuid를 가리킨다.
 * 반대로 만들면(내용을 `mainGroup`에 넣으면) 신스V가 어떻게 읽는지 확인된 바 없다.
 */

import type { Grid } from "./quantize";
import { stepAtTime, stepTime } from "./quantize";
import { buildPitchTrack, type PitchTrackOptions } from "./curve";
import type { NoteEvent, PitchCurve } from "./notes";

/**
 * 신스V의 시간 단위. 4분음표 하나가 이만큼이다.
 *
 * `server/scripts/evalset.py`의 `BLICKS_PER_QUARTER`와 같은 값이다 — 그쪽은 읽고
 * 이쪽은 쓴다. 705,600,000 = 2^10 × 3^4 × 5^2 × 7^2 × 무엇이든, 요는 흔한 잇단음표
 * 분할이 전부 정수로 떨어지도록 고른 수라는 것이다.
 */
export const BLICKS_PER_QUARTER = 705_600_000;

/**
 * 템포 항목을 합치는 문턱(비율).
 *
 * 추적된 비트는 프레임 격자(11.6ms)에 묶여 있어 **비트마다 BPM이 미세하게
 * 다르게 나온다.** 그대로 쓰면 4분 곡에 항목이 900개 생긴다. 0.1%는 4분 곡
 * 끝에서 0.24초에 해당하므로 — 우리 격자 자체의 정밀도 밑이다.
 */
const TEMPO_MERGE_RATIO = 0.001;

/** 합성기가 부를 음절. `index.ts`의 `VOCAL_LYRIC`과 같은 값이고 이유도 같다 */
const DEFAULT_LYRIC = "la";

/**
 * **실수 필드는 `0`이 아니라 `0.0`으로 나가야 한다** (실측 2026-08-12, 왕복 검증).
 *
 * `JSON.stringify(0.0)`은 `"0"`을 낸다 — 자바스크립트에 정수·실수 구분이 없어서다.
 * 그런데 신스V는 실수 필드를 늘 `0.0`으로 적고, **정수로 적힌 것을 읽지 못한다.**
 *
 * 실제로 겪은 증상: `time.startTimeSeconds`를 `0`으로 냈더니 신스V가 **`time`
 * 블록을 통째로 버리고 기본 120 BPM으로 떨어졌다.** 우리가 쓴 139.53은 무시됐고,
 * 렌더가 곡 전체를 1.16배로 늘여 불렀다(실측: 13.71초 곡이 15.97초로). 음표도
 * 커브도 blick은 옳게 읽혔으므로 **파일이 열리고 소리도 나는데 템포만 틀린다** —
 * JSON을 아무리 들여다봐도 안 보이는 종류의 오류다.
 *
 * 되돌리는 방법이 없어서 표지를 거친다. 문자열로 내보낸 뒤 마지막에 따옴표를
 * 벗긴다. 표지에 NUL을 쓰므로 사용자 문자열(제목)과 부딪힐 수 없다 — 제목에
 * NUL이 들어와도 `JSON.stringify`가 escape하므로 아래 정규식의 숫자 패턴에
 * 걸리지 않는다.
 *
 * **어느 필드가 실수인지는 진짜 파일에서 뽑았다.** 사용자의 `.svp` 6개를 훑어
 * "한 번이라도 소수를 가진 키"를 모은 목록이 아래 `float()` 호출 자리다.
 */
const FLOAT_TAG = "\u0000svpFloat:";

function float(value: number): number {
  const text = Number.isInteger(value) ? value.toFixed(1) : String(value);
  // 타입만 속인다. `stringify` 직후 아래 정규식이 진짜 숫자로 되돌린다
  return (FLOAT_TAG + text) as unknown as number;
}

function unwrapFloats(json: string): string {
  return json.replaceAll(
    /"\\u0000svpFloat:(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)"/gi,
    "$1",
  );
}

/** 이 파일이 흉내 내는 신스V 버전. 사용자의 SV2 파일이 전부 196이다 */
const SVP_VERSION = 196;

export interface SvpInput {
  /** 노래한 그대로의 음표. **격자 음표가 아니다** — 아래 주석 참조 */
  readonly notes: readonly NoteEvent[];
  /** 원본 f0 커브 */
  readonly curve: PitchCurve;
  /** 비트 격자. 템포맵과 blick 사상이 전부 여기서 나온다 */
  readonly grid: Grid;
  /** `segmentNotes`가 실제로 쓴 조율 보정값(센트) */
  readonly tuningCents: number;
}

export interface SvpOptions {
  readonly title?: string;
  readonly lyric?: string;
  /** 격자를 못 쓸 때의 폴백 템포 */
  readonly bpm?: number;
  /** 화면 표시용 음계. 없으면 C장조 */
  readonly key?: { readonly tonic: number; readonly mode: "major" | "minor" };
  readonly track?: PitchTrackOptions;
}

/**
 * 전사 결과를 신스V 프로젝트 문자열로.
 *
 * **음표는 `notes`(연주한 그대로)를 쓰고 격자 음표를 쓰지 않는다.** 음절 타이밍과
 * 피치 커브가 같은 시계 위에 있어야 하기 때문이다 — 음표만 16분 격자로 옮기고
 * 커브는 실제 시각에 두면, 합성기가 격자 시각에 자음을 놓고 커브는 그 앞뒤에서
 * 움직여 소리가 번진다. 격자 버전이 필요하면 기존 `melody-quantized.mid`와
 * MusicXML이 그대로 나간다.
 *
 * 대신 **템포맵이 추적된 비트를 그대로 담으므로 마디선은 오디오와 맞는다** —
 * 신스V 안에서 눈으로 대조할 수 있고, 필요하면 거기서 Smart Quantization을 걸면 된다.
 */
export function toSvp(input: SvpInput, options: SvpOptions = {}): string {
  const { grid } = input;
  const spb = grid.stepsPerBeat > 0 ? grid.stepsPerBeat : 4;
  const fallbackBpm = options.bpm && options.bpm > 0 ? options.bpm : 120;
  const usable = grid.times.length >= 2;

  // 초 → blick. **템포맵과 같은 사상을 써야 한다** — 격자가 비트 사이를 선형
  // 보간하므로(`buildGrid`), 칸 번호를 거치면 자동으로 일치한다.
  const blickAt = usable
    ? (sec: number) => Math.round((stepAtTime(grid, sec) / spb) * BLICKS_PER_QUARTER)
    : (sec: number) => Math.round((sec * fallbackBpm) / 60 * BLICKS_PER_QUARTER);

  const tempo = usable
    ? tempoMap(grid, spb, fallbackBpm)
    : [{ position: 0, bpm: float(fallbackBpm) }];

  const track = buildPitchTrack(input.notes, input.curve, {
    tuningCents: input.tuningCents,
    ...options.track,
  });

  const lyric = options.lyric ?? DEFAULT_LYRIC;
  const notes = input.notes.map((note, index) => {
    const onset = blickAt(note.startSec);
    const end = blickAt(note.endSec);
    return {
      uuid: shortId(`note-${index}-${note.midi}-${note.startSec}`),
      musicalType: "singing",
      onset,
      // **1 이상이어야 한다.** 최소 길이 필터를 통과한 음표라도 blick으로
      // 반올림하면 0이 될 수 있고, 길이 0인 음표는 신스V가 그리지 못한다.
      duration: Math.max(1, end - onset),
      lyrics: lyric,
      phonemes: "",
      accent: "",
      pitch: Math.round(note.midi),
      detune: 0,
      attributes: { evenSyllableDuration: true, muted: false },
      takes: {
        activeTakeId: 0,
        takes: [
          { id: 0, seedDuration: 0, seedPitch: 0, seedTimbre: 0, liked: false },
        ],
      },
    };
  });

  // 컨트롤 점. **pos가 엄격히 증가해야 한다** — 반올림으로 같은 blick에 둘이
  // 겹칠 수 있어 앞의 것만 남긴다.
  const pitchControls: {
    pos: number;
    pitch: number;
    id: string;
    type: string;
  }[] = [];
  let lastPos = Number.NEGATIVE_INFINITY;
  for (const point of track.points) {
    const pos = blickAt(point.sec);
    if (pos <= lastPos) continue;
    lastPos = pos;
    pitchControls.push({
      pos,
      // 0.0001반음 = 0.01센트. 이 아래는 파일만 키운다
      pitch: float(round(point.midi, 4)),
      id: String(pitchControls.length * 2),
      type: "point",
    });
  }

  const groupUuid = uuidFrom(`group-${options.title ?? "melody"}`);
  const mainUuid = uuidFrom(`main-${options.title ?? "melody"}`);
  const name = options.title ?? "melody";

  const group = {
    name,
    uuid: groupUuid,
    parameters: emptyParameters(),
    vocalModes: {},
    pitchControls,
    notes,
    musicalScale: musicalScale(options.key),
  };

  const project = {
    version: SVP_VERSION,
    uuid: uuidFrom(`project-${name}`),
    time: {
      meter: [
        {
          index: 0,
          numerator: Math.max(1, grid.beatsPerBar),
          denominator: 4,
        },
      ],
      tempo,
      startTimeSeconds: float(0),
    },
    library: [group],
    tracks: [
      {
        name,
        dispColor: "ff7db235",
        dispOrder: 0,
        renderEnabled: true,
        mixer: defaultMixer(),
        // **비어 있어야 한다.** 실측한 네 파일 전부 그랬다
        mainGroup: {
          name: "main",
          uuid: mainUuid,
          parameters: emptyParameters(),
          vocalModes: {},
          pitchControls: [],
          notes: [],
          musicalScale: musicalScale(options.key),
        },
        // `mainRef`의 끝은 언제나 -1(열림)이고, 내용을 가리키는 참조만 실제
        // 끝 blick을 갖는다 — 실측한 v187·v196 파일이 예외 없이 그랬다
        mainRef: groupRef(uuidFrom(`mainref-${name}`), mainUuid, -1),
        groups: [groupRef(uuidFrom(`ref-${name}`), groupUuid, groupEnd(notes))],
      },
    ],
    renderConfig: {
      destination: "",
      filename: name,
      numChannels: 1,
      aspirationFormat: "noAspiration",
      bitDepth: 16,
      sampleRate: 44100,
      exportMixDown: true,
      exportPitch: false,
      bypassPan: false,
      bypassGain: false,
      bypassEffects: false,
    },
    projectMixer: { linkRoomSettings: true },
  };

  return unwrapFloats(JSON.stringify(project));
}

/**
 * 추적된 비트로 템포맵을 만든다.
 *
 * **비트 `i`가 blick `i × 705,600,000`에 정확히 떨어지도록** 구간 템포를 정한다.
 * 그러면 마디선이 오디오와 끝까지 맞는다 — 상수 BPM으로 적으면 0.5% 오차에서도
 * 4분 곡의 끝이 1.2초 밀린다(`quantize.ts`가 등간격 격자를 거부하는 것과 같은 이유).
 *
 * **못갖춘마디는 `tempo[0]`이 지배한다.** 신스V의 템포 위치는 0 이상이라 blick 0
 * 이전 구간에는 항목을 둘 수 없다. 첫 다운비트 앞의 음표는 그만큼 어긋날 수
 * 있는데, 보통 한두 마디라 무시할 수 있는 양이다.
 */
function tempoMap(
  grid: Grid,
  spb: number,
  fallbackBpm: number,
): { position: number; bpm: number }[] {
  const minStep = grid.origin;
  const maxStep = grid.origin + grid.times.length - 1;
  const first = Math.ceil(minStep / spb) * spb;
  const last = Math.floor(maxStep / spb) * spb;

  const out: { position: number; bpm: number }[] = [];
  let lastBpm = 0;
  for (let step = first; step + spb <= last; step += spb) {
    const span = stepTime(grid, step + spb) - stepTime(grid, step);
    if (!(span > 0)) continue;
    const bpm = 60 / span;
    if (!Number.isFinite(bpm) || bpm <= 0) continue;
    // blick 0 이전은 표현할 수 없다. 그 구간의 템포는 첫 항목이 대신한다
    const position = Math.max(0, (step / spb) * BLICKS_PER_QUARTER);
    if (out.length && position === 0) {
      out[0] = { position: 0, bpm: float(round(bpm, 6)) };
      lastBpm = bpm;
      continue;
    }
    if (lastBpm > 0 && Math.abs(bpm - lastBpm) / lastBpm < TEMPO_MERGE_RATIO) {
      continue;
    }
    out.push({ position, bpm: float(round(bpm, 6)) });
    lastBpm = bpm;
  }
  if (!out.length) return [{ position: 0, bpm: float(fallbackBpm) }];
  // 신스V는 첫 항목이 0에 있기를 기대한다
  if (out[0].position !== 0) out[0] = { position: 0, bpm: out[0].bpm };
  return out;
}

function emptyParameters(): Record<string, { mode: string; points: number[] }> {
  const empty = () => ({ mode: "cubic", points: [] as number[] });
  return {
    pitchDelta: empty(),
    vibratoEnv: empty(),
    loudness: empty(),
    tension: empty(),
    breathiness: empty(),
    voicing: empty(),
    gender: empty(),
    toneShift: empty(),
    mouthOpening: empty(),
  };
}

const SCALE_ROOTS = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

function musicalScale(key: SvpOptions["key"]): { type: string; root: string } {
  if (!key) return { type: "Major", root: "C" };
  return {
    type: key.mode === "minor" ? "Minor" : "Major",
    root: SCALE_ROOTS[((key.tonic % 12) + 12) % 12],
  };
}

/** 참조 구간의 끝. 마지막 음표가 끝나는 자리다 */
function groupEnd(notes: readonly { onset: number; duration: number }[]): number {
  let end = 0;
  for (const note of notes) end = Math.max(end, note.onset + note.duration);
  return end;
}

function groupRef(uuid: string, groupID: string, blickAbsoluteEnd: number) {
  return {
    uuid,
    groupID,
    blickAbsoluteBegin: 0,
    blickAbsoluteEnd,
    blickOffset: 0,
    pitchOffset: 0,
    mute: false,
    isInstrumental: false,
    // **비워 둔다.** 보이스를 지정하면 그 라이브러리가 없는 사용자에게서
    // 프로젝트가 안 열린다. 비우면 신스V가 기본 보이스를 고른다.
    database: {
      name: "",
      language: "",
      phoneset: "",
      languageOverride: "",
      phonesetOverride: "",
      backendType: "",
      version: "-2",
    },
    dictionary: "",
    voice: {
      vocalModeInherited: true,
      vocalModePreset: "",
      vocalModeParams: {},
      choirSeatingSeparation: float(0.699999988079071),
    },
    voicePresetName: "",
    // **null이 아니라 객체다.** 실측한 파일 전부 여기에 기본 테이크가 하나 있다
    takes: {
      activeTakeId: 0,
      takes: [
        { id: 0, seedDuration: 0, seedPitch: 0, seedTimbre: 0, liked: false },
      ],
    },
    // 신스V가 렌더 캐시를 무효화하는 데 쓰는 epoch 밀리초. **0으로 둔다** —
    // 시각을 넣으면 같은 입력에서 다른 파일이 나오고, 신스V 자신도 0을 쓴다
    // (`staccato.svp`의 mainRef).
    timestampLMR: 0,
    timestampLRSR: 0,
  };
}

function defaultMixer() {
  return {
    gainDecibel: float(0),
    pan: float(0),
    mute: false,
    solo: false,
    display: true,
    fxPresetName: "",
    fxParams: {
      room: {
        enabled: false,
        positionX: float(0),
        positionY: float(0),
        size: float(15),
        reflectionGain: float(0),
      },
      postRoomEq: {
        enabled: false,
        filters: [
          { freq: float(117.7), gain: float(0), q: float(0.71) },
          { freq: float(692.8), gain: float(0), q: float(0.71) },
          { freq: float(4077.7), gain: float(0), q: float(0.71) },
        ],
        lowShelf: { freq: float(25), gain: float(0) },
      },
      compressor: {
        enabled: false,
        attack: float(0),
        ratio: float(4),
        threshold: float(-10),
      },
      reverb: {
        enabled: false,
        type: "clean",
        preDelay: float(0.05),
        decay: float(1),
        dryWetRatio: float(0.5),
      },
    },
  };
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/**
 * 같은 입력이면 같은 uuid가 나오게 한다.
 *
 * `crypto.randomUUID()`를 쓰면 같은 곡을 두 번 전사했을 때 파일이 달라져
 * **회귀 시험도 diff도 못 한다.** 신스V는 uuid가 파일 안에서 일관되기만 하면
 * 되고 전역 유일성을 요구하지 않는다.
 */
function uuidFrom(seed: string): string {
  const a = hash(seed, 0x811c9dc5);
  const b = hash(seed, 0x01000193);
  const c = hash(seed, 0x9e3779b9);
  const d = hash(seed, 0x85ebca6b);
  const hex = (v: number) => (v >>> 0).toString(16).padStart(8, "0");
  const all = hex(a) + hex(b) + hex(c) + hex(d);
  return [
    all.slice(0, 8),
    all.slice(8, 12),
    all.slice(12, 16),
    all.slice(16, 20),
    all.slice(20, 32),
  ].join("-");
}

function shortId(seed: string): string {
  const hex = (v: number) => (v >>> 0).toString(16).padStart(8, "0");
  return hex(hash(seed, 0x811c9dc5)) + hex(hash(seed, 0x9e3779b9));
}

/** FNV-1a. 암호용이 아니라 재현용이다 */
function hash(text: string, seed: number): number {
  let value = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}
