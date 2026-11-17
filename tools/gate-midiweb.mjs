// Acceptance gate for MIDI web search and the MIDI library. The network is replaced by fixtures. Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("MIDIWEB"), { check, finish } = g, C = await core(g);
let W; try { W = await load("src/core/midi/sites.ts"); } catch (e) { g.fails.push(`cannot load sites.ts: ${e.message}`); await finish(); }

const BIT = JSON.stringify({ result: { results: [{ id: 4783, name: "Sample Song.mid", url: "/sample-song-mid", downloadUrl: "/uploads/4783.mid" }, { id: 35, name: "Other Tune.mid", url: "/o", downloadUrl: "/uploads/35.mid" }] } });
const WORLD = `<ul>\n<li>\nFirst Tune (Some Band) - <a href="https://www.midiworld.com/download/77" target="_blank">download</a>\n<div></div></li>\n<li>\nRock &amp; Roll Night (It&#39;s A Band) - <a href="https://www.midiworld.com/download/3736" target="_blank">download</a>\n</li></ul>`;
const FREE = `<h5 class=card-title><a href=download3-2253-jive-and-wail-some-orchestra title="Jive And Wail">Jive And Wail</a></h5>\n<h5 class=card-title><a href=download3-659-a-street-tv-themes title="A Street">A Street</a></h5>\n<a href="/download3-2253-jive-and-wail-some-orchestra">again</a>`;

