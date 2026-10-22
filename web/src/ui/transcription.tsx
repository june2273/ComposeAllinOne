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

import type { AnalysisReport, Section } from "../core/analysis";
import type { AudioBackend } from "../core/audio";
import {
  type OnsetCurve,
  type TranscribeContext,
  type Transcription,
  toMidiFiles,
  toSvp,
  transcribe,
} from "../core/transcribe";
import { extractOnset } from "../platform/analyze";
import { CHORDS_VISIBLE } from "./chords";
import { DrumPanel, type DrumPanelProps } from "./drums";
import { ScorePlayer } from "./scoreplayer";
import { type DownloadSource, useDownloads } from "./useDownloads";

/** 악보와 가창 합성기용 파일이 같은 타입을 쓴다 */
const MUSICXML_TYPE = "application/vnd.recordare.musicxml+xml";
import {
  AudioRow,
  Button,
  DownloadList,
  Panel,
  ProgressBar,
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
  waitForSidecar,
} from "../platform/sidecar";

/** 스템 이름을 사람이 읽는 말로. 이 표가 도메인 지식의 전부다 */
const STEM_LABELS: Record<string, string> = {
  vocals: "보컬",
  drums: "드럼",
  bass: "베이스",
  other: "그 외",
  // 드럼+베이스+그 외를 더한 것. 새 모델 없이 htdemucs 스템만으로 합친다 — server/app/stems.py
  inst: "오프보컬 (인스트)",
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
  /** 악보 재생이 쓴다. 소리를 못 내는 환경(테스트·jsdom)에서는 NullSynth다 */
  audio: AudioBackend;
  /** 테스트가 가짜 사이드카를 넣는 자리 */
  env?: SidecarEnv;
  /**
   * 테스트가 감지를 건너뛰는 자리. **첫 물음만 이걸 탄다** — 그 뒤 되풀이는
   * `waitForSidecar`가 `env.fetch`로 물으므로, 기다리는 쪽을 시험하려면
   * `probe`가 아니라 `env`에 가짜를 넣는다.
   */
  probe?: typeof detect;
  /**
   * 기동을 얼마나 기다릴 것인가. **개발 서버가 사이드카를 직접 띄우기 때문에
   * 생긴 축이다**(`vite-sidecar.ts`) — torch를 불러오느라 십수 초가 걸리는데,
   * 한 번 묻고 "꺼져 있다"고 말해 버리면 자동 실행이 있으나 마나가 된다.
   *
   * **빌드된 앱에서는 0이다** — 거기에는 띄워 줄 개발 서버가 없어서 기다리는
   * 것이 거짓말이 된다. 테스트도 0을 주고 지금 자리에서 바로 판정한다.
   */
  startup?: { budgetMs?: number; retryMs?: number };
  run?: typeof analyzeWithSidecar;
  /** 테스트가 온셋 추출을 건너뛰는 자리 */
  onset?: (audio: Blob, signal?: AbortSignal) => Promise<OnsetCurve>;
  /**
   * 구조 분석 결과를 위로 올린다. **여기서 계산하지 않는다** — 이 파일은
   * 결선만 하는 자리이고, 구간을 마디로 옮기고 라벨을 다시 붙이는 것은
   * `core/analysis/sections.ts`의 일이다.
   */
  onStructure?: (structure: SidecarStructure | null) => void;
  /**
   * 구간(1차 좌표). **여기서 계산하지 않고 받는다** — `analysis.tsx`가 이미
   * `sectionsFromSegments`로 만들어 `StructureCard`에 넘기고 있고, 두 벌을
   * 만들면 드럼 표의 `Chorus 2`와 구조 표의 `Chorus 2`가 갈릴 수 있다.
   *
   * 파생값이라 **새 상태도 새 파일 이름 가드도 필요 없다** — 위층이 이미
   * `structure.file === state.file.name`으로 막아 두었다.
   */
  sections?: readonly Section[];
  /** 테스트가 드럼 검출을 건너뛰는 자리 */
  drums?: DrumPanelProps["detect"];
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

/**
 * 기동을 기다리는 기본값. **개발 서버에서만 기다린다** — 빌드된 앱에는
 * 사이드카를 띄워 줄 개발 서버가 없으므로(`vite-sidecar.ts`) 기다리는 것이
 * 거짓말이 된다. 모듈 상수인 것은 참조가 바뀌면 아래 이펙트가 다시 돌기
 * 때문이다.
 */
const STARTUP_WAIT = { budgetMs: import.meta.env.DEV ? 60_000 : 0 };

export function TranscriptionPanel({
  report,
  file,
  audio,
  env,
  probe = detect,
  startup = STARTUP_WAIT,
  run = analyzeWithSidecar,
  onset = (blob, signal) => extractOnset(blob, {}, signal),
  onStructure,
  sections,
  drums,
}: TranscriptionPanelProps) {
  // null = 아직 확인 중, "starting" = 개발 서버가 띄우는 중, false = 없음
  const [health, setHealth] = useState<SidecarHealth | null | false | "starting">(null);
  const [state, setState] = useState<State>({ name: "idle" });
  const running = useRef<AbortController | null>(null);

  /**
   * **한 번 묻고 끝내지 않는다.** 개발 서버가 사이드카를 함께 띄우는데
   * (`vite-sidecar.ts`) torch를 불러오느라 기동에 십수 초가 걸린다 — 첫 물음만
   * 보고 "꺼져 있다"고 말하면 사용자는 여전히 명령어 카드를 본다.
   *
   * 그래도 **처음부터 "켜는 중"을 띄우지는 않는다.** 이미 떠 있으면 1초 안에
   * 준비 상태가 되는데 그 사이에 다른 문구가 스치면 깜빡임이 된다 — 확인 중에
   * 아무것도 안 그리는 지금 방침의 연장이다.
   */
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    void probe(env).then(async (found) => {
      if (!alive) return;
      if (found) {
        setHealth(found);
        return;
      }
      const budget = startup.budgetMs ?? 0;
      if (budget <= 0) {
        setHealth(false);
        return;
      }
      setHealth("starting");
      const late = await waitForSidecar(env, budget, startup.retryMs, controller.signal);
      if (alive) setHealth(late ?? false);
    });
    return () => {
      alive = false;
      // 화면을 떠나면 폴링도 끝난다. 안 그러면 최대 1분을 혼자 더 묻는다
      controller.abort();
    };
  }, [env, probe, startup]);

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
      // 코드 인식을 닫아 둔 동안은 악보에도 심볼을 안 얹는다(`CHORDS_VISIBLE`)
      chords: CHORDS_VISIBLE
        ? report.chords.map((chord) => ({
            atSec: chord.startSec,
            root: chord.root,
            kind: chord.kind,
            text: chord.suffix,
          }))
        : [],
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
  if (health === "starting") return <SidecarStarting />;
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
          report={report}
          transcription={transcription}
          bpm={report.tempo.bpm}
          beatsPerBar={report.meter.beatsPerBar}
          title={file.name}
          musicalKey={{ tonic: report.key.tonic, mode: report.key.mode }}
          audio={audio}
          env={env}
          sections={sections}
          drums={drums}
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

