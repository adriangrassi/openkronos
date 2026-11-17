// Speaks an AI answer through the main process (window.kronos.speechSynthesize) and Web Audio, or, for the computer's own voices, through speechSynthesis in this window. Web Audio needs no media-src in the CSP.
// Chunks are fetched one request at a time, each scheduled right after the one before, so playback has no gaps. Speech never touches the AI run, undo, Live or MIDI.
import { useCallback, useEffect, useRef, useState } from "react";
import { activeVoice, DEFAULT_SETTINGS, resolveSpeechProvider, type Settings } from "../../core/settings.ts";
import { NO_VOICE_HINT, pickSystemVoice } from "../../core/speechVoice.ts";
import { hasSystemSpeech, loadSystemVoices } from "./systemVoices.ts";
import type { Voice } from "../main/speech.ts";
import { looksEnglish, looksPortuguese, stripMarkdown, toSpeech, TRANSLATE_SYSTEM, type SpeechLang } from "../../core/ai/speakText.ts";

export type SpeechState = "idle" | "loading" | "speaking" | "error";

export const VOICES: Record<"en" | "pt", { id: string; label: string }[]> = {
  en: [{ id: "af_heart", label: "Heart" }, { id: "af_bella", label: "Bella" }, { id: "am_adam", label: "Adam" }],
  pt: [{ id: "pf_dora", label: "Dora" }, { id: "pm_alex", label: "Alex" }, { id: "pm_santa", label: "Santa" }],
};

export type SpeechHooks = { translate: (text: string, lang: SpeechLang) => Promise<string>; replace: (text: string, lang: SpeechLang) => void; soundName: () => string };
const NO_TRANSLATION: Record<SpeechLang, string> = { pt: "A resposta está em inglês e não foi possível traduzir (IA indisponível)", en: "The answer is in Portuguese and could not be translated (AI unavailable)" };
// The voices of the saved ElevenLabs key. The Settings button that loads them also broadcasts the list, so an open AI window updates at once.
export function useElevenVoices(active: boolean): Voice[] {
  const [voices, setVoices] = useState<Voice[]>([]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void window.kronos.speechVoices().then((r) => { if (live && r.ok) setVoices(r.voices); }).catch(() => {});
    const on = (e: Event) => setVoices((e as CustomEvent<Voice[]>).detail);
    window.addEventListener("kronos-eleven-voices", on);
    return () => { live = false; window.removeEventListener("kronos-eleven-voices", on); };
  }, [active]);
  return voices;
}

const NO_SYSTEM_SPEECH = "This computer has no speech voices OpenKronos can use. On Linux, install speech-dispatcher; on Windows or macOS add a voice in the system speech settings.";
// Chromium cuts a long utterance short on some platforms.
const SYSTEM_CHUNK = 200;
const cancelSystem = (): void => { try { if (hasSystemSpeech()) window.speechSynthesis.cancel(); } catch { /* no speech engine */ } };
const UNREACHABLE = "The speech server is not reachable (is it running, or is that computer asleep?)";

