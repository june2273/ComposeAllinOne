/**
 * 박자표 — 표준 해법이 없어 직접 설계한 부분.
 *
 * 파이프라인 사양서 §5의 두 축 분해를 그대로 따른다.
 *
 * ```
 * 축 A: 박 세분화     2분할(simple) / 3분할(compound)
 * 축 B: 마디당 박 수   3 / 4
 * ```
 *
 * **두 축을 하나로 섞지 말 것.** 6/8을 "마디당 박 6"으로 취급하면 4/4가 6으로
 * 오검출되는 알려진 함정에 그대로 걸린다(madmom#402). 성격이 다른 물음이다 —
 * 축 B는 "몇 박마다 돌아오는가", 축 A는 "한 박이 몇으로 쪼개지는가".
 *
 * ## 축 B — 다운비트는 무엇으로 아는가
 *
 * 세 가지 단서를 더한다. 어느 하나도 혼자서는 약하다.
 *
 * | 단서 | 근거 |
 * |---|---|
 * | 온셋 강도 | 마디 첫 박이 대개 세다 |
 * | 저역 에너지 | 킥이 1박에 온다 |
 * | 크로마 변화 | **화성은 마디 경계에서 바뀐다** |
 *
 * 셋을 z점수로 맞춰 더한 뒤, 마디 길이 3·4와 각 위상에 대해 "다운비트 자리의
 * 값이 나머지보다 얼마나 높은가"를 잰다. 가장 높은 조합이 답이다.
 *
 * ## 축 A — 셔플을 3분할로 착각하지 않기
 *
 * 셔플 4/4는 3분할처럼 들린다. 구분 단서는 **3분할 가운데 자리의 에너지**다.
 * 진짜 복합박자는 세 자리가 고르지만, 셔플은 가운데가 비고 첫·셋째만 강하다.
 *
 * ## 신뢰도는 낮게 잡는다
 *
 * 이 단계는 사람 검수를 전제로 한다. 임계값 상수들은 평가셋 없이 정한 값이라
 * (사양서 §8이 요구하는 J-pop 20~30곡 평가셋이 아직 없다) **곡을 모아 다시
 * 맞춰야 하는 자리**다.
 */

/** 3박이 4박을 이기려면 이 배수만큼 더 나아야 한다. 4/4가 압도적으로 흔하다 */
const TRIPLE_MARGIN = 1.15;

/**
 * 2박이 4박을 이기려면 넘어야 하는 배수. 3박보다 높다.
 *
 * 4/4의 3박째도 어느 정도 세기 때문에 2박 가설은 늘 그럴듯해 보이는데(실측:
 * 정답 4/4 곡에서 4박 +0.265 대 2박 +0.241), 실제로 2/4로 적는 음악은 드물다.
 *
 * ## 이 마진을 더 올리려다 되돌렸다 (2026-08-11)
 *
 * "4/4가 아니면 맞대결 70%를 넘어야 한다"로 올린 적이 있다. 계산상 **2/4는
 * 그 문턱을 원리적으로 못 넘는다** — 2가 4를 나누는 탓에 순수한 2박 신호에서도
 * 4박 가설이 효과의 2/3를 가져가 맞대결 몫이 60%에서 천장을 친다. 즉 2/4를
 * 사실상 끄는 변경이었고, **진짜 2/4 동요를 넣어도 4/4가 나왔다**(실측).
 *
 * 2/4와 4/4를 악센트만으로 가르는 것은 지금 방법으로는 어렵다는 판단이라,
 * 문턱을 높여 한쪽을 끄는 대신 **2/4가 나오면 그것을 배수 오류의 신호로 쓰는**
 * 쪽으로 갔다(`analysis/index.ts`의 `resolveDupleMeter`).
 */
const DUPLE_MARGIN = 1.4;
/** 박 안쪽을 몇 조각으로 훑는가. 2·3 양쪽으로 나누어떨어져야 한다 */
const SUBDIVISIONS = 12;
/** 3분할 자리가 2분할 자리를 이 배수만큼 넘으면 3분할로 본다 */
const COMPOUND_RATIO = 1.15;
/** 3분할 셋째 자리가 첫째의 이 배수를 넘으면 셔플(가운데가 빈 것) */
const SHUFFLE_RATIO = 1.6;
/** 신뢰도 1에 해당하는 효과 크기. 0.8σ면 눈으로도 뚜렷하다 */
const FULL_CONFIDENCE_EFFECT = 0.8;

