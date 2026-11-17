import { useEffect, useState } from "react";
import { MODES, modeChangeBytes, modeFromMessage, modeRequestBytes } from "../../core/midi/modes.ts";
import type { Link } from "./keyboard.ts";
import { subscribeIncoming, subscribeOutgoing } from "./midi-tap.ts";
import "./ModeBar.css";

// Switches the Kronos's mode. Follows the keyboard's own panel and any mode the app sets, so the lit button is the real mode.
export function ModeBar({ link, locked }: { link: Link | null; locked: boolean }) {
  const [mode, setMode] = useState<number | null>(null);

  useEffect(() => {
    setMode(null);
    if (!link) return;
    const follow = (m: Uint8Array) => {
      const v = modeFromMessage(m);
      if (v !== null) setMode(v);
    };
    const offIn = subscribeIncoming(follow);
    const offOut = subscribeOutgoing(follow);
    link.send(modeRequestBytes(link.channel));
    return () => {
      offIn();
      offOut();
    };
  }, [link]);

  return (
    <div className="mode-bar" role="group" aria-label="Kronos mode">
      {MODES.map((m) => (
        <button key={m.id} data-testid={`kronos-mode-${m.id}`} data-active={String(mode === m.id)} aria-pressed={mode === m.id} disabled={!link || locked} onClick={() => link?.send(modeChangeBytes(m.id, link.channel))}>
          {m.label}
        </button>
      ))}
    </div>
  );
}
