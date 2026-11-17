import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../../core/settings.ts";
import { cancelSpeech, checkRequest, elevenBase, isMp3, listVoices, speechTarget, synthesize, type Target } from "./speech.ts";

const wav = (n = 100): Buffer => {
  const b = Buffer.alloc(44 + n);
  b.write("RIFF", 0, "latin1");
  b.write("WAVE", 8, "latin1");
  return b;
};
const mp3 = (n = 100): Buffer => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(n)]);
const serve = async (h: http.RequestListener): Promise<{ url: string; close: () => void }> => {
  const s = http.createServer(h);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => { s.closeAllConnections(); s.close(); } };
};
const req = { text: "Olá, ação.", lang: "pt", voice: "pf_dora", speed: 1 };
const srv = (baseUrl: string, more: Partial<Extract<Target, { kind: "server" }>> = {}): Target => ({ kind: "server", baseUrl, model: DEFAULT_SETTINGS.speechModel, custom: false, ...more });
const KEY = "sk_test_0123456789abcdef";
const el = (baseUrl: string, more: { model?: string; apiKey?: string } = {}): Target => ({ kind: "elevenlabs", baseUrl, model: "eleven_multilingual_v2", apiKey: KEY, ...more });
const body = (q: http.IncomingMessage, then: (b: string) => void): void => {
  const c: Buffer[] = [];
  q.on("data", (d: Buffer) => c.push(d));
  q.on("end", () => then(Buffer.concat(c).toString("utf8")));
};

test("a valid request posts Kokoro JSON as UTF-8 and returns the WAV bytes", async () => {
  let seen = "";
  let type = "";
  let auth: unknown;
  const s = await serve((q, r) => {
    type = String(q.headers["content-type"]);
    auth = q.headers.authorization;
    body(q, (b) => { seen = b; r.writeHead(200, { "content-type": "audio/wav" }); r.end(wav()); });
  });
  const r = await synthesize(req, srv(s.url));
  s.close();
  assert.ok(r.ok && r.bytes.length === 144);
  assert.match(type, /charset=utf-8/);
  assert.equal(auth, undefined);
  assert.deepEqual(JSON.parse(seen), { model: "mlx-community/Kokoro-82M-bf16", input: "Olá, ação.", voice: "pf_dora", lang_code: "p", response_format: "wav", speed: 1 });
});

test("a custom model, a custom voice and a bearer key reach the server; no Kokoro lang_code for a custom voice", async () => {
  let seen = "";
  let auth: unknown;
  const s = await serve((q, r) => { auth = q.headers.authorization; body(q, (b) => { seen = b; r.writeHead(200, { "content-type": "audio/wav" }); r.end(wav()); }); });
  const r = await synthesize({ ...req, voice: "my-voice:1" }, srv(s.url, { model: "tts-1", custom: true, apiKey: KEY }));
  s.close();
  assert.ok(r.ok);
  assert.equal(auth, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(seen), { model: "tts-1", input: "Olá, ação.", voice: "my-voice:1", response_format: "wav", speed: 1 });
});

test("a 400 JSON body, a wrong type and a non-RIFF body are bad responses", async () => {
  const modes = [
    (r: http.ServerResponse) => { r.writeHead(400, { "content-type": "application/json" }); r.end('{"detail":"no such voice"}'); },
    (r: http.ServerResponse) => { r.writeHead(200, { "content-type": "application/json" }); r.end('{"error":"x"}'); },
    (r: http.ServerResponse) => { r.writeHead(200, { "content-type": "audio/wav" }); r.end(Buffer.alloc(100)); },
  ];
  for (const [i, m] of modes.entries()) {
    const s = await serve((_q, r) => m(r));
    const r = await synthesize(req, srv(s.url));
    s.close();
    assert.ok(!r.ok && r.error.kind === "bad-response", String(i));
    if (i === 0 && !r.ok) assert.match(r.error.message, /no such voice/);
  }
});

test("a closed port is unreachable, a silent server times out, cancel stops the request", async () => {
  const dead = await serve(() => {});
  const url = dead.url;
  dead.close();
  const a = await synthesize(req, srv(url));
  assert.ok(!a.ok && a.error.kind === "unreachable");
  const slow = await serve(() => {});
  const t = await synthesize(req, srv(slow.url), 150);
  assert.ok(!t.ok && t.error.kind === "timeout");
  const p = synthesize(req, srv(slow.url));
  setTimeout(cancelSpeech, 50);
  const c = await p;
  slow.close();
  assert.ok(!c.ok && c.error.kind === "cancelled");
});

test("oversized audio is refused", async () => {
  const s = await serve((_q, r) => { r.writeHead(200, { "content-type": "audio/wav" }); r.end(wav(20_100_000)); });
  const r = await synthesize(req, srv(s.url));
  s.close();
  assert.ok(!r.ok && r.error.kind === "bad-response");
});

