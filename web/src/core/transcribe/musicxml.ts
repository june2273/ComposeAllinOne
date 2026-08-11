/**
 * 격자에 얹힌 음표 → 한 성부짜리 MusicXML.
 *
 * **사람 검수를 전제로 한 초안이다**(사양서 §11). 자동화되지 않는 것이 셋이다.
 *
 * - **이명동음 표기.** F♯인지 G♭인지는 화성 문맥이 정하는데 우리에겐 조성
 *   하나뿐이다. 조표의 방향(♯계/♭계)만 보고 통째로 고른다 — **단조의 이끎음
 *   하나만 예외다**(`spellingFor`).
 * - **성부 분리.** 단선율 전제다(`segmentNotes`가 프레임마다 음 하나만 낸다).
 * - **잇단음표.** 격자가 2분할 고정이라 셋잇단이 나오지 않는다.
 *
 * ## 음가는 그리디로 쪼갠다
 *
 * 길이 하나를 표기 가능한 음가의 합으로 나눌 때 큰 것부터 집는다. 표기법적으로
 * 최선인 묶음(마디의 어느 자리에서 시작하는지에 따라 관례가 다르다)은 아니지만,
 * **마디를 넘지 않고 음가 합이 정확하다**는 것은 보장된다. 관례까지 맞추려면
 * 박절 구조를 아는 별도의 규칙이 필요하고 그건 검수자가 더 잘한다.
 */

import type { QuantizedNote } from "./quantize";

/** 조표의 ♯/♭ 개수. 양수면 ♯계 */
export type Fifths = number;

export interface ScoreOptions {
  readonly beatsPerBar: number;
  readonly stepsPerBeat: number;
  /**
   * 조표. 없으면 `key`에서 유도하고, 그것도 없으면 0이다.
   *
   * 직접 넣는 쪽이 이기지만, **`key`를 함께 주는 편이 낫다** — 조표만으로는
   * 단조의 이끎음을 알 수 없어 D단조의 C♯이 D♭으로 적힌다(`spellingFor`).
   */
  readonly fifths?: Fifths;
  /** 조성. 조표와 이끎음 표기를 함께 정한다 */
  readonly key?: { readonly tonic: number; readonly mode: "major" | "minor" };
  readonly title?: string;
  /** 아래 이 음이면 낮은음자리표 */
  readonly bassClefBelow?: number;
  /**
   * 템포(4분음표 기준). 첫 마디에 메트로놈 표시로 나간다.
   *
   * **없으면 읽는 쪽이 120으로 연다.** MIDI에는 `set_tempo`가 이미 나가는데
   * MusicXML에만 빠져 있어서, 같은 전사인데 파일 형식에 따라 템포가 달라졌다
   * (신스V·MuseScore 실측). `<sound tempo>`가 재생을, `<metronome>`이 표기를
   * 맡으므로 **둘 다 낸다.**
   */
  readonly bpm?: number;
  /**
   * 모든 음표에 붙일 가사 한 음절. 없으면 가사를 아예 넣지 않는다.
   *
   * **가창 합성기(Synthesizer V 등)를 위한 것이다.** 그쪽은 음표마다 음절을
   * 기대하는데, 가사 없는 MusicXML을 읽으면 전부 `-`(앞 음을 늘이는 표시)가
   * 되어 한 음절도 발음되지 않는다. `la` 같은 중립 음절을 넣어 두면 열자마자
   * 소리가 난다.
   *
   * **붙임줄로 이어받은 음에는 붙이지 않는다** — 거기서는 `-`가 맞다(한 음절을
   * 여러 음에 걸쳐 늘이는 자리다).
   */
  readonly lyric?: string;
}

/** 이 음보다 낮으면 낮은음자리표가 읽기 편하다. score.ts와 같은 기준 */
const DEFAULT_BASS_CLEF_BELOW = 60; // C4

/**
 * 음고류 → 음이름. ♯계와 ♭계 두 벌뿐이다.
 *
 * `theory.NOTE_NAMES`는 ♯ 고정이라 여기서 쓸 수 없고, `analysis/key.ts`의 표는
 * **조 이름**용이라 또 다르다(D♭ 장조 / C♯ 단조). 세 표가 각자 있는 것이
 * 중복처럼 보이지만 셋이 서로 다른 질문에 답한다.
 */
