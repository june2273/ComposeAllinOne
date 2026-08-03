/**
 * Web MIDI 입력 — 브라우저에서 건반을 읽는다.
 *
 * **`platform/` 층의 첫 파일이다.** 여기 있는 것은 "브라우저가 어떻게 하는가"
 * 뿐이고, 음악적 판단은 하나도 하지 않는다. 어떤 음이 정답인지, 언제 확정할지는
 * `core/`의 Session·Grader가 정한다. Tauri로 옮길 때 이 파일만 갈아끼우면 되고,
 * 그 위층(`ui/useMidi.ts`)은 바뀌지 않아야 한다.
 *
 * 브라우저 지원이 갈린다 — **Chrome·Edge에는 있고 Safari·Firefox에는 없다.**
 * 없을 때 앱이 죽으면 안 되므로 상태를 값으로 돌려주고, 호출부는 자판 폴백으로
 * 계속 연습할 수 있게 둔다.
 *
 * Python/Qt판(`midi_input.py`)과 다른 점 하나: **스레드 경계가 없다.** rtmidi는
 * 별도 스레드에서 콜백을 부르기 때문에 Qt 시그널로 넘겨야 했지만, Web MIDI의
 * `midimessage`는 메인 스레드 이벤트 루프로 들어온다. 그래서 여기서는 그 규칙이
 * 필요 없다 — 다만 **Tauri(Rust midir)로 가면 경계가 다시 생긴다.**
 */

/**
 * 컨트롤러 하나가 포트를 여러 개 내보내는 경우가 많다. KeyLab Essential은
 * MIDI / DINTHRU / MCU-HUI / ALV 네 개를 띄우는데, 건반 노트가 나오는 건 MIDI
 * 포트뿐이고 **MCU/HUI 포트는 트랜스포트 버튼을 노트 메시지로 보내서 오답
 * 판정을 유발한다.** 포트 이름 해석은 MIDI의 관심사라 UI가 아니라 여기 둔다.
 *
 * Python판 `midi_input.PORT_AVOID`와 같은 목록이다. 한쪽만 고치지 말 것.
 */
export const PORT_AVOID = ["mcu", "hui", "thru", "alv", "daw", "control"];

/** 낮을수록 건반 노트가 나올 가능성이 높다. 2는 "쓰지 않는다"는 뜻. */
export function rankPort(name: string): number {
  const low = name.toLowerCase();
  if (PORT_AVOID.some((k) => low.includes(k))) return 2;
  return low.includes("midi") ? 0 : 1;
}

export function usablePort(name: string): boolean {
  return rankPort(name) < 2;
}

export type MidiStatus =
  /** 브라우저에 Web MIDI가 없다 (Safari·Firefox) */
  | "unsupported"
  /** https도 localhost도 아니다 — Web MIDI는 보안 컨텍스트를 요구한다 */
  | "insecure"
  /** 권한 확인 중 */
  | "requesting"
  /** 사용자가 거부했거나 정책이 막았다 */
  | "denied"
  /** 권한은 있으나 쓸 만한 포트가 없다 */
  | "no-device"
  | "ready"
  | "error";

export interface MidiSnapshot {
  status: MidiStatus;
  /** 실제로 듣고 있는 포트 이름 */
  listening: readonly string[];
  /** 이름 때문에 일부러 무시한 포트 (MCU/HUI 등) */
  ignored: readonly string[];
  /** 화면에 그대로 띄울 한 줄 */
  message: string;
}

export const IDLE_SNAPSHOT: MidiSnapshot = {
  status: "requesting",
  listening: [],
  ignored: [],
  message: "MIDI 장치를 찾는 중…",
};

export interface MidiHandlers {
  /**
   * note-on 하나.
   *
   * `timeStamp`는 `performance.now()`와 같은 시계다. 문항형은 쓰지 않지만,
   * 코드학습(리듬 게임)은 **도착 시각이 아니라 이 값으로 판정해야 한다** —
   * 이벤트 루프 지연이 그대로 점수가 되는 것을 막는다.
   */
  onNoteOn(note: number, velocity: number, timeStamp: number): void;
  onNoteOff?(note: number): void;
  onChange?(snapshot: MidiSnapshot): void;
}

