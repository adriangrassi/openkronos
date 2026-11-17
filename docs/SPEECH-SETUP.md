# Read AI answers aloud

OpenKronos can read an AI answer aloud. **Out of the box OpenKronos speaks with your computer's own voices: nothing to set up.** No account, no key, no server and no network: the text stays on your computer.

If you want a different voice, you choose where it comes from in Settings, Speech:

- **Automatic** (the default): this computer's voices, unless you have set up a server address, in which case OpenKronos uses that server. Settings says which one it is using right now.
- **This computer's voices**: always the voices installed in your operating system.
- **My own server**: a speech server that you run on your computer or your network. Free, and the text never leaves your network.
- **ElevenLabs**: natural voices from elevenlabs.io, using your own ElevenLabs account and API key.

Nothing is spoken until you press the speaker button in the AI window (or turn on "Speak answers automatically"). Speech never touches the sound, the keyboard or the AI run.

## This computer's voices

OpenKronos uses the speech voices your operating system already has, through the same speech engine as the browser. Nothing is sent anywhere.

- **Windows**: the Microsoft voices installed under Settings > Time & language > Speech. To add one (for example Portuguese), choose Add voices there.
- **macOS**: the voices under System Settings > Accessibility > Spoken Content > System Voice > Manage Voices.
- **Linux**: needs speech-dispatcher and a voice installed (for example `sudo apt install speech-dispatcher espeak-ng`). Without it OpenKronos says that no voices are available.

OpenKronos picks the voice by the answer language: for English a United States voice, then British, then any English one; for Portuguese a Brazilian voice, then European, then any Portuguese one. It prefers a voice that is installed on this computer over an online one that sends text to the internet, and, among the installed voices, one marked Natural or Neural. In Settings, Speech you can pick a voice for each language instead of Automatic. A voice is never used for the other language: if the computer has no voice for the answer language you see "No English voice is installed on this computer" (or Portuguese) with where to add one.

If you pick ElevenLabs but have no key saved, OpenKronos tells you to add the key; it does not quietly switch to another voice.

Press **Test voice** in Settings to hear the voice that is in use, whichever source you chose. Speed (0.8 to 1.2) is the same slider as in the AI window.

## My own server

OpenKronos sends one request per sentence group to `POST /v1/audio/speech` (the OpenAI speech format) and plays the WAV it gets back. Servers known to fit: Kokoro-FastAPI, mlx_audio, VoiceStudio, and any other server that follows that format.