const SHARP_SPELLING: readonly [string, number][] = [
  ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0],
  ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0],
];
const FLAT_SPELLING: readonly [string, number][] = [
  ["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0],
  ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0],
];

/** 조표에 붙는 임시표 수. 5도권을 그대로 옮긴 표다 */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const MINOR_FIFTHS = [-3, 4, -1, -6, 1, -4, 3, -2, 5, 0, -5, 2];

/** 조표가 붙는 순서. ♯은 파도솔레라미시, ♭은 그 역순이다 */
const SHARP_ORDER = "FCGDAEB";
const FLAT_ORDER = "BEADGCF";

/** 조성(으뜸음 음고류 + 선법) → 조표. `KeyEstimate`를 그대로 넣는다 */
export function keyFifths(tonic: number, mode: "major" | "minor"): Fifths {
  const pc = ((Math.round(tonic) % 12) + 12) % 12;
  return mode === "major" ? MAJOR_FIFTHS[pc] : MINOR_FIFTHS[pc];
}

/**
 * 이 조표에서 이 음이름이 기본으로 갖는 변화. ♯계면 +1, ♭계면 −1, 아니면 0.
 *
 * **임시표를 찍을지 정하려면 이게 필요하다.** C단조에서 B♮을 그냥 내보내면
 * 조표의 B♭이 살아 있어 **악보에는 B♭으로 보인다** — 소리는 맞는데 읽는 것이
 * 틀리는, 눈으로 검수하기 전에는 모르는 종류의 오류다.
 */
export function keyAlter(letter: string, fifths: Fifths): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(letter) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(letter) ? -1 : 0;
  return 0;
}

/**
 * 이 곡에서 음고류를 어떻게 적을 것인가.
 *
 * 화성 문맥이 없으므로 조표 방향 하나로 ♯계·♭계를 통째로 고른다. **예외는
 * 단조의 이끎음 하나뿐이다** — 아래 참조.
 */
interface Spelling {
  readonly fifths: Fifths;
  /** 이 음고류만은 ♯계로 적는다. 없으면 null */
  readonly sharpen: number | null;
}

/**
 * 조성에서 표기 규칙을 만든다.
 *
 * **단조의 이끎음만 예외로 둔다.** ♭계 단조를 규칙대로 적으면 D단조의 이끎음
 * C♯이 **D♭으로** 나온다(G단조는 F♯이 G♭). 단조 멜로디에서 이끎음은 거의 매
 * 프레이즈에 나오는 음이라 초안 품질을 눈에 띄게 깎는데, 고치는 데 필요한 것은
 * 조성 정보뿐이라 화성 인식을 기다릴 이유가 없다.
 *
 * 나머지 이명동음은 그대로 남는다 — 차용화음·부속7화음의 표기는 코드 진행을
 * 알아야 정해지고, 그건 코드 인식이 붙은 다음의 일이다.
 */
function spellingFor(options: ScoreOptions): Spelling {
  const key = options.key;
  const fifths =
    options.fifths ?? (key ? keyFifths(key.tonic, key.mode) : 0);
  const tonic = key ? (((Math.round(key.tonic) % 12) + 12) % 12) : 0;
  return {
    fifths,
    sharpen: key && key.mode === "minor" ? (tonic + 11) % 12 : null,
  };
}

/**
 * 표기 가능한 음가. 값은 **4분음표 = 4**인 단위(divisions=4)로 적는다.
 * 큰 것부터 정렬해 두는 것이 그리디 분해의 전제다.
 */
const DURATIONS: readonly { units: number; type: string; dots: number }[] = [
  { units: 16, type: "whole", dots: 0 },
  { units: 12, type: "half", dots: 1 },
  { units: 8, type: "half", dots: 0 },
  { units: 6, type: "quarter", dots: 1 },
  { units: 4, type: "quarter", dots: 0 },
  { units: 3, type: "eighth", dots: 1 },
  { units: 2, type: "eighth", dots: 0 },
  { units: 1, type: "16th", dots: 0 },
];

/** 이 파일이 쓰는 divisions(4분음표당). 격자와 무관하게 고정이다 */
const DIVISIONS = 4;

