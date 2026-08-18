/**
 * 분석 콘솔의 AI 칸 — 스템 분리 · 멜로디 · 악보 · 내려받기.
 *
 * `AnalysisPage`에서 떼어낸 이유는 **없을 수도 있는 기능**이기 때문이다.
 * 사이드카(`server/`)가 꺼져 있으면 이 칸 전체가 안내 한 줄로 바뀌고, 브라우저
 * 안에서 끝나는 BPM·박자·조성은 그대로 나온다.
 *
 * 여기 있는 것은 결선뿐이다 — 모델은 `platform/sidecar`, 음악적 판정은
 * `core/transcribe`, 악보 그리기는 `core/score`가 한다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AnalysisReport } from "../core/analysis";
import { ScoreRenderer } from "../core/score";
import {
  type OnsetCurve,
  type TranscribeContext,
  type Transcription,
  toMidiFiles,
  toSvp,
  transcribe,
} from "../core/transcribe";
import { extractOnset } from "../platform/analyze";
import {
  AudioRow,
  Button,
  DownloadList,
  Panel,
  ProgressBar,
  StaffFigure,
} from "../ds";
import {
  analyzeWithSidecar,
  audioUrl,
  detect,
  type SidecarCheck,
  type SidecarEnv,
  type SidecarHealth,
  type SidecarProgress,
  type SidecarResult,
  type SidecarStructure,
} from "../platform/sidecar";

/** 스템 이름을 사람이 읽는 말로. 이 표가 도메인 지식의 전부다 */
const STEM_LABELS: Record<string, string> = {
  vocals: "보컬",
  drums: "드럼",
  bass: "베이스",
  other: "그 외",
};

type State =
  | { name: "idle" }
  | { name: "running"; progress: SidecarProgress }
  | { name: "done"; result: SidecarResult; onset: OnsetCurve | undefined }
  | { name: "error"; message: string };

export interface TranscriptionPanelProps {
  /** 브라우저 분석 결과. 비트 그리드·조율·조성을 여기서 가져온다 */
  report: AnalysisReport;
  file: File;
  /** 테스트가 가짜 사이드카를 넣는 자리 */
  env?: SidecarEnv;
  /** 테스트가 감지를 건너뛰는 자리 */
  probe?: typeof detect;
  run?: typeof analyzeWithSidecar;
  /** 테스트가 온셋 추출을 건너뛰는 자리 */
  onset?: (audio: Blob, signal?: AbortSignal) => Promise<OnsetCurve>;
  /**
   * 구조 분석 결과를 위로 올린다. **여기서 계산하지 않는다** — 이 파일은
   * 결선만 하는 자리이고, 구간을 마디로 옮기고 라벨을 다시 붙이는 것은
   * `core/analysis/sections.ts`의 일이다.
   */
  onStructure?: (structure: SidecarStructure | null) => void;
}

/**
 * 후처리 보컬의 온셋 곡선. **실패하면 `undefined`다** — 온셋이 없으면 같은 음
 * 재발음을 못 가를 뿐이고, 그것 때문에 전사 전체를 버릴 이유가 없다. 음원이
 * 없으면 사인 신스로 나는 것과 같은 방침이다.
 *
 * 원본 믹스가 아니라 **분리·게이트를 지난 보컬**을 쓴다. 믹스의 ODF는 드럼이
 * 지배해서 유령 음표가 쏟아진다(실측: 곡A에서 유령 78 → 137).
 */
async function onsetOf(
  result: SidecarResult,
  env: SidecarEnv | undefined,
  extract: (audio: Blob, signal?: AbortSignal) => Promise<OnsetCurve>,
  signal: AbortSignal,
): Promise<OnsetCurve | undefined> {
  try {
    const response = await fetch(audioUrl(result.jobId, "vocal_processed", env), { signal });
    if (!response.ok) return undefined;
    return await extract(await response.blob(), signal);
  } catch {
    return undefined;
  }
}

