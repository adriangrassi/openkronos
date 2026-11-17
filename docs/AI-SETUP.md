# Connect an AI to OpenKronos

OpenKronos can use an AI to explain controls, answer questions about the open sound and make changes you ask for. It does not come with an AI and it does not sell you one. You connect the AI plan you already have.

## What the AI features are

- **Ask**: type a question about the open sound, such as "why is this sound so bright?". The answer appears in the AI window.
- **Refine**: describe a change in words ("make it warmer, slower attack"). The AI changes the sound, and you press Keep or Discard.
- **Shift-click explain**: hold Shift and click any control. You get a short built-in explanation at once, and an AI explanation when an AI is connected. See Settings, AI connection.
- **Speech**: an answer can be read aloud by a speech server on your own network or by ElevenLabs (Settings, Speech; see SPEECH-SETUP.md). Only the answer text goes to the voice you chose.
- **Saved answers**: an answer the AI already gave is kept on this computer and shown instantly the next time you ask the same thing.

Nothing in OpenKronos needs the AI. Without a connection, everything else works as before.

## The three ways to connect

- **Claude (your Claude plan).** OpenKronos uses the Claude Code app on your computer, signed in with your Claude plan.
- **ChatGPT / Codex (your ChatGPT plan).** OpenKronos uses the Codex app on your computer, signed in with your ChatGPT plan.
- **Local server (advanced).** An AI server you run yourself, on your computer or your home network.

You only need one. You sign in once, in a terminal. OpenKronos never asks for your password and never sees your sign-in.

## Set up Claude

Works the same on Windows, macOS and Linux.

1. Install Claude Code. In a terminal, run the line for your system.
2. Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex`
3. macOS or Linux: `curl -fsSL https://claude.ai/install.sh | bash`
4. Or, if you use npm (Node.js 22 or newer): `npm install -g @anthropic-ai/claude-code`
5. Open a new terminal and type `claude`. Follow the browser window to sign in with your Claude account. If it asks, type `/login`. Then close it.
6. Open OpenKronos. Open Settings, then AI connection.
7. On the Claude card press **Check**. When it says Ready, press **Test connection** to try one tiny question, then choose **Use this one**.
8. Pick a model on the card. Sonnet is the default. Haiku is the lightest on your limits. Opus is the strongest and uses your limits fastest.

Claude Code needs a paid Claude plan (Pro, Max, Team or Enterprise). The free Claude plan does not include it. Official instructions: https://code.claude.com/docs/en/setup

## Set up ChatGPT / Codex

1. Install Codex. With npm: `npm install -g @openai/codex`. On macOS or Linux you can also run `curl -fsSL https://chatgpt.com/codex/install.sh | sh`.
2. Open a new terminal and run `codex login`. Choose to sign in with ChatGPT and follow the browser window.
3. Open OpenKronos, Settings, AI connection. On the ChatGPT / Codex card press **Check**, then **Test connection**, then **Use this one**.

Which ChatGPT plans include Codex is decided by OpenAI and can change. Check their site. Official instructions: https://developers.openai.com/codex/cli

## What it costs

OpenKronos adds no fees and keeps no account of its own. Each question is one request on your own plan, so it counts against that plan's usage limits, the same as using Claude or ChatGPT directly. If you run out, wait for the limit to reset or switch to another card. Haiku (Claude) uses the least of your limits.

## Privacy

- Nothing is sent anywhere until you use an AI feature.
- What is sent: your question, and the open sound's parameter data when you ask about a sound. It goes to the company whose card you chose (Anthropic or OpenAI), through their app on your computer. Their own privacy terms apply to it.
- Never sent: your password or sign-in. OpenKronos does not read, store or log it. The sign-in stays inside Claude Code or Codex.
- Saved answers stay on this computer. To forget them, open Settings and press **Clear saved answers**.
- The Local server option sends text only to the machine you point it at.

## If something goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| Not installed | OpenKronos cannot find `claude` or `codex` | Install it (steps above), then open a new terminal and run `claude --version` to prove it works. Restart OpenKronos. |
| Not signed in | The app is installed but not signed in | In a terminal run `claude` and then `/login` (or `codex login`). Press Check again. |
| Plan limit reached | You used your plan's allowance, or the plan does not include it | Wait for the limit to reset, choose Haiku, or use another card. |
| Did not answer in time | No answer within 2 minutes | Try again, ask something shorter, or choose a faster model. |
| Could not read the answer | The app answered in an unexpected form | Try again. If it keeps happening, update the app: `claude update`. |
| Installed, sign-in not known | An older version cannot report its sign-in | Press Test connection. If it works, you are fine. Otherwise run `claude update`. |
| Firewall or proxy | The app cannot reach the internet from inside OpenKronos | Make sure `claude` works in a terminal on the same network. OpenKronos passes on your proxy settings (HTTP_PROXY, HTTPS_PROXY, NO_PROXY) and the certificate file named by NODE_EXTRA_CA_CERTS or SSL_CERT_FILE. If your network inspects HTTPS, point one of those at your company's certificate file. |
| Windows: `claude` found in a terminal but not in OpenKronos | The program folder is not on the PATH OpenKronos started with | Sign out of Windows and back in, or start OpenKronos from a new terminal. The native installer puts it in the `.local\bin` folder of your user folder. |
| `claude` found but old | A version too old for OpenKronos's options | Run `claude update`, or install again with the steps above. |

## The local server option (advanced)

Use this only if you run an AI server that speaks the OpenAI chat format.

1. Set the environment variable `AUTOROUTER_KEY` to the server's key before you start OpenKronos. Windows (PowerShell): `$env:AUTOROUTER_KEY = "your-key"`. macOS or Linux: `export AUTOROUTER_KEY=your-key`.
2. Start OpenKronos from that same terminal.
3. In Settings, AI connection, enter the server's address and the model name on the Local server card.
4. Press **Check**, then **Use this one**.

The key is never saved by OpenKronos, in settings or anywhere else. The address must be this computer or a machine on your local network or tailnet, because the key is sent to it. Addresses on the open internet are refused.

## Where to read more

- Shift-click explain: hold Shift and click a control. OpenKronos shows its built-in explanation first. The AI adds more when it is connected.
- Speech: Settings, Speech. Your own server on your network, or ElevenLabs; see SPEECH-SETUP.md.
- Saved answers: shown instantly and kept on this computer. Clear them in Settings.
