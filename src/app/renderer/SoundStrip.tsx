import type { CSSProperties } from "react";
import "./SoundStrip.css";

export interface StripProps {
  bank: string;
  no: string;
  name: string;
  file: string;
  os: string | null; // the connected keyboard's OS version, null when not connected
  connected: boolean;
  unsaved: number;
  differs: boolean | null; // the last Check keyboard result for this sound, null before one has run
}

type Lit = "green" | "amber" | "red";

function Lamp({ lit }: { lit?: Lit }) {
  return <span className="lamp" data-lit={lit} aria-hidden="true" />;
}

// The open sound's display: slot and name in the display face, the file and OS above them, and the state lights beside it.
// The Live light follows the Live checkbox in the editor toolbar through CSS (SoundStrip.css), so it can never disagree with it.
export function SoundStrip({ bank, no, name, file, os, connected, unsaved, differs }: StripProps) {
  return (
    <div className="sd" data-testid="sound-strip">
      <div className="sd-oled" role="group" aria-label="Open sound">
        <div className="sd-top">
          <span>File {file}</span>
          {os && <span data-testid="strip-os">Kronos OS {os}</span>}
        </div>
        <div className="sd-main">
          <div className="sd-slot">
            <span className="sd-bank" data-testid="strip-slot">{bank}</span>
            <span className="sd-no">{no}</span>
          </div>
          <div className="sd-name" data-testid="strip-name" style={{ "--n": Math.max(1, name.length) } as CSSProperties}>{name}</div>
        </div>
      </div>
      <ul className="sd-leds" aria-label="State">
        <li data-testid="strip-connected" data-on={String(connected)}>
          <Lamp lit={connected ? "green" : undefined} />
          {connected ? "Connected" : "Not connected"}
        </li>
        <li data-testid="strip-unsaved" data-on={String(unsaved > 0)}>
          <Lamp lit={unsaved > 0 ? "amber" : undefined} />
          {unsaved === 0 ? "No unsaved changes" : unsaved === 1 ? "1 unsaved change" : `${unsaved} unsaved changes`}
        </li>
        {differs !== null && (
          <li data-testid="strip-differs" data-on={String(differs)} title="Result of the last Check keyboard">
            <Lamp lit={differs ? "red" : "green"} />
            {differs ? "Differs from keyboard" : "Matches keyboard"}
          </li>
        )}
        <li className="sd-live" data-testid="strip-live">
          <Lamp />
          <span className="sd-live-on">Live on</span>
          <span className="sd-live-off">Live off</span>
        </li>
      </ul>
    </div>
  );
}
