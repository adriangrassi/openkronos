// Modal effect type picker: categories on the left, types on the right, OK / Cancel. Generic: the caller supplies the categories.
import { useEffect, useState } from "react";
import type { FxCategory } from "../../../core/fx/graphs.ts";
import "./fx-page.css";

export function FxTypePicker({ categories, value, onPick, onClose }: { categories: FxCategory[]; value: number; onPick: (id: number) => void; onClose: () => void }) {
  const home = Math.max(0, categories.findIndex((c) => c.items.some((i) => i.id === value)));
  const [cat, setCat] = useState(home);
  const [sel, setSel] = useState(value);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const pick = (id: number) => { onPick(id); onClose(); };
  return (
    <div className="fxt-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fxt-dlg" role="dialog" aria-modal="true" aria-label="Effect type">
        <div className="fxt-bar">Effect Type</div>
        <div className="fxt-cols">
          <div className="fxt-cats">
            {categories.map((c, i) => (
              <button key={c.name} type="button" className="fxt-cat" data-active={i === cat} data-testid={`fxp-cat-${i}`} onClick={() => setCat(i)}>{c.name}</button>
            ))}
          </div>
          <div className="fxt-list">
            {(categories[cat]?.items ?? []).map((t) => (
              <button key={t.id} type="button" className="fxt-type" data-active={t.id === sel} data-testid={`fxp-type-${t.id}`} onClick={() => setSel(t.id)} onDoubleClick={() => pick(t.id)}>{t.label}</button>
            ))}
          </div>
        </div>
        <div className="fxt-foot">
          <button type="button" className="fxt-btn" data-testid="fxp-ok" onClick={() => pick(sel)}>OK</button>
          <button type="button" className="fxt-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
