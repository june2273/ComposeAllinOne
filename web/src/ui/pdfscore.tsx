/**
 * PDF 악보 뷰어 — 가지고 있는 악보 파일을 이 앱 안에서 본다.
 *
 * **브라우저 내장 뷰어에 맡긴다.** `pdfjs-dist`를 들이면 1MB가 넘고, 우리가
 * 얻는 것은 쪽 번호·확대를 앱이 통제하는 것뿐이다 — 지금은 "악보를 띄워 놓고
 * 연습한다"가 전부라 그 통제가 필요 없다. 재생 위치 동기화나 주석처럼 우리가
 * 그려야 하는 것이 생기면 그때 갈아끼울 자리가 여기 한 파일이다.
 *
 * **파일은 브라우저를 벗어나지 않는다.** blob URL은 이 탭 안에서만 유효하고
 * 어디에도 올라가지 않는다 — 분석 콘솔이 오디오를 사이드카로 보내는 것과 다르다.
 */

import { useEffect, useState } from "react";

import {
  Button,
  FilePicker,
  Hint,
  PageHeading,
  SpecSection,
  Stack,
} from "../ds";

/** 이 화면이 아직 안 하는 것. 카탈로그의 `requires`와 같은 방침이다 */
const NOT_YET = [
  "여러 악보를 한 번에 열어 두고 넘나들기 — 지금은 한 번에 하나다",
  "주석·형광펜 — 파일을 고쳐 써야 하므로 저장 자리가 먼저 필요하다",
  "전사 악보와 나란히 보기 — 분석 콘솔의 악보는 그 화면 안에 있다",
  "재생 위치 따라가기 — 브라우저 내장 뷰어라 쪽 번호를 앱이 모른다",
];

function looksLikePdf(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

function sizeText(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function PdfScorePage() {
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  /**
   * blob URL은 **이펙트에서 만들고 정리에서 되돌린다.**
   *
   * `useMemo`로 만들면 StrictMode가 팩토리를 두 번 불러 URL이 하나 새고, 무엇보다
   * 언제 `revokeObjectURL`을 부를지 알 수 없다 — 전사 패널의 내려받기 목록이
   * 같은 이유로 이펙트를 쓴다.
   */
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [file]);

  const onFile = (picked: File) => {
    if (!looksLikePdf(picked)) {
      setRejected(`${picked.name}은(는) PDF가 아니다.`);
      return;
    }
    setRejected(null);
    setFile(picked);
  };

  return (
    <Stack>
      <PageHeading
        title="PDF 악보"
        subtitle="가지고 있는 악보를 열어 본다. 파일은 브라우저 밖으로 나가지 않는다."
      />

      {!file && (
        <>
          <FilePicker
            label="PDF 악보를 끌어다 놓거나 눌러서 고른다"
            hint="이 탭 안에서만 열린다 — 서버로 보내지 않는다"
            accept="application/pdf,.pdf"
            onFile={onFile}
          />
          {rejected && <p className="muted">{rejected}</p>}
          <Hint>
            전사한 멜로디를 PDF로 만들려면 <strong>분석 콘솔</strong>에서 오디오를
            연 뒤 악보 아래의 “PDF로 내보내기”를 누른다.
          </Hint>
        </>
      )}

      {file && (
        <div className="pdfview">
          <div className="pdfview__head">
            <span className="pdfview__name">{file.name}</span>
            <span className="muted">{sizeText(file.size)}</span>
            <span className="spacer" />
            {/*
              내장 뷰어가 못 그리는 환경이 있다(모바일 사파리는 iframe 안 PDF를
              제대로 안 띄운다). 그래서 이 링크는 **늘 보인다** — 안 되는 것을
              확인한 뒤에야 탈출구를 찾게 만들 이유가 없다.
            */}
            {url && (
              <a
                className="button"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                새 창에서 열기
              </a>
            )}
            <Button onClick={() => setFile(null)}>다른 PDF 열기</Button>
          </div>
          {/*
            **sandbox를 걸지 않는다.** 브라우저 내장 PDF 뷰어는 스크립트를 쓰고
            (파이어폭스는 pdf.js가 통째로 스크립트다), 그걸 허용하면서 same-origin도
            허용하면 sandbox가 사실상 없는 것과 같다. 여기서 여는 것은 사용자가
            방금 자기 디스크에서 고른 파일이고 blob URL이라 우리 출처 밖으로
            나가지도 않는다.
          */}
          {url && (
            // oxlint-disable-next-line react/iframe-missing-sandbox
            <iframe className="pdfview__frame" src={url} title={file.name} />
          )}
        </div>
      )}

      <SpecSection title="아직 안 되는 것" items={NOT_YET} />
    </Stack>
  );
}
