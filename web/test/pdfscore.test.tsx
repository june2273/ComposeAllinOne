/**
 * PDF 악보 뷰어 — **결선만 본다.**
 *
 * PDF를 실제로 그리는 것은 브라우저 내장 뷰어라 jsdom에서 검증할 수 없다.
 * 여기서 못박는 것은 그 앞뒤다: 고른 파일이 blob URL이 되어 iframe에 걸리는가,
 * PDF가 아닌 것을 거절하는가, 그리고 **URL을 되돌려주는가**.
 *
 * 마지막이 제일 중요하다 — blob URL을 안 걷으면 그 파일이 탭이 닫힐 때까지
 * 메모리에 남는다. 악보 PDF는 수십 MB짜리도 있다.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PdfScorePage } from "../src/ui/pdfscore";

function pdf(name = "악보.pdf") {
  return new File([new Uint8Array([37, 80, 68, 70])], name, {
    type: "application/pdf",
  });
}

/** FilePicker의 숨은 input에 파일을 떨어뜨린다 */
function drop(file: File) {
  const input = document.querySelector<HTMLInputElement>(".picker__input")!;
  act(() => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

function frame() {
  return document.querySelector<HTMLIFrameElement>(".pdfview__frame");
}

describe("PDF 악보 뷰어", () => {
  // jsdom에는 blob URL이 없다. 만든 것과 되돌린 것을 셀 수 있게 갈아끼운다.
  let made: string[] = [];
  let revoked: string[] = [];

  beforeEach(() => {
    made = [];
    revoked = [];
    let n = 0;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:fake/${n++}`;
      made.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  test("파일을 고르기 전에는 고르는 자리만 있다", () => {
    render(<PdfScorePage />);
    expect(document.querySelector(".picker")).toBeTruthy();
    expect(frame()).toBeNull();
  });

  test("PDF를 고르면 blob URL이 iframe에 걸린다", () => {
    render(<PdfScorePage />);
    drop(pdf());
    const el = frame();
    expect(el).toBeTruthy();
    expect(el!.getAttribute("src")).toBe(made.at(-1));
    expect(screen.getByText("악보.pdf")).toBeTruthy();
  });

  /**
   * 내장 뷰어가 안 되는 환경(모바일 사파리)의 탈출구. **늘 보여야 한다** —
   * 안 되는 것을 확인한 뒤에야 찾게 만들 이유가 없다.
   */
  test("새 창에서 열기 링크가 함께 나온다", () => {
    render(<PdfScorePage />);
    drop(pdf());
    const link = screen.getByRole("link", { name: /새 창에서 열기/ });
    expect(link.getAttribute("href")).toBe(made.at(-1));
    expect(link.getAttribute("target")).toBe("_blank");
  });

  test("PDF가 아니면 거절하고 URL도 만들지 않는다", () => {
    render(<PdfScorePage />);
    drop(new File([new Uint8Array([1])], "song.wav", { type: "audio/wav" }));
    expect(frame()).toBeNull();
    expect(made).toHaveLength(0);
    expect(screen.getByText(/PDF가 아니다/)).toBeTruthy();
  });

  test("확장자만 .pdf여도 받는다 — type이 비는 브라우저가 있다", () => {
    render(<PdfScorePage />);
    drop(new File([new Uint8Array([1])], "손으로적은악보.pdf", { type: "" }));
    expect(frame()).toBeTruthy();
  });

  test("다른 PDF를 열면 앞의 URL을 되돌린다", () => {
    render(<PdfScorePage />);
    drop(pdf("첫째.pdf"));
    const first = made.at(-1)!;
    act(() => {
      screen.getByRole("button", { name: /다른 PDF 열기/ }).click();
    });
    drop(pdf("둘째.pdf"));
    expect(revoked).toContain(first);
    expect(frame()!.getAttribute("src")).toBe(made.at(-1));
  });

  test("화면을 떠나면 URL을 되돌린다", () => {
    const { unmount } = render(<PdfScorePage />);
    drop(pdf());
    const url = made.at(-1)!;
    unmount();
    expect(revoked).toContain(url);
  });

  /**
   * StrictMode는 이펙트를 두 번 돌린다. `useMemo`로 URL을 만들었다면 여기서
   * 하나가 새고 아무도 눈치채지 못한다 — 전사 패널이 같은 이유로 이펙트를 쓴다.
   */
  test("StrictMode에서 만든 URL이 새지 않는다", () => {
    const { unmount } = render(
      <StrictMode>
        <PdfScorePage />
      </StrictMode>,
    );
    drop(pdf());
    unmount();
    expect(made.length).toBeGreaterThan(0);
    expect(new Set(revoked)).toEqual(new Set(made));
  });
});
