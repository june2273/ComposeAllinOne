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
import { type Result, Session } from "../core/session";

export interface SessionView {
  question: Question | null;
  /** 락아웃 중에는 false — 이때 들어온 입력은 전부 버려진다 */
  accepting: boolean;
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
    progressText: "",
    score: 0,
    remaining: config.difficulty.timeLimitSec,
    ratio: 1,
    result: null,
    finished: false,
    results: [],
  });

  const startedAt = useRef(0);
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
        progressText: session.progressText,
        score: session.score,
        finished: session.finished,
        results: [...session.results],
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
      q.answerNotes,
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

  const beginListening = useCallback(() => {
    if (!session.current || session.finished) return;
    session.beginListening();
    sync({ result: null });
    play();
    startedAt.current = performance.now();

    const limit = config.difficulty.timeLimitSec;
    if (limit === null) return;
    ticker.current = setInterval(() => {
      const remaining = limit - elapsed();
      if (remaining <= 0) {
        settle(session.timeOut(elapsed()));
        return;
      }
      setView((prev) => ({ ...prev, remaining, ratio: remaining / limit }));
    }, TICK_MS) as unknown as number;
  }, [config.difficulty.timeLimitSec, elapsed, play, session, settle, sync]);

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
        }
        return;
      }
      settle(session.submit(elapsed()));
    },
    [audio, config.chordHoldMs, config.echoBack, elapsed, session, settle],
  );

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { view, start, replay, respond, noteOn, session };
}