test("checkRequest rejects bad text, language, voice and speed, and clamps speed", () => {
  for (const bad of [null, {}, { ...req, text: "" }, { ...req, text: "x".repeat(1001) }, { ...req, lang: "fr" }, { ...req, voice: "af_heart" }, { ...req, voice: "../x" }, { ...req, speed: "1" }]) assert.throws(() => checkRequest(bad));
  assert.equal(checkRequest({ ...req, speed: 9 }).speed, 1.2);
  assert.equal(checkRequest({ text: "Hi", lang: "en", voice: "bf_emma", speed: 1 }).voice, "bf_emma");
  assert.equal(checkRequest({ ...req, voice: "af_heart" }, false).voice, "af_heart", "a custom voice may be any id");
  for (const bad of ["a/b", "a b", "", "x".repeat(65), "voice?x=1"]) assert.throws(() => checkRequest({ ...req, voice: bad }, false), bad);
});

test("ElevenLabs: path, key header, body and MP3 result", async () => {
  let seen: { url?: string; key?: unknown; type?: unknown; accept?: unknown; auth?: unknown; body?: string } = {};
  const s = await serve((q, r) => body(q, (b) => { seen = { url: q.url, key: q.headers["xi-api-key"], type: q.headers["content-type"], auth: q.headers.authorization, body: b }; r.writeHead(200, { "content-type": "audio/mpeg" }); r.end(mp3()); }));
  const flash = await synthesize({ ...req, voice: "Voice123abc", speed: 1.1 }, el(s.url, { model: "eleven_flash_v2_5" }));
  assert.ok(flash.ok && flash.bytes.length === 104);
  assert.equal(seen.url, "/v1/text-to-speech/Voice123abc?output_format=mp3_44100_128");
  assert.equal(seen.key, KEY);
  assert.equal(seen.auth, undefined);
  assert.match(String(seen.type), /application\/json/);
  assert.deepEqual(JSON.parse(seen.body ?? ""), { text: "Olá, ação.", model_id: "eleven_flash_v2_5", language_code: "pt", voice_settings: { speed: 1.1 } });
  const multi = await synthesize({ ...req, voice: "Voice123abc" }, el(s.url));
  s.close();
  assert.ok(multi.ok);
  assert.deepEqual(JSON.parse(seen.body ?? ""), { text: "Olá, ação.", model_id: "eleven_multilingual_v2" }, "no language_code for v2 and no voice_settings at normal speed");
});

test("ElevenLabs: MP3 validation accepts ID3 and frame sync, rejects the rest", async () => {
  assert.ok(isMp3(Buffer.concat([Buffer.from("ID3"), Buffer.alloc(20)])));
  assert.ok(isMp3(mp3()));
  for (const bad of [Buffer.alloc(100), Buffer.from("RIFF....WAVE"), Buffer.from([0xff, 0x00, 0, 0]), Buffer.from([0xff, 0xfb])]) assert.equal(isMp3(bad), false);
  const modes: [string, Buffer][] = [["audio/mpeg", Buffer.alloc(100)], ["audio/wav", mp3()], ["application/json", Buffer.from("{}")]];
  for (const [type, b] of modes) {
    const s = await serve((_q, r) => { r.writeHead(200, { "content-type": type }); r.end(b); });
    const r = await synthesize({ ...req, voice: "Voice123abc" }, el(s.url));
    s.close();
    assert.ok(!r.ok && r.error.kind === "bad-response", type);
  }
  const big = await serve((_q, r) => { r.writeHead(200, { "content-type": "audio/mpeg" }); r.end(mp3(20_100_000)); });
  const r = await synthesize({ ...req, voice: "Voice123abc" }, el(big.url));
  big.close();
  assert.ok(!r.ok && r.error.kind === "bad-response");
});

test("ElevenLabs: error mapping for 401, quota 401 and 429, busy 429, 422, 500, garbage, timeout, no key", async () => {
  const cases: [number, string, string, RegExp][] = [
    [401, '{"detail":{"status":"invalid_api_key","message":"Invalid API key"}}', "unauthorized", /did not accept the API key/],
    [401, '{"detail":{"status":"quota_exceeded","message":"You have insufficient quota"}}', "quota", /quota used up: check your plan/],
    [429, '{"detail":{"status":"quota_exceeded"}}', "quota", /quota used up: check your plan/],
    [429, '{"detail":{"status":"too_many_concurrent_requests"}}', "quota", /busy/],
    [422, '{"detail":[{"loc":["body"],"msg":"bad","type":"x"}]}', "bad-response", /HTTP 422/],
    [500, "<html>oops</html>", "bad-response", /HTTP 500/],
    [400, '{"detail":{"status":"voice_not_found","message":"A voice with the voice id nope was not found."}}', "bad-response", /voice id nope/],
  ];
  for (const [status, text, kind, re] of cases) {
    const s = await serve((_q, r) => { r.writeHead(status, { "content-type": "application/json" }); r.end(text); });
    const r = await synthesize({ ...req, voice: "Voice123abc" }, el(s.url));
    s.close();
    assert.ok(!r.ok && r.error.kind === kind && re.test(r.error.message), `${status} ${text}: ${JSON.stringify(r)}`);
  }
  const slow = await serve(() => {});
  const t = await synthesize({ ...req, voice: "Voice123abc" }, el(slow.url), 150);
  slow.close();
  assert.ok(!t.ok && t.error.kind === "timeout");
  const none = await synthesize({ ...req, voice: "Voice123abc" }, el("http://127.0.0.1:1", { apiKey: undefined }));
  assert.ok(!none.ok && none.error.kind === "no-key");
  const down = await synthesize({ ...req, voice: "Voice123abc" }, el("http://127.0.0.1:1"));
  assert.ok(!down.ok && down.error.kind === "unreachable");
});

