// Where the result of an AI run that changed an existing sound goes: over it (today's Keep), into a new Program slot, or into a new Combination.
// Pure: it plans on a scratch copy of the library and returns the exact bytes to write; the caller applies them as one undo step.
import { getEntry, getName, listBanks, setEntry } from "../pcg/library.ts";
import { parsePcg, serializePcg, type PcgFile } from "../pcg/pcg.ts";
import { readParam, writeParam, type ParamTables } from "../params/params.ts";
import { bankNumberOf, isFreeName, SessionError, SoundSession, timbrePrograms, type KeyboardFacts, type Slot } from "./session.ts";

export type DestKind = "current" | "new-program" | "new-combi";
export type Named = Slot & { name: string };
// One changed sound that moves: its copy and, for new-combi, the Combination that plays the copy. The original goes back to the baseline.
export type Move = { from: Slot; program?: Named; combi?: Named };
export type DestWrite = Slot & { bytes: Uint8Array };
export type DestPlan = { ok: true; writes: DestWrite[]; moves: Move[] } | { ok: false; error: string };

const NAME_MAX = 16;
const sameSlot = (a: Slot, b: Slot): boolean => a.key === b.key && a.index === b.index;

// The changed Programs and Combis that held a real sound before the run: only these raise the question.
export function existingChanged(changed: Slot[], baseline: PcgFile, library: PcgFile): Slot[] {
  const banks = listBanks(library);
  return changed.filter((s) => {
    const b = banks.find((x) => x.key === s.key);
    return !!b && (b.kind === "program" || b.kind === "combi") && !isFreeName(getName(baseline, s.key, s.index));
  });
}

// A Combi kept next to a changed Program must play the Program's copy, or the Program's changes would never be heard in it.
function relink(T: ParamTables, entry: Uint8Array, from: Slot, to: Slot): void {
  const fromBank = bankNumberOf(from.key), toBank = bankNumberOf(to.key);
  if (fromBank === null || toBank === null) return;
  for (let t = 1; t <= 16; t++) {
    const row = (name: string) => T.combi.find((r) => r.group === `Timbre${t}` && r.name === name)!;
    if (readParam(entry, row("Status")) === 0 || readParam(entry, row("Bank Number")) !== fromBank || readParam(entry, row("Program Number")) !== from.index) continue;
    writeParam(entry, row("Bank Number"), toBank);
    writeParam(entry, row("Program Number"), to.index);
  }
}

function uniqueName(base: string, suffix: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const tail = n === 1 ? suffix : `${suffix} ${n}`;
    const name = base.slice(0, NAME_MAX - tail.length).trimEnd() + tail;
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase());
      return name;
    }
  }
}

export function planDestination(T: ParamTables, kind: DestKind, changed: Slot[], baseline: PcgFile, library: PcgFile, opts: { hide?: Slot[]; keyboard?: KeyboardFacts | null } = {}): DestPlan {
  if (kind === "current") return { ok: true, writes: [], moves: [] };
  const scratch = parsePcg(serializePcg(library));
  const banks = listBanks(scratch);
  const taken = new Set<string>();
  for (const b of banks) if (b.kind === "program" || b.kind === "combi") for (let i = 0; i < b.count; i++) taken.add(getName(scratch, b.key, i).toLowerCase());
  const session = new SoundSession(T, scratch, { hide: opts.hide, protect: changed, keyboard: opts.keyboard });
  const writes: DestWrite[] = [];
  const moves: Move[] = [];
  const put = (s: Slot) => writes.push({ key: s.key, index: s.index, bytes: new Uint8Array(getEntry(scratch, s.key, s.index)) });
  try {
    const kindOf = (s: Slot) => banks.find((x) => x.key === s.key)!.kind;
    // Programs first, so a changed Combi can be pointed at their copies.
    const existing = existingChanged(changed, baseline, library).sort((a, b) => Number(kindOf(a) === "combi") - Number(kindOf(b) === "combi"));
    const linked = new Set(existing.filter((s) => kindOf(s) === "combi").flatMap((s) => timbrePrograms(T, library, getEntry(library, s.key, s.index)).map((p) => `${p.key}/${p.index}`)));
    const copies: { from: Slot; to: Slot }[] = [];
    const point = (s: Slot) => {
      const e = getEntry(scratch, s.key, s.index);
      for (const c of copies) relink(T, e, c.from, c.to);
      setEntry(scratch, s.key, s.index, e);
    };
    for (const from of existing) {
      const isCombi = kindOf(from) === "combi";
      if (isCombi && kind !== "new-combi") {
        if (copies.length > 0) { point(from); put(from); } // a Combi has no Program form: it stays current, now playing the copies
        continue;
      }
      const orig = getName(baseline, from.key, from.index);
      const copy = session.copySound({ fromKey: from.key, fromIndex: from.index, name: uniqueName(orig, " AI", taken) });
      if (isCombi) point(copy);
      else copies.push({ from, to: copy });
      setEntry(scratch, from.key, from.index, getEntry(baseline, from.key, from.index));
      put(copy);
      put(from);
      if (isCombi) {
        moves.push({ from, combi: copy });
        continue;
      }
      if (kind === "new-program" || linked.has(`${from.key}/${from.index}`)) {
        moves.push({ from, program: copy });
        continue;
      }
      const c = session.buildCombi({ name: uniqueName(orig, " Combi", taken), parts: [{ key: copy.key, index: copy.index, keyBottom: 0, keyTop: 127 }] });
      put(c);
      moves.push({ from, program: copy, combi: c });
    }
  } catch (e) {
    if (!(e instanceof SessionError)) throw e;
    return { ok: false, error: e.message };
  }
  return { ok: true, writes, moves };
}

// What the owner reads before Keep (preview, one line per changed sound) and in the log after it (done, empty for Current).
export function destLines(kind: DestKind, existing: Slot[], plan: DestPlan | null, label: (s: Slot) => string): { preview: string[]; done: string } {
  const moves = plan && plan.ok ? plan.moves : [];
  const q = (n: Named) => `${label(n)} "${n.name}"`;
  const preview = existing.map((s) => {
    const m = moves.find((x) => sameSlot(x.from, s));
    if (!m) return `-> ${label(s)} overwritten`;
    return `-> ${[m.program && q(m.program), m.combi && q(m.combi)].filter(Boolean).join(", ")} (original ${label(s)} stays)`;
  });
  if (kind === "current") return { preview, done: "" };
  const done = moves
    .map((m) => {
      const what = m.program ? `new program ${q(m.program)}${m.combi ? ` and Combi ${q(m.combi)}` : ""}` : `new Combi ${q(m.combi!)}`;
      return `Kept as ${what}: original ${label(m.from)} unchanged.`;
    })
    .join(" ");
  return { preview, done };
}
