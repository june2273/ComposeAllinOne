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

import { useEffect, useRef, useState, type ReactNode } from "react";

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
export function ShareBars({ rows, caption }: ShareBarsProps) {
  return (
    <div className="shares">
      {caption && <div className="shares__caption">{caption}</div>}
      {rows.map((row) => (
        <div
          key={row.label}
          className={`shares__row${row.selected ? " shares__row--on" : ""}`}
        >
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
        </div>
      ))}
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
}

/**
 * 오선지 자리.
 *
 * **악보를 직접 만들지 않는다** — 이미 만들어진 SVG 문자열을 받는다. 그래야
 * 이 부품이 verovio도 음악 이론도 모른 채로 남는다.
 */
export function StaffFigure({ svg, fallback, tall }: StaffFigureProps) {
  const className = `staff${tall ? " staff--tall" : ""}`;
  if (!svg) {
    return (
      <div className={className}>
        <span className="staff__fallback">{fallback ?? ""}</span>
      </div>
    );
  }
  return (
    // 이 SVG는 앱이 스스로 만든 것이라 외부 입력이 아니다.
    <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />
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
}

export function Metric({ label, value, detail, confidence, note }: MetricProps) {
  return (
    <div className={`metric${confidence ? ` metric--${confidence}` : ""}`}>
      <div className="metric__head">
        <span className="metric__label">{label}</span>
        {note && <span className="metric__note">{note}</span>}
      </div>
      <div className="metric__value">{value}</div>
      {detail && <div className="metric__detail">{detail}</div>}
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
