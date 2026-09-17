/**
 * 화면에 숫자를 적는 방법. **표시 전용이고 값은 바꾸지 않는다.**
 *
 * 분석 콘솔·코드 차트·구조 표·드럼 칸이 같은 곡의 같은 시각을 함께 적는다 —
 * 네 곳에 따로 두면 한 화면 안에서 `1:05`와 `1:5`가 섞일 수 있다. 실제로 네
 * 벌이 복사돼 있었고(2026-09-11에 합쳤다) 그중 하나는 이름만 `seconds`였다.
 */

/** 초 → `2:07`. 반올림하지 않고 버린다 — 재생 위치는 지나간 시각이다 */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * `pre-chorus` → `Pre-Chorus`.
 *
 * **라벨 값 자체는 영어 그대로 둔다**(`structure.tsx` 첫 주석) — 내부 값과 화면
 * 표시가 갈리면 어느 쪽이 정답인지 코드와 화면 사이에서 흔들린다. 여기서 하는
 * 것은 첫 글자를 올리는 것뿐이다.
 */
export function titleCase(label: string): string {
  return label
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}
