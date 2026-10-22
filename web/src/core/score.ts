/**
 * 악보 렌더링 — MusicXML을 verovio(WASM)로 SVG로 굽는다.
 *
 * **Python/Qt판에 있던 SVG 후처리가 여기서는 전부 사라졌다.** Qt는 SVG 1.2
 * Tiny만 지원해서 verovio가 내보내는 중첩 `<svg>`를 통째로 건너뛰었고,
 * `<style>` 안의 CSS를 적용하지 못해 오선이 보이지 않았다. 브라우저는 둘 다
 * 그냥 처리한다 — verovio가 원래 웹용 라이브러리이기 때문이다. 종횡비도
 * `viewBox` + CSS로 알아서 유지된다.
 *
 * WASM 모듈은 처음 쓸 때 한 번만 로드한다(수 MB). 로드 전에는 `ready`가
 * false이고, 호출부는 악보 없이도 문제를 계속 풀 수 있어야 한다.
 */

import type { VerovioToolkit } from "verovio/esm";

import { ACCIDENTAL_XML, type Pitch } from "./theory";

/** 무게중심이 이 음보다 낮으면 낮은음자리표가 읽기 편하다 */
export const BASS_CLEF_BELOW = 60; // C4

/**
 * 음자리표는 **음이 정하지 옵션이 정하지 않는다.**
 *
 * 낮은음자리표 옵션이 하는 일은 음역 하한을 내리는 것뿐이고, 그림이 어느
 * 자리표로 그려질지는 여기 한 줄이 정한다. 둘을 따로 들고 다니면 갈릴 수
 * 있다 — 악보에는 낮은음자리표인데 실제 음은 높은 자리인 문제가 나온다.
 *
 * 판단은 **두 음의 가운데**로 한다. 위 음만 보면 C3–G4처럼 걸친 쌍에서 아래
 * 음이 덧줄 셋 아래로 내려간다.
 */
export function clefFor(pitches: readonly Pitch[]): readonly [string, number] {
  // 빈 배열이면 평균이 NaN이고 `NaN >= 60`은 거짓이라 **낮은음자리표로 떨어진다.**
  // 음계를 한 음씩 쌓아 그릴 때 0음짜리 빈 오선이 그 꼴로 나왔다(실측).
  if (pitches.length === 0) return ["G", 2];
  const middle = pitches.reduce((sum, p) => sum + p.midi, 0) / pitches.length;
  return middle >= BASS_CLEF_BELOW ? ["G", 2] : ["F", 4];
}

function noteXml(pitch: Pitch, chord: boolean): string {
  const alter = pitch.alter ? `<alter>${pitch.alter}</alter>` : "";
  const accidental = pitch.alter
    ? `<accidental>${ACCIDENTAL_XML[pitch.alter]}</accidental>`
    : "";
  return (
    `<note>${chord ? "<chord/>" : ""}` +
    `<pitch><step>${pitch.letter}</step>${alter}` +
    `<octave>${pitch.octave}</octave></pitch>` +
    `<duration>4</duration><type>whole</type>${accidental}</note>`
  );
}

/** 악보 하나의 머리말. part-name을 비워 두는 이유는 아래 주석 참조 */
const SCORE_OPEN =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<score-partwise version="4.0"><part-list><score-part id="P1">' +
  // part-name을 비워 둔다. 내용을 넣으면 verovio가 악보 왼쪽에 성부
  // 이름을 찍어 두 음짜리 그림의 균형이 깨진다.
  "<part-name/></score-part></part-list>" +
  '<part id="P1">';

const SCORE_CLOSE = "</part></score-partwise>";