export type Subdivision = "simple" | "compound";

/** 마디 길이 후보 하나. 화면이 "얼마나 팽팽했는가"를 보여주는 데 쓴다 */
export interface MeterCandidate {
  readonly beatsPerBar: number;
  /** "4/4" */
  readonly value: string;
  /** 후보들 사이의 몫 0~1. 다 더하면 1이다 */
  readonly probability: number;
}

export interface MeterEstimate {
  /** "4/4" · "3/4" */
  readonly value: string;
  readonly beatsPerBar: number;
  /** 몇 번째 비트가 첫 다운비트인가 */
  readonly phase: number;
  readonly subdivision: Subdivision;
  /** 셔플·스윙. 박자표는 그대로 두고 플래그로만 남긴다 */
  readonly shuffle: boolean;
  readonly confidence: number;
  /** 마디 길이 후보와 각각의 비율. 확률 내림차순 */
  readonly candidates: readonly MeterCandidate[];
  readonly downbeats: readonly number[];
}

function zscore(values: Float64Array): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += values[i];
  mean /= n;
  let sq = 0;
  for (let i = 0; i < n; i += 1) sq += (values[i] - mean) ** 2;
  const sd = Math.sqrt(sq / n);
  if (sd === 0) return out;
  for (let i = 0; i < n; i += 1) out[i] = (values[i] - mean) / sd;
  return out;
}

/**
 * 비트 구간마다 값을 모아 비트 길이 수열로 만든다.
 *
 * **코드 인식도 이걸 쓴다**(`chords.ts`가 비트별 에너지를 낼 때) — 그래서
 * 공개돼 있다. 순수 합이라 도메인을 모른다.
 */
export function perBeat(
  beats: readonly number[],
  fps: number,
  frame: Float32Array,
): Float64Array {
  const out = new Float64Array(Math.max(0, beats.length - 1));
  for (let i = 0; i + 1 < beats.length; i += 1) {
    const from = Math.max(0, Math.round(beats[i] * fps));
    const to = Math.min(frame.length, Math.round(beats[i + 1] * fps));
    let sum = 0;
    for (let t = from; t < to; t += 1) sum += frame[t];
    out[i] = sum;
  }
  return out;
}

/**
 * **비트 동기 크로마** — 비트 구간마다 크로마를 모아 12차원 하나로 만든다.
 *
 * 사양서 §1.1이 못박은 순서의 앞쪽이다: 코드 인식은 프레임이 아니라 **여기
 * 위에서** 돈다. 비트 안이 균질해지고, Viterbi가 볼 길이가 프레임 수에서 비트
 * 수로 줄어든다(보통 20~40배).
 * 출처: Bartsch & Wakefield, WASPAA 2001.
 *
 * 길이는 `beats.length - 1`이다 — 마지막 비트는 다음 비트가 없어 구간을 못 만든다.
 *
 * `weight`를 주면 프레임마다 그만큼 가중해 더한다. **코드 쪽이 이걸 쓴다** —
 * 코드용 크로마는 프레임마다 정규화되어 있어 무음과 큰 소리가 구별되지 않고,
 * 그대로 평균하면 잔향 꼬리가 어택과 같은 무게를 갖는다. 박자 쪽은 안 준다
 * (지금 동작을 그대로 두기 위해서다).
 *
 * `taper`는 비트 **안쪽**을 더 믿는다. 아래 절 참조 — 이것도 코드 쪽만 켠다.
 */
export function beatChroma(
  beats: readonly number[],
  fps: number,
  chroma: Float32Array,
  weight?: Float32Array,
  taper = false,
): Float64Array[] {
  const count = Math.max(0, beats.length - 1);
  const frames = Math.floor(chroma.length / 12);
  const vectors: Float64Array[] = [];
  for (let i = 0; i < count; i += 1) {
    const from = Math.max(0, Math.round(beats[i] * fps));
    const to = Math.min(frames, Math.round(beats[i + 1] * fps));
    const span = to - from;
    const v = new Float64Array(12);
    for (let t = from; t < to; t += 1) {
      let w = weight ? weight[t] : 1;
      if (taper && span > 1) w *= bell((t - from) / (span - 1));
      if (w <= 0) continue;
      for (let pc = 0; pc < 12; pc += 1) v[pc] += chroma[t * 12 + pc] * w;
    }
    vectors.push(v);
  }
  return vectors;
}

