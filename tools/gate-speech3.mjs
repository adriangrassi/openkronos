// Gate for the computer's own voices (speechProvider "auto" / "system"). FULLY OFFLINE: one fake server on 127.0.0.1 plays the local model router (/v1/chat/completions) and a second one plays a speech server
// that must receive ZERO requests until the speech address is changed in Settings. window.speechSynthesis is replaced by recorders with a fake English and Portuguese voice list
// (a real SpeechSynthesisUtterance only accepts a real voice object, so the constructor is replaced too). KRONOS_GATE_THEME=normal|studio|a picks the theme.
import assert from "node:assert/strict";
import http from "node:http";
import { gate, core, launch, testsAndTypes } from "./gate-kit.mjs";

const g = gate("SPEECH3"), { check, finish } = g, C = await core(g);
await testsAndTypes(g, ["core/speechVoice.test.ts", "core/settings.test.ts", "core/ai/speakText.test.ts"]);
if (g.fails.length) await finish();

const wav = () => { const n = 2400, b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0, "latin1"); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8, "latin1"); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36, "latin1"); b.writeUInt32LE(n * 2, 40); return b; };
const EN = "Raise the **Cutoff** a little. It opens the sound up, as on C4.", EN_SPOKEN = "Raise the Cutoff a little. It opens the sound up, as on C 4.";
const PT = "Aumente o **corte**: ação e coração em INT-A 000.", PT_SPOKEN = "Aumente o corte: ação e coração em Interno A 0.";
const LONG = Array.from({ length: 14 }, (_, i) => `This is sentence number ${i + 1}, and it keeps going a little so that the answer is long.`).join(" ");
const TRANSLATE_PT = "Translate to Brazilian Portuguese; keep parameter names, bank names, numbers and note names exactly; output only the translation";
const chats = [], speechReqs = [];
const listen = (handler) => new Promise((res) => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => res(s)); });
const chat = await listen((q, r) => {
  const c = []; q.on("data", (d) => c.push(d));
  q.on("end", () => {
    const body = JSON.parse(Buffer.concat(c).toString("utf8")); chats.push(body);
    const sys = body.messages[0].content, user = body.messages.find((m) => m.role === "user")?.content ?? "";
    const pt = sys === TRANSLATE_PT || (/Brazilian Portuguese/.test(sys) && !user.includes("ENGLISH-REPLY"));
    const content = pt ? PT : user.includes("LONG-REPLY") ? LONG : EN;
    r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
});
const speechServer = await listen((q, r) => { speechReqs.push(q.url); q.resume(); q.on("end", () => { r.writeHead(200, { "content-type": "audio/wav" }); r.end(wav()); }); });
const CHAT = `http://127.0.0.1:${chat.address().port}/v1`, SPEECH = `http://127.0.0.1:${speechServer.address().port}`;

const ui = await launch(g, C, { AUTOROUTER_KEY: "gate-key" }), { win, X, seen, text, until, openBank, openFile, connectSim } = ui;
const state = () => X("ai-speak").getAttribute("data-state");
const getS = () => win.evaluate(() => window.kronos.settingsGet());
// Like a change made in the AI window: the saved result is announced to every open part of the app.
const setS = (patch) => win.evaluate(async (p) => { const r = await window.kronos.settingsSet(p); window.dispatchEvent(new CustomEvent("kronos-settings", { detail: r })); return r; }, patch);
const ask = async (q) => { await X("ask-text").fill(q); await X("ask-go").click(); await until(async () => !(await X("ai-speak").isDisabled()), "the answer is finished"); };
const spoken = () => win.evaluate(() => window.__spk.spoken.map((u) => ({ ...u })));
const cancels = () => win.evaluate(() => window.__spk.cancels);
const fakeVoices = (list) => win.evaluate((l) => { window.__spk.voices = l; window.speechSynthesis.dispatchEvent(new Event("voiceschanged")); }, list);
const VOICES = [
  { name: "Fake Online Natural", lang: "en-US", localService: false }, { name: "Fake Hazel", lang: "en-GB", localService: true }, { name: "Fake Zira", lang: "en-US", localService: true, default: true },
  { name: "Fake Helia", lang: "pt-PT", localService: true }, { name: "Fake Maria", lang: "pt-BR", localService: true }, { name: "Fake Hortense", lang: "fr-FR", localService: true },
];
const install = () => win.evaluate((voices) => {
  const spk = { spoken: [], cancels: 0, hold: false, voices };
  window.__spk = spk;
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.rate = 1; this.pitch = 1; this.volume = 1; } };
  const s = window.speechSynthesis;
  s.getVoices = () => spk.voices;
  s.cancel = () => { spk.cancels++; };
  s.speak = (u) => { spk.spoken.push({ text: u.text, voice: u.voice?.name ?? null, lang: u.lang, rate: u.rate }); setTimeout(() => u.onstart?.({}), 5); if (!spk.hold) setTimeout(() => u.onend?.({}), 25); };
}, VOICES);

