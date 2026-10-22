/** 이식 검증 — Python 테스트와 같은 케이스를 그대로 돌린다. */
import {
  MAJOR_LADDER,
  PERFECT_LADDER,
  Pitch,
  diatonicHalfSteps,
  intervalBetween,
  natural,
  ACCIDENTAL_TEXT,
  parseIntervalAnswer,
  qualityLadder,
  withoutAlter,
} from "../src/core/theory";
import {
  GradingMode,
  CIRCLE_MIX,
  CIRCLE_OF_FIFTHS,
  CIRCLE_SPANS,
  DIATONIC_INTERVALS,
  INTERMEDIATE,
  INTERVALS,
  KEY_SIGNATURE,
  SCALE,
  SCALE_MIX,
  C_MAJOR_PCS,
  Stage,
  optionsOf,
  withOptions,
} from "../src/core/config";
import { makeGrader } from "../src/core/grading";
import {
  IntervalBuildGenerator,
  IntervalGenerator,
  Rng,
  isIntervalBuildQuestion,
  isIntervalQuestion,
  isKeyQuestion,
  makeGenerator,
  type IntervalBuildQuestion,
  type IntervalQuestion,
  type Question,
} from "../src/core/questions";
import { clefFor, keySignatureMusicXml, melodicMusicXml } from "../src/core/score";
import {
  SCALE_KINDS,
  ScaleKind,
  raisedDegrees,
  scaleName,
  scalePitches,
  tonics,
} from "../src/core/harmony/scales";
import {
  CIRCLE,
  CIRCLE_SIZE,
  ENHARMONIC,
  KEYS,
  KEY_KINDS,
  KeyKind,
  accidentalLetters,
  circleAt,
  circleNames,
  enharmonicOf,
  keyAt,
  keyLabel,
  majorTonicPcByRule,
  normalizeKeyName,
  normalizeLetters,
  parseSignature,
  positionOf,
  signatureLabel,
  tonicName,
  tonicPc,
  wrapPosition,
} from "../src/core/harmony/keys";
import { keyFifths, keyName } from "../src/core/analysis/key";
import { Session, Phase, timedOut } from "../src/core/session";
import * as C from "../src/core/catalog";
import {
  MAJOR_MINOR_TABLE,
  PERFECT_TABLE,
  stageFor,
  usesMidiInput,
  usesTable,
} from "../src/ui/stages";

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
// 겹겹증·겹겹감 바깥은 이름이 없다 (C♯♯–G♭♭는 완전5도에서 네 칸 좁다)
try { intervalBetween(new Pitch("C",2,4), new Pitch("G",-2,4)); check("이름 없는 음정 거부", false); }
catch { check("이름 없는 음정 거부", true); }
check("겹겹증·겹겹감까지는 이름이 있다", intervalBetween(new Pitch("C",2,4), new Pitch("D",-2,4)).name === "겹겹감2도");
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
/*
  **임시표를 무시하고 센다.** E♭–F도 E–F와 같은 1개다. 그래서 이 값이 가리키는
  성질(단2도)은 최종 답이 아니라 골격이고, 실제 음정은 사다리를 한 칸 옮긴
  장2도다 — 그 두 값이 갈린다는 것이 이 함수를 쓰는 법의 전부다.
*/
check("임시표를 무시하고 센다", diatonicHalfSteps(new Pitch("E",-1,4), new Pitch("F",0,4)) === 1);
check("골격과 실제가 갈린다",
  intervalBetween(new Pitch("E",0,4), new Pitch("F",0,4)).name === "단2도" &&
  intervalBetween(new Pitch("E",-1,4), new Pitch("F",0,4)).name === "장2도");

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
const gen = new IntervalGenerator(DIATONIC_INTERVALS.difficulty, new Rng(3));
let mq: IntervalQuestion = gen.generate();
while (mq.interval.name !== "장3도") mq = gen.generate();
const iv = mq.interval;

const ig = makeGrader(GradingMode.IntervalForm);
check("본: 전부 정답", ig.grade(mq, {form:"interval", number:iv.number, quality:iv.quality}).correct);
check("본: 도수 틀림 → 안내", ig.grade(mq, {form:"interval", number:iv.number+1, quality:iv.quality}).detail.includes("도수부터"));
check("본: 성질 틀림 → 반음 개수 안내", ig.grade(mq, {form:"interval", number:iv.number, quality:"감"}).detail.includes(`반음 ${mq.halfSteps}개`));
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
const g2 = new IntervalGenerator(DIATONIC_INTERVALS.difficulty, new Rng(1));
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
check("18개", C.CATALOG.length === 18, C.CATALOG.length);
check("동작 8개", C.readyActivities().length === 8, C.readyActivities().length);
check("id 중복 없음", new Set(C.CATALOG.map(a => a.id)).size === C.CATALOG.length);
check("ready인 문항형이면 config", C.readyActivities().filter(a => a.kind === C.Kind.Quiz).every(a => a.config !== undefined));
check("planned면 설명", C.CATALOG.filter(a => !C.isReady(a)).every(a => (a.features?.length ?? 0) + (a.requires?.length ?? 0) > 0));
check("연주형/도구형 분리", C.BY_ID["harmony.chord_play"].kind === C.Kind.Performance && C.BY_ID["analysis.console"].kind === C.Kind.Tool);
for (const d of Object.values(C.Domain)) { const [a,b] = C.counts(d); console.log(`     ${d}: ${a} / ${b}`); }

console.log("\n=== 9. 반음계적 음정 ===");
// 옛 생성기와 같은 축(maxAlter 0)이면 문제 집합이 그대로여야 한다.
// **이 한 줄이 이번 변경의 회귀 시험 전부다.**
const diatonicNames = new IntervalGenerator(DIATONIC_INTERVALS.difficulty).intervalNames;
check("온음계 13종 그대로", diatonicNames.length === 13, diatonicNames.length);
check("온음계에 겹증·겹감 없음", !diatonicNames.some((n) => n.startsWith("겹")));

const CHROMATIC = { ...DIATONIC_INTERVALS.difficulty, maxAlter: 1 };
const chrom = new IntervalGenerator(CHROMATIC, new Rng(5));
check("반음계에 겹증·겹감 등장", chrom.intervalNames.some((n) => n.startsWith("겹증")) && chrom.intervalNames.some((n) => n.startsWith("겹감")));
check("사용자 예: C4–G♯4 = 증5도", intervalBetween(new Pitch("C",0,4), new Pitch("G",1,4)).name === "증5도");
check("C♯4–G♭4 = 겹감5도", intervalBetween(new Pitch("C",1,4), new Pitch("G",-1,4)).name === "겹감5도");
check("C♭4–G♯♯4 = 겹겹증5도", intervalBetween(new Pitch("C",-1,4), new Pitch("G",2,4)).name === "겹겹증5도");

