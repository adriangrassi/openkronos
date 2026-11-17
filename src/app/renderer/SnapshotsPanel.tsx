// Named snapshots of the open Program or Combi: save, list with diff counts, restore as one undo step.
import { useEffect, useState } from "react";
import { countDiffs, addSnapshot, makeSnapshot, snapshotEntry, type Snapshot } from "../../core/pcg/snapshots.ts";
import { getName, setEntry } from "../../core/pcg/library.ts";
import type { ParamTables, ParamType } from "../../core/params/params.ts";
import type { Workspace } from "./document.ts";
import "./SnapshotsPanel.css";

type Props = {
  tables: ParamTables;
  ws: Workspace;
  target: { kind: "slot"; key: string; index: number };
  type: ParamType;
  entry: Uint8Array;
  onChanged: () => void;
};

export function SnapshotsPanel({ tables, ws, target, type, entry, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Snapshot[]>([]);
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const name = getName(ws.file, target.key, target.index);
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  useEffect(() => {
    let live = true;
    window.kronos.snapshotsLoad(name, type).then(
      (l) => live && (setList(l), setErr(null)),
      (e: unknown) => live && setErr(`Could not load snapshots: ${msg(e)}`),
    );
    return () => {
      live = false;
    };
  }, [name, type]);

  async function save() {
    const next = addSnapshot(list, makeSnapshot(label, type, entry, Date.now()));
    try {
      await window.kronos.snapshotsSave(name, type, next);
      setList(next);
      setLabel("");
      setErr(null);
    } catch (e) {
      setErr(`Could not save snapshot: ${msg(e)}`);
    }
  }

  async function restore(s: Snapshot) {
    try {
      await ws.apply([{ key: target.key, index: target.index }], () => setEntry(ws.file, target.key, target.index, snapshotEntry(s)));
      onChanged();
      setErr(null);
    } catch (e) {
      setErr(`Could not restore: ${msg(e)}`);
    }
  }

  const shown = list.slice().reverse();
  return (
    <div className="snaps">
      <div className="snaps-bar">
        <button data-testid="snapshots-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          Snapshots
        </button>
        {err && <span className="snaps-error" data-testid="snapshots-error">{err}</span>}
      </div>
      {open && (
        <div data-testid="snapshots-panel">
          <div className="snaps-add">
            <input data-testid="snapshots-name" aria-label="Snapshot name" placeholder="Snapshot name" value={label} onChange={(e) => setLabel(e.target.value)} />
            <button data-testid="snapshots-save" onClick={() => void save()}>Save snapshot</button>
            <span data-testid="snapshots-count">{list.length}</span>
          </div>
          <div className="snaps-list">
            {shown.map((s, i) => (
              <div className="snaps-row" key={s.id} data-testid={`snapshots-row-${i}`}>
                <span className="snaps-label" data-testid={`snapshots-label-${i}`}>{s.label}</span>
                <span className="snaps-time" data-testid={`snapshots-time-${i}`}>
                  {new Date(s.time).toLocaleString([], { hour12: false, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="snaps-diff" data-testid={`snapshots-diff-${i}`}>{countDiffs(tables, type, snapshotEntry(s), entry)}</span>
                <button data-testid={`snapshots-restore-${i}`} onClick={() => void restore(s)}>Restore</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
