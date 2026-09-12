/**
 * 구조 표 — 사양서 §6이 요구하는 **1차 표현**이다.
 *
 * 섹션마다 한 행이면 변박·전조·변속이 별도 마커 없이 **위아래 행의 값 차이로
 * 드러난다.** 지금은 열이 넷뿐이지만, 구간별 조성·박자가 붙으면 그대로 열이
 * 늘어난다(사양서 §5의 `structure` 스키마가 곧 이 행이다).
 *
 * **`ds.Matrix`를 그대로 쓴다.** 도메인을 모르는 문자열 격자표가 정확히 이
 * 용도이고, 경계를 아직 믿을 수 없는 단계에서 새 부품을 만들어 유지 대상을
 * 늘릴 이유가 없다.
 *
 * 라벨은 **영어 그대로 나간다.** 내부 값과 화면 표시가 갈리면 어느 쪽이
 * 정답인지가 코드와 화면 사이에서 흔들린다.
 */

import type { Section } from "../core/analysis";
import { Fieldset, Matrix } from "../ds";
import { clock, titleCase } from "./format";

/** 우리 BPM과 이만큼 넘게 다르면 "다른 읽기"로 함께 띄운다 */
const BPM_DISAGREE = 0.05;



export interface StructureCardProps {
  readonly sections: readonly Section[];
  /** 구조 분석기가 함께 준 BPM. 우리 값과 다르면 한 줄로 알린다 */
  readonly modelBpm?: number | null;
  readonly ourBpm?: number;
}

export function StructureCard({ sections, modelBpm, ourBpm }: StructureCardProps) {
  if (sections.length === 0) return null;

  const model = modelBpm ?? 0;
  const ours = ourBpm ?? 0;
  const disagrees = model > 0 && ours > 0 && Math.abs(model / ours - 1) > BPM_DISAGREE;

  return (
    <Fieldset title="구조">
      <Matrix
        columns={["구간", "마디", "길이", "시간"]}
        rows={sections.map((section) => [
          // **인덱스를 반드시 앞에 붙인다.** `ds.Matrix`가 첫 칸을 React 키로
          // 쓰는데, 구조 표는 `Verse`가 두 번 나오는 것이 정상이다 —
          // 빼먹으면 행이 조용히 사라진다.
          `${section.index + 1}. ${titleCase(section.label)} ${section.repeat}`,
          section.bars ? `${section.bars[0] + 1}–${section.bars[1]}` : "—",
          section.bars ? `${section.bars[1] - section.bars[0]}마디` : "—",
          `${clock(section.time[0])}–${clock(section.time[1])}`,
        ])}
      />
      {disagrees && (
        <p className="muted">
          구조 분석기가 읽은 템포는 {model.toFixed(1)} BPM이다 — 우리 값과 다르다.
          마디 번호는 우리 다운비트를 따른다.
        </p>
      )}
    </Fieldset>
  );
}
