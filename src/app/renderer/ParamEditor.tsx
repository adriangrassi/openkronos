// Parameter editor for one slot or for Global: group or search on the left, a windowed list of rows on the right.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ENGINE_NAMES, exiEngines, formatValue, isEditable, paramsFor, readParam, writeParam, type ParamTables, type ParamType, type Row } from "../../core/params/params.ts";
import { findEnvelopes, type Write } from "../../core/params/graphs.ts";
import { findLfos, waveSeqTimeline } from "../../core/params/graphs2.ts";
import { findFilters, findKeyTracks, findVector } from "../../core/params/shapes.ts";
import { getEntry, getGlobal, getName, setEntry, setGlobal } from "../../core/pcg/library.ts";
import { screensFor, type PageMap } from "../../core/pages/view.ts";
import pages from "../../core/pages/pages.json" with { type: "json" };
import type { Workspace } from "./document.ts";
import { SnapshotsPanel } from "./SnapshotsPanel.tsx";
import { DrumMap } from "./DrumMap.tsx";
import { EnvelopeGraph } from "./EnvelopeGraph.tsx";
import { FilterGraph } from "./FilterGraph.tsx";
import { KeyTrackGraph } from "./KeyTrackGraph.tsx";
import { KeyboardMap } from "./KeyboardMap.tsx";
import { LfoGraph } from "./LfoGraph.tsx";
import { VectorGraph } from "./VectorGraph.tsx";
import { WaveTimeline } from "./WaveTimeline.tsx";
import { KeyboardView } from "./KeyboardView.tsx";
import { KronosView } from "./KronosView.tsx";
import { kronosPages, locateRow, withOther } from "../../core/pages/kronos.ts";
import { programKey } from "../../core/pcg/refs.ts";
import { SimpleView } from "./SimpleView.tsx";
import { fillOf } from "./slider.ts";
import { PARAM_ROW, PARAM_ROW_STUDIO, useStudio } from "./theme-studio/useStudio.ts";
import { Step } from "./theme-studio/Step.tsx";
import { MultisamplePicker } from "./MultisamplePicker.tsx";
import { applyMultisample, type MsRef } from "../../core/pcg/multisamples.ts";
import { clearsPointOn, fxRowsOf, pointUi, rowIndexIn, scrollOffsetFor, type PointAt } from "../../core/ai/point.ts";
import { HelpScope, InfoIcon } from "./InfoIcon.tsx";
import { PanelView } from "./theme-a/PanelView.tsx";
import { useThemeA } from "./theme-a/useTheme.ts";
import { paramAttrs, registerParam } from "./explain.ts";

export type EditorTarget = { kind: "slot"; key: string; index: number } | { kind: "global" };
export type EditorView = "list" | "keyboard" | "kronos" | "panel";
// Style A remembers the view it was left in, apart from the Kronos view flag the other themes use.
export const A_VIEW_KEY = "kronos.view.a";

// Fixed row height keeps the list windowed: only the rows near the scroll position are in the DOM.
const OVERSCAN = 8;
// Rows that are not editable but still shown, because the value names something.
const named = (r: Row): boolean => r.name === "Effect Type" || r.name === "Algorithm Type";
const shown = (r: Row): boolean => isEditable(r) || named(r);
const keyOf = (r: Row): string => `${r.ofs}.${r.bitLo ?? 0}`;
// Group-list entry for Combis: the keyboard map instead of a parameter list.
const KEYMAP = "Keyboard Map";
// Group-list entries for Drum Kits and Wave Sequences: a note map and a step timeline.
const DRUM_MAP = "Drum Map";
const TIMELINE = "Timeline";

export function valueText(tables: ParamTables, r: Row, v: number): string {
  if (r.name === "Effect Type") return tables.effectTypes[v] ?? String(v);
  if (r.name === "Algorithm Type") return ENGINE_NAMES[v] ?? String(v);
  return formatValue(r, v, tables);
}

