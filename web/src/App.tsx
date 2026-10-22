/**
 * 앱 셸 — 도구 둘(분석 콘솔 · PDF 악보)과 설정 창.
 *
 * 화성학·청음 연습은 Chord-Tutor 저장소로 갈라 나갔다. 여기 남은 것은 연습
 * 세션이 아니라 도구라서 문제 큐·옵션·결과 화면을 지나지 않는다.
 */

import { useRef, useState } from "react";

import type { AudioBackend } from "./core/audio";
import { makeAudioBackend } from "./platform/piano";
import { Button, Card, NavBar, PageHeading, Stack } from "./ds";
import { AnalysisPage } from "./ui/analysis";
import { PdfScorePage } from "./ui/pdfscore";
import { SettingsDialog } from "./ui/settings";
import { useTheme } from "./ui/useTheme";
import "./ui/styles/app.css";

const TOOLS = {
  console: {
    title: "분석 콘솔",
    summary: "오디오 파일 하나를 열면 분석과 변환을 한자리에서.",
  },
  pdf: {
    title: "PDF 악보",
    summary: "가지고 있는 PDF 악보를 열어 본다. 파일은 브라우저 밖으로 나가지 않는다.",
  },
} as const;
type Tool = keyof typeof TOOLS;

export default function App() {
  // **useMemo를 쓰면 안 된다**(실측). StrictMode가 팩토리를 두 번 불러
  // AudioContext와 샘플 1.3MiB를 두 벌 잡는다. ref는 두 번째 호출이 없다.
  const audioRef = useRef<AudioBackend | null>(null);
  audioRef.current ??= makeAudioBackend();
  const audio = audioRef.current;
  const [tool, setTool] = useState<Tool | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { theme, dark, setTheme } = useTheme();

  return (
    <div className="app">
      <NavBar path={tool ? [TOOLS[tool].title] : []} onBack={() => setTool(null)} />

      {tool === null && (
        <Stack>
          <PageHeading title="무엇을 열까요" center />
          {(Object.keys(TOOLS) as Tool[]).map((id) => (
            <Card
              key={id}
              title={TOOLS[id].title}
              summary={TOOLS[id].summary}
              onClick={() => setTool(id)}
            />
          ))}
          <div className="home__footer">
            <Button onClick={() => setSettingsOpen(true)}>설정</Button>
          </div>
        </Stack>
      )}

      {tool === "console" && <AnalysisPage audio={audio} />}
      {tool === "pdf" && <PdfScorePage />}

      {settingsOpen && (
        <SettingsDialog
          theme={theme}
          dark={dark}
          onTheme={setTheme}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
