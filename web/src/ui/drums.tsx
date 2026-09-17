/**
 * 드럼 칸 — **이 곡에 쓰인 드럼을 보고 듣는 자리.**
 *
 * 사이드카가 이미 뽑아 둔 `stems/drums.wav`를 받아 브라우저에서 타점을 찾고
 * (`core/drums/detect`), 우리 격자에 얹어 루프와 필인을 가른다
 * (`core/drums/pattern`). **새 서버 작업이 없다** — 스템은 전사 때 이미 나왔다.
 *
 * ## 왜 `TranscriptionPanel` **안**에 있나
 *
 * `analysis.tsx`에 형제로 놓으면 `{jobId}`를 위로 올리는 새 상태가 생기고,
 * 그러면 **파일 이름 가드가 또 필요하다** — `structure` 상태가 정확히 그것
 * 때문에 `{file, value}` 쌍을 들고 있고, 그 주석이 "이 화면에서 이미 한 번 나온
 * 함정"이라고 적어 뒀다.
 *
 * 안쪽에 두면 `state.result`가 이미 파일 단위로 묶여 있어 가드가 필요 없고,
 * 템포를 고쳐 다시 분석해도(`forceBpm`) `TranscriptionPanel`의 상태를 안
 * 건드리므로 **몇 분 걸린 스템 분리도 드럼 검출도 안 날아간다.**
 *
 * ## 검출은 `jobId`에만 딸린다
 *
 * 타점은 오디오에만 의존하고 그 아래(마디·루프·필인)는 격자에 의존한다. 그래서
 * 사용자가 템포 후보를 바꾸면 **검출은 다시 안 돌고** `analyzePattern`만 밀리초
 * 단위로 다시 돈다 — `transcribe()`가 사이드카를 다시 안 부르는 것과 같은 배치다.
 *
 * ## 두 부품으로 갈라 둔 이유
 *
 * `DrumPanel`은 받아오는 일만 하고 `DrumResult`가 그린다. 훅은 조기 반환 뒤에
 * 부를 수 없는데 내려받기 blob URL은 훅이 필요하기 때문이다 —
 * `TranscriptionPanel`이 `Results`를 가른 것과 같은 모양이다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AnalysisReport, Section } from "../core/analysis";
import {
  analyzePattern,
  CLASS_MARKS,
  CLASS_NAMES,
  DRUM_CLASSES,
  loopToMidi,
  toDrumMidi,
  toDrumMusicXml,
  type BarSection,
  type DrumAnalysis,
  type DrumDetection,
  type DrumHit,
  type LoopSpan,
} from "../core/drums";
import { ScoreRenderer } from "../core/score";
import { buildGrid, stepTime, type Grid } from "../core/transcribe/quantize";
import { extractDrums } from "../platform/analyze";
import { makeClipPlayer, type Clip, type ClipPlayer } from "../platform/clip";
import { audioUrl, type SidecarEnv } from "../platform/sidecar";
import {
  Button,
  DownloadList,
  Fieldset,
  Matrix,
  Metric,
  MetricGrid,
  ProgressBar,
  StaffFigure,
  StepGrid,
} from "../ds";
import { clock, titleCase } from "./format";
import { type DownloadSource, useDownloads } from "./useDownloads";

const MIDI_TYPE = "audio/midi";

/** 그리드에 한 번에 그릴 최대 마디. 넘으면 가로로 너무 길어 읽을 수 없다 */
const MAX_GRID_BARS = 4;

type State =
  | { name: "idle" }
  | { name: "running" }
  | { name: "done"; detection: DrumDetection }
  | { name: "error"; message: string };

export interface DrumPanelProps {
  readonly jobId: string;
  readonly report: AnalysisReport;
  /** 구조 분석이 켜져 있을 때만 온다. 1차 좌표(`Chorus 2 · 1마디`)가 여기서 난다 */
  readonly sections?: readonly Section[];
  readonly env?: SidecarEnv;
  /** 테스트가 갈아끼우는 자리 — 진짜 오디오를 받지 않게 한다 */
  readonly detect?: (audio: Blob, signal?: AbortSignal) => Promise<DrumDetection>;
  /** 테스트가 소리를 끄는 자리 */
  readonly clip?: () => ClipPlayer;
}



