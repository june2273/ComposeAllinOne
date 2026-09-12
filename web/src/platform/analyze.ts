/**
 * 오디오 파일 → 분석 결과. **브라우저가 어떻게 하는가**만 있는 층이다.
 *
 * 두 가지를 한다.
 *
 * 1. **디코딩** — `decodeAudioData`. WAV·MP3·M4A 등 브라우저가 아는 것은 전부
 *    읽는다. 22.05kHz 모노로 낮춰서 넘긴다(그 위는 분석에 쓰이지 않는다).
 * 2. **워커로 보내기** — DSP는 메인 스레드 밖에서 돈다.
 *
 * 음악적 판단은 한 줄도 없다. Tauri로 가면 이 파일만 갈아끼우고 `core/analysis`
 * 는 그대로 쓴다 — 또는 그때는 Rust 쪽 네이티브 구현으로 통째로 바꾼다.
 *
 * **MP3 주의**: 디코더마다 앞에 20~40ms 무음이 붙는다. 비트 추적 허용 오차가
 * 보통 70ms이므로 절대 시각을 다른 도구와 맞출 일이 있으면 WAV로 변환해서
 * 넣을 것. BPM·박자·조성만 볼 때는 영향이 없다(전부 상대적인 양이다).
 */

import {
  ANALYSIS_RATE,
  analyzeAudio,
  extractOnsetCurve,
  type AnalysisProgress,
  type AnalysisReport,
  type BeatGrid,
} from "../core/analysis";
import { detectDrums, type DetectOptions, type DrumDetection } from "../core/drums";
import type { OnsetCurve } from "../core/transcribe";

export type { AnalysisProgress, AnalysisReport };

/** 테스트가 디코더·워커를 갈아끼우는 자리. */
export interface AnalyzeEnv {
  /** 기본은 `OfflineAudioContext` */
  decode?: (bytes: ArrayBuffer) => Promise<{ samples: Float32Array; sampleRate: number }>;
  /** 기본은 워커. 없으면 같은 스레드에서 돈다 */
  makeWorker?: () => Worker | null;
}

/**
 * 표본화율 변환. 구간 평균이라 다운샘플에서 에일리어싱이 크게 줄어든다.
 *
 * 브라우저 리샘플러(`OfflineAudioContext`)를 먼저 쓰고, 그쪽이 원하는 값을
 * 거부할 때만 이 함수가 나선다.
 */
export function resample(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const from = Math.floor(i * ratio);
    const to = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += samples[j];
    out[i] = to > from ? sum / (to - from) : 0;
  }
  return out;
}

/** 채널을 평균해 모노로. 스테레오 위상차는 이 분석에 쓰이지 않는다. */
export function downmix(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i += 1) out[i] += data[i] / channels;
  }
  return out;
}

async function decodeWithBrowser(
  bytes: ArrayBuffer,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  if (typeof OfflineAudioContext === "undefined") {
    throw new Error("이 브라우저는 오디오 디코딩을 지원하지 않습니다");
  }
  // 22.05kHz 컨텍스트로 디코딩하면 브라우저가 리샘플까지 해 준다.
  // Safari 등이 낮은 표본화율을 거부하면 기본값으로 받아 직접 낮춘다.
  let ctx: OfflineAudioContext;
  try {
    ctx = new OfflineAudioContext(1, 1, ANALYSIS_RATE);
  } catch {
    ctx = new OfflineAudioContext(1, 1, 44_100);
  }
  const buffer = await ctx.decodeAudioData(bytes);
  const mono = downmix(buffer);
  return {
    samples: resample(mono, buffer.sampleRate, ANALYSIS_RATE),
    sampleRate: ANALYSIS_RATE,
  };
}

function defaultWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./analysis.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    // 번들러가 워커를 못 만들면 같은 스레드에서 돈다. 화면이 잠깐 멈출 뿐이다.
    return null;
  }
}

function runInWorker(
  worker: Worker,
  samples: Float32Array,
  sampleRate: number,
  grid: BeatGrid,
  onProgress?: (progress: AnalysisProgress) => void,
  signal?: AbortSignal,
  ratio?: number,
): Promise<AnalysisReport> {
  return new Promise((resolve, reject) => {
    if (signal) {
      // 화면을 떠난 뒤에도 워커가 계속 도는 것을 막는다. 지금은 몇 초짜리
      // DSP뿐이지만, 스템 분리(수 분)가 붙으면 이 경로가 필수가 된다.
      const abort = () => {
        worker.terminate();
        reject(new DOMException("분석을 취소했습니다", "AbortError"));
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | ({ type: "progress" } & AnalysisProgress)
        | { type: "done"; report: AnalysisReport }
        | { type: "error"; message: string };
      if (data.type === "progress") {
        onProgress?.({ stage: data.stage, ratio: data.ratio });
      } else if (data.type === "done") {
        worker.terminate();
        resolve(data.report);
      } else {
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "분석 워커가 죽었습니다"));
    };
    // 샘플 버퍼는 소유권째 넘긴다 — 4분 곡이면 20MB다
    worker.postMessage({ samples, sampleRate, grid, ratio }, [samples.buffer]);
  });
}

/**
 * 파일 하나를 분석한다.
 *
 * 디코딩은 메인 스레드(네이티브라 빠르다), DSP는 워커. 진행률은 둘을 이어
 * 0~1 하나로 보고한다.
 */
