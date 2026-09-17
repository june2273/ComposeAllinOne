/**
 * 악보 인쇄 — **PDF를 만드는 유일한 경로.**
 *
 * PDF 라이브러리를 넣지 않았다. verovio의 WASM 툴킷에는 `renderToPDF`가 없어서
 * (C++ CLI 전용이다) 어차피 SVG를 우리가 PDF로 옮겨야 하는데, 그러자면
 * `pdf-lib`+`svg2pdf` 같은 수백 KB짜리 의존성과 라이선스 검토가 따라온다.
 * 브라우저의 "PDF로 저장"은 같은 SVG를 **벡터 그대로** 받아 가므로 품질이 같고
 * 비용이 0이다.
 *
 * **숨긴 iframe에 자체 문서를 쓴다.** 지금 문서에 인쇄용 컨테이너를 두고
 * `@media print`로 앱을 통째로 숨기는 방법도 있지만, 그러면 `app.css`가 인쇄본에
 * 그대로 걸린다 — 특히 `.staff svg svg { color: var(--color-text) }`(어두운 테마의
 * 흰 글씨)가 따라와서 **흰 종이에 흰 악보**가 나온다. iframe은 스타일이 완전히
 * 격리되고 `@page`도 우리가 통제한다.
 *
 * 악보 글리프는 verovio가 `<path>` 외곽선으로 박아 내므로 폰트를 심을 필요가 없다.
 */

/** 인쇄 대화상자가 안 열렸거나 `onafterprint`이 안 올 때 iframe을 걷는 시각 */
const CLEANUP_MS = 60_000;

/**
 * 인쇄될 문서 전체. **내보내는 이유는 검증 때문이다** — 실제 인쇄는 대화상자를
 * 열어 자동화가 막히므로, 문서가 옳게 만들어졌는지는 이 문자열로 확인한다.
 */
export function printDocument(pages: readonly string[], title: string): string {
  const sheets = pages
    .map((svg) => `<section class="sheet">${svg}</section>`)
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  /*
    색을 명시한다. 앱의 테마 변수는 여기까지 오지 않지만, 명시해 두면 브라우저
    기본값이나 사용자 스타일시트가 어두운 색을 넣는 경우에도 종이가 흰색이다.

    쪽에는 정확히 A4를 준다. height를 auto로 두면 SVG의 종횡비가 A4와 0.01%만
    어긋나도 종이보다 몇 백분의 1mm 넘쳐서 쪽마다 빈 장이 하나씩 따라 나온다.
    폭과 높이를 둘 다 100%로 주면 SVG의 preserveAspectRatio(기본 meet)가 안에
    맞춰 넣고 가운데 정렬하므로, 넘치지도 찌그러지지도 않는다.

    (이 주석에 역따옴표를 쓰지 말 것 — 통째로 템플릿 문자열 안이라 문자열이
    거기서 끝나 버린다. 실측: 그래서 dev 서버가 파싱 오류로 안 떴다.)
  */
  .sheet {
    width: 210mm; height: 297mm; overflow: hidden;
    color: #000; background: #fff;
    break-after: page; page-break-after: always;
  }
  .sheet:last-child { break-after: auto; page-break-after: auto; }
  .sheet svg { display: block; width: 100%; height: 100%; }
</style></head><body>${sheets}</body></html>`;
}

function escapeHtml(text: string): string {
  return text.replaceAll(
    /[&<>"]/gu,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

/**
 * 쪽 SVG들을 인쇄 대화상자로 보낸다. 사용자가 "PDF로 저장"을 고르면 PDF가 된다.
 *
 * `title`이 곧 **기본 파일명이다** — 크롬의 PDF 저장이 문서 제목을 쓴다. 그래서
 * 곡 제목을 넣는다.
 */
export function printSheets(pages: readonly string[], title: string): void {
  if (!pages.length) return;

  const frame = document.createElement("iframe");
  // `display: none`이면 인쇄되지 않는 브라우저가 있다. 화면 밖으로 밀어낸다.
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.left = "-10000px";
  frame.style.top = "0";
  frame.style.width = "210mm";
  frame.style.height = "297mm";
  frame.style.border = "0";
  document.body.append(frame);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };

  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      remove();
      return;
    }
    // 사파리가 `onafterprint`을 안 쏠 때가 있어 타임아웃을 함께 건다.
    // 인쇄 대화상자가 열려 있는 동안 iframe을 걷으면 미리보기가 비므로 넉넉히 둔다.
    win.onafterprint = remove;
    setTimeout(remove, CLEANUP_MS);
    win.focus();
    win.print();
  };

  // `srcdoc`은 문서를 통째로 넘기므로 `document.write`의 타이밍 문제가 없다.
  frame.srcdoc = printDocument(pages, title);
}
