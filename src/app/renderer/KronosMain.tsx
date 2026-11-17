// Program Play, Main: a one-screen dashboard of OSC, Filter, Amp, LFO, EQ and KARMA panels. Every control is wired to a real row; a part with no rows is left out.
import type { ReactNode } from "react";
import { readParam, type Row } from "../../core/params/params.ts";
import type { Write } from "../../core/params/graphs.ts";
import { FILTER_TYPES, geText, panText } from "../../core/pages/mixer.ts";
import { msLabel, type Zone } from "../../core/pcg/multisamples.ts";
import { Badge, Panel, type CtlProps } from "./KronosControls.tsx";
import { MDial as Dial, MFader as Fader } from "./KronosMemo.tsx";
import { EnvelopeGraph } from "./EnvelopeGraph.tsx";
import { FilterGraph } from "./FilterGraph.tsx";
import { LfoGraph } from "./LfoGraph.tsx";
import { KronosEq } from "./KronosEq.tsx";
import type { Graphs } from "./KronosView.tsx";
import type { Fmt } from "./KronosMixer.tsx";
import { InfoIcon } from "./InfoIcon.tsx";

type Props = {
  rowOf: (group: string, name: string) => Row | undefined;
  cur: Uint8Array;
  base: Uint8Array;
  fmtOf: Fmt;
  commit: (r: Row, text: string) => void;
  onWrite: (w: Write[]) => void;
  graphs: Graphs;
  zones: Zone[];
  geNames?: readonly string[];
  // Jumps to the page whose title starts with this text.
  go: (title: string) => void;
};

const Mini = ({ children, wide }: { children: ReactNode; wide?: boolean }) => <div className={`kv-mini${wide ? " kv-mini-wide" : ""}`}>{children}</div>;

