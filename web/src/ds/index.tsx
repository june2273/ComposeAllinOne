/**
 * 디자인 시스템 — 표시 전용 부품.
 *
 * **여기 있는 컴포넌트는 도메인을 모른다.** `Pitch`·`Question`·`SessionConfig`
 * 같은 것을 받지 않고 문자열·숫자·불리언만 받는다. 그래야 디자인 도구가
 * 화성학을 몰라도 화면을 조립할 수 있고, 디자이너가 만든 화면이 그대로
 * 코드가 된다.
 *
 * 규칙 셋:
 *
 * 1. **props는 원시 값과 콜백만.** 도메인 타입을 받는 순간 그 부품은
 *    디자인 도구에서 쓸 수 없게 된다.
 * 2. **상태를 갖지 않는다.** 무엇을 보여줄지는 부르는 쪽이 정한다
 *    (`StaffFigure`의 로딩 표시 같은 순수 표시 상태는 예외).
 * 3. **색·간격·글자 크기를 직접 적지 않는다.** 전부 styles/tokens.css의
 *    CSS 변수를 거친다. 그래서 브랜딩 교체가 토큰 파일 하나로 끝난다.
 *
 * 도메인과 이어 붙이는 일은 `src/ui/`가 한다.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import "../ui/styles/app.css";

// --- 기본 부품 ---------------------------------------------------------------

export interface ButtonProps {
  children: ReactNode;
  /** 강조 버튼(주 동작) */
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function Button({ children, primary, disabled, onClick }: ButtonProps) {
  return (
    <button
      type="button"
      className={`button${primary ? " button--primary" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export interface BadgeProps {
  children: ReactNode;
  /** 강조(사용 가능) 상태 */
  active?: boolean;
}

export function Badge({ children, active }: BadgeProps) {
  return (
    <span className={`card__badge${active ? " card__badge--ready" : ""}`}>
      {children}
    </span>
  );
}

export interface CardProps {
  title: string;
  summary: string;
  /** 오른쪽 끝 배지. "동작" / "준비 중" / "3 / 9" 같은 짧은 문구 */
  badge?: string;
  /** 배지를 강조색으로 (사용 가능한 항목) */
  active?: boolean;
  onClick?: () => void;
}

/** 목록의 한 줄. 홈의 분야와 활동 목록이 같은 부품을 쓴다. */
export function Card({ title, summary, badge, active, onClick }: CardProps) {
  return (
    <button type="button" className="card" onClick={onClick}>
      <span className="card__body">
        <span className="card__title">{title}</span>
        <br />
        <span className="card__summary">{summary}</span>
      </span>
      {badge && <Badge active={active}>{badge}</Badge>}
    </button>
  );
}

export interface NavBarProps {
  /** 현재 위치. 빈 배열이면 뒤로가기를 감춘다 */
  path: string[];
  onBack?: () => void;
}

export function NavBar({ path, onBack }: NavBarProps) {
  return (
    <nav className="nav">
      {path.length > 0 && (
        <button type="button" className="nav__back" onClick={onBack}>
          ‹ 뒤로
        </button>
      )}
      <span className="nav__path">{path.join("  ›  ")}</span>
    </nav>
  );
}

export interface PageHeadingProps {
  title: string;
  subtitle?: string;
  center?: boolean;
}

export function PageHeading({ title, subtitle, center }: PageHeadingProps) {
  return (
    <>
      <h1 className="page-title" style={center ? { textAlign: "center" } : undefined}>
        {title}
      </h1>
      {subtitle && <p className="muted">{subtitle}</p>}
    </>
  );
}

export function Stack({ children }: { children: ReactNode }) {
  return <div className="stack">{children}</div>;
}

// --- 2분할 메뉴 --------------------------------------------------------------

export interface SplitPaneProps {
  /** 왼쪽 — 메뉴 이름들 */
  menu: ReactNode;
  /** 오른쪽 — 고른 것의 설명과 설정 */
  detail: ReactNode;
}

/**
 * 왼쪽 메뉴 / 오른쪽 설명의 2분할.
 *
 * 좁은 화면에서는 위아래로 쌓인다(CSS가 처리한다). 어느 쪽에 무엇이 들어갈지는
 * 부르는 쪽이 정한다 — 이 부품은 자리만 만든다.
 */
export function SplitPane({ menu, detail }: SplitPaneProps) {
  return (
    <div className="split">
      <div className="split__menu">{menu}</div>
      <div className="split__detail">{detail}</div>
    </div>
  );
}

export interface MenuItemData {
  id: string;
  label: string;
  /** 오른쪽 끝 짧은 꼬리표. "동작" / "준비 중" */
  badge?: string;
  /** 배지를 강조색으로 */
  active?: boolean;
}

export interface MenuListProps {
  items: readonly MenuItemData[];
  /** 지금 고른 항목 */
  selectedId?: string;
  onSelect?: (id: string) => void;
}

/** 세로로 늘어선 메뉴. 고른 항목이 왼쪽 띠로 표시된다. */
export function MenuList({ items, selectedId, onSelect }: MenuListProps) {
  return (
    <nav className="menu">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`menu__item${item.id === selectedId ? " menu__item--on" : ""}`}
          aria-current={item.id === selectedId}
          onClick={() => onSelect?.(item.id)}
        >
          <span className="menu__label">{item.label}</span>
          {item.badge && (
            <span
              className={`menu__badge${item.active ? " menu__badge--ready" : ""}`}
            >
              {item.badge}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

// --- 설정 --------------------------------------------------------------------

export interface StepSliderProps {
  /** "제한시간" · "라운드" */
  label: string;
  /** 눈금마다 보일 문구. "10초" … "무한" */
  steps: readonly string[];
  /** 지금 고른 눈금 */
  index: number;
  /** 슬라이더 아래 설명 한 줄 */
  hint?: string;
  disabled?: boolean;
  onChange?: (index: number) => void;
}

/**
 * 정해진 눈금 위를 오가는 슬라이더.
 *
 * 값이 아니라 **눈금 번호**를 다룬다. 그래서 "10·15·…·60·무한"처럼 마지막 칸이
 * 숫자가 아닌 눈금도 같은 부품으로 표현된다 — 이 부품은 무한이 무엇인지 모른다.
 */
export function StepSlider({
  label,
  steps,
  index,
  hint,
  disabled,
  onChange,
}: StepSliderProps) {
  const safe = Math.max(0, Math.min(steps.length - 1, index));
  return (
    <div className={`slider${disabled ? " slider--off" : ""}`}>
      <div className="slider__head">
        <span className="slider__label">{label}</span>
        <span className="slider__value">{steps[safe]}</span>
      </div>
      <input
        type="range"
        className="slider__input"
        min={0}
        max={Math.max(0, steps.length - 1)}
        step={1}
        value={safe}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={steps[safe]}
        onChange={(event) => onChange?.(Number(event.target.value))}
      />
      {hint && <span className="slider__hint">{hint}</span>}
    </div>
  );
}

export interface ToggleProps {
  label: string;
  checked: boolean;
  /** 라벨 아래 설명 한 줄 */
  hint?: string;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

/** 켜고 끄는 스위치 하나. */
export function Toggle({ label, checked, hint, disabled, onChange }: ToggleProps) {
  return (
    <label className={`toggle${disabled ? " toggle--off" : ""}`}>
      <input
        type="checkbox"
        className="toggle__input"
        checked={checked}
        disabled={disabled}
        // 라벨을 <label>로 감싸기만 하면 접근성 이름에 설명(hint)까지 딸려
        // 들어간다. 이름은 라벨 하나로 못박는다.
        aria-label={label}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span className="toggle__body">
        <span className="toggle__label">{label}</span>
        {hint && <span className="toggle__hint">{hint}</span>}
      </span>
    </label>
  );
}

export interface FieldsetProps {
  title: string;
  children: ReactNode;
}

/** 설정 묶음 하나. 제목 + 안쪽 부품들. */
export function Fieldset({ title, children }: FieldsetProps) {
  return (
    <section className="fieldset">
      <h2 className="fieldset__title">{title}</h2>
      <div className="fieldset__body">{children}</div>
    </section>
  );
}

// --- 참고표 ------------------------------------------------------------------

export interface MatrixProps {
  /** 표 위 제목 */
  caption?: string;
  /** 맨 왼쪽 모서리 칸부터의 열 제목. 첫 값이 행 제목 열의 머리다 */
  columns: readonly string[];
  /** 각 행: [행 제목, 칸, 칸, …]. 빈 문자열이면 빈 칸으로 둔다 */
  rows: ReadonlyArray<readonly string[]>;
}

/**
 * 격자표. 암기용 참고표가 쓴다.
 *
 * **무엇을 담는지 모른다** — 문자열 격자일 뿐이다. 좁은 화면에서는 가로로
 * 스크롤된다(표를 접거나 줄바꿈하면 표로서의 값이 사라진다).
 */
export function Matrix({ caption, columns, rows }: MatrixProps) {
  return (
    <div className="matrix">
      <table className="matrix__table">
        {caption && <caption className="matrix__caption">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((name, i) => (
              <th key={name} scope={i === 0 ? undefined : "col"}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={`${row[0]}-h`} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td
                    key={`${row[0]}-${columns[i]}`}
                    className={cell ? "matrix__cell--on" : undefined}
                  >
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- 덮개 (일시정지 등) --------------------------------------------------------

export interface ShareRow {
  /** 왼쪽에 그대로 나가는 이름. "173 BPM" · "4/4" */
  label: string;
  /** 0~1. 행들의 합이 1일 필요는 없지만 그렇게 쓰라고 만든 것이다 */
  value: number;
  /** 고른 것. 하나만 강조된다 */
  selected?: boolean;
}

export interface ShareBarsProps {
  /** 위에서부터 그리는 순서 그대로. 정렬은 부르는 쪽 몫이다 */
  rows: readonly ShareRow[];
  /** 표 위 제목 */
  caption?: string;
  /** 주면 행이 버튼이 된다 — 후보를 눌러서 고르는 화면에 쓴다 */
  onSelect?: (index: number) => void;
}

/**
 * 후보들의 몫을 가로 막대로. **원그래프 대신이다.**
 *
 * 원그래프를 쓰지 않은 이유는 이 자료의 모양 때문이다 — 후보가 다섯이고 이름이
 * 숫자(“86 BPM”)라 조각마다 이름표를 붙여야 하는데, 좁은 카드 안의 작은 원에
 * 다섯 이름표를 넣으면 서로 겹친다. 게다가 여기서 읽어야 하는 것은 **“1등과
 * 2등이 얼마나 붙었나”**인데, 각도 차이는 길이 차이보다 눈으로 재기 어렵다.
 *
 * 색은 **강조 하나 + 나머지 회색**이다. 후보들은 서로 다른 종류가 아니라 같은
 * 물음의 답들이라 종류별 색(categorical)을 쓸 이유가 없고, 고른 답이 어느
 * 것인지가 이 그림의 요점이기 때문이다.
 *
 * **색만으로 고른 답을 표시하지 않는다** — 값 옆에 표식과 스크린리더용 문구가
 * 함께 나간다. 모든 행이 이름과 백분율을 늘 달고 있어서 마우스를 올려야만
 * 보이는 정보가 없다(그래서 툴팁을 두지 않았다).
 */
export function ShareBars({ rows, caption, onSelect }: ShareBarsProps) {
  return (
    <div className="shares">
      {caption && <div className="shares__caption">{caption}</div>}
      {rows.map((row, index) => {
        const className = `shares__row${row.selected ? " shares__row--on" : ""}${onSelect ? " shares__row--clickable" : ""}`;
        const content = (
          <>
            <span className="shares__label">{row.label}</span>
            <span className="shares__track">
              <span
                className="shares__fill"
                style={{ width: `${Math.max(0, Math.min(1, row.value)) * 100}%` }}
              />
            </span>
            <span className="shares__value">
              {Math.round(row.value * 100)}%
              {row.selected && (
                <>
                  {" "}
                  <span aria-hidden="true">◂</span>
                  <span className="sr-only">선택됨</span>
                </>
              )}
            </span>
          </>
        );
        return onSelect ? (
          <button
            key={row.label}
            type="button"
            className={className}
            onClick={() => onSelect(index)}
          >
            {content}
          </button>
        ) : (
          <div key={row.label} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

export interface OverlayProps {
  title: string;
  /** 제목 아래 한 줄 */
  hint?: string;
  /** 버튼들. 세로로 쌓인다 */
  children: ReactNode;
  /**
   * 닫을 수 있는 창으로 만든다. 넘기면 닫기 단추·ESC·바깥 클릭이 함께 붙는다.
   *
   * **없으면 아무것도 안 붙는다.** 일시정지 오버레이는 스스로 ESC를 듣고 있어서
   * (`QuizPage`의 키 핸들러) 여기서 또 들으면 두 번 처리된다.
   */
  onClose?: () => void;
  /**
   * 내용이 많은 창. 넓어지고 글이 왼쪽으로 정렬된다.
   *
   * 기본형은 버튼 몇 개를 세로로 쌓는 일시정지용이라 좁고 가운데 정렬이다.
   * 설정처럼 줄이 여럿인 내용을 그 폭에 넣으면 읽기 나쁘다.
   */
  wide?: boolean;
}

/**
 * 화면을 덮는 패널. 지금은 일시정지가 쓴다.
 *
 * **닫는 방법을 스스로 알지 않는다** — 무엇으로 닫을지(ESC·버튼)는 부르는 쪽의
 * 규칙이다. 여기서 키를 가로채면 화면마다 다른 규칙을 넣을 수 없게 된다.
 */
export function Overlay({ title, hint, children, onClose, wide }: OverlayProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!onClose) return;
    // 열면 창 안으로 초점을 옮긴다. 안 그러면 탭이 뒤 화면을 돌아다닌다
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // 바깥을 눌러 닫는다. 패널 안쪽 클릭이 올라온 것은 흘려보낸다
      onClick={onClose && ((event) => {
        if (event.target === event.currentTarget) onClose();
      })}
    >
      <div className={`overlay__panel${wide ? " overlay__panel--wide" : ""}`}>
        {onClose && (
          <button
            ref={closeRef}
            type="button"
            className="overlay__close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        )}
        <h2 className="overlay__title">{title}</h2>
        {hint && <p className="overlay__hint">{hint}</p>}
        <div className="overlay__actions">{children}</div>
      </div>
    </div>
  );
}

export type DeviceState = "ok" | "warn" | "off";

export interface DeviceStatusProps {
  /** 장치 이름. "MIDI" 같은 짧은 말 */
  label: string;
  state: DeviceState;
  /** 상세 한 줄. 포트 이름이나 안내 문구 */
  detail?: string;
  /** 오른쪽 버튼. 없으면 감춘다 */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * 외부 장치가 붙어 있는지 알려주는 한 줄.
 *
 * 어떤 장치인지는 모른다 — MIDI든 오디오 인터페이스든 같은 부품을 쓴다.
 */
export function DeviceStatus({
  label,
  state,
  detail,
  actionLabel,
  onAction,
}: DeviceStatusProps) {
  return (
    <div className={`device device--${state}`}>
      <span className="device__dot" aria-hidden="true" />
      <span className="device__label">{label}</span>
      <span className="device__detail">{detail}</span>
      {actionLabel && (
        <button type="button" className="device__action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * 채워지는 가로 막대. **남은 시간과 작업 진행률이 같은 부품을 쓴다** —
 * 둘 다 "0~1을 폭으로 보이는 것"이라 모양이 갈릴 이유가 없다.
 *
 * `tick`은 50ms마다 갱신되는 카운트다운용이다. 기본 전환 시간(120ms)을 쓰면
 * 다음 갱신이 이전 전환을 끊어 막대가 끊겨 보인다.
 */
function Bar({ ratio, tick }: { ratio: number; tick?: boolean }) {
  return (
    <div className="bar">
      <div
        className={`bar__fill${tick ? " bar__fill--tick" : ""}`}
        style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
      />
    </div>
  );
}

// --- 문제 풀이 화면 -----------------------------------------------------------

export interface SessionHeaderProps {
  /** "문제 3 / 10" */
  progress: string;
  score: number;
}

export function SessionHeader({ progress, score }: SessionHeaderProps) {
  return (
    <div className="quiz__head">
      <span>{progress}</span>
      <span>점수 {score}</span>
    </div>
  );
}

export interface TimerBarProps {
  /** 남은 비율 0~1 */
  ratio: number;
  /** 막대 아래 문구. "7.4초" 같은 것. 비우면 자리만 지킨다 */
  label?: string;
}

export function TimerBar({ ratio, label }: TimerBarProps) {
  return (
    <>
      <Bar ratio={ratio} tick />
      <div className="quiz__time">{label ?? ""}</div>
    </>
  );
}

export type VerdictTone = "correct" | "wrong" | "timeout" | "neutral";

export interface VerdictProps {
  /** "정답" / "오답" / "시간 초과" / "들어보세요" */
  text: string;
  tone?: VerdictTone;
  /** 줄바꿈이 그대로 살아난다 — 진단 문구가 두 줄이다 */
  detail?: string;
}

export function Verdict({ text, tone = "neutral", detail }: VerdictProps) {
  return (
    <>
      <div
        className={`quiz__status${tone === "neutral" ? "" : ` quiz__status--${tone}`}`}
      >
        {text}
      </div>
      <div className="quiz__detail">{detail ?? ""}</div>
    </>
  );
}

export interface NumberFieldProps {
  /** null이면 빈 칸으로 보인다 */
  value: number | null;
  /** 지금 입력받는 칸 */
  active?: boolean;
  /** 칸 오른쪽 단위. "도" / "반음" */
  unit?: string;
}

export function NumberField({ value, active, unit }: NumberFieldProps) {
  return (
    <>
      <span className={`field${active ? " field--active" : ""}`}>
        {value ?? "–"}
      </span>
      {unit && <span className="muted">{unit}</span>}
    </>
  );
}

export interface TextFieldProps {
  value: string;
  /**
   * 칸 이름 — **소리로 듣는 사람이 칸을 가리는 유일한 단서다.**
   *
   * 한 화면에 칸이 하나면 "답"으로 충분한데, 조표·5도권처럼 **칸이 여럿**이면
   * 전부 "답"으로 읽혀 어느 칸에 무엇을 치는지 알 수 없다(옆에 글자를 그려
   * 둬도 `aria-label`이 그것을 덮는다). 그래서 이름을 받는다.
   */
  label?: string;
  /** 비어 있을 때 회색으로 비치는 예시 */
  placeholder?: string;
  /** 칸 아래 설명 한 줄 */
  hint?: string;
  disabled?: boolean;
  /** 새 문제가 올 때마다 바뀌는 값. 바뀌면 초점을 다시 준다 */
  focusKey?: string;
  onChange?: (value: string) => void;
  /** Enter. **조합 중의 Enter는 여기로 오지 않는다** (아래 주석) */
  onSubmit?: () => void;
}

/**
 * 한 줄짜리 답 입력 칸.
 *
 * **입력기(IME) 조합 중의 Enter를 삼킨다.** 한글로 "증"을 치면 Enter 한 번은
 * 조합을 확정하는 키이지 제출이 아니다. 그걸 제출로 읽으면 늘 빈 답이 올라간다.
 * `isComposing`은 크롬·사파리·파이어폭스가 모두 세워 주는 표준 신호다.
 *
 * **초점은 부품이 스스로 잡는다.** 문항형에서 새 문제가 뜰 때마다 사용자가 칸을
 * 클릭해야 한다면 타이핑 입력은 쓸 수가 없다 — `focusKey`가 바뀌면 다시 잡는다.
 */
export function TextField({
  value,
  label = "답",
  placeholder,
  hint,
  disabled,
  focusKey,
  onChange,
  onSubmit,
}: TextFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled, focusKey]);

  return (
    <div className="answer">
      <input
        ref={ref}
        type="text"
        className="textfield"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          onSubmit?.();
        }}
      />
      {hint && <span className="textfield__hint">{hint}</span>}
    </div>
  );
}

export interface ChoiceRowProps {
  /**
   * 버튼 하나당 `[고르면 올라가는 값, 아래 줄 부제]`.
   *
   * 부제는 **설명**이지 조작 방법이 아니다. 단축키는 `KeyCaps`가 따로 보인다 —
   * 버튼에 글자 하나를 괄호로 붙여 두면 그 글자가 무엇의 약자인지 알 길이 없다.
   */
  choices: ReadonlyArray<readonly [string, string]>;
  /** 지금 골라 둔 값. 그 버튼만 강조된다 */
  selected?: string | null;
  disabled?: boolean;
  onPick?: (name: string) => void;
}

/** 한 줄에 늘어놓는 선택지. 음정 성질(완전/장/단/증/감)이 이걸 쓴다. */
export function ChoiceRow({
  choices,
  selected,
  disabled,
  onPick,
}: ChoiceRowProps) {
  return (
    <div
      className="choices"
      style={{ gridTemplateColumns: `repeat(${choices.length}, 1fr)` }}
    >
      {choices.map(([name, sub]) => (
        <button
          key={name}
          type="button"
          className={`button choice${selected === name ? " choice--on" : ""}`}
          disabled={disabled}
          // 두 span 사이에 공백 문자가 없어 접근명이 "단minor"로 붙는다.
          // 읽히는 이름은 사람이 읽는 대로 둔다.
          aria-label={`${name} ${sub}`}
          aria-pressed={selected === undefined ? undefined : selected === name}
          onClick={() => onPick?.(name)}
        >
          <span className="choice__name">{name}</span>
          <span className="choice__sub">{sub}</span>
        </button>
      ))}
    </div>
  );
}

export interface KeyCapsProps {
  /** 키 하나당 `[자판 글자, 그 키가 뜻하는 것]` */
  keys: ReadonlyArray<readonly [string, string]>;
  /** 지금 눌려 있는 글자 */
  active?: string | null;
  disabled?: boolean;
  onPress?: (key: string) => void;
}

/**
 * 자판 모양 안내. 어떤 키가 무엇을 뜻하는지 보이고, **눌러도 같은 일이 난다.**
 *
 * 단축키를 선택지 버튼 안에 괄호로 적으면 두 가지를 잃는다 — 글자가 무엇의
 * 약자인지 알 수 없고(N이 minor인 것을 아무도 모른다), 자판을 눌러도 된다는
 * 것이 눈에 띄지 않는다. 키캡 모양으로 따로 세우면 둘 다 한눈에 들어온다.
 */
export function KeyCaps({ keys, active, disabled, onPress }: KeyCapsProps) {
  return (
    <div className="keycaps">
      {keys.map(([key, caption]) => (
        <button
          key={key}
          type="button"
          className={`keycap${active === key ? " keycap--on" : ""}`}
          disabled={disabled}
          aria-label={`${key} 키 — ${caption}`}
          onClick={() => onPress?.(key)}
        >
          <span className="keycap__key">{key}</span>
          <span className="keycap__caption">{caption}</span>
        </button>
      ))}
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="hint">{children}</p>;
}

// --- 건반 ---------------------------------------------------------------------

export interface KeyboardKey {
  /** 눌렸다·뗐다를 알릴 때 그대로 돌려주는 값 */
  id: string;
  /** 건반에 크게 적히는 글자 */
  label: string;
  /** 그 아래 작게 적히는 것 */
  caption?: string;
  black: boolean;
  pressed?: boolean;
}

export interface KeyboardProps {
  /** **낮은 음부터** 흰건반·검은건반이 섞인 순서 그대로 */
  keys: readonly KeyboardKey[];
  onPress?: (id: string) => void;
  onRelease?: (id: string) => void;
  label?: string;
  /**
   * 누른 채 옆으로 끌면 이어서 눌리는가(글리산도). 연주에서는 켜야 하지만,
   * **한 번 고르는 자리에서는 꺼야 한다** — 스치고 지나간 건반이 전부 선택으로
   * 들어간다.
   */
  glide?: boolean;
}

/**
 * 검은건반 폭 = 흰건반의 이만큼. 실제 피아노가 대략 0.6이다.
 * 흰건반 경계에 **가운데를 걸치므로** 좌우로 절반씩 물린다.
 */
const BLACK_WIDTH = 0.62;

/**
 * 피아노 건반 — **자리만 안다.** 어떤 글자가 무슨 음인지는 위층이 정하고
 * 여기는 `black` 플래그의 나열을 보고 흰건반 몇 번째 경계에 검은건반을
 * 얹을지만 계산한다(그래서 어떤 음역·어떤 배치든 그대로 그린다).
 *
 * 폭이 `%`인 이유: 흰건반 개수가 배치마다 다르고, 화면 폭도 다르다. 픽셀로
 * 잡으면 검은건반이 흰건반 경계에서 어긋난다.
 *
 * 포인터로 누른 채 옆으로 끌면 이어서 눌린다(글리산도). `pointerenter`가
 * 버튼 상태를 함께 보기 때문이고, 그래서 **떼는 것도 `pointerleave`가 받아야**
 * 한다 — 안 그러면 끌고 나간 건반이 계속 울린다.
 */
export function Keyboard({
  keys,
  onPress,
  onRelease,
  label = "건반",
  glide = true,
}: KeyboardProps) {
  const whiteCount = Math.max(keys.filter((k) => !k.black).length, 1);
  const unit = 100 / whiteCount;

  let seen = 0;
  const placed = keys.map((key) => {
    if (key.black) {
      return { key, left: seen * unit - (unit * BLACK_WIDTH) / 2, width: unit * BLACK_WIDTH };
    }
    const left = seen * unit;
    seen += 1;
    return { key, left, width: unit };
  });

  return (
    <div className="piano" role="group" aria-label={label}>
      {placed.map(({ key, left, width }) => (
        <button
          key={key.id}
          type="button"
          className={
            `pianokey ${key.black ? "pianokey--black" : "pianokey--white"}` +
            (key.pressed ? " pianokey--on" : "")
          }
          style={{ left: `${left}%`, width: `${width}%` }}
          aria-label={key.caption ? `${key.caption} (${key.label})` : key.label}
          aria-pressed={key.pressed ?? false}
          onPointerDown={(e) => {
            // 누른 채 끌 수 있어야 하므로 포인터를 이 요소에 붙들지 않는다
            e.preventDefault();
            onPress?.(key.id);
          }}
          onPointerUp={() => onRelease?.(key.id)}
          onPointerCancel={() => onRelease?.(key.id)}
          onPointerEnter={(e) => {
            if (glide && e.buttons === 1) onPress?.(key.id);
          }}
          onPointerLeave={() => onRelease?.(key.id)}
          // 탭으로 온 사용자. 자판 연주와 달리 한 음씩이지만 소리는 난다.
          onKeyDown={(e) => {
            if (e.repeat || (e.key !== " " && e.key !== "Enter")) return;
            e.preventDefault();
            onPress?.(key.id);
          }}
          onKeyUp={(e) => {
            if (e.key !== " " && e.key !== "Enter") return;
            onRelease?.(key.id);
          }}
        >
          <span className="pianokey__label">{key.label}</span>
          {key.caption && <span className="pianokey__caption">{key.caption}</span>}
        </button>
      ))}
    </div>
  );
}

export interface RingSlot {
  /** 눌렸다고 알릴 때 그대로 돌려주는 값 */
  id: string;
  /** 자리에 적힌 글자. 빈 자리면 "" */
  label: string;
  state: "given" | "filled" | "active" | "empty" | "wrong";
}

export interface RingProps {
  /** **시계방향 순서 그대로.** 0번이 12시 자리다 */
  slots: readonly RingSlot[];
  caption?: string;
  /** 도는 방향을 말로도 적는다 */
  direction?: string;
  label?: string;
}

/**
 * 자리를 놓을 반지름 — **칸 상자의 중심이 지나는 원**이고 단위는 컨테이너의 %다.
 *
 * 38이면 바깥 테두리(50%) 안쪽에 칸이 들어앉는다. 더 키우면 칸이 테두리를 넘는다.
 */
const RING_RADIUS = 38;

/**
 * 자리를 원으로 둘러 놓는 부품 — **무엇이 적히는지 모른다.**
 *
 * `Keyboard`가 "어느 글자가 무슨 음인지 모르고 자리만 안다"와 같은 계약이다.
 * 5도권이 첫 사용자지만 이 부품은 5도권을 모른다 — 반복되는 고리면 무엇이든 쓴다.
 *
 * ## 원그래프를 쓰지 말라는 규칙과 부딪히지 않는다
 *
 * `ShareBars`가 원을 물리친 근거는 **값을 각도로 부호화하지 말라**는 것이었다
 * (각도는 길이보다 비교가 어렵고 이름표가 겹친다). 여기에는 비교할 값이 없다 —
 * **원 자체가 내용**이라, 한 바퀴 돌면 제자리로 온다는 사실을 그림이 말한다.
 * 막대로 펴면 가르치려는 것이 사라진다.
 *
 * ## SVG를 들이지 않았다
 *
 * 자리는 CSS `transform`으로 놓는다 — `rotate(θ) translate(-r) rotate(-θ)`면
 * 글자가 **똑바로 선 채** 원 위에 앉는다. `ds`에 SVG를 그리는 부품을 새로 만들면
 * 그때부터 도형 코드가 여기 쌓인다.
 *
 * ## 누를 수 있게 만들지 않았다
 *
 * **표시 전용이다.** 타이핑은 원 아래의 입력 칸이 받는다 — 절대 배치된 칸 안에서
 * `TextField`의 IME 처리와 초점 잡기를 다시 검증할 이유가 없고, 조표 활동과
 * 5도권이 **같은 입력 줄**을 쓰게 된다.
 *
 * 쓰지도 않을 `onPick`을 미리 뚫어 두지도 않았다 — `StepGrid.onCell`이 소비자
 * 없이 남아 접근성 부채가 된 선례가 있다. 필요한 활동이 생기면 그때 소비자와
 * 함께 넣는다. 그래서 자리는 `<li>`이고 **탭 정지가 하나도 안 는다.**
 */
export function Ring({ slots, caption, direction, label = "원" }: RingProps) {
  const count = Math.max(1, slots.length);
  return (
    <div className="ring">
      {caption && <p className="ring__caption">{caption}</p>}
      {/* DOM 순서 = 12시부터 시계방향이라 읽는 순서와 보이는 순서가 같다 */}
      <ol className="ring__face" aria-label={label}>
        {slots.map((slot, i) => (
          <li
            key={slot.id}
            className={`ring__slot ring__slot--${slot.state}`}
            /*
              **자리는 `left`/`top`으로 놓는다.** `transform: translate(…%)`를 쓰면
              퍼센트가 **컨테이너가 아니라 칸 자신의 크기**를 기준으로 잡혀서 열두
              자리가 전부 가운데로 겹친다(실측). `left`/`top`의 %만 컨테이너를 본다.
              12시에서 시작해 시계방향이라 그리는 순서와 읽는 순서가 같다.
            */
            style={ringSpot(i, count)}
            aria-current={slot.state === "active" ? "true" : undefined}
          >
            {slot.label}
            {/* 빈 자리도 "몇 번째"는 말해 줘야 소리로 듣는 사람이 센다 */}
            <span className="sr-only">
              {`${i + 1}번 자리 ${slot.label || "빈칸"}`}
            </span>
          </li>
        ))}
      </ol>
      {/* 화살표만 그리면 스크린리더에서 사라진다 — 글자로도 적는다 */}
      {direction && <p className="ring__direction">{direction}</p>}
    </div>
  );
}

/** `i`번째 자리의 위치. 0번이 12시, 시계방향 */
function ringSpot(i: number, count: number): CSSProperties {
  const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
  return {
    left: `${50 + RING_RADIUS * Math.cos(angle)}%`,
    top: `${50 + RING_RADIUS * Math.sin(angle)}%`,
    transform: "translate(-50%, -50%)",
  };
}

export interface StepperProps {
  label: string;
  /** 지금 값 — 문자열이다. 단위·부호를 붙이는 것은 위층의 일 */
  value: string;
  hint?: string;
  /** 자판 안내 `[내리는 키, 올리는 키]` */
  keys?: readonly [string, string];
  canDown?: boolean;
  canUp?: boolean;
  onDown?: () => void;
  onUp?: () => void;
}

/**
 * −/+ 로 한 칸씩 옮기는 값. `StepSlider`와 달리 **끝이 정해져 있지 않고**
 * 경계에 닿으면 그쪽 버튼만 잠긴다.
 */
export function Stepper({
  label,
  value,
  hint,
  keys,
  canDown = true,
  canUp = true,
  onDown,
  onUp,
}: StepperProps) {
  return (
    <div className="stepper">
      <div className="stepper__head">
        <span className="stepper__label">{label}</span>
        {keys && (
          <span className="stepper__keys">
            {keys[0]} / {keys[1]}
          </span>
        )}
      </div>
      <div className="stepper__row">
        <button
          type="button"
          className="stepper__button"
          disabled={!canDown}
          aria-label={`${label} 내리기`}
          onClick={onDown}
        >
          −
        </button>
        <output className="stepper__value">{value}</output>
        <button
          type="button"
          className="stepper__button"
          disabled={!canUp}
          aria-label={`${label} 올리기`}
          onClick={onUp}
        >
          +
        </button>
      </div>
      {hint && <p className="stepper__hint">{hint}</p>}
    </div>
  );
}

// --- 악보 --------------------------------------------------------------------

export interface StaffFigureProps {
  /** 렌더된 SVG 문자열. 없으면 fallback을 보여준다 */
  svg?: string | null;
  /** 악보를 못 그릴 때 대신 보여줄 것. 보통 음이름 */
  fallback?: string;
  /**
   * 여러 단짜리 악보. 높이 제한을 풀고 넘치면 세로로 스크롤한다.
   *
   * 기본값(두 음짜리 그림)은 높이를 170px로 묶어 두는데, 전사 악보는 단이
   * 여러 개라 거기 맞추면 글씨가 읽을 수 없게 작아진다.
   */
  tall?: boolean;
  /**
   * 가로로 긴 그림 — **폭을 꽉 채운다.**
   *
   * 기본값은 verovio가 준 제 크기로 그린다(두 음짜리 그림은 그게 맞다). 그런데
   * 음표가 여덟 개쯤 되면 제 크기가 종횡비 7:1쯤이라 **아주 얇고 작게** 나온다 —
   * 그때는 칸을 채워 키우는 편이 읽힌다. 종횡비는 viewBox가 지킨다.
   */
  wide?: boolean;
  /**
   * 지금 강조할 요소의 `id`들. 재생 커서가 쓴다.
   *
   * **문자열만 받는다** — 이 부품이 음표도 시각도 모르게 하기 위해서다. 어느
   * id가 지금 울리는지는 부르는 쪽이 정한다.
   */
  highlight?: readonly string[];
  /** 강조한 요소가 스크롤 밖이면 따라간다. 긴 악보에서만 뜻이 있다 */
  follow?: boolean;
}

/**
 * 오선지 자리.
 *
 * **악보를 직접 만들지 않는다** — 이미 만들어진 SVG 문자열을 받는다. 그래야
 * 이 부품이 verovio도 음악 이론도 모른 채로 남는다.
 */
export function StaffFigure({
  svg,
  fallback,
  tall,
  wide,
  highlight,
  follow,
}: StaffFigureProps) {
  const className =
    `staff${tall ? " staff--tall" : ""}${wide ? " staff--wide" : ""}`;
  const host = useRef<HTMLDivElement | null>(null);
  // 붙였던 것을 떼려면 무엇을 붙였는지 기억해야 한다. 지금 강조 목록에서
  // 역산하면 SVG가 새로 그려진 사이에 사라진 요소를 놓친다.
  const marked = useRef<Element[]>([]);
  const key = highlight?.join(" ") ?? "";

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    for (const el of marked.current) el.classList.remove("staff__on");
    marked.current = [];
    if (!key) return;

    for (const id of key.split(" ")) {
      // CSS.escape가 없는 환경이 있어 속성 선택자를 쓴다 — id는 verovio가
      // 만든 값이라 따옴표가 들어갈 일이 없다.
      const el = root.querySelector(`[id="${id}"]`);
      if (!el) continue;
      el.classList.add("staff__on");
      marked.current.push(el);
    }
    if (follow && marked.current[0]) {
      marked.current[0].scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [key, follow, svg]);

  if (!svg) {
    return (
      <div className={className}>
        <span className="staff__fallback">{fallback ?? ""}</span>
      </div>
    );
  }
  return (
    // 이 SVG는 앱이 스스로 만든 것이라 외부 입력이 아니다.
    <div
      ref={host}
      className={className}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// --- 결과 --------------------------------------------------------------------

export interface ScoreRowProps {
  correct: boolean;
  /** 정답 표기. "장3도 — C4–E4, 4반음" */
  answer: string;
  /** 오른쪽 보조 문구. "2.4초" / "시간 초과 · 낸 답 …" */
  meta?: string;
}

export function ScoreRow({ correct, answer, meta }: ScoreRowProps) {
  return (
    <li className="result__row">
      <span className={`result__mark--${correct ? "correct" : "wrong"}`}>
        {correct ? "○" : "×"}
      </span>
      <span className="result__answer">{answer}</span>
      <span className="result__meta">{meta}</span>
    </li>
  );
}

export interface ScoreSummaryProps {
  score: number;
  total: number;
  rows: ScoreRowProps[];
  actions?: ReactNode;
}

export function ScoreSummary({ score, total, rows, actions }: ScoreSummaryProps) {
  return (
    <div className="stack">
      <div className="result__score">
        {score} / {total}
      </div>
      <ul className="result__list">
        {rows.map((row, i) => (
          <ScoreRow key={`${row.answer}-${i}`} {...row} />
        ))}
      </ul>
      {actions && <div className="result__actions">{actions}</div>}
    </div>
  );
}

// --- 파일 입력 / 진행률 / 측정값 -------------------------------------------------

export interface FilePickerProps {
  /** 가운데 큰 글씨. "오디오 파일 열기" */
  label: string;
  /** 아래 작은 글씨. "WAV · MP3 · M4A" */
  hint?: string;
  /** `<input accept>` 그대로. "audio/*" */
  accept?: string;
  disabled?: boolean;
  onFile?: (file: File) => void;
}

/**
 * 파일 하나를 받는 자리. 눌러서 고르거나 끌어다 놓는다.
 *
 * 끌어오는 중인지(`over`)만 상태로 갖는다 — 무엇을 받았는지는 부르는 쪽의
 * 몫이다.
 */
export function FilePicker({
  label,
  hint,
  accept,
  disabled,
  onFile,
}: FilePickerProps) {
  const [over, setOver] = useState(false);
  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file && !disabled) onFile?.(file);
  };
  return (
    <label
      className={`picker${over ? " picker--over" : ""}${disabled ? " picker--off" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        take(event.dataTransfer.files);
      }}
    >
      <input
        type="file"
        className="picker__input"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = "";
        }}
      />
      <span className="picker__label">{label}</span>
      {hint && <span className="picker__hint">{hint}</span>}
    </label>
  );
}

