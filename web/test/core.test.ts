/** 이식 검증 — Python 테스트와 같은 케이스를 그대로 돌린다. */
import { Pitch, diatonicHalfSteps, intervalBetween, natural } from "../src/core/theory";
import { GradingMode, DIATONIC_INTERVALS, INTERMEDIATE, C_MAJOR_PCS } from "../src/core/config";
import { makeGrader } from "../src/core/grading";
import { DiatonicIntervalGenerator, Rng, makeGenerator, type IntervalQuestion } from "../src/core/questions";
import { Session, Phase, timedOut } from "../src/core/session";
import * as C from "../src/core/catalog";
import { MAJOR_MINOR_TABLE, PERFECT_TABLE } from "../src/ui/stages";

import { expect, test } from "vitest";

const fails: string[] = [];
const check = (name: string, ok: boolean, extra: unknown = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : "   " + String(extra)}`);
  if (!ok) fails.push(name);
};

console.log("=== 1. Pitch ===");
check("C4 = 60", new Pitch("C").midi === 60);
check("B♯3 = 60", new Pitch("B", 1, 3).midi === 60);
check("C♭4 = 59", new Pitch("C", -1, 4).midi === 59);
check("표기", new Pitch("B", -1, 4).name === "B♭4", new Pitch("B",-1,4).name);
check("자연음 역변환", natural(64).name === "E4");
try { natural(61); check("검은건반 거부", false); } catch { check("검은건반 거부", true); }

console.log("\n=== 2. 교과서 음정표 (Python 테스트와 동일 케이스) ===");
const CASES: [string, number, number, string, number, number, number, string][] = [
  ["C",0,4,"C",0,4, 1, "완전"], ["C",0,4,"D",0,4, 2, "장"], ["C",0,4,"D",-1,4, 2, "단"],
  ["C",0,4,"E",0,4, 3, "장"], ["C",0,4,"E",-1,4, 3, "단"], ["C",0,4,"F",0,4, 4, "완전"],
  ["F",0,4,"B",0,4, 4, "증"], ["B",0,3,"F",0,4, 5, "감"], ["C",0,4,"G",0,4, 5, "완전"],
  ["C",0,4,"A",0,4, 6, "장"], ["C",0,4,"A",-1,4, 6, "단"], ["C",0,4,"B",0,4, 7, "장"],
  ["C",0,4,"B",-1,4, 7, "단"], ["C",0,4,"C",0,5, 8, "완전"], ["C",0,4,"F",-1,4, 4, "감"],
  ["C",0,4,"D",1,4, 2, "증"], ["C",0,4,"E",1,4, 3, "증"], ["C",0,4,"G",-1,4, 5, "감"],
  ["C",0,4,"G",1,4, 5, "증"], ["C",0,4,"D",2,4, 2, "겹증"], ["C",0,4,"G",-2,4, 5, "겹감"],
  ["C",0,4,"D",0,5, 9, "장"], ["C",0,4,"E",0,5, 10, "장"], ["C",0,4,"D",-2,4, 2, "감"],
];
const EXPECT_SEMI: Record<string, number> = {};
for (const [l,la,lo,u,ua,uo,num,qual] of CASES) {
  const lp = new Pitch(l,la,lo), up = new Pitch(u,ua,uo);
  const iv = intervalBetween(lp, up);
  const ok = iv.number === num && iv.quality === qual;
  EXPECT_SEMI[`${lp.name}-${up.name}`] = iv.semitones;
  check(`${lp.name}–${up.name} = ${qual}${num}도/${iv.semitones}반음`, ok, `실제 ${iv.quality}${iv.number}도`);
}
try { intervalBetween(new Pitch("C",2,4), new Pitch("D",-2,4)); check("이름 없는 음정 거부", false); }
catch { check("이름 없는 음정 거부", true); }
check("순서 무관", intervalBetween(new Pitch("E"), new Pitch("C")).name === intervalBetween(new Pitch("C"), new Pitch("E")).name);
check("같은 4반음 다른 도수",
  intervalBetween(new Pitch("C"), new Pitch("E")).semitones === intervalBetween(new Pitch("C"), new Pitch("F",-1)).semitones &&
  intervalBetween(new Pitch("C"), new Pitch("E")).number !== intervalBetween(new Pitch("C"), new Pitch("F",-1)).number);

console.log("\n=== 3. 온음계 전수 (C4~A5) ===");
const scale = [];
for (let n = 60; n <= 81; n++) if (C_MAJOR_PCS.has(n % 12)) scale.push(natural(n));
const names = new Set<string>();
for (let i = 0; i < scale.length; i++)
  for (let k = 1; k <= 7 && i + k < scale.length; k++)
    names.add(intervalBetween(scale[i], scale[i+k]).name);
check("13종 등장", names.size === 13, [...names].sort());
check("다섯 성질", ["완전","장","단","증","감"].every(q => [...names].some(n => n.startsWith(q))));

console.log("\n=== 4. 채점 4+1 모드 ===");
const q7 = { kind:"ear_chord", answerNotes:[60,64,67,71], requiredPcs:new Set([0,4,11]),
  optionalPcs:new Set([7]), prompt:"", answerText:"Cmaj7", tags:[] };
const G: [GradingMode, number[], boolean, string][] = [
  [GradingMode.PitchClass, [72,76,83], true, "옥타브 위 + 5음 생략"],
  [GradingMode.PitchClass, [60,64,67,71,62], false, "군더더기 9음"],
  [GradingMode.PitchClass, [60,64,67], false, "필수 7음 누락"],
  [GradingMode.BassNote, [60,64,67,71], true, "최저음 C"],
  [GradingMode.BassNote, [64,67,71,72], false, "최저음 E"],
  [GradingMode.ExactVoicing, [72,76,79,83], true, "옥타브 통째 이동"],
  [GradingMode.ExactVoicing, [60,64,67,83], false, "보이싱 다름"],
  [GradingMode.AbsolutePitch, [60,64,67,71], true, "완전 일치"],
  [GradingMode.AbsolutePitch, [72,76,79,83], false, "옥타브 이동 불허"],
];
for (const [mode, played, want, label] of G)
  check(`${mode.padEnd(15)} ${label}`, makeGrader(mode).grade(q7, played).correct === want);

console.log("\n=== 5. 온음계적 반음 개수 (교재 음정표의 세로축) ===");
// 반음계적 거리와 헷갈리기 쉬운 값이라 대표 사례를 못박아 둔다
const HS: [string, string, number][] = [
  ["C4","D4",0], ["C4","E4",0], ["D4","F4",1], ["C4","F4",1], ["F4","B4",0],
  ["C4","G4",1], ["B3","F4",2], ["C4","A4",1], ["E4","C5",2], ["C4","B4",1],
  ["D4","C5",2], ["C4","C5",2],
];
const byName = (n: string) => new Pitch(n[0], 0, Number(n.slice(1)));
for (const [a,b,want] of HS)
  check(`${a}–${b} 반음 ${want}개`, diatonicHalfSteps(byName(a), byName(b)) === want,
    diatonicHalfSteps(byName(a), byName(b)));
check("C4–A4는 반음 1개지만 반음계로는 9", 
  diatonicHalfSteps(byName("C4"), byName("A4")) === 1 &&
  intervalBetween(byName("C4"), byName("A4")).semitones === 9);
try { diatonicHalfSteps(new Pitch("E",-1,4), new Pitch("F",0,4)); check("임시표 거부", false); }
catch { check("임시표 거부", true); }

console.log("\n=== 5-1. 화면의 음정표가 theory와 일치하는가 ===");
// 표는 손으로 옮겨 적은 값이다. 온음계의 모든 쌍을 대조해 오타를 잡는다.
const TABLE_CELL = new Map<string, string>();
for (const t of [PERFECT_TABLE, MAJOR_MINOR_TABLE])
  for (const row of t.rows)
    row.forEach((cell, i) => {
      if (i === 0 || !cell) return;
      TABLE_CELL.set(`${t.columns[i].replace("도","")}:${row[0].replace("개","")}`, cell);
    });
const scaleC: Pitch[] = [];
for (let n = 60; n <= 84; n += 1) if (C_MAJOR_PCS.has(n % 12)) scaleC.push(natural(n));
let cellChecked = 0;
let cellBad = "";
for (let i = 0; i < scaleC.length; i += 1)
  for (let k = 0; k <= 7 && i + k < scaleC.length; k += 1) {
    const lo = scaleC[i], hi = scaleC[i + k];
    const ivv = intervalBetween(lo, hi);
    const key = `${ivv.number}:${diatonicHalfSteps(lo, hi)}`;
    const cell = TABLE_CELL.get(key);
    if (cell === undefined) { cellBad = `표에 없는 칸 ${key} (${lo.name}–${hi.name})`; continue; }
    if (cell !== ivv.quality) cellBad = `${key} → 표 ${cell} / 실제 ${ivv.quality}`;
    cellChecked += 1;
  }
check("모든 온음계 쌍이 표와 일치", cellBad === "" && cellChecked === 92, cellBad || cellChecked);

console.log("\n=== 5-2. 음정 채점 + 진단 (3단계) ===");
const gen = new DiatonicIntervalGenerator(DIATONIC_INTERVALS.difficulty, new Rng(3));
let mq: IntervalQuestion = gen.generate();
while (mq.interval.name !== "장3도") mq = gen.generate();
const iv = mq.interval;

const ig = makeGrader(GradingMode.IntervalForm);
check("본: 전부 정답", ig.grade(mq, {form:"interval", number:iv.number, quality:iv.quality}).correct);
check("본: 도수 틀림 → 안내", ig.grade(mq, {form:"interval", number:iv.number+1, quality:iv.quality}).detail.includes("도수부터"));
check("본: 성질 틀림 → 반음 개수 안내", ig.grade(mq, {form:"interval", number:iv.number, quality:"감"}).detail.includes(`반음이 ${mq.halfSteps}개`));
check("본: 빈 응답 오답", !ig.grade(mq, {form:"interval", number:null, quality:null}).correct);
check("본: 다른 스테이지 응답 거부", !ig.grade(mq, {form:"count", number:iv.number, halfSteps:mq.halfSteps}).correct);

const cg = makeGrader(GradingMode.IntervalCount);
check("연습1: 정답", cg.grade(mq, {form:"count", number:iv.number, halfSteps:mq.halfSteps}).correct);
check("연습1: 성질은 묻지 않는다", cg.grade(mq, {form:"count", number:iv.number, halfSteps:mq.halfSteps}).detail === mq.answerText);
check("연습1: 도수 틀림 → 안내", cg.grade(mq, {form:"count", number:iv.number+1, halfSteps:mq.halfSteps}).detail.includes("도수부터"));
check("연습1: 반음 틀림 → 안내", cg.grade(mq, {form:"count", number:iv.number, halfSteps:mq.halfSteps+1}).detail.includes("미–파"));

const qg = makeGrader(GradingMode.IntervalQuality);
check("연습2: 정답", qg.grade(mq, {form:"quality", quality:iv.quality}).correct);
check("연습2: 오답 → 표 안내", qg.grade(mq, {form:"quality", quality:"감"}).detail.includes(`${iv.number}도에 반음 ${mq.halfSteps}개`));

console.log("\n=== 6. 음정 종류 분포 (트라이톤이 실제로 나오는가) ===");
const g2 = new DiatonicIntervalGenerator(DIATONIC_INTERVALS.difficulty, new Rng(1));
const tally: Record<string, number> = {};
for (let i = 0; i < 1300; i++) { const n = g2.generate().interval.name; tally[n] = (tally[n]??0)+1; }
const pcts = Object.values(tally).map(v => v/13);
check("13종 모두 등장", Object.keys(tally).length === 13, Object.keys(tally).length);
check("최소 5% 이상", Math.min(...pcts) >= 5, Math.min(...pcts).toFixed(1));
check("최대 12% 이하", Math.max(...pcts) <= 12, Math.max(...pcts).toFixed(1));

console.log("\n=== 7. 세션 ===");
const mk = (cfg: typeof INTERMEDIATE, seed = 5) =>
  new Session(cfg, makeGenerator(cfg, new Rng(seed)), makeGrader(cfg.difficulty.grading));
let s = mk(DIATONIC_INTERVALS); s.start();
let qs: IntervalQuestion[] = [];
for (let q; (q = s.nextQuestion()) !== null; ) {
  const iq = q as IntervalQuestion; qs.push(iq); s.beginListening();
  s.respond({form:"interval", number:iq.interval.number, quality:iq.interval.quality}, 3);
}
check("10문제 만점", qs.length === 10 && s.score === 10, `${qs.length}문제 ${s.score}점`);
check("종료 상태", s.phase === Phase.Finished);
check("2~8도만", qs.every(q => q.interval.number >= 2 && q.interval.number <= 8));
check("흰건반만", qs.every(q => q.answerNotes.every(n => C_MAJOR_PCS.has(n % 12))));

s = mk(DIATONIC_INTERVALS); s.start();
while (s.nextQuestion() !== null) { s.beginListening(); s.timeOut(99); }
check("전부 시간초과 0점", s.score === 0 && s.results.every(timedOut));
check("초 클램프 10", s.results.every(r => r.seconds === 10));

s = mk(DIATONIC_INTERVALS); s.start();
const q1 = s.nextQuestion() as IntervalQuestion;
const good = {form:"interval" as const, number:q1.interval.number, quality:q1.interval.quality};
check("락아웃 중 응답 거부", s.respond(good, 1) === null);
check("락아웃 중 시간초과 무효", s.timeOut(1) === null);
s.beginListening();
check("해제 후 수용", s.respond(good, 1)?.correct === true);
check("피드백 중 재응답 거부", s.respond(good, 1) === null);

s = mk(INTERMEDIATE); s.start();
for (let q; (q = s.nextQuestion()) !== null; ) {
  s.beginListening(); for (const n of q.answerNotes) s.collect(n); s.submit(1);
}
check("1음 청음 만점", s.score === 10, s.score);
let rejected = 0;
s = mk(INTERMEDIATE); s.start(); s.nextQuestion();
for (let i = 0; i < 500; i++) if (!s.collect(60 + (i % 13))) rejected++;
check("락아웃 중 500회 전부 거부", rejected === 500, rejected);

console.log("\n=== 8. 카탈로그 ===");
check("17개", C.CATALOG.length === 17, C.CATALOG.length);
check("동작 5개", C.readyActivities().length === 5, C.readyActivities().length);
check("id 중복 없음", new Set(C.CATALOG.map(a => a.id)).size === C.CATALOG.length);
check("ready인 문항형이면 config", C.readyActivities().filter(a => a.kind === C.Kind.Quiz).every(a => a.config !== undefined));
check("planned면 설명", C.CATALOG.filter(a => !C.isReady(a)).every(a => (a.features?.length ?? 0) + (a.requires?.length ?? 0) > 0));
check("연주형/도구형 분리", C.BY_ID["harmony.chord_play"].kind === C.Kind.Performance && C.BY_ID["analysis.console"].kind === C.Kind.Tool);
for (const d of Object.values(C.Domain)) { const [a,b] = C.counts(d); console.log(`     ${d}: ${a} / ${b}`); }

test("이식 검증 전체", () => {
  console.log(`\n${fails.length ? "실패: " + fails.join(", ") : "전부 통과"}`);
  expect(fails).toEqual([]);
});
