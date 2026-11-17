# OpenKronos

An original editor and librarian for the KORG Kronos keyboard, built with Electron, React and TypeScript. It opens and saves `.PCG` files, lets you browse, rename, copy and swap Programs, Combinations, Set Lists, Drum Kits and Wave Sequences, pulls sounds from the keyboard and sends them back over USB MIDI (with a built-in simulated Kronos for working without the hardware), and edits Program, Combination, Global and effect parameters with graphic panels where they help. Nothing is written to a keyboard without an explicit action, and a backup file is written first.

## Download (Windows and Mac)

Get the latest build from the [Releases page](https://github.com/adriangrassi/openkronos/releases/latest):

- `OpenKronos-<version>-portable.exe`: nothing to install, just run it.
- `OpenKronos-<version>-Setup.exe`: a normal installer.

The builds are not code-signed, so Windows SmartScreen may say "Windows protected your PC". Choose **More info**, then **Run anyway**. Check the SHA-256 listed on the release page if you want to confirm the file. Mac (Apple Silicon): download the `.dmg` and see the release notes for the one-time "Open Anyway" step. Intel Macs: build from source (below).

## Run it from source

```
npm install
npm run dev       # development window
npm run build     # production build (runs the generators first, see below)
npm start         # run the production build
npm test          # unit tests
```

Needs Node.js 24 or newer.

## AI help (optional)

OpenKronos can explain controls, answer questions about the open sound and make changes you ask for, using the AI plan you already have: Claude, ChatGPT / Codex, or a server of your own. Nothing is sent until you use an AI feature. See [docs/AI-SETUP.md](docs/AI-SETUP.md), or open Settings, then AI connection, inside the app.

Answers can be read aloud, out of the box with your computer's own voices (nothing to set up), or with a speech server of your own or ElevenLabs. See [docs/SPEECH-SETUP.md](docs/SPEECH-SETUP.md).

## KORG documents in this repository

`research/` holds KORG's own documentation, copied here only so the project builds from a fresh clone: the MIDI implementation text tables (`research/korg-sysex/`) and the Parameter Guide text (`research/param-guide.txt`). The build turns them into `src/generated/` (parameter tables and help text), which is built, not committed.

These files are KORG Inc.'s copyright and are not covered by the MIT licence. If KORG or its representatives want them removed, open an issue and they will be taken out. The Kronos factory sound files and the page screenshots are not included.

## Licence and support

The code is MIT licensed (`LICENSE`); bundled fonts and libraries are listed in `THIRD-PARTY-NOTICES.md`. KORG’s documentation is included only for building (see above) and is not covered by this licence. If OpenKronos helps you, a star on GitHub is welcome: Settings has a button for it.

## Not affiliated

Not affiliated with, endorsed by or sponsored by KORG, Anthropic or OpenAI. KORG and Kronos are trademarks of KORG Inc.; Claude is a trademark of Anthropic; ChatGPT and Codex are trademarks of OpenAI.
