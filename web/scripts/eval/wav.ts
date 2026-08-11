/**
 * 최소 WAV 리더 — 평가 하니스 전용.
 *
 * 브라우저는 `decodeAudioData`가, 사이드카는 `soundfile`이 한다. 노드에서
 * 순수 로직만 돌려 보려는 이 자리에만 디코더가 없어서 짧게 하나 둔다.
 *
 * **앱에 들어가는 코드가 아니다.** 캐시에 실제로 들어 있는 것(PCM 16bit)만
 * 확실히 읽으면 되고, 나머지 서식은 만나면 그때 늘린다 — 조용히 잘못 읽느니
 * 던지는 편이 낫다.
 */

import { readFileSync } from "node:fs";

import { ANALYSIS_RATE } from "../../src/core/analysis";
import { resample } from "../../src/platform/analyze";

/** 앞 4바이트가 무슨 청크인지 */
function tag(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}

export interface Wav {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly channels: number;
}

/**
 * WAV 바이트 → 인터리브된 float 샘플.
 *
 * **청크를 훑어서 찾는다.** `fmt `와 `data`가 헤더 바로 뒤에 붙어 있다고 보면
 * 안 된다 — 인코더가 `LIST`(메타데이터)를 사이에 끼워 넣으면 고정 오프셋은
 * 엉뚱한 곳을 가리키고, 그러면 오디오가 잡음으로 읽힌다.
 */
export function decodeWav(bytes: ArrayBuffer): Wav {
  const view = new DataView(bytes);
  if (tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") {
    throw new Error("WAV가 아니다");
  }

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataAt = -1;
  let dataSize = 0;

  let at = 12;
  while (at + 8 <= view.byteLength) {
    const name = tag(view, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (name === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (name === "data") {
      dataAt = body;
      dataSize = Math.min(size, view.byteLength - body);
    }
    // 청크는 짝수 바이트로 정렬된다. 홀수 크기면 패딩 1바이트가 뒤에 붙는다
    at = body + size + (size % 2);
  }
  if (dataAt < 0 || !channels || !sampleRate) throw new Error("fmt/data 청크가 없다");

  // 1 = PCM 정수, 3 = IEEE float. 압축된 것(ADPCM 등)은 여기서 못 읽는다
  const isFloat = format === 3;
  if (!isFloat && format !== 1) throw new Error(`지원하지 않는 WAV 서식 ${format}`);

  const bytesPer = bits / 8;
  const count = Math.floor(dataSize / bytesPer);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const offset = dataAt + i * bytesPer;
    if (isFloat) {
      out[i] = bits === 64 ? view.getFloat64(offset, true) : view.getFloat32(offset, true);
    } else if (bits === 16) {
      out[i] = view.getInt16(offset, true) / 32768;
    } else if (bits === 24) {
      // 리틀엔디언 3바이트를 부호 있는 값으로. 최상위 바이트의 부호를 살린다
      const value =
        view.getUint8(offset) |
        (view.getUint8(offset + 1) << 8) |
        (view.getInt8(offset + 2) << 16);
      out[i] = value / 8388608;
    } else if (bits === 32) {
      out[i] = view.getInt32(offset, true) / 2147483648;
    } else if (bits === 8) {
      // 8bit WAV만 부호 없는 오프셋 이진수다
      out[i] = (view.getUint8(offset) - 128) / 128;
    } else {
      throw new Error(`지원하지 않는 비트 깊이 ${bits}`);
    }
  }
  return { samples: out, sampleRate, channels };
}

/**
 * 인터리브 다채널 → 모노. 채널 평균은 브라우저 `downmix`와 같은 규칙이다.
 */
export function toMono(samples: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return samples;
  const out = new Float32Array(Math.floor(samples.length / channels));
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += samples[i * channels + c];
    out[i] = sum / channels;
  }
  return out;
}

/**
 * WAV 파일 하나를 `ANALYSIS_RATE` 모노로. **하니스가 오디오를 읽는 유일한 길이다.**
 *
 * 읽기·다운믹스·리샘플이 세 조각으로 흩어져 있으면 스크립트마다 조금씩 다르게
 * 조합하게 되고, 그러면 같은 곡을 재도 스크립트에 따라 숫자가 달라진다.
 */
export function loadMono(path: string, rate: number = ANALYSIS_RATE): Float32Array {
  const bytes = readFileSync(path);
  const wav = decodeWav(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return resample(toMono(wav.samples, wav.channels), wav.sampleRate, rate);
}
