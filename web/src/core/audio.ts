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
 *
 * 그 뒤로 축이 둘 늘었다 — `noteOn`(뗄 때까지 울린다, 자유 연주)과
 * `playSequence`(시각이 박힌 음표들, 전사 악보 재생). **셋 다 서로 다른 축이고
 * 위 문단의 음색·처리 축을 막지 않는다.**
 */

import type { PlayMode } from "./config";

/** 아르페지오 한 음 사이 간격. melody 모드는 음 길이만큼 벌린다. */
export const ARPEGGIO_GAP_SEC = 0.18;

/** 벨로시티를 주지 않았을 때. `transcribe`가 내는 음표도 이 값이다 */
export const DEFAULT_VELOCITY = 80;

export function midiToFreq(midiNote: number): number {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

/**
 * 울리고 있는 음 하나에 대한 손잡이. `release()`가 건반을 떼는 것에 해당한다.
 *
 * 두 번 불러도 안전해야 한다 — 자판·마우스·MIDI가 같은 음을 동시에 잡을 수 있고,
 * 화면을 떠날 때 정리 코드가 한 번 더 부른다.
 */
export interface NoteHandle {
  release(): void;
}

/**
 * 시각이 박힌 음표 하나.
 *
 * `playNotes`의 인자와 달리 **길이가 음표마다 다르고**, `noteOn`과 달리 **끝나는
 * 시각을 미리 안다.** 시각은 시퀀스가 시작하는 순간을 0으로 삼은 상대 초다 —
 * 절대 시각(`AudioContext.currentTime`)을 여기 넣으면 core가 오디오 시계를 알게 된다.
 */
export interface SequenceNote {
  readonly midi: number;
  readonly startSec: number;
  readonly endSec: number;
  readonly velocity?: number;
}

/**
 * 재생 중인 시퀀스 하나를 가리키는 손잡이.
 *
 * **시계는 platform이 갖는다.** core는 `AudioContext`를 모르므로 "지금 몇 초인가"를
 * 스스로 답할 수 없다. 그래서 인터페이스만 여기서 정하고 구현은 백엔드가 만든다.
 * 화면은 `positionSec()`을 rAF로 읽어 커서를 그린다 — **표시용이지 판정용이 아니다.**
 */
export interface Sequence {
  /** 시퀀스 0초로부터 흐른 초. 멈췄으면 null */
  positionSec(): number | null;
  stop(): void;
}

/** 아무것도 울리지 않는 손잡이. 소리를 못 내는 백엔드가 돌려준다 */
export const SILENT_SEQUENCE: Sequence = {
  positionSec: () => null,
  stop() {},
};

export interface AudioBackend {
  playNotes(
    midiNotes: readonly number[],
    duration: number,
    mode?: PlayMode,
    velocity?: number,
  ): void;
  /**
   * 누른다 — **뗄 때까지 울린다.**
   *
   * `playNotes`와 갈라 둔 이유는 둘의 규칙이 정면으로 다르기 때문이다.
   * 문항형은 "문제 하나가 한 소리"라 새 재생이 앞의 것을 끊어야 하지만
   * (`playNotes`가 맨 앞에서 `stop()`을 부른다), 연주는 **앞의 음을 끊으면
   * 화음이 나지 않는다.** 같은 함수에 모드를 하나 더 다는 대신 메서드를
   * 나눴다 — 끊는가 마는가는 인자가 아니라 용도의 차이다.
   */
  noteOn(midiNote: number, velocity?: number): NoteHandle;
  /**
   * 음표들을 **한 번에 예약한다.** 음표마다 시각과 길이가 다르다.
   *
   * `noteOn`을 타이머로 늘어놓지 않는 이유: 그쪽은 메인 스레드가 시각을 정하므로
   * 렌더 한 번만 늦어도 음이 밀린다. 여기서는 오디오 스레드가 시각을 갖는다.
   *
   * `fromSec`부터 시작한다 — 그 전에 이미 끝나는 음표는 울리지 않는다.
   * `playNotes`와 마찬가지로 **먼저 울리던 것을 끊는다**(한 시퀀스가 한 소리다).
   */
  playSequence(notes: readonly SequenceNote[], fromSec?: number): Sequence;
  stop(): void;
}

/** 아무 일도 하지 않는 손잡이. */
export const SILENT_NOTE: NoteHandle = { release() {} };

/** 소리를 내지 않는 백엔드. 테스트에서 오디오 장치를 피할 때 쓴다. */
export class NullSynth implements AudioBackend {
  // 인자를 받는 형태로 둔다. 생략하면 인터페이스는 만족하지만 `NullSynth`
  // 타입 그대로 들고 부르는 곳(테스트)에서 "인자 0개" 오류가 난다.
  playNotes(..._args: Parameters<AudioBackend["playNotes"]>): void {}
  noteOn(..._args: Parameters<AudioBackend["noteOn"]>): NoteHandle {
    return SILENT_NOTE;
  }
  playSequence(..._args: Parameters<AudioBackend["playSequence"]>): Sequence {
    return SILENT_SEQUENCE;
  }
  stop(): void {}
}
