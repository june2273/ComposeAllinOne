/**
 * 코드 인식 — 비트 동기 크로마 → 이진 템플릿 → Viterbi.
 *
 * 강의 07(음악 정보학, GCT731)이 정리한 고전 파이프라인 그대로다.
 *
 * ```
 * 비트 동기 크로마 ──[템플릿 24개]── 비트별 국소 점수 ──[Viterbi]── 코드 구간
 *   (meter.beatChroma)                                              └─[7음 검사]─ 7화음
 * ```
 *
 * **학습된 모델이 아니다.** 그래서 사이드카 없이 브라우저 안에서 끝나고,
 * `core/analysis`의 다른 것들처럼 의존성이 없다.
 *
 * ## 지키는 것
 *
 * - **크로마를 먼저 비트로 접고 그 위에서 인식한다**(사양서 §1.1). 반대가
 *   아니다 — 프레임 단위로 인식한 뒤 비트에 스냅하면 비트 안이 균질하다는
 *   이점을 통째로 버리고 Viterbi 길이가 20~40배가 된다.
 * - **DP 꼴이 `tempo.trackBeats`·`notes.segmentNotes`와 같다**(사양서 §1.9).
 * - **입력은 원본 믹스다**(사양서 §1.2). 화성을 들고 있는 것은 `other` 스템
 *   (기타·키보드·패드)이지 보컬이 아니고, 분리 신호는 위상이 뒤틀려 있다.
 *
 * ## 어휘를 3화음 + 7화음으로 자른 이유
 *
 * `maj` `min` `maj7` `min7` `7`뿐이다.
 *
 * - **7화음을 빼면 안 된다**(사양서 §1.5). J-pop의 왕도진행 `IVM7–V7–iii7–vi`는
 *   정의상 7화음이고, 그걸 3화음으로 적는 것은 서구식 단순화다.
 * - **`dim`·`aug`는 넣지 않았다.** 증3화음과 감7화음은 **음 집합만으로 근음이
 *   결정되지 않는다**(사양서 §6 — C aug ≡ E aug ≡ G♯ aug). 근음을 정하려면
 *   베이스 스템의 f0가 필요한데, 그걸 끌어오는 순간 코드 인식이 사이드카에
 *   묶여 서버가 꺼진 환경에서 통째로 사라진다. 데이터를 더 넣어도 안 풀리는
 *   구조적 문제라 **어휘에서 빼는 것이 정직하다.**
 * - **`sus`도 뺐다.** 3화음과 음이 둘 겹쳐서 지금 크로마 품질로는 안정적으로
 *   갈리지 않는다 — 악보에 틀린 심볼을 늘리기만 한다.
 *
 * ## 아직 못 하는 것
 *
 * 전위(`/E`)·텐션(9th)·구간별 전조. 그리고 **정확도를 말할 수 없다** — 코드
 * 정답을 찍어 둔 곡이 아직 하나도 없다(평가셋 4곡 전부 멜로디 정답뿐이다).
 * 아래 상수들은 그래서 근거가 없다.
 */

import { correlation } from "./key";
import { beatChroma, perBeat } from "./meter";

/** 지금 어휘. 순서가 상태 번호를 정한다 */
export type ChordQuality = "maj" | "min" | "maj7" | "min7" | "dom7";

/** 3화음 템플릿 — 근음 기준 반음 오프셋. 7화음은 여기서 승격된다 */
const TRIADS: readonly { quality: "maj" | "min"; tones: readonly number[] }[] = [
  { quality: "maj", tones: [0, 4, 7] },
  { quality: "min", tones: [0, 3, 7] },
];

/**
 * 코드 심볼의 근음 표기. **`musicxml.ts`의 `SHARP_SPELLING`/`FLAT_SPELLING`과
 * 같은 값이어야 한다** — 화면의 코드 표와 악보의 코드 심볼이 갈리면 어느 쪽이
 * 맞는지 알 수 없게 된다. 고를 때 쓰는 규칙(조표가 ♯계인가)도 같다.
 *
 * `key.ts`의 표(조 이름)와도, `theory.NOTE_NAMES`(♯ 고정)와도 다르다. 셋은
 * 서로 다른 질문에 답한다 — 여기는 "코드 차트에 뭐라고 적는가"다.
 */
