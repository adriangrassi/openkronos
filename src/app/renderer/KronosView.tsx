// Kronos view: title bar, the Play page header, the page's panels, then sub-tabs and page tabs along the bottom like the keyboard.
// Same rows and write path as the List view. Look is in KronosView.css (the --k-* skin block).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readParam, type ParamTables, type Row } from "../../core/params/params.ts";
import type { Envelope, Write } from "../../core/params/graphs.ts";
import type { Lfo } from "../../core/params/graphs2.ts";
import type { Filter, KeyTrack, Vector } from "../../core/params/shapes.ts";
import { keyOf } from "../../core/pages/view.ts";
import { refIndex, unplacedOf } from "../../core/pages/layout.ts";
import { combiLayouts } from "../../core/pages/layouts/combi.ts";
import { programHd1Layouts } from "../../core/pages/layouts/program-hd1.ts";
import { defaultSpot, locateRow, withOther, withPlay, type KPage, type KronosPages, type Spot } from "../../core/pages/kronos.ts";
import { FILTER_TYPES, geText, mixerCells, panText, programText } from "../../core/pages/mixer.ts";
import { panelsOf } from "../../core/pages/panels.ts";
import { readZones } from "../../core/pcg/multisamples.ts";
import { clearsPointOn, fxRowsOf, fxSpot, pointTarget, type PointAt } from "../../core/ai/point.ts";
import { EnvelopeGraph } from "./EnvelopeGraph.tsx";
import { FilterGraph } from "./FilterGraph.tsx";
import { KeyTrackGraph } from "./KeyTrackGraph.tsx";
import { LfoGraph } from "./LfoGraph.tsx";
import { VectorGraph } from "./VectorGraph.tsx";
import { valueText } from "./ParamEditor.tsx";
import { Panel, kindOf, type CtlProps } from "./KronosControls.tsx";
import { MCell as Cell, MKControl as KControl } from "./KronosMemo.tsx";
import { KronosHeader } from "./KronosHeader.tsx";
import { KronosMixer } from "./KronosMixer.tsx";
import { KronosMain } from "./KronosMain.tsx";
import { KronosEq, eqOf } from "./KronosEq.tsx";
import { KronosLayout } from "./KronosLayout.tsx";
import { KronosFxPage, fxTypeName } from "./KronosFx.tsx";
import { HelpScope } from "./InfoIcon.tsx";
import "./KronosView.css";

// The finders' results, as ParamEditor computed them for the List view.
export type Graphs = { envs: Envelope[]; lfos: Lfo[]; filters: Filter[]; keyTracks: KeyTrack[]; vector: Vector | null };
export type Sound = { bank: string; index: number; name: string };

type Props = {
  kind: "hd1" | "exi" | "combi";
  kp: KronosPages;
  all: Row[];
  graphs: Graphs;
  tables: ParamTables;
  cur: Uint8Array;
  base: Uint8Array;
  point: PointAt | null;
  sound: Sound;
  engines: string[];
  // A program's name, or null when its bank is not in the file.
  programName: (bank: number, program: number) => string | null;
  onPointClear?: () => void;
  onCommit: (r: Row, text: string) => void;
  onWrite: (writes: Write[]) => void;
};

// The Play page's sub-tabs as the keyboard has them; one without rows in our tables is shown disabled.
const PLAY_SUBTABS: { label: string; id?: string }[] = [
  { label: "Main", id: "0-1" }, { label: "Perf Meters" }, { label: "KARMA GE" }, { label: "Ctrl View/Effect" }, { label: "Audio In/Sampling", id: "0-8" }, { label: "Control Surface" },
];

// Where each sound type was last left, for as long as the app runs. Not saved.
const lastSpot = new Map<string, Spot>();

const fmtCache = new WeakMap<Row, (v: number) => string>();

