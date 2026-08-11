/**
 * 화면들.
 *
 *   HomePage      도메인 3개 (청음 / 화성학 / 음악분석도구)
 *     └ CatalogPage  **2분할** — 왼쪽에 메뉴 이름, 오른쪽에 설명과 옵션
 *         ├ QuizPage     문항형 — 진행·타이머·판정 크롬 + 스테이지 화면
 *         ├ PlannedPage  준비 중 — 무엇을 할 것이고 무엇이 필요한지
 *         └ ResultPage   문항형이 끝난 뒤
 *
 * 활동 종류(catalog.Kind)에 따라 화면이 갈린다. **QuizPage는 문항형 전용이다.**
 * 코드 학습(연주형)이나 분석 콘솔(도구)을 여기에 태우지 말 것.
 *
 * ## 옵션은 활동이 아니라 **한 번의 실행**에 붙는다
 *
 * 제한시간·라운드는 `CatalogPage`의 오른쪽에서 고르고 `withOptions()`로 활동의
 * `SessionConfig`에 얹혀 `QuizPage`로 간다. 카탈로그의 `config`는 **기본값**일
 * 뿐 실행 중에 바뀌지 않는다 — 프리셋은 여러 화면이 공유하는 객체다.
 */

import { useCallback, useEffect, useState } from "react";

import {
  type Activity,
  DOMAIN_SUMMARY,
  Domain,
  Kind,
  byDomain,
  counts,
  isReady,
} from "../core/catalog";
import {
  type PracticeOptions,
  ROUND_STEPS,
  type SessionConfig,
  TIME_STEPS,
  optionsOf,
  stepIndex,
} from "../core/config";
import { isStageResponse, responseText } from "../core/questions";
import { type Result, timedOut } from "../core/session";
import { noteNames } from "../core/theory";
import type { AudioBackend } from "../core/audio";
import {
  Button,
  Card,
  DeviceStatus,
  Fieldset,
  MenuList,
  Overlay,
  PageHeading,
  PlannedNotice,
  ScoreSummary,
  SessionHeader,
  SpecSection,
  SplitPane,
  Stack,
  StepSlider,
  TimerBar,
  Toggle,
  Verdict,
  type DeviceState,
  type ScoreRowProps,
  type VerdictTone,
} from "../ds";
import type { MidiEnv, MidiStatus } from "../platform/midi";
import { stageFor, usesMidiInput, usesTable } from "./stages";
import { useMidi } from "./useMidi";
import { useSession } from "./useSession";

// --- 홈 / 목록 / 준비 중 -------------------------------------------------------

export function HomePage({
  onPick,
  onSettings,
}: {
  onPick: (domain: Domain) => void;
  onSettings?: () => void;
}) {
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
      {/* 목록 아래. 연습을 고르는 것이 이 화면의 일이고 설정은 곁다리다 */}
      {onSettings && (
        <div className="home__footer">
          <Button onClick={onSettings}>설정</Button>
        </div>
      )}
    </Stack>
  );
}

const KIND_LABEL: Record<Kind, string> = {
  [Kind.Quiz]: "문항형",
  [Kind.Performance]: "연주형",
  [Kind.Tool]: "도구",
};

/** 눈금 문구. `null`이 무한이라는 것을 아는 곳은 여기와 core/config뿐이다. */
const TIME_LABELS = TIME_STEPS.map((v) => (v === null ? "무한" : `${v}초`));
const ROUND_LABELS = ROUND_STEPS.map((v) => (v === null ? "무한" : `${v}라운드`));

/**
 * 2분할의 오른쪽 — 고른 활동이 무엇이고 어떤 설정으로 시작할지.
 *
 * 옵션은 이 컴포넌트가 든다. 활동이 바뀌면 `key`로 통째로 다시 만들어져
 * 그 활동의 기본값에서 다시 시작한다 — 청음의 15초가 음정 연습으로 따라오지
 * 않는다.
 */
