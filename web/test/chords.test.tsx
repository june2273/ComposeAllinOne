/**
 * 코드 차트 — 화면에 실제로 몇 칸이 서는가.
 *
 * 인식이 옳은가는 `analysis.test.ts`가 합성 신호로 본다. 여기서 보는 것은
 * **마디와 박의 자리**뿐이다 — 코드를 한 칸이라도 잘못 놓으면 표가 악보와
 * 어긋나고, 그건 인식 정확도와 무관한 오류다.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { ChordEvent } from "../src/core/analysis";
import { ChordCard } from "../src/ui/chords";

/** 비트 하나 0.5초인 격자. 4/4면 한 마디가 2초다 */
const BEATS = Array.from({ length: 40 }, (_, i) => i * 0.5);

function chord(
  startBeat: number,
  endBeat: number,
  symbol: string,
  root = 0,
): ChordEvent {
  return {
    startBeat,
    endBeat,
    startSec: BEATS[startBeat],
    endSec: BEATS[endBeat],
    root,
    quality: "maj",
    symbol,
    kind: "major",
    suffix: "",
    confidence: 0.7,
    candidates: [],
  };
}

function show(chords: ChordEvent[], phase = 0) {
  return render(
    <ChordCard
      chords={chords}
      beatsPerBar={4}
      phase={phase}
      beats={BEATS}
      confidence={0.7}
    />,
  );
}

describe("코드 차트", () => {
  test("코드가 없으면 아무것도 그리지 않는다", () => {
    const { container } = show([]);
    expect(container.textContent).toBe("");
  });

  /**
   * **`ds.Matrix`가 첫 칸을 React 키로 쓴다.** 코드 표에서 `C`가 여러 번
   * 나오는 것은 정상이라, 첫 칸이 마디 번호여야 행이 안 사라진다
   * (`ui/structure.tsx`가 인덱스를 앞에 붙이는 것과 같은 이유다).
   */
  test("같은 코드가 여러 마디에 나와도 줄이 다 선다", () => {
    show([chord(0, 4, "C"), chord(4, 8, "G"), chord(8, 12, "C")]);
    expect(screen.getAllByRole("row")).toHaveLength(4); // 머리글 + 3마디
    expect(screen.getAllByText("C")).toHaveLength(2);
  });

  /**
   * **`td`는 코드만이다.** 시각을 따로 열로 두면 `ds.Matrix`가 값이 든 칸에
   * 걸어 주는 강조를 시각까지 받아 코드와 같은 무게로 보인다.
   */
  test("마디 안 박 자리에 놓인다 — 코드가 아닌 것은 칸에 없다", () => {
    show([chord(0, 2, "C"), chord(2, 4, "F")]);
    const row = screen.getAllByRole("row")[1];
    // 1박 C · 3박 F. 2·4박은 비어 있다
    expect([...row.querySelectorAll("td")].map((c) => c.textContent)).toEqual([
      "C", "", "F", "",
    ]);
    // 마디 번호와 시각은 행 머리에 함께 있다
    expect(row.querySelector("th")?.textContent).toBe("1 · 0:00");
  });

  /** 첫 다운비트가 1마디 1박이다 — `musicxml.ts`가 쓰는 번호와 같아야 한다 */
  test("위상이 밀려 있으면 그 앞은 0마디다", () => {
    show([chord(1, 3, "C"), chord(3, 7, "G")], 3);
    const rows = screen.getAllByRole("row").slice(1);
    expect(
      rows.map((r) => r.querySelector("th")?.textContent?.split(" · ")[0]),
    ).toEqual(["0", "1"]);
  });

  /** 빈 줄은 "못 잡았다"로 읽힌다. 이어지는 것과 구별되어야 한다 */
  test("코드가 안 바뀐 마디는 이어짐 표시가 붙는다", () => {
    show([chord(0, 8, "C")]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[1].querySelector("td")?.textContent).toBe("·");
  });

  test("신뢰도가 낮으면 확인이 필요하다고 말한다", () => {
    render(
      <ChordCard
        chords={[chord(0, 4, "C")]}
        beatsPerBar={4}
        phase={0}
        beats={BEATS}
        confidence={0.2}
      />,
    );
    expect(screen.getByText(/확인 필요/)).toBeTruthy();
  });

  /** 어휘를 좁힌 것은 못 해서가 아니다 — 안 적으면 사용자가 버그로 읽는다 */
  test("무엇을 못 잡는지 화면이 말한다", () => {
    show([chord(0, 4, "C")]);
    expect(screen.getByText(/dim·aug는 음 집합만으로 근음이 정해지지 않고/)).toBeTruthy();
  });
});