export function useSpeech(answer: string, busy: boolean, hooks?: SpeechHooks) {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [state, setState] = useState<SpeechState>("idle");
  const [error, setError] = useState("");
  const gen = useRef(0);
  const ctx = useRef<AudioContext | null>(null);
  const playing = useRef<AudioBufferSourceNode[]>([]);
  // Chromium may collect an utterance that nothing references while it is still speaking, which silences it and drops its onend.
  const utterances = useRef<SpeechSynthesisUtterance[]>([]);
  const spokenFor = useRef("");
  const sRef = useRef(s);
  sRef.current = s;
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  useEffect(() => {
    void window.kronos.settingsGet().then(setS).catch(() => {});
    const on = (e: Event) => setS((e as CustomEvent<Settings>).detail);
    window.addEventListener("kronos-settings", on);
    return () => window.removeEventListener("kronos-settings", on);
  }, []);

  const stop = useCallback((next: SpeechState = "idle") => {
    gen.current++;
    void window.kronos.speechCancel().catch(() => {});
    for (const n of playing.current) { try { n.stop(); } catch { /* already ended */ } }
    playing.current = [];
    utterances.current = [];
    cancelSystem();
    setState(next);
  }, []);

  const speak = useCallback(async (text: string) => {
    stop();
    const my = gen.current;
    // Read the saved settings now: a field in Settings saves when it loses focus, which is the same moment as a click on Test.
    const cfg = await window.kronos.settingsGet().catch(() => sRef.current);
    if (my !== gen.current) return;
    if (toSpeech(text, cfg.speechLang, hooksRef.current?.soundName()).length === 0) return;
    setError("");
    setState("loading");
    const provider = resolveSpeechProvider(cfg);
    try {
      // A voice reading the other language's text sounds foreign, so a clear mismatch is translated first (one model call, only then).
      const ok = cfg.speechLang === "pt" ? looksPortuguese : looksEnglish;
      if (!ok(stripMarkdown(text))) {
        let tr = "";
        try { tr = (await hooksRef.current?.translate(text, cfg.speechLang) ?? "").trim(); } catch { /* handled below */ }
        if (my !== gen.current) return;
        if (!tr) { setError(NO_TRANSLATION[cfg.speechLang]); stop("error"); return; }
        text = tr;
        spokenFor.current = tr;
        hooksRef.current?.replace(tr, cfg.speechLang);
      }
      const chunks = toSpeech(text, cfg.speechLang, hooksRef.current?.soundName(), provider === "system" ? SYSTEM_CHUNK : undefined);
      if (chunks.length === 0) { stop(); return; }
      if (provider === "system") {
        if (!hasSystemSpeech()) throw new Error(NO_SYSTEM_SPEECH);
        const voices = await loadSystemVoices();
        if (my !== gen.current) return;
        if (voices.length === 0) throw new Error(NO_SYSTEM_SPEECH);
        const voice = pickSystemVoice(voices, cfg.speechLang, cfg.speechLang === "pt" ? cfg.speechSystemVoicePt : cfg.speechSystemVoiceEn);
        if (!voice) throw new Error(NO_VOICE_HINT(cfg.speechLang));
        const next = (i: number): void => {
          const u = new SpeechSynthesisUtterance(chunks[i]);
          u.voice = voice; u.lang = voice.lang; u.rate = cfg.speechSpeed;
          u.onstart = () => { if (my === gen.current && i === 0) setState("speaking"); };
          u.onend = () => { if (my !== gen.current) return; if (i + 1 < chunks.length) next(i + 1); else { utterances.current = []; setState("idle"); } };
          u.onerror = (e) => { if (my !== gen.current || e.error === "canceled" || e.error === "interrupted") return; setError(`The computer's voice could not speak this (${e.error})`); stop("error"); };
          utterances.current.push(u);
          window.speechSynthesis.speak(u);
        };
        next(0);
        return;
      }
      if (cfg.speechProvider === "elevenlabs" && cfg.elevenVoice === "") throw { kind: "no-voice", message: "Pick an ElevenLabs voice in Settings, Speech (press Load my voices)." };
      const ac = (ctx.current ??= new AudioContext());
      await ac.resume();
      let at = ac.currentTime + 0.05;
      for (let i = 0; i < chunks.length; i++) {
        const r = await window.kronos.speechSynthesize({ text: chunks[i], lang: cfg.speechLang, voice: activeVoice(cfg), speed: cfg.speechSpeed });
        if (my !== gen.current) return;
        if (!r.ok) throw r.error;
        const buf = await ac.decodeAudioData(r.bytes.slice().buffer);
        if (my !== gen.current) return;
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.connect(ac.destination);
        at = Math.max(at, ac.currentTime);
        src.start(at);
        at += buf.duration;
        playing.current.push(src);
        if (i === chunks.length - 1) src.onended = () => { if (my === gen.current) { playing.current = []; setState("idle"); } };
        if (i === 0) setState("speaking");
      }
    } catch (e) {
      if (my !== gen.current) return;
      const k = (e as { kind?: string }).kind;
      const msg = (e as Error).message ?? String(e);
      // ElevenLabs messages come from the main process already worded for the user.
      setError(provider === "elevenlabs" || provider === "system" ? msg : k === "unreachable" || k === "timeout" ? UNREACHABLE : `The speech server could not speak this: ${msg}`);
      stop("error");
    }
  }, [stop]);

  // A new run (the answer is cleared) or a new answer stops what is playing; an auto-speak waits until the run has finished.
  useEffect(() => {
    if (answer === spokenFor.current) return;
    stop();
    if (answer === "") { spokenFor.current = ""; setError(""); return; }
    if (busy) return;
    spokenFor.current = answer;
    if (sRef.current.speechAuto) void speak(answer);
  }, [answer, busy, speak, stop]);

  useEffect(() => {
    window.addEventListener("pagehide", cancelSystem);
    return () => {
      window.removeEventListener("pagehide", cancelSystem);
      gen.current++;
      void window.kronos.speechCancel().catch(() => {});
      cancelSystem();
      void ctx.current?.close().catch(() => {});
    };
  }, []);

  return { s, state, error, speak, stop: () => stop() };
}
