/**
 * 섹션 재라벨 검증 — **손으로 쓴 구간 배열만 넣는다.**
 *
 * 이 층은 DSP를 모르고 사이드카도 모른다. 그래서 오디오도 모델도 없이 전부
 * 결정적으로 잴 수 있다 — 어느 구간이 pre-chorus가 되어야 하는지는 규칙이
 * 정하는 것이고, 규칙은 여기 다 적혀 있다.
 *
 * **이 테스트가 말해 주지 않는 것**: 실곡에서 그 규칙이 맞는가. 그건
 * `evalset/truth/*.sections.json`과 `eval_structure.py`의 일이다.
 */

import { describe, expect, test } from "vitest";

import {
  locate,
  type RawSegment,
  relabelPreChorus,
  sectionsFromSegments,
  type StagedSection,
} from "../src/core/analysis";

/** 2초 마디 32개 = 64초. 4/4 120BPM인 셈이다 */
const BAR = 2;
const DOWNBEATS = Array.from({ length: 32 }, (_, i) => i * BAR);
const DURATION = 32 * BAR;

/** `[시작마디, 끝마디, 라벨]` → 초 단위 구간 */
function seg(fromBar: number, toBar: number, label: string): RawSegment {
  return { start: fromBar * BAR, end: toBar * BAR, label };
}

function staged(fromBar: number, toBar: number, label: string): StagedSection {
  return {
    label: label as StagedSection["label"],
    sourceLabel: label,
    bars: [fromBar, toBar],
    time: [fromBar * BAR, toBar * BAR],
    reason: "",
  };
}

describe("섹션 — 센티널과 정리", () => {
  test("start·end는 구간이 아니라 센티널이라 버린다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 0, "start"), seg(0, 8, "intro"), seg(8, 16, "verse"), seg(16, 16, "end")],
      DOWNBEATS,
      DURATION,
    );
    expect(sections.map((s) => s.label)).toEqual(["intro", "verse"]);
  });

  test("모르는 라벨은 unknown이 되지만 원래 이름을 잃지 않는다", () => {
    const [section] = sectionsFromSegments([seg(0, 8, "postchorus")], DOWNBEATS, DURATION);
    expect(section.label).toBe("unknown");
    expect(section.sourceLabel).toBe("postchorus");
  });

  test("빈 입력은 빈 배열이다 — 던지지 않는다", () => {
    expect(sectionsFromSegments([], DOWNBEATS, DURATION)).toEqual([]);
  });

  test("이어진 같은 라벨은 합친다 — 모델의 출력 입자가 8마디다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 8, "chorus"), seg(8, 16, "chorus")],
      DOWNBEATS,
      DURATION,
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].bars).toEqual([0, 16]);
  });

  test("병합은 재라벨 **뒤**다 — 먼저 합치면 pre-chorus 규칙이 죽는다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 8, "verse"), seg(8, 16, "verse"), seg(16, 24, "chorus")],
      DOWNBEATS,
      DURATION,
    );
    // 먼저 합쳤다면 verse(16마디) + chorus 둘뿐이었을 것이다
    expect(sections.map((s) => s.label)).toEqual(["verse", "pre-chorus", "chorus"]);
  });
});

