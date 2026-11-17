// Compare panel: a second .PCG opened read-only, its differing slots per bank, copies into the open file, and a parameter diff of two sounds.
import { useMemo, useState } from "react";
import { getEntry, listBanks, type BankInfo } from "../../core/pcg/library.ts";
import { parsePcg, type PcgFile } from "../../core/pcg/pcg.ts";
import { changedTargets, compareBanks, compareSlots, copyBlocker, copyFromCompare, diffSounds, type CopyItem, type ParamDiff } from "../../core/pcg/compare.ts";
import type { ParamTables, ParamType } from "../../core/params/params.ts";
import type { Workspace } from "./document.ts";
import { describeError } from "./keyboard.ts";
import { Collapse } from "./Collapse.tsx";
import "./compare.css";

type Props = {
  ws: Workspace;
  locked: boolean;
  // The workspace's change list. Its identity moves on every edit, so the bank counts are rebuilt after each one.
  changes: unknown;
  onChanged: () => void;
  // Choosing a bank here (listed or receiving the copy) also shows it in the slot list, so both sides line up.
  onBank: (key: string) => void;
  ask: (message: string, okLabel: string, run: () => void | Promise<void>) => void;
};

type Compare = { name: string; file: PcgFile };
type Sound = { type: ParamType; entry: Uint8Array };

const slot = (i: number) => String(i).padStart(3, "0");

// The parameter table a bank's objects use. Same rule as the slot editor.
function typeOf(info: BankInfo): ParamType | null {
  if (info.kind === "program") return info.type === "exi" ? "exi" : "hd1";
  if (info.kind === "combi") return "combi";
  if (info.kind === "drumkit") return "drumkit";
  if (info.kind === "waveseq") return "waveseq";
  return null;
}

// A sound as "open|<bank key>|<index>" or "compare|<bank key>|<index>". Throws with the reason.
function soundOf(ws: Workspace, cmp: Compare | null, ref: string): Sound {
  const [side, key, text] = ref.trim().split("|");
  const file = side === "open" ? ws.file : side === "compare" ? cmp?.file : undefined;
  if (!file) throw new Error(`"${ref}": open a compare file first, or start with open| or compare|`);
  const info = listBanks(file).find((b) => b.key === key);
  if (!info) throw new Error(`no bank ${key ?? ""} in that file`);
  const type = typeOf(info);
  if (type === null) throw new Error(`${info.label} has no parameters to compare`);
  const index = Number(text);
  if (!Number.isInteger(index) || index < 0 || index >= info.count) throw new Error(`slot ${text ?? ""} is out of range for ${info.label}`);
  return { type, entry: getEntry(file, key, index) };
}

