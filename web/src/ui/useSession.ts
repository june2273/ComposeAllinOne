/**
 * 세션 컨트롤러 — 타이머와 입력을 `Session`에 이어 붙이는 얇은 층.
 *
 * Python/Qt판의 `SessionController`에 대응한다. 음악적 판단은 하나도 하지
 * 않는다. 무엇이 정답인지, 언제 확정할지는 Session·Grader·NoteCollector가
 * 정하고 여기서는 타이머만 건다.
 *
 * **문항형(Kind.Quiz) 전용이다.** 코드 학습 같은 연주형은 문제 큐가 아니라
 * 연속 타임라인이고 판정도 정답/오답이 아니라 빗나간 밀리초다. 별도의
 * 트랜스포트 훅이 필요하다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AudioBackend } from "../core/audio";
import type { SessionConfig } from "../core/config";
import { makeGrader } from "../core/grading";
import { type Question, Rng, makeGenerator } from "../core/questions";
import { Phase, type Result, Session } from "../core/session";

export interface SessionView {
  question: Question | null;
  /** 락아웃 중에는 false — 이때 들어온 입력은 전부 버려진다 */
  accepting: boolean;
  /** ESC로 멈춘 상태. 타이머가 서고 입력이 막힌다 */
  paused: boolean;
  progressText: string;
  score: number;
  /** 남은 초. 제한시간이 없으면 null */
  remaining: number | null;
  /** 남은 비율 0~1 */
  ratio: number;
  /** 채점 직후 표시할 결과. 다음 문제로 넘어가면 null */
  result: Result | null;
  finished: boolean;
  results: Result[];
  /**
   * 지금 문제에서 **받아들인 음**(순서대로). 순차 입력 스테이지에서만 찬다.
   *
   * 화면은 이것의 길이만큼 악보를 그린다 — 틀린 음은 수집기가 거부해서 여기
   * 안 들어오므로, 그린 것은 언제나 맞은 음이다.
   */
  played: readonly number[];
  /** 지금 문제에서 거부된 입력 횟수. 0이 아니면 정답이 될 수 없다 */
  mistakes: number;
}

const TICK_MS = 50;

