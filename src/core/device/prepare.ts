// What a Combination needs on the keyboard: the Programs its active timbres name, whether the keyboard holds the same bytes, and putting them there.
// A Combi only references stored Programs, so the file can be right while the keyboard plays something else.
import { KronosError, type KronosClient } from "./client.ts";
import { pushEntries, storeBank, type SyncOptions } from "./sync.ts";
import { getEntry, getName, listBanks } from "../pcg/library.ts";
import type { PcgFile } from "../pcg/pcg.ts";
import { readParam, type ParamTables } from "../params/params.ts";
import { bankKeyOf, isFreeName, nameOf } from "../ai/session.ts";

const GLOBAL_CHANNEL = 16;
const pad3 = (i: number): string => String(i).padStart(3, "0");

export type Need = { timbre: number; key: string | null; bankNumber: number; index: number; label: string; name: string; supported: boolean };
export type NeedState = Need & { state: "ready" | "missing" | "unsupported" | "unknown"; keyboardName?: string };
export type ComboState = { state: "ready" | "missing" | "unknown"; keyboardName?: string; label: string; name: string };
export type NeedsRead = { needs: NeedState[]; combi: ComboState };
export type Target = { key: string; index: number; label: string; name: string; keyboardName: string; keyboardFree: boolean };

const timbres = (T: ParamTables, e: Uint8Array): { t: number; status: number; channel: number; bank: number; program: number }[] =>
  Array.from({ length: 16 }, (_, i) => {
    const cell = (name: string) => readParam(e, T.combi.find((r) => r.group === `Timbre${i + 1}` && r.name === name)!);
    return { t: i + 1, status: cell("Status"), channel: cell("MIDI Channel"), bank: cell("Bank Number"), program: cell("Program Number") };
  }).filter((x) => x.status !== 0);

// One Need per distinct Program the Combi's active timbres name.
export function combiNeeds(T: ParamTables, file: PcgFile, key: string, index: number): Need[] {
  const banks = listBanks(file);
  const seen = new Set<string>();
  const out: Need[] = [];
  for (const x of timbres(T, getEntry(file, key, index))) {
    const k = bankKeyOf(x.bank);
    const info = k ? banks.find((b) => b.key === k) : undefined;
    const id = `${x.bank}/${x.program}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!k || !info || x.program >= info.count) out.push({ timbre: x.t, key: null, bankNumber: x.bank, index: x.program, label: `bank ${x.bank} ${pad3(x.program)}`, name: "", supported: false });
    else out.push({ timbre: x.t, key: k, bankNumber: x.bank, index: x.program, label: `${info.label} ${pad3(x.program)}`, name: getName(file, k, x.program), supported: true });
  }
  return out;
}

// Channels other than the global one that a note must go out on for an active timbre to hear it (raw 0..15).
export function extraChannels(T: ParamTables, file: PcgFile, key: string, index: number): number[] {
  if (!key.startsWith("combi:")) return [];
  return [...new Set(timbres(T, getEntry(file, key, index)).map((x) => x.channel).filter((c) => c !== GLOBAL_CHANNEL))].sort((a, b) => a - b);
}

export function needLine(n: NeedState): string {
  if (n.state === "unsupported") return `Timbre ${n.timbre} uses ${n.label}, which this editor cannot put on the keyboard: not supported`;
  const what = `${n.label}${n.name ? ` "${n.name}"` : ""}`;
  const end = { ready: "ready", missing: "not there yet", unknown: "could not read the keyboard" }[n.state];
  return `This Combination needs ${what} on the keyboard: ${end}`;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

// Read-only: asks the keyboard for each Program and for the Combi itself, and compares them with the file.
export async function readNeeds(client: KronosClient, file: PcgFile, T: ParamTables, key: string, index: number): Promise<NeedsRead> {
  const banks = listBanks(file);
  const look = async (obj: number, k: string, i: number): Promise<{ state: "ready" | "missing" | "unknown"; keyboardName?: string }> => {
    const info = banks.find((b) => b.key === k);
    if (!info || info.sysexBank === null) return { state: "unknown" };
    try {
      const data = (await client.requestObject(obj, info.sysexBank, i)).data;
      return { state: same(data, getEntry(file, k, i).subarray(0, info.objectSize)) ? "ready" : "missing", keyboardName: nameOf(data) };
    } catch {
      return { state: "unknown" };
    }
  };
  const needs: NeedState[] = [];
  for (const n of combiNeeds(T, file, key, index)) needs.push(n.supported ? { ...n, ...(await look(0, n.key!, n.index)) } : { ...n, state: "unsupported" });
  return { needs, combi: { ...(await look(1, key, index)), label: `${banks.find((b) => b.key === key)?.label ?? key} ${pad3(index)}`, name: getName(file, key, index) } };
}

// Exactly what a Put on keyboard writes: each missing Program, then the Combi if it is not there. Slots the keyboard could not be read for are left out.
export function targetsOf(file: PcgFile, key: string, index: number, r: NeedsRead): Target[] {
  const banks = listBanks(file);
  const t = (k: string, i: number, keyboardName: string | undefined): Target => ({ key: k, index: i, label: `${banks.find((b) => b.key === k)?.label ?? k} ${pad3(i)}`, name: getName(file, k, i), keyboardName: keyboardName ?? "", keyboardFree: isFreeName(keyboardName ?? "") });
  const out = r.needs.filter((n) => n.state === "missing").map((n) => t(n.key!, n.index, n.keyboardName));
  if (r.combi.state === "missing") out.push(t(key, index, r.combi.keyboardName));
  return out;
}

// Backups first (one per bank), then Send and Store of only the listed slots, bank by bank, then a read-back.
export async function putOnKeyboard(client: KronosClient, file: PcgFile, T: ParamTables, key: string, index: number, targets: Target[], backup: (bankKey: string) => Promise<void>, opts: SyncOptions = {}): Promise<NeedsRead> {
  const keys = [...new Set(targets.map((x) => x.key))];
  for (const k of keys) await backup(k);
  for (const k of keys) {
    await pushEntries(client, file, k, targets.filter((x) => x.key === k).map((x) => x.index), opts);
    await storeBank(client, file, k);
  }
  return readNeeds(client, file, T, key, index);
}

export function prepareErrorText(e: unknown): string {
  if (e instanceof KronosError) {
    if (e.code === 65) return "the keyboard refused: Memory Protect is on (turn it off in Global mode, System Preference), then try again";
    if (e.code === 66) return "the keyboard ran out of memory for this write";
    return `the keyboard refused (${e.message})`;
  }
  return e instanceof Error ? e.message : String(e);
}
