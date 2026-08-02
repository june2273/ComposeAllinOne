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

import type { ReactNode } from "react";

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
      <div className="quiz__timer">
        <div
          className="quiz__timer-fill"
          style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
        />
      </div>
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
  /** 버튼 하나당 [보이는 이름, 단축키 글자] */
  choices: ReadonlyArray<readonly [string, string]>;
  disabled?: boolean;
  onPick?: (name: string) => void;
}

/** 한 줄에 늘어놓는 선택지. 음정 성질(완전/장/단/증/감)이 이걸 쓴다. */
export function ChoiceRow({ choices, disabled, onPick }: ChoiceRowProps) {
  return (
    <div
      className="interval__qualities"
      style={{ gridTemplateColumns: `repeat(${choices.length}, 1fr)` }}
    >
      {choices.map(([name, key]) => (
        <Button key={name} disabled={disabled} onClick={() => onPick?.(name)}>
          {name} ({key})
        </Button>
      ))}
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="interval__hint">{children}</p>;
}

// --- 악보 --------------------------------------------------------------------

export interface StaffFigureProps {
  /** 렌더된 SVG 문자열. 없으면 fallback을 보여준다 */
  svg?: string | null;
  /** 악보를 못 그릴 때 대신 보여줄 것. 보통 음이름 */
  fallback?: string;
}

/**
 * 오선지 자리.
 *
 * **악보를 직접 만들지 않는다** — 이미 만들어진 SVG 문자열을 받는다. 그래야
 * 이 부품이 verovio도 음악 이론도 모른 채로 남는다.
 */
export function StaffFigure({ svg, fallback }: StaffFigureProps) {
  if (!svg) {
    return (
      <div className="staff">
        <span className="staff__fallback">{fallback ?? ""}</span>
      </div>
    );
  }
  return (
    // 이 SVG는 앱이 스스로 만든 것이라 외부 입력이 아니다.
    <div className="staff" dangerouslySetInnerHTML={{ __html: svg }} />
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