// 생성기가 낸 이름이 전부 theory와 일치하고, 골격이 임시표를 뗀 값인가
let genBad = "";
for (let i = 0; i < 400; i++) {
  const q = chrom.generate();
  if (q.interval.name !== intervalBetween(q.lower, q.upper).name) genBad = `이름 ${q.answerText}`;
  if (q.skeleton.name !== intervalBetween(withoutAlter(q.lower), withoutAlter(q.upper)).name) genBad = `골격 ${q.answerText}`;
  if (q.halfSteps !== diatonicHalfSteps(q.lower, q.upper)) genBad = `반음 ${q.answerText}`;
  if (q.upper.midi <= q.lower.midi) genBad = `뒤집힘 ${q.answerText}`;
}
check("반음계 문제 400개가 theory와 일치", genBad === "", genBad);

const COMPOUND = { ...DIATONIC_INTERVALS.difficulty, noteHigh: 88, maxIntervalNumber: 13 };
const wide = new IntervalGenerator(COMPOUND, new Rng(9)).intervalNames;
check("겹음정 9~13도 등장", [9,10,11,12,13].every((n) => wide.some((name) => name.endsWith(`${n}도`))), wide.join(" "));
check("E♭4–F5 = 장9도", intervalBetween(new Pitch("E",-1,4), new Pitch("F",0,5)).name === "장9도");
check("E♭4–F5의 반음 개수는 3", diatonicHalfSteps(new Pitch("E",-1,4), new Pitch("F",0,5)) === 3);

console.log("\n=== 10. 성질 사다리와 답 파서 ===");
// 사다리의 i번째가 기준에서 (i - 중앙)만큼 벌어진 음정의 이름과 같은가.
// 교재 교차표를 92쌍으로 지키는 것과 같은 자리의 시험이다.
let ladderBad = "";
for (const [number, ladder, base, center] of [
  [5, PERFECT_LADDER, new Pitch("G",0,4), PERFECT_LADDER.indexOf("완전")],
  [3, MAJOR_LADDER, new Pitch("E",0,4), MAJOR_LADDER.indexOf("장")],
] as const) {
  ladder.forEach((quality, i) => {
    // 겹겹증·겹겹감은 한 음의 임시표(±2)만으로는 못 만든다 — 남는 만큼을
    // 아래 음에 반대 방향으로 붙인다.
    const shift = i - center;
    const upAlter = Math.max(-2, Math.min(2, shift));
    const upper = new Pitch(base.letter, upAlter, base.octave);
    const lower = new Pitch("C", -(shift - upAlter), 4);
    const got = intervalBetween(lower, upper).name;
    if (got !== `${quality}${number}도`) ladderBad = `${number}도 ${i}칸: 표 ${quality} / 실제 ${got}`;
  });
}
check("A·B표 칸 순서가 intervalBetween과 일치", ladderBad === "", ladderBad);
// 교재 사진 그대로여야 한다. **B표가 A표보다 한 칸 길다** — 장·단이 둘 다 기준이라
// 좁히는 쪽을 단에서 세기 때문이다.
check("A표 = 교재", qualityLadder(5, 1).join(" ") === "겹감 감 완전 증 겹증", qualityLadder(5, 1).join(" "));
check("B표 = 교재", qualityLadder(3, 1).join(" ") === "겹감 감 단 장 증 겹증", qualityLadder(3, 1).join(" "));
check("겹임시표를 켜면 양끝이 한 칸씩 는다",
  qualityLadder(5, 2).join(" ") === "겹겹감 겹감 감 완전 증 겹증 겹겹증" &&
  qualityLadder(3, 2).join(" ") === "겹겹감 겹감 감 단 장 증 겹증 겹겹증");

const PARSE: [string, string | null, number | null][] = [
  ["증5", "증", 5], ["증5도", "증", 5], ["겹겹증4", "겹겹증", 4], ["겹감8", "겹감", 8],
  ["장9", "장", 9], ["감13", "감", 13], ["장10", "장", 10], ["완전5", "완전", 5],
  ["장", "장", null], ["겹증", "겹증", null],
  ["A5", "증", 5], ["AAA4", "겹겹증", 4], ["dd7", "겹감", 7], ["m3", "장", 3],
  [" 증 5 ", "증", 5], ["", null, null], ["3", null, null], ["증오", null, null], ["장0", null, null],
];
let parseBad = "";
for (const [text, quality, number] of PARSE) {
  const got = parseIntervalAnswer(text);
  const ok = quality === null ? got === null : got?.quality === quality && got.number === number;
  if (!ok) parseBad = `${text} → ${JSON.stringify(got)}`;
}
check("답 파서", parseBad === "", parseBad);

console.log("\n=== 11. 낮은음자리표와 음정 해석 ===");

// 자리표는 **음이 정한다.** 옵션은 음역만 내리고, 어느 자리표로 그릴지는 이 함수
// 하나가 본다 — 둘을 따로 들면 악보와 실제 음이 갈릴 수 있다.
check("가운데가 C4 위면 높은음자리표", clefFor([new Pitch("C",0,4), new Pitch("E",0,4)])[0] === "G");
check("가운데가 C4 아래면 낮은음자리표", clefFor([new Pitch("C",0,3), new Pitch("E",0,3)])[0] === "F");
// 위 음만 보면 걸친 쌍(C3–G4)이 높은음자리표로 가서 아래 음이 덧줄 셋 아래로 내려간다
check("걸친 쌍은 가운데로 정한다", clefFor([new Pitch("C",0,3), new Pitch("G",0,4)])[0] === "F");

// **기본값에서는 낮은음자리표가 안 나온다** — 음역 하한이 C4라 어떤 쌍도
// 가운데가 C4 아래로 내려가지 않는다. 이게 옵션을 껐을 때의 회귀 시험이다.
const OPTS = optionsOf(INTERVALS);
const trebleOnly = new IntervalGenerator(withOptions(INTERVALS, OPTS).difficulty, new Rng(3));
let clefs = new Set<string>();
for (let i = 0; i < 200; i += 1) {
  const q = trebleOnly.generate();
  clefs.add(clefFor([q.lower, q.upper])[0]);
}
check("옵션을 끄면 높은음자리표뿐", [...clefs].join("") === "G", [...clefs].join(""));

const BASS_CONFIG = withOptions(INTERVALS, { ...OPTS, bassClef: true });
check("낮은음자리표 옵션이 음역 하한을 내린다",
  BASS_CONFIG.difficulty.noteLow < INTERVALS.difficulty.noteLow,
  BASS_CONFIG.difficulty.noteLow);
const mixed = new IntervalGenerator(BASS_CONFIG.difficulty, new Rng(3));
clefs = new Set<string>();
for (let i = 0; i < 200; i += 1) {
  const q = mixed.generate();
  clefs.add(clefFor([q.lower, q.upper])[0]);
}
check("켜면 두 자리표가 섞인다", clefs.has("G") && clefs.has("F"), [...clefs].join(""));
check("낮은음자리표 옵션을 되읽는다", optionsOf(BASS_CONFIG).bassClef === true);

// --- 음정 해석 — 방향이 반대다 -------------------------------------------------

