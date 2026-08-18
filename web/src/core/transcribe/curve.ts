/**
 * f0 커브 → **음표에 정합된 피치 컨트롤 점.**
 *
 * `notes.ts`가 커브에서 음표를 뽑고 **나머지를 버린다** — 비브라토도 포르타멘토도
 * 스쿠핑도 `centsOffset` 스칼라 하나로 뭉갠다(`notes.ts:58-61`). 표기에는 그것으로
 * 충분하지만 **가창 합성기로 보낼 때는 그 나머지가 곧 노래다.** 음표만 보내면
 * 합성기의 AI가 자기 피치 커브를 새로 만들어 붙이므로, 원 보컬이 어떻게 불렀는지는
 * 한 톨도 남지 않는다.
 *
 * 이 파일은 그 나머지를 되살린다. **형식은 모른다** — 신스V의 blick도 `.svp`도
 * `svp.ts`의 일이고, 여기서 나오는 것은 `(초, 소수 MIDI)` 쌍의 목록뿐이다.
 *
 * ## 왜 음표에 정합시키는가
 *
 * 커브를 날것 그대로 내보내면 안 된다. **f0에는 음표가 되지 못한 것들이 섞여
 * 있다** — 옥타브가 튄 프레임, 반주가 새어 든 구간, 숨소리. `notes.ts`의 DP는
 * 상한 있는 비용(`COST_CLAMP`)으로 그것들을 이미 걸러 냈고, **그 판단이 옳다면
 * 커브도 같은 판단을 따라야 한다.** 커브만 따로 놀면 "악보에는 A4인데 소리는
 * A3"인 파일이 나온다.
 *
 * 그래서 여기서 하는 일은 셋뿐이다: **음표 밖의 프레임을 버리고**, **음표에서
 * 옥타브만큼 떨어진 프레임을 끌어당기고**, **점 개수를 줄인다.**
 * 음정을 새로 정하지 않는다 — 미세 음정은 전부 f0가 준 그대로 나간다.
 */

import { hzToMidi, type NoteEvent, type PitchCurve } from "./notes";

/** 한 점. `sec`는 곡 시작부터의 초, `midi`는 **소수** MIDI 번호(절대 음고) */
export interface PitchPoint {
  readonly sec: number;
  readonly midi: number;
}

export interface PitchTrack {
  readonly points: readonly PitchPoint[];
  /** 진단용 — 줄이기 전 유효 프레임 수. `points.length`와 견주어 압축률을 본다 */
  readonly rawCount: number;
  /** 옥타브를 끌어당긴 프레임 수. 0이 아니면 f0가 옥타브를 튀었다는 뜻이다 */
  readonly octaveSnapped: number;
}

export interface PitchTrackOptions {
  /**
   * 조율 편차(센트). **`Transcription.tuningCents`를 그대로 넣는다.**
   *
   * `segmentNotes`가 음표를 자를 때 쓴 값과 **반드시 같아야 한다**(`notes.ts:290`).
   * 다르면 음표와 커브가 서로 다른 기준으로 밀려 그 차이만큼 벌어진다.
   * 두 번 빼는 사고를 막는 회귀 시험이 있다.
   */
  readonly tuningCents?: number;
  /** 이 아래 신뢰도의 프레임은 무성으로 본다. `segmentNotes`와 같은 기본값 */
  readonly minConfidence?: number;
  /** 점 줄이기 허용오차(센트). `RDP_CENTS` */
  readonly toleranceCents?: number;
  /** 점 사이 최소 간격(밀리초). `MIN_SPACING_MS` */
  readonly minSpacingMs?: number;
}