export function TranscriptionPanel({
  report,
  file,
  env,
  probe = detect,
  run = analyzeWithSidecar,
  onset = (audio, signal) => extractOnset(audio, {}, signal),
  onStructure,
}: TranscriptionPanelProps) {
  // null = 아직 확인 중, false = 없음
  const [health, setHealth] = useState<SidecarHealth | null | false>(null);
  const [state, setState] = useState<State>({ name: "idle" });
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void probe(env).then((found) => {
      if (alive) setHealth(found ?? false);
    });
    return () => {
      alive = false;
    };
  }, [env, probe]);

  // 화면을 떠나면 서버 쪽 작업도 멈춘다. 스템 분리는 GPU를 수 분 잡는다.
  useEffect(() => () => running.current?.abort(), []);
  // **파일이 바뀌면 돌던 작업부터 끊는다.** 화면만 비우면 앞 파일의 전사가
  // 뒤늦게 도착해 새 파일의 결과인 척 앉는다 — `start`의 클로저가 옛 파일과
  // 옛 report를 들고 있고, 취소하지 않은 컨트롤러는 aborted가 아니라서
  // 그대로 통과한다.
  useEffect(() => {
    running.current?.abort();
    setState({ name: "idle" });
  }, [file]);

  const start = useCallback(() => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setState({ name: "running", progress: { stage: "시작", ratio: 0 } });

    run(file, (progress) => setState({ name: "running", progress }), env, controller.signal)
      .then(async (result) => {
        if (controller.signal.aborted) return;
        setState({ name: "running", progress: { stage: "온셋 찾는 중", ratio: 0.97 } });
        const curve = await onsetOf(result, env, onset, controller.signal);
        if (controller.signal.aborted) return;
        setState({ name: "done", result, onset: curve });
        onStructure?.(result.structure);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          name: "error",
          message: failure instanceof Error ? failure.message : String(failure),
        });
      });
  }, [env, file, onset, onStructure, run]);

  /**
   * 전사 문맥. `report`가 참조 자체를 바꾸므로(사용자가 템포 후보를 직접
   * 고르면 `AnalysisPage`가 새로 분석해 새 report를 내려보낸다) 여기서도
   * 다시 만들어야 아래 `transcription`이 그걸 반영해 재계산된다.
   */
  const context = useMemo<TranscribeContext>(
    () => ({
      bpm: report.tempo.bpm,
      beats: report.beats,
      downbeats: report.downbeats,
      beatsPerBar: report.meter.beatsPerBar,
      tuningCents: report.tuningCents,
      key: { tonic: report.key.tonic, mode: report.key.mode },
      title: file.name,
      // **두 층을 잇는 자리다.** `core/transcribe`는 `core/analysis`를 모르므로
      // (서로 import하지 않는다) `ChordEvent`를 저쪽이 아는 모양으로 옮기는
      // 것은 이 파일의 일이다 — 온셋 곡선을 넘길 때와 같다.
      chords: report.chords.map((chord) => ({
        atSec: chord.startSec,
        root: chord.root,
        kind: chord.kind,
        text: chord.suffix,
      })),
    }),
    [report, file],
  );

  /**
   * **사이드카를 다시 부르지 않는다.** f0 커브(`result.curve`)와 온셋은
   * 이미 있고, `transcribe()`는 순수 함수라 문맥만 바뀌면 다시 돌려도 싸다 —
   * 스템 분리·멜로디 추출(수 분)을 BPM 보정 한 번에 다시 태우지 않기 위해서다.
   */
  const transcription: Transcription | null = useMemo(
    () => (state.name === "done" ? transcribe(state.result.curve, context, { onset: state.onset }) : null),
    [state, context],
  );

  if (health === null) return null;
  if (health === false) return <SidecarMissing />;

  return (
    <Panel title="AI 분석" meta={`${health.device} · 사이드카 ${health.version}`}>
      {state.name === "idle" && (
        <>
          <p className="muted">
            보컬을 분리하고 멜로디를 따서 악보와 MIDI로 만든다. 곡 길이에 따라 수
            분이 걸린다 — 같은 파일은 두 번째부터 즉시 나온다.
          </p>
          <Button primary onClick={start}>
            스템 분리 · 멜로디 전사 시작
          </Button>
          <ModelNotice
            ok={health.models.stems}
            check={health.checks?.stems}
            missing="스템 분리 모델이 없어 원본을 그대로 쓴다. 반주가 섞여 멜로디가 나빠진다"
            install="pip install demucs"
            broken="스템 분리 모델이 깔려 있지만 이 환경에서 돌지 않는다"
          />
          <ModelNotice
            ok={health.models.melody}
            check={health.checks?.melody}
            missing="멜로디 모델이 없어 음표가 나오지 않는다"
            install="pip install rmvpe-onnx"
            broken="멜로디 모델이 깔려 있지만 이 환경에서 돌지 않는다"
          />
        </>
      )}

      {state.name === "running" && (
        <>
          <ProgressBar ratio={state.progress.ratio} label={state.progress.stage} />
          <Button onClick={() => running.current?.abort()}>취소</Button>
        </>
      )}

      {state.name === "error" && (
        <>
          <p className="muted">전사하지 못했습니다: {state.message}</p>
          <Button onClick={start}>다시 시도</Button>
        </>
      )}

      {state.name === "done" && transcription && (
        <Results
          result={state.result}
          transcription={transcription}
          bpm={report.tempo.bpm}
          beatsPerBar={report.meter.beatsPerBar}
          title={file.name}
          musicalKey={{ tonic: report.key.tonic, mode: report.key.mode }}
          env={env}
          onRetry={start}
        />
      )}
    </Panel>
  );
}

