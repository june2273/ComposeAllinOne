/**
 * 루프·필인 — **손으로 쓴 타점만 넣는다.**
 *
 * `structure.test.ts`가 손으로 쓴 구간 배열만 넣고, `chords.test.tsx`가 손으로
 * 쓴 `ChordEvent`만 넣는 것과 같은 방침이다. 검출 정확도가 섞이면 "패턴을 잘못
 * 묶었다"와 "타점을 잘못 들었다"를 구별할 수 없다 — RMVPE 교체 때 `자리 일치`가
 * 46→88%로 뛴 것이 리듬 표기가 좋아져서가 아니었던 그 얽힘이다.
 *
 * 여기서 보는 것은 **순수 판단**뿐이다: 마디로 접기 · 주기 찾기 · 대표형과
 * 변형 · 필인 · 3층 좌표.
 */

import { describe, expect, it } from "vitest";

import {
  analyzePattern,
  loopToMidi,
  representative,
  toDrumMidi,
  type DrumClass,
  type DrumHit,
} from "../src/core/drums";
import { buildGrid } from "../src/core/transcribe/quantize";

const BPM = 120;
const BEAT = 60 / BPM; // 0.5초
const BEATS_PER_BAR = 4;
const STEPS_PER_BEAT = 4;
const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT; // 16
const STEP = BEAT / STEPS_PER_BEAT; // 16분 = 0.125초

/** 못갖춘마디 없이 `bars`마디짜리 격자. 첫 다운비트가 0초다 */
function grid(bars: number) {
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let b = 0; b < bars * BEATS_PER_BAR + 1; b += 1) {
    beats.push(b * BEAT);
    if (b % BEATS_PER_BAR === 0) downbeats.push(b * BEAT);
  }
  return buildGrid({ beats, downbeats, beatsPerBar: BEATS_PER_BAR, stepsPerBeat: STEPS_PER_BEAT });
}

/**
 * 칸 번호로 타점을 놓는다. `bar`는 1부터, `step`은 마디 안 0~15.
 *
 * 벨로시티·신뢰도·대역은 판단에 안 쓰이므로 상수로 둔다 — 시험이 무엇을 보는지
 * 흐려질 뿐이다. **`gm`은 상수로 두면 안 된다** — MIDI 쪽이 `(칸, gm)`으로
 * 중복을 줄이므로 전부 0이면 동시타가 하나로 합쳐진다(실제로 걸렸다).
 */
function hit(bar: number, step: number, cls: DrumClass, offsetSec = 0): DrumHit {
  return {
    atSec: ((bar - 1) * STEPS_PER_BAR + step) * STEP + offsetSec,
    cls,
    gm: representative(cls),
    velocity: 100,
    confidence: 1,
    bands: [],
  };
}

/** 한 마디에 킥 1·3박, 스네어 2·4박, 하이햇 8분 */
function basicBar(bar: number): DrumHit[] {
  const out: DrumHit[] = [hit(bar, 0, "kick"), hit(bar, 8, "kick")];
  out.push(hit(bar, 4, "snare"), hit(bar, 12, "snare"));
  for (let s = 0; s < STEPS_PER_BAR; s += 2) out.push(hit(bar, s, "hihat"));
  return out;
}

/** 짝수 마디용 변형 — 킥이 하나 더 있다 */
function variantBar(bar: number): DrumHit[] {
  return [...basicBar(bar), hit(bar, 14, "kick")];
}

/** 16분 톰 연타 + 크래시 — 전형적인 필인 */
function fillBar(bar: number): DrumHit[] {
  const out: DrumHit[] = [];
  for (let s = 0; s < STEPS_PER_BAR; s += 1) out.push(hit(bar, s, s % 4 === 0 ? "snare" : "tom"));
  out.push(hit(bar, 0, "cymbal"));
  return out;
}

function sorted(hits: DrumHit[]): DrumHit[] {
  return hits.toSorted((a, b) => a.atSec - b.atSec);
}

