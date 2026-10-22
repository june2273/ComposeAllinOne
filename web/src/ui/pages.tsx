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
 * ## 건반으로 답하는 스테이지의 입력 경로는 셋이다
 *
 * MIDI 건반 · 자판 · **화면의 가상 건반**. 셋이 전부 `useSession.noteOn` 하나로
 * 모이므로 락아웃·화음 확정 규칙이 똑같이 걸린다. 가상 건반은 **MIDI가 연결돼
 * 있지 않으면 기본으로 펴진다** — 그러지 않으면 `MidiStage`가 아무것도 그리지
 * 않아 화면에 답할 방법이 하나도 안 보인다(자판 폴백은 아는 사람만 안다).
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
  DEFAULT_OPTIONS,
  type PracticeOptions,
  ROUND_STEPS,
  type SessionConfig,
  TIME_STEPS,
  CIRCLE_SPANS,
  isCircleStage,
  isIntervalStage,
  isKeySignatureStage,
  isScaleStage,
  optionsOf,
  stepIndex,
  withOptions,
} from "../core/config";
import {
  CIRCLE_MODES,
  CIRCLE_MODE_LABEL,
  KEY_KINDS,
  KEY_KIND_LABEL,
} from "../core/harmony/keys";
import { KIND_STEP, SCALE_KINDS } from "../core/harmony/scales";
import { NO_SHIFT, noteFor, rangeKeys } from "../core/keyboard";
import { isStageResponse, responseText } from "../core/questions";
import { type Result, timedOut } from "../core/session";
import { noteName, noteNames } from "../core/theory";
import type { AudioBackend } from "../core/audio";
import {
  Button,
  Card,
  Fieldset,
  Keyboard,
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
  type ScoreRowProps,
  type VerdictTone,
} from "../ds";
import type { MidiEnv } from "../platform/midi";
import { stageFor, usesMidiInput, usesTable } from "./stages";
import { MidiRow } from "./components";
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

/** 초점이 글자를 받는 칸에 있는가. 창 전체 단축키가 비켜야 할 자리다 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

const KIND_LABEL: Record<Kind, string> = {
  [Kind.Quiz]: "문항형",
  [Kind.Performance]: "연주형",
  [Kind.Tool]: "도구",
  [Kind.Free]: "자유 연주",
};

/** 눈금 문구. `null`이 무한이라는 것을 아는 곳은 여기와 core/config뿐이다. */
const TIME_LABELS = TIME_STEPS.map((v) => (v === null ? "무한" : `${v}초`));
const ROUND_LABELS = ROUND_STEPS.map((v) => (v === null ? "무한" : `${v}라운드`));

/**
 * 음정 활동의 옵션 눈금.
 *
 * **단계는 눈금이 곧 `LEVEL_CONFIGS`의 인덱스**이고, 순서가 학습 순서다.
 * 음 범위는 음 하나에 붙일 임시표 수(`maxAlter`)다 — 늘리면 증·감이 늘고
 * 겹증·겹감, 겹겹증·겹겹감까지 나온다.
 */
const LEVEL_LABELS = ["연습 1 — 도수·반음", "연습 2 — 성질", "음정 이름"];
const ALTER_LABELS = ["온음계", "반음계 ♯♭", "겹임시표 ♯♯♭♭"];

/**
 * 음계 종류 눈금. **마지막 칸이 "전부 섞어서"**이고, 이름은 `scales.ts`가 갖는다 —
 * 여기서 손으로 적으면 문제 화면에 나오는 이름과 갈린다.
 */
const SCALE_LABELS = [...SCALE_KINDS.map((k) => KIND_STEP[k]), "전부 섞어서"];

/** 조표 유형. 이름은 `harmony/keys.ts`가 갖는다 — 여기서 또 적지 않는다 */
const KEY_LABELS = KEY_KINDS.map((k) => KEY_KIND_LABEL[k]);
const CIRCLE_LABELS = CIRCLE_SPANS.map((n) => `${n}칸`);

