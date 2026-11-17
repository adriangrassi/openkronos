import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { copyEntry, getEntry, getGlobal, setName, swapEntries, type BankInfo } from "../../core/pcg/library.ts";
import { effectiveGlobalChannel, globalMidiChannel } from "../../core/midi/masterVolume.ts";
import type { Settings } from "../../core/settings.ts";
import { parsePcg, serializePcg, type PcgFile } from "../../core/pcg/pcg.ts";
import { slotsTouchedBySwap, swapWithRefs, type Ref } from "../../core/pcg/refs.ts";
import { keyboardBanks, pullBank, pullBanks, pullFull, pushCurrent, pushEntries, storeBank, type SyncOptions } from "../../core/device/sync.ts";
import { modeBytes, selectBytes } from "../../core/midi/player.ts";
import { differingSlots } from "../../core/device/sendplan.ts";
import { bankKnown, changedSinceSync, emptySyncState, recordBank, recordSlots, type SyncState } from "../../core/device/syncstate.ts";
import type { ParamTables, ParamType } from "../../core/params/params.ts";
import type { OpenedFile } from "../shared/api.ts";
import { GLOBAL_KEY, Workspace, type Change, type Slot } from "./document.ts";
import { Shell } from "./Shell.tsx";
import type { ShellCommand } from "./CommandPalette.tsx";
import { A_VIEW_KEY, ParamEditor, type EditorTarget, type EditorView } from "./ParamEditor.tsx";
import { Collapse } from "./Collapse.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { StatusPill, TransferBar, Wordmark } from "./TopBarExtras.tsx";
import { StudioBlocks, StudioTools } from "./theme-studio/StudioChrome.tsx";
import { Welcome } from "./Welcome.tsx";
import { SupportLinks } from "./SupportLinks.tsx";
import { useExplain } from "./explain.ts";
import { Autosave } from "./Autosave.tsx";
import { MidiPanel } from "./MidiPanel.tsx";
import { LiveEdit } from "./LiveEdit.tsx";
import { SoundStrip } from "./SoundStrip.tsx";
import { ModeBar } from "./ModeBar.tsx";
import { midiSoundIndex } from "./midimatch.ts";
import { ComparePanel } from "./ComparePanel.tsx";
import { Variations } from "./Variations.tsx";
import { BackupManager } from "./BackupManager.tsx";
import { BackupPanel } from "./BackupPanel.tsx";
import { AiPanel } from "./AiPanel.tsx";
import type { PointAt } from "../../core/ai/point.ts";
import { stepsOf, tourPoint, tourReduce, tourStart, type TourAction, type TourState } from "../../core/ai/tour.ts";
import { GuideCallout } from "./GuideCallout.tsx";
import { AbBar, abWhy, isBlank, sameBytes, type AbTarget } from "./AbBar.tsx";
import type { SongFacts, SongPick } from "../../core/ai/song.ts";
import { EffectsPanel } from "./EffectsPanel.tsx";
import { editorKeys } from "./editorKeys.ts";
import { Dock } from "./Dock.tsx";
import { useThemeA } from "./theme-a/useTheme.ts";
import { SoundBrowser } from "./SoundBrowser.tsx";
import { BankTools } from "./BankTools.tsx";
import { Audition } from "./Audition.tsx";
import { Exchange } from "./Exchange.tsx";
import { SetLists } from "./SetLists.tsx";
import { Overview } from "./Overview.tsx";
import { NeedsFor, NeedsView, needsShort, useNeeds } from "./Needs.tsx";
import { extraChannels, prepareErrorText, putOnKeyboard, readNeeds, targetsOf } from "../../core/device/prepare.ts";
import { isFreeName, type KeyboardFacts } from "../../core/ai/session.ts";
import {
  backupName,
  connectSimulated,
  connectUsb,
  describeError,
  kronosAddress,
  simulatedName,
  type Link,
} from "./keyboard.ts";

const PULLED_NAME = "Kronos (pulled, not saved)";
const RECOVERED_NAME = "Recovered file (not saved)";

// the Kronos itself numbers slots from 000
const slot = (i: number) => String(i).padStart(3, "0");

// Style A opens Programs in the panel view until the user picks another; the other themes keep the Kronos-view flag.
function initialEditorView(): EditorView {
  if (document.documentElement.dataset.theme === "a") {
    const v = localStorage.getItem(A_VIEW_KEY);
    return v === "list" || v === "keyboard" || v === "kronos" || v === "panel" ? v : "panel";
  }
  return localStorage.getItem("kronos.view.kronos") === "1" ? "kronos" : "list";
}

// run gets the state of the "Update Combis and Set Lists" checkbox when refsOption shows it.
type Dialog = { message: string; okLabel: string; refsOption?: boolean; lines?: string[]; ack?: string; cancelDefault?: boolean; run: (updateRefs: boolean) => void | Promise<void> };
type Busy = { label: string; done: number; total: number };
type Rename = { index: number; value: string; error: string | null };
type Hit = { key: string; index: number; bank: string; name: string };

const GROUPS: { kind: BankInfo["kind"]; title: string }[] = [
  { kind: "program", title: "Programs" },
  { kind: "combi", title: "Combis" },
  { kind: "setlist", title: "Set Lists" },
  { kind: "drumkit", title: "Drum Kits" },
  { kind: "waveseq", title: "Wave Sequences" },
];
const KIND_NAME: Record<BankInfo["kind"], string> = {
  program: "Program",
  combi: "Combi",
  setlist: "Set List",
  drumkit: "Drum Kit",
  waveseq: "Wave Sequence",
};
const KEYBOARD_BANKS = keyboardBanks();
// Which parameter table a bank's objects use.
const paramType = (info: BankInfo): ParamType => {
  if (info.kind === "program") return info.type === "exi" ? "exi" : "hd1";
  if (info.kind === "combi") return "combi";
  return info.kind === "drumkit" ? "drumkit" : "waveseq";
};
const SEARCH_LIMIT = 200;

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

// What a Program or Combi is used by, as the Used By list shows it.
function refText(w: Workspace, r: Ref): string {
  if (r.kind === "timbre") return `Combi ${w.info(r.fromKey).label} ${slot(r.fromIndex)} Timbre ${r.part + 1}`;
  if (r.kind === "drum-track") return `Program ${w.info(r.fromKey).label} ${slot(r.fromIndex)} Drum Track`;
  return `Set List ${slot(r.fromIndex)} Slot ${r.part + 1}`;
}
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";
const dirtyNote = (n: number): string => (n === 1 ? "1 unsaved change" : `${n} unsaved changes`);

function findHits(w: Workspace, query: string): Hit[] {
  const needle = query.toLowerCase();
  const out: Hit[] = [];
  for (const b of w.banks()) {
    for (let i = 0; i < b.count && out.length < SEARCH_LIMIT; i++) {
      const name = w.nameOf(b.key, i);
      if (name.toLowerCase().includes(needle)) out.push({ key: b.key, index: i, bank: b.label, name });
    }
  }
  return out;
}

