/**
 * 자유 연주용 건반 배치 — **자판 글자를 음으로 옮기는 순수 규칙.**
 *
 * React도 브라우저도 오디오도 모른다. 화면(`ui/freeplay.tsx`)은 여기서 나온
 * 표를 그리기만 하고, 소리는 `platform/`이 낸다. 그래서 배치 규칙(어느 키가
 * 무슨 음인가, 어디까지 옮길 수 있는가)이 브라우저 없이 테스트된다.
 *
 * ## 배치
 *
 * ```
 *      W   E       T   Y   U       O       P
 *    A   S   D   F   G   H   J   K   L   ;   '
 *    도  레  미  파  솔  라  시  도  레  미  파
 * ```
 *
 * 아랫줄이 흰건반, 윗줄이 검은건반이다. **`A`가 도이고 기본값은 C4**이므로
 * 맨 오른쪽 `'`는 17반음 위, 즉 **F5**가 된다. `QuizPage`의 자판 폴백
 * (`A`~`K` = C4~C5)을 오른쪽으로 늘린 것이라 손가락 기억이 그대로 옮겨온다.
 *
 * ## 자판 글자가 아니라 `event.code`로 잡는다
 *
 * `event.key`는 입력기와 자판 배열을 탄다 — 한글 입력 상태에서는 `a`가 아니라
 * `ㅁ`으로 들어와서 연주가 통째로 죽는다. `code`는 **자판의 물리적 자리**라
 * 입력기와 무관하다. (`QuizPage`는 아직 `event.key`를 쓴다. 거기는 답을 한 번
 * 누르는 것이고 여기는 계속 치는 것이라 체감이 다르다.)
 */

/**
 * 쓸 수 있는 음역 = **청음이 쓰는 그 피아노 음원이 덮는 만큼.**
 *
 * `public/piano/manifest.json`의 region이 MIDI 21(A0)~108(C8)을 덮는다. 이
 * 밖으로 나가면 `PianoSynth.canPlay`가 거짓이 되어 그 음만 사인 신스로 나므로,
 * **음색이 섞이는 대신 아예 못 가게 막는다.** (매니페스트와 이 값이 어긋나면
 * `piano.test.ts`의 회귀 시험이 먼저 깨진다.)
 */
import { isBlackKey } from "./theory";

export const SAMPLE_LOW = 21; // A0
export const SAMPLE_HIGH = 108; // C8

/** 아무것도 옮기지 않았을 때 `A`가 내는 음. */
export const DEFAULT_BASE = 60; // C4

/** 자판 한 자리. `offset`은 도(`A`)에서 몇 반음 위인가. */
export interface KeyBinding {
  /** `KeyboardEvent.code` */
  readonly code: string;
  /** 건반에 적히는 글자 */
  readonly label: string;
  readonly offset: number;
}

/** 낮은 음부터. 그리는 순서이자 겹침 순서다. */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  { code: "KeyA", label: "A", offset: 0 },
  { code: "KeyW", label: "W", offset: 1 },
  { code: "KeyS", label: "S", offset: 2 },
  { code: "KeyE", label: "E", offset: 3 },
  { code: "KeyD", label: "D", offset: 4 },
  { code: "KeyF", label: "F", offset: 5 },
  { code: "KeyT", label: "T", offset: 6 },
  { code: "KeyG", label: "G", offset: 7 },
  { code: "KeyY", label: "Y", offset: 8 },
  { code: "KeyH", label: "H", offset: 9 },
  { code: "KeyU", label: "U", offset: 10 },
  { code: "KeyJ", label: "J", offset: 11 },
  { code: "KeyK", label: "K", offset: 12 },
  { code: "KeyO", label: "O", offset: 13 },
  { code: "KeyL", label: "L", offset: 14 },
  { code: "KeyP", label: "P", offset: 15 },
  { code: "Semicolon", label: ";", offset: 16 },
  { code: "Quote", label: "'", offset: 17 },
];

/** 자판이 한 번에 덮는 음역(반음). 맨 오른쪽 `'`까지의 거리다. */
export const SPAN = KEY_BINDINGS.reduce((m, k) => Math.max(m, k.offset), 0);

/**
 * 옮긴 양. **둘을 따로 두는 것은 화면에 따로 보이기 때문이다** — 실제 계산은
 * 언제나 합(`shiftOf`)만 쓴다.
 */
export interface Shift {
  /** 옥타브(12반음) 단위 */
  readonly octave: number;
  /** 반음 단위 */
  readonly transpose: number;
}

export const NO_SHIFT: Shift = { octave: 0, transpose: 0 };