const SHARP_ROOTS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT_ROOTS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

/** 코드 심볼의 접미사. 근음 뒤에 그대로 붙는다 */
const SUFFIX: Record<ChordQuality, string> = {
  maj: "",
  min: "m",
  maj7: "M7",
  min7: "m7",
  dom7: "7",
};

/** MusicXML `<kind>` 값. `musicxml.ts`가 이 문자열을 그대로 쓴다 */
const KIND: Record<ChordQuality, string> = {
  maj: "major",
  min: "minor",
  maj7: "major-seventh",
  min7: "minor-seventh",
  dom7: "dominant",
};

// --- 상수 ----------------------------------------------------------------------
//
// **전부 평가셋 없이 정한 값이다.** 합성 신호로 "의도대로 도는가"만 확인했고,
// 실곡 정확도는 아무도 재지 않았다 — `meter.ts`의 임계값들과 같은 처지다.
// 코드 정답이 붙은 곡이 20~30개 모이면 여기서 다시 맞출 것.

/**
 * "코드 없음"(N)의 점수. 어떤 템플릿도 이 상관을 못 넘으면 코드를 세우지 않는다.
 *
 * 상관(피어슨)이라 **평균이 빠져 있다** — 12칸이 고른 벡터(무음·잡음·드럼만
 * 있는 간주)는 어느 템플릿과도 0 근처가 나온다. 그래서 이 값이 절대적인
 * 뜻을 갖는다: 0.3이면 "세 음이 나머지보다 뚜렷하게 세야 코드로 친다".
 */
const NO_CHORD_SCORE = 0.3;

/**
 * 코드를 바꾸는 데 드는 비용. 국소 비용(1 − 상관, 0~2)과 같은 저울이다.
 *
 * **학습된 전이 행렬을 쓰지 않는다.** 강의가 보여준 Beatles 전이 행렬은
 * 데이터가 있어야 나오고 우리에겐 없다. 대신 **어디서 바뀌는가**만 안다 —
 * 코드는 마디선에서 바뀐다. `quantize.metricalCost`가 음표에 대해 쓰는 것과
 * 같은 종류의 사전지식이고, 학습이 필요 없다.
 *
 * ## 균일한 벌점 하나로는 안 됐다 (실측)
 *
 * 처음에는 상수 하나(0.2)였는데 **왕도진행이 뭉갰다** — `FM7 · G7 · Em7 · Am`
 * 합성 트랙에서 `G7`과 `Em7`이 한 덩어리 `G`로 나왔다. 둘은 `G·B·D`를
 * 공유해서 국소 점수 차이가 벌점보다 작다. 벌점을 0.05까지 내리면 갈라지는데,
 * 그러면 **잡음에도 그만큼 헐거워진다** — 마디 한가운데서 코드가 팔랑거린다.
 *
 * 두 값으로 가르면 둘 다 얻는다. 마디선에서는 싸고(진짜 변화가 거기 있다)
 * 마디 안에서는 비싸다(팔랑거림이 거기서 난다).
 */
const CHANGE_COST_BAR = 0.05;
const CHANGE_COST_MID = 0.25;

/**
 * 베이스가 근음 판정에 보태는 무게. 국소 점수(상관, −1~1)에 더해진다.
 *
 * ## 왜 필요한가 — 음고류만으로는 못 가르는 짝이 있다
 *
 * `Dm7`(D F A C)과 `F6`(F A C D)은 **같은 음 집합**이다. `Am7` ≡ `C6`,
 * `Em7` ≡ `G6`도 마찬가지고, 이 짝들은 J-pop 화성에 흔하다. 3화음 템플릿으로
 * 보면 `Dm7`은 `F`(F A C, 4음 중 3개)와 `Dm`(D F A, 4음 중 3개)에 똑같이
 * 맞아서 **원리적으로 동점**이다 — 사양서 §6이 aug·dim7에 대해 말한 대칭과
 * 같은 종류의 문제이고, 데이터를 더 넣어도 안 풀린다.
 *
 * 가르는 것은 **맨 아래 음**이다. 실측(합성 `Dm7` 트랙): 베이스 항이 없으면
 * `F`, 있으면 `Dm7`이 나왔다.
 *
 * **베이스가 없으면 저절로 꺼진다** — 저역에 에너지가 없으면 항이 0이라 순수
 * 템플릿 매칭으로 돌아간다. 그래서 이 값을 올려도 베이스 있는 곡에서만 세진다.
 */