const BUILD_CONFIG = withOptions(INTERVALS, { ...OPTS, build: true });
check("음정 해석 옵션이 스테이지를 고른다", BUILD_CONFIG.stage === Stage.IntervalBuild);
check("음정 해석 옵션을 되읽는다", optionsOf(BUILD_CONFIG).build === true);
check("단계보다 음정 해석이 이긴다",
  withOptions(INTERVALS, { ...OPTS, build: true, level: 0 }).stage === Stage.IntervalBuild);
check("음정 해석 생성기가 팩토리로 나온다",
  makeGenerator(BUILD_CONFIG, new Rng(1)) instanceof IntervalBuildGenerator);

const builder = new IntervalBuildGenerator(BUILD_CONFIG.difficulty, new Rng(11));
const ways = new Set<boolean>();
let buildBad = "";
const buildGrader = makeGrader(BUILD_CONFIG.difficulty.grading);
for (let i = 0; i < 300; i += 1) {
  const q: IntervalBuildQuestion = builder.generate();
  ways.add(q.up);
  const [lower, upper] = q.up ? [q.given, q.target] : [q.target, q.given];
  // 문제가 말한 음정이 실제로 두 음 사이의 음정인가
  if (intervalBetween(lower, upper).name !== q.interval.name) buildBad = `이름 ${q.answerText}`;
  if (upper.midi <= lower.midi) buildBad = `방향 ${q.answerText}`;
  // 답은 반드시 화면의 가상 건반 안에 있어야 한다 (rangeKeys가 그 음역을 그린다)
  const { noteLow, noteHigh } = BUILD_CONFIG.difficulty;
  if (q.target.midi < noteLow || q.target.midi > noteHigh) buildBad = `음역 밖 ${q.answerText}`;
  if (q.answerNotes.length !== 1 || q.answerNotes[0] !== q.target.midi) buildBad = `답 ${q.answerText}`;
  // **들려주는 것은 주어진 음이다.** 답을 울리면 문제가 되지 않는다
  if (q.cueNotes?.length !== 1 || q.cueNotes[0] !== q.given.midi) buildBad = `소리 ${q.answerText}`;
  if (!buildGrader.grade(q, [q.target.midi]).correct) buildBad = `채점 ${q.answerText}`;
  // 옥타브가 틀리면 오답이어야 한다 — 그러지 않으면 "위로·아래로"를 묻는 뜻이 없다
  if (buildGrader.grade(q, [q.target.midi + 12]).correct) buildBad = `옥타브 ${q.answerText}`;
}
check("음정 해석 300문제가 theory와 일치", buildBad === "", buildBad);
check("위로·아래로가 섞여 나온다", ways.size === 2);

// 음정 해석 문제도 `interval`을 들고 있다. 그것만 보면 두 음짜리 화면·채점기가
// 한 음짜리 문제를 통과시킨다 — 그래서 판별이 `lower`까지 본다.
const oneNote = builder.generate();
check("음정 해석 문제는 두 음짜리 판별에 안 걸린다", !isIntervalQuestion(oneNote));
check("두 음짜리 문제는 해석 판별에 안 걸린다",
  !isIntervalBuildQuestion(new IntervalGenerator(DIATONIC_INTERVALS.difficulty, new Rng(1)).generate()));

// 임시표·겹음정·낮은음자리표가 음정 해석에도 그대로 걸린다 (프리셋만 갈아끼운다)
const HARD = withOptions(INTERVALS, {
  ...OPTS, build: true, maxAlter: 1, compound: true, bassClef: true,
});
const hard = new IntervalBuildGenerator(HARD.difficulty, new Rng(5));
let sawAlter = false;
let sawCompound = false;
for (let i = 0; i < 300; i += 1) {
  const q = hard.generate();
  if (q.given.alter !== 0 || q.target.alter !== 0) sawAlter = true;
  if (q.interval.number > 8) sawCompound = true;
}
check("음정 해석에도 임시표·겹음정 옵션이 걸린다", sawAlter && sawCompound);

console.log("\n=== 12. 음계 ===");

// 48개(12 으뜸음 × 4종)를 전부 펼쳐 본다. 어느 하나라도 임시표가 ±2를 넘으면
// `Pitch`가 던지므로 "12조 전부"라는 약속이 그 자리에서 깨진다.
let scaleBad = "";
let lowest = 999;
let highest = -999;
for (const kind of SCALE_KINDS) {
  for (const tonic of tonics(kind)) {
    const ps = scalePitches(tonic, kind);
    const name = scaleName(tonic, kind);
    if (ps.length !== 8) scaleBad = `${name}: ${ps.length}음`;
    // 도수마다 글자가 하나씩 올라야 한다 — 그래야 음계의 표기가 된다
    ps.forEach((p, i) => {
      if (p.step !== tonic.step + i) scaleBad = `${name}: ${p.name}의 계단`;
      if (Math.abs(p.alter) > 2) scaleBad = `${name}: ${p.name}의 임시표`;
    });
    if (ps[7].midi !== ps[0].midi + 12) scaleBad = `${name}: 꼭대기가 옥타브가 아니다`;
    for (let i = 1; i < ps.length; i += 1) {
      if (ps[i].midi <= ps[i - 1].midi) scaleBad = `${name}: ${i}번째가 안 오른다`;
    }
    lowest = Math.min(lowest, ps[0].midi);
    highest = Math.max(highest, ps[7].midi);
  }
}
check("48개 음계가 전부 성립한다", scaleBad === "", scaleBad);
// 음역 축(noteLow 60 · noteHigh 83)이 이 값에서 나왔다. 넓어지면 가상 건반 밖의
// 음이 생겨 **마우스로 답할 방법이 없어진다.**
check("음역이 C4~B5에 들어간다", lowest === 60 && highest === 83, `${lowest}~${highest}`);

// 사용자가 든 예시 두 개를 글자 그대로
const dMajor = scalePitches(new Pitch("D", 0, 4), ScaleKind.Major);
check("D Major = D4 E4 F♯4 G4 A4 B4 C♯5 D5",
  dMajor.map((p) => p.name).join(" ") === "D4 E4 F♯4 G4 A4 B4 C♯5 D5",
  dMajor.map((p) => p.name).join(" "));
const aNatural = scalePitches(new Pitch("A", 0, 4), ScaleKind.Natural);
check("A Natural minor = A4 B4 C5 D5 E5 F5 G5 A5",
  aNatural.map((p) => p.name).join(" ") === "A4 B4 C5 D5 E5 F5 G5 A5",
  aNatural.map((p) => p.name).join(" "));