/**
 * **음표 수에 맞춰 늘린 박자표**, 그리고 감춘다.
 *
 * 온음표 n개를 한 마디에 담으려면 그 마디가 4n박이어야 한다 —
 * `<divisions>1</divisions>`에서 온음표가 `<duration>4</duration>`이므로
 * 합이 정확히 맞아야 **verovio가 오류 없이 마디를 밀어 버리는** 일을 피한다.
 *
 * 마디를 음마다 쪼개는 방법도 되지만(마디선은 `bar-style none`으로 감출 수 있다)
 * 그러면 마디마다 여백이 붙어 **그림이 가로로 길쭉해지고 음표가 작아진다**(실측).
 * 한 마디로 두면 그 여백이 통째로 사라진다.
 */
function stretchedTime(notes: number): string {
  return `<time print-object="no"><beats>${notes * 4}</beats><beat-type>4</beat-type></time>`;
}

/**
 * 첫 마디에만 넣는 `<attributes>`.
 *
 * **자리표는 그릴 음이 아니라 `clefFrom`이 정한다.** 음계를 한 음씩 쌓아 그릴 때
 * 지금까지 친 음만 넘기면 **자리표가 도중에 바뀔 수 있다** — 기준은 언제나
 * 완성된 모습이어야 한다.
 */
function attributesXml(
  clefFrom: readonly Pitch[],
  fifths: number,
  time = "",
): string {
  const [sign, line] = clefFor(clefFrom);
  return (
    `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key>${time}` +
    `<clef><sign>${sign}</sign><line>${line}</line></clef></attributes>`
  );
}

/** 낮은 음부터 겹쳐 찍은 한 마디짜리 MusicXML. 음 하나여도 된다. */
function staffMusicXml(pitches: readonly Pitch[], fifths: number): string {
  return (
    `${SCORE_OPEN}<measure number="1">${attributesXml(pitches, fifths)}` +
    pitches.map((p, i) => noteXml(p, i > 0)).join("") +
    `</measure>${SCORE_CLOSE}`
  );
}

/** 두 음을 겹쳐 찍은 한 마디짜리 MusicXML. */
export function harmonicIntervalMusicXml(
  a: Pitch,
  b: Pitch,
  fifths = 0,
): string {
  const [lower, upper] = a.midi <= b.midi ? [a, b] : [b, a];
  return staffMusicXml([lower, upper], fifths);
}

/** 한 음짜리. 음정 해석(음 하나를 주고 나머지를 찾게 하는 단계)이 쓴다. */
export function singleNoteMusicXml(pitch: Pitch, fifths = 0): string {
  return staffMusicXml([pitch], fifths);
}

/**
 * **음표 없이 조표만** 그린 오선. 조표 읽기 문제가 쓴다.
 *
 * `melodicMusicXml`의 "아직 아무것도 안 친" 경로를 그대로 탄다 — 음계가 첫 음을
 * 치기 전에 그리는 빈 오선과 **같은 XML**이고, 다른 것은 `fifths`뿐이다. 그래서
 * 마디가 넘쳐 verovio가 조용히 미는 함정을 새로 밟을 자리가 없다.
 *
 * **이 저장소에서 `fifths`가 0이 아닌 첫 호출이다.** 배선은 진작 있었는데
 * (`attributesXml`이 `<key><fifths>`를 내보낸다) 아무도 쓰지 않았다.
 */
export function keySignatureMusicXml(fifths: number): string {
  return melodicMusicXml([], [], fifths);
}

/**
 * **나란히 찍은 온음표 한 줄** — 음계가 쓴다. `<chord/>`가 하나도 없다.
 *
 * ## 음 하나에 마디 하나다 — 한 마디에 몰아넣으면 조용히 깨진다
 *
 * `<divisions>1</divisions>`에서 온음표 하나(`<duration>4</duration>`)가 정확히
 * 4/4 한 마디다. 그래서 온음표 여덟 개를 한 마디에 넣으면 **마디가 여덟 배로
 * 넘치고, verovio는 그때 오류 없이 그 마디부터 밀어 버린다**(`loadData`는 1을
 * 돌려주고 로그도 비어 있다 — `transcribe/musicxml.ts`와 드럼 악보가 같은 함정을
 * 적어 두었다). 마디를 쪼개는 것이 그 함정을 피하는 유일한 길이다.
 *
 * 대신 **마디선과 박자표를 감춘다** — 음계는 리듬이 아니라 음높이의 줄이고,
 * 교재의 음계 그림에도 마디선이 없다. 둘 다 verovio가 안 지키면 선이 보일 뿐
 * 음표는 그대로이므로 기능이 깨지지는 않는다.
 */