const BASS_WEIGHT = 0.25;

/**
 * 7음이 3화음 구성음 평균의 이 비율을 넘으면 7화음으로 올린다.
 *
 * **함께 요구하는 조건이 하나 더 있다** — 그 7음이 구간에서 **가장 센
 * 비화성음**이어야 한다. 비율 하나만 보면 로그 압축된 크로마에서 12칸이
 * 전부 가까워져 아무 구간이나 7화음이 된다.
 */
const SEVENTH_RATIO = 0.8;

/** 7음을 붙인 구간의 신뢰도에 곱한다. 3화음 판정보다 증거가 얇다 */
const SEVENTH_CONFIDENCE = 0.8;

/** 비트 에너지가 중앙값의 이 비율 아래면 무음으로 보고 N을 준다 */
const SILENCE_RATIO = 0.05;

/** 신뢰도 1에 해당하는 상관. 0.8이면 세 음이 뚜렷하다 */
const FULL_CONFIDENCE_R = 0.8;

// --- 타입 ----------------------------------------------------------------------

export interface ChordCandidate {
  /** "FM7" */
  readonly symbol: string;
  /** 후보들 사이의 몫 0~1 */
  readonly probability: number;
}

export interface ChordEvent {
  /** 시작 비트 번호 */
  readonly startBeat: number;
  /** 끝 비트 번호(배타) */
  readonly endBeat: number;
  readonly startSec: number;
  readonly endSec: number;
  /** 근음 음고류 0~11 */
  readonly root: number;
  readonly quality: ChordQuality;
  /** "F♯m7" — 화면과 악보가 함께 쓴다 */
  readonly symbol: string;
  /** MusicXML `<kind>` 값 */
  readonly kind: string;
  /** 심볼에서 근음을 뺀 부분. `<kind text="…">`에 들어간다 */
  readonly suffix: string;
  readonly confidence: number;
  /** 이 구간에서 다툰 코드들. 확률 내림차순 */
  readonly candidates: readonly ChordCandidate[];
}

export interface ChordEstimate {
  readonly chords: readonly ChordEvent[];
  /** 구간 길이로 가중한 평균 신뢰도 */
  readonly confidence: number;
}

export interface ChordOptions {
  /**
   * 조표(♯ 개수, 음수면 ♭계). **표기에만 쓴다 — 판정에는 한 줄도 안 들어간다.**
   *
   * 다이아토닉 코드에 사전확률을 주고 싶어지는 자리지만 넣지 않았다.
   * 사양서 §7이 "조성은 오디오가 아니라 **코드 시퀀스 위에서** 판정한다"고
   * 정해 뒀으므로, 조성을 코드에 먹이면 그 길이 순환으로 막힌다.
   */
  readonly fifths?: number;
  /**
   * 마디 길이와 위상 — `MeterEstimate.beatsPerBar` · `phase`.
   *
   * **판정에 실제로 들어간다**(위 `CHANGE_COST_BAR`). 없으면 마디를 모르는
   * 것이므로 전부 마디 안으로 보고 비싼 쪽 벌점을 문다 — 코드가 덜 바뀌지
   * 틀리지는 않는다.
   */
  readonly beatsPerBar?: number;
  readonly phase?: number;
  /**
   * 베이스 음역만 접은 크로마 — `ChordChroma.bass`.
   *
   * **없으면 순수 템플릿 매칭이다**(`BASS_WEIGHT` 주석). 저역에 소리가 없는
   * 신호에서도 항이 저절로 0이 되므로, 넣고 안 넣고가 안전하게 갈린다.
   */
  readonly bass?: Float32Array;
}

// --- 템플릿 --------------------------------------------------------------------

interface Template {
  readonly root: number;
  readonly quality: "maj" | "min";
  readonly vector: Float64Array;
}

/** 24개 이진 템플릿(장 12 · 단 12). 강의의 그 표를 그대로 세운 것이다 */
export function chordTemplates(): Template[] {
  const out: Template[] = [];
  for (const { quality, tones } of TRIADS) {
    for (let root = 0; root < 12; root += 1) {
      const vector = new Float64Array(12);
      for (const tone of tones) vector[(root + tone) % 12] = 1;
      out.push({ root, quality, vector });
    }
  }
  return out;
}