/**
 * `Section` → `BarSection`. **`core/drums`가 `core/analysis`를 모르게 하는 자리.**
 *
 * `OnsetCurve`·`HarmonyMark`와 같은 방식이다 — 두 순수 모듈이 모양만 맞추고,
 * 잇는 것은 이 위층의 일이다.
 *
 * `Section.bars`는 `[시작, 끝)`의 **0부터 세는 마디 인덱스**이고 우리 절대 마디는
 * 1부터다(`structure.tsx`가 `bars[0] + 1`–`bars[1]`로 적는 그대로).
 */
function toBarSections(sections: readonly Section[] | undefined): BarSection[] {
  const out: BarSection[] = [];
  for (const section of sections ?? []) {
    if (!section.bars) continue;
    out.push({
      label: `${titleCase(section.label)} ${section.repeat}`,
      fromBar: section.bars[0] + 1,
      toBar: section.bars[1],
    });
  }
  return out;
}

/** 표시할 span의 이름 — 3층 좌표를 한 줄로 */
function spanName(span: LoopSpan): string {
  const bars =
    span.fromBar === span.toBar ? `${span.fromBar}마디` : `${span.fromBar}–${span.toBar}마디`;
  return span.section ? `${span.section} · ${bars}` : bars;
}

export function DrumPanel({ jobId, report, sections, env, detect, clip }: DrumPanelProps) {
  const [state, setState] = useState<State>({ name: "idle" });
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    running.current?.abort();
    running.current = controller;
    setState({ name: "running" });

    const run =
      detect ?? ((audio: Blob, signal?: AbortSignal) => extractDrums(audio, {}, {}, signal));
    (async () => {
      try {
        const response = await fetch(audioUrl(jobId, "drums", env), { signal: controller.signal });
        if (!response.ok) throw new Error(`드럼 스템을 못 받았다 (${response.status})`);
        const detection = await run(await response.blob(), controller.signal);
        if (controller.signal.aborted) return;
        setState({ name: "done", detection });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          name: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => controller.abort();
    // 실제로 바뀌는 것은 `jobId`뿐이다. `detect`는 매 렌더 새 함수라 넣으면
    // 무한 루프가 되고, 파일이 바뀌면 위층이 이 부품을 통째로 다시 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  /**
   * 격자는 **전사와 같은 것을 쓴다.** 여기서 따로 만들면 드럼 5마디와 악보
   * 5마디가 갈린다.
   */
  const grid = useMemo(
    () =>
      buildGrid({
        beats: report.beats,
        downbeats: report.downbeats,
        beatsPerBar: report.meter.beatsPerBar,
      }),
    [report],
  );

  const analysis: DrumAnalysis | null = useMemo(() => {
    if (state.name !== "done") return null;
    return analyzePattern(state.detection.hits, grid, { sections: toBarSections(sections) });
  }, [state, grid, sections]);

  if (state.name === "running") {
    return (
      <Fieldset title="드럼">
        <ProgressBar ratio={0.5} label="드럼 스템에서 타점을 찾는 중" />
      </Fieldset>
    );
  }
  if (state.name === "error") {
    return (
      <Fieldset title="드럼">
        <p className="muted">드럼 분석에 실패했다 — {state.message}</p>
      </Fieldset>
    );
  }
  if (state.name !== "done" || !analysis || analysis.spans.length === 0) return null;

  return (
    <DrumResult
      jobId={jobId}
      hits={state.detection.hits}
      analysis={analysis}
      grid={grid}
      bpm={report.tempo.bpm}
      env={env}
      clip={clip}
    />
  );
}


/**
 * 타악보를 그린다. **툴킷은 앱에 하나뿐이므로 조심해서 부른다.**
 *
 * 타임맵은 안 받는다 — 커서는 스텝 그리드가 맡으므로 `render()` 한 번이면
 * 되고, 그래야 전사 악보의 `renderScore()`(loadData→SVG→타임맵을 한 호출로
 * 묶어 둔 것)와 사이에 끼어들 여지가 줄어든다.
 */
function useDrumScore(musicXml: string | null): string | undefined {
  const [svg, setSvg] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!musicXml) {
      setSvg(undefined);
      return;
    }
    let alive = true;
    ScoreRenderer.load()
      .then((renderer) => {
        if (alive) setSvg(renderer.render(musicXml));
      })
      .catch(() => {
        // jsdom·구형 브라우저에서는 WASM이 안 뜬다. 그리드가 이미 같은 것을
        // 보여주고 있으므로 악보만 조용히 빠진다.
        if (alive) setSvg(undefined);
      });
    return () => {
      alive = false;
    };
  }, [musicXml]);
  return svg;
}

