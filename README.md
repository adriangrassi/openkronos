# OpenKronos

An original editor and librarian for the KORG Kronos keyboard, built with Electron, React and TypeScript. It opens and saves `.PCG` files, lets you browse, rename, copy and swap Programs, Combinations, Set Lists, Drum Kits and Wave Sequences, pulls sounds from the keyboard and sends them back over USB MIDI (with a built-in simulated Kronos for working without the hardware), and edits Program, Combination, Global and effect parameters with graphic panels where they help. Nothing is written to a keyboard without an explicit action, and a backup file is written first.

## Run it

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

## Material that is not in this repository

`research/` and `src/generated/` are listed in `.gitignore`. They hold KORG's own MIDI implementation text and Parameter Guide, which are not ours to publish, and the parameter tables generated from them.

- The Parameter Guide (`research/param-guide.txt`) is optional. Without it the app works, and the AI's parameter lookup just returns nothing.
- The generators that run before `npm run build` read KORG's MIDI implementation files from `research/korg-sysex/`. A fresh clone does not have them, so you must supply your own copy of those files to build. They are not distributed here.

## Licence and support

The code is MIT licensed (`LICENSE`); bundled fonts and libraries are listed in `THIRD-PARTY-NOTICES.md`. KORG’s documentation and data are not included and not covered. If OpenKronos helps you, a star on GitHub is welcome: Settings has a button for it.

## Not affiliated

Not affiliated with, endorsed by or sponsored by KORG, Anthropic or OpenAI. KORG and Kronos are trademarks of KORG Inc.; Claude is a trademark of Anthropic; ChatGPT and Codex are trademarks of OpenAI.
