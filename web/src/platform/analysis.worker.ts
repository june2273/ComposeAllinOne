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

import { analyzeAudio } from "../core/analysis";

interface Request {
  samples: Float32Array;
  sampleRate: number;
}

const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

scope.onmessage = (event: MessageEvent) => {
  const { samples, sampleRate } = event.data as Request;
  try {
    const report = analyzeAudio(samples, sampleRate, (progress) =>
      scope.postMessage({ type: "progress", ...progress }),
    );
    scope.postMessage({ type: "done", report });
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