/**
 * 비트 안 위치(0~1)의 무게. 양 끝에서 0, 가운데서 1인 종 모양(Hann).
 *
 * **STFT 창이 비트보다 짧지 않기 때문에 필요하다.** 코드용 창은 371ms인데
 * 120BPM의 한 박은 500ms다 — 비트 머리에 놓인 프레임은 창의 절반(186ms)이
 * **앞 비트**에 걸쳐 있어서 이전 코드를 함께 본다.
 *
 * 실측(합성 `FM7·G7·Em7·Am7` 트랙): 이게 없으면 마디 첫 비트가 앞 코드로
 * 잡혀 `G7`과 `Em7`이 한 덩어리 `G`로 뭉갰다. 자르지 않고 무게로 낮추는
 * 이유는 빠른 곡에서 비트가 창보다 짧아지면 자를 프레임이 하나도 안 남기
 * 때문이다 — 무게는 그때도 상대적으로 가운데를 고른다.
 */
function bell(position: number): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * Math.min(1, Math.max(0, position)));
}

/** 비트 구간의 평균 크로마끼리 얼마나 달라졌는가 (0=같음, 1=직교). */
function chromaChange(
  beats: readonly number[],
  fps: number,
  chroma: Float32Array,
): Float64Array {
  const vectors = beatChroma(beats, fps, chroma);
  const count = vectors.length;

  const out = new Float64Array(count);
  for (let i = 1; i < count; i += 1) {
    const a = vectors[i - 1];
    const b = vectors[i];
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let pc = 0; pc < 12; pc += 1) {
      dot += a[pc] * b[pc];
      na += a[pc] * a[pc];
      nb += b[pc] * b[pc];
    }
    out[i] = na > 0 && nb > 0 ? 1 - dot / Math.sqrt(na * nb) : 0;
  }
  return out;
}

/** 박 안쪽 ODF를 겹쳐 평균한 윤곽. 0이 박머리, SUBDIVISIONS가 다음 박머리. */
export function beatProfile(
  beats: readonly number[],
  fps: number,
  onset: Float32Array,
): Float64Array {
  const profile = new Float64Array(SUBDIVISIONS);
  let bars = 0;
  for (let i = 0; i + 1 < beats.length; i += 1) {
    const span = beats[i + 1] - beats[i];
    if (span <= 0) continue;
    for (let j = 0; j < SUBDIVISIONS; j += 1) {
      // 조각 경계가 아니라 조각 하나를 통째로 적분한다. 온셋이 격자에
      // 정확히 떨어지지 않아도 잡히도록.
      const from = Math.round((beats[i] + (span * j) / SUBDIVISIONS) * fps);
      const to = Math.round((beats[i] + (span * (j + 1)) / SUBDIVISIONS) * fps);
      let sum = 0;
      let n = 0;
      for (let t = Math.max(0, from); t < Math.min(onset.length, to); t += 1) {
        sum += onset[t];
        n += 1;
      }
      if (n > 0) profile[j] += sum / n;
    }
    bars += 1;
  }
  if (bars > 0) for (let j = 0; j < SUBDIVISIONS; j += 1) profile[j] /= bars;
  return profile;
}

/** 축 A. 박 윤곽에서 2분할/3분할과 셔플을 가른다. */
export function subdivisionOf(profile: Float64Array): {
  subdivision: Subdivision;
  shuffle: boolean;
} {
  const half = profile[SUBDIVISIONS / 2]; // 1/2
  const third = profile[SUBDIVISIONS / 3]; // 1/3
  const twoThird = profile[(SUBDIVISIONS * 2) / 3]; // 2/3

  const tripleish = Math.max(third, twoThird) > half * COMPOUND_RATIO;
  if (!tripleish) return { subdivision: "simple", shuffle: false };
  // 가운데(1/3)가 비고 셋째(2/3)만 강하면 3분할이 아니라 스윙된 2분할이다
  if (twoThird > third * SHUFFLE_RATIO) return { subdivision: "simple", shuffle: true };
  return { subdivision: "compound", shuffle: false };
}

