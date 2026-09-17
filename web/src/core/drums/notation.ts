/**
 * 드럼 격자 → **타악 MusicXML.**
 *
 * ## 스파이크로 확인하고 만들었다 (2026-09-04)
 *
 * verovio가 타악보를 그리는지 **재기 전에는 몰랐다.** 번들에 `score-instrument`·
 * `midi-unpitched` 문자열이 없어서 비관했는데, 실제로 그려 보니 셋 다 됐다:
 *
 * | 물음 | 답 | 근거 |
 * |---|---|---|
 * | 타악 음자리표가 그려지는가 | **된다** | 글리프 `E069` = `unpitchedPercussionClef1` |
 * | x머리표가 나오는가 | **된다** | `<notehead>x</notehead>` → `E0A9` = `noteheadXBlack` |
 * | `display-step`/`octave` 대로 앉는가 | **된다** | 아래 표 |
 *
 * 자리는 **높은음자리표 기준과 정확히 같다**(맨 아래 줄부터 센 계단):
 *
 * ```
 * E4=0(맨아래줄) F4=1 G4=2 A4=3 B4=4(가운데줄) C5=5 D5=6 E5=7 F5=8(맨위줄) G5=9 A5=10
 * ```
 *
 * `<unpitched>`와 `<pitch>`가 **같은 자리에 앉는다**(네 조합을 나란히 렌더해
 * 확인했다). 그래서 `gm.ts`의 자리표를 그대로 쓴다.
 *
 * > **머리표만 재야 한다.** 처음에 `.note`의 바운딩 박스로 쟀더니 네 경우가
 * > 전부 같게 나왔다 — 박스에 **기둥이 들어가서** B4에서 기둥 방향이 뒤집힐 때
 * > 중심이 튀었기 때문이다. 다시 잴 사람은 `.notehead`를 볼 것.
 *
 * ## 음가는 **가장 잘게 쓰인 자리**로 통일한다
 *
 * 드럼 타점에는 음가가 없다(`midi.ts`도 같은 이유로 고정 길이를 쓴다). 그래서
 * 멜로디처럼 다음 음까지의 길이를 재서 점음표·붙임줄로 쪼개는 기계가 필요 없다 —
 * 곡에서 실제로 쓰인 가장 잘은 자리(16분·8분·4분)를 찾아 **전부 그 값으로**
 * 적고 빈 자리는 쉼표로 둔다. 8분 하이햇 곡이면 8분으로 적히고, 16분이 하나라도
 * 있으면 16분으로 적힌다.
 *
 * 대가는 16분이 한 번만 나와도 곡 전체가 16분으로 빽빽해진다는 것이다. 마디마다
 * 다르게 잡으면 마디끼리 음표 크기가 달라져 오히려 읽기 나쁘다.
 */

import { CLASS_MARKS, DRUM_CLASSES, GM_DRUMS, representative, type DrumClass } from "./gm";
import type { BarPattern } from "./pattern";

export interface DrumScoreOptions {
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly stepsPerBeat: number;
  readonly title?: string;
}

/** 음가 이름. `divisions`는 한 박당 칸 수와 같게 둔다 */
const TYPE_OF: Record<number, string> = { 1: "16th", 2: "eighth", 4: "quarter", 8: "half" };

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * 곡 전체에서 실제로 쓰인 가장 잘은 자리(칸 단위 간격).
 *
 * 16분 자리에 하나라도 있으면 1, 8분까지만이면 2, 정박뿐이면 4.
 */
function finestStep(bars: readonly BarPattern[], stepsPerBeat: number): number {
  let finest = stepsPerBeat;
  for (const bar of bars) {
    for (let i = 0; i < bar.cells.length; i += 1) {
      if (bar.cells[i].length === 0) continue;
      // 이 칸을 나누어떨어지게 하는 가장 큰 값. 정박이면 stepsPerBeat다
      let unit = stepsPerBeat;
      while (unit > 1 && i % unit !== 0) unit /= 2;
      finest = Math.min(finest, unit);
    }
  }
  return Math.max(1, finest);
}

function noteXml(cls: DrumClass, first: boolean, duration: number, beam: string): string {
  const drum = GM_DRUMS[representative(cls)];
  const head = drum.head === "normal" ? "" : `<notehead>${drum.head}</notehead>`;
  return (
    `<note>${first ? "" : "<chord/>"}` +
    `<unpitched><display-step>${drum.step}</display-step>` +
    `<display-octave>${drum.octave}</display-octave></unpitched>` +
    `<duration>${duration}</duration><type>${TYPE_OF[duration] ?? "quarter"}</type>` +
    `${head}${beam}</note>`
  );
}

