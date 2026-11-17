// Gate for speech in the AI window. FULLY OFFLINE: one fake server on 127.0.0.1 plays both the speech server (/v1/audio/speech) and the local model router (/v1/chat/completions),
// records every request body, and the app is pointed at it through its own settings. KRONOS_GATE_THEME=normal|studio|a picks the theme.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { gate, core, launch, testsAndTypes } from "./gate-kit.mjs";

const g = gate("SPEECH"), { check, finish } = g, C = await core(g);
await testsAndTypes(g, ["core/ai/speakText.test.ts", "app/main/speech.test.ts"]);
if (g.fails.length) await finish();

const wav = () => { // 0.2 s of a 440 Hz tone, 24 kHz mono 16-bit
  const n = 4800, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0, "latin1"); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8, "latin1"); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36, "latin1"); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / 24000) * 2 * Math.PI * 440) * 6000), 44 + i * 2);
  return b;
};
const EN = "Raise the **Cutoff** a little. It opens the sound up, as on C4.", EN_SPOKEN = "Raise the Cutoff a little. It opens the sound up, as on C 4.";
const PT = "Aumente o **corte**: ação e coração em INT-A 000.", PT_SPOKEN = "Aumente o corte: ação e coração em Interno A 0.";
const speech = [], chats = [], sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRANSLATE_PT = "Translate to Brazilian Portuguese; keep parameter names, bank names, numbers and note names exactly; output only the translation";
let mode = "ok", aborted = 0, translateFail = false;
const fake = http.createServer((q, r) => {
  const c = []; q.on("data", (d) => c.push(d));
  q.on("end", () => {
    const body = JSON.parse(Buffer.concat(c).toString("utf8"));
    if (q.url === "/v1/chat/completions") {
      chats.push(body);
      const sys = body.messages[0].content, user = body.messages.find((m) => m.role === "user")?.content ?? "";
      if (sys === TRANSLATE_PT) {
        if (translateFail) { r.writeHead(500, { "content-type": "application/json" }); r.end('{"error":"down"}'); return; }
        r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: PT } }] })); return;
      }
      const pt = /Brazilian Portuguese/.test(sys) && !user.includes("ENGLISH-REPLY");
      const name = /Open sound:[^"]*"([^"]*)"/.exec(user)?.[1] ?? "";
      const content = user.includes("NAME-OPENER") ? `For "${name}," ${EN}` : pt ? PT : EN;
      r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] })); return;
    }
    assert.equal(q.url, "/v1/audio/speech"); speech.push({ body, type: q.headers["content-type"] });
    if (mode === "400") { r.writeHead(400, { "content-type": "application/json" }); r.end('{"detail":"no such voice"}'); return; }
    const send = () => { if (r.destroyed) return; r.writeHead(200, { "content-type": "audio/wav" }); r.end(wav()); };
    r.on("close", () => { if (!r.writableFinished) aborted++; });
    if (mode === "slow") setTimeout(send, 1500); else send();
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${fake.address().port}`;

const ui = await launch(g, C, { AUTOROUTER_KEY: "gate-key" }), { win, X, seen, text, until, openBank, openFile, connectSim } = ui;
const hash = (a) => createHash("sha256").update(JSON.stringify(a)).digest("hex").slice(0, 12);
const snap = async () => ({
  undo: await X("undo").isDisabled(), counts: await win.evaluate(() => window.__kronosE2E.liveCounts()), midi: await win.evaluate(() => window.__kronosE2E.midiLog().length),
  buffers: hash(await win.evaluate(() => [0, 1, 2, 3, 4, 5].map((o) => window.__kronosE2E.editBuffer(o)))),
});
const settle = async () => { let last = -1, quiet = 0; for (let n = 0; n < 60 && quiet < 4; n++) { const m = await win.evaluate(() => window.__kronosE2E.midiLog().length); quiet = m === last ? quiet + 1 : 0; last = m; await sleep(200); } };
const state = () => X("ai-speak").getAttribute("data-state");
// Right after a click the button may still read idle (the click is handled asynchronously), so wait until it has left idle before waiting for the end; otherwise the next click lands mid-playback and acts as Stop.
// The checkbox follows the saved setting, which comes back from the main process a moment after the click, so check()/uncheck() (which verify the state at once) cannot be used; the tests wait for the stored value instead.
const played = async () => { const t0 = Date.now(); await until(async () => (await state()) !== "idle" || Date.now() - t0 > 1500, "playback started", 8000); await until(async () => (await state()) === "idle", "finished playing", 8000); };
const ask = async (q) => { await X("ask-text").fill(q); await X("ask-go").click(); await until(async () => !(await X("ai-speak").isDisabled()), "the answer is finished"); };
const setSpeech = (patch) => win.evaluate((p) => window.kronos.settingsSet(p), patch);

await openFile(); await connectSim(); await openBank("program:INT-A"); await X("row-0").click(); await settle();
const before = await snap();
await setSpeech({ speechUrl: BASE, aiBaseUrl: `${BASE}/v1` });

await check("Settings has the Speech server URL (default this computer), and refuses an outside address", async () => {
  assert.equal((await win.evaluate(() => window.kronos.settingsGet())).speechLang, "en");
  await X("settings-open").click(); await seen("settings-dialog"); assert.equal(await X("settings-speech-url").inputValue(), BASE);
  await X("settings-speech-url").fill("http://example.com:8081"); await X("settings-speech-url").blur();
  await until(async () => (await X("settings-speech-url").inputValue()) === BASE, "the outside address is refused");
  await X("settings-speech-url").fill(BASE); await X("settings-speech-url").blur(); await X("settings-close").click(); await X("settings-dialog").waitFor({ state: "hidden" });
});
await check("Settings has Star on GitHub and Buy me a coffee buttons, and the app opens no other address", async () => {
  await X("settings-open").click(); await seen("settings-dialog");
  await X("settings-star").waitFor({ state: "visible" }); await X("settings-coffee").waitFor({ state: "visible" });
  assert.equal(await win.evaluate(() => window.kronos.openLink("https://example.com")), false);
  await X("settings-close").click(); await X("settings-dialog").waitFor({ state: "hidden" });
});

await X("ai-open").click(); await seen("ai-speech"); await X("ai-provider").selectOption("local");
await check("the controls are there, auto-speak is off, and Speak is off until an answer exists", async () => {
  assert.equal(await X("ai-speech-lang").inputValue(), "en"); assert.equal(await X("ai-speech-voice").inputValue(), "af_heart"); assert.equal(await X("ai-length").inputValue(), "normal");
  assert.equal(await X("ai-speech-auto").isChecked(), false); assert.equal(await X("ai-speak").isDisabled(), true);
  assert.equal(await X("ai-speech-speed").getAttribute("min"), "0.8"); assert.equal(await X("ai-speech-speed").getAttribute("max"), "1.2");
});

await check("an English answer is spoken on click: Kokoro, af_heart, lang_code a, the text without markdown", async () => {
  await ask("What does the cutoff do?");
  assert.match(await text("ai-note"), /Raise the Cutoff a little/); assert.equal(speech.length, 0, "nothing is spoken by itself");
  const sys = chats[0].messages[0].content; assert.match(sys, /plain musical words/); assert.doesNotMatch(sys, /Portuguese/); assert.doesNotMatch(sys, /at most 2 short sentences \(about 35/);
  await X("ai-speak").click(); await until(async () => speech.length === 1, "one speech request");
  const s = speech[0]; assert.match(s.body.model, /Kokoro/); assert.equal(s.body.voice, "af_heart"); assert.equal(s.body.lang_code, "a"); assert.equal(s.body.response_format, "wav"); assert.equal(s.body.input, EN_SPOKEN); assert.match(s.type, /charset=utf-8/i);
  await until(async () => (await state()) === "speaking" || (await state()) === "idle", "playing"); await until(async () => (await state()) === "idle", "finished playing", 8000);
});

await check("Portuguese: voice pf_dora, lang_code p, and the next Ask carries the Portuguese line and the Very brief line", async () => {
  await X("ai-speech-lang").selectOption("pt"); await until(async () => (await X("ai-speech-voice").inputValue()) === "pf_dora", "voice follows the language");
  assert.deepEqual(await X("ai-speech-voice").locator("option").allTextContents(), ["Dora", "Alex", "Santa"]);
  await X("ai-length").selectOption("brief"); await until(async () => (await win.evaluate(() => window.kronos.settingsGet())).aiLength === "brief", "length stored");
  await ask("O que faz o corte?");
  const sys = chats.at(-1).messages[0].content; assert.match(sys, /Answer in Brazilian Portuguese\. Keep parameter names, bank names, numbers and note names \(C4, INT-A 000\)/); assert.match(sys, /at most 2 short sentences \(about 35 words\)/);
  assert.match(await text("ai-note"), /Aumente o corte/);
  await X("ai-speak").click(); await until(async () => speech.length === 2, "second request");
  const s = speech[1]; assert.equal(s.body.voice, "pf_dora"); assert.equal(s.body.lang_code, "p"); assert.equal(s.body.input, PT_SPOKEN);
  await played();
  await X("ai-speech-voice").selectOption("pm_alex"); await X("ai-speak").click(); await until(async () => speech.length === 3, "third request"); assert.equal(speech[2].body.voice, "pm_alex");
  await played();
});

await check("the speed setting reaches the server, clamped to 0.8 to 1.2", async () => {
  await X("ai-speech-speed").fill("1.2"); await until(async () => (await win.evaluate(() => window.kronos.settingsGet())).speechSpeed === 1.2, "speed stored"); await X("ai-speak").click(); await until(async () => speech.length === 4, "request"); assert.equal(speech[3].body.speed, 1.2);
  await played();
  assert.equal((await setSpeech({ speechSpeed: 9 })).speechSpeed, 1.2); await X("ai-speech-speed").fill("1");
});

await check("Stop cancels the request in flight and no further request follows", async () => {
  mode = "slow"; const n = speech.length, a = aborted;
  await X("ai-speak").click(); await until(async () => speech.length === n + 1, "request sent"); await until(async () => (await state()) === "loading", "loading");
  assert.equal(await X("ai-speak").getAttribute("aria-label"), "Stop speaking"); await X("ai-speak").click();
  await until(async () => (await state()) === "idle", "stopped"); await until(async () => aborted === a + 1, "the server saw the connection close"); await sleep(1800);
  assert.equal(speech.length, n + 1); assert.equal(await state(), "idle"); assert.equal(await X("ai-speak").getAttribute("aria-label"), "Speak answer"); mode = "ok";
});

await check("a server error shows the error state with the reason", async () => {
  mode = "400"; await X("ai-speak").click(); await until(async () => (await state()) === "error", "error state");
  assert.match(await text("ai-speech-error"), /no such voice/); assert.match((await X("ai-speak").getAttribute("title")) ?? "", /no such voice/); mode = "ok";
});

await check("an unreachable server shows the Mac-asleep hint", async () => {
  await setSpeech({ speechUrl: "http://127.0.0.1:1" }); await X("ai-speak").click(); await until(async () => (await state()) === "error", "error state");
  assert.equal(await text("ai-speech-error"), "The speech server is not reachable (is it running, or is that computer asleep?)"); assert.equal(await X("ai-speak").getAttribute("title"), "The speech server is not reachable (is it running, or is that computer asleep?)");
  await setSpeech({ speechUrl: BASE });
});

await check("auto-speak speaks the finished answer once, and a new run stops speech", async () => {
  await X("ai-speech-voice").selectOption("pf_dora"); await X("ai-speech-auto").click(); await until(async () => (await win.evaluate(() => window.kronos.settingsGet())).speechAuto === true, "auto stored");
  const n = speech.length; mode = "slow";
  await X("ask-text").fill("Mais uma vez"); await X("ask-go").click();
  await until(async () => speech.length === n + 1, "spoken after the answer"); assert.equal(speech[n].body.input, PT_SPOKEN);
  await until(async () => (await state()) === "loading", "loading");
  await X("ask-text").fill("E agora?"); await X("ask-go").click(); await until(async () => (await state()) !== "loading", "the new run stops the speech", 3000); mode = "ok";
  await until(async () => speech.length === n + 2, "the new answer is spoken"); await sleep(400); assert.equal(speech.length, n + 2, "each answer is spoken once");
  await X("ai-speech-auto").click(); await until(async () => !(await win.evaluate(() => window.kronos.settingsGet())).speechAuto, "auto off");
});

await check("pt Ask answered in English: one translate call, the voice reads the Portuguese, the screen shows it too", async () => {
  const c = chats.length, n = speech.length;
  await ask("ENGLISH-REPLY o que faz o corte?");
  assert.equal(chats.length, c + 1, "the Ask itself is one chat call"); assert.match(await text("ai-note"), /Raise the Cutoff a little/);
  await X("ai-speak").click(); await until(async () => speech.length === n + 1, "one speech request");
  assert.equal(chats.length, c + 2, "exactly one extra chat call"); assert.equal(chats.at(-1).messages[0].content, TRANSLATE_PT); assert.equal(chats.at(-1).messages.length, 2); assert.equal(chats.at(-1).tools, undefined);
  assert.equal(speech[n].body.input, PT_SPOKEN); assert.equal(speech[n].body.lang_code, "p");
  await until(async () => /Aumente o corte/.test(await text("ai-note")), "the translation is shown"); assert.match(await text("ai-note"), /\(traduzido\)/);
  await played(); await sleep(400); assert.equal(chats.length, c + 2); assert.equal(speech.length, n + 1);
});

await check("pt Ask answered in English with the translator down: error state, tooltip, nothing spoken", async () => {
  const n = speech.length; translateFail = true;
  await ask("ENGLISH-REPLY outra vez"); await X("ai-speak").click(); await until(async () => (await state()) === "error", "error state");
  const msg = "A resposta está em inglês e não foi possível traduzir (IA indisponível)";
  assert.equal(await text("ai-speech-error"), msg); assert.equal(await X("ai-speak").getAttribute("title"), msg); assert.match(await text("ai-note"), /Raise the Cutoff a little/); assert.equal(speech.length, n); translateFail = false;
});

await check("en mode with an English answer makes no extra chat call; a sound-name opener is not spoken", async () => {
  await X("ai-speech-lang").selectOption("en"); await until(async () => (await X("ai-speech-voice").inputValue()) === "af_heart", "voice follows the language");
  const c = chats.length, n = speech.length;
  await ask("What does the cutoff do?"); await X("ai-speak").click(); await until(async () => speech.length === n + 1, "request");
  assert.equal(chats.length, c + 1, "no translate call"); assert.equal(speech[n].body.input, EN_SPOKEN); await played();
  await ask("NAME-OPENER what does the cutoff do?"); assert.match(await text("ai-note"), /^For "/);
  await X("ai-speak").click(); await until(async () => speech.length === n + 2, "request");
  assert.equal(chats.length, c + 2); assert.equal(speech[n + 1].body.input, EN_SPOKEN, "the opening sound name is not read"); await played();
});

await check("speech changed no sound data: undo, edit buffers and MIDI are as before", async () => { await settle(); assert.deepEqual(await snap(), before); });
await ui.noErrors();
fake.close();
await finish();