function ActivityDetail({
  activity,
  initialOptions,
  onStart,
}: {
  activity: Activity;
  /** 일시정지의 "옵션 설정"으로 돌아왔을 때 직전 값을 되살린다 */
  initialOptions?: PracticeOptions;
  onStart: (options: PracticeOptions) => void;
}) {
  const [options, setOptions] = useState<PracticeOptions>(
    () =>
      initialOptions ??
      (activity.config
        ? optionsOf(activity.config)
        : { timeLimitSec: 10, rounds: 10, showTable: false }),
  );
  const ready = isReady(activity);
  // 옵션이 뜻을 갖는 것은 문항형뿐이다. 도구는 제한시간도 라운드도 없다.
  const tunable = ready && activity.kind === Kind.Quiz && activity.config !== undefined;

  return (
    <Stack>
      <PageHeading
        title={activity.title}
        subtitle={`${activity.status} · ${KIND_LABEL[activity.kind]}`}
      />
      <p>{activity.summary}</p>

      <SpecSection title="여기서 하게 될 것" items={activity.features ?? []} />
      {!ready && (
        <SpecSection title="구현에 필요한 것" items={activity.requires ?? []} />
      )}

      {tunable && (
        <Fieldset title="옵션 설정">
          <StepSlider
            label="제한시간"
            steps={TIME_LABELS}
            index={stepIndex(TIME_STEPS, options.timeLimitSec)}
            hint="10초부터 1분까지. 한 칸 더 올리면 시간을 재지 않는다"
            onChange={(i) =>
              setOptions((o) => ({ ...o, timeLimitSec: TIME_STEPS[i] }))
            }
          />
          <StepSlider
            label="라운드"
            steps={ROUND_LABELS}
            index={stepIndex(ROUND_STEPS, options.rounds)}
            hint="무한으로 두면 ESC를 눌러 멈출 때까지 계속된다"
            onChange={(i) => setOptions((o) => ({ ...o, rounds: ROUND_STEPS[i] }))}
          />
          {/* 참고표가 있는 스테이지에서만 나온다 — 없는 화면에 켜 두면
              아무 일도 일어나지 않아 옵션이 고장 난 것처럼 보인다 */}
          {activity.config && usesTable(activity.config.stage) && (
            <Toggle
              label="표 보기"
              hint="음정표를 문제 화면에 함께 띄운다. 익으면 끄고 풀 것"
              checked={options.showTable}
              onChange={(showTable) => setOptions((o) => ({ ...o, showTable }))}
            />
          )}
        </Fieldset>
      )}

      {ready ? (
        <Button primary onClick={() => onStart(options)}>
          {tunable ? "연습 시작" : "열기"}
        </Button>
      ) : (
        <Button disabled>준비 중</Button>
      )}
    </Stack>
  );
}

