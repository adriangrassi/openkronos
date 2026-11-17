// Acceptance gate for envelope graphs and the Combi keyboard map. Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { gate, core, launch, load, onlyBits, sha, testsAndTypes } from "./gate-kit.mjs";

const g = gate("GRAPHS"), { check, finish } = g, C = await core(g), { T, L, Q, raw, parsed } = C;
let G; try { G = await load("src/core/params/graphs.ts"); } catch (e) { g.fails.push(`cannot load graphs.ts: ${e.message}`); await finish(); }
const f = parsed(), NEED = ["Start Level", "Attack Level", "Break Level", "Attack Time", "Decay Time", "Slope Time", "Release Time"];
const expected = (rows) => { const m = new Map(); for (const r of rows) if (!r.continuation) { if (!m.has(r.group)) m.set(r.group, new Set()); m.get(r.group).add(r.name); } return [...m].filter(([, s]) => NEED.every((n) => s.has(n))).map(([k]) => k).sort(); };
const JK = "program:U-AA", JI = 78, jump = L.getEntry(f, JK, JI), jumpRows = Q.paramsFor(T, "exi", jump), AMP = "EXi1 AL-1: Amplifier EG";
const jumpEnv = () => G.findEnvelopes(jumpRows).find((e) => e.group === AMP);