describe("마디로 접기", () => {
  it("첫 다운비트가 있는 마디가 1마디다", () => {
    const result = analyzePattern(sorted(basicBar(1)), grid(2));
    const bar1 = result.bars.find((b) => b.bar === 1);
    expect(bar1).toBeDefined();
    expect(bar1?.cells[0]).toContain("kick");
    expect(bar1?.cells[4]).toContain("snare");
    expect(bar1?.cells[1]).toEqual([]);
  });

  it("못갖춘마디는 0마디다 — 1로 매기면 뒤 번호가 통째로 밀린다", () => {
    // 첫 다운비트가 2박 뒤인 격자. 그 앞의 두 박이 못갖춘마디다.
    const beats: number[] = [];
    const downbeats: number[] = [];
    for (let b = 0; b < 12; b += 1) {
      beats.push(b * BEAT);
      if (b >= 2 && (b - 2) % BEATS_PER_BAR === 0) downbeats.push(b * BEAT);
    }
    const withPickup = buildGrid({
      beats,
      downbeats,
      beatsPerBar: BEATS_PER_BAR,
      stepsPerBeat: STEPS_PER_BEAT,
    });
    const pickup: DrumHit = { ...hit(1, 0, "snare"), atSec: BEAT };
    const first: DrumHit = { ...hit(1, 0, "kick"), atSec: 2 * BEAT };
    const result = analyzePattern(sorted([pickup, first]), withPickup);
    expect(result.bars[0].bar).toBe(0);
    expect(result.bars[0].hits).toBe(1);
    expect(result.bars.find((b) => b.bar === 1)?.hits).toBe(1);
  });

  it("같은 칸의 동시타를 한 칸에 함께 담는다", () => {
    const result = analyzePattern(sorted(basicBar(1)), grid(2));
    // 1박: 킥 + 하이햇
    expect(result.bars.find((b) => b.bar === 1)?.cells[0]).toEqual(
      expect.arrayContaining(["kick", "hihat"]),
    );
  });

  it("칸 내용이 같으면 심볼도 같다 — 순서에 흔들리지 않는다", () => {
    const forward = analyzePattern(sorted(basicBar(1)), grid(2)).bars[1].symbol;
    const backward = analyzePattern(sorted(basicBar(1)).toReversed(), grid(2)).bars[1].symbol;
    expect(forward).toBe(backward);
  });
});

describe("주기 찾기", () => {
  it("모든 마디가 같으면 1마디 루프다", () => {
    const hits = sorted([1, 2, 3, 4, 5, 6, 7, 8].flatMap((b) => basicBar(b)));
    const result = analyzePattern(hits, grid(8));
    expect(result.period.bars).toBe(1);
  });

  it("두 마디가 번갈아 나오면 2마디 루프다", () => {
    const hits = sorted(
      [1, 2, 3, 4, 5, 6, 7, 8].flatMap((b) => (b % 2 === 1 ? basicBar(b) : variantBar(b))),
    );
    const result = analyzePattern(hits, grid(8));
    expect(result.period.bars).toBe(2);
    // 마진이 0이면 1마디와 구별이 안 됐다는 뜻이다
    expect(result.period.margin).toBeGreaterThan(0);
  });

  /**
   * **경쟁자가 없는 것과 경쟁자와 붙은 것은 다른 사실이다.**
   *
   * 배수는 경쟁자가 아니므로(2마디 루프는 4·8마디로도 맞는다) 주기가 1이면
   * 비교 대상이 아예 없다. 그때 마진 0을 적으면 화면이 "확인 필요"를 붙여
   * **없는 의심을 만든다** — 실제로 완벽한 1마디 루프에 그게 붙었다.
   */
  it("주기가 1이면 마진이 null이다 — 0이 아니다", () => {
    const hits = sorted([1, 2, 3, 4, 5, 6, 7, 8].flatMap((b) => basicBar(b)));
    const result = analyzePattern(hits, grid(8));
    expect(result.period.bars).toBe(1);
    expect(result.period.margin).toBeNull();
    // 대신 얼마나 잘 설명하는지는 `fit`이 말한다
    expect(result.period.fit).toBeCloseTo(1, 6);
  });

  it("네 마디 주기도 찾는다", () => {
    const hits = sorted(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].flatMap((b) =>
        b % 4 === 0 ? variantBar(b) : basicBar(b),
      ),
    );
    expect(analyzePattern(hits, grid(12)).period.bars).toBe(4);
  });
});

