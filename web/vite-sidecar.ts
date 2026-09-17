/**
 * 분석 사이드카를 **개발 서버가 함께 띄운다.**
 *
 * 스템 분리·멜로디 f0는 학습된 모델이라 브라우저 안에서 끝나지 않고
 * (`server/`), 브라우저는 프로세스를 띄울 수 없다. 그래서 띄울 수 있는 것은
 * 개발 서버뿐이다 — vite가 자기 자식으로 켜고 자기가 죽을 때 함께 죽인다.
 * 예전에는 화면이 `uvicorn …` 명령을 보여 주고 사용자가 터미널을 하나 더 열어
 * 그것을 쳤다.
 *
 * **없어도 앱은 뜬다는 방침은 그대로다.** venv가 없으면 안내 한 줄만 찍고
 * 넘어간다 — 첫 설치는 torch 때문에 수 GB·수 분이라, 진행률 없이 자동으로
 * 시작하면 사용자에게는 멈춘 것과 구별되지 않는다.
 *
 * **빌드된 앱에는 이 파일이 없다**(`apply: "serve"`). 사용자가 사이드카를 직접
 * 띄우지 않아도 되게 하려면 Tauri가 그 자리이고, 그때 웹에서 갈아끼울 곳은
 * `src/platform/sidecar.ts` 하나로 그대로다.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * 사이드카 포트. **세 곳이 같아야 한다** — `server/app/main.py`의 `DEFAULT_PORT`,
 * `src/platform/sidecar.ts`의 `SIDECAR_URL`, 그리고 여기.
 *
 * 저쪽에서 import해 오지 않는 이유는 `tsconfig.node.json`이 DOM 없이
 * (`lib: ["ES2023"]`) 이 파일을 검사하기 때문이다 — 브라우저 타입을 끌고
 * 들어오면 그 검사가 깨진다.
 */
const PORT = 8420;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;

/** 이미 떠 있는가를 묻는 시간. 로컬이라 이보다 늦으면 없는 것으로 친다 */
const PROBE_TIMEOUT_MS = 800;

const SERVER_DIR = fileURLToPath(new URL("../server", import.meta.url));
const UVICORN = `${SERVER_DIR}/.venv/bin/uvicorn`;

function log(line: string): void {
  console.log(`[사이드카] ${line}`);
}

/**
 * 자식의 출력을 줄 단위로 우리 접두와 함께 흘린다. 안 붙이면 uvicorn의 로그가
 * vite의 것과 섞여 어느 쪽이 무슨 말을 하는지 읽을 수 없다.
 */
function pipe(stream: NodeJS.ReadableStream | null): void {
  if (!stream) return;
  let rest = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) log(line.trimEnd());
  });
}

/** 벌써 응답하는가. 사용자가 손으로 띄웠거나 다른 vite가 물고 있을 수 있다. */
async function alreadyUp(): Promise<boolean> {
  try {
    const response = await fetch(HEALTH_URL, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function sidecar(): Plugin {
  let child: ChildProcess | null = null;

  /**
   * **한 번만 죽인다.** `child`를 먼저 비우므로 두 번 불려도 안전하고, 아래
   * `exit` 핸들러가 "우리가 끈 것"과 "혼자 죽은 것"을 이것으로 가른다.
   */
  const stop = (): void => {
    const current = child;
    child = null;
    current?.kill("SIGTERM");
  };

  const launch = async (): Promise<void> => {
    if (await alreadyUp()) {
      log(`이미 ${PORT}번에 떠 있다 — 새로 띄우지 않는다`);
      return;
    }
    if (!existsSync(UVICORN)) {
      log(".venv가 없어 띄우지 못한다. 앱은 그대로 뜨고 AI 칸만 잠긴다");
      log("  cd server && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt");
      return;
    }

    // **`SIDECAR_STRUCTURE`를 켜지 않는다.** 구조 분석이 기본으로 꺼져 있는 것은
    // 고장이 아니라 느려서 내린 판단이다(CLAUDE.md) — 여기서 뒤집지 않는다.
    const proc = spawn(UVICORN, ["app.main:app", "--port", String(PORT)], {
      cwd: SERVER_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = proc;
    log("띄우는 중 — 모델을 불러오느라 십수 초 걸린다 (끄려면 SIDECAR_AUTOSTART=0)");

    pipe(proc.stdout);
    pipe(proc.stderr);
    proc.on("error", (failure) => {
      if (child === proc) child = null;
      log(`띄우지 못했다: ${failure.message}`);
    });
    proc.on("exit", (code, signal) => {
      // 우리가 끈 것이면 `child`는 이미 비어 있다. 혼자 죽었을 때만 알린다
      if (child !== proc) return;
      child = null;
      log(`멈췄다 (code=${code} signal=${signal}). 앱은 그대로 돌고 AI 칸만 잠긴다`);
    });
  };

  return {
    name: "musictest:sidecar",
    apply: "serve",

    configureServer(server) {
      if (process.env.SIDECAR_AUTOSTART === "0") return;

      // **기다리지 않는다.** 감지에 800ms, 기동에 십수 초가 걸리는데 그동안
      // vite가 안 뜨면 자동 실행이 오히려 개발을 느리게 만든다
      void launch();

      // 고아가 남으면 다음 실행의 `alreadyUp()`에 걸려 **조용히 옛 서버를 쓰게
      // 된다** — 코드를 고쳐도 결과가 안 바뀌는, 알아채기 가장 어려운 모양이다.
      // 터미널의 Ctrl+C는 프로세스 그룹 전체에 가므로 uvicorn이 직접 받지만,
      // 그 경로가 없을 때(프로그램으로 띄운 vite)를 위해 둘을 더 건다.
      server.httpServer?.on("close", stop);
      process.once("exit", stop);
    },

    // vite가 `server.close()`에서 플러그인도 닫는다. 위의 `close`와 겹치지만
    // `stop()`이 두 번 불려도 안전하다
    closeBundle() {
      stop();
    },
  };
}
