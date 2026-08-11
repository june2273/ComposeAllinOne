/**
 * 오디오 백엔드 — **인터페이스와 순수 도우미만.**
 *
 * 기술검토서 7절의 교체 가능 인터페이스를 그대로 따른다. `AudioContext`를
 * 부르는 구현은 여기 없다 — 사인 신스는 `platform/synth.ts`, 샘플 피아노는
 * `platform/piano.ts`다. 이 파일이 브라우저를 모르는 덕에 세션 규칙 테스트가
 * 오디오 장치 없이 돈다.
 *
 * Python/Qt판은 "전체 파형을 numpy로 미리 렌더한 뒤 던지는" 방식이었다.
 * GIL 때문에 오디오 콜백 안에서 연산하면 글리치가 나기 때문이었는데,
 * Web Audio는 스케줄링이 오디오 스레드에서 이뤄지므로 그 제약이 없다.
 *
 * EQ·라우드니스·팬 청음이 필요로 하는 것들(BiquadFilterNode, GainNode,
 * StereoPannerNode)은 브라우저가 기본 제공한다 — Python판에서 "Protocol을
 * 바꿔야 한다"고 적어 둔 항목이 여기서는 노드 하나 끼우는 일이 된다. 다만
 * `playNotes`로는 "이 소리에 처리를 걸어라"를 표현할 수 없어 **인터페이스
 * 자체를 바꿔야 하고**, 그때 세 스테이지를 한꺼번에 설계해야 한다.
 */

import type { PlayMode } from "./config";

/** 아르페지오 한 음 사이 간격. melody 모드는 음 길이만큼 벌린다. */
export const ARPEGGIO_GAP_SEC = 0.18;

export function midiToFreq(midiNote: number): number {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

export interface AudioBackend {
  playNotes(
    midiNotes: readonly number[],
    duration: number,
    mode?: PlayMode,
    velocity?: number,
  ): void;
  stop(): void;
}

/** 소리를 내지 않는 백엔드. 테스트에서 오디오 장치를 피할 때 쓴다. */
export class NullSynth implements AudioBackend {
  // 인자를 받는 형태로 둔다. 생략하면 인터페이스는 만족하지만 `NullSynth`
  // 타입 그대로 들고 부르는 곳(테스트)에서 "인자 0개" 오류가 난다.
  playNotes(..._args: Parameters<AudioBackend["playNotes"]>): void {}
  stop(): void {}
}
