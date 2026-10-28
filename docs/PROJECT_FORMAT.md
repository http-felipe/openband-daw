# OpenBand project format (`*.obproj.json`)

A project is a single JSON document. All positions and lengths are in **beats** (quarter notes), so changing the tempo never moves notes. Recorded audio is embedded, so one file holds the whole song.

```jsonc
{
  "format": "openband-project",      // required
  "version": 1,                       // schema version
  "name": "Demo Song",
  "bpm": 104,                         // 20–300
  "timeSignature": [4, 4],
  "key": "C",
  "loop": { "enabled": true, "start": 0, "end": 16 },
  "master": { "volume": 0, "fx": [ /* FxSlot[] */ ] },
  "tracks": [
    {
      "id": "trk_…",
      "name": "Bass",
      "kind": "midi",                 // "midi" | "audio"
      "color": "#4fb0ff",
      "instrument": {                 // MIDI tracks only
        "type": "subtractive",        // see "Instrument engines"
        "preset": "Sub Bass",
        "params": { "cutoff": 480, "reso": 3 }
      },
      "volume": -6,                   // dB, −60…+6
      "pan": 0,                       // −1…1
      "mute": false, "solo": false, "armed": false, "monitor": false,
      "fx": [
        { "id": "fx_…", "type": "reverb", "bypass": false, "params": { "decay": 2.2, "mix": 0.25 } }
      ],
      "automation": {
        "volume": [ { "beat": 0, "value": -24 }, { "beat": 4, "value": -9 } ],   // dB
        "pan": []                                                                 // −1…1
      },
      "clips": [
        { "id": "clip_…", "kind": "midi", "name": "Bass", "start": 0, "length": 16,
          "notes": [ { "id": "n_…", "pitch": 45, "start": 0, "duration": 0.75, "velocity": 0.9 } ] },
        { "id": "clip_…", "kind": "audio", "name": "Take 1", "start": 4, "length": 8,
          "audioId": "aud_…", "offset": 0 }  // offset: seconds into the source audio
      ]
    }
  ],
  "audioPool": {
    "aud_…": { "name": "Take 1", "sampleRate": 48000, "channels": 1, "wav": "<16-bit PCM WAV, base64>" }
  }
}
```

## Instrument engines (`instrument.type`)

| Type | Engine | Parameters |
| --- | --- | --- |
| `subtractive` | Subtractive synth | `wave1`, `wave2`, `mix`, `semi2`, `detune`, `cutoff`, `reso`, `envAmt`, `fdecay`, `attack`, `decay`, `sustain`, `release`, `vibRate`, `vibDepth`, `level` |
| `fm` | FM synth | `ratio`, `index`, `indexDecay`, `ratio2`, `index2`, `attack`, `decay`, `sustain`, `release`, `level` |
| `pluck` | Plucked strings | `brightness`, `decay`, `damping`, `pick`, `body`, `release`, `level` |
| `organ` | Tonewheel organ | `d1`…`d9` (drawbars 16′ … 1′, 0–8), `perc`, `percHarm`, `percDecay`, `vibrato`, `leslie` (0 off, 1 slow, 2 fast), `click`, `level` |
| `modal` | Piano & mallets | `model` (0 grand piano, 1 upright, 2 marimba, 3 vibraphone, 4 kalimba, 5 music box, 6 steel drum, 7 glockenspiel), `brightness`, `decay`, `hardness`, `tremolo`, `release`, `level` |
| `drums` | Drum machine | `kickTune`, `kickDecay`, `kickPunch`, `snareTune`, `snareTone`, `snareDecay`, `tomTune`, `hatDecay`, `hatTone`, `level` |

Drum tracks use General MIDI note numbers: 36 kick, 37 rim, 38 snare, 39 clap, 41/45/48 toms, 42 closed hat, 46 open hat, 49 crash.

## Effect types (`FxSlot.type`)

| Type | Parameters |
| --- | --- |
| `gain` | `gain` (dB) |
| `eq3` | `low`, `mid`, `midFreq`, `high` |
| `drive` | `mode` (0 Soft, 1 Hard, 2 Tube, 3 Fuzz), `drive`, `tone`, `output` (dB), `mix` |
| `cabinet` | `mode` (0 1x12 Filter, 1 4x12 Filter, 2 Vintage IR, 3 Modern IR), `lowCut`, `highCut`, `mix` |
| `delay` | `sync` (0 Free, 1 1/4, 2 1/8, 3 dotted 1/8, 4 1/16, 5 1/4 triplet), `time` (ms), `feedback`, `tone`, `mix` |
| `reverb` | `decay` (s), `predelay` (ms), `tone`, `mix` |
| `chorus` | `rate` (Hz), `depth` (ms), `delay` (ms), `mix` |
| `tremolo` | `shape` (0 Sine, 1 Square, 2 Triangle), `rate` (Hz), `depth` |
| `phaser` | `rate` (Hz), `depth`, `center` (Hz), `resonance`, `mix` |
| `compressor` | `threshold` (dB), `ratio`, `attack` (s), `release` (s), `makeup` (dB) |

Exact ranges and defaults live in `src/synth/defs.ts` and `src/dsp/fx/defs.ts`.

## Loading rules

When a file is loaded it is validated, so a malformed or hand-edited file can never put the engine in an invalid state:

- `format` must be `"openband-project"`. Files with a `version` newer than the app supports are rejected.
- Unknown parameters are dropped, missing ones get their defaults, and out-of-range values are clamped.
- Unknown effect types are skipped. Clips of the wrong kind for their track (e.g. an audio clip on a MIDI track) are dropped.
- Missing ids are regenerated.
