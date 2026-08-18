/**
 * 코드 진행 표 — 마디가 행, 박이 열인 **코드 차트**다.
 *
 * 목록(`C → G → Am → F`)이 아니라 격자인 것은 사람이 코드를 그렇게 읽기
 * 때문이다. 한 마디에 코드가 둘 들어갔는지, 사비에서 코드가 빨라지는지는
 * 자리로 보이지 목록으로는 안 보인다.
 *
 * **`ds.Matrix`를 그대로 쓴다** — 도메인을 모르는 문자열 격자표가 정확히 이
 * 용도이고, `ui/structure.tsx`가 같은 판단을 이미 했다. 덤으로 값이 든 칸에만
 * 걸리는 `matrix__cell--on`이 코드가 바뀌는 자리를 저절로 도드라지게 한다.
 *
 * 사이드카가 꺼져 있어도 나온다 — 코드 인식은 브라우저 안에서 끝난다.
 */

import type { ChordEvent } from "../core/analysis";
import { confidenceTier } from "../core/analysis";
import { Fieldset, Matrix } from "../ds";

/** 코드가 안 바뀐 마디에 찍는 글자. 빈 칸이면 "못 잡았다"로 읽힌다 */
const SUSTAIN = "·";

function clock(value: number): string {
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

export interface ChordCardProps {
  readonly chords: readonly ChordEvent[];
  readonly beatsPerBar: number;
  /** 몇 번째 비트가 첫 다운비트인가 — `MeterEstimate.phase` */
  readonly phase: number;
  readonly beats: readonly number[];
  readonly confidence: number;
}

/**
 * 비트 번호 → (마디, 마디 안 박). **첫 다운비트가 1마디 1박이다.**
 *
 * 그 앞의 비트는 0마디가 된다(사양서 §3의 못갖춘마디 규칙 — `musicxml.ts`가
 * 같은 번호를 쓴다). 마디 번호가 두 곳에서 갈리면 악보와 이 표를 나란히 놓고
 * 볼 수 없다.
 */
function locate(
  startBeat: number,
  phase: number,
  beatsPerBar: number,
): { bar: number; beat: number } {
  const relative = startBeat - phase;
  const bar = Math.floor(relative / beatsPerBar) + 1;
  return { bar, beat: relative - (bar - 1) * beatsPerBar };
}

export function ChordCard({
  chords,
  beatsPerBar,
  phase,
  beats,
  confidence,
}: ChordCardProps) {
  if (chords.length === 0) return null;

  const perBar = Math.max(1, beatsPerBar);
  const placed = chords.map((chord) => ({
    chord,
    ...locate(chord.startBeat, phase, perBar),
  }));
  const first = Math.min(...placed.map((p) => p.bar));
  // **끝나는 마디까지 편다.** 시작 마디만 모으면 네 마디 가는 코드가 한 줄로
  // 줄어 표가 곡보다 짧아진다 — 코드를 못 잡은 것처럼 보인다.
  const last = Math.max(
    ...placed.map(
      ({ chord }) => locate(Math.max(chord.startBeat, chord.endBeat - 1), phase, perBar).bar,
    ),
  );

  // 마디 → 박별 심볼
  const grid = new Map<number, string[]>();
  for (let bar = first; bar <= last; bar += 1) {
    grid.set(bar, Array.from({ length: perBar }, () => ""));
  }
  for (const { chord, bar, beat } of placed) {
    grid.get(bar)?.splice(beat, 1, chord.symbol);
  }

  // 마디 첫 비트의 시각. 코드가 없는 마디도 시각은 있어야 한다
  const timeOf = (bar: number): string => {
    const index = phase + (bar - 1) * perBar;
    const at = beats[Math.max(0, Math.min(beats.length - 1, index))];
    return at === undefined ? "—" : clock(at);
  };

  // **시간은 첫 칸에 마디 번호와 함께 넣는다.** 열을 따로 두면 `ds.Matrix`가
  // 값이 든 칸에 걸어 주는 강조(`matrix__cell--on`)를 시각까지 받아서, 코드와
  // 시각이 같은 무게로 보인다 — 격자에서 눈이 좇아야 하는 것은 코드뿐이다.
  const rows = [...grid].map(([bar, cells]) => [
    `${bar} · ${timeOf(bar)}`,
    // 코드가 하나도 안 바뀐 마디는 빈 줄이 아니라 "이어짐"이다
    ...(cells.some(Boolean) ? cells : [SUSTAIN, ...cells.slice(1)]),
  ]);

  return (
    <Fieldset title="코드">
      <Matrix
        columns={[
          "마디",
          ...Array.from({ length: perBar }, (_, i) => String(i + 1)),
        ]}
        rows={rows}
      />
      <p className="muted">
        코드 {chords.length}개 · 신뢰도 {confidence.toFixed(2)}
        {confidenceTier(confidence) === "low" && " — 확인 필요"}
        {/*
          어휘를 좁힌 것은 못 해서가 아니라 **음 집합만으로는 못 정하기**
          때문이다(사양서 §6). 화면이 그걸 말해 주지 않으면 사용자는 dim이
          안 나오는 것을 버그로 읽는다.
        */}
        . 3화음과 7화음까지만 잡는다 — dim·aug는 음 집합만으로 근음이 정해지지
        않고(C aug ≡ E aug ≡ G♯ aug) 전위·텐션은 아직 없다.
      </p>
    </Fieldset>
  );
}
