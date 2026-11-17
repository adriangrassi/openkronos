// Searchable multisample picker and "Who uses this" list for one oscillator zone row.
import { useMemo, useState } from "react";
import { groupMultisamples, listMultisamples, msLabel, readZones, searchMultisamples, whoUses, type MsRef } from "../../core/pcg/multisamples.ts";
import type { PcgFile } from "../../core/pcg/pcg.ts";
import "./MultisamplePicker.css";

type Props = { file: PcgFile; entry: Uint8Array; osc: 1 | 2; zone: number; k: string; onPick: (ref: MsRef) => void };

export function MultisamplePicker({ file, entry, osc, zone, k, onPick }: Props) {
  const [mode, setMode] = useState<"picker" | "who" | null>(null);
  const [q, setQ] = useState("");
  const close = () => setMode(null);
  const esc = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  // shortcut: the list is read again on every open and render, not cached, and all matches are in the DOM; add windowing if files grow far past ~1200 multisamples
  const all = useMemo(() => (mode === "picker" ? listMultisamples(file) : []), [mode, file]);
  const found = mode === "picker" ? searchMultisamples(all, q) : [];
  const groups = groupMultisamples(found);
  const users = mode === "who" ? whoUses(file, readZones(entry)[(osc - 1) * 8 + zone - 1].ref) : [];
  let n = 0;
  return (
    <span className="ms-tools">
      <button type="button" data-testid={`waves-open-${k}`} onClick={() => { setQ(""); setMode("picker"); }}>Pick</button>
      <button type="button" data-testid={`waves-who-${k}`} onClick={() => setMode("who")}title="Who uses this">Who uses</button>
      {mode === "picker" && (
        <div className="ms-panel" data-testid="waves-picker" onKeyDown={esc}>
          <input data-testid="waves-q" autoFocus aria-label="Search multisamples" placeholder="Search, e.g. ms 4 #8" value={q} onChange={(e) => setQ(e.target.value)} />
          <p className="muted">
            <span data-testid="waves-count">{found.length}</span> multisamples in <span data-testid="waves-ngroups">{groups.length}</span> banks
          </p>
          <div className="ms-scroll">
            {found.length === 0 && <p className="muted" data-testid="waves-empty">No multisample matches.</p>}
            {groups.map((g, gi) => (
              <div key={g.bank}>
                <h3 data-testid={`waves-group-${gi}`}>{g.label}</h3>
                {g.items.map((r) => {
                  const i = n++;
                  return (
                    <button type="button" key={r.number} className="ms-opt" data-testid={`waves-opt-${i}`} data-bank={r.bank} data-number={r.number} onClick={() => { close(); onPick(r); }}>
                      {msLabel(r)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      {mode === "who" && (
        <div className="ms-panel" data-testid="waves-who-list" tabIndex={-1} ref={(el) => el?.focus()} onKeyDown={esc}>
          <p className="muted">
            <span data-testid="waves-who-count">{users.length}</span> Programs use this multisample
          </p>
          <div className="ms-scroll">
            {users.map((u, i) => (
              <div key={`${u.key}-${u.index}`} data-testid={`waves-who-row-${i}`}>
                {u.name} <span className="muted">{u.key} #{u.index + 1}, {u.zones.map((z) => `OSC${z.osc} zone ${z.zone}`).join(", ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
