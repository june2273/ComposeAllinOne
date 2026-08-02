/**
 * 디자인 시스템 라이브러리 빌드.
 *
 * 앱 빌드(vite.config.ts)와 별개다. `src/ds/`의 표시 전용 부품만 컴파일해
 * `dist-ds/`에 내보낸다 — claude.ai/design이 이 결과물을 읽어 우리 부품으로
 * 화면을 만든다.
 *
 *   npm run build:ds
 *
 * React는 번들에 넣지 않는다(external). 디자인 도구가 자기 React를 쓴다.
 */
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-ds",
    emptyOutDir: true,
    cssCodeSplit: false,
    // public/의 앱용 자산이 라이브러리 결과물에 섞이지 않게 한다
    copyPublicDir: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/ds/index.tsx"),
      name: "MusicDS",
      formats: ["es"],
      fileName: () => "index.js",
      cssFileName: "index",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
    },
  },
});
