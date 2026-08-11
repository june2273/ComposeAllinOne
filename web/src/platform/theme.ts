/**
 * 테마 — 밝게 / 어둡게 / 시스템 따라가기.
 *
 * ## `color-scheme` 한 줄로 끝난다
 *
 * `tokens.css`의 색은 전부 `light-dark(밝은값, 어두운값)`이라, 어느 쪽이 쓰일지는
 * **그 요소에 걸린 `color-scheme`이 정한다.** 그래서 테마 전환에 필요한 것은
 * 루트의 `color-scheme` 한 줄뿐이다 — 변수를 두 벌 만들거나 클래스를 갈아끼울
 * 이유가 없다.
 *
 * 덤으로 폼 컨트롤·스크롤바 같은 **브라우저 기본 UI도 함께 따라온다.** 클래스로
 * 색만 바꾸면 그것들은 OS 설정에 남아 혼자 밝게 뜬다.
 *
 * > `light-dark()`는 비교적 최근 함수다. Tauri의 macOS WebView는 시스템
 * > WKWebView라 구형 OS에서 이 함수가 무효값이 되고 **색 변수 전체가 무너진다**
 * > (CLAUDE.md의 Tauri 절). 그때는 `@media (prefers-color-scheme)` 이중 정의로
 * > 되돌려야 하는데, **그 경우 이 파일도 함께 바뀐다** — `color-scheme`만으로는
 * > 이중 정의를 이길 수 없어 루트에 클래스를 함께 걸어야 한다.
 *
 * ## 브라우저를 아는 유일한 자리다
 *
 * `localStorage`도 `matchMedia`도 여기서만 만진다(`platform/`의 존재 이유).
 * 위층은 `Theme` 문자열만 다룬다.
 */

/** `system`이면 OS 설정을 따른다 */
export type Theme = "system" | "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];

const KEY = "theme";

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * 저장해 둔 테마. 없거나 못 읽으면 `system`.
 *
 * **읽기가 던질 수 있다** — 사파리 프라이빗 모드나 서드파티 쿠키 차단에서
 * `localStorage` 접근 자체가 예외다. 테마 하나 때문에 앱이 안 뜨면 안 된다.
 */
export function readTheme(): Theme {
  try {
    const saved = globalThis.localStorage?.getItem(KEY);
    return isTheme(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

/** 저장에 실패해도 조용히 넘어간다. 이번 세션에는 어차피 적용돼 있다 */
export function saveTheme(theme: Theme): void {
  try {
    globalThis.localStorage?.setItem(KEY, theme);
  } catch {
    /* 저장할 수 없는 환경 — 적용은 이미 끝났다 */
  }
}

/**
 * 루트에 `color-scheme`을 건다. **이것이 실제로 색을 바꾸는 유일한 동작이다.**
 *
 * `system`은 `light dark` 둘 다 적는다 — "둘 다 지원하니 OS가 고르라"는 뜻이고,
 * `tokens.css`의 기본값과 같다.
 */
export function applyTheme(theme: Theme): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.style.colorScheme = theme === "system" ? "light dark" : theme;
}

/** 지금 실제로 어두운가. `system`일 때 무엇이 적용됐는지 화면에 알려주는 용도 */
export function prefersDark(): boolean {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/**
 * OS 설정이 바뀌면 알려준다. 정리 함수를 돌려준다.
 *
 * `system`을 고른 사용자는 OS를 바꿨을 때 화면이 따라가는데, **"지금 어둡다"는
 * 표시가 안 따라가면 그 줄만 거짓말이 된다.**
 */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