/**
 * 박마다의 "새로움" — 온셋 · 저역(킥) · 화성 변화를 각각 z점수로 맞춰 더한 것.
 *
 * 셋을 z점수로 맞추고 더하는 이유는 단위가 제각각이기 때문이다(플럭스 · 진폭 ·
 * 코사인 거리). 합의 표준편차가 대략 √3이 되므로 `barEffect`가 그걸로 나눠
 * 효과크기를 만든다.
 *
 * **축 B가 쓰는 재료이지만 축 B만의 것은 아니다.** 같은 노벨티에 마디 길이 8을
 * 물어보면 "우리 박이 두 배 빠른가"를 알 수 있다(`index.resolveHalfTempo`) —
 * 그래서 `estimateMeter` 안에 가둬 두지 않고 꺼내 두었다.
 */
export function beatNovelty(
  beats: readonly number[],
  fps: number,
  onset: Float32Array,
  low: Float32Array,
  chroma: Float32Array,
): Float64Array {
  const onsetZ = zscore(perBeat(beats, fps, onset));
  const lowZ = zscore(perBeat(beats, fps, low));
  const changeZ = zscore(chromaChange(beats, fps, chroma));
  const novelty = new Float64Array(onsetZ.length);
  for (let i = 0; i < novelty.length; i += 1) {
    novelty[i] = onsetZ[i] + lowZ[i] + changeZ[i];
  }
  return novelty;
}

/** (마디 길이, 위상)마다 "다운비트 자리가 나머지보다 얼마나 높은가" */
function effectAt(novelty: Float64Array, bar: number, phase: number): number {
  let onSum = 0;
  let onCount = 0;
  let offSum = 0;
  let offCount = 0;
  for (let i = 0; i < novelty.length; i += 1) {
    if ((((i - phase) % bar) + bar) % bar === 0) {
      onSum += novelty[i];
      onCount += 1;
    } else {
      offSum += novelty[i];
      offCount += 1;
    }
  }
  if (onCount === 0 || offCount === 0) return 0;
  // novelty는 z점수 셋의 합이라 표준편차가 대략 √3이다. 나눠서 효과 크기로.
  return (onSum / onCount - offSum / offCount) / Math.sqrt(3);
}

/**
 * 마디 길이 `bar`가 노벨티를 얼마나 잘 설명하는가 — 가장 좋은 위상과 그 효과크기.
 *
 * 위상은 전부 훑는다(`bar`개뿐이다). 동점이면 작은 위상이 이긴다.
 */
export function barEffect(
  novelty: Float64Array,
  bar: number,
): { phase: number; score: number } {
  let best = { phase: 0, score: -Infinity };
  for (let phase = 0; phase < bar; phase += 1) {
    const score = effectAt(novelty, bar, phase);
    if (score > best.score) best = { phase, score };
  }
  return best;
}

/**
 * 박자표 추정. `beats`는 `trackBeats()`의 출력이다.
 *
 * 축 B는 스코프대로 3·4만 본다. 5/4·7/8이 필요해지면 이 배열만 늘리면 되지만,
 * 6을 넣지는 말 것 — 그건 축 B가 아니라 축 A의 물음이다.
 *
 * **8도 넣지 말 것.** 8박 마디는 "진짜 마디"가 아니라 **우리 박이 두 배
 * 빠르다는 신고**라, 박자표의 답이 아니라 템포 교정의 입력이다(2/4를 그렇게
 * 다루는 것과 같다). 후보 목록에 넣으면 화면에 `8/4`가 뜨고 마진을 다시
 * 맞춰야 한다 — `index.resolveHalfTempo`가 `barEffect(novelty, 8)`을 직접
 * 부르는 이유다.
 */
