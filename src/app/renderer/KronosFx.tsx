// Kronos adapter of the generic effect page: maps the chosen effect type's rows to controls, graphs and the type button.
import { useMemo, useState } from "react";
import { descNumber, descPos, descText, groupDescs, type ParamDesc } from "../../core/fx/desc.ts";
import type { FxGet, FxGraphSpec, FxVal } from "../../core/fx/graphs.ts";
import { effectRowsAt, effectTypeWrites } from "../../core/params/effects.ts";
import { kronosFxDescs, kronosFxCategories } from "../../core/params/fx-kronos.ts";
import { kronosFxGraphs } from "../../core/params/fx-kronos-family.ts";
import { isEditable, readParam, type Row } from "../../core/params/params.ts";
import type { Write } from "../../core/params/graphs.ts";
import { keyOf } from "../../core/pages/view.ts";
import type { CtlProps } from "./KronosControls.tsx";
import { MBoxField, MCheck, MPick, MReadOnly, MToggle } from "./KronosMemo.tsx";
import { FxGraph } from "./fx/FxGraph.tsx";
import { FxPage } from "./fx/FxPage.tsx";
import { FxTypePicker } from "./fx/FxTypePicker.tsx";
import "./KronosFx.css";

const pad3 = (n: number) => String(n).padStart(3, "0");
const labels = new Map(kronosFxCategories().flatMap((c) => c.items).map((i) => [i.id, i.label]));
// The type's name without its "NNN: " prefix; "" for an id outside the table.
export const fxTypeName = (id: number): string => labels.get(id)?.slice(5) ?? "";

type RowOf = (g: string, n: string) => Row | undefined;

export function KronosFxTypeButton({ group, rowOf, cur, onWrite }: { group: string; rowOf: RowOf; cur: Uint8Array; onWrite: (w: Write[]) => void }) {
  const [open, setOpen] = useState(false);
  const typeRow = rowOf(group, "Effect Type");
  if (!typeRow) return <span className="kl-missing" />;
  const id = readParam(cur, typeRow);
  return (
    <>
      <button type="button" className="kfx-type" data-testid="fxt-button" title="Change the effect type" onClick={() => setOpen(true)}>{`${pad3(id)}: ${fxTypeName(id)}`}</button>
      {open && <FxTypePicker categories={kronosFxCategories()} value={id} onPick={(n) => onWrite(effectTypeWrites(cur, typeRow.ofs, n))} onClose={() => setOpen(false)} />}
    </>
  );
}

const fmtCache = new WeakMap<Row, (v: number) => string>();
const fmtOf = (r: Row, d: ParamDesc) => {
  let f = fmtCache.get(r);
  if (!f) fmtCache.set(r, (f = (v) => descText(d, v)));
  return f;
};

// A page with many boxes would put three elements in the DOM per box: the real control mounts when the pointer or focus arrives.
function LazyBox(p: CtlProps) {
  const [open, setOpen] = useState(false);
  if (open) return <MBoxField {...p} />;
  const wake = () => setOpen(true);
  return (
    <div className="kc kc-box" data-testid={`param-${keyOf(p.r)}`} data-changed={String(p.changed)} onPointerEnter={wake} onFocus={wake}>
      <div className="kc-boxframe"><span className="kc-value kc-boxval" role="button" tabIndex={0} data-testid={`value-${keyOf(p.r)}`}>{p.fmt(p.value)}</span></div>
    </div>
  );
}

const HEAVY = 40;
const byNameMemo = new WeakMap<ParamDesc[], Map<string, ParamDesc>>();

export function KronosFxPage(p: { kind: "hd1" | "combi"; group: string; rowOf: RowOf; cur: Uint8Array; ctl: (r: Row) => CtlProps; onWrite: (w: Write[]) => void; tempo?: number }) {
  const { kind, group, rowOf, cur, ctl, onWrite, tempo } = p;
  const typeRow = rowOf(group, "Effect Type");
  const typeId = typeRow ? readParam(cur, typeRow) : 0;
  const rows = typeRow ? effectRowsAt(typeRow.ofs, typeId, group) : null;
  const descs = kronosFxDescs(typeId);
  const byKey = useMemo(() => new Map((rows ?? []).map((r) => [String(r.pid), r])), [rows]);
  const sections = useMemo(() => groupDescs(descs), [descs]);
  const graphs = kronosFxGraphs(typeId);
  const heavy = descs.length > HEAVY;
  const sw = rowOf(group, "Switch"), ch = rowOf(group, "Channel");

  let names = byNameMemo.get(descs);
  if (!names) byNameMemo.set(descs, (names = new Map(descs.map((d) => [d.name, d]))));
  const get: FxGet = (name) => {
    const d = names!.get(name), r = d && byKey.get(d.key);
    if (!d || !r) return undefined;
    const raw = readParam(cur, r);
    return { raw, n: descNumber(d, raw), t: descPos(d, raw), text: descText(d, raw) } satisfies FxVal;
  };
  const render = (d: ParamDesc) => {
    const r = byKey.get(d.key);
    if (!r) return null;
    const c: CtlProps = { ...ctl(r), fmt: fmtOf(r, d) };
    if (!isEditable(r)) return <MReadOnly {...c} label="" />;
    if (d.kind === "check") return <MCheck {...c} label="" />;
    if (d.kind === "pick") return <MPick {...c} />;
    return heavy ? <LazyBox {...c} /> : <MBoxField {...c} encoder />;
  };
  const header = (
    <>
      {ch && isEditable(ch) && kind === "combi" && <MPick {...ctl(ch)} />}
      {sw && <MToggle {...ctl(sw)} label="On" />}
      <KronosFxTypeButton group={group} rowOf={rowOf} cur={cur} onWrite={onWrite} />
    </>
  );
  return (
    <FxPage
      title={typeId === 0 ? "No Effect" : fxTypeName(typeId)}
      header={header}
      sections={sections}
      graphs={graphs}
      render={render}
      graph={(spec: FxGraphSpec) => <FxGraph spec={spec} get={get} tempo={tempo} />}
    />
  );
}
