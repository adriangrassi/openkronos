# OpenKronos: complete backup, keyboard-style editing, Simple mode, AI sound design

Extends SPEC.md, whose safety rules still apply. Written 2026-11-08 from the owner's request. Each stage ships on its own and has a test that proves it.

## Build order

| # | Stage | Depends on |
|---|---|---|
| A | Complete backup | The bank pull now being built |
| B | Keyboard-style pages and graphs, beside the current List view | The page map |
| C | Simple mode and the split builder | B's graphs |
| D | AI sound design, text first | C's split builder |
| E | AI sampling | D, and a test of KORG's sample file formats |

## A. Complete backup

"Complete" means everything the keyboard can send, in one action, with a report of anything it could not.

| Data | How it travels | Saved as |
|---|---|---|
| Programs, Combis, Drum Kits, Wave Sequences | Object dumps 00, 01, 04, 05 | `.PCG` |
| Set Lists | Object 0D | `.PCG` (`SBK1` and `SDB1`) |
| Global | Object 03 | `.PCG` (`GLB1`) |
| KARMA GEs, Templates | Objects 06, 07 | Raw objects in the backup folder |
| Drum Track Patterns, Songs | Objects 0E, 0F, 18 | Raw objects in the backup folder |
| Samples and multisamples | **Not available over USB** | Disk mode on the keyboard; the app says so in its report |

A backup is a folder: `Kronos Backup <date>/` holding the `.PCG`, `manifest.json` (OS version, every bank, sizes, SHA-256) and `objects/`. The app can restore the raw objects itself.

Known facts:
- `DIV1` is not unknown data. It is 22 big-endian words listing which banks a file holds, as mask/version pairs: 2 reserved words; programs (2 pairs, version 0x15; bit 0..4 = INT-A..E, 5 = INT-F, 6+n = user bank n); combis (2 pairs, 0x0E); drum kits (2 pairs, 0x0F; bit 0 = INT, 1+n = user n); wave sequences (2 pairs, 0x0F, same bits); set lists (mask/version 1/1 when present, 0/0 when absent); `FFFF 0000`.
- `SDB1` entry is 28 + 128 x 28 bytes: the set name, 4 unknown bytes, then per slot a 24-byte name and 4 unknown bytes. Decode those from the factory file before writing one.
- Combi user bank bits in `DIV1` have no factory sample. Mark as an assumption until tested.

Proof: rebuilt `DIV1` equals KORG's bytes for the factory files; a backup pulled from the simulator restores byte-identically; the Kronos itself loads a saved `.PCG` (owner test, after a Disk mode Save All to a USB drive, because loading replaces what is in memory).

## B. Two editors, same data

A switch in the editor chooses **Keyboard** or **List**. Both call `writeParam`, share undo and update each other live. List stays as built.

**Keyboard view** follows the instrument: same mode pages, tabs, page names, order, control groupings and control types, so hands and memory transfer. It is redrawn from scratch. SPEC.md bars KORG's skin images from this project, so the 1,088 PNGs in the old editor's folder are not used. Layout facts come from KORG's manuals.

The page map is data, not code: page > tab > control > parameter. A test requires every editable parameter to appear on some page; anything without a home lands on a visible "More" tab.

**Graphs**, drawn live in SVG, draggable where the value maps directly, committing on release as one undo step:
- Amp, Filter and Pitch envelopes
- LFO shapes
- Key track and velocity curves
- Filter response
- Vector envelope
- Drum Kit note map with zones and velocity layers
- Wave Sequence step timeline
- Combi keyboard map: every timbre's key window and velocity window on one keyboard

Graphs show shape, not measured audio. Envelope times are unit-less on the keyboard, so the time axis is relative and labelled so.

## C. Simple mode

A third view for quick changes. About eight macros per sound: Brightness, Attack, Release, Body, Drive, Movement, Space, Width. Each macro is a data table per engine (HD-1 and each EXi): the parameters it moves and how far. Macros move values relative to where the sound already is, clamp to each parameter's range, and show which real parameters changed.

**Split builder:** pick Programs, drag zones on a keyboard picture, set velocity ranges and volumes; it writes the Combi's Timbre program, key window, velocity window, MIDI channel and status. Stage D uses this same code.

## D. AI sound design

Example request: "the synth sound from Jump by Van Halen, bass on the left hand, brass stabs on the right."

All of this runs in the app on the PC: understanding the request, analysing audio, choosing sounds and editing parameters. The keyboard is only involved when the owner sends the finished sound to it.

1. **Plan.** The model turns the request into a plan: parts, role, key range, character, likely engine.
2. **Start from something close.** For each part, search the owner's library by name, category, engine and parameter values. Editing a near match beats building from nothing.
3. **Edit through a tool API only.** Tools read and set named parameters and timbres and call the split builder. There is no raw byte access; every write goes through `writeParam`, is range-checked and is logged. A sound's settings are described to the model from the parameter tables.
4. **Result.** A new Combi and Programs in slots that Used By shows are free, listed for approval as one undoable step. It never overwrites an occupied slot without asking.
5. **Audition.** Sending to the keyboard's temporary memory happens only on the owner's click. AI mode never calls Store.
6. **Refine in words**, or by measurement if capture is set up.

Limits to state in the UI:
- The model cannot hear the result. Kronos engines exist only on the keyboard, so the PC cannot render a sound it has built. Without capture, it works from descriptions and the owner's ears close the loop.
- The Kronos sends no audio over USB. Measured comparison needs its outputs recorded through an audio interface.
- Effect types and per-effect settings stay out of its reach until KORG's effect tables are confirmed against the real keyboard. KORG's published tables did not fit the factory data. It can keep the effects of the sound it starts from.

Provider is pluggable: the user's own Claude or ChatGPT/Codex plan through its command-line tool, or an OpenAI-compatible server they run themselves.

## E. AI sampling

Everything happens on the PC, from audio the owner supplies: splitting stems, finding and trimming samples, mapping them across the keyboard and building the Program. The Kronos's own Sampling mode is not used. The app does not download from streaming services. Samples from a commercial recording are for private use; releasing them needs clearance, and the app says so once.

Flow: split stems locally, find usable one-shots, trim and normalise, map them to key ranges, and write the sample files and the Program to a USB drive. KORG's USB protocol has no sample transfer, so the one step on the keyboard is loading that drive in Disk mode.

Open question: KORG's documents here do not describe the KSF and KMP formats, and the factory download has no KSF or KMP files to study. The owner saving one small multisample to a USB drive in Disk mode gives a real example. The format is proven when the keyboard loads a generated file. The Kronos also loads plain WAV and AIFF, but those carry no key mapping, so they do not replace KMP for this stage.

## Baseline test: Jump

The factory set has U-AA 078 "Jump" (AL-1) and U-BB 107 "Jump Krossed Lead".

1. Hide both from the library search so the AI cannot copy them.
2. Ask for the sound by song name, with a left-hand and right-hand split.
3. Score against the hidden reference: engine choice, oscillator setup, filter, envelope shape, split points. Record the scores; set pass marks after the first run.
4. The real judge is the owner in a blind A/B on the keyboard.

## Needed from the owner

- Whether USB pulls work on the real keyboard.
- Photos of any page where the manual and the keyboard disagree.
- Which audio interface the Kronos can be recorded through, if measured comparison is wanted.
