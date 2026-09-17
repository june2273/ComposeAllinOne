/**
 * 드럼 — 스템에서 타점을 뽑고, 마디로 접어, 루프와 필인을 가른다.
 *
 * **층이 둘로 갈려 있다.**
 *
 * ```
 * drums.wav ─[detect]→ DrumHit[] ─[pattern]→ A/A′/A″ · 루프 · 필인
 *              오디오를 안다        격자를 안다
 * ```
 *
 * 이 경계가 임의가 아니다. 언젠가 학습된 드럼 전사기를 붙이면 그건 이 저장소의
 * 규칙대로 **사이드카**로 간다(`melody.py`와 같은 자리). 그때 `pattern.ts`가 한
 * 줄도 안 바뀌려면 경계가 오디오가 아니라 **`DrumHit[]`**이어야 한다 — RMVPE로
 * 갈아끼울 때 `core/transcribe`가 안 바뀐 그 배치를 그대로 옮긴 것이다.
 *
 * `core/analysis`와 `core/transcribe`를 **둘 다** import한다. 금지된 것은 그
 * 둘이 서로를 import하는 것이고(각자 브라우저 없이 돌아야 하므로), 제3의 순수
 * 모듈이 둘을 쓰는 것은 그 성질을 안 깨뜨린다.
 */

export {
  BAND_EDGES,
  type DetectOptions,
  type DrumDetection,
  type DrumHit,
  detectDrums,
  pickPeaks,
} from "./detect";

export { loopToMidi, toDrumMidi, type DrumMidiOptions } from "./midi";

export { legend, toDrumMusicXml, type DrumScoreOptions } from "./notation";

export {
  analyzePattern,
  type BarPattern,
  type BarSection,
  type DrumAnalysis,
  type DrumPattern,
  type LoopSpan,
  type PatternOptions,
} from "./pattern";

export {
  CLASS_MARKS,
  CLASS_NAMES,
  classOf,
  DRUM_CLASSES,
  type DrumClass,
  GM_DRUMS,
  GM_NUMBERS,
  type GmDrum,
  type NoteHead,
  representative,
} from "./gm";
