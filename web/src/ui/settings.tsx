/**
 * 설정 창 — 테마와 **연결된 MIDI 장치**.
 *
 * 아직 안 되는 것을 **빈칸으로 두지 않고 한 줄씩 적어 두는 것**은 이 저장소의
 * 방침 그대로다(카탈로그의 `requires`, 분석 콘솔의 "아직 안 되는 것"). 설정 창이
 * 왜 이렇게 휑한지, 다음에 무엇이 오는지를 화면이 스스로 말한다.
 *
 * **테마 상태는 여기 없다** — `useTheme`이 들고 있고 이 파일은 그리기만 한다.
 * 창을 닫아도 값이 남아야 하므로 그 훅은 `App`에 있다. **MIDI는 반대로 여기서
 * 연다** — 남겨야 할 값이 아니라 지금 무엇이 꽂혀 있는가이고, 창을 닫으면
 * 포트를 놓아 주는 편이 맞다. 설정은 홈에서만 열리므로 문항형의 `useMidi`와
 * 동시에 두 벌이 뜨는 일은 없다.
 */

import { DeviceStatus, Fieldset, Overlay, ChoiceRow, SpecSection, Stack } from "../ds";
import { MidiRow } from "./components";
import type { MidiEnv } from "../platform/midi";
import type { Theme } from "../platform/theme";
import { useMidi } from "./useMidi";

/**
 * 고를 수 있는 테마와 그 설명. **표시 순서가 여기서 정해진다.**
 *
 * `platform/theme.THEMES`와 값이 같아야 하지만 순서·문구는 화면의 몫이라
 * 목록을 따로 둔다 — 저쪽은 저장된 문자열을 검증하는 데 쓰는 집합이다.
 */
const THEME_CHOICES: ReadonlyArray<readonly [Theme, string, string]> = [
  ["system", "시스템", "OS 설정을 따른다"],
  ["light", "밝게", "언제나 흰 바탕"],
  ["dark", "어둡게", "언제나 검은 바탕"],
];

/** 앞으로 여기 들어올 것들. 화면에 그대로 나가는 문장이다 */
const NOT_YET = [
  "MIDI 포트 고르기 — 지금은 쓸 만한 포트를 전부 함께 듣는다. 고르는 화면이 필요해지는 것은 건반을 여러 대 붙였을 때다",
  "사운드 출력 기기 — 브라우저의 setSinkId가 필요하다. Safari·Firefox에는 아직 없다",
];

export interface SettingsDialogProps {
  theme: Theme;
  /** 지금 실제로 어두운가. `시스템`이 무엇으로 풀렸는지 알려준다 */
  dark: boolean;
  onTheme: (theme: Theme) => void;
  onClose: () => void;
  /** 테스트가 가짜 `MIDIAccess`를 넣는 자리. 문항형·자유 연주와 같은 이름이다 */
  midiEnv?: MidiEnv;
}

/**
 * 연결된 MIDI 장치.
 *
 * **한 줄이 아니라 포트마다 한 줄이다** — 문항형 화면의 상태 줄은 "지금 칠 수
 * 있는가"만 알려주면 되지만, 설정에서 보고 싶은 것은 **무엇이 꽂혀 있고 그중
 * 무엇을 듣는가**이다. 특히 `PORT_AVOID`가 거른 포트는 어디에도 나오지 않아서,
 * 건반을 꽂았는데 반응이 없을 때 이유를 볼 자리가 없었다.
 */
function MidiSection({ env }: { env?: MidiEnv }) {
  // 건반을 받지 않는다 — 여기서는 보여 주기만 하고, 답은 문항형이 받는다.
  const midi = useMidi(true, () => {}, env);
  const ready = midi.status === "ready";

  return (
    <Fieldset title="MIDI 입력">
      <Stack>
        {/*
          **안내 문구를 상태 칸에 넣지 않는다.** 그 칸은 한 줄로 말줄임하는데
          설정 창은 폭이 좁아 "주소창의 자물쇠에서 허용하세요" 같은 **할 일이
          잘려 나간다**(실측). 짧은 것만 거기, 문장은 아래 줄에.
        */}
        <MidiRow midi={midi} detail={ready ? `${midi.listening.length}개 듣는 중` : null} />
        {!ready && <p className="muted">{midi.message}</p>}
        {midi.listening.map((name) => (
          <DeviceStatus key={name} label="듣는 중" state="ok" detail={name} />
        ))}
        {midi.ignored.map((name) => (
          <DeviceStatus key={name} label="무시" state="off" detail={name} />
        ))}
        {midi.ignored.length > 0 && (
          <p className="muted">
            MCU·HUI·THRU 계열 포트는 트랜스포트 버튼을 노트 메시지로 보내 오답을
            만들기 때문에 듣지 않습니다.
          </p>
        )}
      </Stack>
    </Fieldset>
  );
}

export function SettingsDialog({
  theme,
  dark,
  onTheme,
  onClose,
  midiEnv,
}: SettingsDialogProps) {
  const current = THEME_CHOICES.find(([value]) => value === theme);
  return (
    <Overlay title="설정" onClose={onClose} wide>
      <Fieldset title="테마">
        <ChoiceRow
          choices={THEME_CHOICES.map(([, label, sub]) => [label, sub] as const)}
          selected={current?.[1] ?? null}
          onPick={(label) => {
            const picked = THEME_CHOICES.find(([, name]) => name === label);
            if (picked) onTheme(picked[0]);
          }}
        />
        {/* 시스템을 골랐을 때 지금 어느 쪽인지 — 이 줄이 없으면 고르고도 모른다 */}
        {theme === "system" && (
          <p className="muted">지금 OS 설정은 {dark ? "어둡게" : "밝게"}입니다.</p>
        )}
      </Fieldset>

      <MidiSection env={midiEnv} />

      <SpecSection title="아직 안 되는 것" items={NOT_YET} />
    </Overlay>
  );
}
