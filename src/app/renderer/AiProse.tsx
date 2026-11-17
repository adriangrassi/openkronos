// How the AI window shows text: the run log (owner's request, model answers, collapsed tool trace), an answer card, and the text-size control.
import { createElement, useState, type CSSProperties, type ReactNode } from "react";
import { parseBlocks, type Inline } from "../../core/ai/miniMarkdown.ts";
import { groupLog } from "../../core/ai/logView.ts";

const inline = (parts: Inline[]): ReactNode => parts.map((p, i) => (p.kind === "bold" ? <strong key={i}>{p.text}</strong> : p.kind === "italic" ? <em key={i}>{p.text}</em> : p.kind === "code" ? <code key={i}>{p.text}</code> : p.text));

// .ai-text marks the words a press selects instead of moving the window.
export function Prose({ text }: { text: string }) {
  return (
    <div className="ai-prose">
      {parseBlocks(text).map((b, i) =>
        b.kind === "table" ? (
          <table key={i} className="ai-table">
            <thead><tr>{b.head.map((c, j) => <th key={j} className="ai-text">{inline(c)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="ai-text">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        ) : "items" in b ? createElement(b.kind, { key: i }, b.items.map((it, j) => <li key={j} className="ai-text">{inline(it)}</li>))
        : b.kind === "h" ? <h4 key={i} className="ai-text">{inline(b.inline)}</h4>
        : <p key={i} className="ai-text">{inline(b.inline)}</p>)}
    </div>
  );
}

export function AiAnswer({ text }: { text: string }) {
  return <div className="ai-card ai-answer" data-testid="ai-note"><Prose text={text} /></div>;
}

export function AiLog({ lines }: { lines: string[] }) {
  return (
    <ol className="ai-log" data-testid="ai-log" aria-live="polite">
      {groupLog(lines).map((e, i) =>
        e.kind === "echo" ? <li key={i} className="ai-echo"><span className="ai-who">You</span><span className="ai-text">{e.text}</span></li>
        : e.kind === "model" ? <li key={i} className="ai-msg"><span className="ai-who">Model</span><div className="ai-card"><Prose text={e.text} /></div></li>
        : e.kind === "tools" ? (
          <li key={i} className="ai-tools">
            <details>
              <summary>Tool activity ({e.lines.length})</summary>
              <ul>{e.lines.map((l, j) => <li key={j} className="ai-text">{l}</li>)}</ul>
            </details>
          </li>
        ) : <li key={i} className="ai-line ai-text">{e.text}</li>)}
    </ol>
  );
}

const SIZES = [14, 16, 18, 20];
const DEFAULT_SIZE = 16; // the --ai-body-size every theme sets, shown until the owner picks one
// A- / A+ in the header; the choice is kept and overrides the theme's --ai-body-size on the window.
export function useAiFontSize() {
  const [px, setPx] = useState<number | null>(() => { const n = Number(localStorage.getItem("kronos.ai.fs")); return SIZES.includes(n) ? n : null; });
  const now = px ?? DEFAULT_SIZE;
  const step = (d: number) => { const n = SIZES[Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(now) + d))]; setPx(n); localStorage.setItem("kronos.ai.fs", String(n)); };
  const controls = (
    <span className="ai-fs" role="group" aria-label="Answer text size">
      <button data-testid="ai-fs-down" aria-label="Smaller answer text" onClick={() => step(-1)} disabled={now === SIZES[0]}>A-</button>
      <span className="ai-fs-val" data-testid="ai-fs-val" aria-live="polite">{now}</span>
      <button data-testid="ai-fs-up" aria-label="Larger answer text" onClick={() => step(1)} disabled={now === SIZES[SIZES.length - 1]}>A+</button>
    </span>
  );
  return { controls, style: (px ? { "--ai-body-size": `${px}px` } : {}) as CSSProperties };
}