/**
 * 모델 하나가 왜 못 쓰이는지 한 줄.
 *
 * **"안 깔림"과 "깔렸는데 안 돎"에 같은 문장을 내면 안 된다.** 뒤쪽에
 * `pip install`을 권하면 이미 깔린 것을 다시 깔라는 말이 되어, 사용자가
 * 진짜 원인(예: `setuptools` 버전)에서 멀어진다. 서버가 알아낸 문장을
 * 그대로 보여주는 편이 훨씬 빠른 길이다.
 */
function ModelNotice({
  ok,
  check,
  missing,
  install,
  broken,
}: {
  ok: boolean;
  check?: SidecarCheck;
  missing: string;
  install: string;
  broken: string;
}) {
  // 아직 진단 중이면 아무것도 말하지 않는다 — 곧 바뀔 문장을 띄우면
  // 사용자가 없는 문제를 고치러 간다
  if (ok || check?.status === "checking") return null;
  if (check?.status === "broken") {
    return (
      <p className="muted">
        {broken} — <code>{check.detail}</code>
      </p>
    );
  }
  return (
    <p className="muted">
      {missing} — <code>{install}</code>
    </p>
  );
}

function SidecarMissing() {
  return (
    <Panel title="AI 분석" meta="사이드카가 꺼져 있다">
      <p className="muted">
        스템 분리와 멜로디 전사는 학습된 모델이 필요해 브라우저 안에서 끝나지
        않는다. 로컬 서버를 띄우면 이 자리에 나타난다 — 띄우지 않아도 위의
        BPM·박자·조성은 그대로 나온다.
      </p>
      <pre className="code">
        cd server{"\n"}
        python -m venv .venv &amp;&amp; .venv/bin/pip install -r requirements.txt{"\n"}
        .venv/bin/uvicorn app.main:app --port 8420
      </pre>
    </Panel>
  );
}

function Results({
  result,
  transcription,
  bpm,
  beatsPerBar,
  title,
  musicalKey,
  env,
  onRetry,
}: {
  result: SidecarResult;
  transcription: Transcription;
  bpm: number;
  beatsPerBar: number;
  title: string;
  musicalKey: { tonic: number; mode: "major" | "minor" };
  env?: SidecarEnv;
  onRetry: () => void;
}) {
  const files = useMemo(
    () => toMidiFiles(transcription, { bpm, beatsPerBar }),
    [beatsPerBar, bpm, transcription],
  );
  // `Transcription`이 커브와 격자를 그대로 들고 있으므로 그대로 넘긴다
  const svp = useMemo(
    () => toSvp(transcription, { title, bpm, key: musicalKey }),
    [bpm, musicalKey, title, transcription],
  );
  const downloads = useDownloads(transcription, files, svp);
  const svg = useScore(transcription.musicXml);

  const range = transcription.notes.length
    ? `${Math.min(...transcription.notes.map((n) => n.midi))}~${Math.max(
        ...transcription.notes.map((n) => n.midi),
      )}`
    : "—";
  const drift = driftText(transcription);

  return (
    <>
      {result.stems.length > 0 && (
        <div className="stack">
          {result.stems.map((stem) => (
            <AudioRow
              key={stem}
              label={STEM_LABELS[stem] ?? stem}
              src={audioUrl(result.jobId, stem, env)}
              filename={`${stem}.wav`}
            />
          ))}
        </div>
      )}
      <AudioRow
        label="보컬(처리본)"
        src={audioUrl(result.jobId, "vocal_processed", env)}
        filename="vocal_processed.wav"
      />

      <p className="muted">
        음표 {transcription.notes.length}개 · MIDI {range} ·{" "}
        {transcription.quantized.length}개를 격자에 얹었다
        {/*
          양자화가 걷어낸 보컬 랙. **그 자체로 진단 정보다** — 이게 크면 가수가
          뒤로 눕혀 부른 것이거나 비트 추적이 어긋난 것이고, 둘은 악보를 보는
          눈이 다르다. 몇 밀리초짜리는 잡음이라 말하지 않는다.

          **폭을 함께 낸다.** 밀린 양은 곡 안에서 변하고(실측: 실곡에서 −56~
          +60ms), 그때 중앙값만 보면 0에 가까워 "잘 맞았다"로 오해된다.
        */}
        {drift && (
          <>
            {" "}
            · 노래가 박보다 {drift.text}
          </>
        )}
      </p>

      <StaffFigure
        svg={svg}
        tall
        fallback={
          transcription.notes.length
            ? "악보를 그리는 중…"
            : "멜로디를 찾지 못했다"
        }
      />
      <p className="muted">
        악보는 <strong>검수 전제의 초안이다</strong> — 이명동음(F♯/G♭)·성부
        분리·잇단음표는 자동으로 정해지지 않는다.
      </p>

      <DownloadList items={downloads} />
      <Button onClick={onRetry}>다시 전사</Button>
    </>
  );
}

