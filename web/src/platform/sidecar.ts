/**
 * 분석 사이드카 — **HTTP를 아는 유일한 곳.**
 *
 * 스템 분리와 멜로디 f0는 학습된 모델이라 브라우저 안에서 끝나지 않는다
 * (수 분 걸리고 수백 MB다). 로컬 Python 서버(`server/`)에 맡기고 여기서
 * 결과만 받아 온다. 음악적 판단은 한 줄도 없다 — 받은 f0 커브를 음표로 만드는
 * 것은 `core/transcribe`다.
 *
 * **없어도 앱은 돈다.** `detect()`가 실패하면 화면이 그 카드만 잠그고 실행
 * 방법을 한 줄 보여준다 — 피아노 음원이 없으면 사인 신스로 나는 것과 같은
 * 방침이다. 감지 타임아웃을 짧게 둔 것도 그래서다(서버가 없을 때 화면이
 * 굳으면 안 된다).
 *
 * Tauri로 가면 이 파일이 갈리는 자리다 — 사이드카를 앱이 직접 띄우게 되면
 * 포트 대신 IPC가 되지만, 위층이 보는 `analyzeWithSidecar`의 모양은 같다.
 */

import type { PitchCurve } from "../core/transcribe";

/** 서버의 기본 포트. `server/app/main.py`의 DEFAULT_PORT와 같아야 한다 */
export const SIDECAR_URL = "http://127.0.0.1:8420";

/** 감지 타임아웃. 로컬이라 이보다 늦으면 없는 것으로 친다 */
const DETECT_TIMEOUT_MS = 1200;
/** 진행 상황을 물어보는 간격. 분리가 수 분이라 자주 물을 이유가 없다 */
const POLL_MS = 700;

/**
 * 모델 하나의 진단 결과(`server/app/health.py`).
 *
 * **`unavailable`과 `broken`을 가르는 것이 요점이다** — 앞은 안 깔린 것이고
 * 뒤는 깔렸는데 안 도는 것이다. 화면이 낼 문장이 다르다.
 */
export interface SidecarCheck {
  readonly status: "checking" | "ok" | "unavailable" | "broken";
  /** `broken`일 때 무엇이 터졌는지 한 줄 */
  readonly detail: string | null;
}

export interface SidecarHealth {
  readonly version: string;
  /** "mps" · "cuda" · "cpu" */
  readonly device: string;
  /** 지금 쓸 수 있는가 */
  readonly models: { readonly stems: boolean; readonly melody: boolean };
  /**
   * 왜 못 쓰는가. **없을 수도 있다** — 자가진단이 들어오기 전 버전의 서버가
   * 그 포트에 떠 있을 수 있으므로 옵셔널로 둔다.
   */
  readonly checks?: {
    readonly stems?: SidecarCheck;
    readonly melody?: SidecarCheck;
  };
}

export interface SidecarProgress {
  readonly stage: string;
  readonly ratio: number;
}

export interface SidecarResult {
  readonly jobId: string;
  readonly curve: PitchCurve;
  /** 받아 갈 수 있는 오디오 이름. `audioUrl()`에 넣는다 */
  readonly stems: readonly string[];
  readonly hasStems: boolean;
  readonly hasMelody: boolean;
  readonly durationSec: number;
}

export interface SidecarEnv {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** 폴링 간격. 테스트가 0으로 줄인다 */
  readonly pollMs?: number;
}

function base(env: SidecarEnv): string {
  return env.baseUrl ?? SIDECAR_URL;
}

function client(env: SidecarEnv): typeof fetch {
  return env.fetch ?? globalThis.fetch.bind(globalThis);
}

/**
 * 서버가 떠 있는가. **던지지 않는다** — 없는 것이 정상 상태 중 하나다.
 */
