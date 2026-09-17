/**
 * 전사 악보 — 그리기 · 재생 · 인쇄.
 *
 * `transcription.tsx`에서 갈라져 나왔다. 악보를 그리는 일과 그것을 소리로 내는
 * 일은 사이드카와 아무 상관이 없고(순수 로직 + 오디오 백엔드뿐이다), 한 파일에
 * 두면 전사 패널이 계속 부푼다.
 *
 * **재생 시계는 `AudioContext`다.** `requestAnimationFrame`은 화면을 갱신할
 * 뿐이고 어디를 연주 중인지는 `Sequence.positionSec()`이 정한다 — rAF를 기준
 * 시계로 삼으면 탭이 배경으로 가거나 렌더가 밀릴 때 커서가 소리와 어긋난다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AudioBackend, Sequence, SequenceNote } from "../core/audio";
import {
  type RenderedScore,
  ScoreRenderer,
  activeIdsAt,
  activeTracks,
  timeMapping,
  timemapMsAt,
} from "../core/score";
import type { Transcription } from "../core/transcribe";
import { printSheets } from "../platform/print";
import { Button, Hint, ProgressBar, StaffFigure, Toggle } from "../ds";

/** 강조할 것이 없을 때. 상수라서 매 프레임 새 배열이 내려가지 않는다 */
const NO_HIGHLIGHT: readonly string[] = [];

/** 마지막 음이 끝나고 이만큼 더 두고 멈춘다. 릴리스가 잘리지 않게 */
const TAIL_SEC = 0.5;
/** 화면 갱신 간격의 하한(초). 60Hz로 다시 그릴 이유가 없다 */
const REDRAW_SEC = 0.05;

export type PlayMode = "score" | "performed";

export interface PlayableSequence {
  readonly notes: readonly SequenceNote[];
  readonly totalSec: number;
}

/**
 * 재생할 음표를 만든다 — **순수 함수다.**
 *
 * | 모드 | 출처 | 시각 |
 * |---|---|---|
 * | `score` | `quantized`의 칸 번호 | `칸 × 60 / (bpm × 칸/박)` |
 * | `performed` | `notes` | 실제로 부른 초 |
 *
 * `score`가 기본인 이유는 요청이 "**악보**를 BPM 맞춰 재생"이기 때문이다. 이 식은
 * `toMidiFiles`가 격자 MIDI를 만들 때 쓰는 것과 같아서(`transcribe/midi.ts`),
 * 재생과 내려받은 `.mid`가 음표 단위로 일치한다.
 *
 * **앞의 빈 시간은 걷어낸다.** 못갖춘마디는 칸 번호가 음수이고 노래는 간주 뒤에
 * 시작하는데, 그대로 두면 재생 버튼을 누르고 몇 초를 기다리게 된다.
 */
export function buildSequence(
  transcription: Transcription,
  bpm: number,
  mode: PlayMode,
): PlayableSequence {
  const source =
    mode === "score"
      ? sequenceFromGrid(transcription, bpm)
      : transcription.notes.map((n) => ({
          midi: n.midi,
          startSec: n.startSec,
          endSec: n.endSec,
          velocity: n.velocity,
        }));
  if (!source.length) return { notes: [], totalSec: 0 };

  const origin = source[0].startSec;
  const notes = source.map((n) => ({
    ...n,
    startSec: n.startSec - origin,
    endSec: n.endSec - origin,
  }));
  return { notes, totalSec: Math.max(...notes.map((n) => n.endSec)) };
}

function sequenceFromGrid(
  transcription: Transcription,
  bpm: number,
): SequenceNote[] {
  const { grid, quantized } = transcription;
  // BPM이 0이면 나눗셈이 무한이 된다. 분석이 실패한 파일에서 실제로 0이 올 수 있다
  const perStep = bpm > 0 ? 60 / (bpm * grid.stepsPerBeat) : 0;
  if (!perStep) return [];
  return quantized.map((n) => ({
    midi: n.midi,
    startSec: n.startStep * perStep,
    endSec: n.endStep * perStep,
    velocity: n.velocity,
  }));
}

