/** 테마를 React 수명주기에 붙인다. `useMidi`와 같은 자리의 얇은 훅이다. */

import { useCallback, useEffect, useState } from "react";

import {
  applyTheme,
  prefersDark,
  readTheme,
  saveTheme,
  type Theme,
  watchSystemTheme,
} from "../platform/theme";

export interface ThemeControl {
  theme: Theme;
  /** 지금 실제로 어두운가. `system`이 무엇으로 풀렸는지 보여줄 때 쓴다 */
  dark: boolean;
  setTheme: (theme: Theme) => void;
}

export function useTheme(): ThemeControl {
  // **초기값을 저장소에서 바로 읽는다.** 기본값으로 시작해 이펙트에서 고치면
  // 첫 프레임이 반대 테마로 그려진다.
  const [theme, setState] = useState<Theme>(readTheme);
  const [dark, setDark] = useState(prefersDark);

  // OS 설정 변화는 `system`일 때만 화면에 영향을 주지만, 표시용 `dark`는
  // 언제나 최신이어야 한다
  useEffect(() => watchSystemTheme(() => setDark(prefersDark())), []);

  // **적용을 이펙트에 둔다.** 렌더 중에 DOM을 만지면 StrictMode의 두 번째
  // 호출과 순서가 엉킨다. `main.tsx`가 첫 적용을 이미 끝내 둔다
  useEffect(() => applyTheme(theme), [theme]);

  const setTheme = useCallback((next: Theme) => {
    setState(next);
    saveTheme(next);
  }, []);

  return { theme, dark: theme === "system" ? dark : theme === "dark", setTheme };
}