export function CatalogPage({
  domain,
  selectedId,
  initialOptions,
  onStart,
}: {
  domain: Domain;
  /** 처음부터 골라 둘 항목. 일시정지에서 "옵션 설정"으로 올 때 쓴다 */
  selectedId?: string;
  initialOptions?: PracticeOptions;
  onStart: (activity: Activity, options: PracticeOptions) => void;
}) {
  const items = byDomain(domain);
  const [picked, setPicked] = useState(
    () => selectedId ?? items.find(isReady)?.id ?? items[0].id,
  );
  const activity = items.find((a) => a.id === picked) ?? items[0];

  return (
    <SplitPane
      menu={
        <>
          <PageHeading title={domain} subtitle={DOMAIN_SUMMARY[domain]} />
          <MenuList
            items={items.map((a) => ({
              id: a.id,
              label: a.title,
              badge: a.status,
              active: isReady(a),
            }))}
            selectedId={activity.id}
            onSelect={setPicked}
          />
        </>
      }
      detail={
        <ActivityDetail
          key={activity.id}
          activity={activity}
          initialOptions={activity.id === selectedId ? initialOptions : undefined}
          onStart={(options) => onStart(activity, options)}
        />
      }
    />
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
  if (isStageResponse(response)) return responseText(response);
  if (Array.isArray(response) && response.every((n) => typeof n === "number")) {
    return noteNames(response as number[], "없음");
  }
  return String(response);
}

/** MIDI 상태를 화면의 점 색으로. `ready`만 초록이다. */
const DEVICE_STATE: Record<MidiStatus, DeviceState> = {
  ready: "ok",
  requesting: "warn",
  "no-device": "warn",
  denied: "warn",
  unsupported: "off",
  insecure: "off",
  error: "off",
};

export function QuizPage({
  config,
  audio,
  onFinished,
  onOptions,
  midiEnv,
}: {
  config: SessionConfig;
  audio: AudioBackend;
  onFinished: (results: Result[]) => void;
  /** 일시정지의 "옵션 설정". 없으면 그 항목을 감춘다 */
  onOptions?: () => void;
  /** 테스트가 가짜 MIDIAccess를 넣는 자리. 앱에서는 넘기지 않는다 */
  midiEnv?: MidiEnv;
}) {
  const { view, start, replay, respond, noteOn, pause, resume } = useSession(
    config,
    audio,
  );
  const StageView = stageFor(config.stage);
  const midiStage = usesMidiInput(config.stage);

  // 건반 → Session.collect(). 자판 폴백과 정확히 같은 경로를 지난다.
  const midi = useMidi(
    midiStage,
    useCallback((note: number, velocity: number) => noteOn(note, velocity), [noteOn]),
    midiEnv,
  );

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
      // ESC는 어느 스테이지에서든 일시정지다. 무한 라운드에서 멈출 방법이
      // 이것뿐이므로 스테이지별 키 처리보다 먼저 가로챈다.
      if (event.key === "Escape") {
        event.preventDefault();
        if (view.paused) resume();
        else pause();
        return;
      }
      // 멈춰 있는 동안의 키는 전부 버린다. Session의 accepting 게이트가 이미
      // 막지만, 다시 듣기(Space)는 그 게이트 밖이라 여기서 막아야 한다.
      if (view.paused) return;
      if (event.code === "Space") {
        event.preventDefault();
        replay();
        return;
      }
      // 음정 스테이지는 같은 글자키를 성질 선택에 쓰므로 자판 폴백을 끈다
      // (stages.tsx가 먼저 가져간다). MIDI도 같은 조건으로 꺼진다.
      if (!usesMidiInput(config.stage)) return;
      const note = KEY_FALLBACK[event.key.toLowerCase()];
      if (note !== undefined) {
        event.preventDefault();
        noteOn(note);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [config.stage, noteOn, pause, replay, resume, view.paused]);

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
      {midiStage && (
        <DeviceStatus
          label="MIDI"
          state={DEVICE_STATE[midi.status]}
          detail={midi.message}
          actionLabel={midi.status === "unsupported" ? undefined : "다시 찾기"}
          onAction={midi.refresh}
        />
      )}
      <SessionHeader progress={view.progressText} score={view.score} />
      <TimerBar
        ratio={ratio}
        label={
          config.difficulty.timeLimitSec === null
            ? "시간 무제한"
            : remaining !== null && !result
              ? `${remaining.toFixed(1)}초`
              : ""
        }
      />

      {question && (
        <StageView
          question={question}
          locked={result !== null || !view.accepting}
          showTable={config.showTable}
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
      <p className="muted quiz__hint">ESC — 일시정지</p>

      {view.paused && (
        <Overlay title="일시정지" hint={`${view.progressText} · 점수 ${view.score}`}>
          <Button primary onClick={resume}>
            계속 진행하기 (ESC)
          </Button>
          <Button onClick={start}>처음부터 다시</Button>
          {onOptions && <Button onClick={onOptions}>옵션 설정</Button>}
        </Overlay>
      )}
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
