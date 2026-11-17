// The open library: the working file, the file as opened or last saved, and undo/redo kept as the bytes of changed slots or Global.
import { getEntry, getGlobal, getName, getSetList, listBanks, setEntry, setGlobal, setName, setSetList, type BankInfo } from "../../core/pcg/library.ts";
import { parsePcg, serializePcg, type PcgFile } from "../../core/pcg/pcg.ts";
import { sameBytes } from "./bytes.ts";
import { refsToCached, type BankRefs, type Ref } from "../../core/pcg/refs.ts";

export interface Slot {
  key: string;
  index: number;
}

export interface Change extends Slot {
  before: string;
  after: string;
  // True when bytes other than the 24-byte name differ (Global is always a settings change).
  settings: boolean;
}

// Global has no bank or slot: it is listed under this key with index -1.
export const GLOBAL_KEY = "global";

interface Step {
  label: string;
  edit: Entry[];
}

interface Entry extends Slot {
  before: Uint8Array;
  after: Uint8Array;
  // A Set List is restored as its SBK1 entry plus the SDB1 companion, so both bytes are kept.
  beforeCompanion: Uint8Array | null;
  afterCompanion: Uint8Array | null;
  setList: boolean;
  global: boolean;
}

export const HOLD_MESSAGE = "This sound has pending AI changes: Keep or Discard first";
export const RUN_MESSAGE = "AI is working: wait for it to finish or cancel it";
const NAME_LEN = 24;
const same = sameBytes;

export function nameFromBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < NAME_LEN; i++) s += String.fromCharCode(bytes[i]);
  return s.replace(/[\0 ]+$/, "");
}

export class Workspace {
  file: PcgFile;
  private baseline: PcgFile;
  // What each bank pulled since the last save looked like when it arrived, so edits to it still count as unsaved.
  private pulledBase: PcgFile | null = null;
  // Each undo step keeps its label for the Undo History list.
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private cache: Change[] | null = null;
  // An AI run (all) or its pending review (the slots the run touched): those slots refuse edits, and Undo/Redo stay off.
  private hold: { all: boolean; slots: Set<string> } | null = null;
  private bankCache = new Map<string, Change[]>();
  // Pointers each bank holds, kept like bankCache: an edit drops only the banks it touched.
  private refCache = new Map<string, BankRefs>();
  // Counts the edits that renamed a slot (or replaced the file), so name lists rebuild on those only.
  nameRev = 0;

  // A restored recovery copy has no saved original to compare with, so every slot counts as unsaved until it is saved.
  // shortcut: the Changes list shows every slot and params compare to zero, upgrade by storing the original's bytes beside the copy.
  private noBaseline = false;

  static recovered(bytes: Uint8Array): Workspace {
    const w = new Workspace(bytes);
    w.noBaseline = true;
    return w;
  }

  constructor(bytes: Uint8Array) {
    this.file = parsePcg(bytes);
    this.baseline = parsePcg(bytes);
  }

  banks(): BankInfo[] {
    return listBanks(this.file);
  }

  info(key: string): BankInfo {
    const b = listBanks(this.file).find((x) => x.key === key);
    if (!b) throw new Error(`no bank ${key}`);
    return b;
  }

  nameOf(key: string, index: number): string {
    return getName(this.file, key, index);
  }

  // The slot's bytes as opened or last saved, for showing what an edit changed. A bank the baseline lacks shows no change.
  baseEntry(key: string, index: number): Uint8Array {
    const base = this.baseFor(key);
    const e = getEntry(base ?? this.file, key, index);
    return this.noBaseline ? new Uint8Array(e.length) : e;
  }

  baseGlobal(): Uint8Array | null {
    return getGlobal(this.baseline);
  }

  hasGlobal(): boolean {
    return getGlobal(this.file) !== null;
  }

  serialize(): Uint8Array {
    return serializePcg(this.file);
  }

  // The file as opened or last saved, so a copy can tell its overwrites from unsaved work. A copy, never the live file.
  // shortcut: one whole-file baseline, so a bank pulled from the keyboard since the last save counts as changed for the overwrite confirm; upgrade to per-bank saved bytes if that confirm is too noisy
  savedFile(): PcgFile {
    return parsePcg(serializePcg(this.baseline));
  }

