[한국어](README.ko.md)

# ComposeAllinOne

Open one pop recording and get tempo, meter and key, separated stems, the vocal melody as MIDI / MusicXML / a Synthesizer V project, and the drum part as loops and fills.

## Problem

Turning a mixed recording into a usable vocal score breaks in a few predictable places:

- Pitch trackers drop high notes an octave (the f0 is "halved").
- Snapping notes to the nearest grid cell turns a slightly late singer into a page of syncopation.
- Beat trackers lock onto half or double the real tempo, and everything downstream (bars, note values) inherits the error.

## Approach

Two processes with one rule: **learned models live in a local Python sidecar; every musical decision lives in a pure TypeScript core.** Swapping a model does not touch the web app. That held when the melody model was replaced: the web code did not change.

```
browser (React + TS)                          local sidecar (FastAPI)
  core/analysis   own FFT/STFT, key, meter      htdemucs        stems
  core/transcribe f0 -> notes (Viterbi)          RMVPE x2 pass   vocal f0
                  -> metrical quantization       Beat This!      beats / downbeats
                  -> MIDI, MusicXML, .svp        All-In-One      sections (off by default)
  core/drums      onsets -> loops / fills
```

- **Notes from f0:** a Viterbi DP with a capped local cost, so vibrato and one-frame octave jumps don't create notes. Duration decides, not deviation size.
- **Quantization:** a metrical-HMM-style DP (after Nakamura et al. 2017) with a drift curve, instead of rounding to the grid.
- **High register:** the mix is also analyzed at half sample rate (one octave down), and a spectrum × cepstrum (CFP) check settles octave disputes.
- **Synthesizer V export:** the f0 curve is kept as pitch control points (RDP-reduced), and the tempo map follows the tracked beats.

## Results

Measured against the author's own hand transcriptions. The set is small (5 songs / 6 cover versions for melody, 14 songs for tempo), so treat these as indicative, not general.

| Change | Before → after | Where it's recorded |
|---|---|---|
| Melody model basic-pitch → RMVPE (one song, 783 reference notes) | correct notes 189 → 515 | `CLAUDE.md` |
| Metrical quantization instead of rounding (139 BPM cover) | onset-position agreement 58% → 93% | `CLAUDE.md` |
| Beat tracking autocorrelation → Beat This! (14 songs) | correct BPM 11/14 → 14/14 | `docs/템포_배수오류_미해결.md` |
| High-register split (6 reference versions) | matched notes 1621 → 1797 (+10.9%) | `CLAUDE.md` |

Chord recognition runs but is hidden in the UI: there is no chord ground truth yet, so its accuracy is unknown.

## Run

```bash
cd web
npm install
npm run dev      # http://localhost:5173 (starts the sidecar too if server/.venv exists)
npm test
```

Sidecar (Python 3.11; torch makes this several GB):

```bash
cd server
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q
```

Piano samples are not in the repo. Without them playback falls back to a sine synth:

```bash
.venv/bin/python web/scripts/download_assets.py
.venv/bin/python web/scripts/prepare_web_piano.py   # needs ffmpeg
```

## Limitations and lessons

- High notes are still partly lost. Above C5 the model's own confidence collapses, and about half the missing notes never form at all; it isn't an octave error. Dead ends are written up in `docs/고음_f0_미해결.md`.
- 2/4 is never output (it was almost always a tempo error in this set). Tuplets and swing aren't notated, and the transcribed score is a draft that needs editing.
- Section analysis is off by default: it costs about 211 s per song on CPU.
- **Lesson:** conclusions flipped twice when the evaluation set grew from one or two songs to four. A proxy metric picked the wrong input signal once. Frame-level f0 accuracy and note-level accuracy can move in opposite directions, so changes are judged at the note level.

## References

Studied with J. Nam's public course materials: CTP431 / GCT731.

- Beat This! (Foscarin, Schlüter & Widmer, ISMIR 2024), htdemucs ([demucs](https://github.com/adefossez/demucs)), RMVPE (Wei et al., Interspeech 2023), All-In-One (Kim & Nam, WASPAA 2023)
- SuperFlux (Böck & Widmer, DAFx 2013), CFP (Su & Yang, TASLP 2015), metrical HMM (Nakamura, Yoshii & Sagayama, TASLP 2017)
- verovio (LGPL-3.0), Upright Piano KW sample set (CC0)

Full sources, licenses and where each is used: [citation.md](citation.md).
