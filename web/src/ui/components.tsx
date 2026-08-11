/**
 * 도메인과 디자인 시스템을 잇는 얇은 층.
 *
 * `src/ds/`의 부품은 도메인을 모른다(원시 값만 받는다). 여기서 `Pitch`를
 * SVG 문자열로 바꾸는 것처럼 **번역만** 하고, 생김새는 전혀 다루지 않는다.
 */

import { useEffect, useRef, useState } from "react";

import { StaffFigure } from "../ds";
import { ScoreRenderer } from "../core/score";
import type { Pitch } from "../core/theory";

/**
 * 두 음을 오선지로.
 *
 * verovio WASM은 처음 쓸 때 한 번 로드되고(수 MB), 그 전에는 음이름으로
 * 대체한다. 악보가 없어도 문제는 계속 풀 수 있어야 한다.
 */
export function Staff({ lower, upper }: { lower: Pitch; upper: Pitch }) {
  const [svg, setSvg] = useState<string | null>(null);
  const key = `${lower.name}-${upper.name}`;
  const latest = useRef(key);

  useEffect(() => {
    latest.current = key;
    let cancelled = false;
    setSvg(null);
    ScoreRenderer.load()
      .then((renderer) => {
        if (cancelled || latest.current !== key) return;
        setSvg(renderer.renderInterval(lower, upper));
      })
      .catch((err) => {
        console.error("악보 렌더 실패:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [key, lower, upper]);

  return (
    <StaffFigure svg={svg} fallback={`${lower.name}   ${upper.name}`} />
  );
}
