// Generic effect page: title bar, framed sections in two columns, tables, graphs. Controls and graphs are injected, so no workstation data is imported here.
import type { ReactNode } from "react";
import type { FxLine, FxSection, ParamDesc } from "../../../core/fx/desc.ts";
import type { FxGraphSpec } from "../../../core/fx/graphs.ts";
import { isWide, placeGraphs } from "./fx-place.ts";
import "./fx-page.css";

export { isWide, placeGraphs };

export type FxPageProps = {
  title: string;
  header?: ReactNode;
  sections: FxSection[];
  graphs: FxGraphSpec[];
  render: (d: ParamDesc, label: string) => ReactNode;
  graph: (spec: FxGraphSpec) => ReactNode;
};

function Mods({ line, render }: { line: FxLine; render: FxPageProps["render"] }) {
  if (line.mods.length === 0) return null;
  return (
    <div className="fxp-mods">
      {line.mods.map((m) => (
        <div className="fxp-mod" key={m.key}>
          <span className="fxp-label">{/Intensity$/.test(m.name) ? "Amount:" : "Source:"}</span>
          {render(m, m.name)}
        </div>
      ))}
    </div>
  );
}

function Line({ line, render }: { line: FxLine; render: FxPageProps["render"] }) {
  return (
    <div className="fxp-line" data-testid={`fxp-line-${line.desc.key}`}>
      <div className="fxp-main">
        <span className="fxp-label">{line.label}</span>
        {render(line.desc, line.label)}
      </div>
      <Mods line={line} render={render} />
    </div>
  );
}

// Wide tables (more than 6 columns, type 86 has 12) become one card per row so the page never scrolls sideways; each mod stays under its own column name.
const WIDE_COLS = 6;

function Table({ table, render }: { table: NonNullable<FxSection["table"]>; render: FxPageProps["render"] }) {
  if (table.cols.length > WIDE_COLS) {
    return (
      <div className="fxp-cards">
        {table.rows.map((r) => (
          <div className="fxp-card" key={r.label}>
            <b className="fxp-card-h">{r.label}</b>
            {r.cells.map((c, i) => c && (
              <div className="fxp-cell" key={i}>
                <span className="fxp-label">{table.cols[i]}</span>
                {render(c.desc, c.label)}
                <Mods line={c} render={render} />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <table className="fxp-table">
      <thead>
        <tr><th>{table.title}</th>{table.cols.map((c) => <th key={c}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {table.rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            {r.cells.map((c, i) => (
              <td key={i}>
                {c && (
                  <>
                    {render(c.desc, c.label)}
                    <Mods line={c} render={render} />
                  </>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FxPage({ title, header, sections, graphs, render, graph }: FxPageProps) {
  const { top, bySection } = placeGraphs(sections, graphs);
  // Output is drawn last and full width, whatever the order it came in.
  const ordered = [...sections.filter((s) => s.title !== "Output"), ...sections.filter((s) => s.title === "Output")];
  return (
    <div className="fxp" data-testid="fxp">
      <div className="fxp-bar">
        <span className="fxp-title" data-testid="fxp-title">{title}</span>
        <span className="fxp-header">{header}</span>
      </div>
      {top.length > 0 && (
        <div className="fxp-top">{top.map((g, i) => <div className="fxp-graph" key={i}>{graph(g)}</div>)}</div>
      )}
      <div className="fxp-grid">
        {ordered.map((s) => {
          const gs = bySection.get(s.title) ?? [];
          return (
            <section className="fxp-sec" data-wide={isWide(s, gs.length > 0)} key={s.title} data-testid={`fxp-sec-${s.title}`}>
              <h3 className="fxp-tab">{s.title}</h3>
              <div className="fxp-body">
                {gs.length > 0 && (
                  <div className="fxp-graphs">{gs.map((g, i) => <div className="fxp-graph" key={i}>{graph(g)}</div>)}</div>
                )}
                {s.table && <Table table={s.table} render={render} />}
                {s.lines.length > 0 && (
                  <div className="fxp-lines" data-cols={s.lines.length > 10 ? 2 : 1}>
                    {s.lines.map((l) => <Line key={l.desc.key} line={l} render={render} />)}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
