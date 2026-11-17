// The bottom dock: an on-screen keyboard and a MIDI monitor in tabs, collapsible.
import { memo, useState, type ReactNode } from "react";
import type { Link } from "./keyboard.ts";
import { KeyboardDock, START_CONTROLS, type DockControls } from "./KeyboardDock.tsx";
import { MonitorDock } from "./MonitorDock.tsx";
import { useThemeA } from "./theme-a/useTheme.ts";
import "./Dock.css";

type Tab = "keys" | "monitor" | "player";

// Memoised: App re-renders on every transfer step, and the dock should not follow it unless its link changes.
// player: the MIDI player panel, given only in Style A, which shows it as a third tab. It stays mounted so a song keeps playing on another tab.
export const Dock = memo(function Dock({ link, globalChannel, playing, extraChannels, player }: { link: Link | null; globalChannel: number; playing?: string; extraChannels?: number[]; player?: ReactNode }) {
  const themeA = useThemeA();
  // Style A shows the piano from the first launch, like the instrument panel; a choice made with Show / Hide is remembered.
  const [open, setOpen] = useState(() => { const v = localStorage.getItem("kronos.dock.open"); return v === null ? themeA : v === "1"; });
  const setOpenSaved = (v: boolean) => { setOpen(v); localStorage.setItem("kronos.dock.open", v ? "1" : "0"); };
  const [tab, setTab] = useState<Tab>("keys");
  // Kept here, not in the keys pane, so the octave, sustain and wheels survive a tab change.
  const [ctrl, setCtrl] = useState<DockControls>(START_CONTROLS);
  const onCtrl = (patch: Partial<DockControls>) => setCtrl((c) => ({ ...c, ...patch }));

  return (
    <section className="dock" data-testid="dock" aria-label="Keyboard and MIDI monitor">
      <div className="dock-bar">
        <div role="tablist" className="dock-tabs">
          <button type="button" role="tab" data-testid="dock-tab-keys" aria-selected={tab === "keys"} onClick={() => { setTab("keys"); setOpenSaved(!(open && tab === "keys")); }}>
            Keyboard
          </button>
          <button type="button" role="tab" data-testid="dock-tab-monitor" aria-selected={tab === "monitor"} onClick={() => { setTab("monitor"); setOpenSaved(!(open && tab === "monitor")); }}>
            MIDI monitor
          </button>
          {player && (
            <button type="button" role="tab" data-testid="dock-tab-player" aria-selected={tab === "player"} onClick={() => { setTab("player"); setOpenSaved(!(open && tab === "player")); }}>
              MIDI player
            </button>
          )}
        </div>
        <button type="button" data-testid="dock-toggle" aria-expanded={open} onClick={() => setOpenSaved(!open)}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <div className="dock-body" data-testid="dock-body">
          {tab === "keys" && playing && <p className="status" data-testid="dock-playing">{playing}</p>}
          {tab === "keys" ? <KeyboardDock link={link} ctrl={ctrl} onCtrl={onCtrl} globalChannel={globalChannel} extraChannels={extraChannels} /> : tab === "monitor" ? <MonitorDock /> : null}
        </div>
      )}
      {player && <div className="dock-player" data-testid="dock-player" hidden={!(open && tab === "player")}>{player}</div>}
    </section>
  );
});
