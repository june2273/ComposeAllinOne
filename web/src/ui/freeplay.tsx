/**
 * 가상 피아노 — 자판·마우스·MIDI 건반으로 **자유롭게 친다.**
 *
 * 문항형이 아니다. 문제도 점수도 제한시간도 없으므로 `Session`을 쓰지 않는다
 * (`AnalysisPage`가 `Session`을 안 쓰는 것과 같은 이유). 여기가 드는 상태는
 * 셋뿐이다 — 지금 눌린 음, 얼마나 옮겼는가, 서스테인.
 *
 * ## 소리를 내는 경로가 문항형과 다르다
 *
 * `playNotes`는 맨 앞에서 `stop()`을 부른다 — "한 문제가 한 소리"라서 그렇다.
 * 연주에서 그러면 **두 번째 음이 첫 번째 음을 끄기 때문에 화음이 나지 않는다.**
 * 그래서 `AudioBackend.noteOn`(뗄 때까지 울린다)을 쓰고, 손잡이를 음마다 들고
 * 있다가 뗄 때 되돌려준다.
 *
 * ## 입력 경로가 셋인데 게이트는 하나다
 *
 * 자판(`onKeyDown`) · 포인터(`ds.Keyboard`) · MIDI(`useMidi`)가 전부
 * `press`/`release` 한 쌍으로 모인다. 문항형의 `accepting` 게이트와 같은 방침이고,
 * 셋이 같은 음을 동시에 잡아도 `heldRef`가 한 번만 울리게 막는다.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { AudioBackend, NoteHandle } from "../core/audio";
import {
  NO_SHIFT,
  SAMPLE_HIGH,
  SAMPLE_LOW,
  SPAN,
  type Shift,
  baseNote,
  layout,
  noteFor,
  octaveBounds,
  transposeBounds,
  withOctave,
  withTranspose,
} from "../core/keyboard";
import { noteName, noteNames } from "../core/theory";
import {
  Button,
  Fieldset,
  Hint,
  Keyboard,
  PageHeading,
  Stack,
  Stepper,
  Toggle,
} from "../ds";
import type { MidiEnv } from "../platform/midi";
import { MidiRow } from "./components";
import { useMidi } from "./useMidi";

/**
 * 자판에는 세기가 없다. 80은 벨로시티 두 층의 경계(vL은 0~80)라 **문항형 재생과
 * 같은 샘플**이 난다 — 같은 음을 청음에서 듣고 여기서 쳤을 때 음색이 달라지면
 * 그 자체가 혼란이다. MIDI 건반은 자기 세기를 그대로 쓴다.
 */
const KEY_VELOCITY = 80;

/** 옥타브·반음을 옮기는 자판. 배치의 18개 어디에도 안 겹치는 것으로 골랐다. */
const SHIFT_KEYS: Record<string, (shift: Shift) => Shift> = {
  KeyZ: (s) => withOctave(s, s.octave - 1),
  ArrowDown: (s) => withOctave(s, s.octave - 1),
  KeyX: (s) => withOctave(s, s.octave + 1),
  ArrowUp: (s) => withOctave(s, s.octave + 1),
  ArrowLeft: (s) => withTranspose(s, s.transpose - 1),
  ArrowRight: (s) => withTranspose(s, s.transpose + 1),
};

/** 부호를 붙인다. 음수는 −/+ 버튼과 같은 문자(U+2212)를 써서 눈에 짝지어 보이게 한다. */
function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `\u2212${Math.abs(n)}`;
  return "0";
}

