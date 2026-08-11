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

import { ACCIDENTAL_XML, type Pitch } from "./theory";

/** 이 음보다 낮으면 낮은음자리표가 읽기 편하다 */
export const BASS_CLEF_BELOW = 60; // C4

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

/** 두 음을 겹쳐 찍은 한 마디짜리 MusicXML. */
export function harmonicIntervalMusicXml(
  a: Pitch,
  b: Pitch,
  fifths = 0,
): string {
  const [lower, upper] = a.midi <= b.midi ? [a, b] : [b, a];
  const treble = upper.midi >= BASS_CLEF_BELOW;
  const [sign, line] = treble ? ["G", 2] : ["F", 4];
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<score-partwise version="4.0"><part-list><score-part id="P1">' +
    // part-name을 비워 둔다. 내용을 넣으면 verovio가 악보 왼쪽에 성부
    // 이름을 찍어 두 음짜리 그림의 균형이 깨진다.
    "<part-name/></score-part></part-list>" +
    '<part id="P1"><measure number="1"><attributes>' +
    `<divisions>1</divisions><key><fifths>${fifths}</fifths></key>` +
    `<clef><sign>${sign}</sign><line>${line}</line></clef></attributes>` +
    noteXml(lower, false) +
    noteXml(upper, true) +
    "</measure></part></score-partwise>"
  );
}

interface Toolkit {
  setOptions(options: Record<string, unknown>): void;
  loadData(data: string): boolean;
  renderToSVG(page: number): string;
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
        const tk = new VerovioToolkit(module) as unknown as Toolkit;
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

  renderInterval(lower: Pitch, upper: Pitch, fifths = 0): string {
    return this.draw(
      harmonicIntervalMusicXml(lower, upper, fifths),
      INTERVAL_OPTIONS,
    );
  }
}