export interface ProgressBarProps {
  /** 0~1 */
  ratio: number;
  /** 막대 위 왼쪽 문구. "스펙트럼 분석" */
  label?: string;
}

export function ProgressBar({ ratio, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <div className="progress">
      <div className="progress__head">
        <span>{label ?? ""}</span>
        <span>{Math.round(clamped * 100)}%</span>
      </div>
      <Bar ratio={clamped} />
    </div>
  );
}

export type ConfidenceLevel = "high" | "medium" | "low";

export interface MetricProps {
  /** "BPM" · "박자" · "조성" */
  label: string;
  /** 크게 보일 값. "128.4" */
  value: string;
  /** 값 아래 한 줄. 근거나 후보 */
  detail?: string;
  /**
   * 확신 정도. `low`는 점선 테두리로 "확인 필요"를 드러낸다 — 원리적으로
   * 모호한 값을 확정처럼 보여주지 않기 위한 장치다.
   */
  confidence?: ConfidenceLevel;
  /** 오른쪽 위 짧은 꼬리표. "확인 필요" */
  note?: string;
  /**
   * 눈에 띄는 경고 한 줄. **값이 틀렸을 수 있는 구체적인 이유**를 말한다.
   *
   * `note`와 갈라 둔 이유는 성격이 다르기 때문이다 — `note`는 "얼마나
   * 확신하는가"(연속적인 신뢰도의 꼬리표)이고 이쪽은 "이런 사건이 있었다"
   * (참·거짓인 진단)다. 한 자리에 합치면 둘 중 하나가 다른 하나를 덮는다.
   */
  warning?: string;
}

