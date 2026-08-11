import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, readTheme } from "./platform/theme";

// **React보다 먼저 건다.** 훅 안에서만 걸면 첫 렌더가 OS 테마로 그려졌다가
// 바뀌어 화면이 한 번 번쩍인다.
applyTheme(readTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
