// Simple mode: one slider per macro. A move is computed from the sound as it was when the first macro left zero, and each change is one undo step.
import { useRef, useState } from "react";
import type { Write } from "../../core/params/graphs.ts";
import { applyMacros, changedSettings, macrosFor, MACRO_NAMES, type Macro, type MacroName } from "../../core/simple/macros.ts";
import { Knob } from "./Knob.tsx";
import { readParam, type ParamTables } from "../../core/params/params.ts";

const LIMIT = 50;
const zeros = (): Record<MacroName, number> => Object.fromEntries(MACRO_NAMES.map((n) => [n, 0])) as Record<MacroName, number>;

type Props = {
  tables: ParamTables;
  type: "hd1" | "exi";
  entry: Uint8Array;
  onWrite: (writes: Write[]) => void;
  // Steps back through the undo history, used by Reset.
  undo: (steps: number) => void;
  hidden: boolean;
};

export function SimpleView({ tables, type, entry, onWrite, undo, hidden }: Props) {
  const [values, setValues] = useState(zeros);
  const [changed, setChanged] = useState<string[]>([]);
  // The sound before the first macro left zero, and how many undo steps the macros have made since.
  const base = useRef<Uint8Array | null>(null);
  const steps = useRef(0);
  const macros = macrosFor(tables, type, entry);
  const byName = new Map<MacroName, Macro>(macros.map((m) => [m.name, m]));

  // Writes every macro's targets, so a macro that returns to zero also restores its settings.
  function commit(name: MacroName, raw: number) {
    const value = Math.min(LIMIT, Math.max(-LIMIT, Math.round(raw)));
    const next = { ...values, [name]: value };
    setValues(next);
    const moves = MACRO_NAMES.filter((n) => next[n] !== 0).map((n) => ({ macro: byName.get(n)!, delta: next[n] }));
    if (moves.length === 0) {
      if (base.current === null) return;
      const restored = Uint8Array.from(base.current);
      const list = changedSettings(entry, restored, macros);
      onWrite(writesFor(macros, restored));
      setChanged(list);
      base.current = null;
      steps.current = 0;
      return;
    }
    if (base.current === null) base.current = Uint8Array.from(entry);
    const result = applyMacros(base.current, moves);
    const list = changedSettings(entry, result, macros);
    setChanged(list);
    if (list.length === 0) return;
    onWrite(writesFor(macros, result));
    steps.current += 1;
  }

  function reset() {
    if (steps.current > 0) undo(steps.current);
    steps.current = 0;
    base.current = null;
    setValues(zeros());
    setChanged([]);
  }

  return (
    <div className="simple-view" data-testid="simple-view" style={{ display: hidden ? "none" : undefined }}>
      <div className="macro-list">
        {MACRO_NAMES.map((name) => {
          const m = byName.get(name)!;
          const empty = m.targets.length === 0;
          return (
            <div className="macro-row" key={name} data-empty={empty ? "true" : "false"}>
              <Knob
                testId={`macro-${name}`}
                label={`${name} macro`}
                min={-LIMIT}
                max={LIMIT}
                value={values[name]}
                disabled={empty}
                onChange={(v) => setValues({ ...values, [name]: v })}
                onCommit={(v) => commit(name, v)}
              />
              <span className="macro-name">{name}</span>
              <input
                data-testid={`macro-input-${name}`}
                className="macro-input"
                data-zero={values[name] === 0 ? "true" : "false"}
                type="number"
                aria-label={`${name} amount`}
                min={-LIMIT}
                max={LIMIT}
                step={1}
                value={values[name]}
                disabled={empty}
                onChange={(e) => setValues({ ...values, [name]: Number(e.target.value) })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit(name, Number(e.currentTarget.value));
                }}
              />
              {empty && <span className="muted macro-none">No settings for this sound</span>}
            </div>
          );
        })}
      </div>
      <p className="macro-changed" data-testid="macro-changed">{changed.join(", ")}</p>
      <div className="macro-actions">
        <button data-testid="macro-reset" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}

// One write per distinct row across all macros, with the value the sound would have.
function writesFor(macros: Macro[], sound: Uint8Array): Write[] {
  const out = new Map<Macro["targets"][number]["row"], Write>();
  for (const m of macros) for (const t of m.targets) out.set(t.row, { row: t.row, value: readParam(sound, t.row) });
  return [...out.values()];
}
