import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sidecar } from './vite-sidecar.ts'

// https://vite.dev/config/
export default defineConfig({
  // `sidecar()`는 개발 서버가 뜰 때 분석 사이드카(server/)를 함께 띄운다 —
  // 없으면 안내만 하고 넘어가고, vite가 죽을 때 함께 죽는다
  plugins: [react(), sidecar()],
})