describe("대표형과 변형 — 사양서 §10", () => {
  it("반복되는 그루브가 한 패턴군으로 묶인다", () => {
    const hits = sorted([1, 2, 3, 4, 5, 6, 7, 8].flatMap((b) => basicBar(b)));
    const result = analyzePattern(hits, grid(8));
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].id).toBe("A");
    expect(result.patterns[0].count).toBe(8);
  });

  it("아주 다른 마디는 다른 패턴군(B)이 된다", () => {
    const hits = sorted([
      ...basicBar(1),
      ...basicBar(2),
      ...basicBar(3),
      ...basicBar(4),
      // 5~8마디는 완전히 다른 그루브 — 하이햇만
      ...[5, 6, 7, 8].flatMap((b) => {
        const out: DrumHit[] = [];
        for (let s = 0; s < STEPS_PER_BAR; s += 1) out.push(hit(b, s, "hihat"));
        return out;
      }),
    ]);
    const result = analyzePattern(hits, grid(8));
    expect(result.patterns.length).toBeGreaterThanOrEqual(2);
    expect(result.patterns.map((p) => p.id)).toEqual(expect.arrayContaining(["A", "B"]));
  });
});

describe("필인", () => {
  /**
   * **필인을 따로 검출하지 않는다** — 대표형과의 거리에서 유도한다. 이 시험이
   * 깨지면 그 설계가 죽은 것이다.
   */
  it("여덟 마디 끝의 톰 연타를 필인으로 가른다", () => {
    const hits = sorted([1, 2, 3, 4, 5, 6, 7].flatMap((b) => basicBar(b)).concat(fillBar(8)));
    const result = analyzePattern(hits, grid(8));
    const fills = result.spans.filter((s) => s.fill);
    expect(fills).toHaveLength(1);
    expect(fills[0].fromBar).toBe(8);
    expect(fills[0].toBar).toBe(8);
  });

  it("필인은 이웃과 합쳐지지 않는다 — 목록에서 눈에 띄어야 한다", () => {
    const hits = sorted([1, 2, 3, 4, 5, 6, 7].flatMap((b) => basicBar(b)).concat(fillBar(8)));
    const spans = analyzePattern(hits, grid(8)).spans;
    const fill = spans.find((s) => s.fill);
    expect(fill?.fromBar).toBe(fill?.toBar);
  });

  /**
   * **필인은 일회성이고 섹션 변화는 지속된다.**
   *
   * 거리만 보면 둘이 같아 보인다 — 그루브가 통째로 바뀐 여덟 마디가 여덟 개의
   * 필인으로 잡힌다(실측: 그 상태에서 패턴 `B`가 통째로 사라졌다). 이어진
   * 길이가 그 둘을 가르는 축이다.
   */
  it("네 마디 내내 다르면 필인이 아니라 다른 구간이다", () => {
    const other = (bar: number): DrumHit[] => {
      const out: DrumHit[] = [];
      for (let s = 0; s < STEPS_PER_BAR; s += 1) out.push(hit(bar, s, "hihat"));
      return out;
    };
    const hits = sorted(
      [1, 2, 3, 4].flatMap((b) => basicBar(b)).concat([5, 6, 7, 8].flatMap((b) => other(b))),
    );
    const result = analyzePattern(hits, grid(8));
    expect(result.spans.some((s) => s.fill)).toBe(false);
    expect(result.patterns.length).toBeGreaterThanOrEqual(2);
  });

  it("똑같은 마디만 이어지면 필인이 없다", () => {
    const hits = sorted([1, 2, 3, 4, 5, 6, 7, 8].flatMap((b) => basicBar(b)));
    expect(analyzePattern(hits, grid(8)).spans.some((s) => s.fill)).toBe(false);
  });

  it("문턱이 낮을수록 필인이 는다 — 하니스가 훑을 수 있어야 한다", () => {
    // 8마디는 확실한 필인, 4마디는 킥 하나만 더한 약한 변형이다.
    const hits = sorted(
      [1, 2, 3, 5, 6, 7]
        .flatMap((b) => basicBar(b))
        .concat(variantBar(4))
        .concat(fillBar(8)),
    );
    const loose = analyzePattern(hits, grid(8), { fillDistance: 0.05 });
    const strict = analyzePattern(hits, grid(8), { fillDistance: 0.5 });
    const count = (r: ReturnType<typeof analyzePattern>) => r.spans.filter((s) => s.fill).length;
    expect(count(loose)).toBeGreaterThan(count(strict));
  });
});

