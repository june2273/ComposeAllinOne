/**
 * 사인파 신스 — **Web Audio를 부르는 구현.**
 *
 * `core/audio.ts`가 `AudioBackend` 인터페이스를 정하고 여기가 그것을 브라우저로
 * 실현한다. 오래 `core/`에 함께 있었는데(그래서 그 파일 주석에 "아직 정리 못 한
 * 빚"으로 적혀 있었다), `AudioContext`를 아는 코드가 `core/`에 있으면 그 층의
 * 규칙("브라우저를 모른다")이 거짓이 된다. Tauri로 갈 때 갈아끼울 것도 이쪽이다.
 *
 * 순수 사인파는 음정 지각이 오히려 어려워서 배음을 몇 개 섞는다. 피치가 수식으로
 * 정확해서, 절대음고를 센트 단위로 다뤄야 하는 기능에는 실제 녹음 샘플보다
 * 이쪽이 낫다.
 */

import {
  ARPEGGIO_GAP_SEC,
  type AudioBackend,
  midiToFreq,
} from "../core/audio";
import type { PlayMode } from "../core/config";

/**
 * 배음 비율.
 *
 * **3배음(12도 = 5도)만 유독 낮다.** 나머지 배음은 전부 옥타브 관계(1·2·4배)라
 * 기본음과 같은 음이름이지만, 3배음은 **다른 음이름**을 만든다. 여기가
 * 0.22였을 때 G4가 `G-G-D-G`로 울려 파워코드처럼 들렸다(실측: 오실레이터
 * 주파수 392·784·1176·1568Hz). 음높이를 맞히는 앱에서 한 음이 화음으로 들리면
 * 그 자체로 오답 요인이다.
 */
export const HARMONICS = [1.0, 0.4, 0.09, 0.06];
const ATTACK = 0.012;
const DECAY = 0.09;
const SUSTAIN_LEVEL = 0.72;
const RELEASE = 0.3;

/**
 * h번째 배음이 사는 시간 = duration / (h+1).
 *
 * 레벨이 끝까지 일정하면 귀가 배음을 **별개의 음으로 분리해서** 듣는다.
 * 실제 악기에서 배음이 하나의 음으로 뭉쳐 들리는 이유는 위 배음일수록 빨리
 * 사라지기 때문이다. 그 감쇠 차이를 여기서 만든다.
 */
function partialLife(harmonic: number, duration: number): number {
  return duration / (harmonic + 1);
}

/** 사인파 가산합성 + ADSR. */
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

      // 배음마다 자기 포락선을 갖는다. 하나의 포락선을 공유하면 모든 배음이
      // 끝까지 같은 레벨로 울려 서로 다른 음처럼 분리되어 들린다.
      HARMONICS.forEach((amp, h) => {
        const partial = freq * (h + 1);
        // 나이퀴스트를 넘는 배음은 앨리어싱만 만든다
        if (partial >= ctx.sampleRate / 2) return;

        const peak = level * (amp / harmonicSum);
        const life = partialLife(h, duration);
        // 자동화 이벤트의 시각이 뒤집히지 않도록 순서를 강제한다
        const decayed = start + ATTACK + DECAY;
        const hold = Math.max(start + life - RELEASE, decayed);
        const end = Math.max(start + life, hold + ATTACK);

        const env = ctx.createGain();
        env.connect(ctx.destination);
        const g = env.gain;
        g.setValueAtTime(0, start);
        g.linearRampToValueAtTime(peak, start + ATTACK);
        g.linearRampToValueAtTime(peak * SUSTAIN_LEVEL, decayed);
        g.setValueAtTime(peak * SUSTAIN_LEVEL, hold);
        g.linearRampToValueAtTime(0, end);

        const osc = ctx.createOscillator();
        osc.frequency.value = partial;
        osc.connect(env);
        osc.start(start);
        osc.stop(end + 0.02);
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