const TEMPLATES = chordTemplates();

/** 근음 음고류 → 코드 차트 표기. 조표 방향 하나로 ♯계·♭계를 고른다 */
export function rootName(root: number, fifths = 0): string {
  const pc = ((Math.round(root) % 12) + 12) % 12;
  return (fifths >= 0 ? SHARP_ROOTS : FLAT_ROOTS)[pc];
}

// --- 인식 ----------------------------------------------------------------------

/**
 * 비트별 크로마와 에너지에서 코드 구간을 뽑는다. **실패하지 않는다** —
 * 비트가 모자라거나 소리가 없으면 빈 배열이다.
 *
 * `chroma`·`energy`는 `features.extractChordChroma()`의 출력이고 `fps`도
 * 거기서 온다(첫 STFT 통과의 fps가 아니다 — 홉이 다르다).
 */
export function estimateChords(
  beats: readonly number[],
  fps: number,
  chroma: Float32Array,
  energy: Float32Array,
  options: ChordOptions = {},
): ChordEstimate {
  const fifths = options.fifths ?? 0;
  const vectors = beatChroma(beats, fps, chroma, energy, true);
  if (vectors.length < 2) return { chords: [], confidence: 0 };
  const basses = beatChroma(beats, fps, options.bass ?? new Float32Array(0), energy, true);

  const beatEnergy = perBeat(beats, fps, energy);
  const silent = silentBeats(beatEnergy);

  // (1) 국소 점수 — 비트마다 24개 템플릿과의 상관 + 베이스가 근음을 얼마나
  //     지지하는가. N은 상수다.
  const scores: Float64Array[] = vectors.map((v, i) => {
    const row = new Float64Array(TEMPLATES.length);
    if (silent[i]) return row.fill(-1); // 무음 비트는 어떤 코드도 이길 수 없다
    const bass = rootSupport(basses[i]);
    for (let s = 0; s < TEMPLATES.length; s += 1) {
      row[s] =
        correlation(v, TEMPLATES[s].vector) + BASS_WEIGHT * bass[TEMPLATES[s].root];
    }
    return row;
  });

  // (2) Viterbi. 마디선에서 바뀌는 것이 싸다
  const perBar = Math.max(1, Math.round(options.beatsPerBar ?? 0));
  const phase = Math.round(options.phase ?? 0);
  const onBar = (beat: number) =>
    options.beatsPerBar !== undefined && ((beat - phase) % perBar + perBar) % perBar === 0;
  const path = decode(scores, onBar);

  // (3) 같은 상태가 이어지는 구간으로 묶고 7음을 검사한다
  return assemble(path, scores, vectors, beats, fifths);
}

/**
 * 이 비트의 베이스가 각 음고류를 근음으로 얼마나 지지하는가(0~1).
 *
 * 가장 센 저역 음고류가 1, 아무것도 없으면 전부 0이다. **비율로 재므로 곡의
 * 음량과 무관하고, 저역에 아무 소리도 없으면 저절로 꺼진다.**
 */
function rootSupport(bass: Float64Array | undefined): Float64Array {
  const out = new Float64Array(12);
  if (!bass) return out;
  let total = 0;
  let peak = 0;
  for (let pc = 0; pc < 12; pc += 1) {
    total += bass[pc];
    if (bass[pc] > peak) peak = bass[pc];
  }
  if (!(total > 0) || !(peak > 0)) return out;
  // 균등 분포(1/12)를 0으로 두고 최대치를 1로 편다 — 저역이 고르게 깔린
  // (= 근음이라 할 것이 없는) 비트가 아무 코드도 밀지 않게
  const floor = total / 12;
  const range = peak - floor;
  if (!(range > 0)) return out;
  for (let pc = 0; pc < 12; pc += 1) {
    out[pc] = Math.max(0, (bass[pc] - floor) / range);
  }
  return out;
}

/**
 * 무음 비트 표시. **중앙값 대비로 잰다** — 절대값으로 자르면 조용히 녹음된
 * 곡이 통째로 무음이 된다.
 */