// **Harmonic은 7음만, Melodic은 6·7음만 Natural과 다르다.** 이 관계가 깨지면
// 사용자에게 가르치는 정의 자체가 거짓이 된다.
function differs(a: Pitch[], b: Pitch[]): number[] {
  const out: number[] = [];
  a.forEach((p, i) => {
    if (p.midi !== b[i].midi) out.push(i + 1);
  });
  return out;
}
let relBad = "";
for (const tonic of tonics(ScaleKind.Natural)) {
  const nat = scalePitches(tonic, ScaleKind.Natural);
  const har = differs(scalePitches(tonic, ScaleKind.Harmonic), nat);
  const mel = differs(scalePitches(tonic, ScaleKind.Melodic), nat);
  if (har.join() !== "7") relBad = `${tonic.name} Harmonic: ${har}`;
  if (mel.join() !== "6,7") relBad = `${tonic.name} Melodic: ${mel}`;
}
check("Harmonic은 7음, Melodic은 6·7음만 올린다", relBad === "", relBad);
check("올린 도수를 표에서 끌어낸다",
  raisedDegrees(ScaleKind.Harmonic).join() === "7" &&
  raisedDegrees(ScaleKind.Melodic).join() === "6,7" &&
  raisedDegrees(ScaleKind.Major).length === 0);

// 으뜸음 표가 `analysis/key.ts`와 두 벌이 됐다. 층 규칙이 합치는 것을 막으므로
// **24개를 대조한다** — 조표 표가 두 벌인 것과 같은 자리다.
let tonicBad = "";
for (const [kind, mode] of [
  [ScaleKind.Major, "major"],
  [ScaleKind.Natural, "minor"],
] as const) {
  tonics(kind).forEach((t) => {
    const mine = `${t.letter}${ACCIDENTAL_TEXT[t.alter]}`;
    const theirs = keyName(t.midi % 12, mode).replace(/ (장|단)조$/u, "");
    if (mine !== theirs) tonicBad = `${mode} ${t.midi % 12}: ${mine} ≠ ${theirs}`;
  });
}
check("으뜸음 24개가 analysis/key.ts와 일치", tonicBad === "", tonicBad);

console.log("\n=== 13. 순차 입력 (음계) ===");

const scaleCfg = { ...SCALE, questionCount: 3 };
const scaleSession = () => {
  const scaleGen = makeGenerator(scaleCfg, new Rng(7));
  return new Session(scaleCfg, scaleGen, makeGrader(scaleCfg.difficulty.grading));
};

// 맞는 음만 받는다 — 틀린 음은 진행을 안 올리고 실수만 센다
let ss = scaleSession();
ss.start();
const sq = ss.nextQuestion()!;
ss.beginListening();
const want = sq.answerNotes;
check("음계 생성기가 8음을 낸다", want.length === 8, want.length);
check("들려주는 것은 으뜸음 하나뿐", sq.cueNotes?.length === 1 && sq.cueNotes[0] === want[0]);
ss.collect(want[0] === 60 ? 61 : 60);      // 틀린 음
check("틀린 음은 진행을 안 올린다", ss.progress.length === 0, ss.progress.length);
check("틀린 음은 실수로 센다", ss.mistakes === 1, ss.mistakes);
// 1~7번째는 false, 여덟 번째에만 true — 이것이 "길이로 끝난다"의 전부다
const steps = want.map((n) => ss.collect(n));
check("여덟 번째에만 확정된다",
  steps.slice(0, 7).every((c) => !c) && steps[7], steps.join(","));
check("진행이 여덟 음", ss.progress.length === 8, ss.progress.length);
const wrongRun = ss.submit(3)!;
check("실수가 있으면 오답", wrongRun.correct === false);
check("오답 진단이 횟수를 말한다", wrongRun.detail.includes("1번 틀렸습니다"), wrongRun.detail);
// **채점 뒤에도 진행이 남는다** — 완성된 음계를 피드백 동안 눈에 남기는 것이
// 이 연습의 목적이다(실측으로 걸렸던 자리).
check("채점 뒤에도 악보가 안 비워진다", ss.progress.length === 8, ss.progress.length);

// 무실수 완주는 정답
ss = scaleSession();
ss.start();
const clean = ss.nextQuestion()!;
ss.beginListening();
for (const n of clean.answerNotes) ss.collect(n);
check("무실수 완주는 정답", ss.submit(3)!.correct === true);

// **ESC가 치트가 되면 안 된다** — 일시정지는 실수 횟수를 지우지 않는다
ss = scaleSession();
ss.start();
const paused = ss.nextQuestion()!;
ss.beginListening();
ss.collect(paused.answerNotes[0] === 60 ? 61 : 60);
ss.collect(paused.answerNotes[0]);
ss.pause();
ss.resume();
ss.beginListening();
check("일시정지가 실수를 지우지 않는다", ss.mistakes === 1, ss.mistakes);
check("일시정지가 진행도 지우지 않는다", ss.progress.length === 1, ss.progress.length);

// 락아웃 게이트는 순차 입력도 똑같이 지난다
ss = scaleSession();
ss.start();
const locked = ss.nextQuestion()!;   // Lockout 상태 그대로
check("락아웃 중에는 받지도 세지도 않는다",
  ss.collect(locked.answerNotes[0]) === false && ss.progress.length === 0 && ss.mistakes === 0);

// 문제가 바뀌면 전부 비워진다
ss.beginListening();
for (const n of locked.answerNotes) ss.collect(n);
ss.submit(2);
ss.nextQuestion();
check("다음 문제에서 진행·실수가 0", ss.progress.length === 0 && ss.mistakes === 0);

// 채점기 — 순서를 본다. `AbsolutePitchGrader`로는 못 하는 일이다
const scaleGrader = makeGrader(GradingMode.Scale);
const reversed = clean.answerNotes.map((_, i, a) => a[a.length - 1 - i]);
check("순서가 다르면 오답",
  scaleGrader.grade(clean, { form: "sequence", notes: reversed, mistakes: 0 }).correct === false);
check("그 뒤집힌 답을 AbsolutePitchGrader는 통과시킨다",
  makeGrader(GradingMode.AbsolutePitch).grade(clean, reversed).correct === true);
check("시간 초과(응답 없음)는 정답을 보여준다",
  scaleGrader.grade(clean, null).correct === false);

// 옵션 — 마지막 눈금이 "전부 섞어서"다
const one = withOptions(SCALE, { ...optionsOf(SCALE), scaleKind: 2 });
check("눈금이 종류를 고른다",
  one.difficulty.scalePool.length === 1 && one.difficulty.scalePool[0] === ScaleKind.Harmonic,
  one.difficulty.scalePool);
const mixedScale = withOptions(SCALE, { ...optionsOf(SCALE), scaleKind: SCALE_MIX });
check("마지막 눈금은 넷을 섞는다", mixedScale.difficulty.scalePool.length === 4);
check("섞기를 되읽는다", optionsOf(mixedScale).scaleKind === SCALE_MIX, optionsOf(mixedScale).scaleKind);
check("고른 종류를 되읽는다", optionsOf(one).scaleKind === 2, optionsOf(one).scaleKind);

// 악보 — **마디가 넘치면 verovio가 오류 없이 밀어 버린다.** 그 자리를 막는 시험이다
const xml = melodicMusicXml(dMajor);
const durations = [...xml.matchAll(/<duration>(\d+)<\/duration>/gu)]
  .reduce((sum, m) => sum + Number(m[1]), 0);
