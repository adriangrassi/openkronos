// Bank tools panel: batch rename with a preview, duplicate and empty finders, and bank list export. Nothing here writes to the keyboard.
import { useState } from "react";
import { applyRenames, findDuplicates, findEmpties, planRename, toCsv, toHtml, type DuplicateGroup, type EmptySlot, type NameOptions, type RenamePlan } from "../../core/pcg/banktools.ts";
import type { BankInfo } from "../../core/pcg/library.ts";
import type { Workspace } from "./document.ts";
import { describeError } from "./keyboard.ts";
import "./BankTools.css";

type LetterCase = NonNullable<NameOptions["letterCase"]>;

const slot = (i: number): string => String(i).padStart(3, "0");
const engine = (t: "exi" | "hd1" | null): string => (t === "exi" ? "EXi" : t === "hd1" ? "HD-1" : "");

interface Props {
  ws: Workspace;
  info: BankInfo;
  sel: number[];
  locked: boolean;
  onChanged: () => void;
  onJump: (key: string, index: number) => void;
  onClose: () => void;
}

export function BankTools({ ws, info, sel, locked, onChanged, onJump, onClose }: Props) {
  const [scope, setScope] = useState<"selected" | "bank">("selected");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [letterCase, setLetterCase] = useState<LetterCase>("keep");
  const [numbered, setNumbered] = useState(false);
  const [start, setStart] = useState("1");
  const [pad, setPad] = useState("2");
  const [at, setAt] = useState<"prefix" | "suffix">("suffix");
  const [sep, setSep] = useState(" ");
  const [dups, setDups] = useState<DuplicateGroup[] | null>(null);
  const [empties, setEmpties] = useState<EmptySlot[] | null>(null);
  const [exportScope, setExportScope] = useState<"bank" | "file">("bank");
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const slots = scope === "bank" ? Array.from({ length: info.count }, (_, i) => i) : sel;
  const numberStart = Number(start);
  const numberPad = Number(pad);
  // shortcut: numbering needs whole numbers and up to 8 digits; the plan is not built until they are
  const numberingOk = !numbered || (Number.isInteger(numberStart) && Number.isInteger(numberPad) && numberPad >= 1 && numberPad <= 8);
  const opts: NameOptions = {
    find,
    replace,
    ignoreCase,
    prefix,
    suffix,
    letterCase,
    numbering: numbered ? { start: numberStart, pad: numberPad, at, sep } : undefined,
  };
  const plan: RenamePlan[] = numberingOk && slots.length > 0 ? planRename(slots.map((i) => ws.nameOf(info.key, i)), opts) : [];
  const canApply = !locked && plan.some((r) => r.from !== r.to) && !plan.some((r) => r.error !== null);

  async function apply() {
    const changes = plan.map((r, n) => ({ index: slots[n], name: r.to }));
    try {
      // One undo step: Workspace.apply records every slot it is given.
      await ws.apply(slots.map((index) => ({ key: info.key, index })), () => {
        applyRenames(ws.file, info.key, changes);
      });
      setDups(null);
      setEmpties(null);
      setErr(null);
      onChanged();
    } catch (e) {
      setErr(describeError(e));
    }
  }

  async function exportList(format: "csv" | "html") {
    const key = exportScope === "bank" ? info.key : null;
    try {
      const content = format === "csv" ? toCsv(ws.file, key) : toHtml(ws.file, key, key ? `${info.label} bank list` : "OpenKronos bank list");
      const saved = await window.kronos.bankToolsExport(format, content);
      setErr(null);
      setStatus(saved ? `Saved ${saved}` : "Export cancelled");
    } catch (e) {
      setStatus("");
      setErr(describeError(e));
    }
  }

  return (
    <section className="banktools" data-testid="banktools-panel" aria-label="Bank tools">
      <div className="bt-head">
        <h2>Bank tools</h2>
        <button data-testid="banktools-close" onClick={onClose}>Close</button>
      </div>
      {err && (
        <p className="bt-error" data-testid="banktools-error" role="alert">
          {err}
        </p>
      )}

      <div className="bt-block">
        <h3>Rename</h3>
        <div className="bt-row">
          <label><input type="radio" name="bt-scope" data-testid="banktools-scope-selected" checked={scope === "selected"} onChange={() => setScope("selected")} /> Selected slots ({sel.length})</label>
          <label><input type="radio" name="bt-scope" data-testid="banktools-scope-bank" checked={scope === "bank"} onChange={() => setScope("bank")} /> Whole bank ({info.count})</label>
        </div>
        <div className="bt-grid">
          <label>Find <input data-testid="banktools-find" value={find} onChange={(e) => setFind(e.target.value)} /></label>
          <label>Replace <input data-testid="banktools-replace" value={replace} onChange={(e) => setReplace(e.target.value)} /></label>
          <label><input type="checkbox" data-testid="banktools-ignore-case" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} /> Ignore case in find</label>
          <label>Prefix <input data-testid="banktools-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} /></label>
          <label>Suffix <input data-testid="banktools-suffix" value={suffix} onChange={(e) => setSuffix(e.target.value)} /></label>
          <label>
            Case
            <select data-testid="banktools-case" value={letterCase} onChange={(e) => setLetterCase(e.target.value as LetterCase)}>
              <option value="keep">Keep</option>
              <option value="upper">UPPER</option>
              <option value="lower">lower</option>
              <option value="title">Title Case</option>
            </select>
          </label>
        </div>
        <div className="bt-grid">
          <label><input type="checkbox" data-testid="banktools-number" checked={numbered} onChange={(e) => setNumbered(e.target.checked)} /> Number</label>
          <label>Start <input type="number" data-testid="banktools-number-start" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>Digits <input type="number" min={1} max={8} data-testid="banktools-number-pad" value={pad} onChange={(e) => setPad(e.target.value)} /></label>
          <label>
            Place
            <select data-testid="banktools-number-at" value={at} onChange={(e) => setAt(e.target.value as "prefix" | "suffix")}>
              <option value="prefix">prefix</option>
              <option value="suffix">suffix</option>
            </select>
          </label>
          <label>Separator <input data-testid="banktools-number-sep" value={sep} onChange={(e) => setSep(e.target.value)} /></label>
        </div>
        {!numberingOk && <p className="bt-error">Start and digits must be whole numbers; digits from 1 to 8.</p>}

        {slots.length === 0 ? (
          <p className="bt-muted">Select slots in the list, or choose the whole bank.</p>
        ) : (
          <table className="bt-preview">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Now</th>
                <th>New</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((r, n) => (
                <tr key={slots[n]} data-testid={`banktools-preview-row-${n}`}>
                  <td>{slot(slots[n])}</td>
                  <td>{r.from}</td>
                  <td>
                    {r.to}
                    {r.error && (
                      <span className="bt-error" data-testid={`banktools-preview-error-${n}`} role="alert">
                        {" "}{r.error}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="bt-row">
          <button data-testid="banktools-apply" onClick={apply} disabled={!canApply}>Apply</button>
        </div>
      </div>

      <div className="bt-block">
        <h3>Duplicates</h3>
        <p className="bt-muted">Slots of one kind and engine with identical sound data, in any bank. Names may differ.</p>
        <button data-testid="banktools-dup-scan" onClick={() => setDups(findDuplicates(ws.file))}>Scan all banks</button>
        {dups && (
          <>
            <p>Groups: <span data-testid="banktools-dup-count">{dups.length}</span></p>
            {dups.map((g, gi) => (
              <div key={gi} className="bt-group" data-testid={`banktools-dup-group-${gi}`}>
                <h4>{`${g.kind} ${engine(g.type)}`.trim()}, {g.slots.length} slots</h4>
                {g.slots.map((s, si) => (
                  <button key={si} data-testid={`banktools-dup-item-${gi}-${si}`} onClick={() => onJump(s.key, s.index)}>
                    {ws.info(s.key).label} {slot(s.index)} {s.name}
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="bt-block">
        <h3>Empty slots</h3>
        <p className="bt-muted">Names starting with Init, or sound data equal to an Init slot of the same kind.</p>
        <button data-testid="banktools-empty-scan" onClick={() => setEmpties(findEmpties(ws.file))}>Scan all banks</button>
        {empties && (
          <>
            <p>Found: <span data-testid="banktools-empty-count">{empties.length}</span></p>
            {empties.map((e, n) => (
              <div key={n}>
                <button data-testid={`banktools-empty-item-${n}`} onClick={() => onJump(e.key, e.index)}>
                  {ws.info(e.key).label} {slot(e.index)} {e.name} <span className="bt-muted">({e.reason === "name" ? "Init name" : "same as Init"})</span>
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="bt-block">
        <h3>Export</h3>
        <div className="bt-row">
          <label><input type="radio" name="bt-export-scope" data-testid="banktools-export-scope-bank" checked={exportScope === "bank"} onChange={() => setExportScope("bank")} /> This bank ({info.label})</label>
          <label><input type="radio" name="bt-export-scope" data-testid="banktools-export-scope-file" checked={exportScope === "file"} onChange={() => setExportScope("file")} /> Whole file</label>
        </div>
        <div className="bt-row">
          <button data-testid="banktools-export-csv" onClick={() => exportList("csv")}>Export CSV</button>
          <button data-testid="banktools-export-html" onClick={() => exportList("html")}>Export printable HTML</button>
        </div>
        <p className="bt-muted" data-testid="banktools-export-status">{status}</p>
      </div>
    </section>
  );
}