export function ComparePanel({ ws, locked, changes, onChanged, onBank, ask }: Props) {
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [bankKey, setBankKey] = useState<string | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [targetBank, setTargetBank] = useState<string | null>(null);
  const [targetSlot, setTargetSlot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refA, setRefA] = useState("");
  const [refB, setRefB] = useState("");
  const [diff, setDiff] = useState<ParamDiff[] | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Rebuilt only when the open file or the compare file changes, or after an edit (changes moves).
  const counts = useMemo(() => (cmp ? compareBanks(ws.file, cmp.file) : []), [ws, cmp, changes]);
  const listed = counts.find((c) => c.key === bankKey) ? bankKey : (counts[0]?.key ?? null);
  // A bank with no differences would list nothing under the filter, so it shows every slot instead.
  const listedDiffers = (counts.find((c) => c.key === listed)?.differing ?? 0) > 0;
  const filtered = onlyDiff && listedDiffers;
  const rows = useMemo(
    () => (cmp && listed ? compareSlots(ws.file, cmp.file, listed, filtered) : []),
    [ws, cmp, listed, filtered, changes],
  );
  const dst = targetBank && ws.banks().some((b) => b.key === targetBank) ? targetBank : listed;
  const pickedSet = new Set(picked);

  async function openCompare() {
    if (locked) return;
    try {
      const opened = await window.kronos.compareOpen();
      if (!opened) return;
      setCmp({ name: opened.name, file: parsePcg(opened.bytes) });
      setBankKey(null);
      setPicked([]);
      setDiff(null);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }

  function chooseBank(key: string) {
    setBankKey(key);
    setTargetBank(key);
    setPicked([]);
    onBank(key);
  }

  function pick(i: number) {
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i].sort((a, b) => a - b)));
  }

  function copy() {
    if (!cmp || !listed || !dst || picked.length === 0 || locked) return;
    const start = targetSlot.trim() === "" ? null : Number(targetSlot);
    if (start !== null && !Number.isInteger(start)) {
      setError("enter a whole slot number, or leave it empty to use the same slots");
      return;
    }
    // Slots keep their spacing: the first picked slot goes to the target, the rest follow it.
    const first = picked[0];
    const items: CopyItem[] = picked.map((i) => ({
      from: { key: listed, index: i },
      to: { key: dst, index: start === null ? i : start + (i - first) },
    }));
    for (const item of items) {
      const why = copyBlocker(ws.file, cmp.file, item);
      if (why !== null) {
        setError(why);
        return;
      }
    }
    setError(null);
    const run = async () => {
      try {
        await ws.apply(items.map((i) => i.to), () => copyFromCompare(ws.file, cmp.file, items));
        setError(null);
        onChanged();
      } catch (e) {
        setError(describeError(e));
      }
    };
    const over = changedTargets(ws.file, ws.savedFile(), items);
    if (over.length > 0) {
      ask(`Overwrite ${over.length} slot${over.length === 1 ? "" : "s"} that changed since the file was opened or saved? This is one undo step.`, "Copy", run);
    } else {
      void run();
    }
  }

  async function diffGo() {
    try {
      const a = soundOf(ws, cmp, refA);
      const b = soundOf(ws, cmp, refB);
      const mod = await import("../../generated/params.json");
      setDiff(diffSounds(mod.default as unknown as ParamTables, a, b));
      setDiffError(null);
    } catch (e) {
      setDiff(null);
      setDiffError(describeError(e));
    }
  }

  return (
    <Collapse title="Compare" label="Compare files" className="compare">
      <div className="compare-bar">
        <button data-testid="compare-open" onClick={openCompare} disabled={locked}>Open compare file</button>
      </div>
      {error && (
        <p className="compare-error" data-testid="compare-error" role="alert">
          {error}
        </p>
      )}
      {cmp && (
        <div data-testid="compare-panel">
          <p className="compare-file" data-testid="compare-file-name" title="Read only">{cmp.name}</p>
          <div className="compare-banks" aria-label="Banks that differ">
            {counts.map((c) => (
              <button
                key={c.key}
                data-testid={`compare-bank-${c.key}`}
                className="bank"
                aria-current={c.key === listed ? "true" : undefined}
                onClick={() => chooseBank(c.key)}
              >
                <span>{c.label}</span>
                <span className="num" data-testid={`compare-count-${c.key}`}>{c.differing}</span>
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" data-testid="compare-only-diff" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
            Differences only
          </label>
          {onlyDiff && !listedDiffers && <p className="muted">No differences in this bank, so every slot is shown.</p>}
          <div className="compare-rows" role="listbox" aria-multiselectable="true" aria-label="Compared slots">
            {rows.map((r) => (
              <div key={r.index} className={`compare-row${r.differs ? " differs" : ""}`} data-testid={`compare-row-${r.index}`}>
                <input type="checkbox" data-testid={`compare-select-${r.index}`} aria-label={`Select slot ${slot(r.index)}`} checked={pickedSet.has(r.index)} onChange={() => pick(r.index)} />
                <span className="slot">{slot(r.index)}</span>
                <span className="name" data-testid={`compare-name-a-${r.index}`}>{r.nameA}</span>
                <span className="name" data-testid={`compare-name-b-${r.index}`}>{r.nameB}</span>
              </div>
            ))}
          </div>
          <div className="compare-copy">
            <select data-testid="compare-target-bank" aria-label="Bank that receives the copy" value={dst ?? ""} onChange={(e) => {
                setTargetBank(e.target.value);
                onBank(e.target.value);
              }} disabled={locked}>
              {ws.banks().map((b) => (
                <option key={b.key} value={b.key}>{b.label}</option>
              ))}
            </select>
            <input data-testid="compare-target" type="number" min={0} aria-label="First target slot" placeholder="same slots" value={targetSlot} onChange={(e) => setTargetSlot(e.target.value)} />
            <button data-testid="compare-copy-selected" onClick={copy} disabled={locked || picked.length === 0}>Copy selected</button>
          </div>

          <div className="compare-diff">
            <h2>Sound diff</h2>
            <input data-testid="compare-ref-a" aria-label="Sound A" placeholder="open|program:INT-B|5" value={refA} onChange={(e) => setRefA(e.target.value)} />
            <input data-testid="compare-ref-b" aria-label="Sound B" placeholder="compare|program:INT-B|5" value={refB} onChange={(e) => setRefB(e.target.value)} />
            <button data-testid="compare-diff-go" onClick={diffGo}>Compare sounds</button>
            {diffError && <p className="compare-error" data-testid="compare-diff-error" role="alert">{diffError}</p>}
            {diff && (
              <>
                <p className="muted">Differing settings: <span data-testid="compare-param-count">{diff.length}</span></p>
                <table className="compare-params">
                  <thead>
                    <tr>
                      <th>Page</th>
                      <th>Parameter</th>
                      <th>A</th>
                      <th>B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.map((d, n) => (
                      <tr key={n} data-testid={`compare-param-row-${n}`}>
                        <td data-testid={`compare-param-group-${n}`}>{d.group}</td>
                        <td data-testid={`compare-param-name-${n}`}>{d.name}</td>
                        <td data-testid={`compare-param-a-${n}`}>{d.a}</td>
                        <td data-testid={`compare-param-b-${n}`}>{d.b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </Collapse>
  );
}