await openFile(); await connectSim(); await openBank("program:INT-A"); await X("row-0").click();
await install();
await setS({ aiBaseUrl: CHAT });

await check("nothing set up: the provider is auto, and Settings says this computer's voices are in use", async () => {
  const s = await getS();
  assert.deepEqual([s.speechProvider, s.speechUrl, s.speechSystemVoiceEn, s.speechSystemVoicePt], ["auto", "http://localhost:8081", "", ""]);
  await X("settings-open").click(); await seen("settings-dialog"); await seen("speech-section");
  assert.equal(await X("settings-speech-provider-auto").isChecked(), true);
  assert.equal(await text("settings-speech-current"), "Currently using: this computer's voices");
  assert.deepEqual(await Promise.all(["auto", "system", "server", "elevenlabs"].map((id) => X(`settings-speech-provider-${id}`).count())), [1, 1, 1, 1]);
  await until(async () => (await X("settings-speech-system-voice-en").locator("option").count()) > 1, "voices listed");
  assert.deepEqual(await X("settings-speech-system-voice-en").locator("option").allTextContents(), ["Automatic", "Fake Zira", "Fake Hazel", "Fake Online Natural (online)"]);
  assert.deepEqual(await X("settings-speech-system-voice-pt").locator("option").allTextContents(), ["Automatic", "Fake Maria", "Fake Helia"]);
  assert.equal(await X("settings-speech-url").count(), 0, "no server fields while nothing is set up");
});
await check("Test voice speaks the sample with the automatic voice, and a chosen voice is used and saved", async () => {
  await X("speech-test").click(); await until(async () => (await spoken()).length === 1, "one utterance");
  assert.deepEqual((await spoken())[0], { text: "Hello. This is how your answers will sound.", voice: "Fake Zira", lang: "en-US", rate: 1 });
  await until(async () => await X("speech-test").isEnabled(), "test finished");
  await X("settings-speech-system-voice-en").selectOption("Fake Hazel"); await until(async () => (await getS()).speechSystemVoiceEn === "Fake Hazel", "voice saved");
  await X("speech-test").click(); await until(async () => (await spoken()).length === 2, "second utterance"); assert.equal((await spoken())[1].voice, "Fake Hazel"); assert.equal((await spoken())[1].lang, "en-GB");
  await until(async () => await X("speech-test").isEnabled(), "test finished");
  await X("settings-speech-system-voice-en").selectOption(""); await until(async () => (await getS()).speechSystemVoiceEn === "", "back to automatic");
  await X("settings-close").click(); await X("settings-dialog").waitFor({ state: "hidden" });
});

