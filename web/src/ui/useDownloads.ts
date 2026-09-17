/**
 * 파일로 내려받을 것들을 blob 주소로 바꾼다. **두 화면이 함께 쓴다** —
 * 전사 패널(MIDI·MusicXML·`.svp`)과 드럼 칸(드럼 MIDI 셋).
 *
 * ## 왜 `useMemo`가 아니라 이펙트인가
 *
 * StrictMode가 팩토리를 두 번 부르는데 **blob 주소는 GC가 못 거둔다** — 파일을
 * 바꿔 가며 여러 번 돌리면 그때마다 수십 KB가 그대로 남는다. 언제 버려도 되는지
 * 를 정확히 아는 것은 이펙트의 정리 함수뿐이다(오디오 백엔드에서 이미 데인
 * 자리다 — CLAUDE.md의 StrictMode 절).
 *
 * ## 호출부가 지켜야 할 것 하나
 *
 * **`sources` 배열을 `useMemo`로 들고 있어야 한다.** 매 렌더 새 배열을 넘기면
 * 주소를 렌더마다 다시 만들고 버린다. 내용이 아니라 **참조**로 비교하는 이유는
 * 크기가 같은 다른 곡이 옛 주소를 물려받는 사고를 막기 위해서다.
 */

import { useEffect, useState } from "react";

export interface DownloadSource {
  /** 버튼에 적히는 말 */
  label: string;
  /** 저장될 파일 이름. 목록의 React 키이기도 하다 */
  filename: string;
  data: BlobPart;
  /** MIME. 브라우저가 무엇으로 저장할지 정한다 */
  type: string;
}

/** `ds.DownloadList`가 받는 모양 그대로 */
export interface Download {
  label: string;
  href: string;
  filename: string;
}

export function useDownloads(sources: readonly DownloadSource[]): Download[] {
  const [items, setItems] = useState<Download[]>([]);

  useEffect(() => {
    const urls: string[] = [];
    setItems(
      sources.map((source) => {
        const href = URL.createObjectURL(
          new Blob([source.data], { type: source.type }),
        );
        urls.push(href);
        return { label: source.label, href, filename: source.filename };
      }),
    );
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [sources]);

  return items;
}
