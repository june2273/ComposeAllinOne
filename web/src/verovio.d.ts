/**
 * verovio는 타입 선언을 배포하지 않는다. 우리가 실제로 쓰는 두 진입점만
 * 최소한으로 선언한다. **이 파일이 유일한 선언이다** — `core/score.ts`가
 * `VerovioToolkit`을 `import type`으로 그대로 가져다 쓴다. 메서드를 하나 더
 * 쓰게 되면 여기에만 적으면 된다.
 */
declare module "verovio/wasm" {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}
declare module "verovio/esm" {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    renderToSVG(page: number): string;
    /** 지금 올라와 있는 자료가 몇 쪽인가. 인쇄가 쪽마다 renderToSVG를 부른다 */
    getPageCount(): number;
    /** 음표 id ↔ 시각(ms). 재생 커서가 쓴다. 반환값은 이미 파싱된 JSON이다 */
    renderToTimemap(options?: Record<string, unknown>): unknown;
  }
}
