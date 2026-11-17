// Recent Files menu: up to 10 names, newest first. The renderer only ever holds ids and names.
import { useEffect, useState } from "react";
import type { RecentState } from "../shared/api.ts";

interface Props {
  onOpen: (id: string) => void;
  onError: (message: string) => void;
}

export function RecentMenu({ onOpen, onError }: Props) {
  const [state, setState] = useState<RecentState | null>(null);

  useEffect(() => {
    // Read each time the menu opens (it mounts on open), so a file removed elsewhere is gone from the list.
    window.kronos.recent().then(setState, (e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    // onError is App's state setter, stable in practice, so the effect runs once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setReopen(on: boolean) {
    setState((s) => (s ? { ...s, reopenLast: on } : s));
    window.kronos.setReopenLast(on).catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  }

  // Nothing shows until the list has loaded, so an open menu never reads as empty or as "reopen off" for a moment.
  if (!state) return null;
  return (
    <div className="shell-pop shell-recent" role="menu" aria-label="Recent Files" data-testid="shell-recent-menu">
      {state.items.length === 0 && <p className="shell-note" data-testid="shell-recent-empty">No recent files yet.</p>}
      {state.items.length > 0 && (
        <ul className="shell-list">
          {state.items.map((it, n) => (
            <li key={it.id}>
              <button role="menuitem" data-testid={`shell-recent-item-${n}`} data-id={it.id} onClick={() => onOpen(it.id)}>
                {it.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="shell-check">
        <input type="checkbox" data-testid="shell-reopen-last" checked={state.reopenLast} onChange={(e) => setReopen(e.target.checked)} />
        Reopen the last file at start
      </label>
      <button data-testid="shell-clear-cache" onClick={() => window.kronos.clearCache().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))}>
        Clear cache
      </button>
    </div>
  );
}