const beats = Number(/<beats>(\d+)<\/beats>/u.exec(xml)![1]);
check("마디의 음가 합이 박자와 맞는다", durations === beats, `${durations} ≠ ${beats}`);
check("음계는 화음이 아니다", !xml.includes("<chord/>"));
check("조표가 아니라 임시표다",
  xml.includes("<fifths>0</fifths>") &&
  [...xml.matchAll(/<accidental>/gu)].length === 2, xml.match(/<fifths>\d+<\/fifths>/)?.[0]);
check("아무것도 안 쳤으면 높은음자리표 빈 오선",
  melodicMusicXml([], dMajor).includes("<sign>G</sign>") &&
  !melodicMusicXml([], dMajor).includes("<note>"));

console.log("\n=== 14. 조표 ===");

// **손으로 적은 15조 표를 교재의 두 규칙으로 대조한다.** 교차표를 92쌍으로 지키는
// 것과 같은 자리다 — 표를 고치면 여기가 먼저 깨진다.
let ruleBad = "";
for (const entry of KEYS) {
  const mine = tonicPc(entry.major);
  const theirs = majorTonicPcByRule(entry.fifths);
  if (mine !== theirs) {
    ruleBad = `${signatureLabel(entry.fifths)} ${entry.major}: ${mine} ≠ ${theirs}`;
  }
}
check("15조가 두 규칙과 전부 일치", ruleBad === "" && KEYS.length === 15, ruleBad || KEYS.length);
// ♭1만 "끝에서 두 번째"가 없어 예외다
check("♭1은 예외로 F", majorTonicPcByRule(-1) === tonicPc("F"));
check("♯쪽은 마지막 ♯의 반음 위", majorTonicPcByRule(2) === tonicPc("D") && majorTonicPcByRule(7) === tonicPc("C♯"));
check("♭쪽은 끝에서 두 번째 ♭", majorTonicPcByRule(-4) === tonicPc("A♭") && majorTonicPcByRule(-7) === tonicPc("C♭"));

// 나란한조는 **전부** 단3도 아래다
let relativeBad = "";
for (const entry of KEYS) {
  const gap = ((tonicPc(entry.major) - tonicPc(entry.minor)) % 12 + 12) % 12;
  if (gap !== 3) relativeBad = `${entry.major}/${entry.minor}: ${gap}반음`;
}
check("나란한조가 전부 단3도 아래", relativeBad === "", relativeBad);
// 사용자가 든 예시를 글자 그대로
check("D Major ↔ b minor", keyAt(2).major === "D" && keyAt(2).minor === "b");
check("조 이름 문구", keyLabel(2, "major") === "D Major" && keyLabel(2, "minor") === "b minor",
  keyLabel(2, "minor"));

// 붙는 음이름 — 파도솔레라미시와 그 역순
check("♯2는 F C", accidentalLetters(2) === "FC", accidentalLetters(2));
check("♭3은 B E A", accidentalLetters(-3) === "BEA", accidentalLetters(-3));
check("조표 없으면 빈 문자열", accidentalLetters(0) === "");
let letterBad = "";
for (const entry of KEYS) {
  const got = accidentalLetters(entry.fifths);
  if (got.length !== Math.abs(entry.fifths)) letterBad = `${entry.fifths}: ${got}`;
}
check("붙는 개수가 조표 수와 같다", letterBad === "", letterBad);
check("♯7과 ♭7이 서로 역순",
  [...accidentalLetters(7)].every((c, i) => c === accidentalLetters(-7)[6 - i]),
  `${accidentalLetters(7)} / ${accidentalLetters(-7)}`);

// --- 이명동음조 — 외울 것은 "합이 12" 하나다 ---
let enhBad = "";
for (const [sharp, flat] of ENHARMONIC) {
  if (sharp + -flat !== 12) enhBad = `${sharp}+${-flat}`;
  if (tonicPc(keyAt(sharp).major) !== tonicPc(keyAt(flat).major)) {
    enhBad = `${keyAt(sharp).major} ≠ ${keyAt(flat).major}`;
  }
  if (tonicPc(keyAt(sharp).minor) !== tonicPc(keyAt(flat).minor)) {
    enhBad = `${keyAt(sharp).minor} ≠ ${keyAt(flat).minor}`;
  }
}
check("세 쌍의 ♯+♭이 전부 12이고 음고류가 같다", enhBad === "" && ENHARMONIC.length === 3,
  enhBad || ENHARMONIC.length);
check("♯5↔♭7 · ♯6↔♭6 · ♯7↔♭5", enharmonicOf(5) === -7 && enharmonicOf(-6) === 6 && enharmonicOf(7) === -5);
check("나머지 조표에는 이명동음조가 없다", enharmonicOf(0) === null && enharmonicOf(4) === null && enharmonicOf(-4) === null);

// 이름 쪽 규칙도 하나다 — **글자가 한 칸 올라가고 ♭이 붙는다**(감2도)
const LETTER_CYCLE = "CDEFGAB";
let spellBad = "";
for (const [sharp, flat] of ENHARMONIC) {
  for (const mode of ["major", "minor"] as const) {
    const from = tonicName(sharp, mode);
    const to = tonicName(flat, mode);
    const next = LETTER_CYCLE[(LETTER_CYCLE.indexOf(from[0].toUpperCase()) + 1) % 7];
    if (to[0].toUpperCase() !== next || !to.includes("♭")) spellBad = `${from} → ${to}`;
  }
}
check("이명동음 이름은 글자 한 칸 위 + ♭", spellBad === "", spellBad);

// **그 셋이 5도권에서 원이 닫히는 자리다** — 이 설계의 핵심 주장을 못박는다
const ambiguous = CIRCLE.map((list, i) => [i, list.length] as const)
  .filter(([, n]) => n > 1)
  .map(([i]) => i);
check("모호한 자리가 정확히 셋", ambiguous.length === 3 && ambiguous.join() === "5,6,7", ambiguous.join());
let samePlace = "";
for (const [sharp, flat] of ENHARMONIC) {
  if (positionOf(sharp) !== positionOf(flat)) samePlace = `${sharp}/${flat}`;
  if (!ambiguous.includes(positionOf(sharp))) samePlace = `${sharp} 자리가 모호하지 않다`;
}
check("이명동음 세 쌍 = 원이 닫히는 세 자리", samePlace === "", samePlace);

// --- 답 파서 ---
check("조 이름 — D·d·D Major·D장조·D key가 전부 같다",
  ["D", "d", "D Major", "D장조", "D key", " d  "].every((t) => normalizeKeyName(t) === "D"),
  ["D", "d", "D Major", "D장조", "D key"].map((t) => normalizeKeyName(t)).join("|"));
check("E는 D가 아니다", normalizeKeyName("E") === "E" && normalizeKeyName("E") !== normalizeKeyName("D"));
check("♯·♭을 자판 글자로도 받는다",
  normalizeKeyName("f#") === "F♯" && normalizeKeyName("F♯") === "F♯" &&
  normalizeKeyName("Bb") === "B♭" && normalizeKeyName("B♭") === "B♭",
  `${normalizeKeyName("f#")} ${normalizeKeyName("Bb")}`);