export function Metric({ label, value, detail, confidence, note, warning }: MetricProps) {
  return (
    <div className={`metric${confidence ? ` metric--${confidence}` : ""}`}>
      <div className="metric__head">
        <span className="metric__label">{label}</span>
        {note && <span className="metric__note">{note}</span>}
      </div>
      <div className="metric__value">{value}</div>
      {detail && <div className="metric__detail">{detail}</div>}
      {warning && <p className="metric__warning" role="status">{warning}</p>}
    </div>
  );
}

/** 측정값 여러 개를 나란히. 좁은 화면에서는 한 줄에 하나가 된다. */
export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="metric-grid">{children}</div>;
}

// --- 결과 묶음 ----------------------------------------------------------------

export interface PanelProps {
  title: string;
  /** 제목 오른쪽에 붙는 짧은 한 줄 */
  meta?: string;
  children: ReactNode;
}

/** 제목이 달린 상자. 결과 화면에서 종류가 다른 것들을 가른다. */
export function Panel({ title, meta, children }: PanelProps) {
  return (
    <section className="pane">
      <header className="pane__head">
        <h2 className="pane__title">{title}</h2>
        {meta && <span className="pane__meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

export interface AudioRowProps {
  label: string;
  /** 재생·내려받기에 함께 쓰는 주소 */
  src: string;
  /** 내려받을 때의 파일 이름 */
  filename?: string;
}

/**
 * 소리 하나를 듣고 받는 줄.
 *
 * **브라우저 기본 플레이어를 쓴다.** 재생 위치·볼륨·속도가 이미 다 들어 있고,
 * 여기서 다시 만들면 그만큼이 유지 대상이 된다.
 */
export function AudioRow({ label, src, filename }: AudioRowProps) {
  return (
    <div className="track">
      <span className="track__label">{label}</span>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- 가사가 없는 오디오다 */}
      <audio className="track__player" controls preload="none" src={src} />
      <a className="track__save" href={src} download={filename ?? label}>
        받기
      </a>
    </div>
  );
}

export interface DownloadListProps {
  items: readonly { label: string; href: string; filename: string }[];
}

/** 내려받기 묶음. 주소를 만드는 것(blob URL 등)은 부르는 쪽의 몫이다. */
export function DownloadList({ items }: DownloadListProps) {
  if (!items.length) return null;
  return (
    <div className="downloads">
      {items.map((item) => (
        <a key={item.filename} className="button" href={item.href} download={item.filename}>
          {item.label}
        </a>
      ))}
    </div>
  );
}

// --- 준비 중 화면 -------------------------------------------------------------

export interface SpecSectionProps {
  title: string;
  items: readonly string[];
}

export function SpecSection({ title, items }: SpecSectionProps) {
  if (!items.length) return null;
  return (
    <section>
      <h2 className="planned__section-title">{title}</h2>
      <ul className="planned__list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export interface PlannedNoticeProps {
  title: string;
  /** "준비 중 · quiz" 같은 한 줄 */
  meta: string;
  summary: string;
  sections: SpecSectionProps[];
}

/** 아직 만들지 않은 기능의 안내. 빈 화면 대신 무엇이 올지를 보여준다. */
export function PlannedNotice({
  title,
  meta,
  summary,
  sections,
}: PlannedNoticeProps) {
  return (
    <div className="stack">
      <PageHeading title={title} />
      <p className="muted">{meta}</p>
      <p>{summary}</p>
      {sections.map((s) => (
        <SpecSection key={s.title} {...s} />
      ))}
    </div>
  );
}

// --- 스텝 그리드 ----------------------------------------------------------------

export interface StepGridRow {
  /** React 키. 행 이름이 겹쳐도 안전해야 한다 */
  id: string;
  /** 왼쪽에 그대로 나가는 행 이름 */
  label: string;
  /**
   * 칸마다의 세기 0~1. 0이면 빈 칸이다.
   *
   * 불리언이 아닌 것은 **세기(벨로시티)를 표현할 자리**를 남겨 두기 위해서다.
   */
  cells: readonly number[];
  /**
   * 채워진 칸에 찍을 글자 하나.
   *
   * **색만으로 구별하지 않기 위한 표식이다** — `ShareBars`가 지키는 규칙과 같다.
   * 안 주면 칸이 색으로만 구별되므로, 행이 여럿이면 반드시 줄 것.
   */
  mark?: string;
}

export interface StepGridProps {
  rows: readonly StepGridRow[];
  /** 가는 세로줄 간격. 박마다 긋고 싶으면 한 박의 칸 수를 준다 */
  group?: number;
  /**
   * 굵은 세로줄 간격. 마디마다 긋고 싶으면 한 마디의 칸 수를 준다.
   *
   * **두 단계가 필요하다** — 박선만 그으면 열 머리가 `1 2 3 4 2 2 3 4`처럼
   * 읽혀 마디 번호와 박 번호가 섞인다(실측). 마디는 선이 말하고 열 머리는
   * 박만 말하는 편이 읽기 쉽다.
   */
  major?: number;
  /** 지금 재생 중인 칸. 없으면 커서를 안 그린다 */
  cursor?: number | null;
  /** 열 제목. 안 주면 열 머리를 그리지 않는다 */
  columns?: readonly string[];
  caption?: string;
  /** 주면 칸이 눌린다 */
  onCell?: (rowId: string, step: number) => void;
}

/**
 * 시퀀서식 스텝 그리드. **행이 무엇인지 모른다** — 이름과 숫자만 받는다.
 *
 * `Matrix`로는 원리적으로 안 되는 자리라 새로 만들었다. `Matrix`는 문자열
 * 격자(`string[][]`)이고 `row[0]`을 React 키로 쓰며 칸의 **세기**를 표현할
 * 방법이 `--on` 하나뿐이다. 여기서 필요한 것은 네 가지가 더 있다 —
 * 세기, 재생 커서, 박마다의 굵은 줄, 그리고 열이 64개까지 가는 가로 스크롤.
 *
 * **이름이 `DrumGrid`가 아닌 이유**: 이 부품은 행이 악기인지 모른다. 베이스
 * 리프도 기타 리듬도 같은 모양이라 그때 그대로 쓴다.
 */
export function StepGrid({ rows, group, major, cursor, columns, caption, onCell }: StepGridProps) {
  const width = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  return (
    <div className="stepgrid">
      {caption && <p className="stepgrid__caption">{caption}</p>}
      <div className="stepgrid__scroll">
        <table className="stepgrid__table">
          {columns && (
            <thead>
              <tr>
                <th />
                {Array.from({ length: width }, (_, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={[
                      "stepgrid__head",
                      group && i % group === 0 ? "stepgrid__head--beat" : "",
                      major && i % major === 0 ? "stepgrid__head--bar" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {columns[i] ?? ""}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="stepgrid__label">
                  {row.label}
                </th>
                {Array.from({ length: width }, (_, i) => {
                  const value = row.cells[i] ?? 0;
                  const classes = ["stepgrid__cell"];
                  if (value > 0) classes.push("stepgrid__cell--on");
                  if (group && i % group === 0) classes.push("stepgrid__cell--beat");
                  if (major && i % major === 0) classes.push("stepgrid__cell--bar");
                  if (cursor === i) classes.push("stepgrid__cell--cursor");
                  const content = value > 0 ? (row.mark ?? "●") : "";
                  return (
                    <td
                      key={i}
                      className={classes.join(" ")}
                      style={value > 0 ? { opacity: 0.45 + 0.55 * Math.min(1, value) } : undefined}
                      onClick={onCell ? () => onCell(row.id, i) : undefined}
                    >
                      {content}
                      {value > 0 && <span className="sr-only">{`${row.label} ${i + 1}번 칸`}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
