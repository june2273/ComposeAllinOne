/**
 * 가상 피아노 — **결선을 본다.** 소리 자체는 `audio.test.ts`·`piano.test.ts`가
 * 보고, 여기서는 자판·포인터·MIDI 셋이 같은 한 쌍(`noteOn`/`release`)으로 모이는지,
 * 그리고 **음이 매달리지 않는지**를 본다. 매달린 음은 화면을 떠나도 계속 울린다.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, test } from "vitest";

import {
  type AudioBackend,
  type NoteHandle,
  SILENT_SEQUENCE,
  type Sequence,
} from "../src/core/audio";
import { FreePlayPage } from "../src/ui/freeplay";

/** 어떤 음이 언제 울리기 시작했고 언제 꺼졌는지만 센다. */
class RecordingBackend implements AudioBackend {
  readonly started: number[] = [];
  readonly released: number[] = [];

  playNotes(): void {}
  // 자유 연주는 시퀀스를 쓰지 않는다 — 인터페이스만 채운다
  playSequence(): Sequence {
    return SILENT_SEQUENCE;
  }
  stop(): void {}
  noteOn(midiNote: number): NoteHandle {
    this.started.push(midiNote);
    let done = false;
    return {
      release: () => {
        if (done) return;
        done = true;
        this.released.push(midiNote);
      },
    };
  }
  /** 지금 울리고 있는 음 (시작했고 아직 안 꺼진 것) */
  sounding(): number[] {
    const left = [...this.started];
    for (const note of this.released) left.splice(left.indexOf(note), 1);
    return left.sort((a, b) => a - b);
  }
}

/** 자판은 `event.code`로 잡는다 — `key`는 한글 입력 상태에서 달라진다. */
function down(code: string) {
  act(() => {
    fireEvent.keyDown(window, { code, key: code });
  });
}
function up(code: string) {
  act(() => {
    fireEvent.keyUp(window, { code, key: code });
  });
}

function mount() {
  const audio = new RecordingBackend();
  // MIDI는 없는 환경으로 둔다. 여기서 보려는 것은 자판·포인터 경로다.
  const view = render(<FreePlayPage audio={audio} midiEnv={{ requestAccess: undefined }} />);
  return { audio, view };
}

describe("자판", () => {
  test("A가 C4를 내고, 떼면 꺼진다", () => {
    const { audio } = mount();
    down("KeyA");
    expect(audio.started).toEqual([60]);
    expect(audio.released).toEqual([]);
    up("KeyA");
    expect(audio.released).toEqual([60]);
  });

  test("여러 음이 동시에 울린다 — 새 음이 앞의 음을 끊지 않는다", () => {
    const { audio } = mount();
    down("KeyA");
    down("KeyD");
    down("KeyG");
    expect(audio.sounding()).toEqual([60, 64, 67]); // C4 E4 G4
  });

  test("' 는 F5", () => {
    const { audio } = mount();
    down("Quote");
    expect(audio.started).toEqual([77]);
  });

  test("눌린 채 반복 이벤트가 와도 한 번만 울린다", () => {
    const { audio } = mount();
    down("KeyA");
    act(() => {
      fireEvent.keyDown(window, { code: "KeyA", repeat: true });
    });
    expect(audio.started).toEqual([60]);
  });

  test("배치에 없는 키는 아무 일도 하지 않는다", () => {
    const { audio } = mount();
    down("KeyQ");
    down("KeyR");
    expect(audio.started).toEqual([]);
  });
});

describe("옥타브·트랜스포즈", () => {
  test("Z로 내리면 A가 C3가 된다", () => {
    const { audio } = mount();
    down("KeyZ");
    down("KeyA");
    expect(audio.started).toEqual([48]);
  });

  test("X로 올리고 →로 반음 더", () => {
    const { audio } = mount();
    down("KeyX");
    down("ArrowRight");
    down("KeyA");
    expect(audio.started).toEqual([73]); // 60 + 12 + 1
  });

  test("옮기면 눌려 있던 음을 먼저 끈다 — 그대로 두면 keyup이 다른 음을 가리킨다", () => {
    const { audio } = mount();
    down("KeyA");
    expect(audio.sounding()).toEqual([60]);
    down("KeyX");
    expect(audio.sounding()).toEqual([]);
  });

  test("음원 밖으로는 못 나간다 — 끝까지 눌러도 버튼이 잠긴다", () => {
    mount();
    for (let i = 0; i < 20; i += 1) down("KeyZ");
    const button = screen.getByLabelText("옥타브 내리기") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test("기본 음역으로 되돌린다", () => {
    const { audio } = mount();
    down("KeyZ");
    act(() => {
      screen.getByText(/기본 음역으로/u).click();
    });
    down("KeyA");
    expect(audio.started).toEqual([60]);
  });
});

describe("서스테인", () => {
  test("켜면 떼도 울리고, 끄면 그때 한꺼번에 꺼진다", () => {
    const { audio } = mount();
    act(() => {
      screen.getByLabelText("서스테인").click();
    });
    down("KeyA");
    up("KeyA");
    expect(audio.sounding()).toEqual([60]); // 뗐는데 아직 울린다
    act(() => {
      screen.getByLabelText("서스테인").click();
    });
    expect(audio.sounding()).toEqual([]);
  });
});

describe("음이 매달리지 않는다", () => {
  test("화면을 떠나면 전부 꺼진다 — audio는 App이 계속 들고 있다", () => {
    const { audio, view } = mount();
    down("KeyA");
    down("KeyD");
    view.unmount();
    expect(audio.sounding()).toEqual([]);
  });

  test("창이 포커스를 잃으면 꺼진다 — keyup이 오지 않는다", () => {
    const { audio } = mount();
    down("KeyA");
    act(() => {
      fireEvent.blur(window);
    });
    expect(audio.sounding()).toEqual([]);
  });

  test("'소리 멈추기'가 서스테인으로 남은 것까지 끈다", () => {
    const { audio } = mount();
    act(() => {
      screen.getByLabelText("서스테인").click();
    });
    down("KeyA");
    up("KeyA");
    act(() => {
      screen.getByText("소리 멈추기").click();
    });
    expect(audio.sounding()).toEqual([]);
  });
});

test("포인터로 눌러도 같은 경로를 지난다", () => {
  const { audio } = mount();
  const key = screen.getByLabelText("C4 (A)");
  act(() => {
    fireEvent.pointerDown(key);
  });
  expect(audio.started).toEqual([60]);
  act(() => {
    fireEvent.pointerUp(key);
  });
  expect(audio.released).toEqual([60]);
});

/**
 * StrictMode는 이펙트를 한 번 더 붙였다 뗀다. 정리 함수가 `releaseAll`이라
 * **마운트하자마자 이미 울리는 음을 끄는 사고**가 나기 쉬운 자리다.
 */
test("StrictMode에서 이중 마운트를 견딘다", () => {
  const audio = new RecordingBackend();
  render(
    <StrictMode>
      <FreePlayPage audio={audio} midiEnv={{ requestAccess: undefined }} />
    </StrictMode>,
  );
  down("KeyA");
  expect(audio.sounding()).toEqual([60]);
  up("KeyA");
  expect(audio.sounding()).toEqual([]);
});
