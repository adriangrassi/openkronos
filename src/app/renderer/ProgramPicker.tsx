// Search box for picking a Program for a Combi timbre. Lists Program slots from every Program bank in the library whose name matches.
import { useMemo, useState } from "react";
import { getName, listBanks } from "../../core/pcg/library.ts";
import type { PcgFile } from "../../core/pcg/pcg.ts";

const LIMIT = 200;

type Hit = { key: string; label: string; index: number; name: string };

export function ProgramPicker({ file, onPick, onClose }: { file: PcgFile; onPick: (key: string, index: number) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const out: Hit[] = [];
    if (needle === "") return out;
    for (const b of listBanks(file)) {
      if (b.kind !== "program") continue;
      for (let i = 0; i < b.count && out.length < LIMIT; i++) {
        const name = getName(file, b.key, i);
        if (name.toLowerCase().includes(needle)) out.push({ key: b.key, label: b.label, index: i, name });
      }
    }
    return out;
  }, [file, query]);

  return (
    <div className="program-picker" data-testid="program-picker">
      <input
        data-testid="program-search"
        type="search"
        aria-label="Search programs"
        placeholder="Search programs"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      />
      <div className="program-hits">
        {hits.map((h, i) => (
          <button key={`${h.key}/${h.index}`} data-testid={`program-hit-${i}`} data-target={`${h.key}/${h.index}`} onClick={() => onPick(h.key, h.index)}>
            {`${h.label} ${String(h.index).padStart(3, "0")}  ${h.name}`}
          </button>
        ))}
      </div>
    </div>
  );
}