  // A working copy for trial operations and for pulls that become backups.
  clone(): PcgFile {
    return parsePcg(this.serialize());
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get held(): boolean {
    return this.hold !== null;
  }

  // True during the run itself, false while only a review is pending: edits to any slot wait for the run, only the touched slots wait for the review.
  get running(): boolean {
    return this.hold?.all === true;
  }

  holdAll(): void {
    this.hold = { all: true, slots: new Set() };
  }

  // The review holds what the session touched, not only what changed: Discard restores every touched slot from the session's bytes.
  holdSlots(slots: Slot[]): void {
    this.hold = { all: false, slots: new Set(slots.map((s) => `${s.key}/${s.index}`)) };
  }

  release(): void {
    this.hold = null;
  }

  isHeld(key: string, index: number): boolean {
    return this.hold !== null && (this.hold.all || this.hold.slots.has(`${key}/${index}`));
  }

  // The one place every editor's write passes, so no view can write a held slot.
  private guard(slots: Slot[]): void {
    if (this.hold?.all) throw new Error(RUN_MESSAGE);
    if (slots.some((s) => this.isHeld(s.key, s.index))) throw new Error(HOLD_MESSAGE);
  }

  // Slots and Global that differ from the file as opened or last saved.
  private baseFor(key: string): PcgFile | null {
    for (const f of [this.baseline, this.pulledBase]) if (f && listBanks(f).some((b) => b.key === key)) return f;
    return null;
  }

  changes(): Change[] {
    if (this.cache) return this.cache;
    const out: Change[] = [];
    for (const info of listBanks(this.file)) out.push(...this.bankChanges(info));
    const g = getGlobal(this.file);
    const gb = getGlobal(this.baseline);
    if (g && gb && !same(g, gb)) out.push({ key: GLOBAL_KEY, index: -1, before: "Global", after: "Global", settings: true });
    this.cache = out;
    return out;
  }

  // Kept per bank: an edit drops only the banks it touched, so it does not rescan every slot of the file.
  private bankChanges(info: BankInfo): Change[] {
    const hit = this.bankCache.get(info.key);
    if (hit) return hit;
    const out: Change[] = [];
    const baseFile = this.baseFor(info.key);
    if (baseFile) {
      const known = listBanks(baseFile).find((b) => b.key === info.key)!;
      for (let i = 0; i < Math.min(info.count, known.count); i++) {
        const c = this.slotChange(info.key, baseFile, i);
        if (c) out.push(c);
      }
    }
    this.bankCache.set(info.key, out);
    return out;
  }

  private slotChange(key: string, baseFile: PcgFile, i: number): Change | null {
    const cur = getEntry(this.file, key, i);
    const base = this.noBaseline ? new Uint8Array(cur.length) : getEntry(baseFile, key, i);
    if (same(cur, base)) return null;
    return { key, index: i, before: getName(baseFile, key, i), after: getName(this.file, key, i), settings: !same(cur.subarray(NAME_LEN), base.subarray(NAME_LEN)) };
  }

  // Brings a cached bank's list up to date for one edited slot, instead of rescanning the bank.
  private patchBank(key: string, list: Change[], index: number): Change[] {
    const out = list.filter((c) => c.index !== index);
    const baseFile = this.baseFor(key);
    if (baseFile) {
      const known = listBanks(baseFile).find((b) => b.key === key)!;
      if (index < Math.min(this.info(key).count, known.count)) {
        const c = this.slotChange(key, baseFile, index);
        if (c) out.push(c);
      }
    }
    return out.sort((a, b) => a.index - b.index);
  }

  changedIn(key: string): number[] {
    return this.changes().filter((c) => c.key === key).map((c) => c.index);
  }

  // Who points at a Program or Combi slot: the Combi timbres, Drum Tracks and Set List slots (refsTo, kept per bank).
  usedBy(key: string, index: number): Ref[] {
    return refsToCached(this.file, key, index, this.refCache);
  }

  // A slot's bytes. A Set List slot is its SBK1 entry and its SDB1 companion together.
  private snap(s: Slot): { entry: Uint8Array; companion: Uint8Array | null } {
    if (this.info(s.key).kind !== "setlist") return { entry: getEntry(this.file, s.key, s.index), companion: null };
    const pair = getSetList(this.file, s.index);
    return { entry: pair.entry, companion: pair.companion };
  }

  // Runs a change to the listed slots and records the bytes that changed, so undo does not need a whole-file snapshot.
  async apply(slots: Slot[], mutate: () => void | Promise<void>, label = "Edit"): Promise<void> {
    this.guard(slots);
    const before = slots.map((s) => this.snap(s));
    await mutate();
    const edit: Entry[] = [];
    slots.forEach((s, i) => {
      const b = before[i];
      const after = this.snap(s);
      const changed = !same(b.entry, after.entry) || (b.companion !== null && after.companion !== null && !same(b.companion, after.companion));
      if (changed) {
        edit.push({ ...s, before: b.entry, after: after.entry, beforeCompanion: b.companion, afterCompanion: after.companion, setList: this.info(s.key).kind === "setlist", global: false });
      }
    });
    this.record(edit, label);
  }

  // The same as apply, for the Global block.
  async applyGlobal(mutate: () => void | Promise<void>, label = "Edit Global"): Promise<void> {
    this.guard([]);
    const before = getGlobal(this.file);
    if (!before) throw new Error("this file has no Global block");
    await mutate();
    const after = getGlobal(this.file);
    if (!after || same(before, after)) return;
    this.record([{ key: GLOBAL_KEY, index: -1, before, after, beforeCompanion: null, afterCompanion: null, setList: false, global: true }], label);
  }

  // Slots whose bytes differ from a snapshot taken before a trial run.
  changedSince(before: PcgFile, slots: Slot[]): Slot[] {
    return slots.filter((s) => !same(getEntry(before, s.key, s.index), getEntry(this.file, s.key, s.index)));
  }

  // Records a trial run's edits, already in the file, as ONE undo step. The snapshot supplies the "before" bytes.
  recordSince(before: PcgFile, slots: Slot[], label = "Edit"): void {
    this.record(
      this.changedSince(before, slots).map((s) => ({
        ...s,
        before: getEntry(before, s.key, s.index),
        after: getEntry(this.file, s.key, s.index),
        beforeCompanion: null,
        afterCompanion: null,
        setList: false,
        global: false,
      })),
      label,
    );
  }

  // For edits made straight into the file: puts the change list back in step.
  refresh(): void {
    this.touch();
  }

  private record(edit: Entry[], label: string): void {
    if (edit.length > 0) {
      this.undoStack.push({ label, edit });
      this.redoStack = [];
    }
    this.touch(edit);
  }

  // Labels of the undo steps, newest first: index 0 is what the next undo reverses.
  undoLabels(): string[] {
    return this.undoStack.map((s) => s.label).reverse();
  }

  undo(): boolean {
    if (this.hold) return false;
    const step = this.undoStack.pop();
    if (!step) return false;
    this.restore(step.edit, "before");
    this.redoStack.push(step);
    this.touch(step.edit);
    return true;
  }

  redo(): boolean {
    if (this.hold) return false;
    const step = this.redoStack.pop();
    if (!step) return false;
    this.restore(step.edit, "after");
    this.undoStack.push(step);
    this.touch(step.edit);
    return true;
  }

  markSaved(bytes: Uint8Array): void {
    this.noBaseline = false;
    this.pulledBase = null;
    this.baseline = parsePcg(bytes);
    this.touch();
  }

  // A pulled library grows in place. The baseline stays, so unsaved edits still count, and the undo history is cleared because the library's shape changed.
  replaceFile(bytes: Uint8Array): void {
    this.pulledBase = parsePcg(bytes);
    this.file = parsePcg(bytes);
    this.undoStack = [];
    this.redoStack = [];
    this.touch();
  }

  private restore(edit: Entry[], which: "before" | "after"): void {
    for (const e of edit) {
      if (e.global) setGlobal(this.file, e[which]);
      // A Set List goes back as its pair, so both blocks return.
      else if (e.setList) setSetList(this.file, e.index, { entry: e[which], companion: (which === "before" ? e.beforeCompanion : e.afterCompanion)! });
      else setEntry(this.file, e.key, e.index, e[which]);
    }
  }

  // No edit = everything changed (a new baseline or file).
  private touch(edit?: Entry[]): void {
    this.cache = null;
    if (!edit) {
      this.bankCache.clear();
      this.refCache.clear();
      this.nameRev++;
      return;
    }
    for (const e of edit) {
      this.refCache.delete(e.key);
      if (e.global) continue;
      if (!same(e.before.subarray(0, NAME_LEN), e.after.subarray(0, NAME_LEN))) this.nameRev++;
      const hit = this.bankCache.get(e.key);
      if (hit) this.bankCache.set(e.key, this.patchBank(e.key, hit, e.index));
    }
  }
}
