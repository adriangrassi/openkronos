import { Mark } from "./TopBarExtras.tsx";
import { SupportLinks } from "./SupportLinks.tsx";
import "./Welcome.css";

const WHITE = 21;
// Black keys sit after white keys C D F G A of each octave.
const BLACK = Array.from({ length: WHITE }, (_, i) => i).filter((i) => [0, 1, 3, 4, 5].includes(i % 7));

export function Welcome({ onOpen, onConnect, locked }: { onOpen: () => void; onConnect: () => void; locked: boolean }) {
  return (
    <div className="welcome" data-testid="welcome">
      <div className="welcome-card">
        <Mark size={40} />
        <h1>OpenKronos</h1>
        <p>Open a .PCG file to begin. Browse and edit programs, combis and drum kits, keep a library, or connect a Kronos over USB to pull, send and back up.</p>
        <div className="welcome-actions">
          <button className="primary" data-testid="welcome-open" onClick={onOpen} disabled={locked}>Open a .PCG file</button>
          <button data-testid="welcome-connect" onClick={onConnect} disabled={locked}>Connect a Kronos</button>
        </div>
        <SupportLinks variant="hero" />
        <div className="welcome-keys" aria-hidden="true">
          {Array.from({ length: WHITE }, (_, i) => <span key={i} className="wk" />)}
          {BLACK.map((i) => <span key={i} className="bk" style={{ left: `${((i + 1) / WHITE) * 100}%` }} />)}
        </div>
      </div>
    </div>
  );
}
