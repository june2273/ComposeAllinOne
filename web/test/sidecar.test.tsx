/**
 * 사이드카 결선 검증 — **서버 없이 돈다.**
 *
 * 진짜 서버를 띄우면 테스트가 모델 설치 여부에 딸려 가고 수 분이 걸린다.
 * 여기서 보는 것은 규약뿐이다 — 접수/폴링/취소의 순서, 없을 때의 폴백,
 * 그리고 화면이 그 둘을 어떻게 가르는가.
 *
 * 진짜 신호가 도는지는 `server/test_sidecar.py`가 본다.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AnalysisReport } from "../src/core/analysis";
import {
  analyzeWithSidecar,
  audioUrl,
  detect,
  type SidecarResult,
} from "../src/platform/sidecar";
import { NullSynth } from "../src/core/audio";
import { TranscriptionPanel } from "../src/ui/transcription";

vi.mock("../src/core/score", () => ({
  ScoreRenderer: { load: () => Promise.reject(new Error("jsdom")) },
}));

const BASE = "http://sidecar.test";

/** 응답 하나. `Response`를 흉내 내되 이 코드가 쓰는 것만 갖춘다 */
function reply(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

interface Route {
  (url: string, init?: RequestInit): Response | Promise<Response>;
}

/** 주소별 응답표. 호출 기록을 함께 남긴다 */
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; method: string }[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const key = Object.keys(routes).find((k) => url.endsWith(k) || url.includes(k));
    if (!key) return Promise.reject(new Error(`경로 없음: ${url}`));
    return Promise.resolve(routes[key](url, init));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

const CURVE = { hopMs: 10, f0: Array.from({ length: 100 }, () => 440), confidence: [] };
const META = {
  durationSec: 1,
  hasStems: true,
  hasMelody: true,
  stems: ["vocals", "drums"],
};
const HEALTH = {
  ok: true,
  version: "0.1.0",
  device: "mps",
  models: { stems: true, melody: true },
};

describe("1. 감지 — 없어도 되는 것", () => {
  test("떠 있으면 상태를 돌려준다", async () => {
    const { fetch } = fakeFetch({ "/health": () => reply(HEALTH) });
    const found = await detect({ baseUrl: BASE, fetch });
    expect(found?.device).toBe("mps");
    expect(found?.models.stems).toBe(true);
  });

  test("연결이 안 되면 null이다 — 던지지 않는다", async () => {
    const refused: typeof fetch = () => Promise.reject(new Error("ECONNREFUSED"));
    await expect(detect({ baseUrl: BASE, fetch: refused })).resolves.toBeNull();
  });

  test("엉뚱한 것이 그 포트에 떠 있어도 null이다", async () => {
    const { fetch } = fakeFetch({ "/health": () => reply({ hello: "world" }) });
    await expect(detect({ baseUrl: BASE, fetch })).resolves.toBeNull();
  });

  test("500이면 null이다", async () => {
    const { fetch } = fakeFetch({ "/health": () => reply({}, false, 500) });
    await expect(detect({ baseUrl: BASE, fetch })).resolves.toBeNull();
  });
});

describe("2. 분석 — 접수하고 물어본다", () => {
  function server(
    steps: { stage: string; ratio: number; done: boolean; error?: string }[],
    structure: Route = () => reply({ detail: "없다" }, false, 404),
  ) {
    let at = 0;
    // **순서가 중요하다** — 이 표는 첫 일치를 쓰는데 `/jobs/j1`이 나머지를 전부
    // 삼킨다. 긴 주소를 먼저 둔다
    return fakeFetch({
      "/jobs/j1/structure": structure,
      "/jobs/j1/f0": () => reply(CURVE),
      "/jobs/j1/meta": () => reply(META),
      "/jobs/j1": () => reply({ error: null, ...steps[Math.min(at++, steps.length - 1)] }),
      "/jobs": () => reply({ jobId: "j1", cached: false }),
    });
  }

  const DONE = [{ stage: "완료", ratio: 1, done: true }];

  test("구조가 없으면 null이다 — 그것 때문에 전사까지 버리지 않는다", async () => {
    const { fetch } = server(DONE);
    const result = await analyzeWithSidecar(
      new File([new Uint8Array([1])], "a.wav"),
      undefined,
      { baseUrl: BASE, fetch, pollMs: 0 },
    );
    expect(result.structure).toBeNull();
    expect(result.curve.f0).toHaveLength(100);
  });

  test("구조가 있으면 그대로 실려 온다", async () => {
    const { fetch } = server(DONE, () =>
      reply({
        engine: "allin1-harmonix-all",
        bpm: 146,
        beats: [0.5, 1.0],
        downbeats: [0.5],
        beatPositions: [1, 2],
        segments: [{ start: 0, end: 14.77, label: "intro" }],
      }),
    );
    const result = await analyzeWithSidecar(
      new File([new Uint8Array([1])], "a.wav"),
      undefined,
      { baseUrl: BASE, fetch, pollMs: 0 },
    );
    expect(result.structure?.bpm).toBe(146);
    expect(result.structure?.segments[0].label).toBe("intro");
  });

  test("끝날 때까지 폴링하고 커브와 메타를 모은다", async () => {
    const { fetch, calls } = server([
      { stage: "스템 분리", ratio: 0.3, done: false },
      { stage: "멜로디 추출", ratio: 0.9, done: false },
      { stage: "완료", ratio: 1, done: true },
    ]);
    const seen: string[] = [];
    const result = await analyzeWithSidecar(
      new File([new Uint8Array([1])], "a.wav"),
      (p) => seen.push(p.stage),
      { baseUrl: BASE, fetch, pollMs: 0 },
    );
    expect(result.jobId).toBe("j1");
    expect(result.curve.f0).toHaveLength(100);
    expect(result.stems).toEqual(["vocals", "drums"]);
    expect(seen).toContain("스템 분리");
    expect(calls[0].method).toBe("POST");
  });

  test("서버가 오류를 말하면 그 문장이 그대로 올라온다", async () => {
    const { fetch } = server([{ stage: "실패", ratio: 0, done: true, error: "모델이 없다" }]);
    await expect(
      analyzeWithSidecar(new File([new Uint8Array([1])], "a.wav"), undefined, {
        baseUrl: BASE,
        fetch,
        pollMs: 0,
      }),
    ).rejects.toThrow("모델이 없다");
  });

  test("취소하면 서버 쪽 작업도 지운다 — 안 그러면 GPU가 몇 분 더 돈다", async () => {
    const { fetch, calls } = server([{ stage: "스템 분리", ratio: 0.1, done: false }]);
    const controller = new AbortController();
    const promise = analyzeWithSidecar(
      new File([new Uint8Array([1])], "a.wav"),
      () => controller.abort(),
      { baseUrl: BASE, fetch, pollMs: 0 },
      controller.signal,
    );
    await expect(promise).rejects.toBeTruthy();
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/jobs/j1"))).toBe(
        true,
      ),
    );
  });

  test("업로드가 거절되면 서버의 문장을 보인다", async () => {
    const { fetch } = fakeFetch({ "/jobs": () => reply({ detail: "빈 파일입니다" }, false, 400) });
    await expect(
      analyzeWithSidecar(new File([], "a.wav"), undefined, {
        baseUrl: BASE,
        fetch,
        pollMs: 0,
      }),
    ).rejects.toThrow("빈 파일입니다");
  });

  test("오디오 주소는 작업과 이름으로 정해진다", () => {
    expect(audioUrl("j1", "vocals", { baseUrl: BASE })).toBe(
      `${BASE}/jobs/j1/audio/vocals`,
    );
  });
});

