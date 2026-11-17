import { useState } from "react";
import { listBanks } from "../../core/pcg/library.ts";
import { serializePcg } from "../../core/pcg/pcg.ts";
import { pullFull, type SyncOptions } from "../../core/device/sync.ts";
import type { BackupFile } from "../shared/api.ts";
import type { Link } from "./keyboard.ts";

// The App's transfer helper: it shows progress and the Cancel button, and leaves the open library alone.
type Transfer = (
  label: string,
  total: number,
  cancelled: string,
  work: (opts: SyncOptions, phase: (next: string, n: number) => void) => Promise<void>,
) => Promise<boolean>;

const stamp = (): string => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

// Pulls everything the keyboard can send and writes it as a folder, with a manifest of hashes.
export function BackupPanel({ link, locked, transfer }: { link: Link | null; locked: boolean; transfer: Transfer }) {
  const [status, setStatus] = useState("");

  async function run() {
    if (!link || locked) return;
    const client = link.client;
    const api = window.kronos;
    let result = "";
    const ok = await transfer("Full backup: reading the keyboard", 1, "Backup cancelled. Nothing was written.", async (opts, phase) => {
      const id = await client.identify();
      const pull = await pullFull(client, opts);
      phase("Writing the backup", 1);
      const folder = await api.backupBegin(`Kronos Backup ${stamp()}`);
      const pcgName = `${folder}.PCG`;
      const pcgBytes = serializePcg(pull.pcg);
      const objectFiles = pull.objects.map((o) => ({ ...o, file: `objects/${o.obj}-${o.bank}-${o.index}.bin` }));
      const files: BackupFile[] = [{ name: pcgName, bytes: pcgBytes }, ...objectFiles.map((o) => ({ name: o.file, bytes: o.data }))];
      // The write call takes at most 1000 files, and a keyboard can hold more KARMA objects than that.
      const sha: Record<string, string> = {};
      for (let i = 0; i < files.length; i += 200) Object.assign(sha, await api.backupWrite(folder, files.slice(i, i + 200)));
      const manifest = {
        created: new Date().toISOString(),
        os: `Kronos OS ${id.version[0]}.${id.version[1]}.${id.version[2]}`,
        pcg: { file: pcgName, sha256: sha[pcgName], size: pcgBytes.length },
        banks: listBanks(pull.pcg).map((b) => b.key),
        objects: objectFiles.map((o) => ({ obj: o.obj, bank: o.bank, index: o.index, version: o.version, file: o.file, sha256: sha[o.file] })),
        notIncluded: pull.report.notIncluded,
        failed: pull.report.failed,
      };
      await api.backupWrite(folder, [{ name: "manifest.json", bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }]);
      const failed = pull.report.failed.length
        ? ` ${pull.report.failed.length} item(s) failed: ${pull.report.failed.join("; ")}.`
        : "";
      result = `Backup complete in ${folder}: ${manifest.banks.length} banks, ${objectFiles.length} raw objects.${failed} Not included: ${pull.report.notIncluded.join(" ")}`;
    });
    if (ok) setStatus(result);
  }

  return (
    <>
      <button data-testid="full-backup" onClick={run} disabled={!link || locked}>Full Backup</button>
      <p className="status" data-testid="backup-status" role="status">{status}</p>
    </>
  );
}
