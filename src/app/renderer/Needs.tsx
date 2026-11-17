// The dependency line of a Combination: which Programs it needs on the keyboard, and whether the keyboard holds them yet.
import { useEffect, useMemo, useState } from "react";
import { combiNeeds, readNeeds, type NeedsRead } from "../../core/device/prepare.ts";
import type { ParamTables } from "../../core/params/params.ts";
import type { Workspace } from "./document.ts";
import type { Link } from "./keyboard.ts";

type Slot = { key: string; index: number };
export type NeedsInfo = { slot: Slot; label: string; name: string; needs: ReturnType<typeof combiNeeds>; read: NeedsRead | null };

// The file's view of a Combi's needs at once, and the keyboard's after a read. Reads wait for a pause in editing and stop while the link is busy.
export function useNeeds(ws: Workspace | null, link: Link | null, tables: ParamTables | null, slot: Slot | null, rev: number, paused: boolean, nonce = 0): NeedsInfo | null {
  const isCombi = !!ws && !!slot && ws.banks().some((b) => b.key === slot.key && b.kind === "combi");
  const needs = useMemo(() => (ws && tables && slot && isCombi ? combiNeeds(tables, ws.file, slot.key, slot.index) : null), [ws, tables, slot?.key, slot?.index, isCombi, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const [read, setRead] = useState<NeedsRead | null>(null);
  useEffect(() => {
    if (!ws || !tables || !slot || !isCombi || !link || paused) { if (!link) setRead(null); return; }
    let live = true;
    const t = setTimeout(() => {
      void readNeeds(link.client, ws.file, tables, slot.key, slot.index).then((r) => { if (live) setRead(r); }, () => { if (live) setRead(null); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [ws, tables, slot?.key, slot?.index, isCombi, link, paused, rev, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ws || !slot || !needs) return null;
  const b = ws.info(slot.key);
  return { slot, label: `${b.label} ${String(slot.index).padStart(3, "0")}`, name: ws.nameOf(slot.key, slot.index), needs, read: link ? read : null };
}

// ready: everything is on the keyboard; missing: something is not; unknown: no read yet or no keyboard.
export function needsState(n: NeedsInfo): "ready" | "missing" | "unknown" {
  if (!n.read) return "unknown";
  const all = [...n.read.needs.map((x) => x.state), n.read.combi.state];
  return all.includes("missing") ? "missing" : all.every((s) => s === "ready" || s === "unsupported") ? "ready" : "unknown";
}

const END = { ready: "ready", missing: "not there yet", unknown: "connect the Kronos to check", unsupported: "not supported" };

// One short phrase for the dock: "needs U-FF 000 on keyboard: ready".
export function needsShort(n: NeedsInfo): string {
  const st = needsState(n);
  const miss = n.read ? n.read.needs.filter((x) => x.state === "missing").map((x) => x.label) : [];
  const all = n.needs.filter((x) => x.supported).map((x) => x.label);
  const what = (miss.length ? miss : all).join(", ");
  return what ? `needs ${what} on keyboard: ${st === "unknown" ? "not checked" : st === "ready" ? "ready" : "not there"}` : st === "missing" ? "not on keyboard yet" : "";
}

export function NeedsView({ info, onPrepare, why }: { info: NeedsInfo; onPrepare?: (s: Slot) => void; why?: string | null }) {
  const st = needsState(info);
  const lines = info.needs.map((n) => {
    const s = n.supported ? info.read?.needs.find((x) => x.timbre === n.timbre)?.state ?? "unknown" : "unsupported";
    const text = n.supported ? `This Combination needs ${n.label} "${n.name}" on the keyboard: ${s === "unknown" && info.read ? "could not read the keyboard" : END[s]}` : `Timbre ${n.timbre} uses ${n.label}, which this editor cannot put on the keyboard: not supported`;
    return { n, s, text };
  });
  const c = info.read?.combi;
  return (
    <div className="needs" data-testid="needs" data-state={st}>
      {lines.map(({ n, s, text }) => <p key={`${n.timbre}`} className="status" data-testid="need-line" data-state={s}>{text}</p>)}
      {c && <p className="status" data-testid="need-combi" data-state={c.state}>{`Combination ${c.label} "${c.name}" on the keyboard: ${c.state === "ready" ? "ready" : c.state === "missing" ? "not there yet" : "could not read the keyboard"}`}</p>}
      {onPrepare && st === "missing" && (
        <div className="buttons">
          <button type="button" data-testid="prepare-keyboard" onClick={() => onPrepare(info.slot)} disabled={!!why} title={why ?? "Write what this Combination needs to the keyboard, with a backup first"}>Put on keyboard</button>
        </div>
      )}
    </div>
  );
}

// The same line for a Combi that is not the open one, such as an AI review's result.
export function NeedsFor({ ws, link, tables, slot, rev, paused, nonce, onPrepare, why }: { ws: Workspace | null; link: Link | null; tables: ParamTables | null; slot: Slot; rev: number; paused: boolean; nonce: number; onPrepare?: (s: Slot) => void; why?: string | null }) {
  const info = useNeeds(ws, link, tables, slot, rev, paused, nonce);
  return info && info.needs.length > 0 ? <NeedsView info={info} onPrepare={onPrepare} why={why} /> : null;
}