// --- 화면 -------------------------------------------------------------------

const REPORT: AnalysisReport = {
  durationSec: 8,
  tempo: { bpm: 120, confidence: 0.9, candidates: [], steadiness: 1 },
  meter: {
    value: "4/4",
    beatsPerBar: 4,
    phase: 0,
    subdivision: "simple",
    shuffle: false,
    confidence: 0.8,
    candidates: [],
    downbeats: [0, 2, 4, 6],
      },
  key: {
    name: "C 장조",
    tonic: 0,
    mode: "major",
    score: 0.9,
    confidence: 0.8,
    candidates: [],
    chroma: [],
  },
  tuningCents: 0,
  beats: Array.from({ length: 16 }, (_, i) => i * 0.5),
  downbeats: [0, 2, 4, 6],
  chords: [
    {
      startBeat: 0,
      endBeat: 4,
      startSec: 0,
      endSec: 2,
      root: 0,
      quality: "maj",
      symbol: "C",
      kind: "major",
      suffix: "",
      confidence: 0.8,
      candidates: [],
    },
  ],
  chordConfidence: 0.8,
};

function panel(env: Partial<Parameters<typeof TranscriptionPanel>[0]>) {
  return render(
    <TranscriptionPanel
      report={REPORT}
      file={new File([new Uint8Array([1])], "song.wav")}
      audio={new NullSynth()}
      {...env}
    />,
  );
}