/** `0:12.3` */
function clock(seconds: number): string {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

/**
 * 악보를 굽는다. verovio가 없거나 MusicXML을 못 읽으면 `null`을 준다 —
 * **화면은 그래도 떠야 한다**(사이드카가 없어도 앱이 뜨는 것과 같은 방침).
 */
export function useScore(musicXml: string): RenderedScore | null {
  const [rendered, setRendered] = useState<RenderedScore | null>(null);
  useEffect(() => {
    let alive = true;
    setRendered(null);
    ScoreRenderer.load()
      .then((renderer) => {
        if (alive) setRendered(renderer.renderScore(musicXml));
      })
      .catch(() => {
        if (alive) setRendered(null);
      });
    return () => {
      alive = false;
    };
  }, [musicXml]);
  return rendered;
}

export interface ScorePlayerProps {
  transcription: Transcription;
  /** 분석이 잡은 템포. 격자 재생이 이 값에 맞춰 난다 */
  bpm: number;
  audio: AudioBackend;
  /** 인쇄본 제목이자 PDF 기본 파일명 */
  title: string;
}

export function ScorePlayer({
  transcription,
  bpm,
  audio,
  title,
}: ScorePlayerProps) {
  const rendered = useScore(transcription.musicXml);
  const [mode, setMode] = useState<PlayMode>("score");
  /** 재생 중인 위치(초). null이면 멈춰 있다 */
  const [position, setPosition] = useState<number | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const playing = useRef<Sequence | null>(null);
  const frame = useRef(0);

  const sequence = useMemo(
    () => buildSequence(transcription, bpm, mode),
    [transcription, bpm, mode],
  );

  // 타임맵은 악보가 바뀔 때만 다시 쌓는다. 매 프레임 하는 것은 이분 탐색뿐이다
  const tracks = useMemo(
    () => (rendered ? activeTracks(rendered.timemap) : []),
    [rendered],
  );
  const mapping = useMemo(
    () =>
      rendered ? timeMapping(rendered.timemap, 0, sequence.totalSec) : null,
    [rendered, sequence.totalSec],
  );

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    playing.current?.stop();
    playing.current = null;
    setPosition(null);
  }, []);

  // 화면을 떠날 때, 그리고 재생할 음표가 바뀔 때(모드 전환·재전사) 끊는다.
  // 안 끊으면 오디오 백엔드는 App이 들고 있으므로 화면 밖에서 계속 울린다.
  useEffect(() => stop, [stop, sequence]);

  const play = useCallback(() => {
    if (!sequence.notes.length) return;
    stop();
    const handle = audio.playSequence(sequence.notes);
    playing.current = handle;
    setPosition(0);

    let shown = 0;
    const tick = () => {
      const at = handle.positionSec();
      // 밖에서 멈췄다 (stop()이 먼저 불렸다)
      if (at === null) return;
      if (at > sequence.totalSec + TAIL_SEC) {
        stop();
        return;
      }
      if (at - shown >= REDRAW_SEC) {
        shown = at;
        setPosition(at);
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [audio, sequence, stop]);

  /**
   * 지금 울리는 음표의 id들.
   *
   * **격자 모드에서만 켠다.** 노래한 그대로는 소리와 악보에 적힌 자리가 다르므로
   * 커서를 붙이면 악보가 틀린 것처럼 보인다.
   */
  const highlight = useMemo(() => {
    if (position === null || mode !== "score" || !mapping || !rendered) {
      return NO_HIGHLIGHT;
    }
    return activeIdsAt(tracks, rendered.timemap, timemapMsAt(mapping, position));
  }, [position, mode, mapping, rendered, tracks]);

  const onPrint = useCallback(() => {
    setPrintError(null);
    ScoreRenderer.load()
      .then((renderer) => {
        printSheets(
          renderer.renderPages(transcription.musicXml),
          `${title} — 멜로디 악보`,
        );
      })
      .catch(() => {
        setPrintError("악보를 인쇄용으로 굽지 못했다. 다시 시도해 볼 것.");
      });
  }, [transcription.musicXml, title]);

  const empty = !transcription.notes.length;
  const ready = rendered !== null;

  return (
    <div className="player">
      <div className="player__controls">
        <Button
          primary
          disabled={empty}
          onClick={position === null ? play : stop}
        >
          {position === null ? "▶ 재생" : "■ 정지"}
        </Button>
        <span className="player__time">
          {clock(position ?? 0)} / {clock(sequence.totalSec)}
          {mode === "score" && ` · ${Math.round(bpm)} BPM`}
        </span>
        <span className="spacer" />
        <Button disabled={!ready} onClick={onPrint}>
          PDF로 내보내기
        </Button>
      </div>

      <Toggle
        label="노래한 그대로 재생"
        checked={mode === "performed"}
        hint={
          mode === "performed"
            ? "사람이 부른 타이밍 그대로. 악보와 자리가 다르므로 커서는 꺼진다"
            : "악보에 적힌 대로 — 분석한 BPM의 격자 위에서 난다"
        }
        disabled={empty}
        onChange={(on) => setMode(on ? "performed" : "score")}
      />

      <ProgressBar
        ratio={
          sequence.totalSec > 0
            ? Math.min(1, (position ?? 0) / sequence.totalSec)
            : 0
        }
      />

      <StaffFigure
        svg={rendered?.svg}
        tall
        highlight={highlight}
        follow
        fallback={empty ? "멜로디를 찾지 못했다" : "악보를 그리는 중…"}
      />

      {printError && <p className="muted">{printError}</p>}
      <Hint>
        인쇄 대화상자에서 <strong>대상을 “PDF로 저장”</strong>으로 고르면 A4 여러
        쪽짜리 악보 파일이 된다.
      </Hint>
    </div>
  );
}
