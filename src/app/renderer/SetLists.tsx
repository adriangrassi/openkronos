// Set List editor and player: the Kronos pad grid (16 pads x 8 pages). Edits go through Workspace.apply so they are undo steps; only Play sends MIDI (a slot select).
import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { getName, listBanks } from "../../core/pcg/library.ts";
import { modeChangeBytes } from "../../core/midi/modes.ts";
import { setListSelectBytes } from "../../core/midi/setlist.ts";
import { assignSound, copySlot, editSlot, padOf, PADS_PER_PAGE, PAGES, readSlot, slotAt, stepSlot, swapSlots, type SetSlot } from "../../core/pcg/setlist.ts";
import type { Workspace } from "./document.ts";
import type { Link } from "./keyboard.ts";
import "./SetLists.css";

// shortcut: the 16 colours are shown as hue steps, not KORG's real palette; upgrade when the palette is known.
const swatch = (c: number): string => `hsl(${c * 22} ${c === 0 ? 0 : 55}% 50%)`;

type Num = "volume" | "transpose" | "color";

const soundLabel = (s: SetSlot): string => (s.key === null ? "" : `${s.kind === "program" ? "PRG" : "CMB"} ${s.key.split(":")[1].replace("INT-", "I-")} ${String(s.number).padStart(3, "0")}`);

