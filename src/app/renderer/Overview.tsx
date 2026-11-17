// File Overview dashboard: counts by bank type and engine, a category bar chart (inline SVG), edited and Init-style slots, Set Lists.
import { useEffect, useMemo, useState } from "react";
import { categoryLabel, categoryNames, type Kind } from "../../core/pcg/catalog.ts";
import { buildOverview, soundsInCategory } from "../../core/pcg/overview.ts";
import type { ParamTables } from "../../core/params/params.ts";
import type { Workspace } from "./document.ts";
import "./Overview.css";

const KINDS = ["program", "combi", "drumkit", "waveseq", "setlist"] as const;
const BAR_W = 28;
const CHART_H = 160;

export function Overview({ ws, onPick, onClose }: { ws: Workspace; onPick: (key: string, index: number) => void; onClose: () => void }) {
  const [tables, setTables] = useState<ParamTables | null>(null);
  const [kind, setKind] = useState<Kind>("program");
  const [cat, setCat] = useState<number | null>(null);
  useEffect(() => {
    void import("../../generated/params.json").then((m) => setTables(m.default as unknown as ParamTables));
  }, []);
  // shortcut: computed once per open, not live while the panel stays open, upgrade if edits can happen behind it.
  const o = useMemo(() => (tables ? buildOverview(ws.file, tables, ws.changes()) : null), [ws, tables]);
  const names = useMemo(() => (tables ? categoryNames(ws.file, tables, kind) : []), [ws, tables, kind]);
  const sounds = useMemo(() => (tables && cat !== null ? soundsInCategory(ws.file, tables, kind, cat) : []), [ws, tables, kind, cat]);
  const counts = o ? o.categories[kind] : [];
  const max = Math.max(1, ...counts);

  return (
    <aside className="overview" data-testid="overview-panel" aria-label="File overview">
      <div className="ov-head">
        <h2>File overview</h2>
        <button data-testid="overview-close" onClick={onClose}>Close</button>
      </div>
      {!o && <p className="ov-muted">Reading file...</p>}
      {o && (
        <>
          <div className="ov-stats">
            {KINDS.map((k) => (
              <div key={k}><b data-testid={`overview-count-${k}`}>{o.slots[k]}</b><span>{k} slots, {o.banks[k]} banks</span></div>
            ))}
            <div><b data-testid="overview-engine-hd1">{o.engines.hd1}</b><span>HD-1 programs</span></div>
            <div><b data-testid="overview-engine-exi">{o.engines.exi}</b><span>EXi programs</span></div>
            <div><b data-testid="overview-edited">{o.edited}</b><span>edited slots</span></div>
            <div><b data-testid="overview-empty">{o.empty}</b><span>Init or empty</span></div>
          </div>
          <div className="ov-kinds">
            <button data-testid="overview-kind-program" aria-pressed={kind === "program"} onClick={() => { setKind("program"); setCat(null); }}>Programs</button>
            <button data-testid="overview-kind-combi" aria-pressed={kind === "combi"} onClick={() => { setKind("combi"); setCat(null); }}>Combis</button>
          </div>
          <svg data-testid="overview-bars" className="ov-bars" viewBox={`0 0 ${18 * BAR_W} ${CHART_H + 20}`} width="100%" role="group" aria-label="Sounds per category">
            {counts.map((n, i) => {
              const h = Math.round((n / max) * CHART_H);
              return (
                <g key={i} data-testid={`overview-bar-${i}`} data-count={n} aria-label={`${categoryLabel(names, i)}: ${n}`} role="button" tabIndex={0} className="ov-bar" data-on={cat === i} onClick={() => setCat(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setCat(i); }}>
                  <rect x={i * BAR_W} y={0} width={BAR_W} height={CHART_H + 20} fill="transparent" />
                  <rect x={i * BAR_W + 4} y={CHART_H - h} width={BAR_W - 8} height={h} />
                  <text x={i * BAR_W + BAR_W / 2} y={CHART_H + 14} textAnchor="middle">{i}</text>
                </g>
              );
            })}
          </svg>
          {cat !== null && (
            <section>
              <h3>{categoryLabel(names, cat)}: <span data-testid="overview-list-count">{sounds.length}</span></h3>
              <div className="ov-list">
                {sounds.map((s, i) => (
                  <button key={`${s.key}:${s.index}`} data-testid={`overview-sound-${i}`} onClick={() => onPick(s.key, s.index)}>{s.name} <span className="ov-muted">{s.bank} {String(s.index).padStart(3, "0")}</span></button>
                ))}
              </div>
            </section>
          )}
          <section>
            <h3>Set Lists</h3>
            <div className="ov-list">
              {o.setLists.map((s, i) => (
                <button key={s.index} data-testid={`overview-setlist-${i}`} onClick={() => onPick("setlist:SET", s.index)}>{s.name}</button>
              ))}
            </div>
          </section>
        </>
      )}
    </aside>
  );
}
