// Acceptance gate for LFO graphs, the Drum Kit map and the Wave Sequence timeline. Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { gate, core, launch, load, onlyBits, sha, testsAndTypes } from "./gate-kit.mjs";

const g = gate("GRAPHS2"), { check, finish } = g, C = await core(g), { T, P, L, Q, raw, parsed } = C;
let G; try { G = await load("src/core/params/graphs2.ts"); } catch (e) { g.fails.push(`cannot load graphs2.ts: ${e.message}`); await finish(); }
const f = parsed(), DK = "drumkit:INT", WK = "waveseq:INT", drum = L.getEntry(f, DK, 0), wave = L.getEntry(f, WK, 0), dr = Q.paramsFor(T, "drumkit", drum), wr = Q.paramsFor(T, "waveseq", wave);
const R = (rows, gr, n) => { const r = rows.find((x) => x.group === gr && x.name === n); assert.ok(r, `${gr} / ${n}`); return r; }, K = (r) => `${r.ofs}.${r.bitLo ?? 0}`;

await check("LFOs are found in HD-1 and the engines", () => { const hd = G.findLfos(T.programHd1).map((l) => l.group); for (const n of ["OSC1 LFO1", "OSC2 LFO2", "Common LFO"]) assert.ok(hd.includes(n), n); const al = G.findLfos(T.engines["AL-1"]).map((l) => l.group); for (const n of ["LFO1", "LFO4"]) assert.ok(al.includes(n), n); const l = G.findLfos(T.programHd1).find((x) => x.group === "OSC1 LFO1"); assert.equal(l.fields.waveform.name, "Waveform"); assert.equal(l.fields.frequency.name, "Frequency"); });
await check("every LFO shape can be drawn", () => { const n = G.LFO_WAVEFORMS.length; assert.equal(n, 18); assert.ok(G.LFO_WAVEFORMS.every((s) => typeof s === "string" && s.length)); for (let w = 0; w < n; w++) for (const shape of [-99, 0, 99]) { const p = G.lfoPoints(w, shape, 64); assert.equal(p.length, 64, `wave ${w}`); assert.ok(p.every((y) => Number.isFinite(y) && y >= -1.0001 && y <= 1.0001), `wave ${w} shape ${shape}`); } assert.notDeepEqual(G.lfoPoints(0, 0, 64), G.lfoPoints(5, 0, 64)); assert.deepEqual(G.lfoPoints(3, 10, 32), G.lfoPoints(3, 10, 32), "must be repeatable"); });
await check("the drum map matches an independent reading", () => {
  const m = G.drumMap(T, drum); assert.equal(m.length, 128);
  for (const n of [1, 37, 61, 128]) { const note = m[n - 1]; assert.equal(note.note, n - 1); assert.equal(note.zones.length, 8); note.zones.forEach((z, i) => { const gr = `Note${n} Zone${i + 1}`; assert.equal(z.on, Q.readParam(drum, R(dr, gr, "Sample On/Off")) === 1, gr); assert.equal(z.sampleId, Q.readParam(drum, R(dr, gr, "Sample Id")), gr); assert.equal(z.level, Q.readParam(drum, R(dr, gr, "Level")), gr); }); }
  assert.ok(m.some((x) => x.zones.some((z) => z.on)), "no note is on");
});
await check("the wave sequence matches an independent reading", () => {
  const w = G.waveSeqTimeline(T, wave), C2 = (n) => Q.readParam(wave, R(wr, "Common", n)); assert.equal(w.steps.length, 64); for (const [k, n] of [["startStep", "Start Step"], ["endStep", "End Step"], ["loopStart", "Loop Start"], ["loopEnd", "Loop End"]]) assert.equal(w[k], C2(n), n);
  for (const s of [1, 2, 37, 64]) { const q = w.steps[s - 1], gr = `Step${s}`; for (const [k, n] of [["type", "Step Type"], ["level", "Level"], ["duration", "Duration"], ["crossfade", "Crossfade"]]) assert.equal(q[k], Q.readParam(wave, R(wr, gr, n)), `${gr} ${n}`); }
});
await testsAndTypes(g, ["core/params/graphs2.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C), { win, X, seen, text, editSlot, closeEditor, saved, drag } = ui;
const back = async () => { await X("undo").click(); await new Promise((r) => setTimeout(r, 300)); assert.equal(sha(await saved()), sha(raw), "not back to the original"); };
await ui.openFile();
await check("an LFO group shows its wave and names it", async () => { await editSlot("program:INT-B", 5); await X("group-OSC1 LFO1").click(); await seen("lfo-graph"); const v = Q.readParam(L.getEntry(f, "program:INT-B", 5).subarray(0, 3706), R(T.programHd1, "OSC1 LFO1", "Waveform")); assert.equal(await text("lfo-name"), G.LFO_WAVEFORMS[v]); await closeEditor(); });
await check("the drum map shows 128 notes and opens one", async () => { await editSlot(DK, 0); await X("group-Drum Map").click(); await seen("drum-map"); assert.equal(await win.locator('[data-testid^="drum-note-"]').count(), 128); const n = G.drumMap(T, drum).findIndex((x) => x.zones.some((z) => z.on)), gr = `Note${n + 1} Zone1`, lv = R(dr, gr, "Level"); await X(`drum-note-${n}`).click(); await seen(`param-${K(lv)}`); await closeEditor(); });
await check("dragging a step's end changes only its duration", async () => { await editSlot(WK, 0); await X("group-Timeline").click(); await seen("wave-timeline"); const t = G.waveSeqTimeline(T, wave), s = t.startStep + 1, r = R(wr, `Step${s}`, "Duration"), was = Q.readParam(wave, r); await seen(`wave-step-end-${s}`); await drag(`wave-step-end-${s}`, was < r.rawMax / 2 ? 40 : -40, 0); const after = L.getEntry(P.parsePcg(await saved()), WK, 0), now = Q.readParam(after, r); assert.notEqual(now, was, "duration did not change"); onlyBits(after, wave, r.parts); await back(); await closeEditor(); });
await ui.noErrors();
await finish();