/**
 * 점을 줄일 때 허용하는 오차(센트).
 *
 * **8센트인 것은 위아래가 둘 다 막혀 있어서다.** 위로는 CREPE·RMVPE 계열의
 * 출력 해상도가 20센트 빈이라(PDF 34쪽) 그보다 성기게 잡으면 모델이 실제로
 * 구분한 것을 우리가 도로 뭉갠다. 아래로는 f0 자체의 프레임 잡음이 몇 센트라
 * 더 조이면 잡음을 그대로 점으로 찍게 되어 개수만 늘고 얻는 것이 없다.
 *
 * **평가셋 없이 정한 값이다.** 다만 이 상수는 정확도가 아니라 파일 크기에 주로
 * 걸리고, 실측 기준(사용자의 신스V 파일이 2~4분에 1,200~3,600점)과 같은
 * 자릿수가 나오는지로 확인할 수 있다.
 */
const RDP_CENTS = 8;

/**
 * 점 사이 최소 간격(밀리초).
 *
 * 커브의 홉이 10ms이므로 이보다 촘촘해질 수 없다. 그래도 상수로 적어 두는 것은
 * **다음 모델의 홉이 더 짧을 수 있기 때문**이다(`melody.resample_curve`가 같은
 * 이유로 남아 있다). 사용자의 신스V 파일 실측 최소 간격이 2~5ms라 형식 쪽
 * 제약은 아니다.
 */
const MIN_SPACING_MS = 10;

/**
 * 음표에서 이만큼(반음) 넘게 벗어난 프레임은 옥타브를 끌어당긴다.
 *
 * 6반음 = 반옥타브. 이보다 크면 "가장 가까운 옥타브"가 유일하게 정해지므로
 * 판정이 모호해지지 않는다. 진짜 벤드·스쿠핑은 이 안에서 일어난다 — 5반음짜리
 * 스쿠핑은 그대로 살고, 12반음 튐만 끌려온다.
 */
const OCTAVE_SNAP_RANGE = 6;

/** `segmentNotes`의 기본값과 같은 값. 두 곳이 갈리면 음표와 커브의 유·무성이 어긋난다 */
const DEFAULT_MIN_CONFIDENCE = 0.3;

/**
 * 음표와 커브를 맞춰 컨트롤 점을 만든다.
 *
 * 음표가 없으면 점도 없다 — **커브만으로는 점을 찍지 않는다.** 음표가 서지 못한
 * 구간은 `notes.ts`가 "노래가 아니다"라고 판단한 자리이고, 거기에 점을 찍으면
 * 합성기가 부르지도 않을 자리의 피치를 붙들게 된다.
 */
export function buildPitchTrack(
  notes: readonly NoteEvent[],
  curve: PitchCurve,
  options: PitchTrackOptions = {},
): PitchTrack {
  const {
    tuningCents = 0,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    toleranceCents = RDP_CENTS,
    minSpacingMs = MIN_SPACING_MS,
  } = options;

  const hopSec = curve.hopMs / 1000;
  const frames = curve.f0.length;
  if (frames === 0 || !(hopSec > 0) || notes.length === 0) {
    return { points: [], rawCount: 0, octaveSnapped: 0 };
  }

  const ordered = [...notes].sort((a, b) => a.startSec - b.startSec);

  const points: PitchPoint[] = [];
  let rawCount = 0;
  let octaveSnapped = 0;

  // 음표 하나씩 훑는다. 프레임을 훑으면서 음표를 찾는 것보다 이쪽이 단순하다 —
  // 음표는 겹치지 않고(단선율) 각 음표의 프레임 범위가 곧 색인 범위다.
  for (const note of ordered) {
    const from = Math.max(0, Math.ceil(note.startSec / hopSec));
    const to = Math.min(frames, Math.ceil(note.endSec / hopSec));

    // 유성이 끊기면 런이 끊긴다. 신스V는 점이 없는 구간을 자기 전이로 채우므로
    // **끊어 두는 것 자체가 의미 있는 신호다** — 이어 붙이면 없던 포르타멘토가 생긴다.
    let run: PitchPoint[] = [];
    let anchored = false;

    const flush = () => {
      if (run.length) {
        emitRun(points, run, toleranceCents, minSpacingMs);
        run = [];
      }
    };

    for (let i = from; i < to; i += 1) {
      const hz = curve.f0[i];
      const ok =
        hz > 0 &&
        Number.isFinite(hz) &&
        (curve.confidence === undefined || curve.confidence[i] >= minConfidence);
      if (!ok) {
        flush();
        continue;
      }

      let midi = hzToMidi(hz) - tuningCents / 100;
      // 가장 가까운 옥타브로 끌어당긴다. 나눗셈 한 번이라 반복문이 필요 없다.
      const shift = Math.round((note.midi - midi) / 12);
      if (shift !== 0 && Math.abs(note.midi - midi) > OCTAVE_SNAP_RANGE) {
        midi += shift * 12;
        octaveSnapped += 1;
      }
      rawCount += 1;

      const sec = i * hopSec;
      // **음표 시작에 앵커를 하나 둔다.** 첫 유성 프레임이 음표보다 늦게 오면
      // 그 사이를 합성기가 채우면서 아래에서 미끄러져 올라오는 어택이 생긴다.
      if (!anchored) {
        anchored = true;
        if (sec - note.startSec > hopSec / 2) {
          run.push({ sec: note.startSec, midi });
        }
      }
      run.push({ sec, midi });
    }
    flush();
  }

  return { points, rawCount, octaveSnapped };
}

