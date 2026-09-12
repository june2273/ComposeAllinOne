/**
 * 테마 — 저장·적용·시스템 추적.
 *
 * **OS 설정 변화는 브라우저에서 확인할 수 없었다.** 개발용 브라우저의 테마
 * 에뮬레이션은 `matchMedia().matches`만 바꾸고 `change` 이벤트는 쏘지 않는다
 * (실측: 직접 붙인 확인용 리스너도 0번 불렸다). 그래서 그 경로는 여기서
 * 가짜 `matchMedia`로 본다.
 */

import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Overlay } from "../src/ds";
import {
  applyTheme,
  prefersDark,
  readTheme,
  saveTheme,
  watchSystemTheme,
} from "../src/platform/theme";
import { SettingsDialog } from "../src/ui/settings";
import { useTheme } from "../src/ui/useTheme";

/** OS 설정을 마음대로 바꿀 수 있는 `matchMedia` */
function fakeMatchMedia(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  return {
    install: () => {
      vi.stubGlobal("matchMedia", () => query);
    },
    /** OS가 바뀌었다 — 값과 이벤트를 함께 낸다 */
    set: (next: boolean) => {
      query.matches = next;
      for (const fn of listeners) fn();
    },
    count: () => listeners.size,
  };
}

/**
 * **이 jsdom에는 `localStorage`가 아예 없다**(실측: `globalThis`에도 `window`에도
 * undefined). 그래서 넣어 준다 — 다른 테스트가 가짜 `fetch`·`AudioContext`를
 * 주입하는 것과 같은 방식이다.
 */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  document.documentElement.style.colorScheme = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("테마 저장과 적용", () => {
  test("저장한 값을 그대로 읽는다", () => {
    expect(readTheme()).toBe("system");
    saveTheme("dark");
    expect(readTheme()).toBe("dark");
  });

  test("모르는 값이 들어 있으면 system으로 떨어진다", () => {
    globalThis.localStorage.setItem("theme", "노랑");
    expect(readTheme()).toBe("system");
  });

  /** 사파리 프라이빗 모드 등에서 접근 자체가 던진다. 앱이 안 뜨면 안 된다 */
  test("저장소가 던져도 앱이 죽지 않는다", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(readTheme()).toBe("system");
    expect(() => saveTheme("dark")).not.toThrow();
  });

  /**
   * **색을 바꾸는 동작은 이 한 줄뿐이다.** `tokens.css`가 전부
   * `light-dark()`라 루트의 `color-scheme`이 어느 쪽을 쓸지 정한다.
   */
  test("루트에 color-scheme을 건다", () => {
    applyTheme("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    // system은 "둘 다 지원한다" — OS가 고른다
    applyTheme("system");
    expect(document.documentElement.style.colorScheme).toBe("light dark");
  });

  test("matchMedia가 없는 환경에서도 던지지 않는다", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersDark()).toBe(false);
    const stop = watchSystemTheme(() => {});
    expect(() => stop()).not.toThrow();
  });
});

describe("useTheme", () => {
  test("저장된 값으로 시작한다 — 첫 프레임이 반대 테마로 그려지면 안 된다", () => {
    saveTheme("dark");
    fakeMatchMedia(false).install();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(result.current.dark).toBe(true);
  });

  test("고르면 적용되고 저장된다", () => {
    fakeMatchMedia(false).install();
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("dark"));
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(readTheme()).toBe("dark");
  });

  test("system이면 OS를 따라간다 — 바뀌면 표시도 따라간다", () => {
    const media = fakeMatchMedia(false);
    media.install();
    const { result } = renderHook(() => useTheme());
    expect(result.current.dark).toBe(false);
    act(() => media.set(true));
    expect(result.current.dark).toBe(true);
  });

  test("고정 테마는 OS가 바뀌어도 안 흔들린다", () => {
    const media = fakeMatchMedia(false);
    media.install();
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("light"));
    act(() => media.set(true));
    expect(result.current.dark).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  test("정리하면 OS 구독을 놓는다", () => {
    const media = fakeMatchMedia(false);
    media.install();
    const { unmount } = renderHook(() => useTheme());
    expect(media.count()).toBe(1);
    unmount();
    expect(media.count()).toBe(0);
  });
});

describe("닫을 수 있는 오버레이", () => {
  test("onClose를 주면 ESC·바깥 클릭·닫기 단추가 붙는다", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Overlay title="설정" onClose={onClose} wide>
        <p>내용</p>
      </Overlay>,
    );
    // 열면 창 안으로 초점이 들어간다
    expect(screen.getByLabelText("닫기")).toBe(document.activeElement);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector(".overlay")!);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByLabelText("닫기"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  test("패널 안쪽 클릭은 닫지 않는다", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Overlay title="설정" onClose={onClose}>
        <p>내용</p>
      </Overlay>,
    );
    fireEvent.click(container.querySelector(".overlay__panel")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  /**
   * 일시정지 오버레이는 스스로 ESC를 듣는다(`QuizPage`). 여기서 또 들으면
   * 한 번 누른 것이 두 번 처리된다.
   */
  test("onClose가 없으면 아무것도 붙지 않는다", () => {
    const { container } = render(
      <Overlay title="일시정지">
        <button type="button">계속</button>
      </Overlay>,
    );
    expect(container.querySelector(".overlay__close")).toBeNull();
    // 던지지 않는다 — 리스너 자체가 없다
    fireEvent.keyDown(document, { key: "Escape" });
  });
});

describe("설정 창", () => {
  test("고른 테마가 눌린 상태로 보이고, 다른 것을 고르면 알린다", () => {
    const onTheme = vi.fn();
    render(
      <SettingsDialog theme="dark" dark onTheme={onTheme} onClose={() => {}} />,
    );
    expect(screen.getByLabelText(/어둡게/)).toHaveProperty("ariaPressed", "true");
    fireEvent.click(screen.getByLabelText(/밝게/));
    expect(onTheme).toHaveBeenCalledWith("light");
  });

  test("system일 때만 지금 어느 쪽인지 알려준다", () => {
    const { rerender } = render(
      <SettingsDialog theme="system" dark onTheme={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText(/지금 OS 설정은 어둡게/)).toBeTruthy();
    rerender(
      <SettingsDialog theme="dark" dark onTheme={() => {}} onClose={() => {}} />,
    );
    expect(screen.queryByText(/지금 OS 설정은/)).toBeNull();
  });

  test("아직 안 되는 것을 적어 둔다 — 빈칸으로 두지 않는다", () => {
    render(<SettingsDialog theme="system" dark={false} onTheme={() => {}} onClose={() => {}} />);
    // **MIDI 연결은 이 목록에서 빠졌다** — 실제로 보여 주게 됐기 때문이다
    // (`midi.test.tsx`의 "설정 창의 MIDI 칸"). 남은 것은 포트를 고르는 화면이다.
    expect(screen.getByText(/MIDI 포트 고르기/)).toBeTruthy();
    expect(screen.getByText(/사운드 출력 기기/)).toBeTruthy();
  });
});
