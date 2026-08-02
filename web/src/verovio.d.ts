/**
 * verovio는 타입 선언을 배포하지 않는다. 우리가 실제로 쓰는 두 진입점만
 * 최소한으로 선언한다 — score.ts의 `Toolkit` 인터페이스가 실질적인 계약이다.
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
  }
}