/**
 * 밀림을 한 줄로. 폭이 넓으면 중앙값 대신 범위를 말한다.
 *
 * **중앙값만 내면 드리프트가 안 보인다** — 앞이 60ms 늦고 뒤가 60ms 이른 곡의
 * 중앙값은 0이라, 가장 심하게 흔들린 곡이 가장 잘 맞은 곡처럼 읽힌다.
 */
function driftText(transcription: Transcription): { text: string } | null {
  const values = transcription.offsetCurve.offsetMs;
  const median = transcription.offsetMs;
  if (values.length) {
    const low = Math.min(...values);
    const high = Math.max(...values);
    if (high - low >= 20) {
      return { text: `${low.toFixed(0)}~${high.toFixed(0)}ms 사이를 오간다` };
    }
  }
  if (Math.abs(median) < 10) return null;
  return {
    text: `${Math.abs(median).toFixed(0)}ms ${median > 0 ? "늦다" : "이르다"}`,
  };
}

interface Download {
  label: string;
  href: string;
  filename: string;
}

/**
 * 내려받기 주소.
 *
 * **`useMemo`로 만들지 않는다**(StrictMode에서 두 번 불린다 — 오디오 백엔드에서
 * 이미 데인 자리다). blob 주소는 **회수하지 않으면 샌다**: 파일을 바꿔 가며
 * 여러 번 돌리면 그때마다 수십 KB가 남고, 이건 GC가 가져가지 못한다.
 * 이펙트의 정리 함수만이 "언제 버려도 되는가"를 정확히 안다.
 */
function useDownloads(
  transcription: Transcription,
  files: { performed: Uint8Array; quantized: Uint8Array },
  svp: string,
): Download[] {
  const [items, setItems] = useState<Download[]>([]);
  useEffect(() => {
    const urls: string[] = [];
    const make = (data: BlobPart, type: string) => {
      const url = URL.createObjectURL(new Blob([data], { type }));
      urls.push(url);
      return url;
    };
    setItems([
      {
        label: "MIDI (노래한 그대로)",
        href: make(files.performed as BlobPart, "audio/midi"),
        filename: "melody-performed.mid",
      },
      {
        label: "MIDI (격자)",
        href: make(files.quantized as BlobPart, "audio/midi"),
        filename: "melody-quantized.mid",
      },
      {
        label: "MusicXML (악보)",
        href: make(
          transcription.musicXml,
          "application/vnd.recordare.musicxml+xml",
        ),
        filename: "melody.musicxml",
      },
      {
        // 가사가 있어야 가창 합성기가 발음한다(`transcribe.VOCAL_LYRIC`)
        label: "MusicXML (가사 la · 신스V)",
        href: make(
          transcription.vocalXml,
          "application/vnd.recordare.musicxml+xml",
        ),
        filename: "melody-la.musicxml",
      },
      {
        // **음표만 주면 신스V의 AI가 자기 피치 커브를 새로 만들어 붙인다.**
        // 이 파일에는 원 보컬의 f0가 컨트롤 점으로 들어 있어 비브라토·포르타멘토·
        // 스쿠핑이 그대로 간다(`core/transcribe/svp.ts`).
        label: "신스V 프로젝트 (피치 커브 포함)",
        href: make(svp, "application/octet-stream"),
        filename: "melody.svp",
      },
    ]);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [files, svp, transcription]);
  return items;
}

/** MusicXML → SVG. verovio가 없거나 실패하면 null(화면은 안내로 떨어진다) */
function useScore(musicXml: string): string | null {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSvg(null);
    ScoreRenderer.load()
      .then((renderer) => {
        if (alive) setSvg(renderer.render(musicXml));
      })
      .catch(() => {
        if (alive) setSvg(null);
      });
    return () => {
      alive = false;
    };
  }, [musicXml]);
  return svg;
}
