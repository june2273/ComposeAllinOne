/**
 * 악보 인쇄 — **문서가 옳게 만들어지는가.**
 *
 * 실제 인쇄는 대화상자를 열어 자동화가 거기서 멈춘다(실측: 브라우저에서
 * `contentWindow.print()`를 부르니 세션이 30초 타임아웃으로 끊겼다). 그래서
 * `printSheets`는 문서 만들기(`printDocument`)와 띄우기를 갈라 두고, 검증은
 * 앞쪽에 건다.
 *
 * 여기서 못박는 것 셋: 쪽이 갈리는가, 흰 종이·검은 잉크가 명시되는가,
 * 제목이 안전하게 들어가는가(그게 곧 PDF 기본 파일명이다).
 */
import { describe, expect, test } from "vitest";

import { printDocument, printSheets } from "../src/platform/print";

const PAGE = (n: number) => `<svg id="p${n}"><g/></svg>`;

describe("printDocument", () => {
  test("쪽마다 sheet 하나 — 쪽 나눔이 여기서 생긴다", () => {
    const html = printDocument([PAGE(1), PAGE(2), PAGE(3)], "곡");
    expect(html.match(/class="sheet"/g)).toHaveLength(3);
    expect(html).toContain('<svg id="p1">');
    expect(html).toContain('<svg id="p3">');
    expect(html).toContain("page-break-after: always");
  });

  /**
   * 화면 악보는 `app.css`가 verovio의 `color="black"`을 테마 색으로 덮는다.
   * 그 규칙이 인쇄본까지 따라오면 **어두운 테마에서 흰 종이에 흰 악보**가 나온다.
   * iframe이 그것을 막고, 이 단언이 막았는지를 못박는다.
   */
  test("흰 종이·검은 잉크를 명시한다 — 어두운 테마가 따라오지 않게", () => {
    const html = printDocument([PAGE(1)], "곡");
    expect(html).toContain("background: #fff");
    expect(html).toContain("color: #000");
    // 테마 변수가 새어 들어오지 않았는가
    expect(html).not.toContain("var(--");
  });

  test("A4를 쪽 크기로 못박고 SVG를 그 안에 맞춘다", () => {
    const html = printDocument([PAGE(1)], "곡");
    expect(html).toContain("@page { size: A4; margin: 0; }");
    expect(html).toContain("width: 210mm; height: 297mm");
    // height를 auto로 두면 종횡비가 조금만 어긋나도 빈 장이 따라 나온다
    expect(html).toContain("width: 100%; height: 100%");
  });

  /** 크롬의 "PDF로 저장"이 문서 제목을 기본 파일명으로 쓴다 */
  test("제목이 <title>에 들어간다", () => {
    expect(printDocument([PAGE(1)], "곡E — 멜로디 악보")).toContain(
      "<title>곡E — 멜로디 악보</title>",
    );
  });

  test("제목의 특수문자를 이스케이프한다", () => {
    // 파일 이름이 곡 제목이 되므로 사용자가 지은 이름이 그대로 들어온다
    const html = printDocument([PAGE(1)], '<script>"x" & y');
    expect(html).toContain("<title>&lt;script&gt;&quot;x&quot; &amp; y</title>");
    expect(html).not.toContain("<title><script>");
  });
});

describe("printSheets", () => {
  test("쪽이 없으면 아무것도 만들지 않는다", () => {
    printSheets([], "빈 곡");
    expect(document.querySelector('iframe[aria-hidden="true"]')).toBeNull();
  });

  test("숨긴 iframe을 붙이고 문서를 넘긴다", () => {
    printSheets([PAGE(1), PAGE(2)], "곡");
    const frame = document.querySelector<HTMLIFrameElement>(
      'iframe[aria-hidden="true"]',
    );
    expect(frame).toBeTruthy();
    // display:none이면 인쇄가 안 되는 브라우저가 있어 화면 밖으로 민다
    expect(frame!.style.display).not.toBe("none");
    expect(frame!.style.left).toBe("-10000px");
    expect(frame!.srcdoc).toContain('<svg id="p2">');
    frame!.remove();
  });
});