export function melodicMusicXml(
  pitches: readonly Pitch[],
  clefFrom: readonly Pitch[] = pitches,
  fifths = 0,
): string {
  // 아직 아무것도 안 친 상태 — 자리표만 있는 빈 오선. **`clefFrom`을 봐야 한다**
  const time = stretchedTime(Math.max(1, pitches.length));
  return (
    `${SCORE_OPEN}<measure number="1">${attributesXml(clefFrom, fifths, time)}` +
    pitches.map((p) => noteXml(p, false)).join("") +
    `</measure>${SCORE_CLOSE}`
  );
}

/**
 * 우리가 쓰는 verovio 툴킷. **선언은 `verovio.d.ts` 한 곳에만 있다** —
 * 예전에는 같은 메서드 목록이 여기에도 손으로 적혀 있어서, 새 메서드를 쓸 때
 * 두 곳을 고쳐야 하는데 한쪽만 고쳐도 타입 검사가 통과했다.
 *
 * `import type`이라 번들에는 한 줄도 안 들어간다 — 실제 로딩은 아래
 * `ScoreRenderer.load()`의 동적 import뿐이다(수 MB라 첫 악보 때 받는다).
 */
type Toolkit = VerovioToolkit;

/**
 * 타임맵 한 줄 — "이 시각(ms)에 이 음표들이 시작하고 저것들이 끝난다".
 *
 * verovio가 MusicXML의 `<sound tempo>`를 읽어 스스로 만든다. `on`·`off`의 문자열은
 * **SVG 안의 `id`와 같은 값**이라, 그대로 요소를 찾아 강조할 수 있다.
 */
export interface TimemapEntry {
  readonly tstamp: number;
  readonly on?: readonly string[];
  readonly off?: readonly string[];
}

export interface RenderedScore {
  readonly svg: string;
  readonly timemap: readonly TimemapEntry[];
}

/** ms → 초 직선. `sec = a * ms + b` */
export interface TimeMapping {
  readonly a: number;
  readonly b: number;
}

/**
 * 타임맵의 ms를 우리 재생 시계의 초에 맞춘다 — **끝점 둘로 직선을 맞춘다.**
 *
 * 타임맵의 0ms는 우리 0초가 아니다. 못갖춘마디가 쉼표로 채워져 있으면 첫 음표가
 * 0ms가 아니고, verovio가 `<sound tempo>`를 어떻게 읽었는지도 밖에서는 확인할
 * 길이 없다. 그래서 **첫 `on`을 우리 첫 음표에, 마지막 `off`를 우리 마지막 음표에**
 * 걸어 축척(a)과 오프셋(b)을 동시에 흡수한다. 붙임줄로 음표가 쪼개져 있어도
 * 끝점 둘은 그대로라 영향을 받지 않는다.
 *
 * 끝점을 못 찾거나 길이가 0이면 **그대로 두는 직선**(a=1/1000, b=0)을 준다 —
 * 커서가 조금 어긋날지언정 재생이 막히지는 않는다.
 */
export function timeMapping(
  timemap: readonly TimemapEntry[],
  firstSec: number,
  lastSec: number,
): TimeMapping {
  const identity = { a: 1 / 1000, b: 0 };
  const first = timemap.find((e) => e.on?.length);
  let lastMs = -1;
  for (const entry of timemap) if (entry.off?.length) lastMs = entry.tstamp;
  if (!first || lastMs <= first.tstamp) return identity;
  if (!(lastSec > firstSec)) return identity;

  const a = (lastSec - firstSec) / (lastMs - first.tstamp);
  return { a, b: firstSec - a * first.tstamp };
}