1. Start your speech server and note its address, for example `http://localhost:8081`.
2. Open Settings, Speech, and choose **My own server**.
3. Enter the **Server URL**. OpenKronos accepts it only when it is `http` or `https`, has no user name or password in it, and the host is one of: `localhost` or `[::1]`; an address starting 127., 10., 192.168., 172.16 to 172.31, or 100.64 to 100.127 (a tailnet); a plain name with no dots such as `mybox`; or a name ending in `.local`, `.lan` or `.ts.net`. Addresses on the open internet are refused, because the answer text and the key go there. (This also means OpenAI's own address cannot be typed here; use a local gateway in front of it if you want that.)
4. **Model name**: the default is `mlx-community/Kokoro-82M-bf16`. Change it to whatever your server expects (for example `tts-1` or `kokoro`).
5. **Voice**: pick a voice in the AI window, or type a **Custom voice id** (letters, digits, `.`, `_`, `:`, `-`; up to 64 characters). While a custom voice id is set it is used for every answer.
6. **Server key (optional)**: only if your server asks for a bearer key. See "Where the keys are kept" below.
7. Press **Test voice**. It speaks one short sentence in the answer language and shows the error if it fails.

The built-in voice list (Heart, Bella, Adam; Dora, Alex, Santa) is for Kokoro servers. OpenKronos sends Kokoro's `lang_code` (a, b or p) only with those voices, not with a custom voice id.

## ElevenLabs

1. Create an account at https://elevenlabs.io.
2. Open https://elevenlabs.io/app/settings/api-keys (Settings has a **Get an API key** button) and create a key. Give it the **Text to Speech** permission, and the permission to read voices if the key page lists one (needed for Load my voices; without it you can still paste a voice id). You can also set a monthly credit limit on the key.
3. In OpenKronos, open Settings, Speech, choose **ElevenLabs**, paste the key and press **Save key**. It says "Key saved". The box is write-only: OpenKronos never shows the key again. **Clear** removes it.
4. Press **Load my voices**. Pick one in the list, or paste a voice id into **Voice id**.
5. Choose a **Model**: Multilingual v2 (the default, best quality), Flash v2.5 (fastest and cheaper) or Turbo v2.5 (older). All three speak English and Portuguese. OpenKronos sends the answer language to the Flash and Turbo models; Multilingual v2 detects it from the text.
6. Press **Test voice**.

Speed (0.8 to 1.2) is the same slider as in the AI window. At normal speed OpenKronos sends no voice settings, so the voice keeps the settings you saved on elevenlabs.io.

### What it costs, and privacy

- Each spoken answer uses characters on your ElevenLabs plan; your plan's quota and the key's own limit apply. OpenKronos adds no fee.
- The text of the answer is sent to ElevenLabs when you press Speak, and only then. Nothing else is sent: not the sound, not your question, not your files. ElevenLabs' own privacy terms apply to that text.
- The address is fixed in the program (`https://api.elevenlabs.io`). It cannot be changed in Settings.

## Where the keys are kept

Keys are not part of `settings.json`. OpenKronos encrypts them with the operating system's secure storage (Windows DPAPI, the macOS Keychain, or the Linux keyring) and writes them to `secrets.bin` in the OpenKronos data folder. Only the part of OpenKronos that talks to the speech service can read them; the window can save a key, clear it, or ask whether one exists, and nothing else. Keys are never written to a log, the saved answers, the run log, the usage log or an AI prompt, and error messages never contain them.

If the operating system has no secure storage (for example a Linux desktop without a keyring), OpenKronos refuses to save a key and tells you. It never falls back to a plain text file.

## If something goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| No English voice is installed on this computer | Your system has no voice for the answer language | Add one in Windows Settings > Time & language > Speech, or in macOS System Settings > Accessibility > Spoken Content. |
| This computer has no speech voices OpenKronos can use | No speech engine at all (typical on Linux) | Install speech-dispatcher and a voice, or pick a server or ElevenLabs. |
| Add your ElevenLabs API key | No key is saved | Paste the key in Settings, Speech and press Save key. |
| ElevenLabs did not accept the API key | The key is wrong, deleted, or lacks the Text to Speech permission | Create a new key (see the steps above) and save it again. |
| ElevenLabs quota used up: check your plan | Your plan or the key's limit has no characters left | Wait for the reset, raise the limit, or pick another provider. |
| ElevenLabs is busy | Too many requests at once for your plan | Try again in a moment. |
| Pick an ElevenLabs voice | No voice is chosen | Press Load my voices and pick one, or paste a voice id. |
| ElevenLabs is not reachable | No internet, or a firewall blocks api.elevenlabs.io | Check the connection. |
| The speech server is not reachable | Your server is off, asleep or on another address | Start it, and check the Server URL. |
| The speech server refused: ... | The server rejected the model or the voice | Check the Model name and the Custom voice id against your server's list. |
| The key was not saved: no secure storage | The operating system cannot protect a key | Use a desktop session with a keyring (Linux), or use a server without a key. |
| Short gaps between sentences with ElevenLabs | Each piece arrives as its own MP3 file | Normal. Flash v2.5 keeps the gaps shortest. |

## Before you rely on it

ElevenLabs' terms, voice-licensing rules and prices are theirs and can change. Read them at https://elevenlabs.io/terms before you use a voice for anything beyond your own reading. Some voices in the public library may need a paid plan.