type Props = {
  tables: ParamTables;
  ws: Workspace;
  target: EditorTarget;
  type: ParamType;
  onChanged: () => void;
  view: EditorView;
  onView: (v: EditorView) => void;
  // Ask & show: rows to jump to and highlight; the editor never writes because of it.
  point?: PointAt | null;
  onPointClear?: () => void;
  onPointFx?: (p: PointAt) => void;
  // Style A: keys the editor bar carries ahead of the view switch.
  lead?: React.ReactNode;
};

export function ParamEditor({ tables, ws, target, type, onChanged, view, onView, point = null, onPointClear, onPointFx, lead = null }: Props) {
  const ROW = useStudio() ? PARAM_ROW_STUDIO : PARAM_ROW;
  const themeA = useThemeA();
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [drumNote, setDrumNote] = useState<number | null>(null);
  const [err, setErr] = useState<{ key: string; message: string } | null>(null);
  const [simple, setSimple] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  // Compare: show the last-saved values instead of the file's. Edits are blocked while it is on.
  const [showSaved, setShowSaved] = useState(false);
  const [viewH, setViewH] = useState(480);
  const listRef = useRef<HTMLDivElement>(null);

  const live = (target.kind === "global" ? getGlobal(ws.file) : getEntry(ws.file, target.key, target.index)) ?? new Uint8Array(0);
  const base = (target.kind === "global" ? ws.baseGlobal() : ws.baseEntry(target.key, target.index)) ?? new Uint8Array(0);
  const cur = showSaved ? base : live;
  // Engine choice decides which EXi rows exist, so the row list is rebuilt only when that changes.
  const engines = type === "exi" ? exiEngines(tables, cur).join("|") : "";
  // KORG's tables leave the group blank on rows that continue the group above, so those rows take the last group named.
  const { rows, all, envs, lfos, filters, keyTracks, vector } = useMemo(() => {
    const out: { r: Row; group: string }[] = [];
    let group = "General";
    const all = paramsFor(tables, type, cur);
    for (const r of all) {
      if (r.group.trim() !== "") group = r.group;
      if (shown(r)) out.push({ r, group });
    }
    return { rows: out, all, envs: findEnvelopes(all), lfos: findLfos(all), filters: findFilters(all), keyTracks: findKeyTracks(all), vector: findVector(all) };
  }, [tables, type, engines]);

  // Screen rows depend only on the table and the engine choice, so they are rebuilt only when those change.
  const screens = useMemo(() => screensFor(pages as PageMap, tables, type, cur), [tables, type, engines]);
  // Kronos view covers Programs and Combis; other sound types fall back to the List view.
  const kp = useMemo(() => (type === "hd1" || type === "exi" || type === "combi" ? kronosPages(type, all, type === "exi" ? exiEngines(tables, cur) : []) : null), [all, type, engines]);
  const kronos = view === "kronos" && kp !== null;
  const panel = themeA && view === "panel" && (type === "hd1" || type === "exi");
  const keyboard = view === "keyboard" && screens !== null;
  const groups = useMemo(() => [...new Set(rows.map((x) => x.group))], [rows]);
  const activeGroup = group !== null && groups.includes(group) ? group : (groups[0] ?? "");
  const needle = query.trim().toLowerCase();
  // The special entry for this kind of slot, shown above the normal groups.
  const special = type === "combi" ? KEYMAP : type === "drumkit" ? DRUM_MAP : type === "waveseq" ? TIMELINE : null;
  const onMap = special !== null && group === special && !needle;
  // On the Drum Map the list shows the selected note's rows, and nothing until a note is picked.
  const drumIdle = onMap && type === "drumkit" && drumNote === null;
  const env = needle || onMap ? undefined : envs.find((e) => e.group === activeGroup);
  const lfo = needle || onMap ? undefined : lfos.find((l) => l.group === activeGroup);
  const filter = needle || onMap ? undefined : filters.find((f) => f.group === activeGroup);
  const keyTrack = needle || onMap ? undefined : keyTracks.find((k) => k.group === activeGroup);
  const vec = needle || onMap || vector?.group !== activeGroup ? undefined : vector;
  const list = useMemo(
    () =>
      needle
        ? rows.filter((x) => x.r.name.toLowerCase().includes(needle) || x.group.toLowerCase().includes(needle))
        : onMap && type === "drumkit"
          ? rows.filter((x) => drumNote !== null && x.group.startsWith(`Note${drumNote + 1} `))
          : rows.filter((x) => x.group === activeGroup),
    [rows, needle, activeGroup, onMap, type, drumNote],
  );

  useLayoutEffect(() => {
    if (listRef.current) setViewH(listRef.current.clientHeight);
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(list.length, Math.ceil((scrollTop + viewH) / ROW) + OVERSCAN);

  const fxRows = useMemo(() => fxRowsOf(all, cur), [all, cur]);
  const listRows = useMemo(() => rows.map((x) => ({ id: keyOf(x.r), group: x.group })), [rows]);
  const uiOf = (id: string) => pointUi(id, { view: kronos && !simple ? "kronos" : "list", kronosFx: type !== "exi" && !!kp, kronosHolds: !!kp && !!locateRow(withOther(kp), id), listRows, fxRows });
  const donePoint = useRef<PointAt | null>(null);
  // Switches to the List view, selects the first row's group, then scrolls to it once per pointer. Effect parameters go to the Effects panel instead.
  useEffect(() => {
    if (!point || donePoint.current === point) return;
    const ui = uiOf(point.ids[0]);
    if (!ui || ui.ui === "kronos") return;
    if (ui.ui === "effects") { donePoint.current = point; onPointFx?.(point); return; }
    if (view !== "list" || simple) {
      setSimple(false);
      onView("list");
      return;
    }
    const row = rows.find((x) => keyOf(x.r) === point.ids[0]);
    if (!row) return;
    if (query !== "" || group !== row.group) {
      setQuery("");
      setGroup(row.group);
      return;
    }
    const i = rowIndexIn(list.map((x) => keyOf(x.r)), point.ids[0]);
    if (i < 0) return;
    donePoint.current = point;
    const top = scrollOffsetFor(i, ROW, viewH, list.length);
    setScrollTop(top);
    if (listRef.current) listRef.current.scrollTop = top;
  }, [point, view, simple, kronos, kp, query, group, rows, list, viewH]);

  function resetScroll() {
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }

  // Reads the stored value again, so a commit always compares with the file as it is now.
  async function commit(r: Row, text: string) {
    const k = keyOf(r);
    const value = text.trim() === "" ? NaN : Number(text);
    if (!Number.isInteger(value) || value < r.rawMin || value > r.rawMax) {
      const range = `${r.rawMin} to ${r.rawMax}`;
      setErr({ key: k, message: `${r.name}: ${text.trim() === "" ? "enter a whole number" : `${text} is not in ${range}`}` });
      return;
    }
    await writeRows([{ row: r, value }]);
  }

  // Every change goes through here: rows that already hold their value are skipped, and the rest are one undo step.
  async function writeRows(writes: Write[]) {
    // shortcut: edits are refused while Compare shows saved values, so nothing lands on a row the user cannot see; the toggle is the way back
    if (showSaved) return;
    const fresh = target.kind === "global" ? getGlobal(ws.file) : getEntry(ws.file, target.key, target.index);
    const todo = writes.filter((w) => !(fresh && readParam(fresh, w.row) === w.value));
    if (todo.length === 0) {
      setErr(null);
      return;
    }
    try {
      if (target.kind === "global") {
        await ws.applyGlobal(() => {
          const g = getGlobal(ws.file)!;
          for (const w of todo) writeParam(g, w.row, w.value);
          setGlobal(ws.file, g);
        });
      } else {
        const { key, index } = target;
        await ws.apply([{ key, index }], () => {
          const e = getEntry(ws.file, key, index);
          for (const w of todo) writeParam(e, w.row, w.value);
          setEntry(ws.file, key, index, e);
        });
      }
      setErr(null);
      onChanged();
    } catch (e) {
      setErr({ key: keyOf(todo[0].row), message: e instanceof Error ? e.message : String(e) });
    }
  }

  // A multisample pick rewrites one zone (type bits, bank, number) as one undo step.
  async function pickMs(osc: 1 | 2, zone: number, ref: MsRef) {
    if (showSaved || target.kind !== "slot") return;
    const { key, index } = target;
    try {
      await ws.apply([{ key, index }], () => setEntry(ws.file, key, index, applyMultisample(getEntry(ws.file, key, index), osc, zone, ref)));
      setErr(null);
      onChanged();
    } catch (e) {
      setErr({ key: "", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const program = type === "hd1" || type === "exi";
  const simpleOn = simple && program;
  // Undo for Simple mode's Reset: each step is one undo, and the workspace redraws after.
  const undoSteps = (n: number) => {
    for (let i = 0; i < n; i++) ws.undo();
    onChanged();
  };
  const choose = (next: EditorView) => {
    localStorage.setItem("kronos.view.kronos", next === "kronos" ? "1" : "0");
    if (themeA) localStorage.setItem(A_VIEW_KEY, next);
    if (clearsPointOn("mode")) onPointClear?.();
    setSimple(false);
    onView(next);
  };

  const viewSwitch = (
    <div className="view-switch" role="group" aria-label="Editor view">
      {themeA && program && (
        <button data-testid="view-panel" data-active={String(panel && !simpleOn)} aria-pressed={panel && !simpleOn} onClick={() => choose("panel")}>
          Panels
        </button>
      )}
      <button data-testid="view-list" data-active={String(!keyboard && !kronos && !simpleOn && !panel)} aria-pressed={!keyboard && !kronos && !simpleOn && !panel} onClick={() => choose("list")}>
        {themeA ? "List view" : "List"}
      </button>
      <button data-testid="view-keyboard" data-active={String(keyboard && !simpleOn)} aria-pressed={keyboard && !simpleOn} disabled={screens === null} onClick={() => choose("keyboard")}>
        Keyboard
      </button>
      <button data-testid="view-kronos" data-active={String(kronos && !simpleOn)} aria-pressed={kronos && !simpleOn} onClick={() => choose("kronos")}>
        Kronos
      </button>
      {program && (
        <button data-testid="view-simple" data-active={String(simpleOn)} aria-pressed={simpleOn} onClick={() => setSimple(true)}>
          Simple
        </button>
      )}
      <button data-testid="compare-toggle" aria-pressed={showSaved} onClick={() => setShowSaved(!showSaved)}>
        Compare
      </button>
    </div>
  );
  // Kept mounted while hidden, so macro positions survive a look at another view.
  const simplePanel = program ? <SimpleView tables={tables} type={type} entry={cur} onWrite={(w) => void writeRows(w)} undo={undoSteps} hidden={!simpleOn} /> : null;

  const snaps =
    target.kind === "slot" && (program || type === "combi") ? (
      <SnapshotsPanel tables={tables} ws={ws} key={target.key + target.index} target={target} type={type} entry={live} onChanged={onChanged} />
    ) : null;

  // Only Style A wraps the bar: the other themes keep the switch and the snapshots as direct children of the editor.
  const bar = themeA ? <div className="ed-bar">{lead}{viewSwitch}{snaps}</div> : <>{viewSwitch}{snaps}</>;

  // The name of the Program a Combi timbre points at; null when that bank is not in this file.
  const programName = (bank: number, program: number): string | null => {
    const k = programKey(bank);
    try {
      return k ? getName(ws.file, k, program) : null;
    } catch {
      return null;
    }
  };

  if (panel && !simpleOn) {
    return (
      <>
        {bar}
        {simplePanel}
        <PanelView
          tables={tables} type={type as "hd1" | "exi"} rows={rows} cur={cur} base={base} pointed={point?.ids ?? []}
          onCommit={(r, text) => void commit(r, text)}
          onGroup={(g) => { setQuery(""); setGroup(g); resetScroll(); choose("list"); }}
        />
      </>
    );
  }

  if (kronos && kp && !simpleOn) {
    return (
      <>
        {bar}
        {simplePanel}
        <KronosView kind={type as "hd1" | "exi" | "combi"} sound={{ bank: target.kind === "slot" ? ws.info(target.key).label : "", index: target.kind === "slot" ? target.index : 0, name: target.kind === "slot" ? getName(ws.file, target.key, target.index) : "" }} engines={type === "exi" ? exiEngines(tables, cur) : []} programName={programName} kp={kp} all={all} graphs={{ envs, lfos, filters, keyTracks, vector }} tables={tables} cur={cur} base={base} point={point} onPointClear={onPointClear} onCommit={(r, text) => void commit(r, text)} onWrite={(w) => void writeRows(w)} />
      </>
    );
  }

  if (keyboard && screens && !simpleOn) {
    return (
      <>
        {bar}
        {simplePanel}
        <HelpScope.Provider value={{ mode: type }}>
          <KeyboardView screens={screens} tables={tables} cur={cur} base={base} onCommit={(r, text) => void commit(r, text)} onWrite={(w) => void writeRows(w)} />
        </HelpScope.Provider>
      </>
    );
  }

  return (
    <HelpScope.Provider value={{ mode: type }}>
      {bar}
      {simplePanel}
      {view === "kronos" && !kp && <p className="muted" data-testid="kronos-note">Kronos view is not available for this sound type yet</p>}
      <div className="editor-body" style={{ display: simpleOn ? "none" : undefined }}>
      <nav className="param-nav" aria-label="Parameter groups">
        <input
          data-testid="param-search"
          type="search"
          aria-label="Search parameters"
          placeholder="Search parameters"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            resetScroll();
          }}
        />
        <div className="group-list">
          {[...(special ? [special] : []), ...groups].map((g) => (
            <button
              key={g}
              data-testid={`group-${g}`}
              className="group"
              aria-current={!needle && (g === special ? onMap : g === activeGroup && !onMap) ? "true" : undefined}
              onClick={() => {
                if (g !== activeGroup && clearsPointOn("page")) onPointClear?.();
                setQuery("");
                setGroup(g);
                setDrumNote(null);
                resetScroll();
              }}
            >
              {g}
            </button>
          ))}
        </div>
      </nav>

      <div className="param-pane">
        {err && (
          <p className="param-error" data-testid="param-error" role="alert">
            {err.message}
          </p>
        )}
        {env && <EnvelopeGraph env={env} entry={cur} onWrite={(w) => void writeRows(w)} />}
        {lfo && <LfoGraph lfo={lfo} entry={cur} />}
        {filter && <FilterGraph f={filter} entry={cur} onWrite={(w) => void writeRows(w)} />}
        {keyTrack && <KeyTrackGraph kt={keyTrack} entry={cur} />}
        {vec && <VectorGraph vec={vec} entry={cur} onWrite={(w) => void writeRows(w)} />}
        {onMap && type === "combi" && target.kind === "slot" && <KeyboardMap tables={tables} file={ws.file} entry={cur} onWrite={(w) => void writeRows(w)} />}
        {onMap && type === "drumkit" && (
          <DrumMap
            tables={tables}
            entry={cur}
            selected={drumNote}
            onSelect={(n) => {
              setDrumNote(n);
              resetScroll();
            }}
          />
        )}
        {onMap && type === "waveseq" && <WaveTimeline tl={waveSeqTimeline(tables, cur)} onWrite={(w) => void writeRows(w)} />}
        <div className="param-list" data-testid="param-list" hidden={onMap && type !== "drumkit"} ref={listRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          {list.length === 0 && !drumIdle && <p className="muted">No parameters match.</p>}
          <div className="param-spacer" style={{ height: list.length * ROW }}>
            {list.slice(first, last).map(({ r, group: g0 }, j) => {
              const k = keyOf(r);
              const group = g0;
              const m = type === "hd1" && target.kind === "slot" ? /^OSC([12]) Trigger$/.exec(g0.trim()) : null;
              const z = m ? /^Zone([1-8]) MS Number$/.exec(r.name) : null;
              return (
                <ParamRow
                  key={k}
                  tables={tables}
                  r={r}
                  group={needle || (onMap && type === "drumkit") ? group : undefined}
                  top={(first + j) * ROW}
                  value={readParam(cur, r)}
                  changed={readParam(live, r) !== readParam(base, r)}
                  pointed={point?.ids.includes(k)}
                  onCommit={(text) => commit(r, text)}
                  extra={m && z ? <MultisamplePicker file={ws.file} entry={cur} osc={Number(m[1]) as 1 | 2} zone={Number(z[1])} k={k} onPick={(ref) => void pickMs(Number(m[1]) as 1 | 2, Number(z[1]), ref)} /> : undefined}
                />
              );
            })}
          </div>
        </div>
      </div>
      </div>
    </HelpScope.Provider>
  );
}

type RowProps = {
  tables: ParamTables;
  r: Row;
  group?: string;
  top?: number;
  // Keyboard view: rows sit in normal flow, and two-state settings show as a toggle.
  flow?: boolean;
  value: number;
  changed: boolean;
  pointed?: boolean;
  onCommit: (text: string) => void;
  extra?: React.ReactNode;
};

export function ParamRow({ tables, r, group, top, flow, value, changed, pointed, onCommit, extra }: RowProps) {
  const studio = useStudio();
  const k = keyOf(r);
  registerParam(r, () => valueText(tables, r, value));
  const editable = isEditable(r);
  const sliderable = editable && r.rawMax - r.rawMin > 1;
  const toggle = flow && editable && r.rawMax - r.rawMin === 1;
  const [draft, setDraft] = useState(String(value));
  const [slide, setSlide] = useState(value);
  // The draft follows the stored value when it changes (an undo, a commit, a load); typing does not change it.
  useEffect(() => setDraft(String(value)), [value]);
  useEffect(() => setSlide(value), [value]);

  return (
    <div className={`${flow ? "param-row kb-row" : "param-row"}${pointed ? " pointed" : ""}`} data-testid={`param-${k}`} {...paramAttrs(r)} data-changed={changed ? "true" : "false"} data-pointed={pointed ? "true" : undefined} style={flow ? undefined : { top }}>
      <span className="param-name"><span className="pn-text">{group && <span className="muted">{group} / </span>}{r.name}{extra}</span><InfoIcon r={r} /></span>
      <span className="param-value" data-testid={`value-${k}`}>
        {valueText(tables, r, value)}
      </span>
      {toggle && (
        <button
          type="button"
          role="switch"
          data-testid={`input-${k}`}
          className="kb-toggle"
          aria-label={r.name}
          aria-checked={value === r.rawMax}
          onClick={() => onCommit(String(value === r.rawMax ? r.rawMin : r.rawMax))}
        >
          {value === r.rawMax ? "On" : "Off"}
        </button>
      )}
      {studio && editable && !toggle && <Step k={k} name={r.name} dir={-1} value={value} min={r.rawMin} max={r.rawMax} onCommit={onCommit} />}
      {editable && !toggle && (
        <input
          data-testid={`input-${k}`}
          className="param-input"
          type="number"
          aria-label={r.name}
          min={r.rawMin}
          max={r.rawMax}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit(draft);
          }}
          onBlur={() => onCommit(draft)}
        />
      )}
      {studio && editable && !toggle && <Step k={k} name={r.name} dir={1} value={value} min={r.rawMin} max={r.rawMax} onCommit={onCommit} />}
      {sliderable && (
        <input
          data-testid={`slider-${k}`}
          className="param-slider"
          type="range"
          aria-label={`${r.name} slider`}
          min={r.rawMin}
          max={r.rawMax}
          step={1}
          value={slide}
          style={fillOf(slide, r.rawMin, r.rawMax)}
          onChange={(e) => setSlide(Number(e.target.value))}
          onPointerUp={(e) => onCommit(e.currentTarget.value)}
          onKeyUp={(e) => onCommit(e.currentTarget.value)}
        />
      )}
    </div>
  );
}