function silentBeats(beatEnergy: Float64Array): boolean[] {
  const positive = [...beatEnergy].filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return Array.from(beatEnergy, () => true);
  const median = positive[positive.length >> 1];
  const floor = median * SILENCE_RATIO;
  return Array.from(beatEnergy, (v) => v < floor);
}

/**
 * Viterbi. 상태는 템플릿 24개 + N 하나.
 *
 * **전이 비용이 상태에 안 걸려서 O(비트 × 상태)로 끝난다** — `min(D[i] + c(i,j))`가
 * `min(D[j], 전체최솟값 + 이번 걸음의 변경비용)` 둘 중 하나이기 때문이다.
 * 시각에 따라(마디선인가) 달라지는 것은 괜찮다. **깨지는 것은 어느 코드에서
 * 어느 코드로 가는지에 따라 값이 달라질 때다**(V→I는 싸게, 무관한 도약은
 * 비싸게) — 그 순간 제곱 루프로 돌아와야 한다. `notes.ts`의 DP가 지는 것과
 * 똑같은 제약이다.
 *
 * `NONE`(= 상태 수 − 1)이 N이다.
 */
function decode(
  scores: readonly Float64Array[],
  onBar: (beat: number) => boolean,
): Int32Array {
  const states = TEMPLATES.length + 1;
  const NONE = TEMPLATES.length;
  const n = scores.length;
  const back = new Int32Array(n * states);

  let cost = new Float64Array(states);
  for (let s = 0; s < states; s += 1) {
    cost[s] = 1 - (s === NONE ? NO_CHORD_SCORE : scores[0][s]);
  }

  let next = new Float64Array(states);
  for (let i = 1; i < n; i += 1) {
    let bestPrev = 0;
    for (let s = 1; s < states; s += 1) if (cost[s] < cost[bestPrev]) bestPrev = s;
    const change = onBar(i) ? CHANGE_COST_BAR : CHANGE_COST_MID;
    const switchCost = cost[bestPrev] + change;

    for (let s = 0; s < states; s += 1) {
      const local = 1 - (s === NONE ? NO_CHORD_SCORE : scores[i][s]);
      // 동점이면 머무는 쪽. 코드는 자주 바뀌지 않는다
      const stay = cost[s];
      if (stay <= switchCost) {
        next[s] = local + stay;
        back[i * states + s] = s;
      } else {
        next[s] = local + switchCost;
        back[i * states + s] = bestPrev;
      }
    }
    const swap = cost;
    cost = next;
    next = swap;
  }

  const path = new Int32Array(n);
  let last = 0;
  for (let s = 1; s < states; s += 1) if (cost[s] < cost[last]) last = s;
  path[n - 1] = last;
  for (let i = n - 1; i > 0; i -= 1) path[i - 1] = back[i * states + path[i]];
  return path;
}

/** 같은 상태가 이어지는 구간을 코드 하나로 만든다. N 구간은 버린다 */
function assemble(
  path: Int32Array,
  scores: readonly Float64Array[],
  vectors: readonly Float64Array[],
  beats: readonly number[],
  fifths: number,
): ChordEstimate {
  const NONE = TEMPLATES.length;
  const chords: ChordEvent[] = [];

  let from = 0;
  for (let i = 1; i <= path.length; i += 1) {
    if (i < path.length && path[i] === path[from]) continue;
    const state = path[from];
    if (state !== NONE) {
      chords.push(makeChord(state, from, i, scores, vectors, beats, fifths));
    }
    from = i;
  }

  const span = chords.reduce((sum, c) => sum + (c.endBeat - c.startBeat), 0);
  const weighted = chords.reduce(
    (sum, c) => sum + c.confidence * (c.endBeat - c.startBeat),
    0,
  );
  return { chords, confidence: span > 0 ? weighted / span : 0 };
}