describe("섹션 — 다운비트 스냅", () => {
  test("경계가 우리 마디 격자로 옮겨진다", () => {
    // 8.7초는 4마디(8초)와 5마디(10초) 사이인데 4마디 쪽이 가깝다
    const sections = sectionsFromSegments(
      [{ start: 0, end: 8.7, label: "intro" }, { start: 8.7, end: 32, label: "verse" }],
      DOWNBEATS,
      DURATION,
    );
    expect(sections[0].bars).toEqual([0, 4]);
    expect(sections[1].bars).toEqual([4, 16]);
    expect(sections[1].time[0]).toBe(8);
  });

  test("한 박 넘게 옮겼으면 근거를 남긴다", () => {
    const sections = sectionsFromSegments(
      [{ start: 0, end: 16, label: "intro" }, { start: 16, end: 32, label: "verse" }],
      DOWNBEATS,
      DURATION,
    );
    expect(sections[1].reason).toBe("");

    // 마디가 2초이므로 문턱은 0.5초. 16.8초는 16초 칸으로 0.8초를 옮겨 온다
    const drifted = sectionsFromSegments(
      [{ start: 0, end: 16.8, label: "intro" }, { start: 16.8, end: 32, label: "verse" }],
      DOWNBEATS,
      DURATION,
    );
    expect(drifted[1].reason).toBe("경계를 800ms 옮김");
  });

  test("첫 다운비트 앞의 음악을 잘라 먹지 않는다", () => {
    // 곡은 1.1초에 시작하는데 첫 다운비트가 4.0초다(못갖춘마디)
    const late = Array.from({ length: 16 }, (_, i) => 4 + i * BAR);
    const sections = sectionsFromSegments(
      [{ start: 1.1, end: 12, label: "intro" }, { start: 12, end: 30, label: "verse" }],
      late,
      DURATION,
    );
    // 시각은 진짜 시작을 지키고
    expect(sections[0].time[0]).toBe(1.1);
    // 마디 번호는 첫 다운비트가 1마디다 — 못갖춘마디는 0마디다(사양서 §3)
    expect(sections[0].bars?.[0]).toBe(0);
  });

  test("마지막 구간의 끝은 다운비트가 아니라 곡의 끝이다", () => {
    const sections = sectionsFromSegments(
      [{ start: 0, end: 65.5, label: "chorus" }],
      DOWNBEATS,
      65.5,
    );
    expect(sections[0].time[1]).toBe(65.5);
  });

  test("다운비트가 없으면 마디를 모른다고 말한다 — 0으로 채우지 않는다", () => {
    const sections = sectionsFromSegments([seg(0, 8, "verse")], [], DURATION);
    expect(sections[0].bars).toBeNull();
    expect(sections[0].time).toEqual([0, 16]);
  });
});

describe("섹션 — pre-chorus 재라벨 (사양서 §9.3)", () => {
  test("절 → 짧은 구간 → 사비면 가운데가 pre-chorus다", () => {
    const sections = sectionsFromSegments(
      [
        seg(0, 4, "intro"),
        seg(4, 12, "verse"),
        seg(12, 18, "verse"),
        seg(18, 26, "chorus"),
      ],
      DOWNBEATS,
      DURATION,
    );
    expect(sections.map((s) => s.label)).toEqual([
      "intro",
      "verse",
      "pre-chorus",
      "chorus",
    ]);
    expect(sections[2].reason).toBe("사비 직전 6마디");
    // 원래 라벨은 남는다 — 무엇을 고쳤는지 되짚을 수 있어야 한다
    expect(sections[2].sourceLabel).toBe("verse");
  });

  test("bridge·break도 pre-chorus가 될 수 있다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 12, "verse"), seg(12, 16, "bridge"), seg(16, 24, "chorus")],
      DOWNBEATS,
      DURATION,
    );
    expect(sections[1].label).toBe("pre-chorus");
  });

  test("너무 길면 그냥 verse다 — 긴 절을 쪼개지 않는다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 8, "verse"), seg(8, 24, "verse"), seg(24, 32, "chorus")],
      DOWNBEATS,
      DURATION,
    );
    // 16마디는 PRECHORUS_MAX_BARS(8)를 넘는다. 재라벨이 없으니 둘이 합쳐진다
    expect(sections.map((s) => s.label)).toEqual(["verse", "chorus"]);
    expect(sections[0].bars).toEqual([0, 24]);
  });

  test("너무 짧아도 안 된다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 12, "verse"), seg(12, 13, "break"), seg(13, 21, "chorus")],
      DOWNBEATS,
      DURATION,
    );
    expect(sections[1].label).toBe("break");
  });

  test("앞 구간이 없으면 '절 → 프리 → 사비'라는 증거가 없다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 6, "verse"), seg(6, 14, "chorus")],
      DOWNBEATS,
      DURATION,
    );
    expect(sections[0].label).toBe("verse");
  });

  test("앞이 절이 아니고 앞보다 짧지도 않으면 안 바꾼다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 4, "intro"), seg(4, 10, "bridge"), seg(10, 18, "chorus")],
      DOWNBEATS,
      DURATION,
    );
    // intro(4마디)보다 bridge(6마디)가 오히려 길다
    expect(sections[1].label).toBe("bridge");
  });

  test("사비가 아닌 것 앞에서는 아무 일도 없다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 12, "verse"), seg(12, 18, "verse"), seg(18, 26, "inst")],
      DOWNBEATS,
      DURATION,
    );
    // 재라벨이 없으므로 두 verse가 합쳐진다
    expect(sections.map((s) => s.label)).toEqual(["verse", "inst"]);
    expect(sections[0].bars).toEqual([0, 18]);
  });

  test("마디를 모르면 길이 규칙을 잴 수 없으므로 손대지 않는다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 12, "verse"), seg(12, 18, "verse"), seg(18, 26, "chorus")],
      [],
      DURATION,
    );
    expect(sections.map((s) => s.label)).toEqual(["verse", "chorus"]);
    expect(sections[0].bars).toBeNull();
  });

  test("앞보다 길면 안 된다 — 절이 앞에 있어도 그렇다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 4, "verse"), seg(4, 12, "verse"), seg(12, 20, "chorus")],
      DOWNBEATS,
      DURATION,
    );
    // 8마디 구간이 앞의 4마디 절보다 길다 — "사비 직전의 짧은 마디"가 아니다.
    // 합쳐져서 하나가 된다
    expect(sections.map((s) => s.label)).toEqual(["verse", "chorus"]);
  });

  test("실측(곡E)의 모양 — 1절은 걸리고 2절은 놓친다", () => {
    // allin1이 실제로 낸 것: 8마디 블록. 1절만 verse가 둘로 끊겨 나왔다
    const sections = sectionsFromSegments(
      [
        seg(0, 8, "intro"),
        seg(8, 16, "intro"),
        seg(16, 24, "verse"),
        seg(24, 32, "verse"),
        seg(32, 40, "chorus"),
        seg(40, 48, "chorus"),
        seg(48, 64, "verse"), // 2절은 16마디 한 덩어리
        seg(64, 72, "chorus"),
      ],
      Array.from({ length: 72 }, (_, i) => i * BAR),
      72 * BAR,
    );
    expect(sections.map((s) => `${s.label} ${s.repeat}`)).toEqual([
      "intro 1",
      "verse 1",
      "pre-chorus 1", // 1절: 모델이 끊어 준 덕에 걸린다
      "chorus 1", // 8마디 둘이 합쳐져 하나다
      "verse 2", // 2절: 16마디라 못 가른다 — 알려진 한계
      "chorus 2",
    ]);
  });

  test("문턱은 인자로 바꿀 수 있다 — 정답이 붙으면 여기서 맞춘다", () => {
    const input = [staged(0, 12, "verse"), staged(12, 24, "verse"), staged(24, 32, "chorus")];
    expect(relabelPreChorus(input)[1].label).toBe("verse");
    expect(relabelPreChorus(input, { preChorusMaxBars: 12 })[1].label).toBe("pre-chorus");
  });
});

