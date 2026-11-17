// Sound variations panel: three seeded candidates and a morph, applied to the open file as a preview until Keep or Discard.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ParamTables } from "../../core/params/params.ts";
import { candidates, engineOf, morph, type ProgType } from "../../core/params/variations.ts";
import { getEntry, setEntry } from "../../core/pcg/library.ts";
import { HOLD_MESSAGE, type Workspace } from "./document.ts";
import "./Variations.css";

type Props = { tables: ParamTables; ws: Workspace; slotKey: string; index: number; type: ProgType; onChanged: () => void };
type State = "idle" | "preview" | "kept";

export function Variations({ tables, ws, slotKey, index, type, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [strength, setStrength] = useState(30);
  const [pads, setPads] = useState<Uint8Array[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [partner, setPartner] = useState("");
  const [amount, setAmount] = useState(0);
  const original = useRef<Uint8Array | null>(null);
  const clicks = useRef(0);
  const seed0 = useRef(window.kronos.e2eVariationsSeed ?? Math.floor(Math.random() * 2 ** 32));
  const shown = useRef<Uint8Array | null>(null); // the bytes the preview last wrote, to spot outside edits
  const cur = () => getEntry(ws.file, slotKey, index);
  const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
  // Put the original back, record the preview as one undo step, then record any later outside edit as its own step.
  async function commit() {
    const orig = original.current, pre = shown.current;
    if (!orig || !pre || ws.isHeld(slotKey, index)) return; // a held slot is not written, not even to put the original back
    const edited = new Uint8Array(cur());
    original.current = null;
    shown.current = null;
    setEntry(ws.file, slotKey, index, orig);
    await ws.apply([{ key: slotKey, index }], () => setEntry(ws.file, slotKey, index, pre));
    if (!eq(edited, pre)) await ws.apply([{ key: slotKey, index }], () => setEntry(ws.file, slotKey, index, edited));
  }
  const commitRef = useRef(commit);
  commitRef.current = commit;
  // A parameter edit during a preview ends it: the preview is committed, then the edit stands on its own.
  useEffect(() => {
    if (state === "preview" && shown.current && !eq(new Uint8Array(cur()), shown.current)) {
      void commit().then(() => { setState("kept"); setChosen(null); onChanged(); });
    }
  });
  // Leaving the slot or editor: revert an untouched preview, never leave unconfirmed bytes behind.
  useEffect(() => () => {
    const orig = original.current;
    if (!orig) return;
    if (eq(new Uint8Array(cur()), shown.current ?? orig)) { setEntry(ws.file, slotKey, index, orig); ws.refresh(); onChanged(); } else void commitRef.current();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The original is the slot as it is whenever no preview is active.
  const base = (): Uint8Array => (state === "preview" && original.current ? original.current : new Uint8Array(cur()));

  // Computed once per opened slot: scanning every Program on each render made the panel unresponsive.
  const options = useMemo(() => {
  const options: string[] = [];
  const mine = engineOf(tables, type, new Uint8Array(getEntry(ws.file, slotKey, index)));
  for (const b of ws.banks()) {
    if (b.kind !== "program" || b.type !== type) continue;
    for (let i = 0; i < b.count; i++) {
      if ((b.key === slotKey && i === index) || engineOf(tables, type, getEntry(ws.file, b.key, i)) !== mine) continue;
      options.push(`${b.key}|${i}`);
    }
  }
  return options;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, ws, slotKey, index, type]);

  // The select shows the first partner before any choice, so that is the partner the slider uses.
  const who = partner || options[0] || "";

  function show(bytes: Uint8Array) {
    if (ws.isHeld(slotKey, index)) return;
    if (state !== "preview") original.current = new Uint8Array(cur());
    setEntry(ws.file, slotKey, index, bytes);
    shown.current = new Uint8Array(bytes);
    ws.refresh();
    setState("preview");
    onChanged();
  }
  function generate() {
    setPads(candidates(tables, type, base(), strength / 100, (seed0.current + clicks.current++) >>> 0));
    setChosen(null);
  }
  function applyMorph(p: string, amt: number) {
    const [k, i] = p.split("|");
    if (!p) return;
    show(morph(tables, type, base(), new Uint8Array(getEntry(ws.file, k, Number(i))), amt));
  }
  function discard() {
    if (!original.current) return;
    setEntry(ws.file, slotKey, index, original.current);
    original.current = null;
    shown.current = null;
    ws.refresh();
    setState("idle");
    setChosen(null);
    onChanged();
  }
  async function keep() {
    await commit();
    setState("kept");
    onChanged();
  }

  if (!open) return <button data-testid="variations-open" onClick={() => setOpen(true)}>Variations</button>;
  return (
    <div className="variations" data-testid="variations-panel">
      {ws.isHeld(slotKey, index) && <p className="status" data-testid="variations-held">{HOLD_MESSAGE}</p>}
      <div className="variations-row">
        <label>Strength <input data-testid="variations-strength" type="range" min={0} max={100} step={1} value={strength} onChange={(e) => setStrength(Number(e.target.value))} /></label>
        <button data-testid="variations-generate" onClick={generate}>Generate</button>
        <span className="variations-pads">
          {pads && ["A", "B", "C"].map((k, n) => (
            <button key={k} data-testid={`variations-pad-${k}`} data-selected={chosen === n ? "1" : "0"} onClick={() => { setChosen(n); show(pads[n]); }}>{k}</button>
          ))}
        </span>
      </div>
      <div className="variations-row">
        <label>Morph with{" "}
          <select data-testid="variations-morph-with" aria-label="Morph with" value={who} onChange={(e) => { setPartner(e.target.value); applyMorph(e.target.value, amount); }}>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <input data-testid="variations-morph-amount" aria-label="Morph amount" type="range" min={0} max={100} step={1} value={amount} disabled={!who} onChange={(e) => { setAmount(Number(e.target.value)); setChosen(null); applyMorph(who, Number(e.target.value)); }} />
      </div>
      <div className="variations-row">
        <span data-testid="variations-state">{state}</span>
        <button data-testid="variations-keep" disabled={state !== "preview"} onClick={() => void keep()}>Keep</button>
        <button data-testid="variations-discard" disabled={state !== "preview"} onClick={discard}>Discard</button>
      </div>
    </div>
  );
}