await check("the three sites are listed", () => assert.deepEqual(W.SITES.map((s) => s.id), ["bitmidi", "midiworld", "freemidi"]));
await check("search addresses are built safely", () => {
  assert.equal(W.searchUrl("bitmidi", "van halen"), "https://bitmidi.com/api/midi/search?q=van%20halen&page=0"); assert.equal(W.searchUrl("midiworld", "a&b=c"), "https://www.midiworld.com/search/?q=a%26b%3Dc"); assert.equal(W.searchUrl("freemidi", " jump "), "https://freemidi.org/search?q=jump");
  assert.throws(() => W.searchUrl("evil", "x")); assert.throws(() => W.searchUrl("bitmidi", "   "));
});
await check("results are read from each site's format", () => {
  assert.deepEqual(W.parseResults("bitmidi", BIT), [{ site: "bitmidi", ref: "4783", title: "Sample Song" }, { site: "bitmidi", ref: "35", title: "Other Tune" }]);
  assert.deepEqual(W.parseResults("midiworld", WORLD), [{ site: "midiworld", ref: "77", title: "First Tune (Some Band)" }, { site: "midiworld", ref: "3736", title: "Rock & Roll Night (It's A Band)" }]);
  assert.deepEqual(W.parseResults("freemidi", FREE), [{ site: "freemidi", ref: "2253-jive-and-wail-some-orchestra", title: "Jive And Wail" }, { site: "freemidi", ref: "659-a-street-tv-themes", title: "A Street" }]);
});
await check("unexpected pages give no results instead of an error", () => { for (const s of ["bitmidi", "midiworld", "freemidi"]) { assert.deepEqual(W.parseResults(s, "<html>changed</html>"), []); assert.deepEqual(W.parseResults(s, ""), []); } assert.deepEqual(W.parseResults("bitmidi", '{"result":{"results":[{"id":"../x","name":"bad"}]}}'), []); });
await check("download addresses are fixed per site", () => {
  assert.deepEqual(W.downloadRequest("bitmidi", "4783"), { url: "https://bitmidi.com/uploads/4783.mid" }); assert.deepEqual(W.downloadRequest("midiworld", "3736"), { url: "https://www.midiworld.com/download/3736" });
  assert.deepEqual(W.downloadRequest("freemidi", "2253-jive-and-wail"), { url: "https://freemidi.org/getter-2253", pageFirst: "https://freemidi.org/download3-2253-jive-and-wail" });
});
await check("a crafted reference can't reach anywhere else", () => { for (const [s, r] of [["bitmidi", "../secret"], ["bitmidi", "1/2"], ["bitmidi", "1.mid"], ["midiworld", "//evil.example/x"], ["midiworld", "12?x=1"], ["freemidi", "12"], ["freemidi", "12-a/b"], ["freemidi", "x-y"], ["evil", "1"]]) assert.throws(() => W.downloadRequest(s, r), `${s} ${r}`); });
await check("only the sites' own secure addresses are allowed", () => { for (const u of ["https://bitmidi.com/uploads/1.mid", "https://www.midiworld.com/download/1", "https://freemidi.org/getter-1"]) assert.equal(W.allowedUrl(u), true, u); for (const u of ["http://bitmidi.com/uploads/1.mid", "https://bitmidi.com.evil.example/x", "https://evil.example/bitmidi.com", "https://user@evil.example/", "file:///c:/x", "not a url"]) assert.equal(W.allowedUrl(u), false, u); });
await check("file names are safe", () => { assert.equal(W.safeFileName("Rock & Roll Night"), "Rock & Roll Night.mid"); assert.equal(W.safeFileName("Song.mid"), "Song.mid"); for (const t of ["../../x", "a/b\\c:d*e?f\"g<h>i|j", "CON", "", "...", "x".repeat(400)]) { const n = W.safeFileName(t); assert.ok(n.endsWith(".mid"), n); assert.ok(n.length <= 90, n); assert.ok(!/[\/\\:*?"<>|]/.test(n), n); assert.ok(!/^\.+/.test(n), n); assert.ok(!/^(con|prn|aux|nul|com\d|lpt\d)\.mid$/i.test(n), n); } });
await check("real MIDI data is recognised", () => { assert.equal(W.isMidi(Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0])), true); assert.equal(W.isMidi(new TextEncoder().encode("<html>")), false); assert.equal(W.isMidi(new Uint8Array(0)), false); });
await testsAndTypes(g, ["core/midi/sites.test.ts"]);
if (g.fails.length) await finish();

const vlq0 = [0]; const trk = (b) => [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, b.length, ...b];
const song = (n) => Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, ...trk([...vlq0, 0x90, n, 100, 0x60, 0x80, n, 0, ...vlq0, 0xff, 0x2f, 0])]);
const b64 = (a) => Buffer.from(a).toString("base64");
const FIX = { bitmidi: { search: BIT }, midiworld: { search: WORLD }, freemidi: { search: FREE }, files: { "bitmidi:4783": b64(song(60)), "bitmidi:35": b64(new TextEncoder().encode("<html>not midi</html>")), "midiworld:77": b64(song(62)), "midiworld:3736": b64(song(64)), "freemidi:2253-jive-and-wail-some-orchestra": b64(song(65)) } };
const ui0 = { KRONOS_E2E_MIDI_WEB: JSON.stringify(FIX), KRONOS_E2E_MIDI: "PLACEHOLDER" };
const ui = await launch(g, C, ui0), { X, seen, text, until, win, tmp } = ui;
const LIB = path.join(tmp, "midi"), DROP = path.join(tmp, "drop"); mkdirSync(DROP); await g.state.app.evaluate((_e, a) => { process.env.KRONOS_E2E_MIDI_DIR = a[0]; process.env.KRONOS_E2E_MIDI = a[1]; }, [LIB, path.join(DROP, "my song.mid")]);
const files = () => (existsSync(LIB) ? readdirSync(LIB).filter((n) => /\.mid$/i.test(n)).sort() : []);
const hitsCount = () => win.locator('[data-testid^="midi-hit-row-"]').count();
const hitIndex = async (title) => { const n = await hitsCount(); for (let i = 0; i < n; i++) if ((await text(`midi-hit-row-${i}`)).includes(title)) return i; throw new Error(`no hit ${title}`); };
const log = () => win.evaluate(() => window.__kronosE2E.midiLog()), hasNote = (l, n) => l.some((m) => m[0] === 0x90 && m[1] === n && m[2] > 0);

await ui.openFile();
await check("the browser opens with no keyboard connected", async () => { await X("midi-browse").click(); await seen("midi-q"); await seen("midi-site-bitmidi"); });
await check("a search shows results from all three sites", async () => { await X("midi-q").fill("jump"); await X("midi-q-go").click(); await seen("midi-hit-row-0"); await until(async () => (await hitsCount()) === 6, "six results"); for (const t of ["Sample Song", "Rock & Roll Night", "Jive And Wail"]) await hitIndex(t); });
await check("a site can be left out", async () => { await X("midi-site-freemidi").uncheck(); await X("midi-q-go").click(); await until(async () => (await hitsCount()) === 4, "four results"); await X("midi-site-freemidi").check(); await X("midi-q-go").click(); await until(async () => (await hitsCount()) === 6, "six again"); });
await check("Download saves a real file into the library", async () => { const i = await hitIndex("Rock & Roll Night"); await X(`midi-hit-save-${i}`).click(); await until(async () => files().length === 1, "file saved"); assert.match(files()[0], /Rock & Roll Night/); assert.equal(Buffer.from(readFileSync(path.join(LIB, files()[0]))).subarray(0, 4).toString("latin1"), "MThd"); });
await check("a download that isn't MIDI is refused and not saved", async () => { const i = await hitIndex("Other Tune"); await X(`midi-hit-save-${i}`).click(); await seen("error-message"); assert.equal(files().length, 1); });
await check("downloading the same song twice keeps both or reuses, never overwrites silently", async () => { const i = await hitIndex("Rock & Roll Night"), first = readFileSync(path.join(LIB, files()[0])); await X(`midi-hit-save-${i}`).click(); await new Promise((r) => setTimeout(r, 500)); assert.ok(files().length >= 1); assert.deepEqual(readFileSync(path.join(LIB, files()[0])), first); });
await check("Play needs a keyboard connection", async () => { const i = await hitIndex("First Tune"); assert.equal(await X(`midi-hit-play-${i}`).isDisabled(), true); assert.equal(await X(`midi-hit-save-${i}`).isDisabled(), false); });
await check("Play downloads, keeps it in the library, and plays it", async () => { await X("midi-browse").click(); await ui.connectSim(); await X("midi-browse").click(); await seen("midi-q"); await X("midi-q").fill("jump"); await X("midi-q-go").click(); await until(async () => (await hitsCount()) === 6, "results"); const n = files().length, i = await hitIndex("First Tune"); await X(`midi-hit-play-${i}`).click(); await until(async () => hasNote(await log(), 62), "note played", 10000); assert.equal(files().length, n + 1); await until(async () => /First Tune/.test(await text("midi-file-name")), "shown as current file"); });
await check("the library lists, filters and plays", async () => { await X("midi-tab-library").click(); await until(async () => (await text("midi-lib-count")) === String(files().length), "count"); await X("midi-lib-q").fill("rock"); await until(async () => (await win.locator('[data-testid^="midi-lib-row-"]').count()) === 1, "filtered"); await X("midi-lib-play-0").click(); await until(async () => hasNote(await log(), 64), "library song played", 10000); await X("midi-lib-q").fill(""); });
await check("a file from disk can be added", async () => { writeFileSync(path.join(DROP, "my song.mid"), song(67)); const n = files().length; await X("midi-lib-import").click(); await until(async () => files().length === n + 1, "imported"); assert.ok(files().some((x) => /my song/.test(x))); });
await check("a library song can be removed after confirming", async () => { const n = files().length; await X("midi-lib-del-0").click(); await ui.ok(); await until(async () => files().length === n - 1, "removed"); });
await check("the app can't read outside the library", async () => { for (const bad of ["..\\..\\work.PCG", "../../work.PCG", "C:\\Windows\\win.ini", "x.txt"]) { const r = await win.evaluate((n) => window.kronos.midiLibraryRead(n).then(() => "read", () => "refused"), bad); assert.equal(r, "refused", bad); } });
await check("the app can't fetch a made-up site or reference", async () => { for (const a of [["evil", "1"], ["bitmidi", "../x"]]) { const r = await win.evaluate(([s, x]) => window.kronos.midiDownload(s, x, "t").then(() => "ok", () => "refused"), a); assert.equal(r, "refused", a.join()); } });
await ui.noErrors();
await finish();
