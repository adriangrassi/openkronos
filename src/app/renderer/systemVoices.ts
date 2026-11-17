// The computer's own voices through Chromium's speechSynthesis, in the window: no network, no key, nothing in the main process.
import { useEffect, useState } from "react";

export const hasSystemSpeech = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

// Chromium fills the voice list asynchronously: an empty list is waited on until voiceschanged fires or the timeout (2 s) passes.
export async function loadSystemVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (!hasSystemSpeech()) return [];
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length > 0) return now;
  await new Promise<void>((done) => {
    const finish = () => { clearTimeout(t); synth.removeEventListener?.("voiceschanged", finish); done(); };
    const t = setTimeout(finish, timeoutMs);
    synth.addEventListener?.("voiceschanged", finish);
  });
  return synth.getVoices();
}

// The installed voices for Settings and the AI window; it follows later voiceschanged events (a voice installed while OpenKronos runs).
export function useSystemVoices(active: boolean): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!active || !hasSystemSpeech()) return;
    let live = true;
    const synth = window.speechSynthesis;
    const refresh = () => { const v = synth.getVoices(); if (live && v.length > 0) setVoices(v); };
    void loadSystemVoices().then((v) => { if (live) setVoices(v); });
    synth.addEventListener?.("voiceschanged", refresh);
    return () => { live = false; synth.removeEventListener?.("voiceschanged", refresh); };
  }, [active]);
  return voices;
}
