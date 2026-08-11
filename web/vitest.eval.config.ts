/**
 * 평가 하니스 전용 설정 — **`npm test`와 일부러 갈라 둔다.**
 *
 * `vitest.config.ts`가 도는 255개는 몇 초 안에 끝나야 하고 브라우저를 흉내낸다
 * (jsdom). 이쪽은 정반대다 — 실곡 수백 MB를 읽고 곡당 수십 초가 걸리며,
 * 오히려 브라우저가 **없어야** 한다(파일을 직접 읽는다).
 *
 * TS를 그대로 돌리려고 vitest를 쓸 뿐, 이 파일이 실행하는 것은 테스트가
 * 아니라 도구다. 그래서 CI에 들어가지 않는다.
 *
 *     npx vitest run --config vitest.eval.config.ts
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["scripts/eval/**/*.eval.ts"],
    // 곡 하나를 분석하는 데만 수십 초가 걸린다. 기본 타임아웃으로는 못 끝낸다
    testTimeout: 30 * 60_000,
    hookTimeout: 60_000,
  },
});