check("음이름이 아니면 빈 문자열", normalizeKeyName("H") === "" && normalizeKeyName("") === "");
check("붙는 음이름 — FC·F C·f,c가 전부 같다",
  ["FC", "F C", "f,c", "f c "].every((t) => normalizeLetters(t) === "FC"));
// **순서를 본다** — 파도솔레라미시를 훈련하는 칸이라 뒤집으면 오답이다
check("C F는 F C가 아니다", normalizeLetters("C F") !== normalizeLetters("F C"));
check("조표 개수 — ♯2·#2·2#", parseSignature("♯2") === 2 && parseSignature("#2") === 2 && parseSignature("2#") === 2);
check("조표 개수 — b3·♭3", parseSignature("b3") === -3 && parseSignature("♭3") === -3);
check("0과 없음은 조표 없음", parseSignature("0") === 0 && parseSignature("없음") === 0);
check("빈칸·헛값은 null", parseSignature("") === null && parseSignature("둘") === null && parseSignature("♯8") === null);

// --- 기존 표와의 대조 ---
//
// **이명동음 세 쌍은 뺀다.** `analysis/key.ts`는 음고류로 색인한 12칸이라 C♭/B를
// 함께 담을 수 없다 — "불일치"가 아니라 "표현 불가"다(그쪽이 담은 쪽만 맞춰 본다).
let crossBad = "";
let crossChecked = 0;
for (const entry of KEYS) {
  if (enharmonicOf(entry.fifths) !== null) continue;
  for (const mode of ["major", "minor"] as const) {
    const name = tonicName(entry.fifths, mode);
    const pc = tonicPc(name);
    const titled = name[0].toUpperCase() + name.slice(1);
    const theirs = `${titled} ${mode === "major" ? "장조" : "단조"}`;
    if (keyName(pc, mode) !== theirs) crossBad = `이름 ${theirs} ≠ ${keyName(pc, mode)}`;
    if (keyFifths(pc, mode) !== entry.fifths) {
      crossBad = `조표 ${theirs}: ${entry.fifths} ≠ ${keyFifths(pc, mode)}`;
    }
    crossChecked += 1;
  }
}
check("이명동음을 뺀 18조가 analysis/key.ts와 일치",
  crossBad === "" && crossChecked === 18, crossBad || crossChecked);

// --- 악보 — 음표 없이 조표만 ---
//
// **이 저장소에서 `fifths`가 0이 아닌 첫 호출이다.** ♯·♭이 붙는 자리와 순서는
// verovio가 그리므로 우리가 지킬 것은 숫자 하나지만, 그려지는지는 눈으로 봤다.
const sigXml = keySignatureMusicXml(2);
check("조표가 fifths로 나간다", sigXml.includes("<fifths>2</fifths>"),
  /<fifths>-?\d+<\/fifths>/u.exec(sigXml)?.[0]);
check("♭쪽은 음수로 나간다", keySignatureMusicXml(-3).includes("<fifths>-3</fifths>"));
check("♯7·♭7도 그대로 나간다",
  keySignatureMusicXml(7).includes("<fifths>7</fifths>") &&
  keySignatureMusicXml(-7).includes("<fifths>-7</fifths>"));
check("조표만 있는 마디에 음표가 없다", !sigXml.includes("<note>"));
check("마디가 하나다", [...sigXml.matchAll(/<measure /gu)].length === 1);
check("조표 오선도 높은음자리표", sigXml.includes("<sign>G</sign>"));

// --- 생성기 다섯 유형 ---
const keyCfg = (kind: KeyKind) =>
  withOptions(KEY_SIGNATURE, {
    ...optionsOf(KEY_SIGNATURE),
    keyKind: KEY_KINDS.indexOf(kind),
  });
check("눈금이 유형을 고른다",
  keyCfg(KeyKind.Signature).difficulty.keyKind === KeyKind.Signature,
  keyCfg(KeyKind.Signature).difficulty.keyKind);

const keyGrader = makeGrader(GradingMode.KeyField);
const fieldsOf = (q: Question) => (isKeyQuestion(q) ? q.fields : []);
/** 칸마다 정답 첫 표기를 넣어 본다 */
const answerAll = (q: Question, pick = 0) =>
  keyGrader.grade(q, {
    form: "fields" as const,
    values: fieldsOf(q).map((f) => f.accept[Math.min(pick, f.accept.length - 1)]),
  });

let kindBad = "";
let kindChecked = 0;
for (const kind of KEY_KINDS) {
  const cfg = keyCfg(kind);
  const kindGen = makeGenerator(cfg, new Rng(11));
  for (let i = 0; i < 40; i += 1) {
    const q = kindGen.generate();
    if (!isKeyQuestion(q)) { kindBad = `${kind}: KeyQuestion이 아니다`; break; }
    if (q.fields.length === 0) { kindBad = `${kind}: 칸이 없다`; break; }
    if (q.fields.some((f) => f.accept.length === 0)) { kindBad = `${kind}: 정답이 없는 칸`; break; }
    // 조표 그림을 주는 셋은 fifths가 있어야 하고, 조→조표는 글자로만 준다
    const wantsStaff = kind !== KeyKind.Signature;
    if ((q.fifths === null) === wantsStaff) { kindBad = `${kind}: fifths ${q.fifths}`; break; }
    if (!answerAll(q).correct) { kindBad = `${kind}: 정답이 정답이 아니다 — ${q.answerText}`; break; }
    kindChecked += 1;
  }
}
check("다섯 유형 200문항이 전부 제 정답으로 통과",
  kindBad === "" && kindChecked === 200, kindBad || kindChecked);

// 칸 구성이 유형마다 다르다 — 거기까지가 유형의 전부다
const firstOf = (kind: KeyKind) => makeGenerator(keyCfg(kind), new Rng(3)).generate();
check("장조 으뜸음은 한 칸", fieldsOf(firstOf(KeyKind.Major)).length === 1);
check("둘 다는 두 칸", fieldsOf(firstOf(KeyKind.Both)).length === 2);
check("조→조표는 붙는 음이름 칸으로 시작",
  fieldsOf(firstOf(KeyKind.Signature))[0].kind === "letters",
  fieldsOf(firstOf(KeyKind.Signature))[0].kind);
check("이명동음조는 조표 개수 칸으로 시작",
  fieldsOf(firstOf(KeyKind.Enharmonic))[0].kind === "signature",
  fieldsOf(firstOf(KeyKind.Enharmonic))[0].kind);

// **♯5는 B장조뿐이다.** 그림에 ♯이 다섯인데 C♭을 받아 주면 "조표를 읽었다"가
// 아니라 "음고류를 맞혔다"가 되어 이 활동이 가르치려는 것이 사라진다.
let leakBad = "";
for (const entry of KEYS) {
  const other = enharmonicOf(entry.fifths);
  if (other === null) continue;
  const leakGen = makeGenerator(keyCfg(KeyKind.Major), new Rng(5));
  for (let i = 0; i < 60; i += 1) {
    const q = leakGen.generate();
    if (!isKeyQuestion(q) || q.fifths !== entry.fifths) continue;
    const judged = keyGrader.grade(q, { form: "fields", values: [keyAt(other).major] });
    if (judged.correct) leakBad = `${signatureLabel(entry.fifths)}에서 ${keyAt(other).major}를 받았다`;
    break;
  }
}
check("으뜸음 칸은 이명동음을 안 받는다", leakBad === "", leakBad);

