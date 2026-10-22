/**
 * 도메인과 디자인 시스템을 잇는 얇은 층.
 *
 * `src/ds/`의 부품은 도메인을 모른다(원시 값만 받는다). 여기서 `Pitch`를
 * SVG 문자열로 바꾸는 것처럼 **번역만** 하고, 생김새는 전혀 다루지 않는다.
 */

import { useEffect, useRef, useState } from "react";

import { type DeviceState, DeviceStatus, StaffFigure } from "../ds";
import { signatureLabel } from "../core/harmony/keys";
import { ScoreRenderer } from "../core/score";
import type { Pitch } from "../core/theory";
import type { MidiStatus } from "../platform/midi";
import type { MidiView } from "./useMidi";

/**
 * 상태 → 점 색. **화면 셋이 이 표를 함께 쓴다**(문항형·자유 연주·설정 창) —
 * 복사해 두면 새 상태가 늘었을 때 한쪽만 고쳐져 같은 건반이 화면마다 다른
 * 색으로 뜬다. `ds`는 도메인을 모르므로 번역은 이 층의 일이다.
 *
 * `requesting`·`no-device`·`denied`가 노랑인 것은 **사용자가 할 일이 남았다**는
 * 뜻이고, 회색 셋은 이 브라우저에서 할 수 있는 일이 없다는 뜻이다.
 */
const MIDI_DEVICE_STATE: Record<MidiStatus, DeviceState> = {
  ready: "ok",
  requesting: "warn",
  "no-device": "warn",
  denied: "warn",
  unsupported: "off",
  insecure: "off",
  error: "off",
};

/**
 * MIDI 상태 한 줄. **`detail`을 갈아끼울 수 있다** — 문항형·자유 연주는 포트
 * 이름이 그대로 필요하지만, 설정 창은 폭이 좁아 그 자리에 긴 안내를 넣으면
 * 말줄임에 잘린다(실측).
 *
 * `unsupported`에서 단추를 감추는 규칙이 여기 한 곳에 있다 — Safari·Firefox에는
 * Web MIDI가 아예 없어서 다시 찾아도 같은 답이 나온다.
 */
export function MidiRow({
  midi,
  detail,
}: {
  midi: MidiView;
  /** 안 넘기면 `midi.message`. `null`이면 칸을 비운다 */
  detail?: string | null;
}) {
  return (
    <DeviceStatus
      label="MIDI"
      state={MIDI_DEVICE_STATE[midi.status]}
      detail={detail === undefined ? midi.message : (detail ?? undefined)}
      actionLabel={midi.status === "unsupported" ? undefined : "다시 찾기"}
      onAction={midi.refresh}
    />
  );
}

/**
 * 한 음 또는 두 음을 오선지로. **`upper`를 빼면 한 음짜리다**(음정 해석).
 *
 * verovio WASM은 처음 쓸 때 한 번 로드되고(수 MB), 그 전에는 음이름으로
 * 대체한다. 악보가 없어도 문제는 계속 풀 수 있어야 한다.
 *
 * 음자리표는 여기서 정하지 않는다 — `score.clefFor`가 음의 높이를 보고 고른다.
 */
/**
 * 음계처럼 **여러 음을 나란히** 그린다. 친 만큼만 넘기면 그만큼만 찍힌다.
 *
 * `clefFrom`이 따로 있는 이유: 자리표는 **완성된 모습**으로 정해야 한다. 지금까지
 * 친 음만 보고 정하면 낮은 음 몇 개만 찍힌 동안 낮은음자리표였다가 도중에 바뀐다.
 *
 * **앞 그림을 지우지 않는다.** `Staff`는 음이 바뀔 때마다 `setSvg(null)`을 불러
 * 폴백 글자를 한 번 보이는데, 여기서는 음을 칠 때마다 그래서 악보가 깜빡인다.
 * 새 SVG가 올 때까지 이전 것을 그대로 두면 한 음씩 **쌓이는 것처럼** 보인다.
 */
export function MelodyStaff({
  pitches,
  clefFrom = pitches,
}: {
  pitches: readonly Pitch[];
  clefFrom?: readonly Pitch[];
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const key = pitches.map((p) => p.name).join(" ");
  const latest = useRef(key);

  useEffect(() => {
    latest.current = key;
    let cancelled = false;
    ScoreRenderer.load()
      .then((renderer) => {
        if (cancelled || latest.current !== key) return;
        setSvg(renderer.renderMelody(pitches, clefFrom));
      })
      .catch((err) => {
        console.error("악보 렌더 실패:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [clefFrom, key, pitches]);

  return <StaffFigure svg={svg} fallback={key} wide />;
}

/**
 * **조표만** 있는 빈 오선. 조표 읽기 문제가 쓴다.
 *
 * 캐시 키가 `fifths`다. `Staff`·`MelodyStaff`는 음이름으로 키를 만드는데 여기는
 * 음표가 없어서 **그 방식이면 모든 문제의 키가 같아져 악보가 영영 안 바뀐다.**
 */
export function KeySignatureStaff({ fifths }: { fifths: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  const latest = useRef(fifths);

  useEffect(() => {
    latest.current = fifths;
    let cancelled = false;
    ScoreRenderer.load()
      .then((renderer) => {
        if (cancelled || latest.current !== fifths) return;
        setSvg(renderer.renderKeySignature(fifths));
      })
      .catch((err) => {
        console.error("악보 렌더 실패:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [fifths]);

  /*
    악보가 뜨기 전 몇 초를 메우는 글자다 — **거기에 `-3`을 적으면 안 된다.**
    조표를 읽는 활동에서 날숫자는 ♯인지 ♭인지를 말해 주지 않는다.
  */
  return <StaffFigure svg={svg} fallback={signatureLabel(fifths)} />;
}

export function Staff({ lower, upper }: { lower: Pitch; upper?: Pitch }) {
  const [svg, setSvg] = useState<string | null>(null);
  const key = upper ? `${lower.name}-${upper.name}` : lower.name;
  const latest = useRef(key);

  useEffect(() => {
    latest.current = key;
    let cancelled = false;
    setSvg(null);
    ScoreRenderer.load()
      .then((renderer) => {
        if (cancelled || latest.current !== key) return;
        setSvg(upper ? renderer.renderInterval(lower, upper) : renderer.renderNote(lower));
      })
      .catch((err) => {
        console.error("악보 렌더 실패:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [key, lower, upper]);

  return (
    <StaffFigure
      svg={svg}
      fallback={upper ? `${lower.name}   ${upper.name}` : lower.name}
    />
  );
}
