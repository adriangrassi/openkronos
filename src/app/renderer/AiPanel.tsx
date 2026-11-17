// The AI sound design panel: one request, a run on the open library, then one approve or discard for everything it changed.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAiDrag } from "./useAiDrag.ts";
import { AiAnswer, AiLog, useAiFontSize } from "./AiProse.tsx";
import { friendlyError, parseAiError, type AiErrorKind } from "../../core/ai/connect.ts";
import { getEntry, getName, setEntry } from "../../core/pcg/library.ts";
import { sameBytes } from "./bytes.ts";
import { insertName, toRange } from "./insertName.ts";
import type { PcgFile } from "../../core/pcg/pcg.ts";
import { askPrompt, userPromptFor, systemFor, ASK_SYSTEM, DEFAULT_SYSTEM, KIND_HINT, KIND_LABEL, ASK_TURNS, LOCAL_TURNS, REFINE_TURNS, runAgent, type ChatReply, type Message, type RunResult, type ToolDef } from "../../core/ai/agent.ts";
import { parkSlots, showCandidate, unionSlots, type Candidate } from "../../core/ai/compare.ts";
import { transcriptOf } from "../../core/ai/runlog.ts";
import { DEFAULT_SETTINGS } from "../../core/settings.ts";
import { runTool, SoundSession, type KeyboardFacts, type Slot, type TrackSound } from "../../core/ai/session.ts";
import { layerFrom, layerPoint, type LayerPlan } from "../../core/ai/layer.ts";
import { clearsPointOn, type PointAt } from "../../core/ai/point.ts";
import { askDisabledReason, awayFrom, NO_SOUND, SUPPORTED_HINT } from "../../core/ai/disabled.ts";
import { classifyIntent, promotedPrompt } from "../../core/ai/intent.ts";
import { buildSummary } from "../../core/ai/buildsummary.ts";
import { destLines, existingChanged, planDestination, type DestKind } from "../../core/ai/destination.ts";
import { clampRect, defaultRect, resizeRect, type Rect, type Reserved } from "../../core/ai/panelRect.ts";
import { digest, type ChangedRow } from "../../core/ai/digest.ts";
import { formatUsage, ZERO_USAGE } from "../../core/ai/usage.ts";
import { openingMessage, picksFromTracks, type SongFacts, type SongPick } from "../../core/ai/song.ts";
import type { ParamTables } from "../../core/params/params.ts";
import type { Workspace } from "./document.ts";
import { SpeechControls } from "./SpeechControls.tsx";
import type { SpeechHooks } from "./useSpeech.ts";
import { TRANSLATE_SYSTEM } from "../../core/ai/speakText.ts";
import { describeControl, EXPLAIN_HINT, type ExplainCtx } from "../../core/ai/explain.ts";
import { cacheKey, shouldCache } from "../../core/ai/answerCache.ts";
import { ensureParamDocs } from "./paramDocsLoad.ts";

const MAX_TURNS = 24;
// The baseline test's reference sounds, excluded when the owner ticks "Exclude Jump (test)".
const JUMP_TEST: Slot[] = [
  { key: "program:U-AA", index: 78 },
  { key: "program:U-BB", index: 107 },
];
const KIND_WORD: Record<string, string> = { program: "Program", combi: "Combi" };
const slot = (i: number): string => String(i).padStart(3, "0");
const clean = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "").replace(/\[ai:[a-z-]+\]\s*/, "");

type Result = { ok?: boolean; skipped?: string[]; error?: string; errors?: string[]; results?: unknown[]; slots?: unknown[]; changed?: ChangedRow[]; trackSounds?: unknown[]; sound?: { name?: string }; key?: string; index?: number; name?: string; written?: { name: string; text: string }[] };
type Review = { session: SoundSession; snapshot: PcgFile; slots: Slot[]; items: string[]; tracks: TrackSound[]; runId: string };
type Route = { provider: "cloud" | "claude" | "local"; model: string };
type Kind = "build" | "refine" | "ask";
// A finished A/B run: both candidates are parked as bytes and the library shows at most one of them.
type Cmp = { base: PcgFile; cands: Candidate[]; all: Slot[]; shown: "A" | "B" | null };
const routeLabel = (r: Route): string => (r.provider === "local" ? r.model : r.provider === "claude" ? "Claude" : "Cloud");
// Cloud (Codex) is the route the main process takes when none is named.
const routeArg = (r: Route): { provider: "local" | "claude"; model?: string } | undefined => (r.provider === "local" ? { provider: "local", model: r.model } : r.provider === "claude" ? { provider: "claude" } : undefined);
const turnsFor = (r: Route, kind: Kind): number => (r.provider === "local" ? LOCAL_TURNS[kind] : kind === "ask" ? ASK_TURNS : kind === "refine" ? REFINE_TURNS : MAX_TURNS);
const secs = (n: number): string => `${n.toFixed(1)} s`;

// The trackSounds of the last build_combi or assign_tracks that succeeded in a run.
function combiTracks(msgs: Message[]): TrackSound[] {
  let tracks: TrackSound[] = [];
  for (const m of msgs) {
    for (const c of m.toolCalls ?? []) {
      const r = msgs.find((x) => x.role === "tool" && x.toolCallId === c.id);
      if ((c.name === "build_combi" || c.name === "assign_tracks") && r && (JSON.parse(r.content) as { ok?: boolean }).ok === true) tracks = (c.arguments.trackSounds ?? []) as TrackSound[];
    }
  }
  return tracks;
}

// The settings the run pointed at with show_param (at most 4), for the editor to jump to.
function pointFrom(msgs: Message[]): PointAt | null {
  let out: PointAt | null = null;
  for (const m of msgs) {
    if (m.role !== "tool") continue;
    const call = msgs.flatMap((x) => x.toolCalls ?? []).find((c) => c.id === m.toolCallId);
    const res = JSON.parse(m.content) as { ok?: boolean; shown?: { id: string; name: string; text: string; note: string; suggest?: number }[] };
    if (call?.name !== "show_param" || !res.ok) continue;
    out ??= { key: String(call.arguments.key), index: Number(call.arguments.index), ids: [], notes: [], names: [], steps: [] };
    for (const s of res.shown ?? []) {
      if (out.ids.length < 4 && !out.ids.includes(s.id)) {
        out.ids.push(s.id);
        out.names.push(s.name);
        out.steps!.push(s.suggest === undefined ? { id: s.id, note: s.note } : { id: s.id, note: s.note, suggest: s.suggest });
        out.notes.push(`${s.note}: ${s.name} (now ${s.text})`);
      }
    }
  }
  return out;
}

// The set_params rows a run wrote, per slot, from the calls that succeeded.
function changedBySlot(msgs: Message[]): Map<string, ChangedRow[]> {
  const out = new Map<string, ChangedRow[]>();
  for (const m of msgs) {
    if (m.role !== "tool") continue;
    const call = msgs.flatMap((x) => x.toolCalls ?? []).find((c) => c.id === m.toolCallId);
    const res = JSON.parse(m.content) as Result;
    if (call?.name !== "set_params" || !res.ok) continue;
    const id = `${call.arguments.key}/${call.arguments.index}`;
    out.set(id, [...(out.get(id) ?? []), ...(res.changed ?? [])]);
  }
  return out;
}