/** 재생 초 → 타임맵 ms. `timeMapping`의 역이다 */
export function timemapMsAt(mapping: TimeMapping, sec: number): number {
  return mapping.a === 0 ? 0 : (sec - mapping.b) / mapping.a;
}

/**
 * 그 시각에 울리고 있는 음표 id들.
 *
 * 타임맵은 시각 오름차순이라 **이분 탐색으로 그 시각 이하의 마지막 줄**을 찾고,
 * 거기까지의 `on`에서 `off`를 뺀 것이 답이다. 매 프레임 처음부터 훑으면 4분 곡의
 * 수천 줄을 60Hz로 다시 세게 된다.
 *
 * 그래서 누적은 `activeTracks`가 미리 만들어 두고 여기서는 고르기만 한다.
 */
export function activeIdsAt(
  tracks: readonly (readonly string[])[],
  timemap: readonly TimemapEntry[],
  ms: number,
): readonly string[] {
  if (!timemap.length) return [];
  let low = 0;
  let high = timemap.length - 1;
  if (ms < timemap[0].tstamp) return [];
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (timemap[mid].tstamp <= ms) low = mid;
    else high = mid - 1;
  }
  return tracks[low] ?? [];
}

/**
 * 줄마다 "그때 울리고 있는 id 집합"을 미리 쌓아 둔다.
 *
 * 한 번 만들어 두면 매 프레임은 이분 탐색 한 번으로 끝난다. 타임맵이 안 바뀌는
 * 동안(악보 한 장) 이 배열도 안 바뀐다.
 */
export function activeTracks(
  timemap: readonly TimemapEntry[],
): readonly (readonly string[])[] {
  const out: string[][] = [];
  let live: string[] = [];
  for (const entry of timemap) {
    if (entry.off?.length) {
      const gone = new Set(entry.off);
      live = live.filter((id) => !gone.has(id));
    }
    if (entry.on?.length) live = [...live, ...entry.on];
    out.push(live);
  }
  return out;
}

/**
 * 두 음짜리 그림용. 한 줄에 다 들어가므로 줄바꿈을 끄고 여백을 줄인다.
 *
 * 여백을 줄이는 것은 가로로 지나치게 납작해지는 것을 막기 위해서다. 한 마디에
 * 음표 두 개뿐이라 기본 여백(50)이면 종횡비가 5:1을 넘는다.
 */
const INTERVAL_OPTIONS = {
  pageWidth: 1500,
  scale: 60,
  adjustPageHeight: true,
  adjustPageWidth: true,
  header: "none",
  footer: "none",
  breaks: "none",
  pageMarginLeft: 10,
  pageMarginRight: 10,
  pageMarginTop: 10,
  pageMarginBottom: 10,
  svgViewBox: true,
};

/**
 * 여러 마디짜리 악보용(전사 결과).
 *
 * **`adjustPageWidth`를 켜면 안 된다** — 줄바꿈 없이 한 줄로 늘어나서 2분짜리
 * 멜로디가 폭 수만 픽셀의 SVG가 된다. 대신 폭을 고정하고 `breaks: "auto"`로
 * 여러 단에 흘린다. 높이는 넉넉히 두고 `adjustPageHeight`로 잘라 **한 페이지에
 * 전부 담는다** — `renderToSVG(1)`이 1쪽만 주므로 페이지가 갈리면 뒤가 사라진다.
 */
const SCORE_OPTIONS = {
  // 한 단에 마디를 적게 넣을수록 커 보인다 — SVG는 폭에 맞춰 늘어나므로
  // 여기 폭이 곧 확대율의 역수다(실측: 2100이면 음표가 읽기 버겁다)
  pageWidth: 1400,
  pageHeight: 60_000,
  scale: 50,
  adjustPageHeight: true,
  adjustPageWidth: false,
  header: "none",
  footer: "none",
  breaks: "auto",
  pageMarginLeft: 40,
  pageMarginRight: 40,
  pageMarginTop: 20,
  pageMarginBottom: 20,
  svgViewBox: true,
};