/** 런 하나를 줄여서 내보낸다. 런 경계의 두 점은 반드시 살아남는다 */
function emitRun(
  out: PitchPoint[],
  run: readonly PitchPoint[],
  toleranceCents: number,
  minSpacingMs: number,
): void {
  const reduced = simplify(run, toleranceCents);
  const minGap = minSpacingMs / 1000;
  for (let i = 0; i < reduced.length; i += 1) {
    const point = reduced[i];
    // 끝점은 무조건 남긴다 — 런의 시작과 끝이 곧 유성 구간의 경계다
    const edge = i === 0 || i === reduced.length - 1;
    const prev = out[out.length - 1];
    if (!edge && prev && point.sec - prev.sec < minGap) continue;
    out.push(point);
  }
}

/**
 * Ramer–Douglas–Peucker. **거리는 세로(센트)로 잰다.**
 *
 * 가로축이 초, 세로축이 반음이라 일반적인 수직거리는 단위가 섞여 뜻이 없다.
 * 우리가 지키려는 것은 "그 시각의 음높이가 얼마나 틀리는가"이므로 **같은 시각의
 * 세로 오차**가 정확히 그 양이다.
 *
 * RDP를 고른 이유는 **극점을 남기기 때문**이다. 다운샘플링이나 이동평균은
 * 비브라토의 봉우리·골을 깎아 진폭을 줄여 버리는데, RDP는 가장 많이 벗어난 점을
 * 먼저 집으므로 **비브라토는 그대로 두고 평평한 유지음만 걷어낸다.**
 *
 * 재귀 대신 명시적 스택을 쓴다. 한 음표가 수천 프레임일 수 있고 최악의 경우
 * 재귀 깊이가 그만큼 깊어진다.
 */
function simplify(
  run: readonly PitchPoint[],
  toleranceCents: number,
): PitchPoint[] {
  if (run.length <= 2) return [...run];

  const keep = new Uint8Array(run.length);
  keep[0] = 1;
  keep[run.length - 1] = 1;

  const stack: [number, number][] = [[0, run.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;

    const a = run[lo];
    const b = run[hi];
    const span = b.sec - a.sec;
    let worst = -1;
    let worstAt = -1;
    for (let i = lo + 1; i < hi; i += 1) {
      const t = span > 0 ? (run[i].sec - a.sec) / span : 0;
      const line = a.midi + (b.midi - a.midi) * t;
      const dev = Math.abs(run[i].midi - line) * 100;
      if (dev > worst) {
        worst = dev;
        worstAt = i;
      }
    }
    if (worst > toleranceCents && worstAt > 0) {
      keep[worstAt] = 1;
      stack.push([lo, worstAt], [worstAt, hi]);
    }
  }

  const out: PitchPoint[] = [];
  for (let i = 0; i < run.length; i += 1) if (keep[i]) out.push(run[i]);
  return out;
}
