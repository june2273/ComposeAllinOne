/**
 * Web MIDI 검증.
 *
 * jsdom에는 Web MIDI가 없으므로 가짜 `MIDIAccess`를 주입한다(`MidiEnv`가 그
 * 자리다). 확인하려는 것은 브라우저 구현이 아니라 **우리 쪽 배선** — 어떤
 * 포트를 듣고 어떤 것을 버리는지, 락아웃 게이트를 지나는지, StrictMode에서
 * 이중 마운트를 견디는지다.
 */
import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { NullSynth } from "../src/core/audio";
import { DIATONIC_INTERVALS, INTERMEDIATE } from "../src/core/config";
import type { Result } from "../src/core/session";
import {
  WebMidiInput,
  parseNoteMessage,
  rankPort,
  usablePort,
} from "../src/platform/midi";
import { QuizPage } from "../src/ui/pages";

vi.mock("../src/core/score", () => ({
  ScoreRenderer: { load: () => Promise.reject(new Error("jsdom")) },
}));

const audio = new NullSynth();

// --- 가짜 MIDI 장치 -----------------------------------------------------------

class FakePort extends EventTarget {
  readonly name: string;
  /** 지금 붙어 있는 midimessage 리스너 수 — 이중 바인딩을 직접 센다 */
  listeners = 0;
  constructor(name: string) {
    super();
    this.name = name;
  }
  override addEventListener(type: string, fn: EventListenerOrEventListenerObject | null) {
    if (type === "midimessage") this.listeners += 1;
    super.addEventListener(type, fn);
  }
  override removeEventListener(
    type: string,
    fn: EventListenerOrEventListenerObject | null,
  ) {
    if (type === "midimessage") this.listeners -= 1;
    super.removeEventListener(type, fn);
  }
  /** 건반이 바이트를 보낸 것처럼 흉내낸다 */
  send(bytes: number[]): void {
    const event = new Event("midimessage");
    Object.assign(event, { data: new Uint8Array(bytes) });
    this.dispatchEvent(event);
  }
}

class FakeAccess {
  readonly inputs = new Map<string, FakePort>();
  onstatechange: ((event: Event) => void) | null = null;
  constructor(names: string[]) {
    for (const name of names) this.inputs.set(name, new FakePort(name));
  }
  port(name: string): FakePort {
    const p = this.inputs.get(name);
    if (!p) throw new Error(`포트 없음: ${name}`);
    return p;
  }
  /** 건반을 나중에 꽂은 상황 */
  plug(name: string): FakePort {
    const port = new FakePort(name);
    this.inputs.set(name, port);
    this.onstatechange?.(new Event("statechange"));
    return port;
  }
}

function envFor(access: FakeAccess) {
  return {
    requestAccess: () => Promise.resolve(access as unknown as MIDIAccess),
    secureContext: true,
  };
}

/** 실측한 KeyLab Essential 61 mk3의 포트 구성 */
const KEYLAB = [
  "KL Essential 61 mk3 MIDI",
  "KL Essential 61 mk3 DINTHRU",
  "KL Essential 61 mk3 MCU/HUI",
  "KL Essential 61 mk3 ALV",
];

// --- 순수 함수 ----------------------------------------------------------------

describe("포트 순위 (Python midi_input.py와 같은 규칙)", () => {
  test("건반 포트가 맨 앞, 오답 유발 포트는 배제된다", () => {
    const sorted = [...KEYLAB].sort((a, b) => rankPort(a) - rankPort(b));
    expect(sorted[0]).toBe("KL Essential 61 mk3 MIDI");
    expect(KEYLAB.filter(usablePort)).toEqual(["KL Essential 61 mk3 MIDI"]);
  });

  test("MCU·HUI·THRU·ALV·DAW·control은 전부 배제", () => {
    for (const bad of ["X MCU", "y hui", "Thru port", "ALV", "DAW ctrl", "Control Surface"]) {
      expect(usablePort(bad)).toBe(false);
    }
  });

  test("이름에 midi가 없어도 배제 목록에 없으면 쓴다", () => {
    expect(usablePort("Arturia KeyStep")).toBe(true);
    expect(rankPort("Arturia KeyStep")).toBe(1);
  });
});

