/** 이식 검증 — Python 테스트와 같은 케이스를 그대로 돌린다. */
import { Pitch, intervalBetween, natural } from "../src/core/theory";
import { GradingMode, DIATONIC_INTERVALS, INTERMEDIATE, C_MAJOR_PCS } from "../src/core/config";
import { makeGrader } from "../src/core/grading";
import { DiatonicIntervalGenerator, Rng, makeGenerator, type IntervalQuestion } from "../src/core/questions";
import { Session, Phase, timedOut } from "../src/core/session";
import * as C from "../src/core/catalog";

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
  optionalPcs:new Set([7]), keyContext:null, prompt:"", answerText:"Cmaj7", tags:[] };
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

console.log("\n=== 5. 음정 채점 + 진단 ===");
const gen = new DiatonicIntervalGenerator(DIATONIC_INTERVALS.difficulty, new Rng(3));
let mq: IntervalQuestion = gen.generate();
while (mq.interval.name !== "장3도") mq = gen.generate();
const ig = makeGrader(GradingMode.IntervalForm);
const iv = mq.interval;
check("전부 정답", ig.grade(mq, {number:iv.number, semitones:iv.semitones, quality:iv.quality}).correct);
check("도수 틀림 → 안내", ig.grade(mq, {number:iv.number+1, semitones:iv.semitones, quality:iv.quality}).detail.includes("도수부터"));
check("반음 틀림 → 안내", ig.grade(mq, {number:iv.number, semitones:iv.semitones+1, quality:iv.quality}).detail.includes("반음 자리"));
check("성질만 틀림 → 안내", ig.grade(mq, {number:iv.number, semitones:iv.semitones, quality:"감"}).detail.includes("성질만"));
check("빈 응답 오답", !ig.grade(mq, {number:null, semitones:null, quality:null}).correct);

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
  s.respond({number:iq.interval.number, semitones:iq.interval.semitones, quality:iq.interval.quality}, 3);
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
const good = {number:q1.interval.number, semitones:q1.interval.semitones, quality:q1.interval.quality};
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
check("15개", C.CATALOG.length === 15, C.CATALOG.length);
check("동작 2개", C.readyActivities().length === 2);
check("id 중복 없음", new Set(C.CATALOG.map(a => a.id)).size === 15);
check("ready면 config", C.readyActivities().every(a => a.config !== undefined));
check("planned면 설명", C.CATALOG.filter(a => !C.isReady(a)).every(a => (a.features?.length ?? 0) + (a.requires?.length ?? 0) > 0));
check("연주형/도구형 분리", C.BY_ID["harmony.chord_play"].kind === C.Kind.Performance && C.BY_ID["analysis.console"].kind === C.Kind.Tool);
for (const d of Object.values(C.Domain)) { const [a,b] = C.counts(d); console.log(`     ${d}: ${a} / ${b}`); }

test("이식 검증 전체", () => {
  console.log(`\n${fails.length ? "실패: " + fails.join(", ") : "전부 통과"}`);
  expect(fails).toEqual([]);
});
