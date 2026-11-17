// Draws a layout spec (core/pages/layout.ts) for one Kronos tab: framed sections in a two column grid, rows of captioned controls, graphs in place.
// Edits go through the same CtlProps/onCommit path as every other Kronos control, so Undo, testids and Ask & show behave the same.
import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { isEditable, readParam, type Row } from "../../core/params/params.ts";
import type { Write } from "../../core/params/graphs.ts";
import { colsOf, inPane, isCaption, isGraph, padNum, panesOf, placeBlocks, refIndex, resolve, shows, slotW, type Cell, type GraphSlot, type LRow, type Ref, type Section, type Slot, type TabLayout } from "../../core/pages/layout.ts";
import { Panel, type CtlProps } from "./KronosControls.tsx";
import { MBoxField, MCheck, MDial, MFader, MPick, MReadOnly, MToggle } from "./KronosMemo.tsx";
import { EnvelopeGraph } from "./EnvelopeGraph.tsx";
import { FilterGraph } from "./FilterGraph.tsx";
import { KeyTrackGraph } from "./KeyTrackGraph.tsx";
import { LfoGraph } from "./LfoGraph.tsx";
import { VectorGraph } from "./VectorGraph.tsx";
import { eqHz, hzText } from "../../core/pages/mixer.ts";
import { KronosEq, eqOf } from "./KronosEq.tsx";
import { KronosZones } from "./KronosZones.tsx";
import { InfoIcon } from "./InfoIcon.tsx";
import { KronosFxTypeButton, fxTypeName } from "./KronosFx.tsx";
import { FxRouting } from "./fx/FxRouting.tsx";
import { FxChain } from "./fx/FxChain.tsx";
import { ifxChainLinks, ifxRoute, masterRoute } from "../../core/params/fx-kronos-route.ts";
import type { Graphs } from "./KronosView.tsx";
import "./KronosLayout.css";

type Props = {
  layout: TabLayout;
  // Every row of the sound; cells are found by group and name among them.
  all: Row[];
  ctl: (r: Row) => CtlProps;
  graphs: Graphs;
  cur: Uint8Array;
  onWrite: (w: Write[]) => void;
  // The mapped tab's rows that the spec does not place, drawn by the caller as a collapsed More section.
  more: ReactNode;
  morePointed: boolean;
  moreCount: number;
  // Combination: the selected timbre, its setter, and each timbre's program name for the strip of a timbre table.
  timbres?: { selected: number; onSelect: (t: number) => void; label: (t: number) => string };
  // Effect pages: which sound type this is, and where a click on a routing node goes ("8-7#3", "9-2").
  kind?: "hd1" | "combi";
  onGo?: (go: string) => void;
};

// More lists hundreds of rows on the KARMA pages (Scene state): its controls are only built once it is opened.
const LAZY_MORE = 100;