function DrumResult({
  jobId,
  hits,
  analysis,
  grid,
  bpm,
  env,
  clip,
}: {
  jobId: string;
  hits: readonly DrumHit[];
  analysis: DrumAnalysis;
  grid: Grid;
  bpm: number;
  env?: SidecarEnv;
  clip?: () => ClipPlayer;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  /**
   * **`useMemo`로 만들지 않는다** — StrictMode가 팩토리를 두 번 부르고, 이건
   * `AudioContext`를 들고 있어 버려지는 쪽도 자원을 잡는다. 오디오 백엔드를
   * `useRef` + `??=`로 바꾼 것과 같은 실측이다.
   */
  const playerRef = useRef<ClipPlayer | null>(null);
  const handleRef = useRef<Clip | null>(null);
  const frameRef = useRef<number | null>(null);
  const stepRef = useRef<number | null>(null);

  const stopPlayback = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    handleRef.current?.stop();
    handleRef.current = null;
    stepRef.current = null;
    setCursor(null);
  }, []);

  // 화면을 떠나면 소리를 끈다. `AudioContext`는 언마운트로 저절로 닫히지 않는다.
  useEffect(
    () => () => {
      stopPlayback();
      playerRef.current?.dispose();
      playerRef.current = null;
    },
    [stopPlayback],
  );

  const spans = analysis.spans;
  const found = spans.findIndex((s) => !s.fill);
  const index = selected ?? Math.max(0, found);
  const span = spans[index];
  const stepsPerBar = grid.stepsPerBeat * grid.beatsPerBar;

  // 고른 구간의 앞 몇 마디만 그린다. 루프 한 바퀴가 곧 공부할 단위다.
  const barsToShow = Math.min(
    MAX_GRID_BARS,
    span.fill ? 1 : analysis.period.bars,
    span.toBar - span.fromBar + 1,
  );

  const midi = useMemo(
    () => toDrumMidi(hits, grid, { bpm, beatsPerBar: grid.beatsPerBar }),
    [hits, grid, bpm],
  );
  const loop = useMemo(
    () => loopToMidi(hits, grid, span, { bpm, beatsPerBar: grid.beatsPerBar, bars: barsToShow }),
    [hits, grid, span, bpm, barsToShow],
  );
  const musicXml = useMemo(
    () =>
      toDrumMusicXml(analysis.bars, {
        bpm,
        beatsPerBar: grid.beatsPerBar,
        stepsPerBeat: grid.stepsPerBeat,
        title: "드럼",
      }),
    [analysis, bpm, grid],
  );
  const staff = useDrumScore(musicXml);

  const sources = useMemo<DownloadSource[]>(
    () => [
      {
        label: "드럼 MIDI (격자)",
        filename: "drums-quantized.mid",
        data: midi.quantized as BlobPart,
        type: MIDI_TYPE,
      },
      {
        label: "드럼 MIDI (친 그대로)",
        filename: "drums-performed.mid",
        data: midi.performed as BlobPart,
        type: MIDI_TYPE,
      },
      {
        label: `루프 MIDI (${span.fill ? "필인" : span.patternId})`,
        filename: `drums-loop-${span.fill ? "fill" : span.patternId}-${span.fromBar}.mid`,
        data: loop as BlobPart,
        type: MIDI_TYPE,
      },
    ],
    [midi, loop, span],
  );
  const downloads = useDownloads(sources);

  const shown = analysis.bars.filter(
    (b) => b.bar >= span.fromBar && b.bar < span.fromBar + barsToShow,
  );
  // 실제로 쓰인 어휘만 행으로 만든다 — 빈 줄이 있으면 곡에 그 악기가 있는 것처럼 보인다
  const used = DRUM_CLASSES.filter((cls) =>
    analysis.bars.some((bar) => bar.cells.some((cell) => cell.includes(cls))),
  );
  const rows = used.map((cls) => ({
    id: cls,
    label: CLASS_NAMES[cls],
    mark: CLASS_MARKS[cls],
    cells: shown.flatMap((bar) => bar.cells.map((cell) => (cell.includes(cls) ? 1 : 0))),
  }));
  // **열 머리는 박만 말한다.** 마디 시작에 마디 번호를 적으면 `1 2 3 4 2 2 3 4`로
  // 읽혀 두 숫자가 섞인다(실측). 마디는 굵은 선이, 어느 마디인지는 캡션이 말한다.
  const columns = shown.flatMap(() =>
    Array.from({ length: stepsPerBar }, (_, i) =>
      i % grid.stepsPerBeat === 0 ? `${i / grid.stepsPerBeat + 1}` : "",
    ),
  );

  // 재생 구간은 **그리드에 보이는 그 마디들**이다. 눈으로 본 것과 귀로 듣는
  // 것이 다르면 이 패널의 목적이 사라진다.
  const loopFrom = stepTime(grid, (span.fromBar - 1) * stepsPerBar);
  const loopTo = stepTime(grid, (span.fromBar - 1 + barsToShow) * stepsPerBar);
  const loopSteps = barsToShow * stepsPerBar;
  // 박마다 클릭. 미리 섞어 렌더하므로 스케줄러가 필요 없다(`platform/clip.ts`).
  const clicks = Array.from({ length: barsToShow * grid.beatsPerBar }, (_, i) =>
    stepTime(grid, (span.fromBar - 1) * stepsPerBar + i * grid.stepsPerBeat),
  );

  const play = () => {
    stopPlayback();
    playerRef.current ??= (clip ?? makeClipPlayer)();
    const player = playerRef.current;
    void player
      .load(audioUrl(jobId, "drums", env))
      .then(() => {
        const handle = player.loop(loopFrom, loopTo, clicks);
        handleRef.current = handle;
        const tick = () => {
          const at = handle.positionSec();
          // **손잡이가 null을 주면 멈춘 것이다.** 소리는 끊겼는데 커서만 혼자
          // 흘러가는 사고를 막는 자리다(`Sequence`가 배운 그것).
          if (at === null) {
            stopPlayback();
            return;
          }
          const ratio = (at - loopFrom) / Math.max(1e-6, loopTo - loopFrom);
          const step = Math.min(loopSteps - 1, Math.max(0, Math.floor(ratio * loopSteps)));
          // **칸이 바뀔 때만 다시 그린다.** 커서가 이산값이라 시간으로 조절할
          // 이유가 없다 — 매 프레임 `setState`하면 60fps로 리렌더가 돈다.
          if (step !== stepRef.current) {
            stepRef.current = step;
            setCursor(step);
          }
          frameRef.current = requestAnimationFrame(tick);
        };
        frameRef.current = requestAnimationFrame(tick);
      })
      .catch(() => stopPlayback());
  };

  const fills = spans.filter((s) => s.fill).length;

  return (
    <Fieldset title="드럼">
      <MetricGrid>
        <Metric
          label="루프"
          value={`${analysis.period.bars}마디`}
          detail={`패턴 ${analysis.patterns.length}종 · 필인 ${fills}회`}
          // 경쟁자가 **있는데** 붙었을 때만 의심한다. 배수뿐이면 경쟁자가 없다
          note={
            (analysis.period.margin !== null && analysis.period.margin < 0.05) ||
            analysis.period.fit < 0.6
              ? "확인 필요"
              : undefined
          }
        />
        <Metric label="타점" value={String(hits.length)} detail={`${used.length}종 어휘`} />
        <Metric
          label="격자 적중"
          value={`${Math.round(analysis.gridHitRatio * 100)}%`}
          detail={`중앙 편차 ${analysis.medianDeviationMs}ms`}
          note={analysis.gridHitRatio < 0.5 ? "확인 필요" : undefined}
        />
      </MetricGrid>

      <StepGrid
        caption={`${span.fill ? "필인" : `패턴 ${span.patternId}`} · ${spanName(span)}`}
        rows={rows}
        columns={columns}
        group={grid.stepsPerBeat}
        major={stepsPerBar}
        cursor={cursor}
      />

      {/*
        **귀로 확인하는 경로다.** 사양서 §6이 "시각화는 훑어보기용이고 확정은
        귀로 한다"고 못박았고, 드럼 정답이 하나도 없는 지금 판정이 맞는지 말할
        수 있는 길이 이것뿐이다.
      */}
      <div className="drums__loops">
        {cursor === null ? (
          <Button primary onClick={play}>
            이 구간 반복 재생
          </Button>
        ) : (
          <Button onClick={stopPlayback}>멈춤</Button>
        )}
        <span className="muted">{`${clock(loopFrom)}–${clock(loopTo)} · ${barsToShow}마디 · 박마다 클릭`}</span>
      </div>

      {/*
        드럼 악보. **그리드와 같은 자료를 다르게 보여준다** — 그리드는 칸을
        세는 눈이고 악보는 읽는 눈이다. verovio가 타악보를 그린다는 것은
        스파이크로 확인했다(`core/drums/notation.ts` 앞머리).
      */}
      <StaffFigure svg={staff} fallback="악보를 그리지 못했다 — 위 그리드로 본다" tall />

      <Matrix
        caption="루프와 필인"
        columns={["구간", "패턴", "마디", "시간"]}
        rows={spans.map((s, i) => [
          // **첫 칸을 유일하게 만든다** — `ds.Matrix`가 이걸 React 키로 쓰는데
          // 같은 패턴이 여러 번 나오는 것이 정상이다(`structure.tsx`와 같은 함정).
          `${i + 1}. ${spanName(s)}`,
          s.fill ? "필인" : s.patternId,
          `${s.toBar - s.fromBar + 1}마디`,
          `${clock(s.fromSec)}–${clock(s.toSec)}`,
        ])}
      />

      <div className="drums__loops">
        {spans.map((s, i) => (
          <Button
            key={`${s.fromBar}-${s.patternId}`}
            primary={i === index}
            onClick={() => {
              // 고른 구간이 바뀌면 소리를 먼저 끈다 — 안 그러면 앞 구간이
              // 계속 도는데 그리드는 새 구간을 그린다
              stopPlayback();
              setSelected(i);
            }}
          >
            {s.fill ? `필인 ${s.fromBar}` : `${s.patternId} ${s.fromBar}`}
          </Button>
        ))}
      </div>

      <DownloadList items={downloads} />

      {/*
        **재기 전에 주장하지 않는다**(규칙 1). `ChordCard`가 dim·aug를 못 가른다고
        한 문장 찍는 것과 같은 자리다 — 사용자가 한계를 버그로 읽지 않게.
      */}
      <p className="muted">
        드럼 어휘는 GM 드럼맵 전부를 표로 들고 있지만 <strong>지금 귀로 가르는 것은
        여섯</strong>이다 — 킥·스네어·하이햇·오픈 하이햇·톰·심벌. 심벌 종류를 못
        가르는 것은 알고리즘이 아니라 <strong>분석 표본화율의 한계</strong>다
        (22.05kHz — 라이드와 크래시를 가르는 에너지가 11kHz 위에 있다).{" "}
        <strong>정확도는 아직 말할 수 없다</strong>: 드럼 정답을 찍어 둔 곡이 하나도
        없다. MIDI도 <strong>검수 전제의 초안</strong>이다.
      </p>
    </Fieldset>
  );
}
