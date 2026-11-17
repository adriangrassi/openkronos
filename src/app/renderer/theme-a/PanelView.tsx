// Style A panel view of a Program: titled cards of encoders and faders. Every control is a real parameter row drawn by the same Dial / Fader / Toggle / Choice the Kronos view uses, so ids, test ids, undo, Live and A/B follow the List view's write path.
import { memo, useMemo } from "react";
import { readParam, type ParamTables, type Row } from "../../../core/params/params.ts";
import { cardsFor, type Card, type ListRow } from "../../../core/pages/cards.ts";
import { FILTER_TYPES, panText } from "../../../core/pages/mixer.ts";
import { MChoice, MDial, MFader, MToggle } from "../KronosMemo.tsx";
import type { CtlProps } from "../KronosControls.tsx";
import { valueText } from "../ParamEditor.tsx";
import { HelpScope, InfoIcon } from "../InfoIcon.tsx";
import { keyOf } from "../../../core/pages/view.ts";
import "./panel.css";

type Props = {
  tables: ParamTables;
  type: "hd1" | "exi";
  rows: ListRow[];
  cur: Uint8Array;
  base: Uint8Array;
  pointed: readonly string[];
  onCommit: (r: Row, text: string) => void;
  // Opens the List view on this group (the Other card's chips).
  onGroup: (group: string) => void;
};

const fmtCache = new WeakMap<Row, (v: number) => string>();

export const PanelView = memo(function PanelView({ tables, type, rows, cur, base, pointed, onCommit, onGroup }: Props) {
  const set = useMemo(() => cardsFor(rows, type), [rows, type]);
  const fmtOf = (r: Row): ((v: number) => string) => {
    let f = fmtCache.get(r);
    if (!f) {
      f = r.name === "Filter Type" && r.rawMax === 3 ? (v) => FILTER_TYPES[v] ?? String(v) : r.valueText.startsWith("RND") ? (v) => panText(v) : (v) => valueText(tables, r, v);
      fmtCache.set(r, f);
    }
    return f;
  };
  const ctl = (r: Row, over?: Partial<CtlProps>): CtlProps => ({
    r, value: readParam(cur, r), base: readParam(base, r), changed: readParam(cur, r) !== readParam(base, r), pointed: pointed.includes(keyOf(r)), fmt: fmtOf(r), onCommit: (t) => onCommit(r, t), ...over,
  });
  const otherCount = set.other.reduce((n, g) => n + g.rows.length, 0);

  // A label of more than 10 characters wraps to two lines, so its group reserves two lines and the values stay level.
  const long = (x: Card["cells"][number]) => (x.label ?? x.row.name).length > 10;
  const body = (c: Card) => {
    const of = (k: string) => c.cells.filter((x) => x.kind === k);
    const switches = [...of("pick"), ...of("toggle")], dials = of("dial"), faders = of("fader");
    return (
      <>
        {switches.length > 0 && (
          <div className="pv-switches">
            {switches.map((x) => (x.kind === "pick" ? <MChoice key={keyOf(x.row)} {...ctl(x.row, { label: x.label })} /> : <MToggle key={keyOf(x.row)} {...ctl(x.row, { label: x.label })} />))}
          </div>
        )}
        <div className="pv-controls">
          {dials.length > 0 && (
            <div className="pv-dials" data-n={dials.length} data-long={dials.some(long)}>
              {dials.map((x) => <MDial key={keyOf(x.row)} {...ctl(x.row, x.pan ? { fmt: panText, centre: 0.5, label: x.label } : { label: x.label })} help={<InfoIcon r={x.row} label={x.label} />} />)}
            </div>
          )}
          {faders.length > 0 && (
            <div className="pv-faders" data-long={faders.some(long)}>
              {faders.map((x) => <MFader key={keyOf(x.row)} {...ctl(x.row, { label: x.label })} height={86} help={<InfoIcon r={x.row} label={x.label} />} />)}
            </div>
          )}
        </div>
      </>
    );
  };

  const other = (
    <fieldset key="other" className="pv-card pv-other" data-testid="panel-other" style={{ flexGrow: 1.36 }}>
      <legend className="pv-title">Other</legend>
      <p className="pv-note"><span data-testid="panel-other-count">{otherCount}</span> more parameters are in the List view.</p>
      <div className="pv-chips">
        {set.other.map((g) => <button key={g.group} type="button" className="pv-chip" data-testid={`panel-other-${g.group}`} title={`Open ${g.group} in the List view`} onClick={() => onGroup(g.group)}>{g.group}<span>{g.rows.length}</span></button>)}
      </div>
    </fieldset>
  );

  const card = (c: Card) => <fieldset key={c.id} className="pv-card" data-card={c.id} style={{ flexGrow: c.w }}><legend className="pv-title">{c.title}</legend>{body(c)}</fieldset>;
  // Three to a row, in order, Other last: the rows stretch their cards to one height.
  const items = [...set.cards.map(card), other];
  const lines = Array.from({ length: Math.ceil(items.length / 3) }, (_, i) => items.slice(i * 3, i * 3 + 3));

  return (
    <HelpScope.Provider value={{ mode: type }}>
    <div className="pv" data-testid="panel-view" data-placed={set.placed} data-total={set.total}>
      {lines.map((l, i) => <div className="pv-row" key={i}>{l}</div>)}
    </div>
    </HelpScope.Provider>
  );
});