test("the key never appears in an error, even when the server echoes it back", async () => {
  const echo = [`{"detail":{"status":"x","message":"bad key ${KEY} for you"}}`, `{"detail":"Invalid ${KEY}"}`];
  for (const text of echo) {
    const s = await serve((_q, r) => { r.writeHead(400, { "content-type": "application/json" }); r.end(text); });
    const a = await synthesize({ ...req, voice: "Voice123abc" }, el(s.url));
    const b = await synthesize(req, srv(s.url, { apiKey: KEY }));
    const v = await listVoices(s.url, KEY);
    s.close();
    for (const x of [a, b, v]) assert.ok(!x.ok && !JSON.stringify(x).includes(KEY), JSON.stringify(x));
  }
  const dead = await synthesize({ ...req, voice: "Voice123abc" }, el("http://127.0.0.1:1"));
  assert.ok(!dead.ok && !JSON.stringify(dead).includes(KEY));
});

test("listVoices: path, key header, parsing, and errors", async () => {
  let seen: { url?: string; key?: unknown; method?: string } = {};
  const s = await serve((q, r) => { seen = { url: q.url, key: q.headers["xi-api-key"], method: q.method }; r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ voices: [{ voice_id: "abc123XYZ", name: "Rachel" }, { voice_id: "../bad", name: "x" }, { voice_id: "def456", name: "Line\nBreak" }, { name: "no id" }], has_more: false })); });
  const r = await listVoices(s.url, KEY);
  s.close();
  assert.deepEqual(seen, { url: "/v2/voices?page_size=100", key: KEY, method: "GET" });
  assert.deepEqual(r, { ok: true, voices: [{ id: "abc123XYZ", name: "Rachel" }, { id: "def456", name: "Line Break" }] });
  const bad = await serve((_q, w) => { w.writeHead(200, { "content-type": "application/json" }); w.end("nope"); });
  const g = await listVoices(bad.url, KEY);
  bad.close();
  assert.ok(!g.ok && g.error.kind === "bad-response");
  const un = await serve((_q, w) => { w.writeHead(401, { "content-type": "application/json" }); w.end('{"detail":{"status":"invalid_api_key"}}'); });
  const u = await listVoices(un.url, KEY);
  un.close();
  assert.ok(!u.ok && u.error.kind === "unauthorized");
  const n = await listVoices(s.url, undefined);
  assert.ok(!n.ok && n.error.kind === "no-key");
});

test("the speech target follows the settings, ElevenLabs stays on its fixed address, and only a KRONOS_E2E launch may aim it at this computer", () => {
  const secrets = { get: (n: string) => (n === "elevenlabs" ? KEY : undefined) };
  const e = { ...DEFAULT_SETTINGS, speechProvider: "elevenlabs" as const, elevenModel: "eleven_flash_v2_5" as const };
  assert.deepEqual(speechTarget(e, secrets, {}), { kind: "elevenlabs", baseUrl: "https://api.elevenlabs.io", model: "eleven_flash_v2_5", apiKey: KEY });
  assert.deepEqual(speechTarget(DEFAULT_SETTINGS, secrets, {}), { kind: "server", baseUrl: "http://localhost:8081", model: "mlx-community/Kokoro-82M-bf16", apiKey: undefined, custom: false });
  assert.equal((speechTarget({ ...DEFAULT_SETTINGS, speechCustomVoice: "v1" }, secrets, {}) as { custom: boolean }).custom, true);
  const fake = "http://127.0.0.1:5555";
  assert.equal(elevenBase({ KRONOS_E2E_ELEVENLABS_URL: fake }), "https://api.elevenlabs.io", "ignored without KRONOS_E2E=1");
  assert.equal(elevenBase({ KRONOS_E2E: "1", KRONOS_E2E_ELEVENLABS_URL: fake }), fake);
  for (const bad of ["https://example.com", "http://example.com:80", "http://127.0.0.1", "http://127.0.0.1:1/x"]) assert.equal(elevenBase({ KRONOS_E2E: "1", KRONOS_E2E_ELEVENLABS_URL: bad }), "https://api.elevenlabs.io", bad);
});
