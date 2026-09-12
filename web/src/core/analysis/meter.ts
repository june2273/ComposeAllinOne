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

/*
 * **축 B(마디당 박)가 2026-09-12에 통째로 빠졌다.** 마디 길이는 이제 사이드카의
 * 다운비트가 정한다(`server/app/beats.py`의 `beats_per_bar`, 실측 14/14).
 *
 * 함께 사라진 것: `ANSWERS`(4·3) · `TRIPLE_MARGIN`(1.15) · `DUPLE_MARGIN`(1.4) ·
 * `FULL_CONFIDENCE_EFFECT`(0.8) · `relatedBar` · `barProbabilities` · `halfTempo`.
 * 그 값들의 근거였던 14곡 표(정답 최고 1.391 대 오답 최저 1.412 — **문턱을 놓을
 * 자리가 1.5%밖에 없었다**)는 CLAUDE.md와 `docs/템포_배수오류_미해결.md`에 남아
 * 있다. 되살릴 일이 생기면 거기부터 읽을 것 — **그 좁은 창이 이 축을 버린
 * 이유이지, 버린 탓에 생긴 문제가 아니다.**
 *
 * **축 A(3분할·셔플)는 그대로다.** 다운비트가 답하지 않는 물음이라 여기 남는다.
 */
/** 박 안쪽을 몇 조각으로 훑는가. 2·3 양쪽으로 나누어떨어져야 한다 */
const SUBDIVISIONS = 12;
/** 3분할 자리가 2분할 자리를 이 배수만큼 넘으면 3분할로 본다 */
const COMPOUND_RATIO = 1.15;
/** 3분할 셋째 자리가 첫째의 이 배수를 넘으면 셔플(가운데가 빈 것) */
const SHUFFLE_RATIO = 1.6;

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
  /** 마디 길이 후보와 각각의 비율. 확률 내림차순. **2박은 안 들어간다** */
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

/** 밖에서 받은 마디 격자. 사이드카의 다운비트가 출처다 */
export interface MeterGrid {
  readonly beatsPerBar: number;
  readonly downbeats: readonly number[];
}

/**
 * 박자표. **마디 길이는 정하지 않고 받는다 — 여기서 하는 일은 축 A뿐이다.**
 *
 * 2026-09-12 이전에는 4·3·2 가설을 노벨티 효과크기로 겨루게 했다. 그 축이
 * 통째로 빠진 이유는 위 주석에 있고, 요지는 **문턱을 놓을 자리가 1.5%밖에
 * 없었다**는 것이다. 지금은 사이드카의 다운비트에서 최빈 마디 길이를 세는데
 * 정답 14곡에서 14/14이고 유일한 3/4도 맞힌다.
 *
 * 남은 판단은 **3분할인가 셔플인가**(`subdivisionOf`)다. 다운비트는 마디가
 * 어디서 시작하는지만 말하지 박 **안쪽**을 말하지 않으므로, 이 물음은 여전히
 * 우리 것이다.
 */
export function estimateMeter(
  beats: readonly number[],
  fps: number,
  onset: Float32Array,
  grid: MeterGrid,
): MeterEstimate {
  const profile = beatProfile(beats, fps, onset);
  const { subdivision, shuffle } = subdivisionOf(profile);

  const bar = grid.beatsPerBar > 0 ? grid.beatsPerBar : 4;
  const downbeats = grid.downbeats;

  // **위상은 세지 않고 찾는다.** 첫 다운비트가 몇 번째 비트인지가 곧 위상이고,
  // 그 값은 사이드카가 이미 정한 것이라 우리가 다시 고를 여지가 없다.
  let phase = 0;
  if (downbeats.length && beats.length) {
    let best = Infinity;
    for (let i = 0; i < beats.length; i += 1) {
      const d = Math.abs(beats[i] - downbeats[0]);
      if (d < best) {
        best = d;
        phase = i;
      }
    }
    phase %= bar;
  }

  const { confidence, candidates } = barConsistency(beats, downbeats, bar);

  return {
    value: `${bar}/4`,
    beatsPerBar: bar,
    phase,
    subdivision,
    shuffle,
    confidence,
    candidates,
    downbeats: [...downbeats],
  };
}

/**
 * 다운비트 간격이 얼마나 한결같은가 — **이것이 새 박자 신뢰도다.**
 *
 * 예전에는 4박 가설과 3박 가설의 노벨티 효과크기를 겨루게 하고 그 마진을
 * 신뢰도로 삼았다. 축 B가 사라졌으니 그 대결도 없다. 대신 **모델이 낸
 * 다운비트가 실제로 같은 간격으로 오는가**를 잰다 — 곡 중간에 마디가 흔들리면
 * 그만큼 덜 믿을 일이고, 그건 겨루기 없이도 셀 수 있는 진짜 증거다.
 *
 * `candidates`도 여기서 나온다. 가설의 점수가 아니라 **관측된 마디 길이의
 * 분포**라, 화면의 막대가 "무엇과 다퉜는가"가 아니라 "실제로 몇 박짜리 마디가
 * 몇 번 나왔는가"를 보인다. 후자가 읽기 쉽고 무엇보다 지어낸 값이 아니다.
 */
function barConsistency(
  beats: readonly number[],
  downbeats: readonly number[],
  bar: number,
): { confidence: number; candidates: MeterCandidate[] } {
  const counts = new Map<number, number>();
  for (let i = 0; i + 1 < downbeats.length; i += 1) {
    let n = 0;
    for (const b of beats) {
      if (b >= downbeats[i] - 1e-6 && b < downbeats[i + 1] - 1e-6) n += 1;
    }
    if (n > 0) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return { confidence: 0, candidates: [] };

  const candidates = [...counts]
    .map(([beatsPerBar, n]) => ({
      beatsPerBar,
      value: `${beatsPerBar}/4`,
      probability: n / total,
    }))
    .sort((x, y) => y.probability - x.probability);

  return { confidence: (counts.get(bar) ?? 0) / total, candidates };
}

