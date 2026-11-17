// Combination Play, Prog Select/Mixer: 16 timbre columns in aligned rows, then the program names. Data and callbacks only; look is in KronosView.css (.kx-*).
import { useEffect, useState } from "react";
import { readParam, type Row } from "../../core/params/params.ts";
import { keyOf } from "../../core/pages/view.ts";
import { bankLabel, panText, programText, statusText, type MixerCell } from "../../core/pages/mixer.ts";
import { MDial as Dial, MFader as Fader } from "./KronosMemo.tsx";
import { InfoIcon } from "./InfoIcon.tsx";

export type Fmt = (r: Row) => (v: number) => string;

type Props = {
  cells: MixerCell[];
  cur: Uint8Array;
  base: Uint8Array;
  fmtOf: Fmt;
  commit: (r: Row, text: string) => void;
  pointed: (r: Row) => boolean;
  // A program's name, or null when the bank is not in the file.
  programName: (bank: number, program: number) => string | null;
  selected: number;
  onSelect: (timbre: number) => void;
};

const wrap = (r: Row, cls: string, cur: Uint8Array, base: Uint8Array, pointed: boolean) => ({
  className: `kx-cell ${cls}${pointed ? " pointed" : ""}`,
  "data-testid": `param-${keyOf(r)}`,
  "data-changed": readParam(cur, r) !== readParam(base, r) ? "true" : "false",
  "data-pointed": pointed ? "true" : undefined,
});

// The program number reads 000..127 until it is edited.
function ProgramBox({ r, value, onCommit }: { r: Row; value: number; onCommit: (t: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  return (
    <input
      data-testid={`input-${keyOf(r)}`}
      className="kx-prog"
      inputMode="numeric"
      aria-label="Program number"
      value={draft ?? String(value).padStart(3, "0")}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") onCommit(draft ?? String(value)); }}
      onBlur={() => { if (draft !== null) onCommit(draft); setDraft(null); }}
    />
  );
}

export function KronosMixer({ cells, cur, base, fmtOf, commit, pointed, programName, selected, onSelect }: Props) {
  const rd = (r: Row) => readParam(cur, r);
  const ch = (r: Row) => readParam(cur, r) !== readParam(base, r);
  const row = (cls: string, f: (c: MixerCell) => React.ReactNode) => (
    <div className={`kx-row ${cls}`}>{cells.map((c) => <div key={c.timbre} className="kx-slot" data-selected={String(c.timbre === selected)}>{f(c)}</div>)}</div>
  );
  return (
    <div className="kx" data-testid="kronos-mixer">
      {row("kx-nums", (c) => <button type="button" className="kb-badge kb-blue kx-num" aria-pressed={c.timbre === selected} aria-label={`Select part ${c.timbre}`} data-testid={`kx-select-${c.timbre}`} onClick={() => onSelect(c.timbre)}>{c.timbre}</button>)}
      <div className="kx-cap">Bank and Program Select<InfoIcon r={cells[0].program} label="Program" /></div>
      {row("kx-bank", (c) => (
        <>
          <div {...wrap(c.bank, "kx-bankcell", cur, base, pointed(c.bank))}>
            <select data-testid={`input-${keyOf(c.bank)}`} className="kx-select" aria-label="Bank" value={rd(c.bank)} onChange={(e) => commit(c.bank, e.target.value)}>
              {Array.from({ length: c.bank.rawMax - c.bank.rawMin + 1 }, (_, i) => c.bank.rawMin + i).map((n) => <option key={n} value={n}>{bankLabel(n)}</option>)}
            </select>
            <span className="kc-sr" data-testid={`value-${keyOf(c.bank)}`}>{bankLabel(rd(c.bank))}</span>
          </div>
          <div {...wrap(c.program, "kx-progcell", cur, base, pointed(c.program))}>
            <ProgramBox r={c.program} value={rd(c.program)} onCommit={(t) => commit(c.program, t)} />
            <span className="kc-sr" data-testid={`value-${keyOf(c.program)}`}>{fmtOf(c.program)(rd(c.program))}</span>
          </div>
        </>
      ))}
      <div className="kx-cap">Status<InfoIcon r={cells[0].status} label="Status" /></div>
      {row("kx-status", (c) => {
        const fmt = fmtOf(c.status);
        return (
          <div {...wrap(c.status, "kx-statuscell", cur, base, pointed(c.status))}>
            <select data-testid={`input-${keyOf(c.status)}`} className="kx-select" aria-label="Status" value={rd(c.status)} onChange={(e) => commit(c.status, e.target.value)}>
              {Array.from({ length: c.status.rawMax - c.status.rawMin + 1 }, (_, i) => c.status.rawMin + i).map((n) => <option key={n} value={n}>{statusText(n, fmt(n))}</option>)}
            </select>
            <span className="kc-sr" data-testid={`value-${keyOf(c.status)}`}>{statusText(rd(c.status), fmt(rd(c.status)))}</span>
          </div>
        );
      })}
      {row("kx-buttons", (c) => {
        const muted = rd(c.mute) === c.mute.rawMax;
        return (
          <div {...wrap(c.mute, "kx-btns", cur, base, pointed(c.mute))}>
            <button type="button" className="kx-btn kx-play" data-on={String(!muted)} data-testid={`kx-play-${c.timbre}`} onClick={() => muted && commit(c.mute, String(c.mute.rawMin))}>Play</button>
            <button type="button" role="switch" aria-checked={muted} className="kx-btn kx-mute" data-on={String(muted)} data-testid={`input-${keyOf(c.mute)}`} onClick={() => commit(c.mute, String(muted ? c.mute.rawMin : c.mute.rawMax))}>Mute</button>
            <button type="button" className="kx-btn kx-solo" disabled title="The Combination data has no Solo setting; Solo is a keyboard-side switch.">Solo</button>
            <span className="kc-sr" data-testid={`value-${keyOf(c.mute)}`}>{fmtOf(c.mute)(rd(c.mute))}</span>
          </div>
        );
      })}
      <div className="kx-cap">Pan and Volume<InfoIcon r={cells[0].pan} label="Pan" /><InfoIcon r={cells[0].volume} label="Volume" /></div>
      {row("kx-pan", (c) => <Dial r={c.pan} value={rd(c.pan)} base={readParam(base, c.pan)} changed={ch(c.pan)} pointed={pointed(c.pan)} fmt={panText} label="" centre={0.5} onCommit={(t) => commit(c.pan, t)} />)}
      {row("kx-vol", (c) => <Fader hideName r={c.volume} value={rd(c.volume)} base={readParam(base, c.volume)} changed={ch(c.volume)} pointed={pointed(c.volume)} fmt={fmtOf(c.volume)} height={96} onCommit={(t) => commit(c.volume, t)} />)}
      <div className="kx-names">
        {cells.map((c) => {
          const bank = rd(c.bank), prog = rd(c.program);
          const name = programName(bank, prog);
          return (
            <button key={c.timbre} type="button" className="kx-name" data-testid={`kx-name-${c.timbre}`} data-off={String(rd(c.status) === 0)} data-selected={String(c.timbre === selected)} style={{ gridColumn: `${Math.floor((c.timbre - 1) / 4) * 4 + 1} / span 4`, gridRow: ((c.timbre - 1) % 4) + 1 + (Math.floor((c.timbre - 1) / 4) % 2) * 4 }} onClick={() => onSelect(c.timbre)}>
              <span className="kb-badge kb-blue">{c.timbre}</span>
              <span className="kx-name-text">{programText(bank, prog)}{name ? ` ${name}` : ""}</span>
              <span className="kx-arrow" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
