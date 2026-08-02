/**
 * 오디오 백엔드.
 *
 * 기술검토서 7절의 교체 가능 인터페이스를 그대로 따른다.
 *
 * Python/Qt판은 "전체 파형을 numpy로 미리 렌더한 뒤 던지는" 방식이었다.
 * GIL 때문에 오디오 콜백 안에서 연산하면 글리치가 나기 때문이었는데,
 * Web Audio는 스케줄링이 오디오 스레드에서 이뤄지므로 그 제약이 없다.
 * 대신 노드를 만들어 시각을 지정해 걸어 두면 된다.
 *
 * EQ·라우드니스·팬 청음이 필요로 하는 것들(BiquadFilterNode, GainNode,
 * StereoPannerNode)은 브라우저가 기본 제공한다 — Python판에서 "Protocol을
 * 바꿔야 한다"고 적어 둔 항목이 여기서는 노드 하나 끼우는 일이 된다.
 *
 * 샘플 기반 피아노(Upright Piano KW, CC0)는 아직 옮기지 않았다. 31MiB라
 * 웹에서는 로딩 전략(지연 로드·포맷 변환)을 먼저 정해야 한다.
 */

import type { PlayMode } from "./config";

export const HARMONICS = [1.0, 0.45, 0.22, 0.1];
const ATTACK = 0.012;
const DECAY = 0.09;
const SUSTAIN_LEVEL = 0.72;
const RELEASE = 0.3;
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

/**
 * 사인파 가산합성 + ADSR.
 *
 * 순수 사인파는 음정 지각이 오히려 어려워서 배음을 3~4개 섞는다.
 * 피치가 수식으로 정확해서, 절대음고를 센트 단위로 다뤄야 하는 기능에는
 * 실제 녹음 샘플보다 이쪽이 낫다.
 */
export class SineSynth implements AudioBackend {
  private ctx: AudioContext | null = null;
  private active: AudioScheduledSourceNode[] = [];

  /**
   * 브라우저는 사용자 제스처 전에는 오디오를 시작하지 못하게 한다.
   * 첫 재생 시점에 만들고 resume한다.
   */
  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private staggerSec(mode: PlayMode, duration: number): number {
    if (mode === "block") return 0;
    return mode === "arpeggio_up" ? ARPEGGIO_GAP_SEC : duration;
  }

  playNotes(
    midiNotes: readonly number[],
    duration: number,
    mode: PlayMode = "block",
    velocity = 80,
  ): void {
    if (!midiNotes.length) return;
    this.stop();

    const ctx = this.context();
    const stagger = this.staggerSec(mode, duration);
    // 화음일 때 클리핑 방지 — 동시에 울리는 음 수로 나눈다
    const simultaneous = stagger === 0 ? midiNotes.length : 1;
    const level = (velocity / 127) * 0.85 / Math.max(simultaneous, 1);
    const harmonicSum = HARMONICS.reduce((a, b) => a + b, 0);

    midiNotes.forEach((note, i) => {
      const start = ctx.currentTime + i * stagger;
      const freq = midiToFreq(note);

      const env = ctx.createGain();
      env.connect(ctx.destination);
      const g = env.gain;
      g.setValueAtTime(0, start);
      g.linearRampToValueAtTime(level, start + ATTACK);
      g.linearRampToValueAtTime(level * SUSTAIN_LEVEL, start + ATTACK + DECAY);
      g.setValueAtTime(level * SUSTAIN_LEVEL, start + Math.max(duration - RELEASE, 0));
      g.linearRampToValueAtTime(0, start + duration);

      HARMONICS.forEach((amp, h) => {
        const partial = freq * (h + 1);
        // 나이퀴스트를 넘는 배음은 앨리어싱만 만든다
        if (partial >= ctx.sampleRate / 2) return;
        const osc = ctx.createOscillator();
        osc.frequency.value = partial;
        const mix = ctx.createGain();
        mix.gain.value = amp / harmonicSum;
        osc.connect(mix).connect(env);
        osc.start(start);
        osc.stop(start + duration + 0.02);
        this.active.push(osc);
        osc.onended = () => {
          this.active = this.active.filter((n) => n !== osc);
        };
      });
    });
  }

  stop(): void {
    for (const node of this.active) {
      try {
        node.stop();
      } catch {
        // 이미 끝난 노드는 무시한다
      }
    }
    this.active = [];
  }
}

/** 소리를 내지 않는 백엔드. 테스트에서 오디오 장치를 피할 때 쓴다. */
export class NullSynth implements AudioBackend {
  playNotes(): void {}
  stop(): void {}
}

export function makeDefaultBackend(): AudioBackend {
  return typeof AudioContext === "undefined" ? new NullSynth() : new SineSynth();
}