/**
 * 인쇄용 — **화면용과 정반대다.**
 *
 * `SCORE_OPTIONS`는 `renderToSVG(1)`밖에 안 부르므로 높이를 6만으로 두고 한 쪽에
 * 다 담는다. 인쇄는 그러면 안 된다 — 쪽 크기로 잘라 `getPageCount()`만큼 뽑는다.
 *
 * **`scale`은 인쇄본에 아무 영향이 없다**(실측). 그 값은 출력 SVG의 viewBox 크기만
 * 바꾸는 순수 확대이고 배치는 그대로다 — 40·50·60·75로 훑었더니 네 번 다 쪽당
 * 12단 71마디로 **똑같았다.** 인쇄 CSS가 SVG를 종이에 맞춰 늘이므로 그 확대는
 * 상쇄된다. 음표 크기를 정하는 것은 **쪽 크기(MEI 단위)** 하나뿐이다.
 *
 * 그래서 A4 비율(1:1.414)을 지키면서 쪽을 좁혔다. 실측(100마디 멜로디):
 *
 * | pageWidth | 단당 마디 | 쪽당 단 | 쪽 수 |
 * |---|---|---|---|
 * | 2100 (실제 A4 mm) | 6 | 12 | 2 — 읽기 버겁다 |
 * | **1600** | **4** | **8~9** | **3** |
 * | 1400 | 3.5 | 7 | 5 |
 * | 1200 | 3 | 6 | 6 — 너무 크다 |
 *
 * 단당 4마디는 성악 악보의 관례이고, 그 자리가 1600이다.
 *
 * `header`·`footer`를 `auto`로 두는 것은 인쇄본에서만 값이 있다 — 제목과 쪽
 * 번호가 붙는다(실측: MusicXML의 제목이 1쪽 머리에 그대로 나온다). 화면 악보는
 * 카드 안에 이미 제목이 있어 껐다.
 */
const PRINT_OPTIONS = {
  pageWidth: 1600,
  pageHeight: 2263, // 1600 × 297/210 — A4 비율
  scale: 100,
  adjustPageHeight: false,
  adjustPageWidth: false,
  header: "auto",
  footer: "auto",
  breaks: "auto",
  pageMarginLeft: 100,
  pageMarginRight: 100,
  pageMarginTop: 100,
  pageMarginBottom: 100,
  svgViewBox: true,
};

/**
 * verovio 툴킷 하나를 재사용한다. WASM 초기화 비용이 있으니 앱당 하나만 만든다.
 * `ScoreRenderer.load()`는 몇 번을 불러도 같은 약속을 돌려준다.
 */
export class ScoreRenderer {
  private static instance: Promise<ScoreRenderer> | null = null;
  private readonly tk: Toolkit;
  private constructor(tk: Toolkit) {
    this.tk = tk;
  }

  static load(): Promise<ScoreRenderer> {
    if (!ScoreRenderer.instance) {
      // 실패한 약속을 캐시해두면 일시적 오류(네트워크 등)가 영구 장애가 된다.
      // 실패하면 캐시를 비워 다음 문제에서 다시 시도하게 한다.
      const attempt = (async () => {
        const [{ default: createModule }, { VerovioToolkit }] = await Promise.all([
          import("verovio/wasm"),
          import("verovio/esm"),
        ]);
        const module = await createModule();
        const tk: Toolkit = new VerovioToolkit(module);
        return new ScoreRenderer(tk);
      })();
      attempt.catch(() => {
        ScoreRenderer.instance = null;
      });
      ScoreRenderer.instance = attempt;
    }
    return ScoreRenderer.instance;
  }

