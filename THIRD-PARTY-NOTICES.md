# Third-party notices

OpenKronos's own code is MIT licensed (see `LICENSE`). It ships or bundles the following.

## Code that ends up inside the app

| Package | Version | Licence |
|---|---|---|
| Electron (includes Chromium and Node.js, each with their own licences, shown in Electron's `LICENSES.chromium.html` in a packaged build) | 45.2.3 | MIT |
| React | 19.3.1 | MIT |
| React DOM | 19.3.1 | MIT |
| scheduler (part of React DOM) | 0.28.0 | MIT |

## Fonts

Bundled under `src/app/renderer/fonts/`, all under the SIL Open Font License 1.1. The full text and each copyright line are in `src/app/renderer/fonts/OFL.txt`: IBM Plex Sans, IBM Plex Sans Condensed, IBM Plex Mono, Doto, Archivo and JetBrains Mono.

## Build and test tools (not shipped)

TypeScript, Vite, electron-vite, @vitejs/plugin-react and the @types packages are used to build the app, and playwright-core drives the window tests. They are not part of the built app. Their licences are in `package-lock.json` and in their own packages.

## Trademarks

KORG and Kronos are trademarks of KORG Inc. Claude is a trademark of Anthropic. ChatGPT and Codex are trademarks of OpenAI. This project is not affiliated with, endorsed by or sponsored by any of them.