await X("ai-open").click(); await seen("ai-speech"); await X("ai-provider").selectOption("local");
await check("the AI window voice list shows this computer's voices for the language", async () => {
  await until(async () => (await X("ai-speech-voice").locator("option").count()) > 1, "voices listed");
  assert.deepEqual(await X("ai-speech-voice").locator("option").allTextContents(), ["Automatic", "Fake Zira", "Fake Hazel", "Fake Online Natural"]);
});
await check("Speak: speechSynthesis.speak gets the chunked text with the matching voice and no server request is made", async () => {
  await ask("What does the cutoff do?"); const n = (await spoken()).length;
  await X("ai-speak").click(); await until(async () => (await spoken()).length === n + 1, "one utterance");
  assert.deepEqual((await spoken())[n], { text: EN_SPOKEN, voice: "Fake Zira", lang: "en-US", rate: 1 });
  await until(async () => (await state()) === "idle", "back to idle");
  await ask("LONG-REPLY please"); const m = (await spoken()).length;
  await X("ai-speak").click(); await until(async () => (await state()) === "idle" && (await spoken()).length > m + 1, "all the chunks spoken");
  const parts = (await spoken()).slice(m); assert.ok(parts.length >= 5 && parts.every((u) => u.text.length <= 200), `chunks: ${parts.map((u) => u.text.length)}`);
  assert.equal(parts.map((u) => u.text).join(" "), LONG, "in order, nothing lost");
  assert.deepEqual(speechReqs, [], "the fake server got no request");
});
await check("the speed slider becomes the utterance rate", async () => {
  await X("ai-speech-speed").fill("1.2"); await until(async () => (await getS()).speechSpeed === 1.2, "speed stored"); const n = (await spoken()).length;
  await X("ai-speak").click(); await until(async () => (await spoken()).length > n, "utterance"); assert.equal((await spoken())[n].rate, 1.2);
  await until(async () => (await state()) === "idle", "idle"); await X("ai-speech-speed").fill("1");
});
await check("Portuguese picks the pt-BR voice, a saved pt voice wins, and an English answer is translated first", async () => {
  await X("ai-speech-lang").selectOption("pt"); await until(async () => (await X("ai-speech-voice").locator("option").allTextContents()).includes("Fake Maria"), "pt voices listed");
  assert.deepEqual(await X("ai-speech-voice").locator("option").allTextContents(), ["Automatic", "Fake Maria", "Fake Helia"]);
  await ask("O que faz o corte?"); let n = (await spoken()).length;
  await X("ai-speak").click(); await until(async () => (await spoken()).length === n + 1, "utterance");
  assert.deepEqual((await spoken())[n], { text: PT_SPOKEN, voice: "Fake Maria", lang: "pt-BR", rate: 1 }); await until(async () => (await state()) === "idle", "idle");
  await X("ai-speech-voice").selectOption("Fake Helia"); await until(async () => (await getS()).speechSystemVoicePt === "Fake Helia", "pt voice saved"); n = (await spoken()).length;
  await X("ai-speak").click(); await until(async () => (await spoken()).length === n + 1, "utterance"); assert.equal((await spoken())[n].voice, "Fake Helia"); await until(async () => (await state()) === "idle", "idle");
  const c = chats.length; n = (await spoken()).length;
  await ask("ENGLISH-REPLY o que faz o corte?"); assert.match(await text("ai-note"), /Raise the Cutoff a little/);
  await X("ai-speak").click(); await until(async () => (await spoken()).length === n + 1, "utterance");
  assert.equal(chats.length, c + 2, "the Ask and one translate call"); assert.equal(chats.at(-1).messages[0].content, TRANSLATE_PT); assert.equal((await spoken())[n].text, PT_SPOKEN);
  await until(async () => (await state()) === "idle", "idle"); await setS({ speechSystemVoicePt: "" });
});
await check("Stop cancels the speech, and a new run stops what is playing", async () => {
  await win.evaluate(() => { window.__spk.hold = true; }); let n = (await spoken()).length, c = await cancels();
  await X("ai-speak").click(); await until(async () => (await state()) === "speaking", "speaking");
  assert.equal(await X("ai-speak").getAttribute("aria-label"), "Stop speaking"); await X("ai-speak").click();
  await until(async () => (await state()) === "idle", "stopped"); assert.ok((await cancels()) > c, "cancel() was called"); assert.equal((await spoken()).length, n + 1);
  c = await cancels(); n = (await spoken()).length;
  await X("ai-speak").click(); await until(async () => (await spoken()).length === n + 1, "utterance"); await ask("Outra vez");
  assert.ok((await cancels()) > c, "a new run cancels"); await until(async () => (await state()) === "idle", "idle");
  await win.evaluate(() => { window.__spk.hold = false; });
});
await check("no voice for the language: a friendly error, never another language's voice", async () => {
  await fakeVoices(VOICES.filter((v) => !v.lang.startsWith("pt"))); const n = (await spoken()).length;
  await X("ai-speak").click(); await until(async () => (await state()) === "error", "error state");
  assert.equal(await text("ai-speech-error"), "No Portuguese voice is installed on this computer: add one in Windows Settings > Time & language > Speech, or in macOS System Settings > Accessibility > Spoken Content");
  assert.equal((await X("ai-speak").getAttribute("title")) ?? "", await text("ai-speech-error")); assert.equal((await spoken()).length, n);
  await fakeVoices([]); await X("ai-speak").click(); await until(async () => (await state()) === "error" && /no speech voices/.test(await text("ai-speech-error")), "no voices at all");
  await fakeVoices(VOICES);
});
await check("a server address in Settings switches Automatic to the server: the request arrives and speechSynthesis stays quiet", async () => {
  await X("ai-speech-lang").selectOption("en"); await until(async () => (await getS()).speechLang === "en", "en"); await ask("What does the cutoff do?");
  assert.deepEqual(speechReqs, []); await setS({ speechUrl: SPEECH }); const n = (await spoken()).length;
  await X("ai-speak").click(); await until(async () => speechReqs.length === 1, "a request reaches the server");
  assert.deepEqual(speechReqs, ["/v1/audio/speech"]); await until(async () => (await state()) === "idle", "played", 8000); assert.equal((await spoken()).length, n, "speak() was not called");
  await X("ai-close").click(); await X("settings-open").click(); await seen("settings-dialog"); await seen("speech-section");
  assert.equal(await X("settings-speech-provider-auto").isChecked(), true); assert.match(await text("settings-speech-current"), /^Currently using: your server at 127\.0\.0\.1:\d+$/);
  await X("settings-speech-provider-system").click(); await until(async () => (await getS()).speechProvider === "system", "system chosen"); await until(async () => /this computer's voices/.test(await text("settings-speech-current")), "the explainer follows the choice");
  await X("settings-close").click(); await X("settings-dialog").waitFor({ state: "hidden" });
});
await ui.noErrors();
chat.close(); speechServer.close();
await finish();
