import { useId, useState, type ReactNode } from "react";
import "./Collapse.css";

// shortcut: open/closed is not remembered between launches, store it when people ask.
// A right-panel section with a header button. The body stays mounted when closed, so players and fields keep their state.
export function Collapse({ title, label, count, className, children }: { title: string; label?: string; count?: ReactNode; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <section className={className ? `sec ${className}` : "sec"} aria-label={label}>
      <h2 className="sec-head">
        <button type="button" className="sec-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          <span className="sec-chev" aria-hidden="true" />
          <span className="sec-title">{title}</span>
          {count}
        </button>
      </h2>
      <div id={id} className="sec-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
