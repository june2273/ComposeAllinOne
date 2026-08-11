/**
 * 설정 창 — 지금은 테마 하나뿐이다.
 *
 * MIDI 연결과 사운드 출력 기기가 여기 들어올 자리다. 아직 안 되는 것을
 * **빈칸으로 두지 않고 한 줄씩 적어 두는 것**은 이 저장소의 방침 그대로다
 * (카탈로그의 `requires`, 분석 콘솔의 "아직 안 되는 것"). 설정 창이 왜 이렇게
 * 휑한지, 다음에 무엇이 오는지를 화면이 스스로 말한다.
 *
 * 여기에 상태를 두지 않는다 — 테마는 `useTheme`이 들고 있고 이 파일은 그리기만
 * 한다. 창을 닫아도 값이 남아야 하므로 훅은 `App`에 있다.
 */

import { Fieldset, Overlay, ChoiceRow, SpecSection } from "../ds";
import type { Theme } from "../platform/theme";

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
  "MIDI 연결 — 지금은 연결된 포트를 자동으로 전부 듣는다. 고르는 화면이 필요해지는 것은 포트가 여럿일 때다",
  "사운드 출력 기기 — 브라우저의 setSinkId가 필요하다. Safari·Firefox에는 아직 없다",
];

export interface SettingsDialogProps {
  theme: Theme;
  /** 지금 실제로 어두운가. `시스템`이 무엇으로 풀렸는지 알려준다 */
  dark: boolean;
  onTheme: (theme: Theme) => void;
  onClose: () => void;
}

export function SettingsDialog({ theme, dark, onTheme, onClose }: SettingsDialogProps) {
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

      <SpecSection title="아직 안 되는 것" items={NOT_YET} />
    </Overlay>
  );
}
