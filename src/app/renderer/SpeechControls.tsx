// The AI window's speech row: answer language and voice, answer length, speed, auto-speak and the Speak / Stop button for the finished answer.
import { resolveSpeechProvider, type AiLength } from "../../core/settings.ts";
import { voicesFor } from "../../core/speechVoice.ts";
import { useSystemVoices } from "./systemVoices.ts";
import { useElevenVoices, useSpeech, VOICES, type SpeechHooks } from "./useSpeech.ts";

const LENGTHS: { id: AiLength; label: string }[] = [{ id: "brief", label: "Very brief" }, { id: "normal", label: "Normal" }, { id: "detailed", label: "Detailed" }];

function Icon({ state }: { state: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      {state === "speaking" ? <rect x="3" y="3" width="10" height="10" rx="1" /> : state === "loading" ? <><circle cx="3" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="13" cy="8" r="1.5" /></> : <><path d="M2 6h3l4-3v10l-4-3H2z" /><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />{state === "error" && <circle cx="13.5" cy="13" r="2" />}</>}
    </svg>
  );
}

export function SpeechControls({ answer, busy, hooks }: { answer: string; busy: boolean; hooks: SpeechHooks }) {
  const { s, state, error, speak, stop } = useSpeech(answer, busy, hooks);
  const resolved = resolveSpeechProvider(s);
  const eleven = resolved === "elevenlabs";
  const system = resolved === "system";
  const elevenVoices = useElevenVoices(eleven);
  const sysVoices = useSystemVoices(system);
  const sysKey = s.speechLang === "pt" ? "speechSystemVoicePt" : "speechSystemVoiceEn";
  const sysList = voicesFor(sysVoices, s.speechLang);
  const set = (patch: object) => { void window.kronos.settingsSet(patch).then((r) => window.dispatchEvent(new CustomEvent("kronos-settings", { detail: r }))); };
  const active = state === "speaking" || state === "loading";
  const title = state === "error" ? error : active ? "Stop speaking" : answer ? "Speak answer" : "Nothing to speak yet";
  return (
    <div className="ai-speech" data-testid="ai-speech">
      <select data-testid="ai-speech-lang" aria-label="Answer language" value={s.speechLang} onChange={(e) => { const l = e.target.value === "pt" ? "pt" : "en"; set(eleven || system ? { speechLang: l } : { speechLang: l, speechVoice: VOICES[l][0].id }); }}>
        <option value="en">English</option>
        <option value="pt">Português (Brasil)</option>
      </select>
      {system ? (
        <select data-testid="ai-speech-voice" aria-label="Voice" value={s[sysKey]} onChange={(e) => set({ [sysKey]: e.target.value })}>
          <option value="">Automatic</option>
          {s[sysKey] !== "" && !sysList.some((v) => v.name === s[sysKey]) && <option value={s[sysKey]}>{s[sysKey]}</option>}
          {sysList.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
        </select>
      ) : eleven ? (
        <select data-testid="ai-speech-voice" aria-label="Voice" value={s.elevenVoice} onChange={(e) => set({ elevenVoice: e.target.value })}>
          {s.elevenVoice === "" && <option value="">Choose in Settings</option>}
          {s.elevenVoice !== "" && !elevenVoices.some((v) => v.id === s.elevenVoice) && <option value={s.elevenVoice}>{s.elevenVoice}</option>}
          {elevenVoices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      ) : s.speechCustomVoice !== "" ? (
        <select data-testid="ai-speech-voice" aria-label="Voice" title="A custom voice id is set in Settings, Speech" value={s.speechCustomVoice} disabled>
          <option value={s.speechCustomVoice}>{s.speechCustomVoice}</option>
        </select>
      ) : (
        <select data-testid="ai-speech-voice" aria-label="Voice" value={s.speechVoice} onChange={(e) => set({ speechVoice: e.target.value })}>
          {VOICES[s.speechLang].map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      )}
      <select data-testid="ai-length" aria-label="Answer length" value={s.aiLength} onChange={(e) => set({ aiLength: e.target.value })}>
        {LENGTHS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
      <label className="check" title="Speech speed">
        Speed
        <input data-testid="ai-speech-speed" type="range" aria-label="Speech speed" min={0.8} max={1.2} step={0.05} value={s.speechSpeed} onChange={(e) => set({ speechSpeed: Number(e.target.value) })} />
      </label>
      <label className="check">
        <input data-testid="ai-speech-auto" type="checkbox" checked={s.speechAuto} onChange={(e) => set({ speechAuto: e.target.checked })} />
        Speak answers automatically
      </label>
      <button data-testid="ai-speak" data-state={state} aria-label={active ? "Stop speaking" : "Speak answer"} title={title} disabled={!active && (busy || answer === "")} onClick={() => (active ? stop() : void speak(answer))}>
        <Icon state={state} />
      </button>
      {state === "error" && <span className="status" data-testid="ai-speech-error">{error}</span>}
    </div>
  );
}
