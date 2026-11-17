// Keyboard-style editor: pages along the bottom, tabs on top, settings in labelled groups. Same rows and write path as the List view.
import { useContext, useState } from "react";
import { readParam, type ParamTables, type Row } from "../../core/params/params.ts";
import { findEnvelopes, type Write } from "../../core/params/graphs.ts";
import type { Screen } from "../../core/pages/view.ts";
import { EnvelopeGraph } from "./EnvelopeGraph.tsx";
import { ParamRow } from "./ParamEditor.tsx";
import { HelpScope } from "./InfoIcon.tsx";

type Props = {
  screens: Screen[];
  tables: ParamTables;
  cur: Uint8Array;
  base: Uint8Array;
  onCommit: (r: Row, text: string) => void;
  onWrite: (writes: Write[]) => void;
};

const pageKey = (s: Screen): string => `${s.slot ?? 0}-${s.page}`;
const pagePrefix = (s: Screen): string => (s.engine ? `EXi${s.slot} ${s.page}` : s.page);
const pageName = (s: Screen): string => s.title.replace(/Effect/g, "FX");
const pageLabel = (s: Screen): string => (s.engine ? `EXi${s.slot} ${s.engine} ${s.page} ${s.title}` : `${s.page} ${s.title}`);
// Engine rows carry an "EXi<n> <engine>: " prefix; the page already names the engine, so the group label drops it.
const groupLabel = (g: string): string => g.replace(/^EXi\d [^:]*: /, "");

// Rows of one tab, split into the groups they came from, in table order.
function groupsOf(rows: Row[]): [string, Row[]][] {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const list = m.get(r.group);
    if (list) list.push(r);
    else m.set(r.group, [r]);
  }
  return [...m];
}

export function KeyboardView({ screens, tables, cur, base, onCommit, onWrite }: Props) {
  const [key, setKey] = useState(() => pageKey(screens[0]));
  const [tabId, setTabId] = useState("");
  const page = screens.find((s) => pageKey(s) === key) ?? screens[0];
  const tab = page.tabs.find((t) => t.id === tabId) ?? page.tabs[0];
  const envs = findEnvelopes(tab.rows);
  // the tab ids are the guide's, except for EXi engines, whose tabs repeat per engine
  const outer = useContext(HelpScope);
  const scope = outer && { mode: outer.mode, tab: outer.mode === "exi" || tab.id === "more" || tab.id === "other" ? undefined : tab.id };

  return (
    <HelpScope.Provider value={scope}>
    <div className="kb" data-testid="keyboard-view">
      <nav className="kb-tabs" aria-label="Tabs">
        {page.tabs.map((t) => (
          <button key={t.id} data-testid={`kb-tab-${t.id}`} data-active={String(t.id === tab.id)} aria-pressed={t.id === tab.id} onClick={() => setTabId(t.id)}>
            {t.title}
          </button>
        ))}
      </nav>
      <div className="kb-body">
        {envs.map((env) => (
          <EnvelopeGraph key={env.group} env={env} entry={cur} onWrite={onWrite} />
        ))}
        <div className="kb-groups">
          {groupsOf(tab.rows).map(([g, rows]) => (
            <section className="kb-group" key={g} aria-label={groupLabel(g)}>
              <h3>{groupLabel(g)}</h3>
              {rows.map((r) => (
                <ParamRow
                  key={`${r.ofs}.${r.bitLo ?? 0}`}
                  flow
                  tables={tables}
                  r={r}
                  value={readParam(cur, r)}
                  changed={readParam(cur, r) !== readParam(base, r)}
                  onCommit={(text) => onCommit(r, text)}
                />
              ))}
            </section>
          ))}
        </div>
      </div>
      <nav className="kb-pages" aria-label="Pages">
        {screens.map((s) => (
          <button
            key={pageKey(s)}
            data-testid={`kb-page-${pageKey(s)}`}
            data-active={String(pageKey(s) === pageKey(page))}
            aria-pressed={pageKey(s) === pageKey(page)}
            title={pageLabel(s)}
            onClick={() => {
              setKey(pageKey(s));
              setTabId("");
            }}
          >
            <small>{pagePrefix(s)}</small>
            <span>{pageName(s)}</span>
          </button>
        ))}
      </nav>
    </div>
    </HelpScope.Provider>
  );
}