export function KronosView({ kind, kp, all, graphs, tables, cur, base, point, sound, engines, programName, onPointClear, onCommit, onWrite }: Props) {
  const pages = useMemo(() => withPlay(withOther(kp), kind), [kp, kind]);
  const byKey = useMemo(() => new Map(all.map((r) => [keyOf(r), r])), [all]);
  const byName = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of all) if (!r.continuation && !m.has(`${r.group}/${r.name}`)) m.set(`${r.group}/${r.name}`, r);
    return m;
  }, [all]);
  const rowOf = (group: string, name: string): Row | undefined => byName.get(`${group}/${name}`);
  const refs = useMemo(() => refIndex(all), [all]);
  const cells = useMemo(() => (kind === "combi" ? mixerCells(all) : []), [kind, all]);
  // Memoized controls keep the closure they first got, so every commit goes through the latest onCommit by this ref.
  const latest = useRef(onCommit);
  latest.current = onCommit;
  const commit = useCallback((r: Row, text: string) => latest.current(r, text), []);
  const [chosen, setChosen] = useState<Spot | null>(() => lastSpot.get(kind) ?? null);
  const [timbre, setTimbre] = useState(1);
  const [ifx, setIfx] = useState(1);
  const [light, setLight] = useState(() => localStorage.getItem("kronos.view.light") === "1");
  const spot = defaultSpot(pages, kind, chosen);
  const choose = (s: Spot) => { lastSpot.set(kind, s); setChosen(s); };
  // A move the user makes (not the pointer's own jump) drops the guide highlight.
  const pick = (s: Spot) => { if ((s.page !== spot?.page || s.tab !== spot?.tab) && clearsPointOn("page")) onPointClear?.(); choose(s); };
  const page = pages.find((p) => p.key === spot?.page);
  const tab = page?.tabs.find((t) => t.id === spot?.tab);

  // Ask & show: open the tab that holds the pointed row.
  useEffect(() => {
    const hit = point && locateRow(pages, point.ids[0]);
    if (hit) { choose({ page: hit.page, tab: hit.tab }); return; }
    // Effect parameters are not table rows: open the effects tab that shows them.
    const t = point && pointTarget(point.ids[0], [], fxRowsOf(all, cur));
    const f = t && fxSpot(t.group);
    const p = f && pages.find((x) => x.slot === undefined && x.tabs.some((y) => y.id === f.tab));
    if (f && p) { if (f.ifx) setIfx(f.ifx); choose({ page: p.key, tab: f.tab }); }
  }, [point, pages]);

  if (!page || !tab) return <p className="kv-note">No parameters for this sound.</p>;

  const fmtOf = (r: Row): ((v: number) => string) => {
    let f = fmtCache.get(r);
    if (!f) {
      f = r.name === "Filter Type" && r.rawMax === 3 ? (v) => FILTER_TYPES[v] ?? String(v) : r.name === "GE Number" ? (v) => geText(v, tables.valueLists["KARMA GE"]) : r.valueText.startsWith("RND") ? (v) => panText(v) : (v) => valueText(tables, r, v);
      fmtCache.set(r, f);
    }
    return f;
  };
  const ctl = (r: Row): CtlProps => ({
    r, value: readParam(cur, r), base: readParam(base, r), changed: readParam(cur, r) !== readParam(base, r), pointed: point?.ids.includes(keyOf(r)), fmt: fmtOf(r), onCommit: (text) => commit(r, text),
  });
  const rows = tab.keys.map((k) => byKey.get(k)).filter((r): r is Row => r !== undefined);
  const play = page.page === "P0" && page.slot === undefined;
  const mixer = kind === "combi" && play && tab.id === "0-1";
  const dash = kind === "hd1" && play && tab.id === "0-1";

  // A tab with a layout spec draws that; one without keeps the automatic panels.
  const layout = page.slot !== undefined ? undefined : kind === "hd1" ? programHd1Layouts[tab.id] : kind === "combi" ? combiLayouts[tab.id] : undefined;
  const timbreTab = !!layout?.blocks.some((b) => b.timbres);

  // Effect pages: 8-7 shows the chosen IFX, 9-2..9-5 the master and total effects.
  const fxGroup = page.slot !== undefined || kind === "exi" ? undefined : tab.id === "8-7" ? `Insert Effect${ifx}` : ({ "9-2": "Master Effect1", "9-3": "Master Effect2", "9-4": "Total Effect1", "9-5": "Total Effect2" } as Record<string, string>)[tab.id];
  // "8-7#3" opens IFX3's page, "9-2" that tab; the page is whichever one holds the tab.
  const onGo = (go: string) => {
    const [id, n] = go.split("#");
    const p = pages.find((x) => x.slot === undefined && x.tabs.some((t) => t.id === id));
    if (!p) return;
    if (n) setIfx(Math.min(12, Math.max(1, Number(n) || 1)));
    pick({ page: p.key, tab: id });
  };

  const goPage = (title: string) => {
    const p = pages.find((x) => x.title.startsWith(title));
    if (p) pick({ page: p.key, tab: p.tabs[0].id });
  };

  const tempo = rowOf("KARMA Common", "Tempo");
  const fav = rowOf("Common", "Favorite");
  const sel = cells.find((c) => c.timbre === timbre);
  const chan = rowOf(`Timbre${timbre}`, "MIDI Channel");
  const line = sel ? `T#${timbre}  ${programText(readParam(cur, sel.bank), readParam(cur, sel.program))} ${programName(readParam(cur, sel.bank), readParam(cur, sel.program)) ?? ""}${chan ? `   Ch: ${fmtOf(chan)(readParam(cur, chan))}` : ""}` : undefined;
  const tempoBpm = tempo ? Number(fmtOf(tempo)(readParam(cur, tempo))) : NaN;
  const header = (
    <KronosHeader
      slim={!play}
      bank={sound.bank} index={sound.index} name={sound.name}
      engine={kind === "hd1" ? "HD-1" : kind === "exi" ? engines.filter((e) => e !== "Off").join(" / ") : undefined}
      tempo={tempo && { r: tempo, value: readParam(cur, tempo), fmt: fmtOf(tempo), onCommit: (t) => commit(tempo, t) }}
      favorite={fav && ctl(fav)}
      line={play || timbreTab ? line : undefined}
    />
  );

  // Graphs whose rows are in this tab, drawn big above the panels.
  const groups = new Set(rows.map((r) => r.group));
  const inTab = <T extends { group: string }>(xs: T[]): T[] => xs.filter((x) => groups.has(x.group));
  const envs = inTab(graphs.envs), lfos = inTab(graphs.lfos), filters = inTab(graphs.filters), keyTracks = inTab(graphs.keyTracks);
  const vec = graphs.vector && groups.has(graphs.vector.group) ? graphs.vector : undefined;
  const eqIn = groups.has("Track EQ") ? eqOf(rowOf, cur) : null;
  const hasGraph = envs.length + lfos.length + filters.length + keyTracks.length > 0 || !!vec || !!eqIn;
  const left = layout ? unplacedOf(layout, rows, refs) : [];

  const rowsGrid = (rs: Row[]) => (
    <div className="kv-ctl-grid">
      {rs.map((r) => <div key={keyOf(r)} className={`kv-ctl kv-ctl-${kindOf(r, fmtOf(r))}`}><KControl {...ctl(r)} /></div>)}
    </div>
  );
  const panels = (rs: Row[]) => panelsOf(rs).map((p) =>
    p.kind === "rows" ? (
      <Panel key={p.title} title={p.title} className={p.rows.length > 8 ? "kv-wide" : undefined}>{rowsGrid(p.rows)}</Panel>
    ) : (
      <Panel key={p.title} title={p.title} className="kv-table-panel">
        <table className="kv-table" data-testid="kv-table">
          <thead><tr><th />{p.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.label}><th scope="row">{l.label}</th>{l.rows.map((r) => <td key={keyOf(r)}><Cell {...ctl(r)} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </Panel>
    ),
  );

  const subtabs: { label: string; id?: string; n?: string }[] = play ? PLAY_SUBTABS.map((s) => (s.id === "0-1" && kind === "combi" ? { ...s, label: "Prog Select/Mixer" } : s)) : page.tabs.map((t) => ({ label: t.title, id: t.id, n: t.id === "other" ? undefined : t.id }));

  return (
    <HelpScope.Provider value={{ mode: kind, tab: kind === "exi" || tab.id === "other" || tab.id === "more" ? undefined : tab.id }}>
    <div className="kv" data-skin={light ? "kronos-light" : "kronos-dark"} data-testid="kronos-view">
      <div className="kv-titlebar">
        <span className="kv-title" data-testid="kv-title">{kind === "combi" ? "COMBINATION" : "PROGRAM"} {page.page}:{page.title}</span>
        <span className="kv-subname" data-testid="kv-subname">{play && kind === "combi" && tab.id === "0-1" ? "Prog Select/Mixer" : tab.title}</span>
        <button type="button" className="kv-skin" data-testid="kv-skin" aria-pressed={light} onClick={() => { localStorage.setItem("kronos.view.light", light ? "0" : "1"); setLight(!light); }}>
          {light ? "Kronos grey" : "Dark"}
        </button>
      </div>
      {header}
      <div className="kv-body" data-testid="kv-body">
        {mixer && cells.length === 16 ? (
          <>
            <KronosMixer
              cells={cells} cur={cur} base={base} fmtOf={fmtOf} commit={commit} pointed={(r) => !!point?.ids.includes(keyOf(r))}
              programName={programName} selected={timbre} onSelect={setTimbre}
            />
            <details className="kv-more">
              <summary>Combination settings</summary>
              {panels(rows.filter((r) => r.group === "Common" && r !== fav && r !== tempo))}
            </details>
          </>
        ) : dash ? (
          <KronosMain rowOf={rowOf} cur={cur} base={base} fmtOf={fmtOf} commit={commit} onWrite={onWrite} graphs={graphs} zones={readZones(cur)} geNames={tables.valueLists["KARMA GE"]} go={goPage} />
        ) : fxGroup ? (
          <div className={tab.id === "8-7" ? "kv-fx" : undefined}>
            {tab.id === "8-7" && (
              <nav className="kv-ifxlist" aria-label="Insert effects">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
                  const tr = rowOf(`Insert Effect${n}`, "Effect Type");
                  return (
                    <button key={n} type="button" data-testid={`kv-ifx-${n}`} data-active={String(n === ifx)} aria-pressed={n === ifx} onClick={() => setIfx(n)}>
                      IFX{n}<small>{tr ? fxTypeName(readParam(cur, tr)) : ""}</small>
                    </button>
                  );
                })}
              </nav>
            )}
            <KronosFxPage kind={kind === "combi" ? "combi" : "hd1"} group={fxGroup} rowOf={rowOf} cur={cur} ctl={ctl} onWrite={onWrite} tempo={Number.isFinite(tempoBpm) ? tempoBpm : undefined} />
          </div>
        ) : layout ? (
          <KronosLayout
            kind={kind === "combi" ? "combi" : "hd1"} onGo={onGo}
            layout={layout} all={all} ctl={ctl} graphs={graphs} cur={cur} onWrite={onWrite}
            more={panels(left)} morePointed={left.some((r) => point?.ids.includes(keyOf(r)))} moreCount={left.length}
            timbres={kind === "combi" ? { selected: timbre, onSelect: setTimbre, label: (t) => { const c = cells.find((x) => x.timbre === t); return (c && programName(readParam(cur, c.bank), readParam(cur, c.program))) || ""; } } : undefined}
          />
        ) : (
          <>
            {hasGraph && (
              <div className="kv-graphs">
                {envs.map((env) => <Panel key={env.group} title={env.group} className="kv-graph"><EnvelopeGraph kv env={env} entry={cur} onWrite={onWrite} /></Panel>)}
                {lfos.map((lfo) => <Panel key={lfo.group} title={lfo.group} className="kv-graph"><LfoGraph kv lfo={lfo} entry={cur} /></Panel>)}
                {filters.map((f) => <Panel key={f.group} title={f.group} className="kv-graph"><FilterGraph kv f={f} entry={cur} onWrite={onWrite} /></Panel>)}
                {keyTracks.map((kt) => <Panel key={kt.group} title={kt.group} className="kv-graph"><KeyTrackGraph kv kt={kt} entry={cur} /></Panel>)}
                {vec && <Panel title={vec.group} className="kv-graph kv-graph-sq"><VectorGraph kv vec={vec} entry={cur} onWrite={onWrite} /></Panel>}
                {eqIn && <Panel title="Track EQ" className="kv-graph"><KronosEq {...eqIn} /></Panel>}
              </div>
            )}
            <div className="kv-panels">{panels(rows)}</div>
          </>
        )}
      </div>
      <nav className="kv-subtabs" aria-label="Tabs">
        {subtabs.map((s) => {
          const real = s.id !== undefined && page.tabs.some((t) => t.id === s.id);
          return (
            <button key={s.label} type="button" disabled={!real} title={real ? undefined : "Nothing in the data tables for this tab"} data-testid={real ? `kv-tab-${s.id}` : undefined} data-active={String(real && s.id === tab.id)} aria-pressed={real && s.id === tab.id} onClick={() => real && pick({ page: page.key, tab: s.id! })}>
              {s.n && <b>{s.n}</b>}
              {s.label}
            </button>
          );
        })}
      </nav>
      <nav className="kv-pages" aria-label="Pages">
        {pages.map((p: KPage) => (
          <button key={p.key} type="button" data-testid={`kv-page-${p.key}`} data-active={String(p.key === page.key)} aria-pressed={p.key === page.key} onClick={() => { const d = defaultSpot([p], kind); if (d) pick(d); }}>
            {p.engine ? `${p.engine} ${p.title}` : p.title}
            {p.engine && <small>EXi{p.slot}</small>}
          </button>
        ))}
      </nav>
    </div>
    </HelpScope.Provider>
  );
}
