// Gate for the speech providers and the secrets store. FULLY OFFLINE: one fake server on 127.0.0.1 plays an OpenAI-style speech server (/v1/audio/speech), ElevenLabs (/v1/text-to-speech/{id}, /v2/voices;
// the app reaches it through KRONOS_E2E_ELEVENLABS_URL, which only a KRONOS_E2E=1 launch honours) and the local model router (/v1/chat/completions). No real ElevenLabs call is made.
// KRONOS_GATE_THEME=normal|studio|a picks the theme.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { gate, core, launch, testsAndTypes } from "./gate-kit.mjs";

const g = gate("SPEECH2"), { check, finish } = g, C = await core(g);
await testsAndTypes(g, ["app/main/speech.test.ts", "app/main/secrets.test.ts"]);
if (g.fails.length) await finish();

const wav = () => { // 0.2 s of a 440 Hz tone, 24 kHz mono 16-bit
  const n = 4800, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0, "latin1"); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8, "latin1"); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36, "latin1"); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / 24000) * 2 * Math.PI * 440) * 6000), 44 + i * 2);
  return b;
};
// 40 MPEG-1 Layer III frames of silence (128 kbps, 44.1 kHz, stereo, no padding: 417 bytes each), about 1 s: a real MP3 that Web Audio decodes.
const mp3 = () => Buffer.concat(Array.from({ length: 40 }, () => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])));
const EN = "Raise the **Cutoff** a little. It opens the sound up, as on C4.", EN_SPOKEN = "Raise the Cutoff a little. It opens the sound up, as on C 4.";
const KEY = "sk_gate_0123456789abcdefABCDEF", SKEY = "server-key-9876543210";
const VOICES = [{ voice_id: "VoiceAAA11111", name: "Aria" }, { voice_id: "VoiceBBB22222", name: "Roger" }];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = [], tts = [], vreq = [];
let mode = "ok";
const fake = http.createServer((q, r) => {
  const c = []; q.on("data", (d) => c.push(d));
  q.on("end", () => {
    const raw = Buffer.concat(c).toString("utf8"), body = raw ? JSON.parse(raw) : null, json = (code, o) => { r.writeHead(code, { "content-type": "application/json" }); r.end(JSON.stringify(o)); };
    if (q.url === "/v1/chat/completions") return json(200, { choices: [{ message: { role: "assistant", content: EN } }] });
    if (q.url === "/v1/audio/speech") { srv.push({ body, auth: q.headers.authorization }); r.writeHead(200, { "content-type": "audio/wav" }); return r.end(wav()); }
    if (q.url.startsWith("/v2/voices")) { vreq.push({ url: q.url, key: q.headers["xi-api-key"] }); return mode === "401" ? json(401, { detail: { status: "invalid_api_key", message: `bad ${q.headers["xi-api-key"]}` } }) : json(200, { voices: VOICES, has_more: false }); }
    if (q.url.startsWith("/v1/text-to-speech/")) {
      tts.push({ url: q.url, key: q.headers["xi-api-key"], body });
      if (mode === "401") return json(401, { detail: { status: "invalid_api_key", message: "no" } });
      if (mode === "quota") return json(429, { detail: { status: "quota_exceeded", message: "out of characters" } });
      if (mode === "500") return json(500, { detail: { status: "boom", message: `internal ${q.headers["xi-api-key"]} error` } });
      if (mode === "junk") { r.writeHead(200, { "content-type": "audio/mpeg" }); return r.end(Buffer.alloc(300)); }
      r.writeHead(200, { "content-type": "audio/mpeg" }); return r.end(mp3());
    }
    r.writeHead(404); r.end();
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${fake.address().port}`;

const ui = await launch(g, C, { AUTOROUTER_KEY: "gate-key", KRONOS_E2E_ELEVENLABS_URL: BASE }), { win, X, seen, text, until, openBank, openFile, connectSim } = ui;
// Like a change made in the AI window: the saved result is announced to every open part of the app.
const setS = (patch) => win.evaluate(async (p) => { const r = await window.kronos.settingsSet(p); window.dispatchEvent(new CustomEvent("kronos-settings", { detail: r })); return r; }, patch);
const getS = () => win.evaluate(() => window.kronos.settingsGet());
const openSettings = async () => { await X("settings-open").click(); await seen("settings-dialog"); await seen("speech-section"); };
const closeSettings = async () => { await X("settings-close").click(); await X("settings-dialog").waitFor({ state: "hidden" }); };
const fillBlur = async (id, v) => { await X(id).fill(v); await X(id).blur(); };
const testVoice = async (re, what) => { await X("speech-test").click(); await until(async () => re.test(await text("speech-test-result")), what); };
await setS({ speechUrl: BASE, aiBaseUrl: `${BASE}/v1`, aiProvider: "local" });

await check("a configured server address keeps speaking through the server: provider auto, Kokoro model, no custom voice", async () => {
  const s = await getS();
  assert.deepEqual([s.speechProvider, s.speechModel, s.speechCustomVoice, s.elevenModel, s.elevenVoice], ["auto", "mlx-community/Kokoro-82M-bf16", "", "eleven_multilingual_v2", ""]);
  await openSettings(); assert.equal(await X("settings-speech-provider-auto").isChecked(), true); await until(async () => /your server at 127.0.0.1/.test(await text("settings-speech-current")), "the explainer names the server"); assert.equal(await X("settings-speech-model").inputValue(), "mlx-community/Kokoro-82M-bf16");
  assert.equal(await X("settings-speech-url").inputValue(), BASE); assert.equal(await X("speech-card-elevenlabs").locator("input[type=password]").count(), 0, "the ElevenLabs fields stay hidden");
  await closeSettings();
});

await check("my own server: custom model, custom voice and a bearer key reach the server, and Test voice says so", async () => {
  await openSettings();
  await fillBlur("settings-speech-model", "tts-1");
  // A save that finishes while the user is typing in another box refreshes Settings: the half-typed text must survive it (this reset used to wipe the box and then save an empty voice).
  await X("settings-speech-custom-voice").fill("my-voice"); await win.evaluate(() => window.dispatchEvent(new CustomEvent("kronos-open-ai-connection"))); await sleep(300);
  assert.equal(await X("settings-speech-custom-voice").inputValue(), "my-voice", "a settings refresh must not wipe a box that has focus"); await X("settings-speech-custom-voice").blur();
  assert.equal(await X("speech-key-server-input").getAttribute("type"), "password");
  await X("speech-key-server-input").fill(SKEY); await X("speech-key-server-save").click(); await until(async () => /Key saved/.test(await text("speech-key-server-status")), "server key saved");
  assert.equal(await X("speech-key-server-input").inputValue(), "", "the key box is emptied after saving");
  await until(async () => (await getS()).speechCustomVoice === "my-voice", "the entries are saved (a field saves when it loses focus, through the main process)");
  const s = await getS(); assert.equal(s.speechModel, "tts-1"); assert.equal(s.speechCustomVoice, "my-voice");
  await testVoice(/It works/, "test voice works");
  const q = srv.at(-1); assert.equal(q.auth, `Bearer ${SKEY}`); assert.equal(q.body.model, "tts-1"); assert.equal(q.body.voice, "my-voice"); assert.equal(q.body.response_format, "wav"); assert.equal(q.body.lang_code, undefined); assert.match(q.body.input, /^Hello\./);
  await X("speech-key-server-clear").click(); await until(async () => /No key saved/.test(await text("speech-key-server-status")), "server key cleared");
  await closeSettings();
});

await check("the window cannot read a key: only set, clear and has exist, and bad names are refused", async () => {
  assert.deepEqual((await win.evaluate(() => Object.keys(window.kronos).filter((k) => /secret|key|token/i.test(k)))).sort(), ["secretsClear", "secretsHas", "secretsSet"]);
  assert.equal(await win.evaluate(() => window.kronos.secretsHas("speech-server")), false);
  assert.equal((await win.evaluate(() => window.kronos.secretsSet("other", "abcdefgh12345"))).ok, false); assert.equal(await win.evaluate(() => window.kronos.secretsHas("other")), false);
  assert.equal((await win.evaluate(() => window.kronos.secretsSet("elevenlabs", "has a space 1234"))).ok, false);
  const s = await getS(); assert.ok(!Object.keys(s).some((k) => /key|secret|token/i.test(k)), "settings hold no key field");
});

await check("ElevenLabs without a key or a voice: friendly messages, nothing sent", async () => {
  await openSettings(); await X("settings-speech-provider-elevenlabs").click(); await seen("speech-key-elevenlabs-input");
  assert.equal((await getS()).speechProvider, "elevenlabs"); assert.match(await text("speech-key-elevenlabs-status"), /No key saved/);
  assert.match(await text("speech-eleven-privacy"), /text of the answer is sent to ElevenLabs when you press Speak/); assert.match(await text("speech-eleven-privacy"), /counts against your ElevenLabs plan/);
  await X("settings-eleven-load").click(); await until(async () => /Add your ElevenLabs API key/.test(await text("settings-eleven-load-result")), "no-key text");
  assert.equal(vreq.length, 0, "no request without a key");
  await testVoice(/Pick an ElevenLabs voice/, "no-voice text"); assert.equal(tts.length, 0);
  await closeSettings();
});

await check("ElevenLabs: the key link opens only the allow-listed page", async () => {
  assert.equal(await win.evaluate(() => window.kronos.openLink("https://elevenlabs.io/app/settings/api-keys.evil")), false);
  assert.equal(await win.evaluate(() => window.kronos.openLink("https://elevenlabs.io")), false);
});

await check("ElevenLabs: the key is saved write-only, Load my voices fills the list, the voice and model are stored", async () => {
  await openSettings();
  await X("speech-key-elevenlabs-input").fill(KEY); await X("speech-key-elevenlabs-save").click(); await until(async () => /Key saved/.test(await text("speech-key-elevenlabs-status")), "key saved");
  assert.equal(await X("speech-key-elevenlabs-input").inputValue(), ""); assert.equal(await win.evaluate(() => window.kronos.secretsHas("elevenlabs")), true);
  assert.ok(!(await win.evaluate(() => document.documentElement.innerHTML)).includes(KEY), "the key is nowhere in the page");
  await X("settings-eleven-load").click(); await until(async () => /2 voices loaded/.test(await text("settings-eleven-load-result")), "voices loaded");
  assert.deepEqual(vreq.at(-1), { url: "/v2/voices?page_size=100", key: KEY });
  assert.deepEqual(await X("settings-eleven-voice-select").locator("option").allTextContents(), ["Choose a voice", "Aria", "Roger"]);
  await X("settings-eleven-voice-select").selectOption("VoiceAAA11111"); await until(async () => (await getS()).elevenVoice === "VoiceAAA11111", "voice stored");
  assert.equal(await X("settings-eleven-voice").inputValue(), "VoiceAAA11111");
  assert.deepEqual(await X("settings-eleven-model").locator("option").evaluateAll((o) => o.map((x) => x.value)), ["eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_turbo_v2_5"]);
  await closeSettings();
});

await check("ElevenLabs Test voice: path, xi-api-key, model_id, MP3 decodes and plays; Flash adds language_code", async () => {
  await openSettings();
  await testVoice(/It works/, "test voice works");
  let q = tts.at(-1); assert.equal(q.url, "/v1/text-to-speech/VoiceAAA11111?output_format=mp3_44100_128"); assert.equal(q.key, KEY); assert.equal(q.body.model_id, "eleven_multilingual_v2");
  assert.equal(q.body.language_code, undefined); assert.equal(q.body.voice_settings, undefined, "normal speed sends no voice settings"); assert.match(q.body.text, /^Hello\./);
  await until(async () => (await X("speech-test").isEnabled()), "playback ended", 8000);
  await X("settings-eleven-model").selectOption("eleven_flash_v2_5"); await until(async () => (await getS()).elevenModel === "eleven_flash_v2_5", "model stored");
  await X("settings-speech-speed").fill("1.2"); await until(async () => (await getS()).speechSpeed === 1.2, "speed stored");
  await setS({ speechLang: "pt" }); await testVoice(/It works/, "pt works");
  q = tts.at(-1); assert.equal(q.body.model_id, "eleven_flash_v2_5"); assert.equal(q.body.language_code, "pt"); assert.deepEqual(q.body.voice_settings, { speed: 1.2 }); assert.match(q.body.text, /^Olá\./);
  await until(async () => (await X("speech-test").isEnabled()), "playback ended", 8000);
  await X("settings-speech-speed").fill("1"); await setS({ speechLang: "en", speechSpeed: 1 });
  await closeSettings();
});

await check("ElevenLabs errors show friendly text and never the key", async () => {
  await openSettings();
  for (const [m, re] of [["401", /did not accept the API key/], ["quota", /^ElevenLabs quota used up: check your plan$/], ["500", /HTTP 500/], ["junk", /did not return an MP3 file/]]) {
    mode = m; await testVoice(re, `${m} text`); assert.ok(!(await text("speech-test-result")).includes(KEY), `${m} leaks the key`); assert.equal(await X("speech-test-result").getAttribute("data-ok"), "false");
    await until(async () => await X("speech-test").isEnabled(), "button ready");
  }
  mode = "401"; await X("settings-eleven-load").click(); await until(async () => /did not accept the API key/.test(await text("settings-eleven-load-result")), "401 on voices"); assert.ok(!(await text("settings-eleven-load-result")).includes(KEY));
  mode = "ok"; await closeSettings();
});

await check("the AI window follows the provider: ElevenLabs voices in the select, an answer is spoken through ElevenLabs", async () => {
  await openFile(); await connectSim(); await openBank("program:INT-A"); await X("row-0").click();
  await X("ai-open").click(); await seen("ai-speech"); await X("ai-provider").selectOption("local");
  await until(async () => (await X("ai-speech-voice").locator("option").allTextContents()).join() === "Aria,Roger", "the user's voices are listed");
  assert.equal(await X("ai-speech-voice").inputValue(), "VoiceAAA11111");
  await X("ai-speech-voice").selectOption("VoiceBBB22222"); await until(async () => (await getS()).elevenVoice === "VoiceBBB22222", "voice stored");
  await X("ask-text").fill("What does the cutoff do?"); await X("ask-go").click(); await until(async () => !(await X("ai-speak").isDisabled()), "the answer is finished");
  const n = tts.length; await X("ai-speak").click(); await until(async () => tts.length === n + 1, "one ElevenLabs request");
  const q = tts.at(-1); assert.equal(q.url, "/v1/text-to-speech/VoiceBBB22222?output_format=mp3_44100_128"); assert.equal(q.body.text, EN_SPOKEN); assert.equal(q.key, KEY);
  // Right after a click the button may still read idle, so wait until it has left idle before waiting for the end; otherwise the next click lands mid-playback and acts as Stop.
  await until(async () => (await X("ai-speak").getAttribute("data-state")) !== "idle", "playback started", 8000); await until(async () => (await X("ai-speak").getAttribute("data-state")) === "idle", "finished playing", 8000);
  mode = "quota"; await X("ai-speak").click(); await until(async () => (await X("ai-speak").getAttribute("data-state")) === "error", "error state");
  assert.equal(await text("ai-speech-error"), "ElevenLabs quota used up: check your plan"); mode = "ok";
  await setS({ speechProvider: "server" }); await until(async () => (await X("ai-speech-voice").isDisabled()), "a custom server voice locks the select");
  assert.equal(await X("ai-speech-voice").inputValue(), "my-voice");
  await setS({ speechCustomVoice: "" }); await until(async () => (await X("ai-speech-voice").inputValue()) === "af_heart", "the Kokoro list is back");
  const n2 = srv.length; await X("ai-speak").click(); await until(async () => srv.length === n2 + 1, "one server request"); assert.equal(srv.at(-1).body.voice, "af_heart"); assert.equal(srv.at(-1).body.lang_code, "a"); assert.equal(srv.at(-1).auth, undefined);
});

await check("secrets.bin holds the key encrypted; no other file under the user-data folder holds it", async () => {
  const dir = path.join(ui.tmp, "appdata"), files = [], walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk(dir);
  const bin = files.filter((f) => path.basename(f) === "secrets.bin"); assert.equal(bin.length, 1, "one secrets.bin");
  const needles = [KEY, SKEY].flatMap((k) => [Buffer.from(k), Buffer.from(k, "utf16le"), Buffer.from(Buffer.from(k).toString("base64"))]);
  let unreadable = 0;
  for (const f of files) {
    let b; try { b = readFileSync(f); } catch { unreadable++; continue; }
    for (const n of needles) assert.ok(!b.includes(n), `${path.relative(dir, f)} holds a key in plain form`);
  }
  const sec = JSON.parse(readFileSync(bin[0], "utf8")); assert.deepEqual(Object.keys(sec), ["elevenlabs"], "the cleared server key is gone, the ElevenLabs key is stored");
  assert.ok(statSync(bin[0]).size > 40); const st = JSON.parse(readFileSync(files.find((f) => path.basename(f) === "settings.json"), "utf8")); assert.ok(!JSON.stringify(st).includes(KEY));
  return `${files.length} files scanned, ${unreadable} locked`;
});

await check("Clear removes the ElevenLabs key: has is false and Speak reports no key", async () => {
  await setS({ speechProvider: "elevenlabs" }); await openSettings(); await X("speech-key-elevenlabs-clear").click(); await until(async () => /No key saved/.test(await text("speech-key-elevenlabs-status")), "cleared");
  assert.equal(await win.evaluate(() => window.kronos.secretsHas("elevenlabs")), false); const n = tts.length;
  await testVoice(/Add your ElevenLabs API key/, "no-key text"); assert.equal(tts.length, n); await closeSettings();
});

await ui.noErrors();
fake.close();
await finish();
