/**
 * 화면들.
 *
 *   HomePage      도메인 3개 (청음 / 화성학 / 음악분석도구)
 *     └ CatalogPage  그 도메인의 활동 목록
 *         ├ QuizPage     문항형 — 진행·타이머·판정 크롬 + 스테이지 화면
 *         ├ PlannedPage  준비 중 — 무엇을 할 것이고 무엇이 필요한지
 *         └ ResultPage   문항형이 끝난 뒤
 *
 * 활동 종류(catalog.Kind)에 따라 화면이 갈린다. **QuizPage는 문항형 전용이다.**
 * 코드 학습(연주형)이나 분석 콘솔(도구)을 여기에 태우지 말 것.
 */

import { useEffect } from "react";

import {
  type Activity,
  DOMAIN_SUMMARY,
  Domain,
  Status,
  byDomain,
  counts,
  isReady,
} from "../core/catalog";
import { type SessionConfig, Stage } from "../core/config";
import {
  type IntervalResponse,
  isIntervalResponse,
  responseText,
} from "../core/questions";
import { type Result, timedOut } from "../core/session";
import { noteName } from "../core/theory";
import type { AudioBackend } from "../core/audio";
import {
  Button,
  Card,
  PageHeading,
  PlannedNotice,
  ScoreSummary,
  SessionHeader,
  Stack,
  TimerBar,
  Verdict,
  type ScoreRowProps,
  type VerdictTone,
} from "../ds";
import { stageFor } from "./stages";
import { useSession } from "./useSession";

// --- 홈 / 목록 / 준비 중 -------------------------------------------------------

export function HomePage({ onPick }: { onPick: (domain: Domain) => void }) {
  return (
    <Stack>
      <PageHeading title="무엇을 연습할까요" center />
      {Object.values(Domain).map((domain) => {
        const [done, total] = counts(domain);
        return (
          <Card
            key={domain}
            title={domain}
            summary={DOMAIN_SUMMARY[domain]}
            badge={`${done} / ${total}`}
            active={done > 0}
            onClick={() => onPick(domain)}
          />
        );
      })}
    </Stack>
  );
}

export function CatalogPage({
  domain,
  onPick,
}: {
  domain: Domain;
  onPick: (activity: Activity) => void;
}) {
  return (
    <Stack>
      <PageHeading title={domain} subtitle={DOMAIN_SUMMARY[domain]} />
      {byDomain(domain).map((activity) => (
        <Card
          key={activity.id}
          title={activity.title}
          summary={activity.summary}
          badge={activity.status}
          active={isReady(activity)}
          onClick={() => onPick(activity)}
        />
      ))}
    </Stack>
  );
}

/**
 * 아직 만들지 않은 활동. 무엇을 할 것이고 무엇이 필요한지를 그대로 보여준다.
 * 빈 화면보다 낫다 — 카탈로그에 적어 둔 메모가 그대로 명세 역할을 한다.
 */
export function PlannedPage({ activity }: { activity: Activity }) {
  return (
    <PlannedNotice
      title={activity.title}
      meta={`${activity.status} · ${activity.kind}`}
      summary={activity.summary}
      sections={[
        { title: "여기서 하게 될 것", items: activity.features ?? [] },
        { title: "구현에 필요한 것", items: activity.requires ?? [] },
      ]}
    />
  );
}

// --- 문항형 -------------------------------------------------------------------

function answerLabel(response: unknown): string {
  if (Array.isArray(response) && response.every((n) => typeof n === "number")) {
    return response.length
      ? [...(response as number[])].sort((a, b) => a - b).map(noteName).join(" ")
      : "없음";
  }
  if (isIntervalResponse(response)) return responseText(response as IntervalResponse);
  return String(response);
}

export function QuizPage({
  config,
  audio,
  onFinished,
}: {
  config: SessionConfig;
  audio: AudioBackend;
  onFinished: (results: Result[]) => void;
}) {
  const { view, start, replay, respond, noteOn } = useSession(config, audio);
  const StageView = stageFor(config.stage);

  useEffect(() => {
    start();
    // start는 config가 바뀔 때만 다시 불려야 한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(() => {
    if (view.finished && view.results.length) onFinished(view.results);
  }, [onFinished, view.finished, view.results]);

  // Space = 다시 듣기. 자판 폴백은 MIDI 스테이지에서만 (음정 스테이지는
  // 같은 키를 숫자·성질 입력에 쓰므로 stages.tsx가 먼저 가져간다).
  useEffect(() => {
    const KEY_FALLBACK: Record<string, number> = {
      a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66,
      g: 67, y: 68, h: 69, u: 70, j: 71, k: 72,
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === "Space") {
        event.preventDefault();
        replay();
        return;
      }
      // 음정 스테이지는 같은 글자키를 성질 선택에 쓰므로 자판 폴백을 끈다
      // (stages.tsx가 먼저 가져간다).
      if (config.stage === Stage.IntervalId) return;
      const note = KEY_FALLBACK[event.key.toLowerCase()];
      if (note !== undefined) {
        event.preventDefault();
        noteOn(note);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [config.stage, noteOn, replay]);

  const { question, result, remaining, ratio } = view;
  const verdict: { text: string; tone: VerdictTone } = result
    ? result.correct
      ? { text: "정답", tone: "correct" }
      : timedOut(result)
        ? { text: "시간 초과", tone: "timeout" }
        : { text: "오답", tone: "wrong" }
    : { text: view.accepting ? "들어보세요" : "···", tone: "neutral" };

  return (
    <Stack>
      <SessionHeader progress={view.progressText} score={view.score} />
      <TimerBar
        ratio={ratio}
        label={remaining !== null && !result ? `${remaining.toFixed(1)}초` : ""}
      />

      {question && (
        <StageView
          question={question}
          locked={result !== null || !view.accepting}
          onAnswer={respond}
        />
      )}

      <div className="spacer" />
      <Verdict
        text={verdict.text}
        tone={verdict.tone}
        detail={result ? result.detail : question?.prompt}
      />
      <div className="spacer" />

      <Button onClick={replay}>다시 듣기 (Space)</Button>
    </Stack>
  );
}

export function ResultPage({
  results,
  total,
  onRestart,
  onBackToCatalog,
}: {
  results: Result[];
  total: number;
  onRestart: () => void;
  onBackToCatalog: () => void;
}) {
  const rows: ScoreRowProps[] = results.map((r) => ({
    correct: r.correct,
    answer: r.question.answerText,
    meta:
      (timedOut(r) ? "시간 초과" : `${r.seconds.toFixed(1)}초`) +
      (!r.correct && !timedOut(r) ? ` · 낸 답 ${answerLabel(r.response)}` : ""),
  }));
  return (
    <ScoreSummary
      score={results.filter((r) => r.correct).length}
      total={total}
      rows={rows}
      actions={
        <>
          <Button primary onClick={onRestart}>
            한 번 더
          </Button>
          <Button onClick={onBackToCatalog}>다른 연습 고르기</Button>
        </>
      }
    />
  );
}

export { Status };