describe("3. 화면 — 있을 때와 없을 때", () => {
  beforeEach(() => {
    // jsdom에는 blob 주소가 없다. 내려받기 목록이 이걸 부른다
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  test("사이드카가 없으면 실행 방법을 보여준다 — 화면이 죽지 않는다", async () => {
    // 예산 0 = 기다리지 않는다. 빌드된 앱이 이 값이다(띄워 줄 개발 서버가 없다)
    panel({ probe: () => Promise.resolve(null), startup: { budgetMs: 0 } });
    expect(await screen.findByText(/사이드카가 꺼져 있다/)).toBeTruthy();
    expect(screen.getByText(/uvicorn app.main:app/)).toBeTruthy();
  });

  test("기동 중이면 기다린다 — 켜는 중을 보이다가 저절로 준비된다", async () => {
    // 개발 서버가 사이드카를 띄우는 동안 첫 두 번은 응답이 없다.
    // **`probe`를 넣지 않는다** — 첫 물음과 그 뒤 되풀이가 같은 길로 가는지가
    // 여기서 봐야 할 것이고, 둘 다 `env.fetch`를 탄다
    let tries = 0;
    const { fetch } = fakeFetch({
      "/health": () => (++tries < 3 ? reply({}, false, 503) : reply(HEALTH)),
    });
    panel({
      env: { baseUrl: BASE, fetch },
      startup: { budgetMs: 3000, retryMs: 200 },
    });

    expect(await screen.findByText(/사이드카를 켜는 중/)).toBeTruthy();
    // 기다리는 동안 명령어를 보여 주지 않는다 — 사용자가 할 일이 없다
    expect(screen.queryByText(/uvicorn app.main:app/)).toBeNull();

    expect(await screen.findByText(/스템 분리 · 멜로디 전사 시작/)).toBeTruthy();
    expect(tries).toBe(3);
  });

  test("있으면 시작 버튼과 장치가 나온다", async () => {
    panel({ probe: () => Promise.resolve(HEALTH) });
    expect(await screen.findByText(/스템 분리 · 멜로디 전사 시작/)).toBeTruthy();
    expect(screen.getByText(/mps/)).toBeTruthy();
  });

  test("모델이 빠져 있으면 무엇을 깔아야 하는지 알려준다", async () => {
    panel({
      probe: () =>
        Promise.resolve({
          ...HEALTH,
          models: { stems: false, melody: false },
          checks: {
            stems: { status: "unavailable", detail: "설치되지 않았다" },
            melody: { status: "unavailable", detail: "설치되지 않았다" },
          },
        }),
    });
    expect(await screen.findByText(/pip install demucs/)).toBeTruthy();
    expect(screen.getByText(/pip install rmvpe-onnx/)).toBeTruthy();
  });

  test("깔렸는데 안 돌면 무엇이 터졌는지 보여준다 — pip install을 권하지 않는다", async () => {
    // 이미 깔린 것을 또 깔라고 하면 사용자가 진짜 원인에서 멀어진다.
    // 실제로 걸렸던 사고: setuptools 81이 pkg_resources를 없앴다.
    panel({
      probe: () =>
        Promise.resolve({
          ...HEALTH,
          models: { stems: true, melody: false },
          checks: {
            stems: { status: "ok", detail: null },
            melody: {
              status: "broken",
              detail: "ModuleNotFoundError: No module named 'pkg_resources'",
            },
          },
        }),
    });
    expect(await screen.findByText(/pkg_resources/)).toBeTruthy();
    expect(screen.queryByText(/pip install rmvpe-onnx/)).toBeNull();
  });

  test("진단 중에는 아무 말도 하지 않는다 — 곧 바뀔 문장을 띄우지 않는다", async () => {
    panel({
      probe: () =>
        Promise.resolve({
          ...HEALTH,
          models: { stems: true, melody: true },
          checks: {
            stems: { status: "checking", detail: null },
            melody: { status: "checking", detail: null },
          },
        }),
    });
    expect(await screen.findByText(/전사 시작/)).toBeTruthy();
    expect(screen.queryByText(/pip install/)).toBeNull();
  });

  test("전사가 끝나면 음표 수·스템·내려받기가 나온다", async () => {
    panel({
      probe: () => Promise.resolve(HEALTH),
      run: () =>
        Promise.resolve({
          jobId: "j1",
          // 0.5초씩 세 음. 120BPM 4/4이므로 정박에 떨어진다
          curve: {
            hopMs: 10,
            f0: [
              ...Array.from({ length: 50 }, () => 261.63),
              ...Array.from({ length: 50 }, () => 293.66),
              ...Array.from({ length: 50 }, () => 329.63),
            ],
          },
          stems: ["vocals", "drums"],
          hasStems: true,
          hasMelody: true,
          structure: null,
          durationSec: 1.5,
        }),
    });
    const button = await screen.findByRole("button", { name: /전사 시작/ });
    act(() => button.click());
    expect(await screen.findByText(/음표 3개/)).toBeTruthy();
    expect(screen.getByText("보컬")).toBeTruthy();
    // **후처리 보컬은 줄로 나오지 않는다.** 파이프라인 내부 신호라 목록에서
    // 뺐다 — 서버가 만드는 것도 온셋이 쓰는 것도 그대로다(아래 온셋 시험)
    expect(screen.queryByText(/처리본/)).toBeNull();
    // 내려받기 주소는 이펙트에서 만들어진다(회수 시점을 알아야 해서다) —
    // 음표 수보다 한 렌더 늦게 나타나므로 여기서도 기다린다
    expect(await screen.findByText(/MusicXML \(악보\)/)).toBeTruthy();
    expect(screen.getByText(/MIDI \(격자\)/)).toBeTruthy();
    // 가창 합성기용은 가사가 붙은 별도 파일이다
    expect(screen.getByText(/가사 la/)).toBeTruthy();
    // 악보를 못 그려도(jsdom에 verovio가 없다) 화면은 선다
    expect(screen.getByText(/검수 전제의 초안/)).toBeTruthy();
  });

  /**
   * 화면만 비우면 앞 파일의 전사가 뒤늦게 도착해 **새 파일의 결과인 척 앉는다** —
   * 시작할 때 만든 컨트롤러가 취소되지 않아 `aborted` 검사를 그대로 통과한다.
   */
  test("파일이 바뀌면 돌던 전사를 끊는다", async () => {
    let seen: AbortSignal | undefined;
    let release: ((result: SidecarResult) => void) | undefined;
    const run: typeof analyzeWithSidecar = (_file, _onProgress, _env, signal) =>
      new Promise<SidecarResult>((resolve) => {
        seen = signal;
        release = resolve;
      });
    const props = { probe: () => Promise.resolve(HEALTH), run, audio: new NullSynth() };
    const { rerender } = render(
      <TranscriptionPanel
        report={REPORT}
        file={new File([new Uint8Array([1])], "먼저.wav")}
        {...props}
      />,
    );
    const button = await screen.findByRole("button", { name: /전사 시작/ });
    act(() => button.click());
    expect(seen?.aborted).toBe(false);

    rerender(
      <TranscriptionPanel
        report={REPORT}
        file={new File([new Uint8Array([2])], "나중.wav")}
        {...props}
      />,
    );
    expect(seen?.aborted).toBe(true);

    // 늦게 도착해도 결과가 앉지 않는다
    await act(async () => {
      release?.({
        jobId: "j1",
        curve: { hopMs: 10, f0: Array.from({ length: 50 }, () => 261.63) },
        stems: [],
        hasStems: false,
        hasMelody: true,
        structure: null,
        durationSec: 0.5,
      });
      await Promise.resolve();
    });
    expect(screen.queryByText(/음표 /)).toBeNull();
    expect(screen.getByRole("button", { name: /전사 시작/ })).toBeTruthy();
  });

  test("실패하면 문장과 다시 시도가 나온다", async () => {
    panel({
      probe: () => Promise.resolve(HEALTH),
      run: () => Promise.reject(new Error("모델이 죽었다")),
    });
    const button = await screen.findByRole("button", { name: /전사 시작/ });
    act(() => button.click());
    expect(await screen.findByText(/모델이 죽었다/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });
});

// --- 온셋 ---------------------------------------------------------------------

/** 1.5초 내내 C4. f0만 보면 한 음이다 */
const HELD: SidecarResult = {
  jobId: "j1",
  curve: { hopMs: 10, f0: Array.from({ length: 150 }, () => 261.63) },
  stems: ["vocals"],
  hasStems: true,
  hasMelody: true,
  structure: null,
  durationSec: 1.5,
};

/** 0.75초 자리에 봉우리 하나 */
function onsetAtHalf() {
  const strength = new Float32Array(130);
  strength[65] = 5;
  return { hopMs: 11.6, strength };
}

describe("4. 온셋 — 같은 음 재발음", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    // 후처리 보컬을 내려받는 자리. 내용은 안 본다 — 온셋은 주입한다
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob()) } as unknown as Response),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  test("온셋이 오면 같은 음도 갈린다", async () => {
    panel({
      probe: () => Promise.resolve(HEALTH),
      run: () => Promise.resolve(HELD),
      onset: () => Promise.resolve(onsetAtHalf()),
    });
    const button = await screen.findByRole("button", { name: /전사 시작/ });
    act(() => button.click());
    expect(await screen.findByText(/음표 2개/)).toBeTruthy();
  });

  /**
   * 온셋은 **있으면 좋은 것**이지 전제가 아니다. 스템을 못 받아 오거나 디코딩이
   * 실패해도 전사는 그대로 나와야 한다 — 피아노 음원이 없으면 사인 신스로 나는
   * 것과 같은 방침이다.
   */
  test("온셋을 못 받아도 전사는 나온다", async () => {
    panel({
      probe: () => Promise.resolve(HEALTH),
      run: () => Promise.resolve(HELD),
      onset: () => Promise.reject(new Error("디코딩 실패")),
    });
    const button = await screen.findByRole("button", { name: /전사 시작/ });
    act(() => button.click());
    expect(await screen.findByText(/음표 1개/)).toBeTruthy();
  });

  test("후처리 보컬을 받지 못하면 조용히 넘어간다", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false } as unknown as Response));
    panel({
      probe: () => Promise.resolve(HEALTH),
      run: () => Promise.resolve(HELD),
      onset: () => Promise.reject(new Error("불려서는 안 된다")),
    });
    const button = await screen.findByRole("button", { name: /전사 시작/ });
    act(() => button.click());
    expect(await screen.findByText(/음표 1개/)).toBeTruthy();
  });
});