function makeChord(
  state: number,
  from: number,
  to: number,
  scores: readonly Float64Array[],
  vectors: readonly Float64Array[],
  beats: readonly number[],
  fifths: number,
): ChordEvent {
  const template = TEMPLATES[state];
  const beatsInSpan = to - from;

  // 구간 평균 점수. 후보 표시와 신뢰도가 이걸 쓴다
  const mean = new Float64Array(TEMPLATES.length);
  for (let i = from; i < to; i += 1) {
    for (let s = 0; s < TEMPLATES.length; s += 1) mean[s] += scores[i][s] / beatsInSpan;
  }

  // 구간 평균 크로마 — 7음 검사용
  const chroma = new Float64Array(12);
  let total = 0;
  for (let i = from; i < to; i += 1) {
    for (let pc = 0; pc < 12; pc += 1) {
      chroma[pc] += vectors[i][pc];
      total += vectors[i][pc];
    }
  }
  if (total > 0) for (let pc = 0; pc < 12; pc += 1) chroma[pc] /= total;

  const quality = promote(template, chroma);
  const seventh = quality !== template.quality;

  // 신뢰도 — `meter.estimateMeter`와 같은 꼴(강도 × 마진)
  const top = mean[state];
  let rival = -1;
  for (let s = 0; s < TEMPLATES.length; s += 1) {
    if (s !== state && mean[s] > rival) rival = mean[s];
  }
  const strength = Math.min(1, Math.max(0, top) / FULL_CONFIDENCE_R);
  const margin = top > 0 ? Math.min(1, Math.max(0, 1 - Math.max(0, rival) / top)) : 0;
  const confidence =
    strength * (0.5 + 0.5 * margin) * (seventh ? SEVENTH_CONFIDENCE : 1);

  const suffix = SUFFIX[quality];
  return {
    startBeat: from,
    endBeat: to,
    startSec: beats[from],
    // 비트 벡터가 `beats.length - 1`개라 `to`는 항상 `beats` 안이다
    endSec: beats[Math.min(to, beats.length - 1)],
    root: template.root,
    quality,
    symbol: rootName(template.root, fifths) + suffix,
    kind: KIND[quality],
    suffix,
    confidence,
    candidates: topCandidates(mean, fifths),
  };
}

/**
 * 3화음에 7음을 붙일지 정한다. 붙일 이유가 없으면 원래 성질 그대로.
 *
 * 조건 둘을 **모두** 넘겨야 한다.
 *
 * 1. 그 7음이 구간에서 **가장 센 비화성음**이다.
 * 2. 무게가 3화음 구성음 평균의 `SEVENTH_RATIO` 이상이다.
 *
 * 단3화음 + 장7도(minmaj7)는 어휘 밖이라 단3화음 그대로 둔다 — 실제로 드물고,
 * 잘못 잡으면 악보에 읽는 사람이 의심할 심볼이 남는다.
 */
function promote(template: Template, chroma: Float64Array): ChordQuality {
  const tones = template.quality === "maj" ? [0, 4, 7] : [0, 3, 7];
  const inChord = new Set(tones.map((t) => (template.root + t) % 12));
  const triadMean =
    tones.reduce((sum, t) => sum + chroma[(template.root + t) % 12], 0) / tones.length;
  if (!(triadMean > 0)) return template.quality;

  const minor7 = (template.root + 10) % 12;
  const major7 = (template.root + 11) % 12;

  let strongest = -1;
  let strongestWeight = -1;
  for (let pc = 0; pc < 12; pc += 1) {
    if (inChord.has(pc)) continue;
    if (chroma[pc] > strongestWeight) {
      strongestWeight = chroma[pc];
      strongest = pc;
    }
  }
  if (strongestWeight < triadMean * SEVENTH_RATIO) return template.quality;

  if (strongest === minor7) {
    return template.quality === "maj" ? "dom7" : "min7";
  }
  if (strongest === major7 && template.quality === "maj") return "maj7";
  return template.quality;
}

/**
 * 이 구간에서 다툰 코드 셋. **음수 점수는 0으로 눌러 버린다** —
 * "세 음이 나머지보다 약하다"는 뜻이라 후보로서 무게가 없다
 * (`meter.barProbabilities`와 같은 규칙).
 */
function topCandidates(mean: Float64Array, fifths: number): ChordCandidate[] {
  const rows = TEMPLATES.map((t, s) => ({
    symbol: rootName(t.root, fifths) + SUFFIX[t.quality],
    score: Math.max(0, mean[s]),
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const total = rows.reduce((sum, r) => sum + r.score, 0);
  return rows.map((r) => ({
    symbol: r.symbol,
    probability: total > 0 ? r.score / total : 0,
  }));
}
