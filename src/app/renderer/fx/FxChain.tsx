// Generic chain column: draws the links over the rows below it. The row pitch is measured, so it lines up whatever the row height.
import { useLayoutEffect, useRef, useState } from "react";
import { chainPaths, type ChainLink } from "../../../core/fx/chain.ts";
import "./fx-chain.css";

export function FxChain({ links, rows }: { links: ChainLink[]; rows: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<{ top: number; pitch: number; w: number }>();
  useLayoutEffect(() => {
    const el = ref.current;
    const sibs = el?.closest(".kl-row")?.parentElement?.querySelectorAll<HTMLElement>(".kl-row");
    if (!el || !sibs || sibs.length < 3) return;
    const head = sibs[0].getBoundingClientRect();
    const first = sibs[1].getBoundingClientRect();
    const second = sibs[2].getBoundingClientRect();
    const n = { top: first.top - head.top, pitch: second.top - first.top, w: el.getBoundingClientRect().width };
    setM((o) => (o && o.top === n.top && o.pitch === n.pitch && o.w === n.w ? o : n));
  });
  const paths = m ? chainPaths(links, { rows, top: m.top, pitch: m.pitch, x: m.w - 20, step: 3 }) : [];
  return (
    <div ref={ref} className="fxc" data-testid="fx-chain">
      <span className="fxc-cap">Chain</span>
      {m && (
        <svg className="fxc-svg" width={m.w} height={m.top + rows * m.pitch} aria-hidden="true">
          <defs><marker id="fxc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
          {paths.map((p) => <polyline key={p.from} data-testid={`fxc-link-${p.from}-${p.to}`} className="fxc-link" points={p.pointsAttr} fill="none" markerEnd="url(#fxc-arrow)" />)}
        </svg>
      )}
    </div>
  );
}