  /**
   * 툴킷 하나를 공유하므로 **옵션은 그릴 때마다 건다.** 로드 시점에 한 번만
   * 걸면 음정 그림과 전사 악보가 서로의 설정을 물려받는다.
   */
  private draw(musicXml: string, options: Record<string, unknown>): string {
    this.tk.setOptions(options);
    if (!this.tk.loadData(musicXml)) {
      throw new Error("verovio가 MusicXML을 읽지 못했습니다");
    }
    return this.tk.renderToSVG(1);
  }

  /** 여러 마디짜리 악보. 전사 결과가 이 경로로 온다 */
  render(musicXml: string): string {
    return this.draw(musicXml, SCORE_OPTIONS);
  }

  /**
   * 화면 악보 + 재생 커서용 타임맵을 **한 번에** 낸다.
   *
   * 나눠 부르면 안 된다. 툴킷이 앱에 하나뿐이라 그 사이에 음정 그림이나 인쇄
   * 렌더가 끼면 `renderToTimemap()`이 **다른 자료의 타임맵**을 돌려준다 —
   * 오류 없이 커서만 엉뚱한 곳을 가리키는, 눈으로 보기 전에는 모르는 종류다.
   */
  renderScore(musicXml: string): RenderedScore {
    const svg = this.draw(musicXml, SCORE_OPTIONS);
    // 마디는 안 받는다 — 커서가 강조하는 것은 음표뿐이다
    const raw = this.tk.renderToTimemap({ includeMeasures: false });
    return { svg, timemap: Array.isArray(raw) ? (raw as TimemapEntry[]) : [] };
  }

  /**
   * 인쇄용 A4 쪽들. 브라우저 인쇄가 이걸 받아 PDF로 만든다.
   *
   * **verovio WASM 툴킷에는 `renderToPDF`가 없다**(C++ CLI에만 있다). 그래서
   * 쪽마다 SVG를 뽑아 인쇄에 넘기는데, 어차피 벡터라 품질 손실이 없고 PDF
   * 라이브러리를 새로 들이지 않아도 된다.
   */
  renderPages(musicXml: string): string[] {
    this.tk.setOptions(PRINT_OPTIONS);
    if (!this.tk.loadData(musicXml)) {
      throw new Error("verovio가 MusicXML을 읽지 못했습니다");
    }
    const count = this.tk.getPageCount();
    const pages: string[] = [];
    for (let page = 1; page <= count; page += 1) {
      pages.push(this.tk.renderToSVG(page));
    }
    return pages;
  }

  renderInterval(lower: Pitch, upper: Pitch, fifths = 0): string {
    return this.draw(
      harmonicIntervalMusicXml(lower, upper, fifths),
      INTERVAL_OPTIONS,
    );
  }

  /** 음 하나. 자리표는 그 음이 정한다(`clefFor`) */
  renderNote(pitch: Pitch, fifths = 0): string {
    return this.draw(singleNoteMusicXml(pitch, fifths), INTERVAL_OPTIONS);
  }

  /**
   * 나란한 온음표 한 줄(음계). `clefFrom`은 **자리표를 정할 기준**이라
   * 한 음씩 쌓아 그릴 때도 완성된 음계를 넘긴다.
   *
   * `INTERVAL_OPTIONS`를 그대로 쓴다 — `breaks: "none"` + `adjustPageWidth`라
   * 마디 여덟 개가 줄바꿈 없이 한 줄로 늘어난다.
   */
  renderMelody(
    pitches: readonly Pitch[],
    clefFrom: readonly Pitch[] = pitches,
    fifths = 0,
  ): string {
    return this.draw(melodicMusicXml(pitches, clefFrom, fifths), INTERVAL_OPTIONS);
  }

  /** 조표만 있는 빈 오선. ♯·♭이 붙는 자리와 순서는 verovio가 그린다 */
  renderKeySignature(fifths: number): string {
    return this.draw(keySignatureMusicXml(fifths), INTERVAL_OPTIONS);
  }
}