/**
 * 개발 서버가 사이드카를 띄우는 중. **명령어를 보여 주지 않는다** — 사용자가
 * 할 일이 없기 때문이다. 여기서 명령을 함께 띄우면 기다리면 되는 상황에
 * 터미널을 열게 만든다.
 */
function SidecarStarting() {
  return (
    <Panel title="AI 분석" meta="사이드카를 켜는 중">
      <p className="muted">
        개발 서버가 로컬 분석 서버를 함께 띄우고 있다. 모델을 불러오느라 십수 초
        걸리고, 끝나면 이 자리가 저절로 바뀐다 — 위의 BPM·박자·조성·코드는 이미
        나와 있으니 그동안 그것부터 보면 된다.
      </p>
    </Panel>
  );
}

/**
 * 끝내 응답이 없을 때. 자동 실행이 붙은 뒤로 여기 오는 길은 셋뿐이다 —
 * `server/.venv`가 없거나, `SIDECAR_AUTOSTART=0`이거나, 빌드된 앱이라 띄워 줄
 * 개발 서버가 없거나. **그래서 명령어는 그대로 남긴다** — 그 셋에서는 여전히
 * 이것이 정답이다.
 */
function SidecarMissing() {
  return (
    <Panel title="AI 분석" meta="사이드카가 꺼져 있다">
      <p className="muted">
        스템 분리·멜로디 전사·<strong>비트 추적</strong>은 학습된 모델이 필요해
        브라우저 안에서 끝나지 않는다. 보통은 <code>npm run dev</code>가 로컬
        서버를 함께 띄우는데 응답이 없다 — 아래를 한 번 돌려 두면 다음부터는
        저절로 뜬다. <strong>2026-09-12부터는 BPM·박자·코드·악보도 이것 없이는
        안 나온다</strong>(템포를 자기상관에서 모델로 옮겼다).
      </p>
      <pre className="code">
        cd server{"\n"}
        python3.11 -m venv .venv &amp;&amp; .venv/bin/pip install -r requirements.txt{"\n"}
        .venv/bin/uvicorn app.main:app --port 8420
      </pre>
    </Panel>
  );
}