export function SetLists({ host, ws, locked, onChanged, link, globalChannel }: { host: HTMLElement | null; ws: Workspace | null; locked: boolean; onChanged: () => void; link: Link | null; globalChannel: number }) {
  const [open, setOpen] = useState(false);
  const [set, setSet] = useState(0);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState(0);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"edit" | "play">("edit");
  const [current, setCurrent] = useState<number | null>(null);
  const [switchMode, setSwitchMode] = useState(true);
  const [clip, setClip] = useState<number | null>(null);
  // 0 = fit the window; otherwise the pad height in px, kept between sessions.
  const [padH, setPadH] = useState(() => { try { const n = Number(localStorage.getItem("kronos.setlists.padh")); return n >= 40 && n <= 300 ? n : 0; } catch { return 0; } });
  const resizePads = (n: number) => { setPadH(n); try { localStorage.setItem("kronos.setlists.padh", String(n)); } catch { /* storage is optional */ } };
  const [large, setLarge] = useState(() => { try { return localStorage.getItem("kronos.setlists.large") === "1"; } catch { return false; } });
  const setSize = (v: boolean) => { setLarge(v); try { localStorage.setItem("kronos.setlists.large", v ? "1" : "0"); } catch { /* storage unavailable: the choice lasts for this session */ } };

  const lists = ws ? listBanks(ws.file).find((b) => b.kind === "setlist") : undefined;
  if (!ws || !lists) return null;
  const f = ws.file;
  const run = async (fn: () => void) => {
    setError("");
    try { await ws.apply([{ key: lists.key, index: set }], fn); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const clear = (id: string) => setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
  const cur = readSlot(f, set, sel);
  const play = view === "play";
  const select = (slot: number, setIndex = set) => {
    if (!link) return;
    for (const m of setListSelectBytes(setIndex, slot, globalChannel)) link.send(m);
    setCurrent(slot); setSel(slot); setPage(padOf(slot).page); setDrafts({}); setError("");
  };
  const step = (dir: 1 | -1) => select(stepSlot(current ?? sel, dir));
  const startPlay = () => {
    setView("play");
    if (switchMode && link) link.send(modeChangeBytes(9, link.channel));
  };
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (play && e.key === "Escape" && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA" && t.tagName !== "SELECT") { setView("edit"); return; }
    if (!play || !link || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
    const dir = e.key === "ArrowRight" || e.key === "PageDown" ? 1 : e.key === "ArrowLeft" || e.key === "PageUp" ? -1 : 0;
    if (dir !== 0) { e.preventDefault(); step(dir); }
  };
  const commit = (id: Num) => {
    const raw = drafts[id];
    if (raw === undefined) return;
    const v = raw.trim() === "" ? NaN : Number(raw);
    clear(id);
    void run(() => editSlot(f, set, sel, { [id]: v }));
  };
  const rows = picking
    ? listBanks(f).filter((b) => b.kind === "program" || b.kind === "combi").flatMap((b) => Array.from({ length: b.count }, (_, i) => ({ key: b.key, i, name: getName(f, b.key, i) })))
        .filter((r) => r.name.toLowerCase().includes(q.toLowerCase())).slice(0, 200)
    : [];
  const noLink = link ? "" : "Connect the Kronos first";

  return (
    <>
      <button data-testid="setlists-open" aria-pressed={open} onClick={() => setOpen((v) => !v)}>Set Lists</button>
      {(open || host !== null) && createPortal(
        <section className="setlists" data-testid="setlists-panel" data-inline={String(host !== null)} aria-label="Set List editor" data-view={view} data-large={String(large)} data-sized={String(padH > 0)} style={padH > 0 ? ({ "--pad-h": `${padH}px` } as CSSProperties) : undefined} tabIndex={-1} onKeyDown={onKey}>
          <div className="sl-head">
            <select data-testid="setlists-set" aria-label="Set List number" value={String(set)} onChange={(e) => { const n = Number(e.target.value); setSet(n); setError(""); if (play && current !== null) select(current, n); }}>
              {Array.from({ length: lists.count }, (_, i) => <option key={i} value={String(i)}>{`Set List ${i}`}</option>)}
            </select>
            <span className="sl-view" role="group" aria-label="View">
              <button data-testid="setlists-view-edit" data-active={String(!play)} onClick={() => setView("edit")}>Edit</button>
              <button data-testid="setlists-view-play" data-active={String(play)} onClick={startPlay}>Play</button>
            </span>
            <span className="sl-pages">
              {Array.from({ length: PAGES }, (_, p) => <button key={p} data-explain={`Set List page ${p + 1}`} data-testid={`setlists-page-${p}`} data-active={String(p === page)} onClick={() => setPage(p)}>{p + 1}</button>)}
            </span>
            {host !== null && !play && (
              <span className="sl-size">
                <label>Pad size <input type="range" data-testid="setlists-size-range" min={40} max={300} step={10} value={padH || 120} onChange={(e) => resizePads(Number(e.target.value))} /></label>
                <button data-testid="setlists-size-fit" data-active={String(padH === 0)} onClick={() => resizePads(0)}>Fit window</button>
              </span>
            )}
            {play && (
              <>
                <button data-testid="setlists-prev" disabled={!link} title={noLink} onClick={() => step(-1)}>Previous</button>
                <button data-testid="setlists-next" disabled={!link} title={noLink} onClick={() => step(1)}>Next</button>
                <span className="sl-view" role="group" aria-label="Text size">
                  <button data-testid="setlists-text-normal" data-active={String(!large)} onClick={() => setSize(false)}>Normal</button>
                  <button data-testid="setlists-text-large" data-active={String(large)} onClick={() => setSize(true)}>Large</button>
                </span>
                <label><input type="checkbox" data-testid="setlists-switch-mode" checked={switchMode} onChange={(e) => setSwitchMode(e.target.checked)} />Switch the Kronos to Set List mode first</label>
                <button data-testid="setlists-exit" onClick={() => setView("edit")}>Exit</button>
              </>
            )}
          </div>
          <div className="sl-grid" data-view={view}>
            {Array.from({ length: PADS_PER_PAGE }, (_, p) => {
              const s = readSlot(f, set, slotAt(page, p));
              return (
                <button key={p} className="sl-pad" data-explain={`Set List pad ${p + 1}`} data-testid={`setlists-pad-${p}`} data-slot={s.slot} data-color={s.color} data-selected={String(s.slot === sel)} data-current={String(s.slot === current)}
                  style={{ borderLeftColor: swatch(s.color), "--sw": swatch(s.color) } as CSSProperties} draggable={!locked && !play} disabled={play && !link} title={play ? noLink : ""}
                  onClick={() => { if (play) { select(s.slot); return; } setSel(s.slot); setDrafts({}); setError(""); }}
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(s.slot)); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = Number(e.dataTransfer.getData("text/plain"));
                    if (!locked && !play && Number.isInteger(from) && from !== s.slot) void run(() => swapSlots(f, set, from, s.slot));
                  }}>
                  <span className="sl-num">{s.slot}</span>{play && s.slot === current && <span className="sl-now">NOW</span>}<b>{s.name}</b>{soundLabel(s) !== "" && <small>{soundLabel(s)}</small>}{s.comment !== "" && <small className="sl-pc">{s.comment}</small>}
                </button>
              );
            })}
          </div>
          {play ? (
            <div className="sl-play-foot">
              <span className="sl-hint" data-testid="setlists-current">{current === null ? "Nothing selected yet." : `Selected: slot ${current}.`} The Kronos does not report its current slot.</span>
              <div className="sl-play-comment" data-testid="setlists-play-comment">{cur.comment}</div>
            </div>
          ) : (
            <>
              <div className="sl-fields">
                <span>Slot {sel} (page {padOf(sel).page + 1}, pad {padOf(sel).pad + 1}){soundLabel(cur) !== "" && `: ${soundLabel(cur)}`}</span>
                <label>Slot name
                  <input type="text" className="sl-name" data-testid="setlists-name" maxLength={24} value={drafts.name ?? cur.name} disabled={locked}
                    onChange={(e) => setDrafts((d) => ({ ...d, name: e.target.value }))}
                    onBlur={() => { const n = drafts.name; if (n === undefined) return; clear("name"); if (n !== cur.name) void run(() => editSlot(f, set, sel, { name: n })); }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                </label>
                {(["volume", "transpose", "color"] as const).map((id) => (
                  <label key={id}>{id[0].toUpperCase() + id.slice(1)}
                    <input type="text" data-testid={`setlists-${id}`} value={drafts[id] ?? String(cur[id])} disabled={locked}
                      onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))} onBlur={() => commit(id)}
                      onKeyDown={(e) => { if (e.key === "Enter") commit(id); }} />
                  </label>
                ))}
                <button data-testid="setlists-pick" disabled={locked} onClick={() => { setPicking((v) => !v); setQ(""); }}>Pick sound</button>
                <button data-testid="setlists-copy" onClick={() => setClip(sel)}>Copy</button>
                <button data-testid="setlists-paste" disabled={locked || clip === null || clip === sel} onClick={() => { if (clip !== null) void run(() => copySlot(f, set, clip, sel)); }}>Paste</button>
              </div>
              <textarea className="sl-comment" data-testid="setlists-comment" aria-label="Comment" disabled={locked}
                value={drafts.comment ?? cur.comment} onChange={(e) => setDrafts((d) => ({ ...d, comment: e.target.value }))}
                onBlur={() => { const c = drafts.comment; if (c === undefined) return; clear("comment"); if (c !== cur.comment) void run(() => editSlot(f, set, sel, { comment: c })); }} />
            </>
          )}
          {error !== "" && <div className="sl-error" data-testid="setlists-error" role="alert">{error}</div>}
          {picking && !play && (
            <div className="sl-picker">
              <input data-testid="setlists-pick-q" placeholder="Filter by name" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
              <div className="sl-rows">
                {rows.map((r, n) => (
                  <button key={`${r.key}/${r.i}`} data-testid={`setlists-pick-row-${n}`} onClick={() => { setPicking(false); void run(() => assignSound(f, set, sel, r.key, r.i)); }}>{r.name} <small>{r.key} {r.i}</small></button>
                ))}
              </div>
            </div>
          )}
        </section>, host ?? document.body
      )}
    </>
  );
}
