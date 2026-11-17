import { useState } from "react";
import type { BackupSummary } from "../../core/backup/manifest.ts";
import "./BackupManager.css";

type Row = { name: string; bytes: number; summary: BackupSummary | null };

const size = (n: number): string => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Lists, verifies, opens, reveals and deletes saved backups. There is deliberately no restore: nothing here writes to the keyboard.
export function BackupManager({
  locked,
  onOpen,
  ask,
  onError,
}: {
  locked: boolean;
  onOpen: (name: string, bytes: Uint8Array) => void;
  ask: (message: string, okLabel: string, run: () => Promise<void>) => void;
  onError: (message: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [results, setResults] = useState<Record<string, string>>({});

  async function refresh() {
    try {
      setRows(await window.kronos.backupList());
    } catch (e) {
      onError(msg(e));
    }
  }
  const act = (p: Promise<unknown>) => p.catch((e) => onError(msg(e)));

  async function verify(name: string) {
    try {
      const r = await window.kronos.backupVerify(name);
      setResults((x) => ({ ...x, [name]: r.ok ? "Verified" : r.problems.map((p) => `${p.file}: ${p.kind === "mismatch" ? "mismatch" : p.kind === "missing" ? "missing" : p.kind}`).join("\n") }));
    } catch (e) {
      setResults((x) => ({ ...x, [name]: `Could not verify: ${msg(e)}` }));
    }
  }

  async function open(name: string) {
    try {
      const f = await window.kronos.backupOpen(name);
      if (!f) onError("That backup's PCG file is missing.");
      else onOpen(name, f.bytes);
    } catch (e) {
      onError(msg(e));
    }
  }

  return (
    <div className="bkm">
      <button data-testid="backupmgr-open-panel" onClick={() => { setShown(true); void refresh(); }}>Backup Manager</button>
      {shown && (
        <div>
          <button data-testid="backupmgr-refresh" onClick={() => void refresh()}>Refresh</button>
          {rows.length === 0 && <p data-testid="backupmgr-empty">No backups yet.</p>}
          <ul className="bkm-list">
            {rows.map((r, i) => (
              <li key={r.name} className="bkm-row" data-testid={`backupmgr-row-${i}`}>
                <span className="bkm-name">{r.name}</span>
                <span className="bkm-facts">
                  {r.summary ? (
                    <>
                      <span data-testid={`backupmgr-date-${i}`}>{r.summary.created.slice(0, 10)} {r.summary.created.slice(11, 16)}</span>
                      <span data-testid={`backupmgr-os-${i}`}>{r.summary.os}</span>
                      <span>Banks <span data-testid={`backupmgr-banks-${i}`}>{r.summary.banks}</span></span>
                      <span>Objects <span data-testid={`backupmgr-objects-${i}`}>{r.summary.objects}</span></span>
                    </>
                  ) : (
                    <span className="bkm-warn" data-testid={`backupmgr-damaged-${i}`}>Manifest missing or damaged</span>
                  )}
                  <span data-testid={`backupmgr-size-${i}`} data-bytes={r.bytes}>{size(r.bytes)}</span>
                  {r.summary && (
                    <span>Failed <span className={r.summary.failed.length ? "bkm-warn" : undefined} data-testid={`backupmgr-failed-${i}`} title={r.summary.failed.join("\n")}>{r.summary.failed.length || ""}</span></span>
                  )}
                </span>
                {results[r.name] && <p className="bkm-result" data-testid={`backupmgr-verify-result-${i}`}>{results[r.name]}</p>}
                <span className="bkm-actions">
                  <button data-testid={`backupmgr-verify-${i}`} disabled={!r.summary} onClick={() => void verify(r.name)}>Verify</button>
                  <button data-testid={`backupmgr-open-${i}`} disabled={!r.summary || locked} onClick={() => void open(r.name)}>Open</button>
                  <button data-testid={`backupmgr-reveal-${i}`} onClick={() => void act(window.kronos.backupReveal(r.name))}>Reveal</button>
                  <button
                    data-testid={`backupmgr-delete-${i}`}
                    disabled={locked}
                    onClick={() => ask(`Move ${r.name} to the Recycle Bin? The keyboard is not affected.`, "Move to Recycle Bin", async () => { await act(window.kronos.backupDelete(r.name)); await refresh(); })}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
