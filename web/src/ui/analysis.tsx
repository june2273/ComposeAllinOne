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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  accentPattern,
  confidenceTier,
  sectionsFromSegments,
  type AnalysisProgress,
  type AnalysisReport,
  type BeatGrid,
} from "../core/analysis";
import {
  Button,
  Fieldset,
  FilePicker,
  Metric,
  MetricGrid,
  PageHeading,
  ProgressBar,
  ShareBars,
  SpecSection,
  Stack,
} from "../ds";
import { type AudioBackend, NullSynth } from "../core/audio";
import { analyzeFile } from "../platform/analyze";
import { fetchBeats, type SidecarStructure } from "../platform/sidecar";
import { CHORDS_VISIBLE, ChordCard } from "./chords";
import { clock } from "./format";
import { StructureCard } from "./structure";
import {
  TranscriptionPanel,
  type TranscriptionPanelProps,
} from "./transcription";

/** 지금 못 하는 것들. 카탈로그의 `requires`와 달리 **사용자가 읽을 문장**이다. */
const NOT_YET = [
  "코드 진행 — 인식기는 있지만 정답을 찍어 둔 곡이 없어 정확도를 모른다. 재기 전까지 화면에서 닫아 두었다",
  "변박 · 전조 · 변속 — 섹션 경계는 나왔다. 구간마다 다시 재는 것이 다음이다",
  "섹션 라벨의 정확도 — 정답을 찍어 둔 곡이 아직 없다. 특히 pre-chorus는 모델이 아니라 우리 규칙이 붙인 것이다",
  "간주 · 솔로의 확인 — 그 구간에 노래가 있는지는 사이드카의 f0를 봐야 안다",
];

type State =
  | { name: "idle" }
  | { name: "running"; file: string; progress: AnalysisProgress }
  | { name: "done"; file: File; report: AnalysisReport }
  | { name: "error"; file: string; message: string };


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

/*
 * **`tempoWarning`이 2026-09-12에 사라졌다.** 축 B의 2박 신고(`meter.halfTempo`)를
 * BPM 칸 경고로 돌리던 줄인데, 축 B가 없어져 신고 자체가 안 나온다.
 * 사람이 배수를 고치는 길은 그대로 남아 있다 — 아래 후보 막대를 누르면 된다.
 */

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

/** 오디오 백엔드를 안 받았을 때. 소리만 안 날 뿐 화면은 그대로 돈다 */
const SILENT = new NullSynth();

/** 신뢰도가 낮으면 확정처럼 보이지 않게 한다(사양서 §6). */
function note(confidence: number): string | undefined {
  return confidenceTier(confidence) === "low" ? "확인 필요" : undefined;
}

