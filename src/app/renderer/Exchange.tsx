// Sound exchange panel: export the selected slots to a .ksound pack, or import one with a preview. Nothing here writes to the keyboard.
import { useEffect, useState } from "react";
import { applyImport, exportPack, parsePack, planImport, type ImportRow, type SoundPack } from "../../core/pcg/exchange.ts";
import type { BankInfo } from "../../core/pcg/library.ts";
import type { Workspace } from "./document.ts";
import { describeError } from "./keyboard.ts";
import "./Exchange.css";

interface Props {
  ws: Workspace;
  info: BankInfo;
  sel: number[];
  locked: boolean;
  onChanged: () => void;
  ask: (message: string, okLabel: string, run: () => void | Promise<void>) => void;
  onClose: () => void;
}

type Preview = { pack: SoundPack; targets: { key: string; index: number }[] };

export function Exchange({ ws, info, sel, locked, onChanged, ask, onClose }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // A different bank or selection makes the old targets meaningless.
  useEffect(() => { setPreview(null); }, [info.key, sel.join(",")]);
  // Rows are recomputed on every render so edits and undo show up; shortcut: planImport is cheap, so no memo.
  const rows: ImportRow[] = preview ? planImport(ws.file, preview.pack, preview.targets) : [];
  const fail = (e: unknown) => { setStatus(""); setPreview(null); setErr(describeError(e)); };

  async function doExport() {
    try {
      if (sel.length === 0) throw new Error("Select the slots to export first");
      const text = exportPack(ws.file, sel.map((index) => ({ key: info.key, index })), `${info.label} sounds`);
      const saved = await window.kronos.exchangeSave(text);
      setErr(null);
      setStatus(saved ? `Exported ${sel.length} sound${sel.length === 1 ? "" : "s"} to ${saved}` : "Export cancelled");
    } catch (e) {
      fail(e);
    }
  }

  async function doImport() {
    try {
      if (sel.length === 0) throw new Error("Select the target slot first");
      const opened = await window.kronos.exchangeOpen();
      if (!opened) return;
      const pack = parsePack(opened.bytes);
      // One selected slot means consecutive slots from it; otherwise the selection in order. Slots past the bank end show as errors.
      const targets = (sel.length === 1 ? pack.sounds.map((_, n) => sel[0] + n) : sel).map((index) => ({ key: info.key, index }));
      setErr(null);
      setStatus("");
      setPreview({ pack, targets });
    } catch (e) {
      fail(e);
    }
  }

  function doApply() {
    if (!preview) return;
    const { pack, targets } = preview;
    ask(`Overwrite ${rows.length} slot${rows.length === 1 ? "" : "s"} in ${info.label} with "${pack.name}"? You can undo it.`, "Import", async () => {
      try {
        await ws.apply(targets, () => applyImport(ws.file, pack, targets));
        setPreview(null);
        setErr(null);
        setStatus(`Imported ${rows.length} sound${rows.length === 1 ? "" : "s"}`);
        onChanged();
      } catch (e) {
        fail(e);
      }
    });
  }

  const canApply = !!preview && !locked && rows.length > 0 && !rows.some((r) => r.error);

  return (
    <section className="exchange" data-testid="exchange-panel" aria-label="Import and export sounds">
      <div className="ex-head">
        <h2>Import and export sounds</h2>
        <button data-testid="exchange-close" onClick={onClose}>Close</button>
      </div>
      <div className="ex-actions">
        <button data-testid="exchange-export" onClick={() => void doExport()} disabled={locked}>Export selected</button>
        <button data-testid="exchange-import" onClick={() => void doImport()} disabled={locked}>Import pack</button>
        <button data-testid="exchange-apply" onClick={doApply} disabled={!canApply}>Apply import</button>
      </div>
      {status && <p className="ex-status" data-testid="exchange-status">{status}</p>}
      {err && <p className="ex-error" data-testid="exchange-error" role="alert">{err}</p>}
      {preview && (
        <table className="ex-rows">
          <tbody>
            {rows.map((r, n) => (
              <tr key={n} data-testid={`exchange-preview-row-${n}`}>
                <td>{r.key ? `${info.label} ${String(r.slot).padStart(3, "0")}` : "no slot"}</td>
                <td>{r.incoming}</td>
                <td>{r.error ? <span className="ex-warn">{r.error}</span> : <span>replaces {r.existing} <span className="ex-warn">(overwrite)</span></span>}{r.warning && <span className="ex-warn"> {r.warning}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