/**
 * 격자 마디들 → MusicXML.
 *
 * **못갖춘마디(0마디)도 그대로 낸다** — 번호가 밀리면 악보와 표를 나란히 놓고
 * 볼 수 없다(`musicxml.ts`·`chords.tsx`와 같은 규칙).
 */
export function toDrumMusicXml(
  bars: readonly BarPattern[],
  options: DrumScoreOptions,
): string {
  const { beatsPerBar, stepsPerBeat } = options;
  const step = finestStep(bars, stepsPerBeat);
  const slotsPerBeat = stepsPerBeat / step;
  const divisions = stepsPerBeat;

  const measures = bars
    .map((bar) => {
      const parts: string[] = [];
      let restRun = 0;
      const flushRest = () => {
        // 쉼표는 이어진 만큼 합친다. 칸마다 하나씩 찍으면 읽을 수 없다.
        while (restRun > 0) {
          // 박을 넘지 않는 가장 큰 값
          let take = restRun;
          while (take > 1 && !TYPE_OF[take * step]) take -= 1;
          const duration = take * step;
          parts.push(`<note><rest/><duration>${duration}</duration><type>${TYPE_OF[duration] ?? "quarter"}</type></note>`);
          restRun -= take;
        }
      };

      /**
       * **빔은 격자 자리가 아니라 실제로 있는 음표에서 계산한다.**
       *
       * 자리로 계산하면 박의 마지막 칸이 쉼표일 때 `begin`만 있고 `end`가 없는
       * 묶음이 생기고, **verovio가 그 음표들을 조용히 흘린다** — 실측(2026-09-04):
       * 8분 하이햇을 16분 격자에 얹었더니 마디 넷이 통째로 비었고 오류도 로그도
       * 없었다. 눈으로 보기 전에는 모르는 부류다.
       *
       * 한 박에 빔 대상이 하나뿐이면 빔을 아예 안 붙인다(갈고리로 나간다).
       */
      const slots: number[] = [];
      for (let slot = 0; slot * step < bar.cells.length; slot += 1) {
        if (bar.cells[slot * step].length > 0) slots.push(slot);
      }
      const beamable = step < stepsPerBeat && slotsPerBeat > 1;
      const beamOf = new Map<number, string>();
      if (beamable) {
        for (let beat = 0; beat * slotsPerBeat < bar.cells.length / step; beat += 1) {
          const inBeat = slots.filter(
            (s) => Math.floor(s / slotsPerBeat) === beat,
          );
          if (inBeat.length < 2) continue;
          for (const [i, slot] of inBeat.entries()) {
            const where = i === 0 ? "begin" : i === inBeat.length - 1 ? "end" : "continue";
            beamOf.set(slot, `<beam number="1">${where}</beam>`);
          }
        }
      }

      let cursor = 0;
      for (const slot of slots) {
        restRun += slot - cursor;
        flushRest();
        const cell = bar.cells[slot * step];
        const ordered = DRUM_CLASSES.filter((c) => cell.includes(c));
        const beam = beamOf.get(slot) ?? "";
        // **빔은 화음의 첫 음표에만 붙는다.** 구성음(`<chord/>`)에도 붙이면
        // verovio가 그 마디의 나머지를 통째로 흘린다 — 실측(2026-09-04): XML에
        // 마디당 21개가 들어 있는데 SVG에는 **정확히 1개씩**만 그려졌고,
        // `loadData`는 1을 돌려주고 로그도 비어 있었다.
        parts.push(...ordered.map((cls, i) => noteXml(cls, i === 0, step, i === 0 ? beam : "")));
        cursor = slot + 1;
      }
      restRun += Math.ceil(bar.cells.length / step) - cursor;
      flushRest();

      const attributes =
        bar === bars[0]
          ? `<attributes><divisions>${divisions}</divisions><key><fifths>0</fifths></key>` +
            `<time><beats>${beatsPerBar}</beats><beat-type>4</beat-type></time>` +
            `<clef><sign>percussion</sign><line>2</line></clef></attributes>` +
            `<direction placement="above"><direction-type><metronome>` +
            `<beat-unit>quarter</beat-unit><per-minute>${Math.round(options.bpm)}</per-minute>` +
            `</metronome></direction-type><sound tempo="${Math.round(options.bpm)}"/></direction>`
          : "";
      return `<measure number="${bar.bar}">${attributes}${parts.join("")}</measure>`;
    })
    .join("");

  const title = escapeXml(options.title ?? "드럼");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${title}</work-title></work>
  <part-list><score-part id="P1"><part-name>Drums</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;
}

/** 어휘 → 오선 자리·머리표 안내. 악보 아래 범례로 쓴다 */
export function legend(): { cls: DrumClass; name: string; mark: string }[] {
  return DRUM_CLASSES.map((cls) => ({
    cls,
    name: GM_DRUMS[representative(cls)].name,
    mark: CLASS_MARKS[cls],
  }));
}