/** 5도권 조성 눈금. **마지막 칸이 "섞어서"**로 음계 종류와 같은 모양이다 */
const CIRCLE_MODE_LABELS = [
  ...CIRCLE_MODES.map((m) => CIRCLE_MODE_LABEL[m]),
  "섞어서",
];

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
      (activity.config ? optionsOf(activity.config) : DEFAULT_OPTIONS),
  );
  const ready = isReady(activity);
  // 옵션이 뜻을 갖는 것은 문항형뿐이다. 도구는 제한시간도 라운드도 없다.
  const tunable = ready && activity.kind === Kind.Quiz && activity.config !== undefined;
  // 음정 활동만 단계·음 범위·겹음정을 갖는다. **지금 고른 단계의 스테이지**를
  // 봐야 한다 — 활동의 기본 스테이지를 보면 단계를 옮겨도 표 보기가 안 따라온다.
  const interval = activity.config !== undefined && isIntervalStage(activity.config.stage);
  const scale = activity.config !== undefined && isScaleStage(activity.config.stage);
  const keySig = activity.config !== undefined && isKeySignatureStage(activity.config.stage);
  const circle = activity.config !== undefined && isCircleStage(activity.config.stage);
  // **지금 옵션이 만들어 낼 스테이지**를 그대로 묻는다. 단계·음정 해석이
  // 어느 프리셋을 고르는지는 `withOptions` 한 곳만 알면 된다 — 여기서 다시
  // 계산하면 옵션이 늘 때마다 두 곳이 갈린다.
  const stage = activity.config
    ? withOptions(activity.config, options).stage
    : undefined;

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
          {interval && (
            <>
              {/* 음정 해석에는 단계가 없다 — 스테이지가 하나뿐이라 눈금이
                  아무것도 안 바꾼다. 켜져 있는 동안 감춘다 */}
              {!options.build && (
                <StepSlider
                  label="단계"
                  steps={LEVEL_LABELS}
                  index={options.level}
                  hint="연습 1은 세는 법, 연습 2는 표 읽기, 음정 이름은 둘을 합친 것"
                  onChange={(level) => setOptions((o) => ({ ...o, level }))}
                />
              )}
              <Toggle
                label="음정 해석"
                hint="음 하나와 음정을 주면 나머지 음을 건반에서 찾는다. G4 · 장2도 · 위로면 A4 — 위·아래가 섞여 나온다"
                checked={options.build}
                onChange={(build) => setOptions((o) => ({ ...o, build }))}
              />
              <StepSlider
                label="음 범위"
                steps={ALTER_LABELS}
                index={options.maxAlter}
                hint="임시표를 허용하면 증·감이 늘고 겹증·겹감까지 나온다"
                onChange={(maxAlter) => setOptions((o) => ({ ...o, maxAlter }))}
              />
              <Toggle
                label="겹음정"
                hint="9도 이상도 낸다. 보이는 그대로 답한다 (E♭4–F5는 장9도)"
                checked={options.compound}
                onChange={(compound) => setOptions((o) => ({ ...o, compound }))}
              />
              <Toggle
                label="낮은음자리표"
                hint="낮은 자리의 음도 낸다. 자리표는 음이 정하므로 높은음자리표와 섞여 나온다"
                checked={options.bassClef}
                onChange={(bassClef) => setOptions((o) => ({ ...o, bassClef }))}
              />
            </>
          )}
          {scale && (
            <StepSlider
              label="음계 종류"
              steps={SCALE_LABELS}
              index={options.scaleKind}
              hint="Harmonic은 7음을, Melodic은 6·7음을 반음 올린 것이다. 마지막 칸은 넷이 섞여 나온다"
              onChange={(scaleKind) => setOptions((o) => ({ ...o, scaleKind }))}
            />
          )}
          {keySig && (
            <StepSlider
              label="유형"
              steps={KEY_LABELS}
              index={options.keyKind}
              hint="앞의 셋은 조표를 보고 으뜸음을, 넷째는 거꾸로 조표를 쓴다. 이명동음조는 ♯과 ♭ 개수의 합이 12인 셋이다"
              onChange={(keyKind) => setOptions((o) => ({ ...o, keyKind }))}
            />
          )}
          {circle && (
            <>
              <StepSlider
                label="빈칸 수"
                steps={CIRCLE_LABELS}
                index={options.circleSpan}
                hint="한 자리를 주면 그만큼 이어서 채운다. 방향은 문제마다 섞인다"
                onChange={(circleSpan) => setOptions((o) => ({ ...o, circleSpan }))}
              />
              <StepSlider
                label="조성"
                steps={CIRCLE_MODE_LABELS}
                index={options.circleMode}
                hint="자리는 장조와 단조가 같다 — 나란한조가 한 칸에 앉는다. 마지막 칸은 문제마다 섞인다"
                onChange={(circleMode) => setOptions((o) => ({ ...o, circleMode }))}
              />
            </>
          )}
          {/* 참고표가 있는 스테이지에서만 나온다 — 없는 화면에 켜 두면
              아무 일도 일어나지 않아 옵션이 고장 난 것처럼 보인다 */}
          {stage !== undefined && usesTable(stage) && (
            <Toggle
              label="표 보기"
              hint={
                keySig
                  ? "이명동음조 표(♯+♭=12)를 문제 화면에 함께 띄운다. 익으면 끄고 풀 것"
                  : "음정표를 문제 화면에 함께 띄운다. 익으면 끄고 풀 것"
              }
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
  const { noteLow: low, noteHigh: high } = config.difficulty;
  /**
   * 가상 건반을 편다. `null`이면 **MIDI 연결 여부가 정한다** — 사용자가 한 번
   * 접거나 펴면 그 뒤로는 그 선택을 따른다(그래서 boolean|null이다).
   */
  const [showKeys, setShowKeys] = useState<boolean | null>(null);

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
      /*
        **답을 글자로 받는 스테이지에서는 스페이스가 글자다.** 여기서 그대로
        가로채면 `preventDefault` 때문에 입력 칸에 공백이 안 들어가고, 치는 중에
        문제가 다시 울린다. 초점이 입력 칸에 있으면 아래를 통째로 비켜 준다 —
        ESC는 위에서 이미 처리했다(무한 라운드를 멈출 방법이 그것뿐이다).
      */
      if (isTyping(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        replay();
        return;
      }
      // 음정 스테이지는 같은 글자키를 성질 선택에 쓰므로 자판 폴백을 끈다
      // (stages.tsx가 먼저 가져간다). MIDI도 같은 조건으로 꺼진다.
      if (!usesMidiInput(config.stage)) return;
      // 표를 여기에 또 적지 않는다 — 화면의 가상 건반이 같은 표를 보고 글자를
      // 그리므로, 둘이 갈리면 **건반에 적힌 글자를 눌렀는데 다른 음이 난다.**
      const note = noteFor(NO_SHIFT, event.code);
      // 이 스테이지의 음역 밖은 애초에 답이 될 수 없다(화면에도 안 그려진다).
      if (note === null || note < low || note > high) return;
      event.preventDefault();
      noteOn(note);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [config.stage, high, low, noteOn, pause, replay, resume, view.paused]);

  const { question, result, remaining, ratio } = view;
  const audible = ((question?.cueNotes ?? question?.answerNotes)?.length ?? 0) > 0;
  // **연결돼 있지 않으면 편다.** 상태가 아직 "requesting"인 동안에도 펴 두는
  // 편이 낫다 — 권한 확인이 끝날 때까지 화면이 비어 있는 것보다는 낫고,
  // 실제로 연결되면 접힌다.
  const virtualKeys = showKeys ?? midi.status !== "ready";
  const keys = midiStage ? rangeKeys(low, high) : [];
  const verdict: { text: string; tone: VerdictTone } = result
    ? result.correct
      ? { text: "정답", tone: "correct" }
      : timedOut(result)
        ? { text: "시간 초과", tone: "timeout" }
        : { text: "오답", tone: "wrong" }
    // 소리가 없는 활동(조표·5도권)에서 "들어보세요"는 거짓말이다
    : { text: view.accepting ? (audible ? "들어보세요" : "읽어보세요") : "···", tone: "neutral" };

  return (
    <Stack>
      {midiStage && (
        <MidiRow midi={midi} />
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
          maxNumber={config.difficulty.maxIntervalNumber}
          maxAlter={config.difficulty.maxAlter}
          played={view.played}
          mistakes={view.mistakes}
          onAnswer={respond}
        />
      )}

      {midiStage && (
        <div className="quiz__keyboard">
          {virtualKeys && (
            <>
              <Keyboard
                label="가상 건반"
                keys={keys.map((key) => ({
                  id: String(key.midi),
                  // 여기서 고르는 것은 **음높이**다(자유 연주는 자판 자리를
                  // 고른다). 그래서 큰 글자와 작은 글자가 서로 반대다.
                  label: noteName(key.midi),
                  caption: key.label,
                  black: key.black,
                }))}
                // 스치고 지나간 건반이 전부 답으로 들어가면 안 된다
                glide={false}
                onPress={(id) => noteOn(Number(id))}
              />
              <p className="muted quiz__hint">
                자판 <b>{keys.filter((k) => k.label).map((k) => k.label).join(" ")}</b>
                로도 칠 수 있다
              </p>
            </>
          )}
          <Button onClick={() => setShowKeys(!virtualKeys)}>
            {virtualKeys ? "가상 건반 접기" : "가상 건반 펴기"}
          </Button>
        </div>
      )}

      <div className="spacer" />
      <Verdict
        text={verdict.text}
        tone={verdict.tone}
        detail={result ? result.detail : question?.prompt}
      />
      <div className="spacer" />

      {/* **들려줄 것이 없으면 단추를 감춘다.** 조표·5도권은 소리가 없는 활동이라
          `playNotes([])`가 조용히 아무것도 안 하고, 그러면 눌러도 반응이 없는
          단추가 남는다. 스테이지 목록을 또 손으로 들지 않고 문제에 물어본다 */}
      {audible && <Button onClick={replay}>다시 듣기 (Space)</Button>}
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
