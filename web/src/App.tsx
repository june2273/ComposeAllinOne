/**
 * 앱 셸 — 화면 전환과 상태.
 *
 * 활동 종류(catalog.Kind)가 화면을 고른다. quiz가 아니면 전용 화면이 생길
 * 때까지 PlannedPage로 보낸다 — 연주형·도구형을 문항형 화면에 태우는 실수를
 * 구조가 막는다.
 */

import { useCallback, useMemo, useState } from "react";

import { type Activity, Domain, Kind, Status } from "./core/catalog";
import { makeDefaultBackend } from "./core/audio";
import type { Result } from "./core/session";
import { NavBar } from "./ui/components";
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

export default function App() {
  const audio = useMemo(makeDefaultBackend, []);
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

      {screen.name === "activity" &&
        (screen.activity.status === Status.Planned ||
        screen.activity.kind !== Kind.Quiz ||
        !screen.activity.config ? (
          <PlannedPage activity={screen.activity} />
        ) : (
          <QuizPage
            key={`${screen.activity.id}#${run}`}
            config={screen.activity.config}
            audio={audio}
            onFinished={onFinished}
          />
        ))}

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
