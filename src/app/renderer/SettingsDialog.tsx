import { useEffect, useState } from "react";
import { ACCENTS, DEFAULT_SETTINGS, type AccentColorId, type Settings } from "../../core/settings.ts";
import { COFFEE_URL, REPO_URL } from "../../core/links.ts";
import { saveTheme, THEMES, type ThemeId } from "../../core/theme.ts";
import { AiConnection } from "./AiConnection.tsx";
import { SpeechSettings } from "./SpeechSettings.tsx";
import "./settings.css";

const CHANNELS = ["auto", "keyboard", "file", ...Array.from({ length: 16 }, (_, i) => String(i + 1))];

const THEME_INFO: Record<ThemeId, { label: string; hint: string }> = {
  normal: { label: "Normal", hint: "The look before the hardware re-skin: flat dark panels and thin lines." },
  studio: { label: "Studio", hint: "Stage-first: very high contrast, big targets, green, amber and red state colours." },
  a: { label: "Style A", hint: "Hardware: a graphite panel, an amber display and raised keys. The default." },
};

// Applies a Settings value to the page; zoom is applied by the main process. With no accent of the user's own, the theme's accent shows.
function paint(s: Settings): void {
  const root = document.documentElement;
  if (s.accent === "theme") root.style.removeProperty("--accent");
  else root.style.setProperty("--accent", ACCENTS[s.accent]);
  root.dataset.density = s.density;
  root.dataset.theme = s.theme;
  saveTheme(window.localStorage, s.theme);
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [scaleText, setScaleText] = useState(String(DEFAULT_SETTINGS.scale));
  const [ready, setReady] = useState(false); // AUTOROUTER_KEY is set in the main process; the key itself never reaches this window
  const [answers, setAnswers] = useState<number | null>(null); // saved AI answers on this computer
  const countAnswers = () => { void window.kronos.aiCacheStats().then((r) => setAnswers(r.count)).catch(() => setAnswers(null)); };
  const take = (r: Settings) => { setS(r); setScaleText(String(r.scale)); paint(r); window.dispatchEvent(new CustomEvent("kronos-settings", { detail: r })); };
  useEffect(() => { void window.kronos.settingsGet().then(take); void window.kronos.aiLocalReady().then(setReady).catch(() => {}); }, []);
  // Show the change at once: a controlled radio or select would otherwise snap back until the save returns. A refused value is corrected by take().
  const set = (patch: Partial<Settings>) => { setS((cur) => ({ ...cur, ...patch })); void window.kronos.settingsSet(patch).then(take); };
  // The AI window's "Open AI connection settings" button asks for this dialog, scrolled to the AI connection section.
  useEffect(() => {
    const on = () => { void window.kronos.settingsGet().then(take); countAnswers(); setOpen(true); window.setTimeout(() => document.querySelector('[data-testid="ai-conn-section"]')?.scrollIntoView?.({ block: "start" }), 50); };
    window.addEventListener("kronos-open-ai-connection", on);
    return () => window.removeEventListener("kronos-open-ai-connection", on);
  }, []);

  return (
    <>
      <button data-testid="settings-open" onClick={() => { void window.kronos.settingsGet().then(take); countAnswers(); setOpen(true); }}>Settings</button>
      {open && (
        <div className="settings-back">
          <div className="settings-dialog" data-testid="settings-dialog" role="dialog" aria-label="Settings">
            <h2>Settings</h2>
            <div className="settings-row" role="radiogroup" aria-label="Theme"><span>Theme</span>
              <span className="settings-themes">
                {THEMES.map((t) => (
                  <label key={t} className="settings-theme">
                    <input type="radio" name="settings-theme" aria-label={`Theme: ${THEME_INFO[t].label}`} data-testid={`settings-theme-${t}`} checked={s.theme === t} onChange={() => set({ theme: t })} />
                    <span><b>{THEME_INFO[t].label}</b><small className="settings-hint">{THEME_INFO[t].hint}</small></span>
                  </label>
                ))}
              </span>
            </div>
            <div className="settings-row"><span>Accent</span>
              <span className="settings-btns">
                <button data-testid="settings-accent-theme" aria-pressed={s.accent === "theme"} title="The accent colour of the chosen theme" onClick={() => set({ accent: "theme" })}>Theme</button>
                {(Object.keys(ACCENTS) as AccentColorId[]).map((a) => (
                  <button key={a} data-testid={`settings-accent-${a}`} aria-pressed={s.accent === a} onClick={() => set({ accent: a })}>
                    <i className="settings-swatch" style={{ background: ACCENTS[a] }} />{a[0].toUpperCase() + a.slice(1)}
                  </button>
                ))}
              </span>
            </div>
            <div className="settings-row"><span>UI scale</span>
              <span className="settings-btns">
                <input data-testid="settings-scale" type="range" min={90} max={125} step={1} aria-label="UI scale" value={scaleText}
                  onChange={(e) => { setScaleText(e.target.value); set({ scale: Number(e.target.value) }); }} />
                <span data-testid="settings-scale-value">{s.scale}%</span>
              </span>
            </div>
            <div className="settings-row"><span>List density</span>
              <span className="settings-btns">
                {(["compact", "comfortable"] as const).map((d) => (
                  <button key={d} data-testid={`settings-density-${d}`} aria-pressed={s.density === d} onClick={() => set({ density: d })}>{d[0].toUpperCase() + d.slice(1)}</button>
                ))}
              </span>
            </div>
            <div className="settings-row"><span>Default MIDI channel</span>
              <select data-testid="settings-channel" aria-label="Default MIDI channel" value={s.channelMode} onChange={(e) => set({ channelMode: e.target.value })}>
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="settings-row"><span>Kronos Global MIDI channel</span>
              <span className="settings-btns">
                <select data-testid="settings-global-channel" aria-label="Kronos Global MIDI channel" value={s.globalChannel} onChange={(e) => set({ globalChannel: e.target.value })}>
                  <option value="file">From the open file (default)</option>
                  {Array.from({ length: 16 }, (_, i) => String(i + 1)).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <span className="settings-hint" data-testid="settings-global-channel-hint">Used for the Volume slider. Your keyboard shows it under GLOBAL, MIDI.</span>
              </span>
            </div>
            <div className="settings-row"><span>Live edit: send single parameters</span>
              <label className="check">
                <input data-testid="settings-liveparams" aria-label="Live edit: send single parameters" type="checkbox" checked={s.liveParams} onChange={(e) => set({ liveParams: e.target.checked })} />
                Experimental: avoids the sound cutting out; falls back to the full sound when unsure
              </label>
            </div>
            <div className="settings-row"><span>Verify after each Live send</span>
              <label className="check">
                <input data-testid="settings-verifylive" aria-label="Verify after each Live send" type="checkbox" checked={s.verifyLive} onChange={(e) => set({ verifyLive: e.target.checked })} />
                Reads the keyboard's edit buffer back after a Live send and warns when it differs
              </label>
            </div>
            <AiConnection s={s} set={set} localKey={ready} />
            <SpeechSettings s={s} set={set} />
            <div className="settings-row"><span>Saved answers</span>
              <span className="settings-btns">
                <span data-testid="settings-answers-count">{answers === null ? "?" : answers}</span>
                <button data-testid="settings-clear-answers" disabled={answers === 0} title="Forget every saved AI answer, so the next question asks the AI again" onClick={() => { void window.kronos.aiCacheClear().then(countAnswers); }}>Clear saved answers</button>
                <span className="settings-hint">Explanations and questions the AI already answered are kept on this computer and shown instantly.</span>
              </span>
            </div>
            <div className="settings-row"><span>Support</span>
              <span className="settings-btns">
                <button data-testid="settings-star" title="Open the project page on GitHub, where you can press Star" onClick={() => { void window.kronos.openLink(REPO_URL); }}>Star on GitHub</button>
                {COFFEE_URL !== "" && <button data-testid="settings-coffee" title="Support the project with a coffee" onClick={() => { void window.kronos.openLink(COFFEE_URL); }}>Buy me a coffee</button>}
                <span className="settings-hint">Free to use. If it helps you, a star or a coffee is appreciated.</span>
              </span>
            </div>
            <div className="settings-foot">
              <button data-testid="settings-reset" onClick={() => set(DEFAULT_SETTINGS)}>Reset to defaults</button>
              <button data-testid="settings-close" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