function escapeXml(text: string): string {
  return text.replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

interface Duration {
  readonly units: number;
  readonly type: string;
  readonly dots: number;
}

/** 길이를 표기 가능한 음가들로 나눈다. 큰 것부터. */
export function splitDuration(units: number): Duration[] {
  const out: Duration[] = [];
  let rest = Math.max(0, Math.round(units));
  while (rest > 0) {
    const piece = DURATIONS.find((d) => d.units <= rest);
    if (!piece) break;
    out.push(piece);
    rest -= piece.units;
  }
  return out;
}

/** 4분음표 하나의 길이(divisions 단위). 박 경계 계산의 기준이다 */
const PER_BEAT = DIVISIONS;

/**
 * 마디 안의 한 조각을 **박 경계를 존중해서** 표기 음가로 나눈다.
 *
 * `at`은 마디 시작부터의 거리, `units`는 길이. 둘 다 divisions 단위다.
 *
 * ## 왜 그냥 큰 것부터 집으면 안 되는가
 *
 * 그리디만 쓰면 박 한가운데서 시작한 3칸이 **점8분음표 하나**로 적힌다. 음가 합은
 * 맞지만 그 음표가 박 경계를 가로질러 걸쳐 있어서, 읽는 사람이 박이 어디인지
 * 알 수 없다. 실측한 악보가 점8분음표 투성이였던 것이 이 때문이다.
 *
 * 표기 관례는 **박 안에서 시작한 음은 박 안에서 끝내거나, 박 경계에서 붙임줄로
 * 잇는 것**이다. 그래서 박 위에서 시작하지 않은 조각은 먼저 그 박의 끝까지
 * 자르고, 나머지를 다시 처리한다.
 *
 * 박 위에서 시작한 조각은 그리디 그대로 둔다 — 2분음표·점2분음표처럼 여러 박에
 * 걸치는 음가는 관례상 통짜로 적는 것이 맞다.
 *
 * **손해도 있다.** 8분 오프비트의 4분음표(관례적 당김음)가 붙임줄 둘로 갈린다.
 * 관례로는 통짜로 적지만, 그걸 허용하려면 "어떤 걸침이 관례적인가"의 표가
 * 필요하고 그건 박자마다 다르다. 읽는 데 지장이 없으므로 v1에서는 감수한다.
 */
export function notatePiece(at: number, units: number): Duration[] {
  const out: Duration[] = [];
  let cursor = Math.max(0, Math.round(at));
  let rest = Math.max(0, Math.round(units));
  while (rest > 0) {
    const intoBeat = cursor % PER_BEAT;
    // 박 위에서 시작하면 그리디, 아니면 이 박이 끝나는 곳까지만
    const limit = intoBeat === 0 ? rest : Math.min(rest, PER_BEAT - intoBeat);
    const piece = DURATIONS.find((d) => d.units <= limit);
    if (!piece) break;
    out.push(piece);
    cursor += piece.units;
    rest -= piece.units;
  }
  return out;
}

const ACCIDENTAL_NAME: Record<number, string> = {
  [-2]: "flat-flat", [-1]: "flat", 0: "natural", 1: "sharp", 2: "double-sharp",
};

/** MIDI 번호 → 표기. 조표의 방향 하나로 ♯계·♭계를 통째로 고른다 */
function spell(midi: number, spelling: Spelling) {
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  // 단조의 이끎음만 ♭계 조에서도 ♯계 표를 쓴다(`spellingFor` 주석)
  const sharp = spelling.fifths >= 0 || pc === spelling.sharpen;
  const [step, alter] = (sharp ? SHARP_SPELLING : FLAT_SPELLING)[pc];
  return { step, alter, octave: Math.floor(rounded / 12) - 1 };
}

interface Piece {
  /** null이면 쉼표 */
  readonly midi: number | null;
  /** 마디 시작부터의 거리(divisions). 빔을 박 단위로 묶는 데 쓴다 */
  readonly at: number;
  readonly units: number;
  readonly type: string;
  readonly dots: number;
  readonly tieStart: boolean;
  readonly tieStop: boolean;
}

/** 이 음가에 빔이 몇 겹 필요한가. 4분음표 이상은 빔이 없다 */
function beamLevels(type: string): number {
  if (type === "eighth") return 1;
  if (type === "16th") return 2;
  return 0;
}

/**
 * 빔을 건다 — 조각별 `<beam>` 문자열을 돌려준다.
 *
 * **빔이 없으면 박이 보이지 않는다.** 8분·16분이 전부 낱개 깃발로 서면 빠른
 * 멜로디가 음표의 나열로만 읽힌다(실측: 164BPM 곡의 첫 악보가 그랬다). 악보에서
 * 박을 드러내는 것은 마디선이 아니라 빔이다.
 *
 * 규칙은 **박 단위로 묶는다** 하나뿐이다. 쉼표와 4분음표 이상이 묶음을 끊는다.
 * 겹빔(16분)은 그 겹을 가진 음이 이어지는 구간에만 걸고, 혼자 남으면 갈고리로
 * 낸다 — 점8분+16분 짝의 그 갈고리다.
 */
function beamsFor(pieces: readonly Piece[], perBeat: number): string[] {
  const out = pieces.map(() => "");
  let i = 0;
  while (i < pieces.length) {
    const piece = pieces[i];
    if (piece.midi === null || beamLevels(piece.type) === 0) {
      i += 1;
      continue;
    }
    // 같은 박 안에서 이어지는 빔 가능한 음들
    const beat = Math.floor(piece.at / perBeat);
    let end = i;
    while (
      end + 1 < pieces.length &&
      pieces[end + 1].midi !== null &&
      beamLevels(pieces[end + 1].type) > 0 &&
      Math.floor(pieces[end + 1].at / perBeat) === beat
    ) {
      end += 1;
    }
    if (end > i) {
      const deepest = Math.max(...pieces.slice(i, end + 1).map((p) => beamLevels(p.type)));
      for (let level = 1; level <= deepest; level += 1) {
        // 이 겹을 가진 음들의 연속 구간마다 begin/continue/end
        let run = i;
        while (run <= end) {
          if (beamLevels(pieces[run].type) < level) {
            run += 1;
            continue;
          }
          let last = run;
          while (last + 1 <= end && beamLevels(pieces[last + 1].type) >= level) last += 1;
          if (last > run) {
            for (let k = run; k <= last; k += 1) {
              const kind = k === run ? "begin" : k === last ? "end" : "continue";
              out[k] += `<beam number="${level}">${kind}</beam>`;
            }
          } else {
            // 혼자다. 갈고리는 이웃이 있는 쪽을 향한다
            const hook = run === i ? "forward hook" : "backward hook";
            out[run] += `<beam number="${level}">${hook}</beam>`;
          }
          run = last + 1;
        }
      }
    }
    i = end + 1;
  }
  return out;
}

/**
 * 마디 하나를 채운다. 들어오는 조각은 마디 안에 완전히 들어가 있어야 한다.
 *
 * ## 임시표를 언제 찍는가
 *
 * **"조표와 다른가"가 아니라 "지금 이 자리에서 유효한 것과 다른가"다.**
 * 악보의 임시표는 그 마디 안에서 같은 자리(음이름+옥타브)에 계속 유효하므로,
 * 마디마다 자리별로 **지금 무엇이 걸려 있는지**를 들고 다니며 비교한다.
 *
 * 두 가지가 이 규칙에서 나온다.
 *
 * - **조표가 바꾸는 음을 되돌릴 때 제자리표가 나간다.** C단조(♭3)의 B♮을
 *   그냥 내보내면 조표의 B♭이 살아 있어 **악보에는 B♭으로 보인다** — 소리는
 *   맞는데 읽는 것이 틀리는, 눈으로 보기 전에는 모르는 오류다.
 * - **같은 마디에서 같은 기호를 두 번 찍지 않는다.** 찍으면 악보가 틀린 것처럼
 *   보인다.
 */
function measureXml(
  index: number,
  pieces: readonly Piece[],
  spelling: Spelling,
  attributes: string,
  lyric: string,
): string {
  /** 자리(음이름+옥타브) → 지금 그 자리에 유효한 변화 */
  const active = new Map<string, number>();
  const beams = beamsFor(pieces, PER_BEAT);
  const body = pieces
    .map((piece, index_) => {
      const duration = `<duration>${piece.units}</duration>`;
      const type = `<type>${piece.type}</type>${"<dot/>".repeat(piece.dots)}`;
      if (piece.midi === null) {
        return `<note><rest/>${duration}${type}</note>`;
      }
      const { step, alter, octave } = spell(piece.midi, spelling);
      const slot = `${step}${octave}`;
      // 앞에 임시표가 있었으면 그것이, 없었으면 조표가 유효하다
      const inEffect = active.get(slot) ?? keyAlter(step, spelling.fifths);
      let accidental = "";
      if (alter !== inEffect) {
        // **붙임줄로 이어받은 음에는 다시 찍지 않는다.** 마디를 넘어온 같은
        // 음이라 새로 울리는 것이 아니다 — 찍으면 두 번 친 것처럼 보인다.
        if (!piece.tieStop) {
          accidental = `<accidental>${ACCIDENTAL_NAME[alter]}</accidental>`;
        }
        active.set(slot, alter);
      }
      const pitch =
        `<pitch><step>${step}</step>` +
        (alter ? `<alter>${alter}</alter>` : "") +
        `<octave>${octave}</octave></pitch>`;
      const ties =
        (piece.tieStop ? '<tie type="stop"/>' : "") +
        (piece.tieStart ? '<tie type="start"/>' : "");
      const notations =
        piece.tieStop || piece.tieStart
          ? "<notations>" +
            (piece.tieStop ? '<tied type="stop"/>' : "") +
            (piece.tieStart ? '<tied type="start"/>' : "") +
            "</notations>"
          : "";
      // MusicXML은 <note>의 자식 순서가 규격으로 정해져 있다 —
      // pitch → duration → tie → type → dot → accidental → beam → notations
      // → lyric. 어기면 verovio가 그 음표를 조용히 흘린다.
      return (
        `<note>${pitch}${ties}${duration}${type}${accidental}` +
        `${beams[index_]}${notations}${piece.tieStop ? "" : lyric}</note>`
      );
    })
    .join("");
  return `<measure number="${index}">${attributes}${body}</measure>`;
}

/**
 * 격자 음표들을 MusicXML 한 편으로.
 *
 * 마디 경계를 넘는 음표는 붙임줄로 쪼갠다 — 마디 안에서 음가 합이 박자와
 * 정확히 맞아야 verovio가 읽는다(합이 어긋나면 그 마디부터 조용히 밀린다).
 */
export function toMusicXml(
  notes: readonly QuantizedNote[],
  options: ScoreOptions,
): string {
  const { beatsPerBar, stepsPerBeat } = options;
  const spelling = spellingFor(options);
  // 격자 칸 → divisions 단위. 16분음표 격자(stepsPerBeat=4)면 1:1이다
  const scale = DIVISIONS / stepsPerBeat;
  const perBar = beatsPerBar * DIVISIONS;

  // 못갖춘마디: 첫 음이 0번 칸보다 앞이면 그 앞을 0마디로 둔다(사양서 §3)
  const firstStep = notes.length ? Math.min(...notes.map((n) => n.startStep)) : 0;
  const start = Math.min(0, Math.floor((firstStep * scale) / perBar) * perBar);
  const lastUnit = notes.length
    ? Math.max(...notes.map((n) => n.endStep)) * scale
    : perBar;
  const end = Math.ceil((lastUnit - start) / perBar) * perBar + start;

  // 마디별 조각 목록을 먼저 만든다
  const bars: Piece[][] = [];
  for (let at = start; at < end; at += perBar) bars.push([]);

  const push = (
    barAt: number,
    from: number,
    to: number,
    midi: number | null,
    continues: boolean,
    continued: boolean,
  ) => {
    const bar = bars[Math.floor((barAt - start) / perBar)];
    if (!bar) return;
    const inBar = from - barStartOf(from, start, perBar);
    const parts = notatePiece(inBar, to - from);
    let at = inBar;
    parts.forEach((part, i) => {
      bar.push({
        midi,
        at,
        units: part.units,
        type: part.type,
        dots: part.dots,
        // 조각이 여럿이면 자기들끼리도 이어져야 한다
        tieStart: midi !== null && (continues || i < parts.length - 1),
        tieStop: midi !== null && (continued || i > 0),
      });
      at += part.units;
    });
  };

  let cursor = start;
  for (const note of notes) {
    const noteStart = Math.round(note.startStep * scale);
    const noteEnd = Math.max(noteStart + 1, Math.round(note.endStep * scale));
    if (noteStart < cursor) continue; // 겹침 — 단선율에서는 오지 않는다

    // 빈 자리를 쉼표로 메운다. 마디 경계에서 끊는다
    let at = cursor;
    while (at < noteStart) {
      const barEnd = barEndOf(at, start, perBar);
      const to = Math.min(noteStart, barEnd);
      push(at, at, to, null, false, false);
      at = to;
    }
    // 음표. 마디를 넘으면 붙임줄로 쪼갠다
    at = noteStart;
    while (at < noteEnd) {
      const barEnd = barEndOf(at, start, perBar);
      const to = Math.min(noteEnd, barEnd);
      push(at, at, to, note.midi, to < noteEnd, at > noteStart);
      at = to;
    }
    cursor = noteEnd;
  }
  // 마지막 마디의 남은 자리
  while (cursor < end) {
    const barEnd = barEndOf(cursor, start, perBar);
    const to = Math.min(end, barEnd);
    push(cursor, cursor, to, null, false, false);
    cursor = to;
  }

  const median = medianMidi(notes);
  const treble = median >= (options.bassClefBelow ?? DEFAULT_BASS_CLEF_BELOW);
  const [sign, line] = treble ? ["G", 2] : ["F", 4];
  const attributes =
    `<attributes><divisions>${DIVISIONS}</divisions>` +
    `<key><fifths>${spelling.fifths}</fifths></key>` +
    `<time><beats>${beatsPerBar}</beats><beat-type>4</beat-type></time>` +
    `<clef><sign>${sign}</sign><line>${line}</line></clef></attributes>` +
    tempoXml(options.bpm);

  // 못갖춘마디가 있으면 그것이 0마디다(사양서 §3 — 절대 마디 1은 **음악의 첫
  // 다운비트가 속한 마디**다). 첫 마디를 무조건 1로 매기면 그 뒤 마디 번호가
  // 통째로 하나씩 밀려 악보 대조가 어긋난다.
  const firstNumber = start < 0 ? 0 : 1;
  const lyric = options.lyric
    ? `<lyric><syllabic>single</syllabic>` +
      `<text>${escapeXml(options.lyric)}</text></lyric>`
    : "";
  const measures = bars
    .map((pieces, i) =>
      measureXml(
        i + firstNumber,
        pieces,
        spelling,
        i === 0 ? attributes : "",
        lyric,
      ),
    )
    .join("");

  const title = options.title
    ? `<work><work-title>${escapeXml(options.title)}</work-title></work>`
    : "";
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<score-partwise version="4.0">${title}` +
    '<part-list><score-part id="P1"><part-name/></score-part></part-list>' +
    `<part id="P1">${measures}</part></score-partwise>`
  );
}

/**
 * 첫 마디의 템포 표시. `<attributes>` 뒤, 첫 `<note>` 앞이어야 한다.
 *
 * `<metronome>`은 눈에 보이는 `♩= 139`이고 `<sound tempo>`는 재생 속도다.
 * **하나만 내면 나머지 하나가 기본값(120)으로 남는다.**
 */
function tempoXml(bpm: number | undefined): string {
  if (!bpm || !Number.isFinite(bpm) || bpm <= 0) return "";
  const rounded = Math.round(bpm * 100) / 100;
  return (
    '<direction placement="above"><direction-type><metronome>' +
    "<beat-unit>quarter</beat-unit>" +
    `<per-minute>${Math.round(bpm)}</per-minute>` +
    `</metronome></direction-type><sound tempo="${rounded}"/></direction>`
  );
}

function barStartOf(at: number, start: number, perBar: number): number {
  return start + Math.floor((at - start) / perBar) * perBar;
}

function barEndOf(at: number, start: number, perBar: number): number {
  return barStartOf(at, start, perBar) + perBar;
}

function medianMidi(notes: readonly QuantizedNote[]): number {
  if (!notes.length) return 72;
  const sorted = notes.map((n) => n.midi).sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}