/** 테스트가 가짜 MIDIAccess를 넣을 수 있도록 열어 둔다. */
export interface MidiEnv {
  requestAccess?: (options?: MIDIOptions) => Promise<MIDIAccess>;
  secureContext?: boolean;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

export interface NoteMessage {
  type: "on" | "off";
  note: number;
  velocity: number;
}

/** MIDI 바이트 세 개를 해석한다. 노트 메시지가 아니면 null. */
export function parseNoteMessage(data: Uint8Array | null): NoteMessage | null {
  if (!data || data.length < 3) return null;
  const status = data[0] & 0xf0; // 채널은 무시한다
  const note = data[1];
  const velocity = data[2];
  if (status === NOTE_ON) {
    // 벨로시티 0인 note-on을 note-off로 쓰는 키보드가 많다
    return velocity > 0
      ? { type: "on", note, velocity }
      : { type: "off", note, velocity: 0 };
  }
  if (status === NOTE_OFF) return { type: "off", note, velocity: 0 };
  return null;
}

function describe(
  status: MidiStatus,
  listening: readonly string[],
  ignored: readonly string[],
): string {
  switch (status) {
    case "unsupported":
      return "이 브라우저에는 Web MIDI가 없습니다. Chrome·Edge에서 건반을 쓸 수 있고, 지금은 자판으로 연습할 수 있습니다.";
    case "insecure":
      return "MIDI는 https 또는 localhost에서만 열립니다.";
    case "requesting":
      return "MIDI 장치를 찾는 중…";
    case "denied":
      return "MIDI 접근이 거부되었습니다. 주소창의 자물쇠 아이콘에서 허용한 뒤 다시 찾으세요.";
    case "no-device":
      return ignored.length
        ? `건반 포트를 찾지 못했습니다. 무시한 포트: ${ignored.join(", ")}`
        : "MIDI 장치를 찾지 못했습니다. 건반을 연결하고 다시 찾으세요.";
    case "ready": {
      const head = listening.join(", ");
      return ignored.length ? `${head} (무시: ${ignored.join(", ")})` : head;
    }
    case "error":
      return "MIDI를 여는 중 문제가 생겼습니다.";
  }
}

/**
 * 쓸 만한 입력 포트 전부를 동시에 듣는다.
 *
 * Python판은 순위 1등 포트 **하나만** 열었다. 여기서 여러 개를 듣는 이유는
 * 브라우저에서는 포트 열기 비용이 없고, 건반을 여러 대 붙였을 때 고르는 UI가
 * 따로 필요 없어지기 때문이다. 오답을 유발하는 포트는 `PORT_AVOID`가 거른다.
 */
export class WebMidiInput {
  private readonly handlers: MidiHandlers;
  private readonly env: MidiEnv;
  private access: MIDIAccess | null = null;
  private bound = new Map<MIDIInput, (event: Event) => void>();
  private snapshot: MidiSnapshot = IDLE_SNAPSHOT;
  /** start()가 비동기라, 그 사이에 stop()이 불렸는지 판별한다 */
  private generation = 0;

  constructor(handlers: MidiHandlers, env: MidiEnv = {}) {
    this.handlers = handlers;
    this.env = env;
  }

  get current(): MidiSnapshot {
    return this.snapshot;
  }

  private emit(status: MidiStatus, listening: string[], ignored: string[]): void {
    this.snapshot = {
      status,
      listening,
      ignored,
      message: describe(status, listening, ignored),
    };
    this.handlers.onChange?.(this.snapshot);
  }

  private requestAccess(): ((options?: MIDIOptions) => Promise<MIDIAccess>) | null {
    if (this.env.requestAccess) return this.env.requestAccess;
    if (typeof navigator === "undefined") return null;
    const fn = navigator.requestMIDIAccess;
    return typeof fn === "function" ? fn.bind(navigator) : null;
  }

  private secure(): boolean {
    if (this.env.secureContext !== undefined) return this.env.secureContext;
    return typeof window === "undefined" || window.isSecureContext !== false;
  }

  async start(): Promise<void> {
    const request = this.requestAccess();
    if (!request) {
      this.emit("unsupported", [], []);
      return;
    }
    if (!this.secure()) {
      this.emit("insecure", [], []);
      return;
    }

    const generation = ++this.generation;
    this.emit("requesting", [], []);
    let access: MIDIAccess;
    try {
      // sysex는 쓰지 않는다. 요청하면 권한 승인 문턱만 높아진다.
      access = await request({ sysex: false });
    } catch (err) {
      if (generation !== this.generation) return;
      const denied =
        err instanceof DOMException &&
        (err.name === "SecurityError" || err.name === "NotAllowedError");
      this.emit(denied ? "denied" : "error", [], []);
      return;
    }
    // 기다리는 동안 stop()이 불렸으면 아무것도 붙이지 않는다 (StrictMode)
    if (generation !== this.generation) return;

    this.access = access;
    access.onstatechange = () => this.bind();
    this.bind();
  }

  /** 포트를 다시 훑는다. 건반을 나중에 연결한 경우. */
  refresh(): void {
    if (!this.access) {
      void this.start();
      return;
    }
    this.bind();
  }

  private bind(): void {
    if (!this.access) return;
    this.unbindPorts();

    const listening: string[] = [];
    const ignored: string[] = [];
    // 순위대로 정렬해도 전부 듣지만, 화면에 건반 포트가 먼저 보이게 한다
    const inputs = [...this.access.inputs.values()].sort(
      (a, b) => rankPort(a.name ?? "") - rankPort(b.name ?? ""),
    );

    for (const input of inputs) {
      const name = input.name ?? "이름 없는 포트";
      if (!usablePort(name)) {
        ignored.push(name);
        continue;
      }
      const listener = (event: Event) => this.onMessage(event as MIDIMessageEvent);
      input.addEventListener("midimessage", listener);
      this.bound.set(input, listener);
      listening.push(name);
    }

    this.emit(listening.length ? "ready" : "no-device", listening, ignored);
  }

  private onMessage(event: MIDIMessageEvent): void {
    const parsed = parseNoteMessage(event.data);
    if (!parsed) return;
    if (parsed.type === "on") {
      this.handlers.onNoteOn(parsed.note, parsed.velocity, event.timeStamp);
    } else {
      this.handlers.onNoteOff?.(parsed.note);
    }
  }

  private unbindPorts(): void {
    for (const [input, listener] of this.bound) {
      input.removeEventListener("midimessage", listener);
    }
    this.bound.clear();
  }

  stop(): void {
    this.generation += 1;
    this.unbindPorts();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
  }
}
