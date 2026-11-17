// Acceptance gate for the keyboard page map. Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gate, core, root } from "./gate-kit.mjs";

const g = gate("PAGES"), { check, finish } = g, { T, Q } = await core(g);
const file = path.join(root, "src/core/pages/pages.json");
if (!existsSync(file)) { g.fails.push("src/core/pages/pages.json is missing"); await finish(); }
const M = JSON.parse(readFileSync(file, "utf8"));
const guide = readFileSync(path.join(root, "research/param-guide.txt"), "utf8").replace(/[–—�]/g, "-");
const tabsOf = (pages) => pages.flatMap((p) => p.tabs.map((t) => ({ ...t, page: p })));
const tables = () => [["hd1", T.programHd1, M.program.hd1], ["exiCommon", T.programExiCommon, M.program.exiCommon], ["combi", T.combi, M.combi], ...Object.entries(T.engines).map(([n, rows]) => [n, rows, M.program.engines[n]])];
const pageOf = (pages, group) => pages.find((p) => p.tabs.some((t) => (t.groups ?? []).includes(group) || (t.params ?? []).some((x) => x.startsWith(`${group}/`))));

await check("the file has every section", () => { assert.ok(M.program?.hd1 && M.program?.exiCommon && M.combi); for (const n of Object.keys(T.engines)) assert.ok(Array.isArray(M.program.engines?.[n]), n); });
await check("HD-1 pages match the keyboard", () => assert.deepEqual(M.program.hd1.map((p) => `${p.page} ${p.title}`), ["P0 Play", "P1 Basic/Vector", "P2 OSC/Pitch", "P3 Filter", "P4 Amp/EQ", "P5 LFO", "P6 AMS Mixer/Common Key Track", "P7 KARMA", "P8 Insert Effect", "P9 Master/Total Effect"]));
await check("every reference points at a real setting", () => { for (const [n, rows, pages] of tables()) { const groups = new Set(rows.map((r) => r.group)), params = new Set(rows.map((r) => `${r.group}/${r.name}`)); for (const t of tabsOf(pages)) { for (const x of t.groups ?? []) assert.ok(groups.has(x), `${n} ${t.id}: no group ${x}`); for (const x of t.params ?? []) assert.ok(params.has(x), `${n} ${t.id}: no param ${x}`); } } });
await check("tab ids are unique on each screen set", () => { for (const [n, , pages] of tables()) { const ids = tabsOf(pages).map((t) => t.id); assert.equal(new Set(ids).size, ids.length, n); } });
await check("every editable setting has a home, and little is dumped in More", () => {
  const notes = [];
  for (const [n, rows, pages] of tables()) { const tabs = tabsOf(pages), groups = new Set(tabs.flatMap((t) => t.groups ?? [])), params = new Set(tabs.flatMap((t) => t.params ?? [])), more = tabs.filter((t) => /^more$/i.test(t.title)), mg = new Set(more.flatMap((t) => t.groups ?? [])), mp = new Set(more.flatMap((t) => t.params ?? [])); let ed = 0, inMore = 0; const lost = []; for (const r of rows) { if (!Q.isEditable(r)) continue; ed++; const p = `${r.group}/${r.name}`; if (!groups.has(r.group) && !params.has(p)) lost.push(p); if (mg.has(r.group) || mp.has(p)) inMore++; } assert.deepEqual(lost.slice(0, 5), [], `${n}: ${lost.length} settings have no home`); if (ed) assert.ok(inMore / ed <= 0.05, `${n}: ${inMore} of ${ed} are in More`); notes.push(`${n} ${inMore}/${ed}`); }
  return notes.join(" ");
});
await check("settings are on the pages the manual puts them on", () => {
  const H = M.program.hd1, at = (grp, want) => assert.equal(pageOf(H, grp)?.page, want, grp); for (const [grp, want] of [["Pitch EG", "P2"], ["OSC1 Filter EG", "P3"], ["OSC1 Amplifier EG", "P4"], ["OSC1 LFO1", "P5"], ["KARMA Common", "P7"], ["Insert Effect1", "P8"], ["Master Effect1", "P9"], ["Vector Control", "P1"]]) at(grp, want);
  const A = M.program.engines["AL-1"]; for (const [grp, re] of [["Amplifier EG", /amp/i], ["EG1 (Filter)", /EG/], ["LFO1", /LFO/]]) assert.match(pageOf(A, grp)?.title ?? "none", re, grp);
});
await check("tab names come from the manual", () => { let found = 0, all = 0; const miss = []; for (const [, , pages] of tables()) for (const t of tabsOf(pages)) { if (/^more$/i.test(t.title)) continue; all++; if (guide.includes(`${t.id}: ${t.title}`) || guide.includes(`${t.id}:  ${t.title}`)) found++; else if (miss.length < 8) miss.push(`${t.id} ${t.title}`); } assert.ok(found / all >= 0.8, `${found} of ${all} found; for example ${miss.join(", ")}`); return `${found} of ${all}`; });
await check("no prose from the manual was copied", () => { const walk = (v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(walk) : v && typeof v === "object" ? Object.values(v).flatMap(walk) : []); for (const s of walk(M)) assert.ok(s.length <= 90, `too long to be a label: ${s.slice(0, 60)}`); });
await finish();