export function KronosMain({ rowOf, cur, base, fmtOf, commit, onWrite, graphs, zones, geNames, go }: Props) {
  const ctl = (r: Row, over?: Partial<CtlProps>): CtlProps => ({
    r, value: readParam(cur, r), base: readParam(base, r), changed: readParam(cur, r) !== readParam(base, r), fmt: fmtOf(r), onCommit: (t) => commit(r, t), ...over,
  });
  const text = (r: Row | undefined): string => (r ? fmtOf(r)(readParam(cur, r)) : "");
  const eqRow = (n: string) => rowOf("Track EQ", n);
  const [eqLow, eqMid, eqHigh, eqFreq] = ["Low Gain", "Mid Gain", "High Gain", "Mid Frequency"].map(eqRow);
  const assign = rowOf("Common", "Assign Mode");
  const ge = rowOf("KARMA Module", "GE Number");
  const db = (r: Row) => readParam(cur, r) / 2;
  const pitchEg = graphs.envs.find((e) => e.group === "Pitch EG");
  const commonLfo = graphs.lfos.find((l) => l.group === "Common LFO");

  const osc = (n: 1 | 2) => {
    const lo = rowOf(`OSC${n} Trigger`, "Key Zone Bottom"), hi = rowOf(`OSC${n} Trigger`, "Key Zone Top");
    const live = zones.filter((z) => z.osc === n && z.type === 1);
    const lfo = (k: 1 | 2) => graphs.lfos.find((l) => l.group === `OSC${n} LFO${k}`);
    return (
      <Panel key={`osc${n}`} title={`OSC${n}`} className={`kdb-osc kdb-osc${n}`}>
        <div className="kdb-ms" data-testid={`kdb-ms-${n}`}>
          <span className="kdb-ms-title">{live.length ? msLabel(live[0].ref) : "No multisample"}</span>
          <span className="kdb-ms-note">{live.length > 1 ? `+${live.length - 1} more zones` : "Multisample (no picture data)"}</span>
        </div>
        {lo && hi && (
          <div className="kdb-zone" role="img" aria-label={`Key zone ${text(lo)} to ${text(hi)}`} data-testid={`kdb-zone-${n}`}>
            <i style={{ left: `${(readParam(cur, lo) / 127) * 100}%`, width: `${((readParam(cur, hi) - readParam(cur, lo)) / 127) * 100}%` }} />
            <span>{text(lo)}</span><span>{text(hi)}</span>
          </div>
        )}
        <div className="kdb-pair">
          {([1, 2] as const).map((k) => { const l = lfo(k); return l && <Mini key={k}><LfoGraph kv lfo={l} entry={cur} /></Mini>; })}
        </div>
      </Panel>
    );
  };

  const filter = (n: 1 | 2) => {
    const f = graphs.filters.find((x) => x.group === `OSC${n} Filter A`);
    const b = rowOf(`OSC${n} Filter B`, "Filter Type");
    const routing = rowOf(`OSC${n} Filter`, "Routing");
    const eg = graphs.envs.find((e) => e.group === `OSC${n} Filter EG`);
    if (!f && !eg) return null;
    return (
      <Panel key={`f${n}`} title={`Filter${n}`} className="kdb-filter" badge={f && (
        <span className="kdb-types">
          <Badge tone="blue">{FILTER_TYPES[readParam(cur, f.type)] ?? "?"}</Badge>
          {b && routing && readParam(cur, routing) !== 0 && <Badge tone="blue">{FILTER_TYPES[readParam(cur, b)] ?? "?"}</Badge>}
        </span>
      )}>
        {f && <Mini wide><FilterGraph kv f={f} entry={cur} onWrite={onWrite} /></Mini>}
        {eg && <Mini><EnvelopeGraph kv env={eg} entry={cur} onWrite={onWrite} /></Mini>}
      </Panel>
    );
  };

  const amp = (n: 1 | 2) => {
    const drive = rowOf(`OSC${n} Drive`, "Drive"), boost = rowOf(`OSC${n} Drive`, "Boost");
    const pan = rowOf(`OSC${n} Output`, "Panpot"), level = rowOf(`OSC${n} Amplifier`, "Level");
    const eg = graphs.envs.find((e) => e.group === `OSC${n} Amplifier EG`);
    return (
      <Panel key={`a${n}`} title={`Amp${n}`} className="kdb-amp">
        <div className="kdb-knobs">
          <div className="kdb-dials">
            {drive && <Dial {...ctl(drive)} label="DRIVE" help={<InfoIcon r={drive} label="Drive" />} />}
            {boost && <Dial {...ctl(boost)} label="BOOST" help={<InfoIcon r={boost} label="Boost" />} />}
            {pan && <Dial {...ctl(pan, { fmt: panText, centre: 0.5 })} label="PAN" help={<InfoIcon r={pan} label="Pan" />} />}
          </div>
          {level && <Fader {...ctl(level)} label="LEVEL" height={78} help={<InfoIcon r={level} label="Level" />} />}
        </div>
        {eg && <Mini><EnvelopeGraph kv env={eg} entry={cur} onWrite={onWrite} /></Mini>}
      </Panel>
    );
  };

  return (
    <div className="kdb" data-testid="kronos-main">
      <div className="kdb-r1">{osc(1)}{filter(1)}{amp(1)}</div>
      <div className="kdb-r2">{osc(2)}{filter(2)}{amp(2)}</div>
      <div className="kdb-side">
        <Panel title="Pitch EG / LFO" badge={assign && <Badge tone="green">{text(assign)}</Badge>}>
          {pitchEg && <Mini><span className="kdb-cap">Pitch EG</span><EnvelopeGraph kv env={pitchEg} entry={cur} onWrite={onWrite} /></Mini>}
          {commonLfo && <Mini><span className="kdb-cap">Common LFO</span><LfoGraph kv lfo={commonLfo} entry={cur} /></Mini>}
        </Panel>
        {eqLow && eqMid && eqHigh && eqFreq && (
          <Panel title="3 Band EQ">
            {/* shortcut: Mid Frequency is read as 100 Hz to 10 kHz on a log scale, as its value text says; upgrade if KORG publishes the table */}
            <KronosEq low={db(eqLow)} mid={db(eqMid)} high={db(eqHigh)} midHz={100 * 10 ** ((2 * readParam(cur, eqFreq)) / (eqFreq.rawMax || 1))} />
          </Panel>
        )}
        <div className="kdb-fx">
          <button type="button" className="kdb-btn" data-testid="kdb-go-ifx" onClick={() => go("Insert Effect")}>IFX</button>
          <button type="button" className="kdb-btn" data-testid="kdb-go-mfx" onClick={() => go("Master/Total Effect")}>MFX/TFX</button>
        </div>
        {ge && (
          <Panel title="KARMA">
            <div className="kdb-ge" data-testid="kdb-ge">{geText(readParam(cur, ge), geNames)}</div>
          </Panel>
        )}
      </div>
    </div>
  );
}