describe("3층 좌표 — 사양서 §3", () => {
  it("구간을 주면 1차 좌표가 붙는다", () => {
    const hits = sorted([1, 2, 3, 4, 5, 6, 7, 8].flatMap((b) => basicBar(b)));
    const result = analyzePattern(hits, grid(8), {
      sections: [
        { label: "Verse 1", fromBar: 1, toBar: 4 },
        { label: "Chorus 1", fromBar: 5, toBar: 8 },
      ],
    });
    const chorus = result.spans.find((s) => s.fromBar >= 5);
    expect(chorus?.section).toBe("Chorus 1");
    // 섹션 안 마디 번호는 1부터
    expect(chorus?.barInSection).toBe(1);
  });

  it("구간이 없어도 2차·3차 좌표는 늘 있다", () => {
    // 같은 마디가 이어지므로 하나로 합쳐진다 — 2마디 = 4초(120BPM 4/4)
    const hits = sorted([1, 2].flatMap((b) => basicBar(b)));
    const span = analyzePattern(hits, grid(2)).spans[0];
    expect(span.fromBar).toBe(1);
    expect(span.toBar).toBe(2);
    expect(span.fromSec).toBeCloseTo(0, 6);
    expect(span.toSec).toBeCloseTo(4, 6);
    expect(span.section).toBeUndefined();
  });
});

describe("위생 지표", () => {
  it("격자에 딱 맞으면 적중률이 1이다", () => {
    const hits = sorted([1, 2, 3, 4].flatMap((b) => basicBar(b)));
    const result = analyzePattern(hits, grid(4));
    expect(result.gridHitRatio).toBeCloseTo(1, 6);
    expect(result.medianDeviationMs).toBeCloseTo(0, 6);
  });

  it("전부 밀려 있으면 적중률이 떨어지고 편차가 잡힌다", () => {
    // 16분 칸이 125ms — 절반쯤 밀면 칸 사이에 앉는다
    const late = sorted([1, 2, 3, 4].flatMap((b) => basicBar(b))).map((h) => ({
      ...h,
      atSec: h.atSec + STEP * 0.45,
    }));
    const result = analyzePattern(late, grid(4));
    expect(result.gridHitRatio).toBeLessThan(0.5);
    expect(Math.abs(result.medianDeviationMs)).toBeGreaterThan(20);
  });

  /**
   * **이 저장소가 처음 갖는 다운비트 위상 증거다.**
   *
   * 곡E에서 우리 다운비트와 allin1의 것이 정확히 2박 어긋났는데 둘 다 기계가
   * 낸 값이라 어느 쪽이 맞는지 몰랐다. 킥은 1박의 강한 단서라 이 히스토그램이
   * 그 논쟁에 제3의 자료를 준다.
   */
  it("킥이 1·3박에 있으면 히스토그램이 그렇게 나온다", () => {
    const hits = sorted([1, 2, 3, 4].flatMap((b) => basicBar(b)));
    const kicks = analyzePattern(hits, grid(4)).kickByBeat;
    expect(kicks).toHaveLength(4);
    expect(kicks[0]).toBe(4);
    expect(kicks[2]).toBe(4);
    expect(kicks[1]).toBe(0);
    expect(kicks[3]).toBe(0);
  });

  it("연주를 한 박 밀면 히스토그램도 따라 밀린다 — 위상을 볼 수 있다", () => {
    // **두 박이 아니라 한 박이다.** 킥이 1·3박(칸 0·8)에 있으므로 두 박을 밀면
    // {0,8} → {8,16≡0}으로 제자리다 — 대칭이라 아무것도 안 보인다.
    const shifted = sorted([1, 2, 3, 4].flatMap((b) => basicBar(b))).map((h) => ({
      ...h,
      atSec: h.atSec + BEAT,
    }));
    const kicks = analyzePattern(shifted, grid(6)).kickByBeat;
    expect(kicks[1]).toBeGreaterThan(kicks[0]);
    expect(kicks[3]).toBeGreaterThan(kicks[2]);
  });
});