/** 반음 이동은 옥타브 안에서만. 12를 넘으면 옥타브와 같은 말이 된다. */
export const TRANSPOSE_LIMIT = 11;

export function shiftOf(shift: Shift): number {
  return shift.octave * 12 + shift.transpose;
}

/** 지금 `A`가 내는 음. */
export function baseNote(shift: Shift): number {
  return DEFAULT_BASE + shiftOf(shift);
}

/** 이 기준음으로 두면 18개 건반이 전부 음원 안에 드는가. */
export function fits(base: number): boolean {
  return base >= SAMPLE_LOW && base + SPAN <= SAMPLE_HIGH;
}

/** `[가장 낮게, 가장 높게]` 갈 수 있는 옥타브. 반음 이동에 따라 달라진다. */
export function octaveBounds(transpose: number): [number, number] {
  // base = 60 + 12·octave + transpose 가 [SAMPLE_LOW, SAMPLE_HIGH - SPAN]에 들 것
  const low = SAMPLE_LOW - DEFAULT_BASE - transpose;
  const high = SAMPLE_HIGH - SPAN - DEFAULT_BASE - transpose;
  return [Math.ceil(low / 12), Math.floor(high / 12)];
}

/** `[가장 낮게, 가장 높게]` 갈 수 있는 반음 이동. */
export function transposeBounds(octave: number): [number, number] {
  const low = SAMPLE_LOW - DEFAULT_BASE - octave * 12;
  const high = SAMPLE_HIGH - SPAN - DEFAULT_BASE - octave * 12;
  return [Math.max(-TRANSPOSE_LIMIT, low), Math.min(TRANSPOSE_LIMIT, high)];
}

function clamp(value: number, [low, high]: [number, number]): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * 옮긴다. **음원 밖으로는 나가지 않는다** — 넘겨준 값이 밖이면 경계에서 멈춘다.
 * 화면이 미리 막지만(버튼 비활성) 자판·프로그램 경로가 따로 있으므로 여기서도 막는다.
 */
export function withOctave(shift: Shift, octave: number): Shift {
  return { ...shift, octave: clamp(octave, octaveBounds(shift.transpose)) };
}

export function withTranspose(shift: Shift, transpose: number): Shift {
  return { ...shift, transpose: clamp(transpose, transposeBounds(shift.octave)) };
}

/** 이 자판이 지금 내는 음. 배치에 없는 키면 null. */
export function noteFor(shift: Shift, code: string): number | null {
  const binding = KEY_BINDINGS.find((k) => k.code === code);
  return binding ? baseNote(shift) + binding.offset : null;
}

/** 한 건반. 화면은 이 표만 보고 그린다. */
export interface PianoKey extends KeyBinding {
  readonly midi: number;
  readonly black: boolean;
}

/**
 * 자판 배치를 그대로 건반으로. **`black`은 기준음에서의 거리로 정한다** — 옮긴
 * 뒤에도 `W`는 늘 검은건반 자리에 있어야 손가락 기억이 유지되기 때문이다
 * (반음 이동을 걸면 그 검은건반이 실제로는 흰건반 음을 낼 수 있다).
 */
export function layout(shift: Shift): PianoKey[] {
  const base = baseNote(shift);
  return KEY_BINDINGS.map((binding) => ({
    ...binding,
    midi: base + binding.offset,
    black: isBlackKey(binding.offset),
  }));
}

const BY_OFFSET = new Map(KEY_BINDINGS.map((k) => [k.offset, k]));

/**
 * **음역을 정해 놓고** 그리는 건반 — 문항형의 가상 건반이 쓴다.
 *
 * `layout`과 두 곳이 다르다. (1) `black`이 **실제 음고류**다 — 여기서는 절대
 * 음높이를 고르는 것이라 C♯은 언제나 검은건반이어야 한다. (2) 자판이 안 닿는
 * 음이 있을 수 있다(배치가 18개뿐이다). 그 건반은 `label`이 빈 문자열이고,
 * **누를 수는 있다** — 마우스로 답하는 것이 이 함수의 존재 이유다.
 */
export function rangeKeys(low: number, high: number, base = DEFAULT_BASE): PianoKey[] {
  const keys: PianoKey[] = [];
  for (let midi = low; midi <= high; midi += 1) {
    const offset = midi - base;
    const binding = BY_OFFSET.get(offset);
    keys.push({
      code: binding?.code ?? "",
      label: binding?.label ?? "",
      offset,
      midi,
      black: isBlackKey(midi),
    });
  }
  return keys;
}