export function KronosLayout({ layout, all, ctl, graphs, cur, onWrite, more, morePointed, moreCount, timbres, kind = "hd1", onGo }: Props) {
  const index = useMemo(() => refIndex(all), [all]);
  const [pane, setPane] = useState<string>();
  const [moreOpen, setMoreOpen] = useState(false);
  const panes = panesOf(layout);
  const shownPane = pane !== undefined && panes.includes(pane) ? pane : panes[0];
  const blocks = inPane(layout, shownPane);
  const rowOf = (group: string, name: string) => resolve(index, { group, name });

  const control = (c: Cell): ReactNode => {
    const r = resolve(index, c);
    if (!r) return <span className="kl-missing" />;
    const base = ctl(r);
    // The screens print the Program choice as PRG.
    const text = (v: number): string => (c.options ? c.options[v - r.rawMin] : undefined) ?? (c.hz ? hzText(eqHz(v, r.rawMax)) : padNum(base.fmt(v), r).replace(/^Program$/, "PRG"));
    const p: CtlProps = { ...base, fmt: c.unit ? (v) => `${text(v)} ${c.unit}` : text };
    if (!isEditable(r) || c.kind === "text") return <MReadOnly {...p} label="" />;
    switch (c.kind) {
      case "dial": return <MDial {...p} label="" />;
      case "fader": return <MFader {...p} hideName height={c.h ?? 110} />;
      case "check": return <MCheck {...p} label={c.label} />;
      case "toggle": return <MToggle {...p} label={c.label} />;
      case "pick": return <MPick {...p} radio={c.look === "radio"} />;
      default: return <MBoxField {...p} />;
    }
  };

  const cellView = (c: Cell, i: number): ReactNode => {
    const r = resolve(index, c);
    // sixteen timbre columns share the one icon on the row's band
    const info = r && !/^(Timbre|Insert Effect)\d+$/.test(c.group) && <InfoIcon r={r} label={c.label} />;
    const caption = !!c.label && c.kind !== "check" && c.kind !== "toggle";
    return (
      <div key={i} className={`kl-cell kl-${c.kind}${c.fill ? " kl-fill" : ""}`}>
        {caption && <span className="kl-label">{c.label}{info}</span>}
        {control(c)}
        {!caption && info}
      </div>
    );
  };

  const graphView = (g: GraphSlot): ReactNode => {
    const entry = cur;
    switch (g.graph) {
      case "env": { const env = graphs.envs.find((x) => x.group === g.group); return env && <EnvelopeGraph kv env={env} entry={entry} onWrite={onWrite} />; }
      case "lfo": { const lfo = graphs.lfos.find((x) => x.group === g.group); return lfo && <LfoGraph kv lfo={lfo} entry={entry} />; }
      case "filter": { const f = graphs.filters.find((x) => x.group === g.group); return f && <FilterGraph kv f={f} entry={entry} onWrite={onWrite} />; }
      case "keytrack": { const kt = graphs.keyTracks.find((x) => x.group === g.group); return kt && <KeyTrackGraph kv kt={kt} entry={entry} />; }
      case "vector": return graphs.vector && graphs.vector.group === g.group ? <VectorGraph kv vec={graphs.vector} entry={entry} onWrite={onWrite} /> : null;
      case "eq": { const e = eqOf(rowOf, entry); return e && <KronosEq {...e} />; }
      case "zones": return <KronosZones kind={g.group === "vel" ? "vel" : "key"} rowOf={rowOf} cur={cur} selected={timbres?.selected} />;
      case "route": {
        const read = (grp: string, name: string) => { const r = rowOf(grp, name); return r ? readParam(entry, r) : undefined; };
        return <FxRouting graph={g.group === "master" ? masterRoute(read, fxTypeName) : ifxRoute(kind, read, fxTypeName)} onGo={onGo} />;
      }
      case "chain": return <FxChain links={ifxChainLinks((grp, name) => { const r = rowOf(grp, name); return r ? readParam(entry, r) : undefined; })} rows={12} />;
      case "fxtype": return <KronosFxTypeButton group={g.group} rowOf={rowOf} cur={entry} onWrite={onWrite} />;
      case "placeholder": return <div className="kl-placeholder">{g.label}</div>;
    }
  };

  const slotView = (s: Slot, i: number): ReactNode => {
    const style: CSSProperties = { gridColumn: `span ${slotW(s)}` };
    if (isCaption(s)) return <span key={i} className="kl-caption" style={style}>{s.badge ? <b className="kb-badge kb-red">{s.caption}</b> : s.caption}</span>;
    if (isGraph(s)) return <div key={i} className="kl-graph" style={style}>{graphView(s)}</div>;
    // A stack whose cells all have a caption lines the captions and controls up in two columns.
    const aligned = Array.isArray(s) && s.length > 1 && s.every((c) => c.label && c.kind !== "check" && c.kind !== "toggle");
    const t = Number(/^Timbre(\d+)$/.exec((Array.isArray(s) ? s[0] : s)?.group ?? "")?.[1]);
    return <div key={i} className={`kl-slot${aligned ? " kl-stack" : ""}`} style={style} data-sel={timbres && t === timbres.selected ? "true" : undefined}>{Array.isArray(s) ? s.map(cellView) : cellView(s, 0)}</div>;
  };

  const bandRef = (row: LRow): Row | undefined => {
    const c = row.cells.flatMap((s) => (Array.isArray(s) ? s : isGraph(s) || isCaption(s) ? [] : [s]))[0];
    return c && resolve(index, c);
  };
  const valueOf = (ref: Ref): number | undefined => { const r = resolve(index, ref); return r && ctl(r).value; };
  const rowView = (row: LRow, i: number, labelled: boolean): ReactNode =>
    !shows(row, valueOf) ? null : row.cells.length === 0 ? (
      <div key={i} className="kl-heading">{row.label}</div>
    ) : (
      <Fragment key={i}>
        {row.band && <div className="kl-band"><span>{row.band}{bandRef(row) && <InfoIcon r={bandRef(row) as Row} label={row.band} />}</span></div>}
        <div className="kl-row" data-rule={row.rule ? "true" : undefined}>
          {labelled && <span className="kl-rowlabel">{row.label}</span>}
          {row.cells.map(slotView)}
        </div>
      </Fragment>
    );

  const sectionBody = (b: Section) => {
    const labelled = b.rows.some((r) => r.label && r.cells.length > 0);
    const style = { ["--kl-tpl" as string]: `${labelled ? `${b.labelW ?? 64}px ` : ""}repeat(${colsOf(b)}, minmax(0, 1fr))` } as CSSProperties;
    // Sixteen or more grid columns (timbres, pads) take the narrow control style.
    return (
      <div className={`kl-rows${colsOf(b) >= 16 ? " kl-dense" : ""}`} style={style}>
        {b.timbres && timbres && (
          <div className="kl-strip" data-testid="kl-strip">
            {Array.from({ length: 16 }, (_, i) => i + 1).map((t) => (
              <button key={t} type="button" className="kl-tnum" data-sel={String(t === timbres.selected)} aria-pressed={t === timbres.selected} data-testid={`kl-select-${t}`} onClick={() => timbres.onSelect(t)}>
                <b className="kb-badge kb-blue">{t}</b>
                <span>{timbres.label(t)}</span>
              </button>
            ))}
          </div>
        )}
        {b.rows.map((r, i) => rowView(r, i, labelled))}
      </div>
    );
  };

  const placed = placeBlocks(blocks);
  const grid = (
    <div className="kl" data-testid="kronos-layout">
      {blocks.map((b, i) => {
        const p = placed[i];
        const style: CSSProperties = { gridColumn: `${p.col} / span ${p.colSpan}`, gridRow: `${p.row} / span ${p.rowSpan}` };
        return (
          <div key={i} className={`kl-sec${b.title ? "" : " kl-bare"}`} style={style}>
            {b.title ? <Panel title={b.title}>{sectionBody(b)}</Panel> : sectionBody(b)}
          </div>
        );
      })}
      {moreCount > 0 && (
        <details className="kv-more kl-more" open={morePointed || moreOpen || undefined} onToggle={(e) => setMoreOpen(e.currentTarget.open)} data-testid="kl-more">
          <summary>More ({moreCount})</summary>
          {moreCount < LAZY_MORE || morePointed || moreOpen ? more : null}
        </details>
      )}
    </div>
  );
  // The vertical button list of the KARMA pages (Master A..D, Module A..D, Scenes, Note Map): one pane's sections at a time.
  return panes.length === 0 ? grid : (
    <div className="kl-wrap">
      <nav className="kl-panes" aria-label="Panes" data-testid="kl-panes">
        {panes.map((n) => (
          <button key={n} type="button" data-active={String(n === shownPane)} aria-pressed={n === shownPane} data-testid={`kl-pane-${n}`} onClick={() => setPane(n)}>{n}</button>
        ))}
      </nav>
      {grid}
    </div>
  );
}
