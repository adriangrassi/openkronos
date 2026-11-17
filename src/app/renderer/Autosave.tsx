import { useEffect, useRef, useState } from "react";
import type { Workspace } from "./document.ts";
import { sameBytes as same } from "./bytes.ts";

// Crash recovery: while the open file has unsaved changes, a copy goes to the recovery folder on a timer (main process validates and rotates).
// shortcut: the copy is a whole-file serialize on the UI thread each tick, only when dirty, upgrade to a worker if big libraries stall it.
const newId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("");

export function Autosave({ ws, dirty, onRestore }: { ws: Workspace | null; dirty: number; onRestore: (bytes: Uint8Array) => void }) {
  const api = window.kronos;
  const [offer, setOffer] = useState<Uint8Array | null>(null);
  const live = useRef({ ws, dirty });
  live.current = { ws, dirty };
  // The document being tracked: its id, and the last bytes written for it.
  const doc = useRef<{ ws: Workspace; id: string; last: Uint8Array | null } | null>(null);

  useEffect(() => {
    void api.recoveryPeek().then((b) => setOffer(b), () => undefined);
  }, [api]);

  // Saved, or another file opened: that document's copies go away.
  useEffect(() => {
    const d = doc.current;
    if (d && (d.ws !== ws || dirty === 0)) {
      void api.recoveryClear(d.id).catch(() => undefined);
      doc.current = d.ws === ws ? { ...d, last: null } : null;
    }
  }, [api, ws, dirty]);

  useEffect(() => {
    let timer = 0;
    let stopped = false;
    const tick = async () => {
      const { ws: w, dirty: n } = live.current;
      if (w && n > 0) {
        if (!doc.current || doc.current.ws !== w) doc.current = { ws: w, id: newId(), last: null };
        const d = doc.current;
        const bytes = w.serialize();
        if (!d.last || !same(d.last, bytes)) {
          try {
            await api.recoveryWrite(d.id, bytes);
            d.last = bytes;
          } catch {
            // Try again next tick.
          }
        }
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), ms);
    };
    let ms = 60000;
    void api.recoveryInterval().then((v) => {
      ms = v;
      if (!stopped) timer = window.setTimeout(() => void tick(), ms);
    });
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [api]);

  if (!offer) return null;
  const close = () => setOffer(null);
  return (
    <div className="scrim">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="autosave-message" data-testid="autosave-offer">
        <p id="autosave-message">OpenKronos closed with unsaved changes. Restore the recovered file, or discard it?</p>
        <div className="buttons end">
          <button data-testid="autosave-discard" onClick={() => void api.recoveryDiscard().finally(close)}>Discard</button>
          <button data-testid="autosave-restore" className="primary" autoFocus onClick={() => void api.recoveryDiscard().finally(() => { onRestore(offer); close(); })}>Restore</button>
        </div>
      </div>
    </div>
  );
}