export function App() {
  useExplain();
  const themeA = useThemeA();
  const api = window.kronos;
  const [rev, bump] = useReducer((n: number) => n + 1, 0);
  const wsRef = useRef<Workspace | null>(null);
  const linkRef = useRef<Link | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  // A dropped file has no path yet, so Save asks where to put it.
  const [unnamed, setUnnamed] = useState(false);
  const [bankKey, setBankKey] = useState<string | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [clip, setClip] = useState<Slot | null>(null);
  const [rename, setRename] = useState<Rename | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifyStrip, setVerifyStrip] = useState<{ ok: boolean; text: string } | null>(null);
  // Step 5 of the Keyboard path: the open sound's Check keyboard button is drawn into this element.
  const [verifyHost, setVerifyHost] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState("Not connected");
  const [openNote, setOpenNote] = useState("");
  // The last transfer result, kept apart from the connection status.
  const [note, setNote] = useState("");
  const [link, setLink] = useState<Link | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [sentKeys, setSentKeys] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // The parameter tables are imported the first time the editor opens, so app start does not wait for them.
  const [tables, setTables] = useState<ParamTables | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  // Ask & show walkthrough: the editors are pointed at the current step only, as a one-setting pointer.
  const [tourBase, setTourBase] = useState<PointAt | null>(null);
  const [tour, setTour] = useState<TourState>(() => tourStart([]));
  const [tourBefore, setTourBefore] = useState<{ key: string; index: number; bytes: Uint8Array } | null>(null); // the sound as it was when the walkthrough started
  const [ab, setAb] = useState<AbTarget | null>(null); // the A/B compare bar's sound
  const [tourNonce, setTourNonce] = useState(0); // Open it: a fresh pointer object makes the editors navigate again
  const tourDo = (a: TourAction) => setTour((s) => tourReduce(s, a));
  const point = useMemo(() => (tourBase ? tourPoint(tourBase, tour) : null), [tourBase, tour.active, tour.index, tourNonce]);
  const [fxPoint, setFxPoint] = useState<PointAt | null>(null); // the pointer the Effects panel was asked to show; it only counts while it is still the live pointer
  // Kept at app level, so the chosen view is still there for the next sound opened this session.
  const [editorView, setEditorView] = useState<EditorView>(initialEditorView);
  // The open library came from the keyboard (pulled, saved or not). Only Open clears it; the file name is separate.
  const [fromKeyboard, setFromKeyboard] = useState(false);
  const [globalSetting, setGlobalSetting] = useState("file"); // Settings: Kronos Global MIDI channel, for the Volume slider
  const [pullKey, setPullKey] = useState("program:INT-A");
  const [swapRefs, setSwapRefs] = useState(true);
  const [ack, setAck] = useState(false); // the dialog's "I understand" box: a replace stays off until it is ticked
  const [needsNonce, setNeedsNonce] = useState(0); // bumped after Put on keyboard so the dependency lines read the keyboard again
  const kbCache = useRef<{ ws: Workspace | null; match: Map<string, string> }>({ ws: null, match: new Map() });
  useEffect(() => setAck(false), [dialog]);
  const [sounds, setSounds] = useState(false);
  const [overview, setOverview] = useState(false);
  const [song, setSong] = useState<SongFacts | null>(null); // the MIDI file loaded in MidiPanel
  const assignRef = useRef<((picks: SongPick[]) => void) | null>(null);
  const [tools, setTools] = useState(false);
  const [listView, setListView] = useState(false); // the Set List bank opens as the pad grid; this switches to the plain 128 rows
  const [padHost, setPadHost] = useState<HTMLElement | null>(null);
  const [exchange, setExchange] = useState(false);

  const w = wsRef.current;
  const banks = w ? w.banks() : [];
  const info: BankInfo | null = w && bankKey ? w.info(bankKey) : null;
  const isSet = info?.kind === "setlist";
  const locked = busy !== null;
  // While an AI run or its review is pending, saving, opening, undo and everything that talks to the keyboard stay off; edits stay on (Workspace guards the held slots).
  const aiHold = w?.held ?? false;
  const aiRun = w?.running ?? false;
  const xfer = locked || aiHold;
  const holdTitle = aiHold ? "Keep or Discard the AI changes first" : undefined;
  const changes: Change[] = w ? w.changes() : [];
  const bankChanges = info ? changes.filter((c) => c.key === info.key) : [];
  // The MIDI match index is rebuilt after every edit that renamed a slot, so a renamed slot matches under its new name.
  const soundIdx = useMemo(() => (w ? midiSoundIndex(w) : null), [w, w?.nameRev]);
  const onGlobal = editor?.kind === "global";
  const canBank = !!info && !isSet && !!link && !xfer && !onGlobal;
  const canSend = !!w && !!link && !xfer;
  // The AI A/B audition: calls the slot up and fills the keyboard's edit buffer, the way Live does. Nothing is stored on the keyboard.
  const callUpSlot = async (s: Slot): Promise<void> => {
    if (!w || !link) return;
    link.send(modeBytes(w.info(s.key).kind === "combi" ? "combi" : "program", link.channel));
    for (const b of selectBytes(s.key, s.index, link.channel)) link.send(b);
    await pushCurrent(link.client, w.file, s.key, s.index);
  };
  const auditionLive = async (s: Slot): Promise<void> => {
    if (xfer) return;
    await callUpSlot(s);
  };
  // A/B compare: the keyboard link must be free; the bar reads B from the document and A from `before`, and never writes to either.
  const abOff = abWhy(link, locked);
  const abBefore = (key: string, index: number, ...from: [string, Uint8Array | null][]): { bytes: Uint8Array; source: string } | null => {
    if (!w) return null;
    const now = getEntry(w.file, key, index);
    for (const [source, bytes] of from) if (bytes && !isBlank(bytes) && !sameBytes(bytes, now)) return { bytes: new Uint8Array(bytes), source };
    return null;
  };
  const savedBytes = (key: string, index: number): Uint8Array | null => (w ? w.baseEntry(key, index) : null);
  const guideAb = tourBefore && tourBase && tourBefore.key === tourBase.key && tourBefore.index === tourBase.index ? abBefore(tourBefore.key, tourBefore.index, ["the sound when the walkthrough started", tourBefore.bytes], ["the sound as last saved or opened", savedBytes(tourBefore.key, tourBefore.index)]) : null;
  const editorAb = editor?.kind === "slot" && w && ["program", "combi"].includes(w.info(editor.key).kind) ? abBefore(editor.key, editor.index, ["the sound as last saved or opened", savedBytes(editor.key, editor.index)]) : null;
  const runTitle = aiRun ? "AI is working: wait for it to finish or cancel it" : undefined;
  const canSwap = !!info && !locked && !aiRun && sel.length === 2;
  const canCopy = !!info && !locked && sel.length === 1;
  const canPaste = !!info && !locked && !aiRun && clip !== null && sel.length === 1;
  const canEdit = !!info && !isSet && !locked && sel.length === 1;
  const editInfo = editor?.kind === "slot" && w ? w.info(editor.key) : null;
  const editSlot = editor?.kind === "slot" ? { key: editor.key, index: editor.index } : null;
  const openNeeds = useNeeds(w, link, tables, editSlot, rev, xfer && !aiHold, needsNonce);
  const prepareWhy = locked ? "Wait for the transfer to finish" : aiRun ? runTitle ?? null : null;
  const playKind = editInfo && (editInfo.kind === "program" || editInfo.kind === "combi") ? editInfo.kind : null;
  const playing = w && editor?.kind === "slot" && playKind ? `Playing: ${playKind === "combi" ? "Combi" : "Program"} ${editInfo!.label} ${slot(editor.index)} "${w.nameOf(editor.key, editor.index)}"${openNeeds && needsShort(openNeeds) ? ` (${needsShort(openNeeds)})` : ""}` : undefined;
  const extraCh = useMemo(() => (w && tables && editSlot ? extraChannels(tables, w.file, editSlot.key, editSlot.index) : []), [w, tables, editSlot?.key, editSlot?.index, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = search.trim();
  const hits = w && query ? findHits(w, query) : [];
  // Who uses the selected Program or Combi. Cheap enough to run each render: entries are viewed, not copied.
  const usedBy = w && info && sel.length === 1 && (info.kind === "program" || info.kind === "combi") ? w.usedBy(info.key, sel[0]) : [];

  // The A/B bar belongs to one sound: another file, another open sound, or (for an AI review) the end of the hold closes it, and closing restores the keyboard.
  useEffect(() => {
    if (!ab) return;
    const openOther = editor?.kind === "slot" ? editor.key !== ab.key || editor.index !== ab.index : ab.origin !== "ai";
    if (!w || openOther || (sounds && ab.origin !== "ai") || (ab.origin === "ai" && !w.held)) setAb(null);
  }, [ab, w, editor, sounds, rev]);
  // The walkthrough follows one sound: opening another one, or the Sound Browser, is the user's own move away.
  useEffect(() => {
    if (tour.active && tourBase && !(editor?.kind === "slot" && editor.key === tourBase.key && editor.index === tourBase.index && !sounds)) tourDo({ type: "userNavigated" });
  }, [editor, sounds, tour.active, tourBase]);
  // Two frames after a step opens, the editors have finished navigating; from then on a page change is the user's.
  useEffect(() => {
    if (!tour.navigating) return;
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => tourDo({ type: "settled" })); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [tour.navigating, tour.index, tour.active]);
  useEffect(() => {
    void window.kronos.settingsGet().then((s: Settings) => setGlobalSetting(s.globalChannel));
    const onSettings = (e: Event) => setGlobalSetting((e as CustomEvent<Settings>).detail.globalChannel);
    window.addEventListener("kronos-settings", onSettings);
    return () => window.removeEventListener("kronos-settings", onSettings);
  }, []);
  // Test hooks exist only in an e2e launch, and read the simulator directly.
  useEffect(() => {
    if (!api.e2e) return;
    const read = (key: string, index: number, which: "temp" | "stored"): string => {
      const sim = linkRef.current?.sim;
      const ws = wsRef.current;
      if (!sim || !ws) throw new Error("no simulator is connected");
      return simulatedName(sim, ws.info(key), index, which);
    };
    window.__kronosE2E = {
      ramName: (key, index) => read(key, index, "temp"),
      storedName: (key, index) => read(key, index, "stored"),
      setLatency: (ms) => linkRef.current?.sim?.setLatency(ms),
      midiLog: () => linkRef.current?.sim?.midiLog() ?? [],
      injectMidi: (bytes) => linkRef.current?.sim?.deliver(Uint8Array.from(bytes)),
      liveCounts: () => linkRef.current?.sim?.counts() ?? { dumps: 0, paramChanges: 0 },
      masterVolume: () => linkRef.current?.sim?.masterVolume ?? { count: 0, last: null },
      setListSelect: () => linkRef.current?.sim?.setListSelect ?? null,
      editBuffer: (obj) => { const e = linkRef.current?.sim?.editBuffer(obj); return e ? [...e.data] : null; },
      keyboardRename: (obj, bank, index, name) => {
        const sim = linkRef.current?.sim, o = sim?.tempObject(obj, bank, index);
        if (!sim || !o) throw new Error("no such object on the simulator");
        o.data.fill(0, 0, 24);
        o.data.set(Uint8Array.from(name, (c) => c.charCodeAt(0)), 0);
        sim.seedObject(obj, bank, index, o.version, o.data);
      },
      tamperEditBuffer: (obj, offset, xor) => {
        const e = linkRef.current?.sim?.editBuffer(obj);
        if (e) { e.data[offset] ^= xor; linkRef.current?.sim?.setEditBuffer(obj, e.version, e.data); }
      },
    };
  }, [api.e2e]);

  // The simulated keyboard finds a parameter id's field with the same tables, once they are loaded.
  useEffect(() => { if (tables) link?.sim?.useTables(tables); }, [tables, link]);

  // The main process asks before closing. Unsaved edits get a confirm; otherwise the window closes at once.
  useEffect(
    () =>
      api.onCloseRequest(() => {
        const n = wsRef.current?.changes().length ?? 0;
        if (n === 0) {
          void api.confirmClose();
          return;
        }
        setDialog({ message: `Close OpenKronos and discard ${dirtyNote(n)}?`, okLabel: "Discard and close", run: () => api.confirmClose() });
      }),
    [api],
  );

  // A duplicate or empty slot picked in Bank tools: open its bank and select it.
  function jump(key: string, index: number) {
    openBank(key);
    setSel([index]);
  }

  function openBank(key: string) {
    setBankKey(key);
    setSel([]);
    setRename(null);
    setEditor(null);
  }

  async function openEditor(target: EditorTarget) {
    if (locked || !w) return;
    setRename(null);
    setEditor(target);
    if (!tables) {
      const mod = await import("../../generated/params.json");
      setTables(mod.default as unknown as ParamTables);
    }
  }

  async function pointAt(p: PointAt) {
    await openEditor({ kind: "slot", key: p.key, index: p.index });
    if (wsRef.current) setTourBefore({ key: p.key, index: p.index, bytes: new Uint8Array(getEntry(wsRef.current.file, p.key, p.index)) });
    setTourBase(p);
    setTour(tourStart(stepsOf(p)));
  }

  // Sound Browser: a click selects the slot in the bank list; a double-click also opens it in the editor.
  function soundPicked(key: string, index: number, edit: boolean) {
    openBank(key);
    setSel([index]);
    if (edit) {
      setSounds(false);
      void openEditor({ kind: "slot", key, index });
    }
  }

  function disconnect() {
    linkRef.current?.close();
    linkRef.current = null;
    setLink(null);
    setSentKeys([]);
    setNote("");
    setStatus("Not connected");
  }

  // One transfer at a time. The phase callback names each step, and cancel leaves the library alone.
  async function transfer(
    label: string,
    total: number,
    cancelled: string,
    work: (opts: SyncOptions, phase: (next: string, n: number) => void) => Promise<void>,
  ): Promise<boolean> {
    const ac = new AbortController();
    abortRef.current = ac;
    let current = label;
    const onProgress = (done: number, t: number) => setBusy({ label: current, done, total: t });
    const phase = (next: string, n: number) => {
      current = next;
      setBusy({ label: next, done: 0, total: n });
    };
    setBusy({ label, done: 0, total });
    setError(null);
    try {
      await work({ signal: ac.signal, onProgress }, phase);
      return true;
    } catch (e) {
      setError(isAbort(e) ? cancelled : describeError(e));
      return false;
    } finally {
      abortRef.current = null;
      setBusy(null);
      bump();
    }
  }

  async function openFile() {
    if (xfer) return;
    let opened: Awaited<ReturnType<typeof api.open>>;
    try {
      opened = await api.open();
    } catch (e) {
      setError(describeError(e));
      return;
    }
    if (opened) await openOpened(opened, false);
  }

  // Shared by Open, Recent Files, the reopen setting and a drop. An unnamed file (a drop) has no path: Save then acts as Save As.
  async function openOpened(opened: OpenedFile, unnamedFile: boolean) {
    if (xfer) return;
    let next: Workspace;
    try {
      next = new Workspace(opened.bytes);
    } catch (e) {
      setError(describeError(e));
      return;
    }
    const adopt = async () => {
      try {
        if (unnamedFile) await api.forgetPath();
        else await api.confirmOpen();
      } catch (e) {
        setError(describeError(e));
        return;
      }
      disconnect();
      // A dropped file keeps the bank on screen when it has one, so a replace does not lose your place.
      const keep = unnamedFile && bankKey !== null && next.banks().some((b) => b.key === bankKey);
      wsRef.current = next;
      setFileName(opened.name);
      setUnnamed(unnamedFile);
      setBankKey(keep ? bankKey : next.banks()[0]?.key ?? null);
      setSel([]);
      setClip(null);
      setRename(null);
      setEditor(null);
      setFromKeyboard(false);
      setError(null);
      setOpenNote(opened.notice ?? "");
      bump();
    };
    const dirty = wsRef.current?.changes().length ?? 0;
    if (dirty > 0) setDialog({ message: `Open ${opened.name} and discard ${dirtyNote(dirty)}?`, okLabel: "Discard and open", run: adopt });
    else await adopt();
  }

  // A backup opens as an unnamed document (like a pull), so Save asks for a new file and never overwrites the backup.
  function openBackup(name: string, bytes: Uint8Array) {
    let next: Workspace;
    try {
      next = new Workspace(bytes);
    } catch (e) {
      setError(describeError(e));
      return;
    }
    const adopt = async () => {
      try {
        await api.forgetPath();
      } catch (e) {
        setError(describeError(e));
        return;
      }
      disconnect();
      wsRef.current = next;
      setFileName(PULLED_NAME);
      setBankKey(next.banks()[0]?.key ?? null);
      setSel([]);
      setClip(null);
      setRename(null);
      setEditor(null);
      setFromKeyboard(false);
      setError(null);
      bump();
    };
    const dirty = wsRef.current?.changes().length ?? 0;
    if (dirty > 0) setDialog({ message: `Open backup ${name} and discard ${dirtyNote(dirty)}?`, okLabel: "Discard and open", run: adopt });
    else void adopt();
  }

  async function save(asNew: boolean) {
    const ws = wsRef.current;
    if (!ws || xfer) return;
    const bytes = ws.serialize();
    try {
      const name = asNew || unnamed || fileName === PULLED_NAME || fileName === RECOVERED_NAME ? await api.saveAs(bytes) : await api.save(bytes);
      if (!name) return;
      ws.markSaved(bytes);
      setFileName(name);
      setUnnamed(false);
      setError(null);
      bump();
    } catch (e) {
      setError(describeError(e));
    }
  }

  // A restored recovery copy is unnamed, so Save asks where to put it and never touches the original .PCG.
  async function restoreRecovered(bytes: Uint8Array) {
    try {
      const next = Workspace.recovered(bytes);
      await api.forgetPath();
      disconnect();
      wsRef.current = next;
      setFileName(RECOVERED_NAME);
      setBankKey(next.banks()[0]?.key ?? null);
      setSel([]);
      setClip(null);
      setRename(null);
      setEditor(null);
      setError(null);
      bump();
    } catch (e) {
      setError(describeError(e));
    }
  }

  function undo() {
    if (!w || xfer) return;
    setRename(null);
    if (w.undo()) {
      setError(null);
      bump();
    }
  }

  function redo() {
    if (!w || xfer) return;
    setRename(null);
    if (w.redo()) {
      setError(null);
      bump();
    }
  }

  // Undo History: clicking step N undoes the N steps above it, which leaves the state right after step N.
  function undoTo(steps: number) {
    if (!w || xfer) return;
    setRename(null);
    for (let i = 0; i < steps; i++) w.undo();
    bump();
  }

  async function commitRename() {
    const r = rename;
    if (!w || !r || !info || locked) return;
    if (r.value === w.nameOf(info.key, r.index)) {
      setRename(null);
      return;
    }
    try {
      await w.apply([{ key: info.key, index: r.index }], () => setName(w.file, info.key, r.index, r.value), `Rename ${info.label} ${slot(r.index)} to "${r.value}"`);
      setRename(null);
      setError(null);
      bump();
    } catch (e) {
      setRename({ ...r, error: describeError(e) });
    }
  }

  function pick(i: number, add: boolean) {
    setSel((s) => (add ? (s.includes(i) ? s.filter((x) => x !== i) : [...s, i].sort((a, b) => a - b)) : [i]));
  }

  function arrowRows(e: React.KeyboardEvent<HTMLElement>) {
    const row = e.target as HTMLElement;
    if (row.getAttribute("role") !== "option" || (e.key !== "ArrowDown" && e.key !== "ArrowUp") || !info) return;
    e.preventDefault();
    const cur = Number(row.dataset.testid?.slice(4));
    const i = Math.min(info.count - 1, Math.max(0, cur + (e.key === "ArrowDown" ? 1 : -1)));
    setSel([i]);
    e.currentTarget.querySelector<HTMLElement>(`[data-testid="row-${i}"]`)?.focus();
  }

  function swap() {
    if (!w || !info || locked) return;
    if (sel.length !== 2) return;
    const [a, b] = sel;
    const key = info.key;
    // Set lists hold no references, so their swap has no checkbox and no reference update.
    const refs = !isSet;
    setSwapRefs(true);
    setDialog({
      message: `Swap ${info.label} ${slot(a)} "${w.nameOf(key, a)}" with ${info.label} ${slot(b)} "${w.nameOf(key, b)}"? Combis and Set Lists refer to programs by slot, so they may change sound. Undo can reverse this.`,
      okLabel: "Swap",
      refsOption: refs,
      run: async (updateRefs: boolean) => {
        const withRefs = refs && updateRefs;
        try {
          // Undo records every slot a swap with references touches, so it puts all of them back.
          const slots = withRefs ? slotsTouchedBySwap(w.file, key, a, key, b) : [{ key, index: a }, { key, index: b }];
          await w.apply(
            slots,
            () => {
              if (withRefs) swapWithRefs(w.file, key, a, key, b);
              else swapEntries(w.file, key, a, key, b);
            },
            `Swap ${info.label} ${slot(a)} and ${slot(b)}`,
          );
          setSel([]);
          setError(null);
          bump();
        } catch (e) {
          setError(describeError(e));
        }
      },
    });
  }

  function copy() {
    if (!info || !canCopy) return;
    setClip({ key: info.key, index: sel[0] });
    setError(null);
  }

  function paste() {
    if (!w || !info || !clip || !canPaste) return;
    const src = clip;
    const dst: Slot = { key: info.key, index: sel[0] };
    // Trial copy on a clone, so an engine-type or kind mismatch shows as an error with no dialog.
    try {
      copyEntry(w.clone(), src.key, src.index, dst.key, dst.index);
    } catch (e) {
      setError(describeError(e));
      return;
    }
    const from = `${w.info(src.key).label} ${slot(src.index)}`;
    const to = `${info.label} ${slot(dst.index)}`;
    setDialog({
      message: `Copy "${w.nameOf(src.key, src.index)}" (${from}) over "${w.nameOf(dst.key, dst.index)}" (${to})? Combis and Set Lists refer to programs by slot, so they may change sound.`,
      okLabel: "Paste",
      run: async () => {
        try {
          await w.apply([dst], () => copyEntry(w.file, src.key, src.index, dst.key, dst.index), `Paste ${to} from ${from}`);
          setError(null);
          bump();
        } catch (e) {
          setError(describeError(e));
        }
      },
    });
  }

  function linkSimulated(file: PcgFile) {
    disconnect();
    const l = connectSimulated(file);
    linkRef.current = l;
    setLink(l);
    setStatus(l.status);
    setError(null);
  }

  // With no file open this only works in a bare e2e launch: the simulator is seeded from the e2e file, and nothing is opened.
  async function connectSim() {
    if (xfer) return;
    if (w) return linkSimulated(w.file);
    if (!api.e2eBareSim) return;
    try {
      const opened = await api.open();
      if (opened) linkSimulated(parsePcg(opened.bytes));
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function connectUsbNow() {
    if (locked) return;
    disconnect();
    try {
      const l = await connectUsb();
      linkRef.current = l;
      setLink(l);
      setStatus(l.status);
      setError(null);
    } catch (e) {
      const msg = describeError(e);
      if (/No Kronos found/.test(msg)) setStatus("No Kronos found. Check the USB cable and that the keyboard is on.");
      else setError(msg);
    }
  }

  // A pulled library has no file behind it yet, so it must not inherit the previous file as its save target.
  // The last whole-keyboard pull comes back at startup, so it doesn't have to be pulled again.
  useEffect(() => {
    void api
      .pullCacheLoad()
      .then((c) => {
        if (!c || wsRef.current) return;
        const next = new Workspace(c.bytes);
        wsRef.current = next;
        setFileName(PULLED_NAME);
        setFromKeyboard(true);
        setBankKey(next.banks()[0]?.key ?? null);
        setNote(`Showing the whole-keyboard pull from ${new Date(c.savedAt).toLocaleString()}. Pull Whole Keyboard refreshes it.`);
        bump();
      })
      .catch((e) => setError(`The saved keyboard pull could not be opened: ${describeError(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pullWholeKeyboard() {
    const l = linkRef.current;
    if (!l || xfer) return;
    const go = async () => {
      const got: { file?: PcgFile } = {};
      const ok = await transfer("Pulling the whole keyboard", 1, "Pull cancelled. Nothing was changed.", async (opts) => {
        got.file = (await pullFull(l.client, opts)).pcg;
      });
      if (!ok || !got.file) return;
      try {
        const bytes = serializePcg(got.file);
        const next = new Workspace(bytes);
        await api.forgetPath();
        wsRef.current = next;
        setFileName(PULLED_NAME);
        setFromKeyboard(true);
        api.pullCacheSave(bytes).catch((e) => setError(`The pull worked, but it could not be kept on this PC: ${describeError(e)}`));
        setBankKey(next.banks()[0]?.key ?? null);
        setSel([]);
        setClip(null);
        setRename(null);
        setEditor(null);
        setSentKeys([]);
        setNote("");
        setError(null);
        bump();
      } catch (e) {
        setError(describeError(e));
      }
    };
    const dirty = wsRef.current?.changes().length ?? 0;
    if (dirty > 0) setDialog({ message: `Pull the whole keyboard and discard ${dirtyNote(dirty)}? This only reads from the keyboard.`, okLabel: "Discard and pull", run: go });
    else void go();
  }

  // Pulls one bank into the open file, in place. Asks first when that bank has local edits.
  function pullInPlace(key: string) {
    const ws = wsRef.current;
    const l = linkRef.current;
    if (!ws || !l || xfer) return;
    const bank = ws.info(key);
    const local = ws.changes().filter((c) => c.key === key).length;
    const go = async () => {
      await transfer(`Pulling ${bank.label}`, bank.count, "Pull cancelled. The library was not changed.", async (opts) => {
        const slots = range(bank.count).map((index) => ({ key, index }));
        await ws.apply(slots, () => pullBank(l.client, ws.file, key, opts));
      });
    };
    if (local > 0) {
      setDialog({
        message: `Pull ${bank.label} from the keyboard? This replaces ${local} local edit(s) in this bank with the keyboard's copy. Undo can bring them back.`,
        okLabel: "Pull",
        run: go,
      });
    } else {
      void go();
    }
  }

  function pull() {
    if (!info || !canBank) return;
    pullInPlace(info.key);
  }

  // The Keyboard panel's pull. A pulled library (or no library) grows by the bank, and a normal file gets it pulled in place.
  function pullOne() {
    const ws = wsRef.current;
    const l = linkRef.current;
    if (!l || xfer) return;
    const key = pullKey;
    const bank = KEYBOARD_BANKS.find((b) => b.key === key);
    const label = bank?.label ?? key;
    if (ws && !fromKeyboard) {
      if (!ws.banks().some((b) => b.key === key)) {
        setError(`This file has no ${label} bank.`);
        return;
      }
      setBankKey(key);
      pullInPlace(key);
      return;
    }
    const go = async () => {
      const got: { file?: PcgFile } = {};
      const ok = await transfer(`Pulling ${label}`, bank?.count ?? 1, "Pull cancelled. The library was not changed.", async (opts) => {
        got.file = await pullBanks(l.client, [key], opts, wsRef.current?.file);
      });
      if (!ok || !got.file) return;
      try {
        const bytes = serializePcg(got.file);
        const current = wsRef.current;
        if (current) current.replaceFile(bytes);
        else {
          await api.forgetPath();
          wsRef.current = new Workspace(bytes);
          setFileName(PULLED_NAME);
        }
        setFromKeyboard(true);
        setBankKey(key);
        setSel([]);
        setClip(null);
        setRename(null);
        setEditor(null);
        setError(null);
        bump();
      } catch (e) {
        setError(describeError(e));
      }
    };
    void go();
  }

  // Set lists and Global have no USB address (pushEntries refuses them), so they never go to the keyboard.
  const sendableBanks = (ws: Workspace): BankInfo[] =>
    ws
      .banks()
      .filter((b) => b.kind !== "setlist" && b.sysexBank !== null)
      .sort((a, b) => KEYBOARD_BANKS.findIndex((k) => k.key === a.key) - KEYBOARD_BANKS.findIndex((k) => k.key === b.key));

  function send() {
    const ws = wsRef.current;
    const l = linkRef.current;
    if (!ws || !l || !canSend) return;
    const groups = sendableBanks(ws)
      .map((b) => ({ info: b, idx: ws.changedIn(b.key) }))
      .filter((g) => g.idx.length > 0);
    const left = new Map<string, number>();
    for (const c of ws.changes()) if (!groups.some((g) => g.info.key === c.key)) left.set(c.key, (left.get(c.key) ?? 0) + 1);
    const leftText = [...left].map(([k, n]) => (k === GLOBAL_KEY ? "Global" : `${ws.info(k).label} (${n} slot(s))`)).join(", ");
    if (groups.length === 0) {
      setError(leftText ? `Nothing that can be sent has changed. Left out: ${leftText}.` : "Nothing has changed, so there is nothing to send.");
      return;
    }
    const total = groups.reduce((n, g) => n + g.idx.length, 0);
    const shown = groups.flatMap((g) => g.idx.map((i) => `${g.info.label} ${slot(i)} "${ws.nameOf(g.info.key, i)}"`)).slice(0, 10).join(", ");
    const more = total > 10 ? ` and ${total - 10} more` : "";
    const skipped = leftText ? ` Left out, not sent: ${leftText}.` : "";
    setDialog({
      message: `Send ${total} changed slot(s) in ${groups.length} bank(s) to the keyboard: ${shown}${more}.${skipped} Each bank's current keyboard copy is backed up first, to its own file. The keyboard keeps these in temporary memory until you press Store. Before you send, do a Disk mode Save All on the keyboard first.`,
      okLabel: "Send",
      run: async () => {
        const done: string[] = [];
        const written: string[] = [];
        const ok = await transfer("Sending to the keyboard", total, "Send cancelled. Some banks may already have reached the keyboard.", async (opts, phase) => {
          for (const { info, idx } of groups) {
            const clone = ws.clone();
            phase(`Backing up ${info.label}`, info.count);
            await pullBank(l.client, clone, info.key, opts);
            written.push(await api.writeBackup(backupName(info.key, "send"), serializePcg(clone)));
            phase(`Sending ${info.label}`, idx.length);
            await pushEntries(l.client, ws.file, info.key, idx, opts);
            done.push(info.key);
          }
        });
        // Banks that finished stay marked even when a later bank failed or the run was cancelled.
        if (done.length) setSentKeys((k) => [...k, ...done.filter((x) => !k.includes(x))]);
        if (ok) {
          const backups = written.length === 1 ? `Backup: ${written[0]}` : `Backups: ${written[0]} and ${written.length - 1} more.`;
          setNote(`Sent ${total} slot(s) in ${done.length} bank(s) to temporary memory. ${backups}`);
        }
      },
    });
  }

  function store() {
    const ws = wsRef.current;
    const l = linkRef.current;
    if (!ws || !l || !info || !canBank) return;
    const key = info.key;
    const backup = backupName(key, "store");
    const unsent = sentKeys.includes(key) ? "" : `Nothing has been sent for ${info.label} in this session, so Store would only make permanent what the keyboard already holds in temporary memory. Use Sync to keyboard first if you meant to put OpenKronos's slots on the keyboard. `;
    setDialog({
      message: `${unsent}Store makes ${info.label} permanent on the keyboard. Whatever is stored there now is replaced, and the app cannot undo that. The keyboard's current copy is backed up to ${backup} first. Do a Disk mode Save All on the keyboard first.`,
      okLabel: "Store permanently",
      run: async () => {
        let written = "";
        const ok = await transfer(`Backing up ${info.label}`, info.count, "Store cancelled. Nothing was stored.", async (opts, phase) => {
          const clone = ws.clone();
          await pullBank(l.client, clone, key, opts);
          written = await api.writeBackup(backup, serializePcg(clone));
          phase(`Storing ${info.label}`, 1);
          await storeBank(l.client, ws.file, key);
        });
        if (ok) {
          setSentKeys((k) => k.filter((x) => x !== key));
          setNote(`Stored ${info.label} on the keyboard. Backup: ${written}`);
        }
      },
    });
  }

  // What the AI may use as free slots: a bank counts only after it was read back from the keyboard and matched the file byte for byte.
  // Only banks with an Init slot are read (at most six per kind), and only a match is remembered, until that bank has an edit of its own.
  async function keyboardFacts(ws: Workspace, say: (l: string) => void): Promise<KeyboardFacts | null> {
    const l = linkRef.current;
    if (!l) return null;
    if (kbCache.current.ws !== ws) kbCache.current = { ws, match: new Map() };
    const banks: KeyboardFacts["banks"] = {};
    const per: Record<string, number> = { program: 0, combi: 0 };
    for (const b of ws.banks()) {
      if ((b.kind !== "program" && b.kind !== "combi") || b.sysexBank === null || !range(b.count).some((i) => isFreeName(ws.nameOf(b.key, i)))) continue;
      const sig = ws.changedIn(b.key).join(",");
      if (kbCache.current.match.get(b.key) === sig) { banks[b.key] = "match"; continue; }
      if (per[b.kind]++ >= 6) continue;
      say(`Checking ${b.label} against the keyboard`);
      try {
        const clone = ws.clone();
        await pullBank(l.client, clone, b.key);
        const same = differingSlots(b.count, (i) => getEntry(ws.file, b.key, i), (i) => getEntry(clone, b.key, i)).length === 0;
        banks[b.key] = same ? "match" : "differs";
        if (same) kbCache.current.match.set(b.key, sig);
        else kbCache.current.match.delete(b.key);
      } catch { /* a bank that could not be read stays unknown, and is not used */ }
    }
    return { banks };
  }

  // Put on keyboard: reads what the keyboard holds now, shows exactly what would be replaced, and writes only after a confirm that defaults to Cancel.
  async function prepare(s: Slot, T: ParamTables | null = tables) {
    const ws = wsRef.current;
    const l = linkRef.current;
    if (!ws || !l || !T || locked || aiRun) return;
    let r: Awaited<ReturnType<typeof readNeeds>>;
    try {
      r = await readNeeds(l.client, ws.file, T, s.key, s.index);
    } catch (e) {
      setError(describeError(e));
      return;
    }
    const targets = targetsOf(ws.file, s.key, s.index, r);
    if (targets.length === 0) {
      setNote("Everything this Combination needs is already on the keyboard.");
      setNeedsNonce((n) => n + 1);
      return;
    }
    const replace = targets.filter((t) => !t.keyboardFree);
    setDialog({
      message: "Put on keyboard. This is PERMANENT: each Store replaces what the keyboard holds in that slot, and the app cannot undo it. Each bank's current keyboard copy is backed up first. Nothing else is written.",
      lines: targets.map((t) => `Store ${t.label} "${t.name}" (keyboard now holds "${t.keyboardName}")${t.keyboardFree ? "" : ": this will REPLACE it"}`),
      ack: replace.length ? `I understand this will REPLACE ${replace.map((t) => `${t.label} "${t.keyboardName}"`).join(", ")}` : undefined,
      cancelDefault: true,
      okLabel: "Store permanently",
      run: async () => {
        const written: string[] = [];
        let done: Awaited<ReturnType<typeof putOnKeyboard>> | null = null;
        const ok = await transfer("Putting it on the keyboard", targets.length, "Cancelled. Slots that were already stored stay stored; check the Combination again.", async (opts, phase) => {
          try {
            done = await putOnKeyboard(l.client, ws.file, T, s.key, s.index, targets, async (key) => {
              const info = ws.info(key);
              const clone = ws.clone();
              phase(`Backing up ${info.label}`, info.count);
              await pullBank(l.client, clone, key, opts);
              written.push(await api.writeBackup(backupName(key, "send"), serializePcg(clone)));
              phase("Storing on the keyboard", targets.length);
            }, opts);
          } catch (e) {
            if (isAbort(e)) throw e;
            throw new Error(`Could not put it on the keyboard: ${prepareErrorText(e)}. Backups: ${written.join(", ") || "none yet"}.`);
          }
        });
        setNeedsNonce((n) => n + 1);
        if (!ok || !done) return;
        const d = done as Awaited<ReturnType<typeof putOnKeyboard>>;
        const bad = [...d.needs.map((n) => (n.state === "ready" || n.state === "unsupported" ? "" : `${n.label} "${n.name}"`)), d.combi.state === "ready" ? "" : `${d.combi.label} "${d.combi.name}"`].filter(Boolean);
        if (bad.length) { setError(`Stored, but reading the keyboard back does not match the file for ${bad.join(", ")}.`); return; }
        setNote(`Put ${targets.length} slot(s) on the keyboard and checked them. Backup: ${written.join(", ")}`);
        try { await callUpSlot(s); } catch (e) { setError(describeError(e)); }
      },
    });
  }

  // Sync to keyboard. A bank with a sync record is checked by the record: only its changed slots are pulled and sent.
  // full = true treats every bank as unknown ("Check everything"), for edits made on the keyboard itself.
  function syncKeyboard(full: boolean) {
    const ws = wsRef.current;
    const l = linkRef.current;
    if (!ws || !l || xfer) return;
    const go = async () => {
      const saved = await api.syncStateGet().catch(() => emptySyncState());
      let recorded = saved;
      let saveFailed = false;
      const persist = async (s: SyncState): Promise<void> => {
        try {
          await api.syncStateSet(s);
        } catch {
          saveFailed = true;
        }
      };
      const saveNote = () => (saveFailed ? " Could not save the sync record; the next Sync will check those banks again." : "");
      // fast: the changed slots from the record (no keyboard read needed to find them); null = full check.
      const todo: { info: BankInfo; fast: number[] | null }[] = [];
      for (const info of sendableBanks(ws)) {
        if (!full && bankKnown(saved, info.key)) {
          const idx = changedSinceSync(saved, info.key, info.count, (i) => getEntry(ws.file, info.key, i));
          if (idx.length > 0) todo.push({ info, fast: idx });
        } else {
          todo.push({ info, fast: null });
        }
      }
      const plans: { info: BankInfo; idx: number[]; fast: boolean }[] = [];
      const matched: BankInfo[] = [];
      const written: string[] = [];
      const ok = await transfer("Checking the keyboard", todo.reduce((n, t) => n + t.info.count, 0), "Check cancelled. Nothing was sent or stored.", async (opts, phase) => {
        for (const { info, fast } of todo) {
          const clone = ws.clone();
          phase(`Checking ${info.label}`, info.count);
          await pullBank(l.client, clone, info.key, opts);
          const idx = fast ?? differingSlots(info.count, (i) => getEntry(ws.file, info.key, i), (i) => getEntry(clone, info.key, i));
          if (idx.length === 0) {
            matched.push(info);
            continue;
          }
          written.push(await api.writeBackup(backupName(info.key, "sync"), serializePcg(clone)));
          plans.push({ info, idx, fast: fast !== null });
        }
      });
      // Banks verified before a cancel are still recorded, so a second try does not start over.
      const fileEntry = (key: string) => (i: number) => getEntry(ws.file, key, i);
      for (const info of matched) recorded = recordBank(recorded, info.key, info.count, fileEntry(info.key));
      if (matched.length) await persist(recorded);
      if (!ok) return;
      if (plans.length === 0) {
        const allFast = todo.every((t) => t.fast !== null);
        setNote((allFast ? "Nothing has changed since the last sync." : "The keyboard already matches this file. Nothing to sync.") + saveNote());
        return;
      }
      const total = plans.reduce((n, p) => n + p.idx.length, 0);
      const fastTotal = plans.filter((p) => p.fast).reduce((n, p) => n + p.idx.length, 0);
      const shown = plans.flatMap((p) => p.idx.map((i) => `${p.info.label} ${slot(i)} "${ws.nameOf(p.info.key, i)}"`)).slice(0, 10).join(", ");
      const more = total > 10 ? ` and ${total - 10} more` : "";
      const changed = fastTotal > 0 ? ` ${fastTotal} slot(s) changed since the last sync.` : "";
      setDialog({
        message: `Sync ${total} slot(s) in ${plans.length} bank(s) to the keyboard and store them permanently: ${shown}${more}.${changed} Stored banks replace the keyboard's copy; each bank's current keyboard copy is already backed up to its own file. The app cannot undo a store except by restoring that backup. Do a Disk mode Save All on the keyboard first.`,
        okLabel: "Sync and store",
        run: async () => {
          const done: string[] = [];
          const synced = await transfer("Syncing to the keyboard", total, "Sync cancelled. Some banks may already have been stored.", async (opts, phase) => {
            for (const p of plans) {
              const { info, idx } = p;
              phase(`Sending ${info.label}`, idx.length);
              await pushEntries(l.client, ws.file, info.key, idx, opts);
              phase(`Storing ${info.label}`, 1);
              await storeBank(l.client, ws.file, info.key);
              done.push(info.key);
              recorded = p.fast ? recordSlots(recorded, info.key, idx, fileEntry(info.key)) : recordBank(recorded, info.key, info.count, fileEntry(info.key));
              await persist(recorded);
            }
          });
          // Stored banks leave the sent list; a failed bank stays marked as it was.
          if (done.length) setSentKeys((k) => k.filter((x) => !done.includes(x)));
          if (synced) {
            const backups = written.length === 1 ? `Backup: ${written[0]}` : `Backups: ${written[0]} and ${written.length - 1} more.`;
            setNote(`Synced ${total} slot(s) in ${done.length} bank(s) and stored them. ${backups}${saveNote()}`);
          } else {
            const labelOf = (k: string) => plans.find((p) => p.info.key === k)?.info.label ?? k;
            setNote(`Sync stopped. Stored: ${done.map(labelOf).join(", ") || "none"}. Not stored: ${plans.filter((p) => !done.includes(p.info.key)).map((p) => p.info.label).join(", ") || "none"}.${saveNote()}`);
          }
        },
      });
    };
    void go();
  }

  async function confirmNow() {
    const d = dialog;
    if (!d) return;
    setDialog(null);
    await d.run(swapRefs);
  }

  // True while a Program or Combi is open in the editor, which is when LiveEdit (and so Check keyboard) exists.
  const verifyHere = !!w && !sounds && editor?.kind === "slot" && (w.info(editor.key).kind === "program" || w.info(editor.key).kind === "combi");
  const names = info && w ? range(info.count).map((i) => w.nameOf(info.key, i)) : [];
  const selectedSet = new Set(sel);
  // The palette and the shortcuts run these. Each is off while busy or while a dialog is open.
  const free = !locked && !dialog;
  const fileFree = free && !aiHold;
  const commands: ShellCommand[] = [
    { id: "open", title: "Open", keys: "Ctrl+O", enabled: fileFree, run: () => void openFile() },
    { id: "save", title: "Save", keys: "Ctrl+S", enabled: fileFree && !!w, run: () => void save(false) },
    { id: "save-as", title: "Save As", keys: "Ctrl+Shift+S", enabled: fileFree && !!w, run: () => void save(true) },
    { id: "undo", title: "Undo", keys: "Ctrl+Z", enabled: fileFree && !!w && w.canUndo, run: undo },
    { id: "redo", title: "Redo", keys: "Ctrl+Y", enabled: fileFree && !!w && w.canRedo, run: redo },
    { id: "find", title: "Find", keys: "Ctrl+F", enabled: free && !!w, run: () => searchRef.current?.focus() },
  ];

  // Style A hosts the MIDI player in the bottom dock; the other themes keep it in the right panel.
  const midiPanel = (
    <MidiPanel
              link={link}
              locked={locked}
              info={info}
              sel={sel}
              soundIdx={soundIdx}
              onPick={(key, index) => { openBank(key); setSel([index]); }}
              onError={setError}
              ask={(message, okLabel, run) => setDialog({ message, okLabel, run })}
              onSong={setSong}
              assignRef={assignRef}
            />
  );

  // Style A draws these two keys in the editor bar, on the row of the view switch; the other themes keep them under the toolbar.
  const edTools = w && tables && editor?.kind === "slot" ? (
    <>
      {["hd1", "exi"].includes(paramType(w.info(editor.key))) && <Variations key={editorKeys(editor.key, editor.index).variations} tables={tables} ws={w} slotKey={editor.key} index={editor.index} type={paramType(w.info(editor.key)) as "hd1" | "exi"} onChanged={bump} />}
      {(w.info(editor.key).kind === "program" || w.info(editor.key).kind === "combi") && <EffectsPanel key={editorKeys(editor.key, editor.index).effects} tables={tables} ws={w} target={editor} kind={w.info(editor.key).kind === "combi" ? "combi" : "program"} onChanged={bump} point={fxPoint && fxPoint === point ? point : null} onPointClear={() => tourDo({ type: "userNavigated" })} />}
    </>
  ) : null;

  return (
    <div className="app">
      <header className="topbar">
        <Wordmark />
        <button data-testid="open-file" onClick={openFile} disabled={xfer} title={holdTitle}>Open</button>
        <button data-testid="save-file" onClick={() => save(false)} disabled={!w || xfer} title={holdTitle}>Save</button>
        <button data-testid="undo" onClick={undo} disabled={!w || xfer || !w.canUndo} title={holdTitle}>Undo</button>
        <button data-testid="redo" onClick={redo} disabled={!w || xfer || !w.canRedo} title={holdTitle}>Redo</button>
        <StudioTools />
        <button data-testid="save-as" onClick={() => save(true)} disabled={!w || xfer} title={holdTitle}>Save As</button>
        <button data-testid="exchange-open" onClick={() => setExchange((x) => !x)} disabled={!w || aiHold} title={holdTitle}>Packs</button>
        <input
          data-testid="search"
          type="search"
          aria-label="Search names in all banks"
          placeholder="Search names"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={!w}
          ref={searchRef}
        />
        <span data-testid="file-name" className="file-name">{fileName || "No file open"}</span>
        <StatusPill connected={link !== null} status={status} />
        <StudioBlocks unsaved={changes.length} fileName={fileName} differs={verifyStrip ? !verifyStrip.ok : null} />
        <button data-testid="sounds-open" aria-pressed={sounds} onClick={() => setSounds((v) => !v)} disabled={!w}>Sounds</button>
        <Shell
          ws={w}
          commands={commands}
          undoLabels={w ? w.undoLabels() : []}
          modalOpen={dialog !== null}
          onDismissModal={() => setDialog(null)}
          onJump={jump}
          onUndoTo={undoTo}
          onOpened={(o, u) => void openOpened(o, u)}
          onError={setError}
        />
        <SettingsDialog />
        <SupportLinks variant="compact" />
        <button data-testid="overview-open" aria-pressed={overview} onClick={() => setOverview((v) => !v)} disabled={!w}>Overview</button>
        {w && overview && <Overview ws={w} onClose={() => setOverview(false)} onPick={(k, i) => { setOverview(false); setSounds(false); jump(k, i); }} />}
        <AiPanel ws={w} locked={locked} onChanged={bump} song={song} onAssign={(picks) => assignRef.current?.(picks)} onPoint={(p) => void pointAt(p)} onGoTo={(s) => jump(s.key, s.index)} onNewTurn={() => tourDo({ type: "newQuestion" })} onAudition={auditionLive} keyboardFacts={keyboardFacts} needsFor={(s, T) => <NeedsFor ws={w} link={link} tables={T} slot={s} rev={rev} paused={xfer && !aiHold} nonce={needsNonce} onPrepare={(x) => void prepare(x, T)} why={prepareWhy} />} abWhy={abOff} onCompareAb={(s, before) => setAb({ ...s, before, source: "the sound before the AI's changes", origin: "ai" })} selected={editor?.kind === "slot" && /^(program|combi|drumkit|waveseq)$/.test(w?.info(editor.key).kind ?? "") ? { key: editor.key, index: editor.index } : info && /^(program|combi|drumkit|waveseq)$/.test(info.kind) && bankKey && sel.length === 1 ? { key: bankKey, index: sel[0] } : null} />
        {w && ab && <AbBar key={`${ab.key}/${ab.index}`} ws={w} link={link} tables={tables} target={ab} why={abOff} onError={setError} onClose={() => setAb(null)} />}
        <SetLists host={isSet && !listView && !sounds && !editor && !query ? padHost : null} ws={w} locked={locked || aiRun} onChanged={bump} link={link} globalChannel={effectiveGlobalChannel(globalSetting, globalMidiChannel(w ? getGlobal(w.file) : null))} />
        <TransferBar busy={busy} />
      </header>

      {error && (
        <div className="error" data-testid="error-message" role="alert">
          {error}
        </div>
      )}

      {openNote && <p className="status" style={{ padding: "4px 16px" }} data-testid="open-note" role="status">{openNote}</p>}

      <div className="body">
        <nav className="banks" aria-label="Banks">
          {w && w.hasGlobal() && (
            <section>
              <h2>Global</h2>
              <button data-testid="global-item" className="bank" aria-current={onGlobal ? "true" : undefined} onClick={() => openEditor({ kind: "global" })}>
                <span>Global</span>
              </button>
            </section>
          )}
          {w &&
            GROUPS.map((g) => (
              <section key={g.kind}>
                <h2>{g.title}</h2>
                {banks
                  .filter((b) => b.kind === g.kind)
                  .map((b) => (
                    <button
                      key={b.key}
                      data-testid={`bank-${b.key}`}
                      className="bank"
                      aria-current={b.key === bankKey ? "true" : undefined}
                      onClick={() => openBank(b.key)}
                    >
                      <span>{b.label}</span>
                      <span className="num">{b.count}</span>
                    </button>
                  ))}
              </section>
            ))}
        </nav>

        <main className="slots" aria-label="Slots">
          {!w && <Welcome onOpen={openFile} onConnect={connectUsbNow} locked={locked} />}
          {w && sounds && <SoundBrowser ws={w} onPick={soundPicked} />}
          {w && !sounds && editor && (
            <section className="editor">
              {editor.kind === "slot" && (editInfo?.kind === "program" || editInfo?.kind === "combi") && (
                <SoundStrip
                  bank={editInfo.label}
                  no={slot(editor.index)}
                  name={w.nameOf(editor.key, editor.index)}
                  file={fileName || "No file open"}
                  os={link ? /OS (\d+\.\d+\.\d+)/.exec(link.status)?.[1] ?? null : null}
                  connected={link !== null}
                  unsaved={changes.length}
                  differs={verifyStrip ? !verifyStrip.ok : null}
                />
              )}
              <div className="toolbar">
                <button data-testid="close-editor" onClick={() => setEditor(null)}>Back to slots</button>
                <h1 data-testid="editor-title">
                  {editor.kind === "global" ? "Global" : `${editInfo?.label} ${slot(editor.index)} ${w.nameOf(editor.key, editor.index)}`}
                </h1>
                {editor.kind === "slot" && (w.info(editor.key).kind === "program" || w.info(editor.key).kind === "combi") && (
                  <LiveEdit key={editorKeys(editor.key, editor.index).live} ws={w} link={link} tables={tables} slotKey={editor.key} index={editor.index} rev={rev} locked={locked} ask={(message, okLabel, run) => setDialog({ message, okLabel, run })} onError={setError} onVerify={setVerifyStrip} verifyHost={verifyHost} />
                )}
                {editor.kind === "slot" && (w.info(editor.key).kind === "program" || w.info(editor.key).kind === "combi") && (
                  <>
                  <button type="button" data-testid="ab-open-editor" disabled={!editorAb || !!abOff} title={abOff ?? (editorAb ? "Hear this sound as saved and as it is now, on the keyboard" : "Nothing differs from the saved sound")} onClick={() => editorAb && setAb({ key: editor.key, index: editor.index, before: editorAb.bytes, source: editorAb.source, origin: "editor" })}>
                    {themeA && <span className="ab-chips" aria-hidden="true"><b>A</b><b>B</b></span>}Compare A/B
                  </button>
                  {themeA && <button type="button" data-testid="send-sound" onClick={send} disabled={!canSend} title={holdTitle ?? "Put every changed sound on the keyboard. Temporary until Store."}>Send</button>}
                  {(!editorAb || abOff) && <small className="status" data-testid="ab-why">{abOff ?? "Compare A/B: nothing differs from the saved sound yet"}</small>}
                  </>
                )}
              </div>
              {openNeeds && openNeeds.needs.length > 0 && <NeedsView info={openNeeds} onPrepare={(x) => void prepare(x)} why={prepareWhy} />}
              {verifyStrip && editor.kind === "slot" && (
                <div className="status" role="status" data-testid="verify-strip" data-ok={verifyStrip.ok ? "1" : "0"} style={{ padding: "6px 10px", borderLeft: `3px solid var(${verifyStrip.ok ? "--led-green" : "--led-red"})` }}>
                  {verifyStrip.text}{" "}
                  <button type="button" data-testid="verify-strip-close" onClick={() => setVerifyStrip(null)}>Dismiss</button>
                </div>
              )}
              {!themeA && edTools}
              {tables ? (
                <ParamEditor
                  key={editor.kind === "global" ? "global" : editorKeys(editor.key, editor.index).params}
                  tables={tables}
                  ws={w}
                  target={editor}
                  type={editor.kind === "global" ? "global" : paramType(w.info(editor.key))}
                  onChanged={bump}
                  lead={themeA ? edTools : null}
                  view={editorView}
                  onView={setEditorView}
                  point={editor.kind === "slot" && point?.key === editor.key && point.index === editor.index ? point : null}
                  onPointClear={() => tourDo({ type: "userNavigated" })}
                  onPointFx={setFxPoint}
                />
              ) : (
                <p className="empty">Loading parameters...</p>
              )}
              {tables && tour.active && point && editor.kind === "slot" && (
                <GuideCallout
                  ws={w} tables={tables} target={editor} type={paramType(w.info(editor.key))} rev={rev} point={point} index={tour.index} total={tour.steps.length}
                  settled={!tour.navigating} onChanged={bump} onNext={() => tourDo({ type: "next" })} onBack={() => tourDo({ type: "back" })} onCancel={() => tourDo({ type: "cancel" })} onOpen={() => setTourNonce((n) => n + 1)}
                  ab={tourBefore && tourBase && tourBefore.key === tourBase.key && tourBefore.index === tourBase.index ? { why: guideAb ? abOff : "Nothing has changed since the walkthrough started", open: () => guideAb && setAb({ key: tourBefore.key, index: tourBefore.index, before: guideAb.bytes, source: guideAb.source, origin: "guide" }) } : undefined}
                />
              )}
            </section>
          )}
          {w && !sounds && !editor && !query && isSet && !listView && (
            <div className="setpad-host" data-testid="setlists-main" ref={setPadHost}>
              <button data-testid="setlists-list-view" onClick={() => setListView(true)}>List view</button>
            </div>
          )}
          {w && !sounds && !editor && !query && info && !(isSet && !listView) && (
            <>
              <div className="toolbar">
                <h1>
                  {info.label} <span className="muted">{KIND_NAME[info.kind]}, {info.count} slots</span>
                </h1>
                <button data-testid="edit-params" onClick={() => openEditor({ kind: "slot", key: info.key, index: sel[0] })} disabled={!canEdit}>Edit</button>
                <button data-testid="swap" onClick={swap} disabled={!canSwap} title={runTitle}>Swap</button>
                <button data-testid="copy" onClick={copy} disabled={!canCopy}>Copy</button>
                <button data-testid="paste" onClick={paste} disabled={!canPaste} title={runTitle}>Paste</button>
                <Audition link={link} info={info} sel={sel} name={sel.length === 1 ? names[sel[0]] ?? "" : ""} onError={setError} ask={(message, okLabel, run) => setDialog({ message, okLabel, run })} />
                {isSet && <button data-testid="setlists-pad-view" onClick={() => setListView(false)}>Pad view</button>}
                <button data-testid="banktools-open" onClick={() => setTools(true)} disabled={!info || aiRun} title={runTitle}>Bank tools</button>
              </div>
              {tools && w && <BankTools ws={w} info={info} sel={sel} locked={locked} onChanged={bump} onJump={jump} onClose={() => setTools(false)} />}
              {exchange && w && <Exchange ws={w} info={info} sel={sel} locked={locked} onChanged={bump} ask={(message, okLabel, run) => setDialog({ message, okLabel, run })} onClose={() => setExchange(false)} />}
              <div className="rows" role="listbox" aria-multiselectable="true" aria-label={`${info.label} slots`} onKeyDown={arrowRows}>
                {range(info.count).map((i) => {
                  const selected = selectedSet.has(i);
                  const editing = rename?.index === i;
                  return (
                    <div
                      key={i}
                      className={`row${selected ? " selected" : ""}`}
                      data-testid={`row-${i}`}
                      role="option"
                      aria-selected={selected}
                      tabIndex={0}
                      onClick={(e) => pick(i, e.ctrlKey || e.metaKey)}
                      onDoubleClick={() => {
                        if (!locked && !aiRun) setRename({ index: i, value: names[i], error: null });
                      }}
                    >
                      <span className="slot">{slot(i)}</span>
                      {editing && rename ? (
                        <span className="renamer" onClick={(e) => e.stopPropagation()}>
                          <input
                            data-testid="rename-input"
                            aria-label={`New name for slot ${slot(i)}`}
                            autoFocus
                            maxLength={40}
                            value={rename.value}
                            onChange={(e) => setRename({ ...rename, value: e.target.value, error: null })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void commitRename();
                              if (e.key === "Escape") setRename(null);
                            }}
                            onBlur={() => setRename(null)}
                          />
                          {rename.error && (
                            <span className="rename-error" data-testid="rename-error" role="alert">
                              {rename.error}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="name" data-testid={`row-name-${i}`}>{names[i]}</span>
                      )}
                      {info.type && <span className="eng" data-engine={info.type}>{info.type === "hd1" ? "HD-1" : "EXi"}</span>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {w && !sounds && !editor && query && (
            <div className="hits">
              <h1>{hits.length === 0 ? "No names match" : `${hits.length}${hits.length === SEARCH_LIMIT ? "+" : ""} matches`}</h1>
              {hits.map((h) => (
                <button
                  key={`${h.key}-${h.index}`}
                  data-testid={`hit-${h.key}-${h.index}`}
                  className="hit"
                  onClick={() => {
                    openBank(h.key);
                    setSel([h.index]);
                    setSearch("");
                  }}
                >
                  <span className="muted">{h.bank} {slot(h.index)}</span> {h.name}
                </button>
              ))}
            </div>
          )}
        </main>

        <aside className="side">
          {w && info && (info.kind === "program" || info.kind === "combi") && sel.length === 1 && (
            <Collapse title="Used By" label="Used by" className="used-by" count={<span className="sec-count" data-testid="used-by-count">{usedBy.length}</span>}>
              <ul>
                {usedBy.map((r, n) => (
                  <li key={`${r.kind}-${r.fromKey}-${r.fromIndex}-${r.part}`}>
                    <button
                      data-testid={`used-by-item-${n}`}
                      className="change"
                      data-target={`${r.fromKey}/${r.fromIndex}`}
                      onClick={() => {
                        openBank(r.fromKey);
                        setSel([r.fromIndex]);
                      }}
                    >
                      {refText(w, r)}
                    </button>
                  </li>
                ))}
              </ul>
            </Collapse>
          )}
          <Collapse title="Changes" className="changes" count={<span className="sec-count" data-testid="changes-count">{changes.length}</span>}>
            <ul>
              {changes.map((c) => {
                if (c.key === GLOBAL_KEY) {
                  return (
                    <li key={c.key}>
                      <button data-testid="change-global" className="change" onClick={() => openEditor({ kind: "global" })}>
                        Global: settings changed
                      </button>
                    </li>
                  );
                }
                const label = w ? w.info(c.key).label : c.key;
                return (
                  <li key={`${c.key}-${c.index}`}>
                    <button data-testid={`change-${c.key}-${c.index}`} className="change" onClick={() => openBank(c.key)}>
                      {label} {slot(c.index)}: {c.before === c.after ? `"${c.after}"` : `"${c.before}" to "${c.after}"`}{c.settings ? ", settings changed" : ""}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Collapse>

          {busy && (
            <div className="progress" data-testid="progress" role="status">
              <span>
                {busy.label}: {busy.done} of {busy.total}
              </span>
              <progress max={Math.max(busy.total, 1)} value={busy.done} />
              <button data-testid="cancel-transfer" onClick={() => abortRef.current?.abort()}>Cancel</button>
            </div>
          )}
          <Collapse title="Keyboard" label="Keyboard" className="keyboard">
            <div className="kb-conn">
              <button data-testid="connect-usb" onClick={connectUsbNow} disabled={locked}>Connect USB</button>
              <button data-testid="disconnect" onClick={disconnect} disabled={!link || locked}>Disconnect</button>
            </div>
            <p className="status" data-testid="device-status" role="status">{status}</p>
            {note && <p className="status" data-testid="transfer-note">{note}</p>}
            <button className="kb-sim" data-testid="connect-sim" onClick={connectSim} disabled={(!w && !api.e2eBareSim) || xfer} title={holdTitle}>Connect Simulated</button>
            <ModeBar link={link} locked={locked} />
            <p className="kb-lead">Safe order, top to bottom. Nothing is permanent until step 4.</p>
            <ol className="steps" aria-label="Safe order">
              <li className="step">
                <div>
                  <h3>Check what differs</h3>
                  <p>Reads every bank on the keyboard and lists what differs. Asks before it sends.</p>
                </div>
                <button className="primary" data-testid="sync-full" onClick={() => syncKeyboard(true)} disabled={!w || !link || xfer} title={holdTitle}>Check everything</button>
              </li>
              <li className="step">
                <div>
                  <h3>Back up the keyboard</h3>
                  <p>Saves a dated copy of everything the keyboard can send.</p>
                </div>
                <BackupPanel link={link} locked={xfer} transfer={transfer} />
              </li>
              <li className="step">
                <div>
                  <h3>Send</h3>
                  <p>Puts every changed sound on the keyboard. Temporary until step 4.</p>
                </div>
                <button data-testid="push-bank" onClick={send} disabled={!canSend} title={holdTitle}>Send</button>
              </li>
              <li className="step">
                <div>
                  <h3>Store</h3>
                  <p>Permanent for the open bank. Asks first.</p>
                </div>
                <button className="guard" data-testid="store-bank" onClick={store} disabled={!canBank} title={holdTitle}>Store</button>
              </li>
              <li className="step">
                <div>
                  <h3>Verify</h3>
                  <p>Reads the open sound back and compares it.</p>
                </div>
                <span className="step-slot" ref={setVerifyHost}>
                  {!verifyHere ? <span className="status">Open a Program or Combi with Edit first</span> : themeA && <span className="status">Check keyboard is above the panels</span>}
                </span>
              </li>
            </ol>
            <div className="kb-sync">
              <button data-testid="sync-keyboard" onClick={() => syncKeyboard(false)} disabled={!w || !link || xfer} title={holdTitle}>Sync to keyboard</button>
              <p className="muted">Sync sends only what changed since the last sync. Use Check everything after editing on the keyboard itself.</p>
            </div>
            {info && sentKeys.includes(info.key) && (
              <p className="badge" data-testid="temp-badge">Sent, not saved on the keyboard yet</p>
            )}
            <h3 className="kb-sub">Get from the keyboard</h3>
            <p className="muted">Read-only. These never change the keyboard.</p>
            <div className="kb-grid">
              <button data-testid="pull-keyboard" onClick={pullWholeKeyboard} disabled={!link || xfer} title={holdTitle}>Pull Whole Keyboard</button>
              <button data-testid="pull-bank" onClick={pull} disabled={!canBank} title={holdTitle}>Pull</button>
              <span className="kb-wide">Pull from keyboard:</span>
              <select className="kb-wide" data-testid="pull-target" aria-label="Bank to pull" value={pullKey} onChange={(e) => setPullKey(e.target.value)} disabled={!link || xfer} title={holdTitle}>
                {GROUPS.filter((g) => g.kind !== "setlist").map((g) => (
                  <optgroup key={g.kind} label={g.title}>
                    {KEYBOARD_BANKS.filter((b) => b.kind === g.kind).map((b) => (
                      <option key={b.key} value={b.key}>{b.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button data-testid="pull-target-go" onClick={pullOne} disabled={!link || xfer} title={holdTitle}>Pull This Bank</button>
            </div>
            <BackupManager locked={xfer} onOpen={openBackup} ask={(message, okLabel, run) => setDialog({ message, okLabel, run })} onError={setError} />
          </Collapse>
          {w && <ComparePanel ws={w} locked={locked || aiRun} changes={changes} onChanged={bump} onBank={openBank} ask={(message, okLabel, run) => setDialog({ message, okLabel, run })} />}
          {!themeA && midiPanel}
        </aside>
      </div>
      <Dock link={link} globalChannel={effectiveGlobalChannel(globalSetting, globalMidiChannel(w ? getGlobal(w.file) : null))} playing={playing} extraChannels={extraCh} player={themeA ? midiPanel : undefined} />

      <Autosave ws={w} dirty={changes.length} onRestore={(b) => void restoreRecovered(b)} />

      {dialog && (
        <div className="scrim">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-message">
            <p id="dialog-message" data-testid="confirm-message">{dialog.message}</p>
            {dialog.lines && <ul data-testid="confirm-lines">{dialog.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
            {dialog.ack && (
              <label className="check">
                <input type="checkbox" data-testid="confirm-ack" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                {dialog.ack}
              </label>
            )}
            {dialog.refsOption && (
              <label className="check">
                <input type="checkbox" data-testid="swap-update-refs" checked={swapRefs} onChange={(e) => setSwapRefs(e.target.checked)} />
                Update Combis and Set Lists that use these
              </label>
            )}
            <div className="buttons end">
              <button data-testid="confirm-cancel" onClick={() => setDialog(null)} autoFocus={dialog.cancelDefault}>Cancel</button>
              <button data-testid="confirm-ok" className="primary" onClick={confirmNow} autoFocus={!dialog.cancelDefault} disabled={!!dialog.ack && !ack}>
                {dialog.okLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
