/**
 * 분석 워커 — DSP를 메인 스레드 밖에서 돌린다.
 *
 * 곡 하나에 FFT가 2만 번 넘게 돈다. 메인 스레드에서 돌리면 그동안 화면이
 * 통째로 멈추고 진행률조차 그려지지 않는다. **무거운 처리는 UI 스레드에서
 * 돌리지 말 것**이라는 규칙이 실제로 적용되는 첫 자리다.
 *
 * 디코딩은 여기서 하지 않는다 — `decodeAudioData`는 Web Audio라 워커에서
 * 쓸 수 있는 브라우저가 제한적이고, 어차피 네이티브 코드라 메인 스레드를
 * 오래 잡지 않는다. 워커가 받는 것은 이미 디코딩된 모노 샘플이다.
 */

import {
  analyzeAudio,
  extractOnsetCurve,
  type AnalysisProgress,
  type BeatGrid,
} from "../core/analysis";
import { detectDrums, type DetectOptions } from "../core/drums";

interface Request {
  /** 없으면 `analyze` — 옛 메시지 모양과 호환된다 */
  job?: "analyze" | "onset" | "drums";
  samples: Float32Array;
  sampleRate: number;
  /**
   * 비트 격자. **`job: "analyze"`에서는 필수다** — 워커에는 네트워크가 없어서
   * 사이드카를 직접 못 부른다. 메인 스레드가 받아 함께 넣는다.
   */
  grid?: BeatGrid;
  /** 사용자가 배수 후보를 직접 골랐을 때만 온다(2 또는 0.5) */
  ratio?: number;
  /** `job: "drums"`에서만. 하니스가 문턱을 훑을 때 쓴다 */
  drumOptions?: DetectOptions;
}

const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

scope.onmessage = (event: MessageEvent) => {
  const { job, samples, sampleRate, grid, ratio, drumOptions } = event.data as Request;
  try {
    if (job === "onset") {
      // 보컬 스템의 온셋. 전사의 노트 분할이 쓴다 — 진행률은 없다(수백 ms다)
      scope.postMessage({ type: "onset", curve: extractOnsetCurve(samples, sampleRate) });
      return;
    }
    if (job === "drums") {
      // 드럼 스템의 타점. **`bandFlux`·`bandEnergy`는 여기서 죽는다** — 4분 곡에
      // 12MB가 넘어서 구조화 복제로 넘기면 그 자체가 비용이 된다. 밖으로 나가는
      // 것은 타점 목록과 위생 지표뿐이다.
      scope.postMessage({ type: "drums", drums: detectDrums(samples, sampleRate, drumOptions) });
      return;
    }
    if (!grid) throw new Error("비트 격자가 없습니다 — 사이드카가 꺼져 있습니다");
    const report = analyzeAudio(
      samples,
      grid,
      sampleRate,
      (progress: AnalysisProgress) =>
        scope.postMessage({ type: "progress", ...progress }),
      { ratio },
    );
    scope.postMessage({ type: "done", report });
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
