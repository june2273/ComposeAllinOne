/**
 * MIDI 입력을 React 수명주기에 붙이는 훅.
 *
 * `platform/midi.ts`(브라우저가 어떻게 하는가)와 `useSession`(무엇이 정답인가)
 * 사이의 얇은 층이다. **여기에도 음악적 판단은 없다** — note-on을 그대로
 * 위로 올려보낼 뿐이고, 락아웃·화음 확정·채점은 전부 `Session`이 한다.
 *
 * Tauri로 옮길 때 바뀌는 것은 아래 `new WebMidiInput(...)` 한 줄이다.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  IDLE_SNAPSHOT,
  type MidiEnv,
  type MidiSnapshot,
  WebMidiInput,
} from "../platform/midi";

export interface MidiView extends MidiSnapshot {
  /** 건반을 나중에 연결한 경우 다시 훑는다 */
  refresh: () => void;
}


/**
 * @param enabled 스테이지가 건반으로 답하는가. false면 아예 권한을 요청하지
 *   않는다 — 화면으로 답하는 스테이지에서 권한 팝업이 뜨면 방해만 된다.
 * @param onNoteOn 건반이 눌렸을 때. 최신 참조를 ref로 잡으므로 매 렌더마다
 *   새 함수를 넘겨도 MIDI가 다시 열리지 않는다.
 */
export function useMidi(
  enabled: boolean,
  onNoteOn: (note: number, velocity: number, timeStamp: number) => void,
  env?: MidiEnv,
  /**
   * 뗐을 때. **문항형은 넘기지 않는다** — 답은 누른 순간 정해지고 언제 뗐는지는
   * 채점에 들어가지 않는다. 자유 연주만 이것으로 소리를 끈다.
   */
  onNoteOff?: (note: number) => void,
): MidiView {
  const [snapshot, setSnapshot] = useState<MidiSnapshot>(IDLE_SNAPSHOT);
  const inputRef = useRef<WebMidiInput | null>(null);

  const handler = useRef(onNoteOn);
  useEffect(() => {
    handler.current = onNoteOn;
  }, [onNoteOn]);

  const offHandler = useRef(onNoteOff);
  useEffect(() => {
    offHandler.current = onNoteOff;
  }, [onNoteOff]);

  // env를 의존성 배열에 넣으면 안 된다. 호출부가 객체 리터럴을 넘기는 순간
  // 매 렌더마다 MIDI를 닫았다 여는 꼴이 된다(권한 팝업이 반복된다).
  const envRef = useRef(env);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(IDLE_SNAPSHOT);
      return;
    }
    const input = new WebMidiInput(
      {
        onNoteOn: (note, velocity, timeStamp) =>
          handler.current(note, velocity, timeStamp),
        onNoteOff: (note) => offHandler.current?.(note),
        onChange: setSnapshot,
      },
      envRef.current,
    );
    inputRef.current = input;
    void input.start();
    // StrictMode는 이 정리 함수를 한 번 더 부른다. stop()이 세대 번호를 올려
    // 진행 중이던 start()가 포트를 붙이지 못하게 막는다.
    return () => {
      input.stop();
      if (inputRef.current === input) inputRef.current = null;
    };
  }, [enabled]);

  const refresh = useCallback(() => inputRef.current?.refresh(), []);

  return { ...snapshot, refresh };
}