export function useSession(
  config: SessionConfig,
  audio: AudioBackend,
  seed?: number,
) {
  const session = useMemo(
    () =>
      new Session(
        config,
        makeGenerator(config, seed === undefined ? undefined : new Rng(seed)),
        makeGrader(config.difficulty.grading),
      ),
    [config, seed],
  );

  const [view, setView] = useState<SessionView>({
    question: null,
    accepting: false,
    paused: false,
    progressText: "",
    score: 0,
    remaining: config.difficulty.timeLimitSec,
    ratio: 1,
    result: null,
    finished: false,
    results: [],
    played: [],
    mistakes: 0,
  });

  const startedAt = useRef(0);
  /** 멈춘 시점까지 이 문제에 쓴 시간. 재개하면 여기서부터 다시 흐른다 */
  const pausedAt = useRef(0);
  const nextRef = useRef<() => void>(() => {});
  const timers = useRef<number[]>([]);
  const ticker = useRef<number | null>(null);
  const confirmTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (ticker.current !== null) clearInterval(ticker.current);
    ticker.current = null;
    if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
    confirmTimer.current = null;
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    // 발화한 타이머는 목록에서 빼둔다. 안 그러면 세션이 길어질수록 이미 끝난
    // 핸들이 계속 쌓인다.
    const id = setTimeout(() => {
      timers.current = timers.current.filter((t) => t !== id);
      fn();
    }, ms) as unknown as number;
    timers.current.push(id);
  }, []);

  const sync = useCallback(
    (patch: Partial<SessionView> = {}) => {
      setView((prev) => ({
        ...prev,
        question: session.current,
        accepting: session.accepting,
        paused: session.paused,
        progressText: session.progressText,
        score: session.score,
        finished: session.finished,
        results: [...session.results],
        played: [...session.progress],
        mistakes: session.mistakes,
        ...patch,
      }));
    },
    [session],
  );

  const elapsed = useCallback(
    () => (performance.now() - startedAt.current) / 1000,
    [],
  );

  const play = useCallback(() => {
    const q = session.current;
    if (!q || !session.mayPlay()) return;
    session.notePlayed();
    audio.playNotes(
      // 답과 다를 수 있다 — 음정 해석은 **주어진 음**만 울린다
      q.cueNotes ?? q.answerNotes,
      config.playDurationSec,
      config.difficulty.playMode,
    );
  }, [audio, config, session]);

  const settle = useCallback(
    (result: Result | null) => {
      if (!result) return;
      if (ticker.current !== null) clearInterval(ticker.current);
      ticker.current = null;
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
      sync({ result, remaining: 0, ratio: 0 });
      // nextQuestion은 아래에서 정의되므로 ref로 최신 참조를 부른다
      later(() => nextRef.current(), config.feedbackMs);
    },
    [config.feedbackMs, later, sync],
  );

  /** 카운트다운 시작. 제한시간이 무한이면 아무것도 하지 않는다. */
  const startTicker = useCallback(() => {
    const limit = config.difficulty.timeLimitSec;
    if (limit === null) return;
    if (ticker.current !== null) clearInterval(ticker.current);
    ticker.current = setInterval(() => {
      const remaining = limit - elapsed();
      if (remaining <= 0) {
        settle(session.timeOut(elapsed()));
        return;
      }
      setView((prev) => ({ ...prev, remaining, ratio: remaining / limit }));
    }, TICK_MS) as unknown as number;
  }, [config.difficulty.timeLimitSec, elapsed, session, settle]);

  const beginListening = useCallback(() => {
    if (!session.current || session.finished) return;
    session.beginListening();
    sync({ result: null });
    play();
    startedAt.current = performance.now();
    startTicker();
  }, [play, session, startTicker, sync]);

  const nextQuestion = useCallback(() => {
    const question = session.nextQuestion();
    if (!question) {
      sync({ result: null });
      return;
    }
    // 락아웃이 풀릴 때까지 session.accepting이 false라 입력은 전부 버려진다.
    sync({
      result: null,
      remaining: config.difficulty.timeLimitSec,
      ratio: 1,
    });
    later(beginListening, config.inputLockoutMs);
  }, [
    beginListening,
    config.difficulty.timeLimitSec,
    config.inputLockoutMs,
    later,
    session,
    sync,
  ]);

  useEffect(() => {
    nextRef.current = nextQuestion;
  }, [nextQuestion]);

  const start = useCallback(() => {
    clearTimers();
    session.start();
    nextRef.current();
  }, [clearTimers, session]);

  const replay = useCallback(() => {
    if (session.accepting) play();
  }, [play, session]);

  // --- 일시정지 --------------------------------------------------------------
  //
  // 시간을 재는 쪽이 여기이므로 멈추는 것도 여기다. Session은 국면만 바꾼다.

  const pause = useCallback(() => {
    const before = session.phase;
    if (!session.pause()) return;
    // 듣던 중이었을 때만 시계가 의미를 갖는다. 락아웃 중이었다면 이 문제는
    // 아직 시작도 안 한 것이므로 0에서 다시 센다.
    pausedAt.current = before === Phase.Listening ? elapsed() : 0;
    // 카운트다운·피드백 전환·화음 확정 타이머를 전부 세운다. 재개할 때
    // 필요한 것만 다시 건다.
    clearTimers();
    sync();
  }, [clearTimers, elapsed, session, sync]);

  const resume = useCallback(() => {
    const from = session.resume();
    if (from === null) return;
    if (from === Phase.Feedback) {
      // 결과를 보던 중이었다면 남은 표시 시간을 기다리지 않고 다음 문제로 간다
      nextRef.current();
      return;
    }
    sync();
    // **재개해도 락아웃을 다시 준다.** 멈춰 있는 동안 눌린 키가 답으로 새는
    // 것을 막는 것이 4절 규칙의 취지다.
    later(() => {
      // 아직 들려주지 않은 문제(락아웃 중 정지)라면 재생부터 해야 한다.
      if (from === Phase.Lockout) {
        beginListening();
        return;
      }
      // 이미 들은 문제는 다시 들려주지 않는다 — 재생 횟수 축(replayLimit)을
      // 일시정지로 우회할 수 있으면 안 된다.
      session.beginListening();
      // 멈춰 있던 시간은 푸는 데 쓴 시간이 아니다. 그만큼 시계를 되돌린다.
      startedAt.current = performance.now() - pausedAt.current * 1000;
      sync({ result: null });
      startTicker();
    }, config.inputLockoutMs);
  }, [beginListening, config.inputLockoutMs, later, session, startTicker, sync]);

  /** 화면에서 만든 답(음정 등). MIDI 경로와 같은 게이트를 지난다. */
  const respond = useCallback(
    (response: unknown) => {
      settle(session.respond(response, elapsed()));
    },
    [elapsed, session, settle],
  );

  /** 건반 note-on 하나. 화음이면 조용해질 때까지 기다렸다 확정한다. */
  const noteOn = useCallback(
    (note: number, velocity = 80) => {
      if (config.echoBack) audio.playNotes([note], 0.5, "block", velocity);
      if (!session.collect(note)) {
        if (session.accepting && config.chordHoldMs > 0) {
          if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
          confirmTimer.current = setTimeout(() => {
            settle(session.submit(elapsed()));
          }, config.chordHoldMs) as unknown as number;
        } else if (config.inputForm === "sequence") {
          /*
            **순차 입력은 확정 전에도 화면이 바뀐다.** 받아들인 음이 악보에
            하나씩 쌓이고 거부된 입력이 실수로 세어지는데, `settle`이 부르는
            `sync`는 채점이 끝나야 돌아서 그때까지 아무것도 안 그려진다.
            집합 입력에서는 보일 것이 없으므로 이 분기를 지나지 않는다.
          */
          sync();
        }
        return;
      }
      settle(session.submit(elapsed()));
    },
    [
      audio,
      config.chordHoldMs,
      config.echoBack,
      config.inputForm,
      elapsed,
      session,
      settle,
      sync,
    ],
  );

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { view, start, replay, respond, noteOn, pause, resume, session };
}