export function AnalysisPage({
  analyze = analyzeFile,
  beats = fetchBeats,
  audio = SILENT,
  transcription,
}: {
  /** 테스트가 가짜 분석기를 넣는 자리. 앱에서는 넘기지 않는다 */
  analyze?: typeof analyzeFile;
  /** 테스트가 가짜 격자를 넣는 자리. 앱에서는 넘기지 않는다 */
  beats?: typeof fetchBeats;
  /**
   * 악보 재생용. **모듈 상수를 기본값으로 둔다** — `new NullSynth()`를 여기
   * 적으면 렌더마다 새 객체가 생겨 아래 트리가 매번 갱신된다.
   */
  audio?: AudioBackend;
  /** 테스트가 가짜 사이드카를 넣는 자리 */
  transcription?: Partial<TranscriptionPanelProps>;
}) {
  const [state, setState] = useState<State>({ name: "idle" });
  /**
   * 구조는 사이드카가 끝나야 온다. **파일 이름을 함께 들고 있는다** — 앞
   * 파일의 결과가 뒤늦게 도착해 새 파일의 구조인 척 앉는 것이 이 화면에서
   * 이미 한 번 나온 함정이다(`running` 가드와 같은 이유).
   */
  const [structure, setStructure] = useState<
    { file: string; value: SidecarStructure } | null
  >(null);
  /**
   * 후보를 직접 골라 다시 분석하는 동안의 진행률. **`state`와 분리해 둔다** —
   * `state.name`을 "running"으로 바꾸면 `report`가 null이 되어 결과 트리
   * 전체가 사라지고, 그 안에 있던 `TranscriptionPanel`이 함께 언마운트된다.
   * 이미 끝난 전사(스템 분리·멜로디 추출, 수 분짜리)가 그 순간 날아간다 —
   * 템포 보정 한 번으로 그걸 다시 태울 이유가 없다. `state`는 "done"에
   * 머물러 옛 report를 계속 보여주다가, 새 report가 오면 그 자리에서
   * 갈아 끼운다.
   */
  const [reanalyzing, setReanalyzing] = useState<AnalysisProgress | null>(null);

  // 화면을 떠나면 돌던 분석을 끊는다. 안 끊으면 워커가 끝까지 돌고, 되돌아와
  // 새 파일을 열면 무거운 DSP가 두 개 동시에 돈다.
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);

  /**
   * `forceBpm`을 주면 자동 배수 보정을 건너뛰고 그 BPM으로 다시 분석한다.
   * 후보를 직접 고르는 경로(`onTempoSelect`)와 새 파일을 여는 경로(`onFile`)가
   * 같은 파이프라인을 타되, 화면에 내보이는 방식만 갈린다 — 새 파일은
   * 진행률 화면으로, 재분석은 옛 결과를 보여준 채로.
   */
  const runAnalysis = useCallback(
    (file: File, ratio?: number) => {
      running.current?.abort();
      const controller = new AbortController();
      running.current = controller;
      if (ratio === undefined) {
        // 새 파일이다 — 이전 재분석의 진행률이 남아 있었다면 지운다
        setReanalyzing(null);
        // 구조도 함께 지운다. 사이드카는 이 파일에 대해 아직 돌지도 않았다
        setStructure(null);
        setState({
          name: "running",
          file: file.name,
          progress: { stage: "시작", ratio: 0 },
        });
      } else {
        setReanalyzing({ stage: "다시 분석", ratio: 0 });
      }
      // **격자를 먼저 받는다.** 워커에는 네트워크가 없어서 거기서 못 부른다.
      // 배수를 고치는 경로(`ratio`)에서도 다시 받는데, 캐시 적중이라 즉시 온다.
      const withGrid = (grid: BeatGrid) => analyze(
        file,
        grid,
        (progress) => {
          if (ratio === undefined) {
            // 늦게 도착한 진행률이 결과 화면을 되돌리지 않게 한다
            setState((current) =>
              current.name === "running" && current.file === file.name
                ? { ...current, progress }
                : current,
            );
          } else {
            setReanalyzing(progress);
          }
        },
        undefined,
        controller.signal,
        ratio,
      );

      beats(file, undefined, controller.signal)
        .catch((error: unknown) => {
          // **여기가 사이드카 없는 환경이 부딪히는 첫 벽이다.** 날것의 fetch
          // 오류를 그대로 내보내면 "Failed to fetch"만 보이고 무엇을 해야
          // 하는지가 안 나온다. 서버가 낸 문장이 있으면 그것을 살린다.
          const said = error instanceof Error ? error.message : String(error);
          throw new Error(
            said.includes("fetch") || said.includes("NetworkError")
              ? "분석 서버(사이드카)가 꺼져 있다 — 비트·BPM·박자가 거기서 나온다. " +
                "`cd server && .venv/bin/uvicorn app.main:app --port 8420`"
              : said,
          );
        })
        .then(withGrid)
        .then(
        (report) => {
          if (controller.signal.aborted) return;
          setReanalyzing(null);
          // 파일 자체를 들고 있는다 — AI 칸이 같은 파일을 사이드카에 올린다
          setState({ name: "done", file, report });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setReanalyzing(null);
          setState({
            name: "error",
            file: file.name,
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
    },
    [analyze, beats],
  );

  const onFile = useCallback((file: File) => runAnalysis(file), [runAnalysis]);

  const onTempoSelect = useCallback(
    (bpm: number) => {
      if (state.name !== "done") return;
      // **비율로 넘긴다.** 격자 변환이 배수로만 정의되기 때문이고, 화면의
      // 후보도 배수 가족이라 나눗셈이 늘 깔끔하게 떨어진다.
      const ratio = bpm / state.report.tempo.bpm;
      if (Math.abs(ratio - 1) < 0.02) return;
      runAnalysis(state.file, ratio);
    },
    [runAnalysis, state],
  );

  const onStructure = useCallback(
    (value: SidecarStructure | null) => {
      if (state.name !== "done") return;
      setStructure(value ? { file: state.file.name, value } : null);
    },
    [state],
  );

  const report = state.name === "done" ? state.report : null;

  /**
   * **여기가 모델의 신호를 음악적 판단으로 바꾸는 유일한 자리다.** 사이드카가
   * 준 구간을 우리 다운비트에 얹고 pre-chorus를 붙인다 — 계산은 전부
   * `core/analysis`의 순수 함수가 하고, 이 파일은 그걸 부르기만 한다.
   *
   * 템포를 다시 잡으면(`onTempoSelect`) `report.downbeats`가 바뀌므로 마디
   * 번호도 따라 바뀐다. 사이드카를 다시 부르지는 않는다 — 구간의 **시각**은
   * 그대로이고 격자만 달라졌을 뿐이다.
   */
  const sections = useMemo(
    () =>
      report && structure && state.name === "done" && structure.file === state.file.name
        ? sectionsFromSegments(
            structure.value.segments,
            report.downbeats,
            report.durationSec,
          )
        : [],
    [report, state, structure],
  );

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

      {report && state.name === "done" && (
        <>
          <p className="muted">
            {state.file.name} · {clock(report.durationSec)}
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

          {/*
            **두 막대가 서로 다른 것을 보인다**(2026-09-12부터).

            템포 쪽은 **사람이 고칠 수 있는 배수들**이다(`metricalFamily`) —
            모델이 답 하나를 주므로 후보 경쟁이 없고, 대신 "틀렸다면 거의 반드시
            배수로 틀린다"를 그대로 낸다. 누르면 격자가 그 배수로 변환된다
            (다시 분석하지 않는다 — `retimeBeats`).

            박자 쪽은 **관측된 마디 길이의 분포**다 — 가설의 점수가 아니라
            다운비트 사이에 실제로 몇 박이 들었는지를 센 값이라 지어낸 숫자가 없다.
          */}
          <Fieldset title="후보">
            <div className="shares-pair">
              <ShareBars
                caption={
                  reanalyzing ? "템포 (다시 분석 중…)" : "템포 (눌러서 수정)"
                }
                rows={report.tempo.candidates.map((c) => ({
                  label: `${c.bpm.toFixed(0)} BPM`,
                  value: c.probability,
                  selected: Math.abs(c.bpm / report.tempo.bpm - 1) < 0.03,
                }))}
                onSelect={
                  reanalyzing
                    ? undefined
                    : (index) => onTempoSelect(report.tempo.candidates[index].bpm)
                }
              />
              <ShareBars
                caption="박자"
                rows={report.meter.candidates.map((c) => ({
                  label: c.value,
                  value: c.probability,
                  selected: c.beatsPerBar === report.meter.beatsPerBar,
                }))}
              />
            </div>
          </Fieldset>

          {/*
            **코드는 사이드카 칸 위에 둔다.** 구조와 달리 브라우저 안에서
            끝나므로 서버가 꺼져 있어도 나온다 — 아래에 두면 "AI 분석이 있어야
            나오는 것"처럼 보인다.
          */}
          {CHORDS_VISIBLE && (
            <ChordCard
              chords={report.chords}
              beatsPerBar={report.meter.beatsPerBar}
              phase={report.meter.phase}
              beats={report.beats}
              confidence={report.chordConfidence}
            />
          )}

          {/* 여기부터는 로컬 사이드카가 있을 때만 나온다. 없으면 안내 한 줄이다 */}
          {/*
            `sections`는 드럼 표의 1차 좌표(`Chorus 2 · 1마디`)가 되는 **파생값이지
            새 상태가 아니다** — 위의 `structure` 하나가 이미 파일 이름으로 막혀
            있고, 구간을 두 번 계산하면 드럼 표와 구조 표의 `Chorus 2`가 갈린다.
          */}
          <TranscriptionPanel
            report={report}
            file={state.file}
            audio={audio}
            onStructure={onStructure}
            sections={sections}
            {...transcription}
          />

          {/*
            구조는 사이드카가 끝나야 나온다. AI 칸 **아래**에 두는 것은 그
            의존을 화면 순서가 그대로 말하게 하기 위해서다 — 위에 두면 사이드카가
            없을 때 빈 자리가 생긴다.
          */}
          <StructureCard
            sections={sections}
            modelBpm={structure?.value.bpm}
            ourBpm={report.tempo.bpm}
          />

          <Button onClick={() => setState({ name: "idle" })}>다른 파일 분석</Button>
        </>
      )}

      <SpecSection title="아직 안 되는 것" items={NOT_YET} />
    </Stack>
  );
}
