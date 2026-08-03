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
import { makeAudioBackend } from "./platform/piano";
import type { Result } from "./core/session";
import { NavBar } from "./ui/components";
import { AnalysisPage } from "./ui/analysis";
import {
  CatalogPage,
  HomePage,
  PlannedPage,
  QuizPage,
  ResultPage,
} from "./ui/pages";
import "./ui/styles/app.css";

type Screen =
  | { name: "home" }
  | { name: "catalog"; domain: Domain }
  | { name: "activity"; activity: Activity }
  | { name: "result"; activity: Activity; results: Result[] };

/**
 * 활동 하나를 어느 화면에 태울지 고른다.
 *
 * **종류(Kind)가 화면을 고르는 자리는 여기 하나다.** 연주형은 아직 화면이
 * 없으므로 준비 중으로 간다 — 문항형 화면에 태우면 문제 큐·제한시간·정답
 * 판정이 전부 어긋난다.
 */
function ActivityScreen({
  activity,
  run,
  audio,
  onFinished,
}: {
  activity: Activity;
  run: number;
  audio: AudioBackend;
  onFinished: (results: Result[]) => void;
}) {
  if (activity.status === Status.Planned) return <PlannedPage activity={activity} />;
  if (activity.kind === Kind.Tool) return <AnalysisPage />;
  if (activity.kind === Kind.Quiz && activity.config) {
    return (
      <QuizPage
        key={`${activity.id}#${run}`}
        config={activity.config}
        audio={audio}
        onFinished={onFinished}
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

  const openActivity = useCallback((activity: Activity) => {
    setRun((n) => n + 1);
    setScreen({ name: "activity", activity });
  }, []);

  const goBack = useCallback(() => {
    setScreen((current) => {
      if (current.name === "home") return current;
      if (current.name === "catalog") return { name: "home" };
      return { name: "catalog", domain: current.activity.domain };
    });
  }, []);

  const onFinished = useCallback(
    (results: Result[]) => {
      setScreen((current) =>
        current.name === "activity"
          ? { name: "result", activity: current.activity, results }
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
        <HomePage onPick={(domain) => setScreen({ name: "catalog", domain })} />
      )}

      {screen.name === "catalog" && (
        <CatalogPage domain={screen.domain} onPick={openActivity} />
      )}

      {screen.name === "activity" && <ActivityScreen
        activity={screen.activity}
        run={run}
        audio={audio}
        onFinished={onFinished}
      />}

      {screen.name === "result" && (
        <ResultPage
          results={screen.results}
          total={screen.activity.config?.questionCount ?? screen.results.length}
          onRestart={() => openActivity(screen.activity)}
          onBackToCatalog={() =>
            setScreen({ name: "catalog", domain: screen.activity.domain })
          }
        />
      )}
    </div>
  );
}
