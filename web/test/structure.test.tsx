/**
 * 구조 표 — 화면에 실제로 몇 줄이 서는가.
 *
 * 여기서 보는 것은 표시뿐이다. 어느 구간이 무슨 라벨인가는 `sections.test.ts`가
 * 순수 로직으로 이미 본다.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { Section } from "../src/core/analysis";
import { StructureCard } from "../src/ui/structure";

function section(
  index: number,
  label: Section["label"],
  repeat: number,
  fromBar: number,
  toBar: number,
): Section {
  return {
    index,
    label,
    sourceLabel: label,
    repeat,
    bars: [fromBar, toBar],
    time: [fromBar * 2, toBar * 2],
    reason: "",
  };
}

describe("구조 표", () => {
  test("구간이 없으면 아무것도 그리지 않는다", () => {
    const { container } = render(<StructureCard sections={[]} />);
    expect(container.textContent).toBe("");
  });

  /**
   * **`ds.Matrix`가 첫 칸을 React 키로 쓴다.** 구조 표는 `Verse`가 두 번 나오는
   * 것이 정상이라, 인덱스를 앞에 안 붙이면 키가 겹쳐 **행이 조용히 사라진다.**
   */
  test("같은 라벨이 두 번 나와도 두 줄이 다 선다", () => {
    render(
      <StructureCard
        sections={[
          section(0, "verse", 1, 0, 8),
          section(1, "chorus", 1, 8, 16),
          section(2, "verse", 2, 16, 24),
        ]}
      />,
    );
    expect(screen.getAllByRole("row")).toHaveLength(4); // 머리글 + 3
    expect(screen.getByText("1. Verse 1")).toBeTruthy();
    expect(screen.getByText("3. Verse 2")).toBeTruthy();
  });

  test("pre-chorus는 영어 그대로, 마디와 시간을 함께 보인다", () => {
    render(<StructureCard sections={[section(0, "pre-chorus", 1, 8, 14)]} />);
    expect(screen.getByText("1. Pre-Chorus 1")).toBeTruthy();
    expect(screen.getByText("9–14")).toBeTruthy();
    expect(screen.getByText("6마디")).toBeTruthy();
    expect(screen.getByText("0:16–0:28")).toBeTruthy();
  });

  test("마디를 모르면 —로 비운다. 0으로 채우지 않는다", () => {
    const unknown: Section = { ...section(0, "verse", 1, 0, 8), bars: null };
    render(<StructureCard sections={[unknown]} />);
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  test("모델이 읽은 템포가 우리와 다르면 한 줄로 알린다", () => {
    const sections = [section(0, "verse", 1, 0, 8)];
    const { rerender } = render(
      <StructureCard sections={sections} modelBpm={146} ourBpm={146.2} />,
    );
    expect(screen.queryByText(/구조 분석기가 읽은 템포/)).toBeNull();

    rerender(<StructureCard sections={sections} modelBpm={84} ourBpm={168.2} />);
    expect(screen.getByText(/84.0 BPM이다/)).toBeTruthy();
  });

  test("템포를 모르면 아무 말도 하지 않는다", () => {
    render(<StructureCard sections={[section(0, "verse", 1, 0, 8)]} modelBpm={null} />);
    expect(screen.queryByText(/구조 분석기가 읽은 템포/)).toBeNull();
  });
});
