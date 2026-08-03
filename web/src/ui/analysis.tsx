/**
 * 분석 콘솔 — 파일 하나를 열면 BPM·박자·조성이 나온다.
 *
 * **연습 세션이 아니다.** 점수도 제한시간도 문제도 없으므로 `Session`·
 * `useSession`을 쓰지 않는다(카탈로그의 `Kind.Tool`). 상태는 넷뿐이라 훅을
 * 따로 만들지 않고 이 파일 안에서 끝낸다 — 늘어나면 그때 떼어낸다.
 *
 * 분석 자체는 `core/analysis`, 파일 디코딩과 워커는 `platform/analyze`가
 * 한다. 여기 있는 것은 **무엇을 어떻게 보여줄 것인가**뿐이다.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  accentPattern,
  confidenceTier,
  type AnalysisProgress,
  type AnalysisReport,
} from "../core/analysis";
import {
  Button,
  FilePicker,
  Metric,
  MetricGrid,
  PageHeading,
  ProgressBar,
  SpecSection,
  Stack,
} from "../ds";
import { analyzeFile } from "../platform/analyze";

/** 지금 못 하는 것들. 카탈로그의 `requires`와 달리 **사용자가 읽을 문장**이다. */
const NOT_YET = [
  "스템 분리(보컬·드럼·베이스) — 무거운 모델이 필요하다",
  "코드 진행 — 비트 동기 크로마까지는 이미 있고 인식 모델이 없다",
  "멜로디 피치 커브 · MIDI · 악보 변환",
  "변박 · 전조 · 변속 — 곡 전체를 한 덩어리로 본다. 구간을 나누려면 구조 분석이 먼저다",
];

type State =
  | { name: "idle" }
  | { name: "running"; file: string; progress: AnalysisProgress }
  | { name: "done"; file: string; report: AnalysisReport }
  | { name: "error"; file: string; message: string };

function seconds(value: number): string {
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

/** 정수배 후보는 신뢰도가 아니라 **읽는 방식**의 문제다. 함께 보여준다. */
function tempoDetail(report: AnalysisReport): string {
  const others = report.tempo.candidates
    .filter((c) => Math.abs(c.bpm / report.tempo.bpm - 1) > 0.02)
    .slice(0, 2)
    .map((c) => c.bpm.toFixed(0));
  const parts = [`비트 ${report.beats.length}개`, `고름 ${report.tempo.steadiness.toFixed(2)}`];
  if (others.length) parts.push(`다른 읽기 ${others.join(" · ")}`);
  return parts.join(" · ");
}

function meterDetail(report: AnalysisReport): string {
  const parts = [accentPattern(report.meter.beatsPerBar), `${report.downbeats.length}마디`];
  if (report.meter.shuffle) parts.push("셔플");
  else if (report.meter.subdivision === "compound") parts.push("3분할(6/8 계열)");
  return parts.join(" · ");
}

function keyDetail(report: AnalysisReport): string {
  const second = report.key.candidates[1];
  const parts = second ? [`다음 후보 ${second.name}`] : [];
  if (Math.abs(report.tuningCents) >= 8) {
    parts.push(`조율 ${report.tuningCents > 0 ? "+" : ""}${report.tuningCents.toFixed(0)}센트`);
  }
  return parts.join(" · ");
}

/** 신뢰도가 낮으면 확정처럼 보이지 않게 한다(사양서 §6). */
function note(confidence: number): string | undefined {
  return confidenceTier(confidence) === "low" ? "확인 필요" : undefined;
}

export function AnalysisPage({
  analyze = analyzeFile,
}: {
  /** 테스트가 가짜 분석기를 넣는 자리. 앱에서는 넘기지 않는다 */
  analyze?: typeof analyzeFile;
}) {
  const [state, setState] = useState<State>({ name: "idle" });

  // 화면을 떠나면 돌던 분석을 끊는다. 안 끊으면 워커가 끝까지 돌고, 되돌아와
  // 새 파일을 열면 무거운 DSP가 두 개 동시에 돈다.
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);

  const onFile = useCallback(
    (file: File) => {
      running.current?.abort();
      const controller = new AbortController();
      running.current = controller;
      setState({
        name: "running",
        file: file.name,
        progress: { stage: "시작", ratio: 0 },
      });
      analyze(
        file,
        (progress) =>
          // 늦게 도착한 진행률이 결과 화면을 되돌리지 않게 한다
          setState((current) =>
            current.name === "running" && current.file === file.name
              ? { ...current, progress }
              : current,
          ),
        undefined,
        controller.signal,
      ).then(
        (report) => {
          if (controller.signal.aborted) return;
          setState({ name: "done", file: file.name, report });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            name: "error",
            file: file.name,
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
    },
    [analyze],
  );

  const report = state.name === "done" ? state.report : null;

  return (
    <Stack>
      <PageHeading
        title="분석 콘솔"
        subtitle="오디오 파일을 열면 템포·박자·조성을 뽑는다. 전부 이 브라우저 안에서 돈다 — 파일이 어디로도 올라가지 않는다."
      />

      <FilePicker
        label={state.name === "running" ? "분석 중…" : "오디오 파일 열기"}
        hint="WAV 권장 · MP3 · M4A도 읽는다. 끌어다 놓아도 된다"
        accept="audio/*"
        disabled={state.name === "running"}
        onFile={onFile}
      />

      {state.name === "running" && (
        <ProgressBar ratio={state.progress.ratio} label={state.progress.stage} />
      )}

      {state.name === "error" && (
        <p className="muted">
          {state.file} — 분석하지 못했습니다: {state.message}
        </p>
      )}

      {report && (
        <>
          <p className="muted">
            {state.name === "done" ? state.file : ""} · {seconds(report.durationSec)}
          </p>
          <MetricGrid>
            <Metric
              label="BPM"
              value={report.tempo.bpm > 0 ? report.tempo.bpm.toFixed(1) : "—"}
              detail={tempoDetail(report)}
              confidence={confidenceTier(report.tempo.confidence)}
              note={note(report.tempo.confidence)}
            />
            <Metric
              label="박자"
              value={report.meter.value}
              detail={meterDetail(report)}
              confidence={confidenceTier(report.meter.confidence)}
              note={note(report.meter.confidence)}
            />
            <Metric
              label="조성"
              value={report.key.name}
              detail={keyDetail(report)}
              confidence={confidenceTier(report.key.confidence)}
              note={note(report.key.confidence)}
            />
          </MetricGrid>
          <Button onClick={() => setState({ name: "idle" })}>다른 파일 분석</Button>
        </>
      )}

      <SpecSection title="아직 안 되는 것" items={NOT_YET} />
    </Stack>
  );
}
