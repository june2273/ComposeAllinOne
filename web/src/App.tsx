/**
 * 앱 셸 — 화면 전환과 상태.
 *
 * 활동 종류(catalog.Kind)가 화면을 고른다. quiz가 아니면 전용 화면이 생길
 * 때까지 PlannedPage로 보낸다 — 연주형·도구형을 문항형 화면에 태우는 실수를
 * 구조가 막는다.
 */

import { useCallback, useRef, useState } from "react";

import { type Activity, Domain, Kind, Status } from "./core/catalog";
import type { AudioBackend } from "./core/audio";
import { type PracticeOptions, withOptions } from "./core/config";
import { makeAudioBackend } from "./platform/piano";
import type { Result } from "./core/session";
import { NavBar } from "./ds";
import { AnalysisPage } from "./ui/analysis";
import {
  CatalogPage,
  HomePage,
  PlannedPage,
  QuizPage,
  ResultPage,
} from "./ui/pages";
import { SettingsDialog } from "./ui/settings";
import { useTheme } from "./ui/useTheme";
import "./ui/styles/app.css";

type Screen =
  | { name: "home" }
  /** 2분할 메뉴. selectedId·options는 일시정지에서 "옵션 설정"으로 돌아올 때 쓴다 */
  | { name: "catalog"; domain: Domain; selectedId?: string; options?: PracticeOptions }
  | { name: "activity"; activity: Activity; options: PracticeOptions }
  | { name: "result"; activity: Activity; options: PracticeOptions; results: Result[] };

/**
 * 활동 하나를 어느 화면에 태울지 고른다.
 *
 * **종류(Kind)가 화면을 고르는 자리는 여기 하나다.** 연주형은 아직 화면이
 * 없으므로 준비 중으로 간다 — 문항형 화면에 태우면 문제 큐·제한시간·정답
 * 판정이 전부 어긋난다.
 *
 * 옵션(제한시간·라운드)이 설정에 얹히는 곳도 여기다. 카탈로그의 `config`는
 * 기본값이고 실제로 도는 것은 `withOptions()`가 만든 사본이다.
 */
function ActivityScreen({
  activity,
  options,
  run,
  audio,
  onFinished,
  onOptions,
}: {
  activity: Activity;
  options: PracticeOptions;
  run: number;
  audio: AudioBackend;
  onFinished: (results: Result[]) => void;
  onOptions: () => void;
}) {
  if (activity.status === Status.Planned) return <PlannedPage activity={activity} />;
  if (activity.kind === Kind.Tool) return <AnalysisPage />;
  if (activity.kind === Kind.Quiz && activity.config) {
    return (
      <QuizPage
        key={`${activity.id}#${run}`}
        config={withOptions(activity.config, options)}
        audio={audio}
        onFinished={onFinished}
        onOptions={onOptions}
      />
    );
  }
  return <PlannedPage activity={activity} />;
}

export default function App() {
  // 피아노 샘플을 배경에서 받는다. 준비 전에는 사인 신스로 난다.
  //
  // **useMemo를 쓰면 안 된다**(실측). StrictMode가 팩토리를 두 번 부르는데,
  // 오디오 백엔드는 AudioContext와 1.3MiB 샘플을 들고 있어서 버려지는 쪽도
  // 자원을 그대로 잡는다 — 샘플을 두 번 내려받는 것을 네트워크 로그로 확인했다.
  // ref는 두 번째 호출 자체가 일어나지 않는다.
  const audioRef = useRef<AudioBackend | null>(null);
  audioRef.current ??= makeAudioBackend();
  const audio = audioRef.current;
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  // "한 번 더"가 세션을 새로 만들도록 강제하는 키
  const [run, setRun] = useState(0);
  // **설정은 화면(Screen)이 아니라 그 위에 뜨는 창이다.** 화면으로 두면 뒤로가기
  // 경로에 끼어들고, 어느 화면에서 열었는지를 기억해야 한다.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { theme, dark, setTheme } = useTheme();

  const openActivity = useCallback(
    (activity: Activity, options: PracticeOptions) => {
      setRun((n) => n + 1);
      setScreen({ name: "activity", activity, options });
    },
    [],
  );

  /** 일시정지 → 옵션 설정. 고른 항목과 값을 그대로 들고 메뉴로 돌아간다. */
  const openOptions = useCallback(() => {
    setScreen((current) =>
      current.name === "activity"
        ? {
            name: "catalog",
            domain: current.activity.domain,
            selectedId: current.activity.id,
            options: current.options,
          }
        : current,
    );
  }, []);

  const goBack = useCallback(() => {
    setScreen((current) => {
      if (current.name === "home") return current;
      if (current.name === "catalog") return { name: "home" };
      return {
        name: "catalog",
        domain: current.activity.domain,
        selectedId: current.activity.id,
        options: current.options,
      };
    });
  }, []);

  const onFinished = useCallback(
    (results: Result[]) => {
      setScreen((current) =>
        current.name === "activity"
          ? {
              name: "result",
              activity: current.activity,
              options: current.options,
              results,
            }
          : current,
      );
    },
    [],
  );

  const path: string[] =
    screen.name === "home"
      ? []
      : screen.name === "catalog"
        ? [screen.domain]
        : screen.name === "activity"
          ? [screen.activity.domain, screen.activity.title]
          : [screen.activity.domain, screen.activity.title, "결과"];

  return (
    <div className="app">
      <NavBar path={path} onBack={goBack} />

      {screen.name === "home" && (
        <HomePage
          onPick={(domain) => setScreen({ name: "catalog", domain })}
          onSettings={() => setSettingsOpen(true)}
        />
      )}

      {screen.name === "catalog" && (
        <CatalogPage
          domain={screen.domain}
          selectedId={screen.selectedId}
          initialOptions={screen.options}
          onStart={openActivity}
        />
      )}

      {screen.name === "activity" && <ActivityScreen
        activity={screen.activity}
        options={screen.options}
        run={run}
        audio={audio}
        onFinished={onFinished}
        onOptions={openOptions}
      />}

      {screen.name === "result" && (
        <ResultPage
          results={screen.results}
          total={screen.options.rounds ?? screen.results.length}
          onRestart={() => openActivity(screen.activity, screen.options)}
          onBackToCatalog={() =>
            setScreen({ name: "catalog", domain: screen.activity.domain })
          }
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          theme={theme}
          dark={dark}
          onTheme={setTheme}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