// **틀린 칸만 짚는다** — 두 칸짜리에서 "둘 다"와 "하나만"은 다음에 볼 것이 다르다
const both = firstOf(KeyKind.Both);
const bothFields = fieldsOf(both);
const oneWrong = keyGrader.grade(both, {
  form: "fields",
  values: [bothFields[0].accept[0], "H"],
});
check("한 칸만 틀리면 그 칸만 짚는다",
  !oneWrong.correct &&
  oneWrong.detail.includes(bothFields[1].label) &&
  !oneWrong.detail.includes("전부"),
  oneWrong.detail);
const allWrong = keyGrader.grade(both, { form: "fields", values: ["H", "H"] });
check("둘 다 틀리면 전부라고 말한다", !allWrong.correct && allWrong.detail.includes("전부"),
  allWrong.detail);
check("덜 채운 칸은 오답", !keyGrader.grade(both, { form: "fields", values: [bothFields[0].accept[0]] }).correct);
check("응답이 없으면 정답을 보여준다",
  !keyGrader.grade(both, null).correct && keyGrader.grade(both, null).detail.includes(both.answerText));
// 조→조표 칸은 순서를 본다
const sigQ = firstOf(KeyKind.Signature);
const sigFields = fieldsOf(sigQ);
const lettersAnswer = sigFields[0].accept[0];
if (lettersAnswer.length > 1) {
  check("붙는 순서를 뒤집으면 오답",
    !keyGrader.grade(sigQ, {
      form: "fields",
      values: [
        [...lettersAnswer].map((_, i, a) => a[a.length - 1 - i]).join(""),
        sigFields[1].accept[0],
      ],
    }).correct);
} else {
  check("붙는 순서를 뒤집으면 오답", true, "조표가 한 개 이하라 건너뜀");
}

console.log("\n=== 15. 5도권 ===");

check("원이 12자리", CIRCLE_SIZE === 12 && CIRCLE.length === 12);
check("자리 번호가 감긴다", wrapPosition(12) === 0 && wrapPosition(-1) === 11 && wrapPosition(13) === 1);
// 15조가 12자리에 전부 들어앉는다 — 셋이 겹치므로 15 = 12 + 3
check("15조가 자리를 전부 갖는다",
  KEYS.every((k) => CIRCLE.some((list) => list.includes(k.fifths))) &&
  CIRCLE.reduce((n, list) => n + list.length, 0) === 15);

// **사용자가 든 예시를 글자 그대로.** G에서 시계방향으로 한 바퀴.
const fromG = positionOf(1);
const clockwiseFromG = Array.from({ length: 12 }, (_, i) =>
  circleNames(fromG + i + 1).join("/"),
);
check("G 시계방향 한 바퀴가 예시와 같다",
  clockwiseFromG.join(" ") === "D A E B/C♭ F♯/G♭ C♯/D♭ A♭ E♭ B♭ F C G",
  clockwiseFromG.join(" "));
// 반시계는 같은 자리를 거꾸로 지난다
const counter = Array.from({ length: 12 }, (_, i) => circleNames(fromG - i - 1).join("/"));
check("반시계는 같은 자리를 거꾸로",
  counter.join(" ") === "C F B♭ E♭ A♭ C♯/D♭ F♯/G♭ B/C♭ E A D G",
  counter.join(" "));
check("한 바퀴면 제자리", circleNames(fromG + 12).join("/") === circleNames(fromG).join("/"));
// 자리↔조표 왕복
let placeBad = "";
for (const entry of KEYS) {
  if (!circleAt(positionOf(entry.fifths)).includes(entry.fifths)) {
    placeBad = String(entry.fifths);
  }
}
check("조표 → 자리 → 조표가 왕복한다", placeBad === "", placeBad);
// 시계방향 한 칸은 ♯ 하나다(원이 닫히는 자리만 건너뛴다)
check("시계방향 한 칸이 5도 위", circleAt(1)[0] === 1 && circleAt(2)[0] === 2 && circleAt(4)[0] === 4);

// --- 생성기 ---
const circleCfg = (span: number) =>
  withOptions(CIRCLE_OF_FIFTHS, {
    ...optionsOf(CIRCLE_OF_FIFTHS),
    circleSpan: CIRCLE_SPANS.indexOf(span),
  });
check("눈금이 빈칸 수를 고른다",
  CIRCLE_SPANS.map((n) => circleCfg(n).difficulty.circleSpan).join() === CIRCLE_SPANS.join(),
  CIRCLE_SPANS.map((n) => circleCfg(n).difficulty.circleSpan).join());

let circleBad = "";
let circleChecked = 0;
for (const span of CIRCLE_SPANS) {
  const circleGen = makeGenerator(circleCfg(span), new Rng(23));
  for (let i = 0; i < 40; i += 1) {
    const q = circleGen.generate();
    if (!isKeyQuestion(q) || !q.circle) { circleBad = "원 자료가 없다"; break; }
    if (q.fields.length !== span || q.circle.blanks.length !== span) {
      circleBad = `${span}칸인데 ${q.fields.length}/${q.circle.blanks.length}`;
      break;
    }
    // 빈칸은 주어진 자리에서 한 방향으로 연달아 간다
    const step = q.circle.clockwise ? 1 : -1;
    const expected = Array.from({ length: span }, (_, k) =>
      wrapPosition(q.circle!.from + step * (k + 1)));
    if (q.circle.blanks.join() !== expected.join()) {
      circleBad = `자리가 어긋난다: ${q.circle.blanks.join()} ≠ ${expected.join()}`;
      break;
    }
    // **두 표기 다 정답이다** — 원에서 묻는 것은 조표가 아니라 자리다
    if (!answerAll(q, 0).correct) { circleBad = `첫 표기가 오답: ${q.answerText}`; break; }
    if (!answerAll(q, 9).correct) { circleBad = `둘째 표기가 오답: ${q.answerText}`; break; }
    circleChecked += 1;
  }
}
check("5도권 120문항이 두 표기 모두로 통과",
  circleBad === "" && circleChecked === 120, circleBad || circleChecked);