export async function detect(env: SidecarEnv = {}): Promise<SidecarHealth | null> {
  const timeout = AbortSignal.timeout(DETECT_TIMEOUT_MS);
  try {
    const response = await client(env)(`${base(env)}/health`, { signal: timeout });
    if (!response.ok) return null;
    const body = (await response.json()) as SidecarHealth & { ok?: boolean };
    return body.models ? body : null;
  } catch {
    return null;
  }
}

/** 스템·처리된 보컬을 듣거나 내려받을 주소. */
export function audioUrl(
  jobId: string,
  name: string,
  env: SidecarEnv = {},
): string {
  return `${base(env)}/jobs/${jobId}/audio/${encodeURIComponent(name)}`;
}

/**
 * 파일 하나를 올리고 끝날 때까지 기다린다.
 *
 * **접수와 대기가 갈려 있다.** 분리가 4분 곡에서 수 분 걸리는데 브라우저·
 * 프록시의 유휴 타임아웃은 보통 60~120초라, 한 요청으로 붙들고 있으면 끊긴다.
 * 그래서 POST로 접수만 하고 진행 상황을 물어본다.
 */
export async function analyzeWithSidecar(
  file: Blob,
  onProgress?: (progress: SidecarProgress) => void,
  env: SidecarEnv = {},
  signal?: AbortSignal,
): Promise<SidecarResult> {
  const get = client(env);
  const url = base(env);
  const pollMs = env.pollMs ?? POLL_MS;

  onProgress?.({ stage: "올리는 중", ratio: 0 });
  const form = new FormData();
  // 서버가 확장자로 디코더를 고른다(MP3는 ffmpeg를 탄다). 이름을 잃으면 안 된다
  const name = file instanceof File && file.name ? file.name : "audio.wav";
  form.append("file", file, name);
  const created = await get(`${url}/jobs`, { method: "POST", body: form, signal });
  if (!created.ok) throw new Error(await detail(created, "업로드에 실패했습니다"));
  const { jobId } = (await created.json()) as { jobId: string };

  try {
    for (;;) {
      signal?.throwIfAborted();
      const response = await get(`${url}/jobs/${jobId}`, { signal });
      if (!response.ok) throw new Error(await detail(response, "작업이 사라졌습니다"));
      const status = (await response.json()) as {
        stage: string;
        ratio: number;
        done: boolean;
        error: string | null;
      };
      onProgress?.({ stage: status.stage, ratio: status.ratio });
      if (status.error) throw new Error(status.error);
      if (status.done) break;
      await sleep(pollMs, signal);
    }
  } catch (failure) {
    // 화면을 떠났으면 서버 쪽도 멈춘다. 안 그러면 GPU가 몇 분 더 돈다.
    void get(`${url}/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
    throw failure;
  }

  const [curve, meta] = await Promise.all([
    json<PitchCurve>(get, `${url}/jobs/${jobId}/f0`, signal),
    json<{
      durationSec: number;
      hasStems: boolean;
      hasMelody: boolean;
      stems: string[];
    }>(get, `${url}/jobs/${jobId}/meta`, signal),
  ]);

  return {
    jobId,
    curve,
    stems: meta.stems,
    hasStems: meta.hasStems,
    hasMelody: meta.hasMelody,
    durationSec: meta.durationSec,
  };
}

async function json<T>(
  get: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await get(url, { signal });
  if (!response.ok) throw new Error(await detail(response, "결과를 받지 못했습니다"));
  return (await response.json()) as T;
}

/** FastAPI는 오류를 `{detail}`로 준다. 그게 화면에 그대로 나가는 문장이다 */
async function detail(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail ?? fallback;
  } catch {
    return `${fallback} (HTTP ${response.status})`;
  }
}

/**
 * 폴링 간격만큼 쉰다.
 *
 * **깨어날 때 구독을 놓는다.** `{ once: true }`는 이벤트가 실제로 났을 때만
 * 떼어 주는데, 여기서는 대개 나지 않는다 — 수 분짜리 분리를 700ms마다 물으면
 * 같은 신호에 리스너가 수백 개 쌓이고 각자 클로저를 붙들고 있다.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
