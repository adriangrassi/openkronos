// The dock's MIDI monitor: a live table of sent and received messages, paused, cleared, filtered and copied from here.
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { filterEntries, formatEntries, formatTime, type MonitorEntry } from "../../core/midi/monitor.ts";
import { clearMonitor, midiVersion, monitorEntries, setSensingShown, subscribeMonitor } from "./midi-tap.ts";

export function MonitorDock() {
  // Redraws at most every 250 ms while traffic arrives (see midi-tap.ts).
  useSyncExternalStore(subscribeMonitor, midiVersion);
  const [paused, setPaused] = useState(false);
  // While paused the table keeps the rows it had at the pause; messages still go into the ring.
  const [frozen, setFrozen] = useState<MonitorEntry[] | null>(null);
  const [filter, setFilter] = useState("");
  const [showActiveSensing, setShowActiveSensing] = useState(false);
  const [copyNote, setCopyNote] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  const rows = filterEntries(frozen ?? monitorEntries(), filter, showActiveSensing);

  // Newest row on top: stay at the top, but only when the row count moves: a forced scroll every frame costs a layout.
  useEffect(() => {
    if (!paused && scroller.current) scroller.current.scrollTop = 0;
  }, [rows.length, paused]);

  function togglePause(): void {
    if (paused) {
      setFrozen(null);
      setPaused(false);
    } else {
      setFrozen(monitorEntries());
      setPaused(true);
    }
  }

  function clear(): void {
    clearMonitor();
    setFrozen(paused ? [] : null);
    setCopyNote("");
  }

  function copy(): void {
    window.kronos.copyText(formatEntries(rows)).then(
      () => setCopyNote(`Copied ${rows.length} ${rows.length === 1 ? "line" : "lines"}`),
      () => setCopyNote("Copy failed"),
    );
  }

  return (
    <div className="mon">
      <div className="mon-bar">
        <button type="button" data-testid="dock-mon-pause" aria-pressed={paused} onClick={togglePause}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" data-testid="dock-mon-clear" onClick={clear}>
          Clear
        </button>
        <button type="button" data-testid="dock-mon-copy" onClick={copy}>
          Copy
        </button>
        <input
          type="text"
          data-testid="dock-mon-filter"
          aria-label="filter messages"
          placeholder="Filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label>
          <input type="checkbox" data-testid="dock-mon-active-sensing" checked={showActiveSensing} onChange={(e) => {
              setShowActiveSensing(e.target.checked);
              setSensingShown(e.target.checked);
            }} />
          show Active Sensing
        </label>
        <span className="mon-count">
          <span data-testid="dock-mon-count">{rows.length}</span> shown
        </span>
        <span role="status" className="mon-copy-note">
          {copyNote}
        </span>
      </div>
      <div className="mon-scroll" ref={scroller}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Dir</th>
              <th>Ch</th>
              <th>Type</th>
              <th>Values</th>
            </tr>
          </thead>
          <tbody>
            {/* index i stays 0 = oldest (the testids and gate rely on it); only the display order is reversed */}
            {rows.map((e, i) => <MonRow key={`${e.time}-${e.seq}`} e={e} i={i} />).reverse()}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Memoised. shortcut: the row index is the testid, so a full ring still re-renders every row per redraw; the 250 ms throttle bounds that, upgrade by moving the index out of the row.
const MonRow = memo(function MonRow({ e, i }: { e: MonitorEntry; i: number }) {
  return (
    <tr data-testid={`dock-mon-row-${i}`}>
      <td data-testid={`dock-mon-time-${i}`}>{formatTime(e.time)}</td>
      <td data-testid={`dock-mon-dir-${i}`}>{e.dir === "in" ? "IN" : "OUT"}</td>
      <td data-testid={`dock-mon-ch-${i}`}>{e.channel === null ? "-" : String(e.channel)}</td>
      <td data-testid={`dock-mon-type-${i}`}>{e.type}</td>
      <td data-testid={`dock-mon-val-${i}`}>{e.values}</td>
    </tr>
  );
});

