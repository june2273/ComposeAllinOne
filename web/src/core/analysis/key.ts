/**
 * 조성 추정 — 크로마 × 조성 프로파일 상관.
 *
 * 강의에도 키 검출 독립 챕터가 없다(화음 인식은 챕터 하나 통째로 있는데도).
 * 표준 해법이 없다는 뜻이므로, 가장 오래되고 가장 잘 알려진 방법부터 둔다:
 * **12차원 크로마와 24개 조성 프로파일의 피어슨 상관** (Krumhansl–Schmuckler).
 *
 * 프로파일은 사람이 "이 조에서 이 음이 얼마나 안정적인가"를 매긴 값이다.
 * 두 벌을 두고 쓴다.
 *
 * | 프로파일 | 출처 | 성격 |
 * |---|---|---|
 * | `KRUMHANSL` | Krumhansl & Kessler 1982 (probe-tone 실험) | 고전. 단조에서 약하다 |
 * | `TEMPERLEY` | Temperley 2001 (Kostka-Payne 코퍼스) | 팝·조성음악에서 대체로 낫다 |
 *
 * 기본값은 Temperley다. 파이프라인 사양서 §7이 "장르별 프로파일 전환이
 * 정확도에 크게 영향"이라 적어 둔 그 축이니, J-pop 평가셋이 생기면 여기서
 * 먼저 시험할 것.
 *
 * **한계를 분명히 해 둔다.** 이것은 곡 전체를 하나의 조로 보는 방법이다.
 * 전조는 원리적으로 잡히지 않는다 — 구간별로 나눠 돌리는 것만으로는 부족하고,
 * 사양서 §7의 방침대로 **코드 시퀀스 위에서** 판정해야 한다. 코드 인식이
 * 생기기 전까지 이 모듈은 "전역 조성" 한 줄만 책임진다.
 */

export const MAJOR_PROFILES = {
  KRUMHANSL: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  TEMPERLEY: [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0],
} as const;

export const MINOR_PROFILES = {
  KRUMHANSL: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
  TEMPERLEY: [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0],
} as const;

export type ProfileName = keyof typeof MAJOR_PROFILES;

/**
 * 조 이름의 관용 표기.
 *
 * 같은 음고류라도 장조는 D♭, 단조는 C♯으로 적는 것이 보통이다 — 조표에 붙는
 * 임시표가 적은 쪽을 쓴다. MIDI 번호에서 음이름을 얻는 `theory.NOTE_NAMES`와
 * 표가 다른 이유가 이것이라, 공유하지 않고 여기 따로 둔다.
 */
const MAJOR_NAMES = [
  "C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B",
];
const MINOR_NAMES = [
  "C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B",
];

export type Mode = "major" | "minor";

export interface KeyCandidate {
  /** "C 장조" */
  readonly name: string;
  readonly tonic: number;
  readonly mode: Mode;
  /** 피어슨 상관 −1~1 */
  readonly score: number;
}

export interface KeyEstimate extends KeyCandidate {
  readonly confidence: number;
  readonly candidates: readonly KeyCandidate[];
  /** 판정에 쓴 12차원 크로마 (합이 1) */
  readonly chroma: readonly number[];
}

export function keyName(tonic: number, mode: Mode): string {
  const pc = ((tonic % 12) + 12) % 12;
  return mode === "major" ? `${MAJOR_NAMES[pc]} 장조` : `${MINOR_NAMES[pc]} 단조`;
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/**
 * 프레임별 크로마를 하나로 모은다.
 *
 * 조용한 프레임은 뺀다 — 무음 구간의 잡음이 12칸에 고르게 깔리면 상관이
 * 전부 0 쪽으로 눌린다. `features.extractFeatures()`가 프레임마다 L1
 * 정규화를 해 두므로 여기서는 세기 가중 없이 그냥 더한다.
 */
export function aggregateChroma(chroma: Float32Array): number[] {
  const frames = Math.floor(chroma.length / 12);
  const energy = new Float64Array(frames);
  for (let t = 0; t < frames; t += 1) {
    let sum = 0;
    for (let pc = 0; pc < 12; pc += 1) sum += chroma[t * 12 + pc];
    energy[t] = sum;
  }
  // 정규화된 프레임은 합이 1, 무음 프레임은 0이다. 절반 이상이면 유효로 본다.
  const total = Array.from({ length: 12 }, () => 0);
  let used = 0;
  for (let t = 0; t < frames; t += 1) {
    if (energy[t] < 0.5) continue;
    for (let pc = 0; pc < 12; pc += 1) total[pc] += chroma[t * 12 + pc];
    used += 1;
  }
  if (used === 0) return total;
  for (let pc = 0; pc < 12; pc += 1) total[pc] /= used;
  return total;
}

/** 24개 조성 후보와의 상관. 크로마는 12차원이면 어떤 스케일이든 상관없다. */
export function estimateKeyFromChroma(
  chroma: readonly number[],
  profile: ProfileName = "TEMPERLEY",
): KeyEstimate {
  const major = MAJOR_PROFILES[profile];
  const minor = MINOR_PROFILES[profile];
  const candidates: KeyCandidate[] = [];

  for (let tonic = 0; tonic < 12; tonic += 1) {
    const rotate = (p: readonly number[]) =>
      Array.from({ length: 12 }, (_, i) => p[(i - tonic + 12) % 12]);
    candidates.push({
      name: keyName(tonic, "major"),
      tonic,
      mode: "major",
      score: correlation(chroma, rotate(major)),
    });
    candidates.push({
      name: keyName(tonic, "minor"),
      tonic,
      mode: "minor",
      score: correlation(chroma, rotate(minor)),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const second = candidates[1];
  // 상관은 -1~1이라 차이를 그대로 쓰면 너무 작다. 0.1 벌어지면 확신으로 본다.
  const confidence = Math.max(0, Math.min(1, (top.score - second.score) / 0.1));

  return {
    ...top,
    confidence,
    candidates: candidates.slice(0, 4),
    chroma: [...chroma],
  };
}

/** 프레임 크로마에서 바로 조성까지. */
export function estimateKey(
  chroma: Float32Array,
  profile: ProfileName = "TEMPERLEY",
): KeyEstimate {
  return estimateKeyFromChroma(aggregateChroma(chroma), profile);
}