describe("경계", () => {
  it("타점이 없으면 빈 결과를 준다", () => {
    const result = analyzePattern([], grid(4));
    expect(result.bars).toEqual([]);
    expect(result.spans).toEqual([]);
    expect(result.period.bars).toBe(0);
  });

  it("격자가 비어 있어도 안 터진다", () => {
    const emptyGrid = buildGrid({ beats: [], downbeats: [], beatsPerBar: 4 });
    expect(analyzePattern(sorted(basicBar(1)), emptyGrid).bars).toEqual([]);
  });

  it("한 마디짜리 곡에서도 돈다", () => {
    const result = analyzePattern(sorted(basicBar(1)), grid(1));
    expect(result.bars.length).toBeGreaterThanOrEqual(1);
  });
});

describe("채널 10 MIDI", () => {
  /**
   * **상태 바이트를 직접 본다.** GM에서 채널 10(0부터 세면 9)만 음높이가 아니라
   * 타악기 번호를 뜻하고, 다른 채널로 내보내면 어떤 시퀀서에서든 피아노
   * 저음역이 울린다 — 파일은 열리고 소리도 나므로 **눈으로는 안 보이는 오류**다.
   * `.svp`의 `0` 대 `0.0`과 같은 부류라 원문 바이트로 못박는다.
   */
  it("note-on이 0x99, note-off가 0x89다", () => {
    const hits = sorted(basicBar(1));
    const { quantized } = toDrumMidi(hits, grid(2), { bpm: BPM, beatsPerBar: BEATS_PER_BAR });
    const bytes = [...quantized];
    expect(bytes).toContain(0x99);
    expect(bytes).toContain(0x89);
    // 채널 0으로 새지 않았는가 — 이게 남아 있으면 어딘가 옛 경로가 있다
    expect(bytes.includes(0x90)).toBe(false);
  });

  it("멜로디 MIDI는 그대로 채널 0이다 — 드럼이 옆을 오염시키지 않는다", async () => {
    const { fromQuantized } = await import("../src/core/transcribe/midi");
    const note = {
      midi: 60,
      startSec: 0,
      endSec: 0.5,
      velocity: 90,
      centsOffset: 0,
      startStep: 0,
      endStep: 4,
    };
    const bytes = [...fromQuantized([note], grid(2), { bpm: BPM })];
    expect(bytes).toContain(0x90);
    expect(bytes.includes(0x99)).toBe(false);
  });

  it("같은 칸의 동시타가 살아남는다", () => {
    const together: DrumHit[] = [hit(1, 0, "kick"), hit(1, 0, "hihat"), hit(1, 0, "cymbal")];
    const { quantized } = toDrumMidi(together, grid(2), { bpm: BPM });
    // 세 타점 → note-on 셋
    expect([...quantized].filter((b) => b === 0x99)).toHaveLength(3);
  });

  it("루프 MIDI는 고른 구간만 담고 0마디부터 다시 센다", () => {
    const hits = sorted([1, 2, 3, 4].flatMap((b) => basicBar(b)));
    const result = analyzePattern(hits, grid(4));
    const span = result.spans[0];
    const one = loopToMidi(hits, grid(4), span, { bpm: BPM, bars: 1 });
    const all = toDrumMidi(hits, grid(4), { bpm: BPM }).quantized;
    // 한 마디짜리가 네 마디짜리보다 작아야 한다
    expect(one.length).toBeLessThan(all.length);
    // 한 마디 = 킥 2 + 스네어 2 + 하이햇 8 = 12타점
    expect([...one].filter((b) => b === 0x99)).toHaveLength(12);
  });
});