export async function analyzeFile(
  file: Blob,
  /**
   * 사이드카에서 받은 비트 격자. **워커가 직접 못 받아 온다** — 거기엔
   * 네트워크가 없다(층 규칙이기도 하다: 워커는 순수 DSP다).
   */
  grid: BeatGrid,
  onProgress?: (progress: AnalysisProgress) => void,
  env: AnalyzeEnv = {},
  /** 화면을 떠나면 끊는다. 워커를 종료시킨다 */
  signal?: AbortSignal,
  /** 사용자가 배수 후보를 직접 골랐을 때만 준다 — `AnalysisOptions.ratio` */
  ratio?: number,
): Promise<AnalysisReport> {
  onProgress?.({ stage: "파일 읽는 중", ratio: 0 });
  const bytes = await file.arrayBuffer();

  onProgress?.({ stage: "디코딩", ratio: 0.05 });
  const decode = env.decode ?? decodeWithBrowser;
  const { samples, sampleRate } = await decode(bytes);
  if (samples.length < sampleRate) {
    throw new Error("소리가 너무 짧습니다 — 1초 이상 필요합니다");
  }

  // 디코딩이 전체의 앞 15%를 차지한다고 보고 나머지를 DSP에 준다
  const forward = (progress: AnalysisProgress) =>
    onProgress?.({ stage: progress.stage, ratio: 0.15 + progress.ratio * 0.85 });

  const worker = (env.makeWorker ?? defaultWorker)();
  // 워커가 없으면 같은 스레드에서 도는데, 그때는 중간에 끊을 자리가 없다
  if (!worker) return analyzeAudio(samples, grid, sampleRate, forward, { ratio });
  return runInWorker(worker, samples, sampleRate, grid, forward, signal, ratio);
}

/**
 * 디코딩 → 워커에 한 가지 일을 맡기고 결과 하나를 받는다.
 *
 * `extractOnset`과 `extractDrums`가 **같은 결선**이다. 셋째가 생기기 전에
 * 모았다 — 워커 취소·종료·오류 처리를 손으로 두 벌 들고 다니면 한쪽만 고치는
 * 날이 온다.
 *
 * 진행률은 보고하지 않는다. 둘 다 STFT 한 번이라 4분 곡에 1~2초이고, 그 앞의
 * 스템 분리가 이미 몇 분 걸린 뒤다.
 */
async function askWorker<T>(
  audio: Blob,
  payload: Record<string, unknown>,
  accept: (data: Record<string, unknown>) => T | undefined,
  local: (samples: Float32Array, sampleRate: number) => T,
  env: AnalyzeEnv,
  signal?: AbortSignal,
): Promise<T> {
  const bytes = await audio.arrayBuffer();
  const decode = env.decode ?? decodeWithBrowser;
  const { samples, sampleRate } = await decode(bytes);

  const worker = (env.makeWorker ?? defaultWorker)();
  if (!worker) return local(samples, sampleRate);
  return new Promise((resolve, reject) => {
    if (signal) {
      const abort = () => {
        worker.terminate();
        reject(new DOMException("분석을 취소했습니다", "AbortError"));
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown>;
      worker.terminate();
      const value = accept(data);
      if (value !== undefined) resolve(value);
      else reject(new Error(typeof data.message === "string" ? data.message : "분석 워커 오류"));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "분석 워커가 죽었습니다"));
    };
    worker.postMessage({ ...payload, samples, sampleRate }, [samples.buffer]);
  });
}

/**
 * 오디오 하나에서 온셋 곡선만 뽑는다. **보컬 스템을 넣는다.**
 *
 * 전사의 노트 분할이 쓰는 것이다 — f0는 같은 음을 두 번 부른 것을 표현할 수
 * 없어서 경계의 증거를 밖에서 받아야 한다(`core/transcribe/notes.ts`).
 */
export async function extractOnset(
  audio: Blob,
  env: AnalyzeEnv = {},
  signal?: AbortSignal,
): Promise<OnsetCurve> {
  return askWorker(
    audio,
    { job: "onset" },
    (data) => (data.type === "onset" ? (data.curve as OnsetCurve) : undefined),
    extractOnsetCurve,
    env,
    signal,
  );
}

/**
 * 오디오 하나에서 드럼 타점을 뽑는다. **드럼 스템을 넣는다.**
 *
 * 사이드카가 만든 `stems/drums.wav`를 받아 브라우저에서 돈다 — `extractOnset`이
 * `vocal_processed.wav`에 대해 하는 것과 **정확히 같은 결선**이다. 드럼 검출은
 * 학습된 모델이 아니라 SuperFlux + 대역 규칙이므로 이 저장소의 층 기준
 * ("학습된 모델인가")에 따라 브라우저 쪽이다.
 */
export async function extractDrums(
  audio: Blob,
  options: DetectOptions = {},
  env: AnalyzeEnv = {},
  signal?: AbortSignal,
): Promise<DrumDetection> {
  return askWorker(
    audio,
    { job: "drums", drumOptions: options },
    (data) => (data.type === "drums" ? (data.drums as DrumDetection) : undefined),
    (samples, sampleRate) => detectDrums(samples, sampleRate, options),
    env,
    signal,
  );
}