function Results({
  result,
  report,
  transcription,
  bpm,
  beatsPerBar,
  title,
  musicalKey,
  audio,
  env,
  sections,
  drums,
  onRetry,
}: {
  result: SidecarResult;
  report: AnalysisReport;
  transcription: Transcription;
  bpm: number;
  beatsPerBar: number;
  title: string;
  musicalKey: { tonic: number; mode: "major" | "minor" };
  audio: AudioBackend;
  env?: SidecarEnv;
  sections?: readonly Section[];
  drums?: DrumPanelProps["detect"];
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
  // **주소가 아니라 목록을 memo한다** — blob은 이펙트가 만들어야 한다
  // (`useDownloads`의 첫 주석). 여기서는 무엇을 내보낼지만 정한다.
  const sources = useMemo<DownloadSource[]>(
    () => [
      {
        label: "MIDI (노래한 그대로)",
        filename: "melody-performed.mid",
        data: files.performed as BlobPart,
        type: "audio/midi",
      },
      {
        label: "MIDI (격자)",
        filename: "melody-quantized.mid",
        data: files.quantized as BlobPart,
        type: "audio/midi",
      },
      {
        label: "MusicXML (악보)",
        filename: "melody.musicxml",
        data: transcription.musicXml,
        type: MUSICXML_TYPE,
      },
      {
        // 가사가 있어야 가창 합성기가 발음한다(`transcribe.VOCAL_LYRIC`)
        label: "MusicXML (가사 la · 신스V)",
        filename: "melody-la.musicxml",
        data: transcription.vocalXml,
        type: MUSICXML_TYPE,
      },
      {
        // **음표만 주면 신스V의 AI가 자기 피치 커브를 새로 만들어 붙인다.**
        // 이 파일에는 원 보컬의 f0가 컨트롤 점으로 들어 있어 비브라토·
        // 포르타멘토·스쿠핑이 그대로 간다(`core/transcribe/svp.ts`).
        label: "신스V 프로젝트 (피치 커브 포함)",
        filename: "melody.svp",
        data: svp,
        type: "application/octet-stream",
      },
    ],
    [files, svp, transcription],
  );
  const downloads = useDownloads(sources);

  const range = transcription.notes.length
    ? `${Math.min(...transcription.notes.map((n) => n.midi))}~${Math.max(
        ...transcription.notes.map((n) => n.midi),
      )}`
    : "—";
  const drift = driftText(transcription);

  return (
    <>
      {/*
        **후처리 보컬(`vocal_processed`)은 목록에 없다.** 파이프라인 내부의
        중간 신호라 듣는 값이 없고(HPF·게이트·정규화를 지난 것이라 보컬 스템과
        거의 같게 들린다) 줄만 하나 더 늘린다. 서버는 여전히 만들고 `onsetOf`가
        가져다 쓴다 — 재발음 경계가 거기서 난다. 지우려면 그쪽부터 볼 것.
      */}
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

      <ScorePlayer
        transcription={transcription}
        bpm={bpm}
        audio={audio}
        title={title}
      />
      <p className="muted">
        악보는 <strong>검수 전제의 초안이다</strong> — 이명동음(F♯/G♭)·성부
        분리·잇단음표는 자동으로 정해지지 않는다.
      </p>

      {/*
        **드럼은 여기 산다.** 스템은 이미 위에서 나왔고, 이 자리라야 재분석
        (`forceBpm`)이 `TranscriptionPanel` 상태를 안 건드려 검출 결과가 살아남는다.
      */}
      <DrumPanel
        jobId={result.jobId}
        report={report}
        sections={sections}
        env={env}
        detect={drums}
      />

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