export function FreePlayPage({
  audio,
  midiEnv,
}: {
  audio: AudioBackend;
  /** 테스트가 가짜 MIDIAccess를 넣는 자리. 앱에서는 넘기지 않는다 */
  midiEnv?: MidiEnv;
}) {
  const [shift, setShift] = useState<Shift>(NO_SHIFT);
  const [pressed, setPressed] = useState<ReadonlySet<number>>(() => new Set());
  const [sustain, setSustain] = useState(false);

  /** 지금 눌려 있는 음 → 그 음의 손잡이. **소리의 단일 출처다.** */
  const heldRef = useRef(new Map<number, NoteHandle>());
  /** 뗐지만 서스테인 때문에 아직 울리는 것들 */
  const ringingRef = useRef<NoteHandle[]>([]);
  // 이벤트 핸들러가 최신 값을 보되, 값이 바뀔 때마다 리스너를 다시 걸지는
  // 않게 한다 — 리스너를 다시 걸면 그 순간 눌려 있던 키의 keyup을 놓친다.
  const shiftRef = useRef(shift);
  const sustainRef = useRef(sustain);
  useEffect(() => {
    shiftRef.current = shift;
  }, [shift]);
  useEffect(() => {
    sustainRef.current = sustain;
  }, [sustain]);

  const press = useCallback(
    (midi: number, velocity = KEY_VELOCITY) => {
      // 음원 밖은 아예 울리지 않는다. 자판은 배치가 이미 막지만 MIDI 건반은
      // 88건반 밖(전자 건반의 옥타브 버튼)을 보낼 수 있다.
      if (midi < SAMPLE_LOW || midi > SAMPLE_HIGH) return;
      if (heldRef.current.has(midi)) return;
      heldRef.current.set(midi, audio.noteOn(midi, velocity));
      setPressed((p) => new Set(p).add(midi));
    },
    [audio],
  );

  const release = useCallback((midi: number) => {
    const handle = heldRef.current.get(midi);
    if (!handle) return;
    heldRef.current.delete(midi);
    if (sustainRef.current) ringingRef.current.push(handle);
    else handle.release();
    setPressed((p) => {
      const next = new Set(p);
      next.delete(midi);
      return next;
    });
  }, []);

  /** 전부 끈다 — 화면을 떠날 때, 창이 포커스를 잃었을 때, 배치를 옮길 때. */
  const releaseAll = useCallback(() => {
    for (const handle of heldRef.current.values()) handle.release();
    heldRef.current.clear();
    for (const handle of ringingRef.current) handle.release();
    ringingRef.current = [];
    setPressed(new Set());
  }, []);

  // MIDI 건반은 **옮긴 양을 타지 않는다.** 실제 건반은 자기 음이 이미 정해져
  // 있고, 옥타브·반음 이동은 "자판 18개를 어디에 놓을까"의 문제이기 때문이다.
  const midi = useMidi(
    true,
    useCallback((note: number, velocity: number) => press(note, velocity), [press]),
    midiEnv,
    useCallback((note: number) => release(note), [release]),
  );

  // 배치를 옮기면 눌려 있던 키의 자리가 바뀐다. 그대로 두면 keyup이 다른 음을
  // 가리켜 앞의 음이 영영 울린다.
  useEffect(() => {
    for (const handle of heldRef.current.values()) handle.release();
    heldRef.current.clear();
    setPressed(new Set());
  }, [shift]);

  // 서스테인을 끄면 그동안 매달아 둔 것들을 한꺼번에 뗀다.
  useEffect(() => {
    if (sustain) return;
    for (const handle of ringingRef.current) handle.release();
    ringingRef.current = [];
  }, [sustain]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const move = SHIFT_KEYS[event.code];
      if (move) {
        // 화살표는 눌러 두면 계속 옮겨진다(repeat 허용). 페이지가 함께
        // 스크롤되면 건반이 화면 밖으로 나가므로 기본 동작을 막는다.
        event.preventDefault();
        setShift(move);
        return;
      }
      if (event.repeat) return;
      // **`code`로 잡는다** — 한글 입력 상태에서 `key`는 `ㅁ`으로 들어온다.
      const note = noteFor(shiftRef.current, event.code);
      if (note === null) return;
      event.preventDefault();
      press(note);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const note = noteFor(shiftRef.current, event.code);
      if (note !== null) release(note);
    };
    // 창을 벗어나면 keyup이 오지 않는다 — 그대로 두면 음이 매달린다.
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
    };
  }, [press, release, releaseAll]);

  // 화면을 떠날 때. audio는 App이 들고 있어 여기서 버려지지 않으므로,
  // 매달린 음을 우리가 끄지 않으면 다른 화면에서도 계속 울린다.
  useEffect(() => releaseAll, [releaseAll]);

  const keys = layout(shift);
  // 안내 문구를 손으로 적지 않는다 — 배치를 고치면 문구가 조용히 거짓이 된다.
  const whiteRow = keys.filter((k) => !k.black).map((k) => k.label).join(" ");
  const blackRow = keys.filter((k) => k.black).map((k) => k.label).join(" ");
  const base = baseNote(shift);
  const [octaveLow, octaveHigh] = octaveBounds(shift.transpose);
  const [transposeLow, transposeHigh] = transposeBounds(shift.octave);

  return (
    <Stack>
      <PageHeading
        title="가상 피아노"
        // "도 = B0"으로 적으면 도(계이름)와 B0(음이름)이 한 줄에서 부딪힌다.
        // 옮긴 뒤에는 **어느 자판이 무슨 음인지**가 알고 싶은 것이다.
        subtitle={`자판 A = ${noteName(base)} · 음역 ${noteName(base)} ~ ${noteName(base + SPAN)}`}
      />

      <MidiRow midi={midi} />

      <Keyboard
        label="가상 피아노 건반"
        keys={keys.map((key) => ({
          id: String(key.midi),
          label: key.label,
          caption: noteName(key.midi),
          black: key.black,
          pressed: pressed.has(key.midi),
        }))}
        onPress={(id) => press(Number(id))}
        onRelease={(id) => release(Number(id))}
      />

      <p className="freeplay__sounding" aria-live="polite">
        {pressed.size ? noteNames(pressed) : " "}
      </p>

      <Fieldset title="높낮이">
        <div className="freeplay__controls">
          <Stepper
            label="옥타브"
            value={signed(shift.octave)}
            keys={["Z", "X"]}
            hint="12반음씩"
            canDown={shift.octave > octaveLow}
            canUp={shift.octave < octaveHigh}
            onDown={() => setShift((s) => withOctave(s, s.octave - 1))}
            onUp={() => setShift((s) => withOctave(s, s.octave + 1))}
          />
          <Stepper
            label="트랜스포즈"
            value={`${signed(shift.transpose)}반음`}
            keys={["←", "→"]}
            hint="한 반음씩"
            canDown={shift.transpose > transposeLow}
            canUp={shift.transpose < transposeHigh}
            onDown={() => setShift((s) => withTranspose(s, s.transpose - 1))}
            onUp={() => setShift((s) => withTranspose(s, s.transpose + 1))}
          />
        </div>
        <Toggle
          label="서스테인"
          hint="켜면 건반을 떼도 소리가 남는다 (피아노의 오른쪽 페달)"
          checked={sustain}
          onChange={setSustain}
        />
        <div className="freeplay__actions">
          <Button onClick={releaseAll}>소리 멈추기</Button>
          <Button
            disabled={shift.octave === 0 && shift.transpose === 0}
            onClick={() => setShift(NO_SHIFT)}
          >
            기본 음역으로 (도 = C4)
          </Button>
        </div>
      </Fieldset>

      <Hint>
        아랫줄 <b>{whiteRow}</b>가 흰건반, 윗줄 <b>{blackRow}</b>가 검은건반이다.
        마우스로 눌러도 되고, 누른 채 옆으로 끌면 이어서 난다.
      </Hint>
      <Hint>
        음역은 청음이 쓰는 그 피아노 음원이 덮는 만큼이다 —{" "}
        {noteName(SAMPLE_LOW)}부터 {noteName(SAMPLE_HIGH)}까지. 옥타브·트랜스포즈는
        그 밖으로 나가지 않는다. MIDI 건반은 옮긴 양과 무관하게 자기 음을 그대로 낸다.
      </Hint>
    </Stack>
  );
}