describe("섹션 — 번호와 좌표", () => {
  test("같은 라벨은 등장 순서로 번호가 붙는다", () => {
    const sections = sectionsFromSegments(
      [
        seg(0, 4, "intro"),
        seg(4, 12, "verse"),
        seg(12, 20, "chorus"),
        seg(20, 28, "verse"),
        seg(28, 32, "chorus"),
      ],
      DOWNBEATS,
      DURATION,
    );
    expect(sections.map((s) => `${s.label} ${s.repeat}`)).toEqual([
      "intro 1",
      "verse 1",
      "chorus 1",
      "verse 2",
      "chorus 2",
    ]);
    expect(sections.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
  });

  test("locate가 사양서 §3의 1차 좌표를 준다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 4, "intro"), seg(4, 12, "chorus"), seg(12, 20, "inst"), seg(20, 28, "chorus")],
      DOWNBEATS,
      DURATION,
    );
    // 10초 = 5마디째 = chorus 1의 두 번째 마디
    expect(locate(sections, 10, DOWNBEATS)).toEqual({
      label: "chorus",
      repeat: 1,
      bar: 2,
    });
    expect(locate(sections, 42, DOWNBEATS)).toEqual({
      label: "chorus",
      repeat: 2,
      bar: 2,
    });
  });

  test("곡 밖의 시각은 null이다", () => {
    const sections = sectionsFromSegments([seg(0, 8, "verse")], DOWNBEATS, DURATION);
    expect(locate(sections, 999, DOWNBEATS)).toBeNull();
  });

  test("구간에 빈틈이 없고 겹치지 않는다", () => {
    const sections = sectionsFromSegments(
      [seg(0, 4, "intro"), seg(4, 12, "verse"), seg(12, 20, "chorus")],
      DOWNBEATS,
      DURATION,
    );
    for (let i = 1; i < sections.length; i += 1) {
      expect(sections[i].time[0]).toBe(sections[i - 1].time[1]);
    }
  });
});
