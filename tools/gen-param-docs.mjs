// Builds src/generated/param-docs.json for the AI's lookup_param_help tool and the Shift-click explain grounding, from KORG's Parameter Guide text
// (research/param-guide.txt: private, never committed). Longer entries than help.json (the whole On/Off description), no tab ids. Without the text the file is {}.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseGuide } from "../src/core/pages/helpParse.ts";

const root = path.resolve(import.meta.dirname, "..");
const guide = path.join(root, "research/param-guide.txt");
const out = path.join(root, "src/generated/param-docs.json");
mkdirSync(path.dirname(out), { recursive: true });
if (!existsSync(guide)) {
  writeFileSync(out, "{}");
  console.log("param-docs.json: research/param-guide.txt not found, no parameter docs");
} else {
  const text = readFileSync(guide, "latin1");
  const { entries } = parseGuide(text, 1500);
  const slim = entries.map(({ mode, engine, label, sub, section, tabTitle, page, text: t }) => ({ mode, ...(engine ? { engine } : {}), label, ...(sub ? { sub } : {}), ...(section ? { section } : {}), tabTitle, page, text: t }));
  writeFileSync(out, JSON.stringify({ entries: slim }));
  // The engine notes in src/core/ai/engineNotes.ts were written from these passages: warn if the guide no longer has them.
  for (const e of ["SGX-2", "EP-1", "AL-1", "CX-3", "STR-1", "MS-20EX", "PolysixEX", "MOD-7"]) if (!new RegExp(`The ${e} (supports|uses)`).test(text)) console.log(`param-docs.json: warning, the guide has no "The ${e} supports" passage`);
  console.log(`param-docs.json: ${slim.length} entries`);
}