// 모호한 자리를 실제로 지나는 문제에서 둘 다 받는지 못박는다
const ambGen = makeGenerator(circleCfg(6), new Rng(31));
let ambSeen = 0;
for (let i = 0; i < 60; i += 1) {
  const q = ambGen.generate();
  if (!isKeyQuestion(q) || !q.circle) continue;
  for (let k = 0; k < q.circle.blanks.length; k += 1) {
    const spot = q.circle.blanks[k];
    if (circleAt(spot).length < 2) continue;
    ambSeen += 1;
    for (const spelling of circleNames(spot)) {
      const values = q.fields.map((f, j) => (j === k ? spelling : f.accept[0]));
      if (!keyGrader.grade(q, { form: "fields", values }).correct) {
        circleBad = `${spot}번 자리에서 ${spelling}을 안 받았다`;
      }
    }
  }
}
check("원이 닫히는 자리는 뭘 써도 정답", circleBad === "" && ambSeen > 0, circleBad || ambSeen);
// 자리를 하나 밀면 오답이다 — "순서대로"가 이 문제의 전부다
const shiftQ = ambGen.generate();
const shiftFields = fieldsOf(shiftQ);
check("칸을 한 칸 밀면 오답",
  !keyGrader.grade(shiftQ, {
    form: "fields",
    values: shiftFields.map((_, i) => shiftFields[(i + 1) % shiftFields.length].accept[0]),
  }).correct);

// --- 단조 고리 — **자리가 하나도 안 움직인다** ---
//
// 사용자가 준 순서를 글자 그대로: a가 12시이고 거기가 C가 앉은 자리다.
const minorRing = CIRCLE.map((_, i) => circleNames(i, "minor").join("/"));
check("단조 한 바퀴가 주신 순서와 같다",
  minorRing.join(" ") === "a e b f♯ c♯ g♯/a♭ d♯/e♭ a♯/b♭ f c g d",
  minorRing.join(" "));
// 주신 표기(eb·bb)가 모호한 자리에서 받아들여지는가
check("주신 표기 열둘이 전부 제자리에서 받아들여진다",
  "a e b f♯ c♯ g♯ e♭ b♭ f c g d".split(" ")
    .every((name, i) => circleNames(i, "minor").includes(name)),
  minorRing.join(" "));

// **나란한조가 같은 칸에 앉는다** — 이것이 표를 새로 만들지 않은 근거다
let sameSlot = "";
for (let p = 0; p < CIRCLE_SIZE; p += 1) {
  for (const f of circleAt(p)) {
    if (keyAt(f).major !== tonicName(f, "major")) sameSlot = `이름 불일치 ${f}`;
    // 같은 칸의 장·단은 반드시 같은 조표다(= 나란한조다)
    if (((tonicPc(tonicName(f, "major")) - tonicPc(tonicName(f, "minor"))) % 12 + 12) % 12 !== 3) {
      sameSlot = `${p}번: ${tonicName(f, "major")}/${tonicName(f, "minor")}`;
    }
  }
}
check("열두 칸 모두 장·단이 나란한조", sameSlot === "", sameSlot);
// 모호한 세 자리는 단조에서도 같은 셋이다
check("모호한 자리가 조성과 무관하다",
  CIRCLE.map((_, i) => circleNames(i, "minor").length).join() ===
  CIRCLE.map((_, i) => circleNames(i, "major").length).join());
check("기본값은 장조", circleNames(0).join() === circleNames(0, "major").join());

// --- 조성 눈금 ---
const modeCfg = (step: number) =>
  withOptions(CIRCLE_OF_FIFTHS, { ...optionsOf(CIRCLE_OF_FIFTHS), circleMode: step });
check("눈금이 조성을 고른다",
  modeCfg(0).difficulty.circleModes.join() === "major" &&
  modeCfg(1).difficulty.circleModes.join() === "minor",
  modeCfg(1).difficulty.circleModes.join());
check("마지막 눈금은 둘을 섞는다", modeCfg(CIRCLE_MIX).difficulty.circleModes.length === 2);
check("조성을 되읽는다",
  optionsOf(modeCfg(1)).circleMode === 1 &&
  optionsOf(modeCfg(CIRCLE_MIX)).circleMode === CIRCLE_MIX,
  optionsOf(modeCfg(1)).circleMode);
check("기본 설정은 장조", optionsOf(CIRCLE_OF_FIFTHS).circleMode === 0);

// --- 생성기 ---
let modeBad = "";
const seen = new Set<string>();
for (const step of [0, 1, CIRCLE_MIX]) {
  const gen = makeGenerator(modeCfg(step), new Rng(41));
  const pool = modeCfg(step).difficulty.circleModes;
  for (let i = 0; i < 40; i += 1) {
    const q = gen.generate();
    if (!isKeyQuestion(q) || !q.circle) { modeBad = "원 자료가 없다"; break; }
    if (!pool.includes(q.circle.mode)) { modeBad = `풀 밖의 조성 ${q.circle.mode}`; break; }
    seen.add(`${step}:${q.circle.mode}`);
    // 칸의 정답이 그 조성의 이름이어야 한다
    const want = q.circle.blanks.map((p) => circleNames(p, q.circle!.mode).join("/"));
    if (q.fields.map((f) => f.accept.join("/")).join() !== want.join()) {
      modeBad = `정답이 조성을 안 따른다: ${q.answerText}`;
      break;
    }
    if (!answerAll(q).correct) { modeBad = `정답이 오답: ${q.answerText}`; break; }
  }
}
check("조성이 풀을 벗어나지 않고 정답이 그것을 따른다", modeBad === "", modeBad);
check("섞기 눈금에서 둘 다 나온다",
  seen.has(`${CIRCLE_MIX}:major`) && seen.has(`${CIRCLE_MIX}:minor`), [...seen].join(" "));

// **단조 문제에 장조 이름을 적으면 오답이다.** 자리가 같으므로 이것이 유일한 구분점이다
const minorGen = makeGenerator(modeCfg(1), new Rng(17));
let crossMode = "";
for (let i = 0; i < 20; i += 1) {
  const q = minorGen.generate();
  if (!isKeyQuestion(q) || !q.circle) continue;
  const asMajor = q.circle.blanks.map((p) => circleNames(p, "major")[0]);
  if (keyGrader.grade(q, { form: "fields", values: asMajor }).correct) {
    crossMode = `단조 문제에 장조 이름이 통과했다: ${q.answerText}`;
    break;
  }
}
check("단조 문제는 장조 이름을 안 받는다", crossMode === "", crossMode);
// 화면이 조성을 말해 줘야 한다 — 그림만으로는 알 수 없다
const minorQ = makeGenerator(modeCfg(1), new Rng(17)).generate();
check("문제가 조성을 글자로 말한다",
  minorQ.prompt.includes("단조") && isKeyQuestion(minorQ) && minorQ.given.includes("단조"),
  minorQ.prompt);

// --- 건반을 쓰지 않는 활동이다 ---
check("조표·5도권은 건반 입력이 아니다",
  !usesMidiInput(Stage.KeySignature) && !usesMidiInput(Stage.Circle));
check("두 스테이지 다 화면이 있다",
  stageFor(Stage.KeySignature) !== undefined && stageFor(Stage.Circle) !== undefined);
check("조표는 참고표를 갖는다", usesTable(Stage.KeySignature));
check("들려줄 것이 없다",
  firstOf(KeyKind.Major).answerNotes.length === 0 &&
  (firstOf(KeyKind.Major).cueNotes?.length ?? 0) === 0);

test("이식 검증 전체", () => {
  console.log(`\n${fails.length ? "실패: " + fails.join(", ") : "전부 통과"}`);
  expect(fails).toEqual([]);
});