export function estimateMeter(
  beats: readonly number[],
  fps: number,
  onset: Float32Array,
  low: Float32Array,
  chroma: Float32Array,
): MeterEstimate {
  const profile = beatProfile(beats, fps, onset);
  const { subdivision, shuffle } = subdivisionOf(profile);
  const fallback: MeterEstimate = {
    value: "4/4",
    beatsPerBar: 4,
    phase: 0,
    subdivision,
    shuffle,
    confidence: 0,
    candidates: [],
    downbeats: [],
  };
  if (beats.length < 8) return fallback;

  const novelty = beatNovelty(beats, fps, onset, low, chroma);

  let best = { bar: 4, phase: 0, score: -Infinity, weighted: -Infinity };
  const perBar = new Map<number, number>();
  const weightedBar = new Map<number, number>();
  // **4를 먼저 본다.** 아래 비교가 `>`라서 동점이면 먼저 온 쪽이 이긴다 —
  // 셋을 먼저 보면 완전히 평평한 신호(악센트 없는 메트로놈 트랙 등)에서
  // 3/4가 나온다. 4/4가 압도적으로 흔하다는 `TRIPLE_MARGIN`의 취지와 반대다.
  for (const bar of [4, 3, 2]) {
    const barBest = { bar, ...barEffect(novelty, bar) };
    perBar.set(bar, barBest.score);
    // 4/4가 압도적으로 흔하므로 나머지는 마진을 넘어야 이긴다.
    // 고르는 데만 쓰고, 신뢰도는 아래에서 원래 점수로 잰다.
    const margin = bar === 3 ? TRIPLE_MARGIN : bar === 2 ? DUPLE_MARGIN : 1;
    const weighted = barBest.score / margin;
    weightedBar.set(bar, weighted);
    if (weighted > best.weighted) best = { ...barBest, weighted };
  }

  // **배수 관계인 마디 길이는 경쟁자가 아니다.** 2/4와 4/4는 같은 그리드를
  // 다른 단위로 읽은 것이지 서로 다른 판정이 아니다 — 템포에서 ×2·÷2가
  // 신뢰도를 깎지 않는 것과 같은 논리다(`tempo.relatedTempo`). 3박만이 진짜
  // 경쟁자다. 이걸 빼먹으면 후보에 2를 넣은 것만으로 신뢰도가 절반이 된다
  // (실측: 같은 곡에서 0.48 → 0.26).
  const rivals = [...perBar]
    .filter(([bar]) => !relatedBar(bar, best.bar))
    .map(([, score]) => score);
  const rival = rivals.length ? Math.max(...rivals) : 0;
  const strength = Math.min(1, Math.max(0, best.score) / FULL_CONFIDENCE_EFFECT);
  // 경쟁 마디 길이와 비슷하면 확신할 수 없다
  const margin =
    best.score > 0 ? Math.min(1, Math.max(0, 1 - Math.max(0, rival) / best.score)) : 0;
  const confidence = strength * (0.5 + 0.5 * margin);

  const downbeats: number[] = [];
  for (let i = best.phase; i < beats.length; i += best.bar) downbeats.push(beats[i]);

  return {
    value: `${best.bar}/4`,
    beatsPerBar: best.bar,
    phase: best.phase,
    subdivision,
    shuffle,
    confidence,
    candidates: barProbabilities(weightedBar),
    downbeats,
  };
}

/**
 * 두 마디 길이가 같은 그리드의 다른 읽기인가 — 하나가 다른 하나로 나눠떨어지면.
 *
 * 2와 4가 그렇다. 3과 4는 아니다.
 */
function relatedBar(a: number, b: number): boolean {
  return a % b === 0 || b % a === 0;
}

/**
 * 마디 길이 후보를 확률처럼 보이는 비율로.
 *
 * **마진을 적용한 점수를 쓴다** — 화면에 나가는 비율과 실제로 고른 답이 어긋나면
 * ("2박이 45%인데 왜 4/4?") 그 표시는 설명이 아니라 혼란이다.
 *
 * 음수 점수는 0으로 눌러 버린다. "다운비트 자리가 나머지보다 **약하다**"는
 * 뜻이라 후보로서 무게가 없다.
 */
function barProbabilities(
  weighted: ReadonlyMap<number, number>,
): MeterCandidate[] {
  const rows = [...weighted].map(([bar, score]) => ({
    beatsPerBar: bar,
    score: Math.max(0, score),
  }));
  const total = rows.reduce((sum, r) => sum + r.score, 0);
  return rows
    .map((r) => ({
      beatsPerBar: r.beatsPerBar,
      value: `${r.beatsPerBar}/4`,
      probability: total > 0 ? r.score / total : 0,
    }))
    .sort((a, b) => b.probability - a.probability);
}