describe("메시지 해석", () => {
  test("note-on", () => {
    expect(parseNoteMessage(new Uint8Array([0x90, 60, 100]))).toEqual({
      type: "on",
      note: 60,
      velocity: 100,
    });
  });

  test("벨로시티 0인 note-on은 note-off다", () => {
    expect(parseNoteMessage(new Uint8Array([0x90, 60, 0]))?.type).toBe("off");
  });

  test("채널은 무시한다", () => {
    expect(parseNoteMessage(new Uint8Array([0x9f, 62, 80]))?.note).toBe(62);
    expect(parseNoteMessage(new Uint8Array([0x8a, 62, 0]))?.type).toBe("off");
  });

  test("노트가 아닌 메시지와 짧은 버퍼는 무시한다", () => {
    expect(parseNoteMessage(new Uint8Array([0xb0, 7, 100]))).toBeNull(); // CC
    expect(parseNoteMessage(new Uint8Array([0xf8]))).toBeNull(); // 클럭
    expect(parseNoteMessage(null)).toBeNull();
  });
});

// --- 어댑터 -------------------------------------------------------------------

describe("WebMidiInput", () => {
  test("쓸 만한 포트만 듣고, 배제 포트의 노트는 도착하지 않는다", async () => {
    const access = new FakeAccess(KEYLAB);
    const notes: number[] = [];
    const midi = new WebMidiInput({ onNoteOn: (n) => notes.push(n) }, envFor(access));
    await midi.start();

    expect(midi.current.status).toBe("ready");
    expect(midi.current.listening).toEqual(["KL Essential 61 mk3 MIDI"]);
    expect(midi.current.ignored).toHaveLength(3);

    access.port("KL Essential 61 mk3 MIDI").send([0x90, 60, 100]);
    access.port("KL Essential 61 mk3 MCU/HUI").send([0x90, 91, 127]); // 트랜스포트 버튼
    expect(notes).toEqual([60]);
  });

  test("note-off는 note-on 콜백을 부르지 않는다", async () => {
    const access = new FakeAccess(["Test MIDI"]);
    const on: number[] = [];
    const off: number[] = [];
    const midi = new WebMidiInput(
      { onNoteOn: (n) => on.push(n), onNoteOff: (n) => off.push(n) },
      envFor(access),
    );
    await midi.start();
    access.port("Test MIDI").send([0x90, 64, 90]);
    access.port("Test MIDI").send([0x80, 64, 0]);
    access.port("Test MIDI").send([0x90, 64, 0]); // 벨로시티 0
    expect(on).toEqual([64]);
    expect(off).toEqual([64, 64]);
  });

  test("Web MIDI가 없으면 unsupported로 알리고 던지지 않는다", async () => {
    const midi = new WebMidiInput({ onNoteOn: () => {} }, { secureContext: true });
    await midi.start();
    expect(midi.current.status).toBe("unsupported");
    expect(midi.current.message).toContain("Chrome");
  });

  test("보안 컨텍스트가 아니면 insecure", async () => {
    const access = new FakeAccess(["Test MIDI"]);
    const midi = new WebMidiInput(
      { onNoteOn: () => {} },
      { ...envFor(access), secureContext: false },
    );
    await midi.start();
    expect(midi.current.status).toBe("insecure");
  });

  test("권한 거부는 denied, 다른 오류는 error", async () => {
    const denied = new WebMidiInput(
      { onNoteOn: () => {} },
      {
        secureContext: true,
        requestAccess: () =>
          Promise.reject(new DOMException("nope", "SecurityError")),
      },
    );
    await denied.start();
    expect(denied.current.status).toBe("denied");

    const broken = new WebMidiInput(
      { onNoteOn: () => {} },
      { secureContext: true, requestAccess: () => Promise.reject(new Error("boom")) },
    );
    await broken.start();
    expect(broken.current.status).toBe("error");
  });

  test("쓸 포트가 하나도 없으면 no-device (무시한 포트를 알려준다)", async () => {
    const access = new FakeAccess(["Some MCU/HUI"]);
    const midi = new WebMidiInput({ onNoteOn: () => {} }, envFor(access));
    await midi.start();
    expect(midi.current.status).toBe("no-device");
    expect(midi.current.message).toContain("Some MCU/HUI");
  });

  test("나중에 꽂은 건반이 잡힌다 (statechange)", async () => {
    const access = new FakeAccess([]);
    const notes: number[] = [];
    const midi = new WebMidiInput({ onNoteOn: (n) => notes.push(n) }, envFor(access));
    await midi.start();
    expect(midi.current.status).toBe("no-device");

    const port = access.plug("Late MIDI");
    expect(midi.current.status).toBe("ready");
    port.send([0x90, 67, 100]);
    expect(notes).toEqual([67]);
  });

  test("포트를 두 번 붙이지 않는다 (refresh를 반복해도 노트는 한 번)", async () => {
    const access = new FakeAccess(["Test MIDI"]);
    const notes: number[] = [];
    const midi = new WebMidiInput({ onNoteOn: (n) => notes.push(n) }, envFor(access));
    await midi.start();
    midi.refresh();
    midi.refresh();
    access.port("Test MIDI").send([0x90, 60, 100]);
    expect(notes).toEqual([60]);
  });

  test("stop() 뒤에는 노트가 도착하지 않는다", async () => {
    const access = new FakeAccess(["Test MIDI"]);
    const notes: number[] = [];
    const midi = new WebMidiInput({ onNoteOn: (n) => notes.push(n) }, envFor(access));
    await midi.start();
    midi.stop();
    access.port("Test MIDI").send([0x90, 60, 100]);
    expect(notes).toEqual([]);
  });

  test("start()가 끝나기 전에 stop()하면 아무것도 붙지 않는다 (StrictMode)", async () => {
    const access = new FakeAccess(["Test MIDI"]);
    const notes: number[] = [];
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const midi = new WebMidiInput(
      { onNoteOn: (n) => notes.push(n) },
      {
        secureContext: true,
        requestAccess: async () => {
          await gate;
          return access as unknown as MIDIAccess;
        },
      },
    );

    const starting = midi.start();
    midi.stop(); // 권한 응답이 오기 전에 언마운트
    release!();
    await starting;

    access.port("Test MIDI").send([0x90, 60, 100]);
    expect(notes).toEqual([]);
  });
});

