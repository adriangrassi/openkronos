// Prints how many controls of the Kronos layouts get a Parameter Guide description, and the most common names that do not. Reads src/generated/help.json and params.json (run the build once); changes nothing.
import { existsSync, readFileSync } from "node:fs";
import { cellsOf, refIndex, resolve, type LayoutSpec } from "../src/core/pages/layout.ts";
import { combiLayouts } from "../src/core/pages/layouts/combi.ts";
import { programHd1Layouts } from "../src/core/pages/layouts/program-hd1.ts";
import { helpFor, setHelpData } from "../src/core/pages/help.ts";
import type { HelpData } from "../src/core/pages/helpParse.ts";
import type { ParamTables, Row } from "../src/core/params/params.ts";

const load = (n: string) => new URL(`../src/generated/${n}`, import.meta.url);
if (!existsSync(load("params.json"))) throw new Error("src/generated/params.json is missing: run npm run build once");
const tables = JSON.parse(readFileSync(load("params.json"), "utf8")) as ParamTables;
const help: HelpData = existsSync(load("help.json")) ? JSON.parse(readFileSync(load("help.json"), "utf8")) : {};
setHelpData(help);
console.log(`help.json: ${help.entries?.length ?? 0} entries${help.entries?.length ? "" : " (empty: the guide text was not available at build time)"}`);

const sets: [string, "program" | "combi", Row[], LayoutSpec][] = [["program (HD-1)", "program", tables.programHd1, programHd1Layouts], ["combination", "combi", tables.combi, combiLayouts]];
const missing = new Map<string, number>();
for (const [title, mode, rows, spec] of sets) {
  const index = refIndex(rows);
  const seen = new Set<string>();
  let got = 0;
  let none = 0;
  for (const [tab, layout] of Object.entries(spec)) {
    for (const c of cellsOf(layout)) {
      const r = resolve(index, c);
      if (!r) continue;
      const k = `${tab}|${r.ofs}.${r.bitLo ?? 0}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (helpFor(mode, tab, r, c.label)) got++;
      else {
        none++;
        missing.set(`${mode}: ${r.name}`, (missing.get(`${mode}: ${r.name}`) ?? 0) + 1);
      }
    }
  }
  console.log(`${title}: ${got} of ${got + none} layout controls have help (${((100 * got) / Math.max(1, got + none)).toFixed(0)}%)`);
}
console.log("30 most common names without help:");
for (const [k, n] of [...missing].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30)) console.log(`  ${String(n).padStart(3)}  ${k}`);
