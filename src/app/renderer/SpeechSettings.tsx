import { useEffect, useRef, useState } from "react";
import { ELEVEN_MODELS, resolveSpeechProvider, type ElevenModel, type Settings, type SpeechProvider } from "../../core/settings.ts";
import { NO_VOICE_HINT, voicesFor } from "../../core/speechVoice.ts";
import { ELEVENLABS_KEYS_URL } from "../../core/links.ts";
import type { SecretName } from "../../core/secrets.ts";
import type { Voice } from "../main/speech.ts";
import { useSystemVoices } from "./systemVoices.ts";
import { useSpeech } from "./useSpeech.ts";

const MODEL_LABEL: Record<ElevenModel, string> = {
  eleven_multilingual_v2: "Multilingual v2: best quality (default)",
  eleven_flash_v2_5: "Flash v2.5: fastest and cheaper",
  eleven_turbo_v2_5: "Turbo v2.5: older, still works",
};
const hostOf = (u: string): string => { try { return new URL(u).host; } catch { return u; } };
const SAMPLE = { en: "Hello. This is how your answers will sound.", pt: "Olá. Assim vão soar as suas respostas." };

// A write-only key box: the key can be saved or cleared here, and the window is only ever told whether one is stored.
function SecretField({ name, label, id }: { name: SecretName; label: string; id: string }) {
  const [has, setHas] = useState(false);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { void window.kronos.secretsHas(name).then(setHas).catch(() => {}); }, [name]);
  const save = () => {
    setMsg("");
    void window.kronos.secretsSet(name, text.trim()).then((r) => {
      if (r.ok) { setText(""); setHas(true); } else setMsg(r.error);
    }).catch(() => setMsg("The key could not be saved."));
  };
  const clear = () => { void window.kronos.secretsClear(name).then(() => { setHas(false); setMsg(""); }).catch(() => {}); };
  return (
    <div className="settings-row"><span>{label}</span>
      <span className="settings-btns">
        <input data-testid={`${id}-input`} type="password" autoComplete="off" spellCheck={false} aria-label={label} placeholder={has ? "Replace the saved key" : "Paste the key"} value={text} onChange={(e) => setText(e.target.value)} />
        <button data-testid={`${id}-save`} disabled={text.trim() === ""} onClick={save}>Save key</button>
        {has && <button data-testid={`${id}-clear`} onClick={clear}>Clear</button>}
        <span className="settings-hint" data-testid={`${id}-status`} role="status">{msg || (has ? "Key saved" : "No key saved")}</span>
      </span>
    </div>
  );
}

type Props = { s: Settings; set: (patch: Partial<Settings>) => void };

const LANGS = [{ id: "en", label: "English", key: "speechSystemVoiceEn" }, { id: "pt", label: "Portuguese", key: "speechSystemVoicePt" }] as const;

// One voice list per answer language: the installed voices for it, best first, and Automatic (the app picks the best one).
function SystemVoiceRows({ s, set }: Props) {
  const all = useSystemVoices(true);
  return (
    <>
      {LANGS.map((l) => {
        const list = voicesFor(all, l.id);
        const saved = s[l.key];
        return (
          <div key={l.id} className="settings-row"><span>{l.label} voice</span>
            <select data-testid={`settings-speech-system-voice-${l.id}`} aria-label={`${l.label} voice of this computer`} value={saved} onChange={(e) => set({ [l.key]: e.target.value })}>
              <option value="">{all.length > 0 && list.length === 0 ? `No ${l.label} voice installed` : "Automatic"}</option>
              {saved !== "" && !list.some((v) => v.name === saved) && <option value={saved}>{saved} (not installed)</option>}
              {list.map((v) => <option key={v.name} value={v.name}>{v.localService === false ? `${v.name} (online)` : v.name}</option>)}
            </select>
          </div>
        );
      })}
      {all.length > 0 && LANGS.some((l) => voicesFor(all, l.id).length === 0) && <p className="settings-hint" data-testid="settings-speech-system-hint">{NO_VOICE_HINT(voicesFor(all, "en").length === 0 ? "en" : "pt")}.</p>}
    </>
  );
}

type DraftProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur"> & { saved: string; version: unknown; commit: (v: string) => void };
// A text box that saves when it loses focus. Its text is reset to the saved value after every save (a refused entry snaps back) but never while it has focus, or a save that finishes while the user is typing here would wipe what they typed.
function DraftInput({ saved, version, commit, ...rest }: DraftProps) {
  const [text, setText] = useState(saved);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(saved); }, [saved, version]);
  return <input {...rest} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; commit(text); }} />;
}

// The "Speech" part of Settings: where the voice comes from (automatic, this computer, your own server or ElevenLabs), and a Test voice button for the one in use.
export function SpeechSettings({ s, set }: Props) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");
  const [loadOk, setLoadOk] = useState(true);
  const [note, setNote] = useState("");
  const sp = useSpeech("", false);
  useEffect(() => { if (sp.state === "speaking") setNote("It works: the voice is speaking."); }, [sp.state]);

  const load = () => {
    setLoading(true);
    setLoadMsg("");
    void window.kronos.speechVoices()
      .then((r) => {
        setLoadOk(r.ok);
        if (!r.ok) { setLoadMsg(r.error.message); return; }
        setVoices(r.voices);
        setLoadMsg(r.voices.length === 0 ? "No voices in this account yet: add one on elevenlabs.io, or type a voice id." : `${r.voices.length} voices loaded.`);
        window.dispatchEvent(new CustomEvent("kronos-eleven-voices", { detail: r.voices }));
      })
      .catch(() => { setLoadOk(false); setLoadMsg("The voices could not be loaded."); })
      .finally(() => setLoading(false));
  };
  const test = () => { setNote(""); void sp.speak(SAMPLE[sp.s.speechLang]); };
  const testButton = (
    <div className="settings-btns">
      <button data-testid="speech-test" disabled={sp.state === "loading" || sp.state === "speaking"} onClick={test}>{sp.state === "loading" ? "Testing..." : "Test voice"}</button>
      <span className="conn-result" data-ok={sp.state !== "error"} data-testid="speech-test-result" role="status">{sp.state === "error" ? sp.error : note}</span>
    </div>
  );
  const resolved = resolveSpeechProvider(s);
  const choose = (id: SpeechProvider) => <input type="radio" name="speech-provider" data-testid={`settings-speech-provider-${id}`} checked={s.speechProvider === id} onChange={() => set({ speechProvider: id })} />;
  const picked = voices.some((v) => v.id === s.elevenVoice) ? s.elevenVoice : "";

  return (
    <section className="conn" data-testid="speech-section" aria-label="Speech">
      <h3>Speech</h3>
      <p className="settings-hint">Reads AI answers aloud. Pick where the voice comes from.</p>
      <div className="conn-card" data-testid="speech-card-auto" role="group" aria-label="Automatic">
        <div className="conn-head">
          <label className="conn-use">{choose("auto")}<b>Automatic (default: this computer's voices unless you set up a server)</b></label>
        </div>
        <p className="conn-what" data-testid="settings-speech-current">Currently using: {resolved === "system" ? "this computer's voices" : resolved === "server" ? `your server at ${hostOf(s.speechUrl)}` : "ElevenLabs"}</p>
        {s.speechProvider === "auto" && resolved === "system" && <SystemVoiceRows s={s} set={set} />}
      </div>
      <div className="conn-card" data-testid="speech-card-system" role="group" aria-label="This computer's voices">
        <div className="conn-head">
          <label className="conn-use">{choose("system")}<b>This computer's voices</b></label>
        </div>
        <p className="conn-what">The voices installed in Windows or macOS. Free, works offline, and the text never leaves this computer.</p>
        {s.speechProvider === "system" && <SystemVoiceRows s={s} set={set} />}
      </div>
      <div className="conn-card" data-testid="speech-card-server" role="group" aria-label="My own server">
        <div className="conn-head">
          <label className="conn-use">{choose("server")}<b>My own server</b></label>
        </div>
        <p className="conn-what">Any speech server that follows the OpenAI /v1/audio/speech format, on this computer or your network (Kokoro-FastAPI, mlx_audio, VoiceStudio and similar). Free, and the text stays on your network.</p>
        {resolved === "server" && (
          <>
            <div className="settings-row"><span>Server URL</span>
              <DraftInput data-testid="settings-speech-url" aria-label="Speech server URL" saved={s.speechUrl} version={s} commit={(v) => set({ speechUrl: v })} />
            </div>
            <p className="settings-hint">This computer or a machine on your network (default http://localhost:8081).</p>
            <div className="settings-row"><span>Model name</span>
              <DraftInput data-testid="settings-speech-model" aria-label="Speech model name" saved={s.speechModel} version={s} commit={(v) => set({ speechModel: v })} />
            </div>
            <div className="settings-row"><span>Custom voice id</span>
              <DraftInput data-testid="settings-speech-custom-voice" aria-label="Custom voice id" placeholder="Empty: the voice picked in the AI window" saved={s.speechCustomVoice} version={s} commit={(v) => set({ speechCustomVoice: v })} />
            </div>
            <SecretField name="speech-server" label="Server key (optional)" id="speech-key-server" />
            <p className="settings-hint">Only for a server that asks for a bearer key. It is kept in your operating system's secure storage and sent to the server address above.</p>
          </>
        )}
      </div>
      <div className="conn-card" data-testid="speech-card-elevenlabs" role="group" aria-label="ElevenLabs">
        <div className="conn-head">
          <label className="conn-use">{choose("elevenlabs")}<b>ElevenLabs</b></label>
        </div>
        <p className="conn-what">Natural voices from elevenlabs.io, with your own account and API key.</p>
        {s.speechProvider === "elevenlabs" && (
          <>
            <SecretField name="elevenlabs" label="API key" id="speech-key-elevenlabs" />
            <div className="settings-btns">
              <button data-testid="settings-eleven-keys-link" title="Open the ElevenLabs API keys page in your browser" onClick={() => { void window.kronos.openLink(ELEVENLABS_KEYS_URL); }}>Get an API key</button>
              <span className="settings-hint">Create the key with the Text to Speech permission (and read access to voices, for Load my voices).</span>
            </div>
            <div className="settings-row"><span>Model</span>
              <select data-testid="settings-eleven-model" aria-label="ElevenLabs model" value={s.elevenModel} onChange={(e) => set({ elevenModel: ELEVEN_MODELS.find((m) => m === e.target.value) ?? "eleven_multilingual_v2" })}>
                {ELEVEN_MODELS.map((m) => <option key={m} value={m}>{MODEL_LABEL[m]}</option>)}
              </select>
            </div>
            <div className="settings-row"><span>Voice</span>
              <span className="settings-btns">
                <button data-testid="settings-eleven-load" disabled={loading} onClick={load}>{loading ? "Loading..." : "Load my voices"}</button>
                <select data-testid="settings-eleven-voice-select" aria-label="Your ElevenLabs voices" value={picked} disabled={voices.length === 0} onChange={(e) => { if (e.target.value !== "") set({ elevenVoice: e.target.value }); }}>
                  <option value="">{voices.length === 0 ? "Press Load my voices" : "Choose a voice"}</option>
                  {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </span>
            </div>
            {loadMsg !== "" && <p className="conn-result" data-ok={loadOk} data-testid="settings-eleven-load-result" role="status">{loadMsg}</p>}
            <div className="settings-row"><span>Voice id</span>
              <DraftInput data-testid="settings-eleven-voice" aria-label="ElevenLabs voice id" placeholder="Or paste a voice id" saved={s.elevenVoice} version={s} commit={(v) => set({ elevenVoice: v })} />
            </div>
            <p className="settings-hint" data-testid="speech-eleven-privacy">Privacy: the text of the answer is sent to ElevenLabs when you press Speak, and usage counts against your ElevenLabs plan. Your key stays in your operating system's secure storage and is never shown again.</p>
          </>
        )}
      </div>
      {testButton}
      <div className="settings-row"><span>Speech speed</span>
        <span className="settings-btns">
          <input data-testid="settings-speech-speed" type="range" min={0.8} max={1.2} step={0.05} aria-label="Speech speed" value={s.speechSpeed} onChange={(e) => set({ speechSpeed: Number(e.target.value) })} />
          <span>{s.speechSpeed.toFixed(2)}x</span>
        </span>
      </div>
    </section>
  );
}