// What an Ask run is given: the question, how to show it, the offline text, the value line shown beside the answer, and bypass (Re-ask) to skip the saved answer.
type AskArgs = { slot: Slot; text: string; ask?: boolean; shown?: string; fallback?: string; valueLine?: string; bypass?: boolean };

export function AiPanel({ ws, locked, onChanged, song, onAssign, selected, onPoint, onGoTo, onNewTurn, onAudition, onCompareAb, abWhy, keyboardFacts, needsFor }: { ws: Workspace | null; locked: boolean; onChanged: () => void; song: SongFacts | null; onAssign: (picks: SongPick[]) => void; selected: Slot | null; onPoint: (p: PointAt) => void; onGoTo: (s: Slot) => void; onNewTurn?: () => void; onAudition?: (slot: Slot) => Promise<void>; onCompareAb?: (s: Slot, before: Uint8Array) => void; abWhy?: string | null; keyboardFacts?: (w: Workspace, say: (l: string) => void) => Promise<KeyboardFacts | null>; needsFor?: (s: Slot, T: ParamTables | null) => ReactNode }) {
  const [open, setOpen] = useState(false);
  // A window the owner never moved is placed from the live layout (top bar, bank column, dock), so it follows resizes and theme changes; a moved one keeps its own spot.
  const [moved, setMoved] = useState<Rect | null>(() => {
    try { const o = JSON.parse(localStorage.getItem("kronos.ai.rect") ?? "null"); if (o && typeof o.x === "number") return clampRect(o, window.innerWidth, window.innerHeight); } catch { /* fall through to the default */ }
    return null;
  });
  const placed = (): Rect => {
    const edge = (sel: string, side: "top" | "right" | "bottom") => document.querySelector(sel)?.getBoundingClientRect()[side];
    const res: Reserved = { top: edge(".topbar", "bottom") ?? 88, left: edge(".banks", "right") ?? 0, right: edge(".slots", "right") ?? window.innerWidth, bottom: Math.min(edge(".dock", "top") ?? window.innerHeight, edge(".ab-bar", "top") ?? Infinity) };
    return defaultRect(window.innerWidth, window.innerHeight, res);
  };
  const [auto, setAuto] = useState<Rect>(placed);
  // After every render while open: the hold bar (bottom right) and the dock come and go, and the window must stay clear of both, notably of Keep.
  useLayoutEffect(() => { if (open) setAuto((a) => { const n = placed(); return a.x === n.x && a.y === n.y && a.w === n.w && a.h === n.h ? a : n; }); });
  const rect = moved ?? auto;
  const keep = (r: Rect | null) => { setMoved(r); if (r) localStorage.setItem("kronos.ai.rect", JSON.stringify(r)); else localStorage.removeItem("kronos.ai.rect"); };
  useEffect(() => {
    const onResize = () => { setMoved((r) => r && clampRect(r, window.innerWidth, window.innerHeight)); setAuto(placed()); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const dragProps = useAiDrag(rect, keep);
  const fs = useAiFontSize();
  const [prompt, setPrompt] = useState("");
  const [refineText, setRefineText] = useState("");
  const [askText, setAskText] = useState("");
  // Shift-clicking a piano key types its name where the caret last was in one of the three boxes; blur keeps the spot after the click moves focus.
  const firstKey = useRef<{ id: string; from: number; to: number; name: string; note: number } | null>(null); // the first Shift-clicked key: a second one while Shift is still held makes a range
  const lastBox = useRef<{ id: "prompt" | "refine" | "ask"; start: number; end: number } | null>(null);
  const rememberBox = (id: "prompt" | "refine" | "ask") => (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => { lastBox.current = { id, start: e.currentTarget.selectionStart ?? 0, end: e.currentTarget.selectionEnd ?? 0 }; };
  const [hideJump, setHideJump] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [note, setNote] = useState("");
  const [built, setBuilt] = useState<string[]>([]); // what a promoted run built, shown outside the scrolling log
  const [usage, setUsage] = useState(""); // the finished run's token line, empty when the model reported none
  const panelRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true); // follow new lines unless the user scrolled up to read
  useEffect(() => { if (running) stick.current = true; }, [running]);
  useEffect(() => { const el = panelRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [log, note, usage, running, review, built, rect.h]);
  const [kept, setKept] = useState<TrackSound[] | null>(null); // the trackSounds of the last kept run
  const [layer, setLayer] = useState<LayerPlan | null>(null); // the last Ask's layer plan: its steps, and Build it for me
  const [cfg, setCfg] = useState<Route>({ provider: DEFAULT_SETTINGS.aiProvider, model: DEFAULT_SETTINGS.aiModel });
  const [ready, setReady] = useState(false); // AUTOROUTER_KEY is set in the main process
  const [pick, setPick] = useState<Route | null>(null); // this run's provider and model, when the owner overrode Settings
  const [cmpA, setCmpA] = useState<Route>({ provider: "cloud", model: DEFAULT_SETTINGS.aiModel });
  const [cmpB, setCmpB] = useState<Route>({ provider: "local", model: DEFAULT_SETTINGS.aiModel });
  const [cmp, setCmp] = useState<Cmp | null>(null);
  const [dest, setDest] = useState<DestKind>("current"); // where Keep puts the result of a run that changed an existing sound
  const [goto, setGoto] = useState<{ slot: Slot; point: PointAt | null } | null>(null); // where a finished run's result is, when the owner had moved on
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const kbRef = useRef<KeyboardFacts | null>(null); // what the last run knew about the keyboard, for Keep as
  const abortRef = useRef<AbortController | null>(null);
  const tablesRef = useRef<ParamTables | null>(null);
  const [busyMsg, setBusyMsg] = useState("");
  const lengthRef = useRef<"brief" | "normal" | "detailed">("normal"); // the offline explain text follows the answer-length setting
  const langRef = useRef<"en" | "pt">("en");
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ aiLength: "brief" | "normal" | "detailed"; speechLang: "en" | "pt" }>).detail; lengthRef.current = d.aiLength; langRef.current = d.speechLang; };
    void window.kronos.settingsGet().then((s) => { lengthRef.current = s.aiLength; langRef.current = s.speechLang; }).catch(() => {});
    window.addEventListener("kronos-settings", on);
    return () => window.removeEventListener("kronos-settings", on);
  }, []);
  const lastRoute = useRef<Route | null>(null); // the provider the last Ask used, which also translates a mismatched answer before it is spoken
  const speechHooks: SpeechHooks = {
    translate: async (text, lang) => {
      const rt = lastRoute.current ?? route;
      const r = await window.kronos.aiChat([{ role: "system", content: TRANSLATE_SYSTEM[lang] }, { role: "user", content: text }], [], routeArg(rt));
      return r.content;
    },
    soundName: () => (selected && ws ? ws.nameOf(selected.key, selected.index) : ""),
    replace: (text, lang) => { setAnswer(text); setNote(`${text}

(${lang === "pt" ? "traduzido" : "translated"})`); },
  };
  // Set when the chosen provider is not installed or not signed in: the window then says so in plain words and offers the settings, instead of an opaque failure.
  const [notReady, setNotReady] = useState<{ provider: Route["provider"]; kind: AiErrorKind } | null>(null);
  const flagNotReady = (provider: Route["provider"], err: unknown) => {
    const t = parseAiError(err instanceof Error ? err.message : String(err ?? ""));
    if (t && (t.kind === "not-installed" || t.kind === "not-signed-in")) setNotReady({ provider, kind: t.kind });
  };
  const [answer, setAnswer] = useState(""); // the finished Ask answer, which SpeechControls can read aloud
  // Set while the shown answer came from the saved answers: Re-ask runs the same question again and replaces the saved one.
  const [cached, setCached] = useState<{ redo: AskArgs } | null>(null);
  const goRef = useRef<typeof go>(go);
  goRef.current = go;
  async function openEngine(w: Workspace, s: Slot): Promise<string | undefined> {
    try { return (new SoundSession(await tables(), w.file, { hide: [], ask: true }).describe(s.key, s.index) as unknown as { engine?: string }).engine; } catch { return undefined; }
  }
  // Shift-click on a control (explain.ts) lands here: the same Ask run as the Ask button, read-only, with the app's own help text as the fallback.
  const explainRef = useRef<(ctx: ExplainCtx) => void | Promise<void>>(() => {});
  explainRef.current = async (ctx) => {
    if (busy) { setBusyMsg("AI is busy"); window.setTimeout(() => setBusyMsg(""), 3000); return; }
    await ensureParamDocs();
    const engine = selected && ws ? await openEngine(ws, selected) : undefined;
    setCached(null);
    const info = selected && ws ? ws.info(selected.key) : null;
    const req = describeControl({ ...ctx, engine, soundKind: info ? KIND_LABEL[info.kind as keyof typeof KIND_LABEL] : undefined, soundName: info && selected && ws ? ws.nameOf(selected.key, selected.index) : undefined }, lengthRef.current, langRef.current);
    setOpen(true);
    setAskText(`Explain "${req.label}"`);
    if (selected && ws && !locked && !routeBlocked) { void go({ slot: selected, text: req.question, ask: true, shown: `Explain "${req.label}"`, fallback: req.offline, valueLine: req.valueLine }); return; }
    setLog([`You: Ask: Explain "${req.label}"`]);
    setNote(`${req.offline}

${selected ? "The AI is not available right now" : NO_SOUND}, so this is the help text built into the app.`);
  };
  useEffect(() => {
    const on = (e: Event) => explainRef.current((e as CustomEvent<ExplainCtx>).detail);
    window.addEventListener("kronos-explain", on);
    return () => window.removeEventListener("kronos-explain", on);
  }, []);
  const busy = running || review !== null || cmp !== null;
  useEffect(() => {
    const onKey = (ev: Event) => {
      const box = lastBox.current;
      if (!open || busy || !box) return;
      const key = (ev as CustomEvent<{ name: string; note: number }>).detail;
      const text = box.id === "prompt" ? prompt : box.id === "refine" ? refineText : askText;
      const setText = box.id === "prompt" ? setPrompt : box.id === "refine" ? setRefineText : setAskText;
      const first = firstKey.current;
      if (first && first.id === box.id && text.slice(first.from, first.to) === first.name) {
        const r = toRange(text, first.from, first.to, first, key);
        setText(r.text);
        lastBox.current = { ...box, start: r.caret, end: r.caret };
        firstKey.current = null;
        return;
      }
      const r = insertName(text, box.start, box.end, key.name);
      setText(r.text);
      lastBox.current = { ...box, start: r.caret, end: r.caret };
      firstKey.current = { id: box.id, from: r.from, to: r.to, name: key.name, note: key.note };
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === "Shift") firstKey.current = null; };
    window.addEventListener("kronos-key-name", onKey);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("kronos-key-name", onKey); window.removeEventListener("keyup", onUp); };
  }, [open, busy, prompt, refineText, askText]);
  // The sound the A/B bar compares: the open one if the run changed it, else the first changed Program or Combi.
  const abSlot = review ? review.slots.find((s) => s.key === selected?.key && s.index === selected?.index) ?? review.slots.find((s) => ws?.info(s.key).kind === "program" || ws?.info(s.key).kind === "combi") ?? null : null;
  const hiddenJump = (w: Workspace): Slot[] => (hideJump ? JUMP_TEST.filter((x) => w.banks().some((b) => b.key === x.key && b.count > x.index)) : []);
  const slotLabel = (w: Workspace, x: Slot): string => `${w.info(x.key).label} ${slot(x.index)}`;
  // The Keep-as group and its preview lines, for the review or for each candidate of a comparison.
  const destInfo = useMemo(() => {
    if (!ws) return null;
    const T = tablesRef.current;
    const one = (base: PcgFile, lib: PcgFile, slots: Slot[]) => {
      const existing = existingChanged(slots, base, lib);
      const plan = dest !== "current" && T ? planDestination(T, dest, slots, base, lib, { hide: hiddenJump(ws), keyboard: kbRef.current }) : null;
      return { existing, error: plan && !plan.ok ? plan.error : "", lines: plan && !plan.ok ? [] : destLines(dest, existing, plan, (x) => slotLabel(ws, x)).preview };
    };
    if (review) return { review: one(review.snapshot, ws.file, review.slots) };
    if (cmp) return { cands: cmp.cands.map((c) => { const lib = ws.clone(); showCandidate(lib, cmp.base, cmp.all, c); return one(cmp.base, lib, c.slots.filter((x) => !sameBytes(getEntry(cmp.base, x.key, x.index), getEntry(lib, x.key, x.index)))); }) };
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review, cmp, dest, ws, ws?.nameRev, hideJump]);
  const route = pick ?? cfg;
  const routeBlocked = route.provider === "local" && !ready;
  const refineWhy = askDisabledReason({ selected: !!selected, busy, locked, routeBlocked, text: refineText });
  const askWhy = askDisabledReason({ selected: !!selected, busy, locked, routeBlocked, text: askText });

  useEffect(() => {
    void window.kronos.aiLocalReady().then(setReady).catch(() => {});
    const take = (st: { aiProvider: Route["provider"]; aiModel: string }) => setCfg({ provider: st.aiProvider, model: st.aiModel });
    void window.kronos.settingsGet().then((st) => {
      take(st);
      setCmpB((b) => ({ ...b, model: st.aiModel }));
    });
    const onSettings = (e: Event) => take((e as CustomEvent<{ aiProvider: Route["provider"]; aiModel: string }>).detail);
    window.addEventListener("kronos-settings", onSettings);
    return () => window.removeEventListener("kronos-settings", onSettings);
  }, []);

  useEffect(() => {
    if (!ws && !busy) setOpen(false);
  }, [ws, busy]);

  async function tables(): Promise<ParamTables> {
    if (!tablesRef.current) {
      const mod = await import("../../generated/params.json");
      tablesRef.current = mod.default as unknown as ParamTables;
    }
    return tablesRef.current;
  }

  // A readable line for each tool result, from the call that asked for it.
  function toolLine(m: Message, msgs: Message[], w: Workspace): string {
    const call = msgs.flatMap((x) => x.toolCalls ?? []).find((c) => c.id === m.toolCallId);
    const name = call?.name ?? "tool";
    const args = (call?.arguments ?? {}) as Record<string, unknown>;
    let r: Result;
    try {
      r = JSON.parse(m.content) as Result;
    } catch {
      return `  ${name}: unreadable result`;
    }
    if (!r.ok) return `  ${name} refused: ${r.error ?? (r.errors ?? []).join("; ")}${/pull it first/.test(r.error ?? "") ? ". Pull this bank from the keyboard, then run again" : ""}`;
    const where = (k: unknown, i: unknown): string => (typeof k === "string" && typeof i === "number" && w.banks().some((b) => b.key === k) ? `${w.info(k).label} ${slot(i)}` : "");
    switch (name) {
      case "search_sounds":
        return `  Searched${typeof args.text === "string" && args.text ? ` "${args.text}"` : ""}: ${(r.results ?? []).length} found`;
      case "describe_sound": {
        const groups = Array.isArray(args.groups) ? args.groups.join(", ") : typeof args.group === "string" ? args.group : "";
        return `  Read "${r.sound?.name ?? ""}" ${where(args.key, args.index)}${groups ? ` · ${groups}` : ""}`.trimEnd();
      }
      case "set_params":
        return `  ${typeof args.key === "string" && typeof args.index === "number" ? w.nameOf(args.key, args.index) : "Sound"}: ${digest(r.changed ?? []).groups}`;
      case "free_slots":
        return `  ${(r.slots ?? []).length} free slot(s)${r.skipped?.length ? `. Not used: ${r.skipped.join("; ")}. Pull this bank to use it` : ""}`;
      case "configure_combi": {
        const mods = ((args.karma as { modules?: { module: string }[] } | undefined)?.modules ?? []).map((m) => {
          const ge = (r.written ?? []).find((x) => x.name === `KARMA Module ${m.module} / GE Number`)?.text;
          return `KARMA ${m.module}${ge ? `: ${ge}` : ""}`;
        });
        const dt = (args.drumTrack as { on?: boolean } | undefined)?.on;
        const bits = [args.tempo !== undefined ? `tempo ${args.tempo}` : "", dt === undefined ? "" : `Drum Track ${dt ? "on" : "off"}`, ...mods].filter(Boolean);
        return `  Configured Combi ${where(r.key, r.index)}${bits.length ? `: ${bits.join(", ")}` : ""}`;
      }
      case "assign_tracks":
        return `  Assigned ${(r.trackSounds ?? []).length} track sound(s)`;
      case "search_ge":
        return `  Searched GEs "${args.query}": ${(r.results ?? []).length} found`;
      case "copy_sound":
      case "build_combi":
        return `  Wrote "${r.name}" to ${where(r.key, r.index)}${name === "copy_sound" ? ` (copy of ${where(args.fromKey, args.fromIndex)})` : ""}`;
      default:
        return `  ${name}: ok`;
    }
  }

  function labelOf(w: Workspace, snapshot: PcgFile, s: Slot): string {
    const b = w.info(s.key);
    const before = getName(snapshot, s.key, s.index);
    const after = w.nameOf(s.key, s.index);
    return `${KIND_WORD[b.kind] ?? b.kind} ${b.label} ${slot(s.index)} ${after}${before && before !== after ? ` (was "${before}")` : ""}`;
  }

  // The same agent loop for Go, Refine, Ask and each side of a comparison: it logs its steps, then its seconds and tokens.
  async function runModel(w: Workspace, o: { route: Route; kind: Kind; request: string; prompt: string; maxTurns: number; ac: AbortController; session: SoundSession; say: (l: string) => void; candidate?: "A" | "B" }): Promise<{ r: RunResult; seconds: number; runId: string }> {
    const { route: rt, kind, ac, session, say } = o;
    let seen = 0;
    const flush = (msgs: Message[]) => {
      for (; seen < msgs.length; seen++) {
        const m = msgs[seen];
        if (m.role === "tool") say(toolLine(m, msgs, w));
      }
    };
    const chat = async (msgs: Message[], tools: ToolDef[]): Promise<ChatReply> => {
      flush(msgs);
      let reply: ChatReply;
      try {
        reply = await window.kronos.aiChat(msgs, tools, routeArg(rt));
      } catch (e) {
        if (ac.signal.aborted) return { content: "", toolCalls: [] }; // runAgent turns an abort into Cancelled
        throw e;
      }
      // An Ask run shows its final reply as the answer below the log; the log line would draw it twice.
      if (reply.content.trim() && !(kind === "ask" && reply.toolCalls.length === 0)) say(`Model: ${reply.content.trim()}`);
      return reply;
    };
    lastRoute.current = rt;
    const t0 = performance.now();
    const st = await window.kronos.settingsGet();
    const r = await runAgent({ session, system: systemFor(kind === "ask" ? ASK_SYSTEM : DEFAULT_SYSTEM, st.speechLang, st.aiLength), prompt: kind === "build" ? o.prompt : userPromptFor(o.prompt, st.speechLang), chat, maxTurns: o.maxTurns, signal: ac.signal });
    const seconds = (performance.now() - t0) / 1000;
    flush(r.messages);
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    say(`${routeLabel(rt)}: ${secs(seconds)}${r.usage ? `, ${formatUsage(r.usage, r.steps)}` : `, ${r.steps} step(s)`}`);
    window.kronos.aiUsageLog({ time: new Date().toISOString(), request: o.request.slice(0, 80), steps: r.steps, ...(r.usage ?? ZERO_USAGE), song: song?.name ?? null }).catch(() => {});
    const u = r.usage ?? ZERO_USAGE;
    window.kronos.aiRunLog({ type: "run", id: runId, time: new Date().toISOString(), kind, provider: rt.provider, model: routeLabel(rt), prompt: o.request, seconds, steps: r.steps, tokens: u, status: r.status, slots: session.touched(), candidate: o.candidate ?? null, transcript: transcriptOf(r.messages) }).catch(() => {});
    return { r, seconds, runId };
  }

  function decide(id: string, decision: "keep" | "discard" | "audition", candidate: "A" | "B" | null = null, destination?: { destination: string; destinationNote: string }) {
    window.kronos.aiRunLog({ type: "decision", id, time: new Date().toISOString(), decision, candidate, ...destination }).catch(() => {});
  }

  // Build it for me: the plan's build_combi, exactly, with no model in between. The review that follows is the same as for any run.
  function buildDirect(w: Workspace, session: SoundSession, plan: LayerPlan, say: (l: string) => void): { r: RunResult; seconds: number; runId: string } {
    const call = { id: "layer", name: "build_combi", arguments: { name: plan.name, parts: plan.parts } };
    const result = runTool(session, call.name, call.arguments);
    const messages: Message[] = [{ role: "assistant", content: "", toolCalls: [call] }, { role: "tool", toolCallId: call.id, content: JSON.stringify(result) }];
    say(toolLine(messages[1], messages, w));
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const status = result.ok ? "done" : "error";
    window.kronos.aiRunLog({ type: "run", id: runId, time: new Date().toISOString(), kind: "build", provider: "cloud", model: "Build it for me", prompt: `Build it for me: ${plan.name}`, seconds: 0, steps: 0, tokens: ZERO_USAGE, status, slots: session.touched(), candidate: null, transcript: transcriptOf(messages) }).catch(() => {});
    return { r: { status, finalText: "", error: result.ok ? undefined : String(result.error), touched: session.touched(), messages, steps: 0 }, seconds: 0, runId };
  }

  // A Refine run is the same loop on one Program, with a restricted session and a short step cap.
  async function go(refine?: AskArgs, direct?: LayerPlan) {
    const ask = refine?.ask === true;
    // A Refine that adds instruments, layers, splits or KARMA needs a Combination: it runs as a build, with the open sound kept as part 1.
    const promoted = !!refine && !ask && ws?.info(refine.slot.key).kind === "program" && classifyIntent(refine.text).kind === "build-layer";
    const openKind = (refine && ws?.info(refine.slot.key).kind) || "program";
    const kind: Kind = ask ? "ask" : promoted ? "build" : refine ? "refine" : "build";
    const maxTurns = turnsFor(route, kind);
    const text = direct ? `Build it for me: ${direct.name}` : ask && refine ? `${KIND_LABEL[openKind]} ${ws?.info(refine.slot.key).label} ${slot(refine.slot.index)} "${ws?.nameOf(refine.slot.key, refine.slot.index)}" is at ${refine.slot.key} ${refine.slot.index}. Question: ${refine.text}` : refine ? `Refine ${KIND_LABEL[openKind]} ${ws?.info(refine.slot.key).label} ${slot(refine.slot.index)} "${ws?.nameOf(refine.slot.key, refine.slot.index)}" as follows: ${refine.text}. ${KIND_HINT[openKind] ? `${KIND_HINT[openKind]} ` : ""}Read it first, change ONLY ${openKind === "combi" ? "that Combination and the Programs its timbres play" : "that sound"} with set_params (no copy_sound, build_combi, assign_tracks, configure_combi, search_ge), keep its character, make the smallest change that gives what was asked, apply the richness checklist only where it serves the request. A MAX of ${maxTurns} steps.` : prompt.trim();
    if (!ws || busy || locked || (routeBlocked && !direct) || text === "") return;
    const w = ws;
    if (clearsPointOn("ask")) onNewTurn?.();
    setNote("");
    setAnswer("");
    setNotReady(null);
    setCached(null);
    setBuilt([]);
    setUsage("");
    setKept(null);
    setGoto(null);
    if (!direct) setLayer(null); // a failed or discarded Build keeps the plan, so it can be tried again
    setLog([`You: ${refine ? `${ask ? "Ask" : "Refine"}: ${refine.shown ?? refine.text}` : text}`, ...(promoted ? ["This needs a Combination: building it for you"] : [])]);
    setRunning(true);
    w.holdAll();
    onChanged();
    let reviewing = false;
    const ac = new AbortController();
    abortRef.current = ac;
    const snapshot = w.clone();
    const say = (line: string) => setLog((l) => [...l, line]);
    try {
      await ensureParamDocs();
      const T = await tables();
      const hide = hideJump ? JUMP_TEST.filter((s) => w.banks().some((b) => b.key === s.key && b.count > s.index)) : [];
      const kb = kind === "build" && keyboardFacts ? await keyboardFacts(w, say) : null;
      kbRef.current = kb;
      const session = new SoundSession(T, w.file, ask ? { hide, ask } : promoted ? { hide, protect: [refine!.slot], keyboard: kb } : { hide, onlySlot: refine?.slot, keyboard: kb });
      const open = ask && refine ? { ...(session.describe(refine.slot.key, refine.slot.index) as unknown as { name: string; kind: string; engine: string }), key: refine.slot.key, index: refine.slot.index, bank: w.info(refine.slot.key).label } : null;
      const base = promoted ? { ...(session.describe(refine!.slot.key, refine!.slot.index) as unknown as { name: string; engine: string }), key: refine!.slot.key, index: refine!.slot.index, bank: w.info(refine!.slot.key).label } : null;
      // A saved answer is looked up by the question and the engine, never the sound's name or value; a hit makes no model call.
      const keyed = ask && refine && open ? await window.kronos.settingsGet() : null;
      const ckey = keyed && refine && open ? cacheKey({ namespace: refine.shown !== undefined ? "explain" : "ask", question: refine.text, kind: open.kind, engine: open.engine, lang: keyed.speechLang, length: keyed.aiLength }) : null;
      if (ckey && refine && !refine.bypass) {
        const hit = await window.kronos.aiCacheGet(ckey).catch(() => null);
        if (hit) {
          setNote(refine.valueLine ? `${hit}

${refine.valueLine}` : hit);
          setAnswer(hit);
          setCached({ redo: { ...refine, bypass: true } });
          return;
        }
      }
      const { r, seconds, runId } = direct ? buildDirect(w, session, direct, say) : await runModel(w, { route, kind, request: refine ? refine.text : text, prompt: open && refine ? askPrompt(open, refine.text) : base && refine ? promotedPrompt(base, refine.text) : refine ? text : openingMessage(text, song), maxTurns, ac, session, say });
      if (r.usage) setUsage(`${routeLabel(route)}: ${secs(seconds)}, ${formatUsage(r.usage, r.steps)}`);
      if (r.status === "error") {
        say(`Failed: ${clean(r.error)}`);
        flagNotReady(route.provider, r.error);
      }
      if (r.status === "turn-limit") say(`Stopped after ${maxTurns} turns.`);
      if (r.status === "cancelled") say("Cancelled.");
      if (promoted) setBuilt(buildSummary(r.messages, (k, i) => `${w.info(k).label} ${slot(i)} ${w.nameOf(k, i)}`, (n) => `${n} ${T.valueLists["KARMA GE"]?.[n] ?? ""}`.trim()));
      if (ask) {
        // An explanation still teaches when no model answered: the app's own text takes its place.
        setNote(refine?.fallback && (r.status === "error" || !r.finalText.trim()) ? `${refine.fallback}

No AI answer was available, so this is the help text built into the app.` : (r.finalText.trim() || "No answer.") + (refine?.valueLine && r.finalText.trim() ? `

${refine.valueLine}` : ""));
        setAnswer(r.status === "error" || !r.finalText.trim() ? refine?.fallback ?? "" : r.finalText.trim());
        if (ckey && shouldCache({ status: r.status, text: r.finalText, soundName: open?.name, tools: r.messages.flatMap((m) => m.toolCalls ?? []).map((c) => c.name) })) void window.kronos.aiCachePut(ckey, r.finalText.trim()).catch(() => {});
        const plan = layerFrom(r.messages);
        if (plan) setLayer(plan);
        const p = plan ? layerPoint(plan) : pointFrom(r.messages);
        if (p && refine && awayFrom(selectedRef.current, refine.slot)) setGoto({ slot: refine.slot, point: p });
        else if (p) onPoint(p);
        return;
      }
      const slots = w.changedSince(snapshot, session.touched());
      if (slots.length > 0) {
        const rows = changedBySlot(r.messages);
        const items = slots.map((s) => {
          const d = digest(rows.get(`${s.key}/${s.index}`) ?? []);
          return `${labelOf(w, snapshot, s)}${d.count ? `: ${d.count} parameter(s) - ${d.groups}` : ""}`;
        });
        w.holdSlots(session.touched());
        reviewing = true;
        const shown = promoted ? slots.find((x) => x.key.startsWith("combi:")) ?? slots[0] : refine?.slot ?? slots[0];
        if (awayFrom(selectedRef.current, shown)) setGoto({ slot: shown, point: null });
        setDest("current");
        setReview({ session, snapshot, slots, items, tracks: combiTracks(r.messages), runId });
      } else {
        const tracks = combiTracks(r.messages);
        if (tracks.length > 0) setKept(tracks); // assign-only run: the track button goes right under the summary
        setNote(direct && r.error ? r.error : "No changes were made.");
      }
    } catch (e) {
      say(`Failed: ${clean(e)}`);
      flagNotReady(route.provider, e);
      setNote("No changes were made.");
    } finally {
      if (!reviewing) { w.release(); if (refine?.shown === undefined) window.dispatchEvent(new Event("kronos-live-resync")); } // an explanation touches nothing, so it sends nothing to the keyboard
      w.refresh(); // sounds the owner browsed to mid-run were cached before the run's last writes
      abortRef.current = null;
      setRunning(false);
      onChanged();
    }
  }

  // The same prompt through two providers, one after the other, each parked as a candidate so the owner can audition both.
  async function compare() {
    const text = prompt.trim();
    if (!ws || busy || locked || text === "" || [cmpA, cmpB].some((r) => r.provider === "local" && !ready)) return;
    const w = ws;
    setNote("");
    setUsage("");
    setKept(null);
    setLog([`You: Compare: ${text}`]);
    setRunning(true);
    w.holdAll();
    onChanged();
    let reviewing = false;
    const ac = new AbortController();
    abortRef.current = ac;
    const base = w.clone();
    const say = (line: string) => setLog((l) => [...l, line]);
    const cands: Candidate[] = [];
    try {
      const T = await tables();
      const hide = hideJump ? JUMP_TEST.filter((s) => w.banks().some((b) => b.key === s.key && b.count > s.index)) : [];
      const kb = keyboardFacts ? await keyboardFacts(w, say) : null;
      kbRef.current = kb;
      for (const [n, rt] of [cmpA, cmpB].entries()) {
        if (ac.signal.aborted) break;
        const id = n === 0 ? "A" : "B";
        say(`--- ${id}: ${routeLabel(rt)} ---`);
        const maxTurns = turnsFor(rt, "build");
        const session = new SoundSession(T, w.file, { hide, keyboard: kb });
        const { r, seconds, runId } = await runModel(w, { route: rt, kind: "build", request: text, prompt: openingMessage(text, song), maxTurns, ac, session, say, candidate: id });
        if (r.status === "error") say(`Failed: ${clean(r.error)}`);
        if (r.status === "turn-limit") say(`Stopped after ${maxTurns} turns.`);
        const touched = session.touched();
        const changed = w.changedSince(base, touched);
        const rows = changedBySlot(r.messages);
        cands.push({
          id, provider: rt.provider, model: routeLabel(rt), seconds, steps: r.steps, usage: r.usage, status: r.status, slots: touched, bytes: parkSlots(w.file, touched), tracks: combiTracks(r.messages), runId,
          items: changed.map((s) => {
            const d = digest(rows.get(`${s.key}/${s.index}`) ?? []);
            return `${labelOf(w, base, s)}${d.count ? `: ${d.count} parameter(s) - ${d.groups}` : ""}`;
          }),
        });
        showCandidate(w.file, base, touched, null); // the next run starts from the library as it was
      }
      if (ac.signal.aborted) say("Cancelled.");
      const withSlots = cands.filter((c) => c.slots.length > 0);
      if (withSlots.length > 0) {
        const all = unionSlots(withSlots);
        w.holdSlots(all);
        reviewing = true;
        setDest("current");
        setCmp({ base, cands: withSlots, all, shown: null });
      } else {
        setNote("No changes were made.");
      }
    } catch (e) {
      showCandidate(w.file, base, unionSlots(cands), null);
      say(`Failed: ${clean(e)}`);
      setNote("No changes were made.");
    } finally {
      if (!reviewing) { w.release(); window.dispatchEvent(new Event("kronos-live-resync")); }
      w.refresh();
      abortRef.current = null;
      setRunning(false);
      onChanged();
    }
  }

  async function audition(id: "A" | "B") {
    const c = cmp?.cands.find((x) => x.id === id);
    if (!cmp || !c || !ws) return;
    showCandidate(ws.file, cmp.base, cmp.all, c);
    ws.refresh();
    setCmp({ ...cmp, shown: id });
    decide(c.runId, "audition", id);
    onChanged();
    const live = c.slots.find((s) => ws.info(s.key).kind === "combi") ?? c.slots[0];
    try {
      await onAudition?.(live);
    } catch (e) {
      setLog((l) => [...l, `Audition could not reach the keyboard: ${clean(e)}`]);
    }
  }

  // Keep with the chosen destination: the plan's bytes go into the library and the caller records them with the run as ONE undo step.
  function placeResult(w: Workspace, base: PcgFile, changed: Slot[]): { kind: DestKind; extra: Slot[]; done: string; note: string; asked: boolean } {
    const existing = existingChanged(changed, base, w.file);
    const none = { kind: "current" as DestKind, extra: [] as Slot[], done: "", note: "", asked: existing.length > 0 };
    if (existing.length === 0 || dest === "current" || !tablesRef.current) return none;
    const plan = planDestination(tablesRef.current, dest, changed, base, w.file, { hide: hiddenJump(w) });
    if (!plan.ok) return { ...none, note: `${plan.error}. Kept as the current sound instead.` };
    for (const x of plan.writes) setEntry(w.file, x.key, x.index, x.bytes);
    return { kind: plan.moves.length > 0 ? dest : "current", extra: plan.writes, done: destLines(dest, existing, plan, (x) => slotLabel(w, x)).done, note: "", asked: true };
  }

  function keepCandidate(id: "A" | "B") {
    const c = cmp?.cands.find((x) => x.id === id);
    if (!cmp || !c || !ws) return;
    showCandidate(ws.file, cmp.base, cmp.all, c);
    const p = placeResult(ws, cmp.base, ws.changedSince(cmp.base, c.slots));
    ws.release();
    ws.recordSince(cmp.base, [...c.slots, ...p.extra]);
    ws.refresh();
    for (const x of cmp.cands) decide(x.runId, x.id === id ? "keep" : "discard", x.id, x.id === id && p.asked ? { destination: p.kind, destinationNote: p.done || p.note } : undefined);
    setLog((l) => [...l, ...(p.note ? [p.note] : []), p.done ? `${id}: ${p.done}` : `Kept ${id} (${c.slots.length} slot(s)).`]);
    setKept(c.tracks);
    setNote(p.done ? `Kept ${id}. ${p.done} Undo reverses all of it in one step.` : `Kept ${id}. Undo reverses it in one step.`);
    setDest("current");
    if (p.kind !== "current") window.dispatchEvent(new Event("kronos-live-resync"));
    setCmp(null);
    onChanged();
  }

  function discardBoth() {
    if (!cmp || !ws) return;
    showCandidate(ws.file, cmp.base, cmp.all, null);
    ws.release();
    ws.refresh();
    window.dispatchEvent(new Event("kronos-live-resync"));
    for (const x of cmp.cands) decide(x.runId, "discard", x.id);
    setLog((l) => [...l, "Discarded both. The library is as it was before the run."]);
    setNote("Discarded.");
    setCmp(null);
    onChanged();
  }

  function approve() {
    if (!review || !ws) return;
    const n = review.slots.length;
    const p = placeResult(ws, review.snapshot, review.slots);
    ws.release();
    ws.recordSince(review.snapshot, [...review.slots, ...p.extra]);
    ws.refresh();
    decide(review.runId, "keep", null, p.asked ? { destination: p.kind, destinationNote: p.done || p.note } : undefined);
    setLog((l) => [...l, ...(p.note ? [p.note] : []), p.done || `Kept ${n} slot(s).`]);
    setKept(review.tracks);
    setGoto(null);
    setLayer(null);
    setReview(null);
    setNote(p.done ? `${p.note} ${p.done} Undo reverses all of it in one step.`.trim() : `${p.note} Kept ${n} slot(s). Undo reverses them in one step.`.trim());
    setDest("current");
    if (p.kind !== "current") window.dispatchEvent(new Event("kronos-live-resync"));
    onChanged();
  }

  function discard() {
    if (!review || !ws) return;
    review.session.undoAll();
    decide(review.runId, "discard");
    ws.release();
    ws.refresh();
    window.dispatchEvent(new Event("kronos-live-resync"));
    setLog((l) => [...l, "Discarded. The library is as it was before the run."]);
    setBuilt([]);
    setGoto(null);
    setReview(null);
    setNote("Discarded.");
    onChanged();
  }

  function cancel() {
    if (running) {
      abortRef.current?.abort();
      void window.kronos.aiCancel().catch(() => {});
    }
    else setOpen(false);
  }

  return (
    <>
      <button data-testid="ai-open" onClick={() => setOpen((o) => (running ? true : !o))} disabled={!ws || locked} aria-expanded={open} title={review || cmp ? "AI changes are waiting for Keep or Discard" : EXPLAIN_HINT}>
        {review || cmp ? "AI review" : "AI"}
      </button>
      {open && ws && (
        <section {...dragProps} className="ai-panel" role="dialog" aria-label="AI sound design" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, ...fs.style }} onKeyDown={(e) => e.key === "Escape" && !busy && setOpen(false)}>
          {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((d) => (
            <div key={d} className={`ai-grip ai-grip-${d}`} data-testid={`ai-resize-${d}`} data-dir={d} />
          ))}
          <div className="ai-head" data-testid="ai-head" title={`Drag to move, double-click to reset
${EXPLAIN_HINT}`}>
            <h2>AI sound design</h2>
            {fs.controls}
            <button data-testid="ai-close" aria-label="Close AI window" onClick={() => setOpen(false)}>Close</button>
          </div>
          <SpeechControls answer={answer} busy={busy} hooks={speechHooks} />
          <div className="ai-body" ref={panelRef} onScroll={(e) => { const t = e.currentTarget; stick.current = t.scrollHeight - t.scrollTop - t.clientHeight < 60; }}>
          <textarea
            data-testid="ai-prompt"
            aria-label="Describe the sound"
            rows={3}
            placeholder="e.g. the synth sound from Jump by Van Halen, bass on the left hand, brass stabs on the right"
            value={prompt}
            disabled={busy}
            onBlur={rememberBox("prompt")} onChange={(e) => setPrompt(e.target.value)}
          />
          <label className="check">
            <input type="checkbox" data-testid="ai-hide-jump" checked={hideJump} disabled={busy} onChange={(e) => setHideJump(e.target.checked)} />
            Exclude Jump (test)
          </label>
          <div className="buttons">
            <button data-testid="ai-go" className="primary" onClick={() => go()} disabled={busy || locked || routeBlocked || prompt.trim() === ""}>
              {running ? "Working..." : "Go"}
            </button>
            <button data-testid="ai-cancel" onClick={cancel} disabled={review !== null || cmp !== null}>
              Cancel
            </button>
          </div>
          <ProviderPick id="ai" label="Model" route={route} ready={ready} disabled={busy} onChange={setPick} />
          {routeBlocked && <p className="status" data-testid="ai-local-note">AUTOROUTER_KEY is not set, so the local router is off: pick Cloud, or set it and restart the app.</p>}
          <p className="status">Compare models: the same prompt, run twice, then audition both.</p>
          <ProviderPick id="ai-cmp-A" label="A" route={cmpA} ready={ready} disabled={busy} onChange={setCmpA} />
          <ProviderPick id="ai-cmp-B" label="B" route={cmpB} ready={ready} disabled={busy} onChange={setCmpB} />
          <div className="buttons">
            <button data-testid="ai-compare" onClick={compare} disabled={busy || locked || prompt.trim() === "" || [cmpA, cmpB].some((r) => r.provider === "local" && !ready)}>
              Compare models
            </button>
          </div>
          <div className="buttons">
            <input data-testid="refine-text" aria-label="Refine selected sound" placeholder="Describe the change, e.g. brighter, wider, more chorus, shorter attack" value={refineText} disabled={busy} onBlur={rememberBox("refine")} onChange={(e) => setRefineText(e.target.value)} />
            <button data-testid="refine-go" onClick={() => selected && go({ slot: selected, text: refineText.trim() })} disabled={refineWhy !== null} title={refineWhy ?? undefined}>
              Refine
            </button>
          </div>
          <div className="buttons">
            <input data-testid="ask-text" aria-label="Ask about the selected sound" placeholder="Ask about this sound, e.g. where is the filter cutoff?" value={askText} disabled={busy} onBlur={rememberBox("ask")} onChange={(e) => setAskText(e.target.value)} />
            <button data-testid="ask-go" onClick={() => selected && go({ slot: selected, text: askText.trim(), ask: true })} disabled={askWhy !== null} title={askWhy ?? undefined}>
              Ask
            </button>
          </div>
          <p className="status" data-testid="refine-hint">{selected ? "" : `${NO_SOUND}. `}{SUPPORTED_HINT}</p>
          {running && <p className="status" data-testid="ai-banner" role="status">AI is working: you can keep browsing, but editing and file actions wait until it finishes. Cancel stops it.</p>}
          <AiLog lines={log} />
          {notReady && (
            <div className="ai-card" data-testid="ai-not-ready">
              <p className="ai-text">{friendlyError(notReady.provider, notReady.kind)}</p>
              <button data-testid="ai-open-connection" onClick={() => window.dispatchEvent(new Event("kronos-open-ai-connection"))}>Open AI connection settings</button>
            </div>
          )}
          {busyMsg && <p className="status" data-testid="ai-busy" role="status">{busyMsg}</p>}
          {note && <AiAnswer text={note} />}
          {note && cached && !busy && (
            <div className="buttons">
              <span className="status" data-testid="ai-cached">From saved answers</span>
              <button data-testid="ai-reask" onClick={() => void goRef.current(cached.redo)} disabled={locked || routeBlocked} title="Ask the AI again and replace the saved answer">Re-ask</button>
            </div>
          )}
          {built.length > 0 && (
            <ul className="ai-built" data-testid="ai-built">
              {built.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
          {layer && !busy && (
            <div className="ai-layer" data-testid="ai-layer">
              <ol data-testid="ai-layer-steps">
                {layer.steps.map((s) => <li key={s.n}>{s.note}</li>)}
              </ol>
              {layer.parts && (
                <div className="buttons">
                  <button data-testid="ai-build-layer" className="primary" onClick={() => void go(undefined, layer)} disabled={locked} title={`Creates the Combination "${layer.name}" in the first free slot, for you to Keep or Discard`}>
                    Build it for me
                  </button>
                </div>
              )}
            </div>
          )}
          {goto && awayFrom(selected, goto.slot) && (
            <div className="buttons">
              <span className="status" data-testid="ai-goto-note">The run finished on {ws.info(goto.slot.key).label} {slot(goto.slot.index)} {ws.nameOf(goto.slot.key, goto.slot.index)}, not the sound you have open.</span>
              <button data-testid="ai-goto" onClick={() => { if (goto.point) onPoint(goto.point); else onGoTo(goto.slot); setGoto(null); }}>Go to sound</button>
            </div>
          )}
          {usage && <p className="status">{usage}</p>}
          {kept && song && picksFromTracks(kept, song).length > 0 && (
            <div className="buttons">
              <button data-testid="ai-use-tracks" onClick={() => { onAssign(picksFromTracks(kept, song)); setKept(null); }}>
                Use these sounds for the song tracks
              </button>
            </div>
          )}
          {cmp && (
            <div className="ai-review" data-testid="ai-cmp-review">
              <h3>Compare: audition both, then keep one</h3>
              <p className="status" data-testid="ai-hold-note">The sounds touched by either run are protected until you Keep or Discard. Audition shows a candidate in the library (and on the keyboard when connected) without keeping it. Save, Send, Sync, Open and Undo are off until then.</p>
              {cmp.cands.map((c) => (
                <div key={c.id} data-testid={`ai-cand-${c.id}`}>
                  <h3>
                    {c.id}: {c.model}
                    {cmp.shown === c.id ? " (showing)" : ""}
                  </h3>
                  <p className="status">
                    {secs(c.seconds)}, {c.usage ? formatUsage(c.usage, c.steps) : `${c.steps} step(s)`}, {c.status}
                  </p>
                  <ul>
                    {(c.items.length ? c.items : ["No changes"]).map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                  {destInfo?.cands?.[cmp.cands.indexOf(c)] && <KeepAs id={`ai-dest-${c.id}`} info={destInfo.cands[cmp.cands.indexOf(c)]} value={dest} onChange={setDest} />}
                  <div className="buttons">
                    <button data-testid={`ai-audition-${c.id}`} onClick={() => void audition(c.id)}>
                      Audition {c.id}
                    </button>
                    <button data-testid={`ai-keep-${c.id}`} className="primary" onClick={() => keepCandidate(c.id)}>
                      Keep {c.id}
                    </button>
                  </div>
                </div>
              ))}
              <div className="buttons end">
                <button data-testid="ai-discard-both" onClick={discardBoth}>
                  Discard both
                </button>
              </div>
            </div>
          )}
          {review && (
            <div className="ai-review">
              <h3>Review: {review.items.length} slot(s) changed</h3>
              <p className="status" data-testid="ai-hold-note">The sounds touched by the AI are protected until you Keep or Discard. Save, Send, Sync, Open and Undo are off until then. Other sounds can be edited.</p>
              {usage && <p className="status">{usage}</p>}
              <ul data-testid="ai-result">
                {review.items.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
              {review.session.fileOnlyWarning() && <p className="status" data-testid="ai-file-only" role="status">Warning: {review.session.fileOnlyWarning()}. No keyboard was connected to check them against.</p>}
              {needsFor && review.slots.filter((x) => ws.info(x.key).kind === "combi").map((x) => <div key={`${x.key}/${x.index}`}>{needsFor(x, tablesRef.current)}</div>)}
              {destInfo?.review && <KeepAs id="ai-dest" info={destInfo.review} value={dest} onChange={setDest} />}
              <div className="buttons end">
                {onCompareAb && abSlot && (
                  <button data-testid="ab-open-ai" onClick={() => onCompareAb(abSlot, new Uint8Array(getEntry(review.snapshot, abSlot.key, abSlot.index)))} disabled={!!abWhy} title={abWhy ?? "Hear the sound before and after the AI's changes, on the keyboard"}>
                    Compare A/B
                  </button>
                )}
                <button data-testid="ai-discard" onClick={discard}>
                  Discard
                </button>
                <button data-testid="ai-approve" className="primary" onClick={approve}>
                  Keep
                </button>
              </div>
            </div>
          )}
          </div>
        </section>
      )}
    </>
  );
}

// Keep-as appears only when the run changed an existing Program or Combi. Current is pre-selected: that is plain Keep.
function KeepAs({ id, info, value, onChange }: { id: string; info: { existing: Slot[]; error: string; lines: string[] }; value: DestKind; onChange: (k: DestKind) => void }) {
  if (info.existing.length === 0) return null;
  const hasProgram = info.existing.some((x) => x.key.startsWith("program:"));
  const opts: [DestKind, string][] = hasProgram ? [["current", "Current program"], ["new-program", "New program"], ["new-combi", "New program + combi"]] : [["current", "Current combi"], ["new-combi", "New combi (copy)"]];
  return (
    <fieldset className="ai-dest" data-testid={id}>
      <legend>Keep as:</legend>
      <div className="buttons">
        {opts.map(([k, text]) => (
          <label key={k} className="check">
            <input type="radio" name={id} data-testid={`${id}-${k}`} checked={value === k} onChange={() => onChange(k)} />
            {text}
          </label>
        ))}
      </div>
      <ul data-testid={`${id}-lines`}>{info.lines.map((t, i) => <li key={i}>{t}</li>)}</ul>
      {info.error && <p className="status" data-testid={`${id}-error`}>{info.error}. Keep would use the current sound instead.</p>}
    </fieldset>
  );
}

// Provider select plus a model id box (local only). The local option is off, with the reason, while AUTOROUTER_KEY is unset.
function ProviderPick({ id, label, route, ready, disabled, onChange }: { id: string; label?: string; route: Route; ready: boolean; disabled: boolean; onChange: (r: Route) => void }) {
  return (
    <div className="buttons ai-pick">
      <span className="status">{label ?? "Run"}</span>
      <select data-testid={`${id}-provider`} aria-label={`${label ?? "Run"} provider`} value={route.provider} disabled={disabled} onChange={(e) => onChange({ ...route, provider: e.target.value === "local" ? "local" : e.target.value === "claude" ? "claude" : "cloud" })}>
        <option value="cloud">Cloud (Codex)</option>
        <option value="claude">Claude</option>
        <option value="local" disabled={!ready}>
          {ready ? "Local router" : "Local router (AUTOROUTER_KEY is not set)"}
        </option>
      </select>
      <input data-testid={`${id}-model`} aria-label={`${label ?? "Run"} local model id`} value={route.model} disabled={disabled || route.provider !== "local"} onChange={(e) => onChange({ ...route, model: e.target.value })} />
    </div>
  );
}