// --- 화면 결선 ----------------------------------------------------------------

describe("QuizPage 결선", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  async function pastLockout() {
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
  }

  test("건반을 누르면 채점된다 — 자판 폴백과 같은 경로", async () => {
    const access = new FakeAccess(KEYLAB);
    const finished: Result[][] = [];
    await act(async () => {
      render(
        <QuizPage
          config={INTERMEDIATE}
          audio={audio}
          onFinished={(r) => finished.push(r)}
          midiEnv={envFor(access)}
        />,
      );
    });

    expect(screen.getByText(/KL Essential 61 mk3 MIDI/)).toBeTruthy();

    await pastLockout();
    await act(async () => {
      access.port("KL Essential 61 mk3 MIDI").send([0x90, 60, 100]);
    });
    const judged =
      screen.queryByText("정답") !== null || screen.queryByText("오답") !== null;
    expect(judged).toBe(true);
  });

  test("락아웃 중 건반 입력은 버려진다", async () => {
    const access = new FakeAccess(["Test MIDI"]);
    await act(async () => {
      render(
        <QuizPage
          config={INTERMEDIATE}
          audio={audio}
          onFinished={() => {}}
          midiEnv={envFor(access)}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 40; i += 1) {
        access.port("Test MIDI").send([0x90, 60 + (i % 12), 100]);
      }
    });
    expect(screen.queryByText("정답")).toBeNull();
    expect(screen.queryByText("오답")).toBeNull();
  });

  test("음정 스테이지에서는 MIDI를 아예 열지 않는다", async () => {
    const access = new FakeAccess(KEYLAB);
    const requestAccess = vi.fn(() =>
      Promise.resolve(access as unknown as MIDIAccess),
    );
    await act(async () => {
      render(
        <QuizPage
          config={DIATONIC_INTERVALS}
          audio={audio}
          onFinished={() => {}}
          midiEnv={{ requestAccess, secureContext: true }}
        />,
      );
    });
    expect(requestAccess).not.toHaveBeenCalled();
    expect(screen.queryByText("MIDI")).toBeNull();
  });

  test("StrictMode 이중 마운트에서도 포트에 리스너가 하나만 붙는다", async () => {
    const access = new FakeAccess(["Test MIDI"]);
    const { unmount } = render(
      <StrictMode>
        <QuizPage
          config={INTERMEDIATE}
          audio={audio}
          onFinished={() => {}}
          midiEnv={envFor(access)}
        />
      </StrictMode>,
    );
    await act(async () => {});

    // StrictMode는 마운트 → 정리 → 재마운트를 한다. 세대 번호 가드가 없으면
    // 버려졌어야 할 첫 start()가 뒤늦게 포트를 붙여 노트가 두 번 들어간다.
    expect(access.port("Test MIDI").listeners).toBe(1);

    unmount();
    expect(access.port("Test MIDI").listeners).toBe(0);
  });
});
