# OpenKronos: spec

An original editor and librarian for the KORG Kronos. It replaces KRONOS Editor 3.1, which crashes on Windows 11 25H2 (stack overflow in a window-message loop, unrelated to MIDI). Owner's keyboard: Kronos 88, OS 3.1.2, family 0x68, member 0x17.

## Goal

Everything KRONOS Editor 3.1 does to edit sounds, in stages: pull from the keyboard over USB, edit, send back; plus `.PCG` files, which the original handled poorly. The keyboard is currently offline, so development runs against real `.PCG` files and a simulated Kronos.

## Stages

1. **Library.** Open and save `.PCG`; browse, rename, copy, swap and move Programs, Combis, Set Lists, Drum Kits, Wave Sequences; pull and push over USB (simulator); backups.
2. **Editing.** Program, Combi, Global and effect parameters, generated from KORG's tables.
3. **Engines.** HD-1, the EXi engines and KARMA, with graphic panels where they earn their place.

## Non-goals

- VST/AU plug-in (owner's decision, 2026-11-08).
- Sampling, song and sequencer editing, until stage 3 is done.
- KORG's code, skin images or documentation text must not be copied into this repo. Facts about the protocol are fine. `research/korg-*` is personal-use material and stays out of git.

## Architecture

- `src/core/`: TypeScript with no dependencies and no DOM or Electron imports. Runs directly under Node 24 (type stripping), so only erasable syntax: no `enum`, no parameter properties, no namespaces. Imports use explicit `.ts` extensions.
- `src/app/`: Electron + React UI (stage 1, later unit). Real MIDI goes through Chromium's Web MIDI, implementing the same `MidiTransport` interface as the simulator.
- Tests: `node:test`, files named `*.test.ts` beside the code.

## Safety rules (these are requirements)

1. Nothing is written to a keyboard without an explicit user action.
2. An Object Dump (0x73) only reaches temporary memory. Store Bank Request (0x76) makes it permanent. `sendObject` must never send 0x76; only `storeBank` does, and the UI must show what will change and write a backup file first.
3. Requests are strictly one at a time: replies carry no request ID.
4. Every request has a timeout and fails with a typed error. A hung or silent keyboard must never hang the app.
5. Saving a `.PCG` never overwrites the file it came from without a backup, and an unmodified save must be byte-identical.

6. Every edited `.PCG` block must have its checksum recalculated. In the 12-byte block header (tag, big-endian size, word), the word's low byte is the 8-bit sum of the block's data. `DIV1` and container blocks don't carry one.
7. Copy and swap refuse mismatched kinds and engine types (EXi vs HD-1). A plain "move" that shifts slots is left out for now: Combis and Set Lists point at programs by slot, so shifting would silently change what they play. Copy and swap warn about this in the UI; updating those references is a stage 2 feature.

8. Editing a parameter must never change a bit outside that parameter. KORG packs values across byte boundaries, so a field is a list of bit ranges, not an offset and a size.

## Protocol source

`research/protocol-notes.md` (our notes, with line references) and `research/korg-sysex/midiimp/MIDI implementation/KRONOS_MIDI_SysEx.txt` (KORG's text, v1.27). Section 7 of the notes lists what KORG leaves unclear: anything built on one of those items gets a `shortcut:` comment naming the assumption, to be confirmed on the real keyboard.