await check("envelopes are found in every engine", () => {
  const hd = G.findEnvelopes(T.programHd1).map((e) => e.group).sort(); assert.deepEqual(hd, expected(T.programHd1)); for (const n of ["Pitch EG", "OSC1 Amplifier EG", "OSC2 Filter EG"]) assert.ok(hd.includes(n), n);
  for (const [n, rows] of Object.entries(T.engines)) assert.deepEqual(G.findEnvelopes(rows).map((e) => e.group).sort(), expected(rows), n);
  const p = G.findEnvelopes(T.programHd1).find((e) => e.group === "Pitch EG"); assert.equal(p.fields.sustainLevel, null); assert.equal(p.fields.attackTime.name, "Attack Time");
});
await check("the shape matches the real Jump amp envelope", () => {
  const v = G.readEnvelope(jumpEnv(), jump); assert.deepEqual([v.startLevel, v.attackLevel, v.breakLevel, v.sustainLevel, v.attackTime, v.decayTime, v.slopeTime, v.releaseTime], [0, 99, 99, 99, 6, 50, 87, 37]);
  const H = G.HOLD; assert.ok(H > 0); assert.deepEqual(G.envelopePoints(v), [{ x: 0, y: 0 }, { x: 6, y: 99 }, { x: 56, y: 99 }, { x: 143, y: 99 }, { x: 143 + H, y: 99 }, { x: 143 + H + 37, y: v.releaseLevel }]);
});
const writes = (w) => Object.fromEntries(w.map(({ row, value }) => [row.name, value]));
await check("dragging a point sets exactly the right settings", () => {
  const e = jumpEnv(), v = G.readEnvelope(e, jump);
  assert.deepEqual(writes(G.dragEnvelope(e, v, 1, 20, 50)), { "Attack Time": 20, "Attack Level": 50 }); assert.deepEqual(writes(G.dragEnvelope(e, v, 2, 16, 40)), { "Decay Time": 10, "Break Level": 40 }); assert.deepEqual(writes(G.dragEnvelope(e, v, 0, 30, 12)), { "Start Level": 12 });
  assert.deepEqual(writes(G.dragEnvelope(e, v, 3, 66, 20)), { "Slope Time": 10, "Sustain Level": 20 }); assert.deepEqual(writes(G.dragEnvelope(e, v, 4, 999, 33)), { "Sustain Level": 33 });
  const rel = G.envelopePoints(v)[4].x; assert.deepEqual(writes(G.dragEnvelope(e, v, 5, rel + 9, 77)), { "Release Time": 9 }, "the amp envelope's fixed end level must not be written");
});
await check("drags are clamped and rounded", () => { const e = jumpEnv(), v = G.readEnvelope(e, jump); assert.deepEqual(writes(G.dragEnvelope(e, v, 1, 9999, -9999)), { "Attack Time": 99, "Attack Level": 0 }); assert.deepEqual(writes(G.dragEnvelope(e, v, 1, -5, 12.6)), { "Attack Time": 0, "Attack Level": 13 }); const b = G.findEnvelopes(jumpRows).find((x) => x.group === "EXi1 AL-1: EG1 (Filter)"), w = G.dragEnvelope(b, G.readEnvelope(b, jump), 1, 10, -500); assert.equal(writes(w)["Attack Level"], -99); });
await check("a drag to where a point already is changes nothing, on real sounds", () => {
  const banks = L.listBanks(f).filter((b) => b.kind === "program"); let n = 0;
  for (const b of banks) for (let i = 0; i < b.count; i += 13) { const e = L.getEntry(f, b.key, i), rows = b.type === "exi" ? Q.paramsFor(T, "exi", e) : T.programHd1; for (const env of G.findEnvelopes(rows)) { const v = G.readEnvelope(env, e), pts = G.envelopePoints(v); pts.forEach((p, k) => { for (const { row, value } of G.dragEnvelope(env, v, k, p.x, p.y)) { n++; assert.equal(value, Q.readParam(e, row), `${b.key}/${i} ${env.group} point ${k} ${row.name}`); } }); } }
  return `${n} writes checked`;
});
const zoneRow = (t, n) => T.combi.find((r) => r.group === `Timbre${t}` && r.name === n);
await check("Combi zones match an independent reading", () => {
  for (const b of L.listBanks(f).filter((x) => x.kind === "combi")) for (let i = 0; i < b.count; i += 29) { const e = L.getEntry(f, b.key, i), z = G.timbreZones(T, e); assert.equal(z.length, 16); z.forEach((q, n) => { const t = n + 1; assert.equal(q.timbre, t); for (const [k, name] of [["status", "Status"], ["keyBottom", "Key Window Bottom"], ["keyTop", "Key Window Top"], ["velLow", "Vel.Window Low"], ["velHigh", "Vel.Window High"], ["bank", "Bank Number"], ["program", "Program Number"]]) assert.equal(q[k], Q.readParam(e, zoneRow(t, name)), `${b.key}/${i} timbre ${t} ${k}`); }); }
});
await check("a zone's edges can't cross", () => { const z = { keyBottom: 40, keyTop: 60, velLow: 10, velHigh: 90 }; assert.equal(G.clampZoneEdge(z, "keyTop", 20), 40); assert.equal(G.clampZoneEdge(z, "keyBottom", 100), 60); assert.equal(G.clampZoneEdge(z, "velHigh", 2), 10); assert.equal(G.clampZoneEdge(z, "velLow", 120), 90); assert.equal(G.clampZoneEdge(z, "keyTop", 500), 127); assert.equal(G.clampZoneEdge(z, "velLow", -5), 1); assert.equal(G.clampZoneEdge(z, "keyBottom", -5), 0); });
await testsAndTypes(g, ["core/params/graphs.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C), { win, X, seen, text, until, editSlot, closeEditor, saved, drag } = ui;
const pts = () => win.locator('[data-testid^="eg-point-"]').count();
const backToOriginal = async () => { await X("undo").click(); await new Promise((r) => setTimeout(r, 300)); const bytes = await saved(); assert.equal(sha(bytes), sha(raw), "the file is not back to the original"); };
await ui.openFile();
await check("an envelope group shows its graph with six points", async () => { await editSlot(JK, JI); await X(`group-${AMP}`).click(); await seen("eg-graph"); await seen("eg-point-1"); assert.equal(await pts(), 6); });
await check("dragging a point on the real app moves exactly two settings, in one undo", async () => {
  await drag("eg-point-1", 40, 30); const e = jumpEnv().fields, after = L.getEntry(C.P.parsePcg(await saved()), JK, JI), parts = [...e.attackTime.parts, ...e.attackLevel.parts];
  assert.ok(Q.readParam(after, e.attackTime) > 6, "attack time did not grow"); assert.ok(Q.readParam(after, e.attackLevel) < 99, "attack level did not fall"); onlyBits(after, jump, parts); await backToOriginal();
});
await check("arrow keys move a point", async () => { await X("eg-point-1").focus(); await win.keyboard.press("ArrowLeft"); const e = jumpEnv().fields, after = L.getEntry(C.P.parsePcg(await saved()), JK, JI); assert.equal(Q.readParam(after, e.attackTime), 5); await backToOriginal(); });
await check("the graph follows a typed value", async () => { const t = jumpEnv().fields.attackTime, k = `${t.ofs}.${t.bitLo ?? 0}`, cx = async () => Number(await X("eg-point-1").getAttribute("cx")); const before = await cx(); await X(`input-${k}`).fill("60"); await X(`input-${k}`).press("Enter"); await until(async () => (await cx()) > before, "point moved"); await backToOriginal(); });
await check("a group with no envelope shows no graph", async () => { await X("group-Insert Effect1").click(); await seen("group-Insert Effect1"); await new Promise((r) => setTimeout(r, 200)); assert.equal(await X("eg-graph").count(), 0); await closeEditor(); });
const CK = "combi:INT-A", combi = L.getEntry(f, CK, 0), label = (b) => (b <= 5 ? `INT-${"ABCDEF"[b]}` : b >= 17 && b <= 23 ? `U-${"ABCDEFG"[b - 17]}` : b >= 24 && b <= 30 ? `U-${"ABCDEFG"[b - 24].repeat(2)}` : null);
await check("the Combi keyboard map shows all 16 timbres with their sounds", async () => {
  await editSlot(CK, 0); await X("group-Keyboard Map").click(); await seen("keymap"); for (let t = 1; t <= 16; t++) await X(`zone-${t}`).waitFor({ state: "attached", timeout: 5000 });
  const l = label(Q.readParam(combi, zoneRow(1, "Bank Number"))); assert.ok(l, "timbre 1 uses an untracked bank"); assert.ok((await text("zone-label-1")).includes(L.getName(f, `program:${l}`, Q.readParam(combi, zoneRow(1, "Program Number"))))); const r = await text("zone-range-1"); assert.ok(r.includes(Q.formatValue(zoneRow(1, "Key Window Bottom"), Q.readParam(combi, zoneRow(1, "Key Window Bottom")))), r);
});
await check("dragging a zone edge changes only that edge", async () => { const r = zoneRow(1, "Key Window Top"), was = Q.readParam(combi, r); await drag("zone-high-1", -80, 0); const after = L.getEntry(C.P.parsePcg(await saved()), CK, 0); assert.ok(Q.readParam(after, r) < was, "the top note did not move down"); onlyBits(after, combi, r.parts); await backToOriginal(); });
await check("a velocity edge works from the keyboard", async () => { const r = zoneRow(1, "Vel.Window High"), was = Q.readParam(combi, r); await X("zone-vel-high-1").focus(); await win.keyboard.press("ArrowDown"); const after = L.getEntry(C.P.parsePcg(await saved()), CK, 0); assert.equal(Q.readParam(after, r), was - 1); onlyBits(after, combi, r.parts); await backToOriginal(); });
await ui.noErrors();
await finish();
