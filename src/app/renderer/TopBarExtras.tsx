import "./chrome.css";

// Own mark, drawn here: a K made of three strokes inside a square. No KORG artwork.
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1" y="1" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path className="mark-k" d="M7 5v10M7 10l6-5M7 10l6 5" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark />
      <span className="wm-t"><span className="wm-b">Open</span><span className="wm-a">Kronos</span></span>
    </span>
  );
}

// The LED is lit green while a keyboard link is open; the full status text sits in the title and in the Keyboard section.
export function StatusPill({ connected, status }: { connected: boolean; status: string }) {
  return (
    <span className="pill" data-on={connected ? "true" : "false"} title={status}>
      <i className="led" aria-hidden="true" />
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

// A 2 px strip on the bottom edge of the top bar. The labelled progress with Cancel is in the right panel.
export function TransferBar({ busy }: { busy: { done: number; total: number } | null }) {
  const pct = busy ? Math.min(100, Math.round((busy.done / Math.max(busy.total, 1)) * 100)) : 0;
  return (
    <div className="xfer" aria-hidden="true" data-active={busy ? "true" : "false"}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
