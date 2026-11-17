// Text to speech for the AI window: one POST per chunk, to the user's OpenAI-compatible speech server or to ElevenLabs, over node:http(s), which ignores HTTP(S)_PROXY.
// Main process only, because the renderer CSP allows no outside connections, and because the API keys live here and never reach the window or any error text.
// ElevenLabs reference (checked 2026-11): https://elevenlabs.io/docs/api-reference/text-to-speech/convert (POST /v1/text-to-speech/{voice_id}, header xi-api-key, body text/model_id/language_code/voice_settings),
// https://elevenlabs.io/docs/api-reference/voices/search (GET /v2/voices), https://elevenlabs.io/docs/overview/models, speed 0.7 to 1.2: https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/can-i-change-the-pace-of-the-voice
import http from "node:http";
import https from "node:https";
import type { SecretName } from "../../core/secrets.ts";
import { isVoiceId, type Settings } from "../../core/settings.ts";

export const TIMEOUT_MS = 60_000;
export const MAX_AUDIO = 20_000_000;
export const ELEVEN_BASE = "https://api.elevenlabs.io";
export type SpeechRequest = { text: string; lang: "en" | "pt"; voice: string; speed: number };
export type SpeechError = { kind: "unreachable" | "bad-response" | "timeout" | "cancelled" | "no-key" | "unauthorized" | "quota"; message: string };
export type SpeechResult = { ok: true; bytes: Uint8Array } | { ok: false; error: SpeechError };
export type Voice = { id: string; name: string };
export type VoicesResult = { ok: true; voices: Voice[] } | { ok: false; error: SpeechError };
// Where a request goes. baseUrl is a parameter so the unit tests can aim it at a fake server; production code fixes it (see speech-ipc.ts).
export type Target =
  | { kind: "server"; baseUrl: string; model: string; apiKey?: string; custom: boolean }
  | { kind: "elevenlabs"; baseUrl: string; model: string; apiKey?: string };

// A gate launch (KRONOS_E2E=1) may aim ElevenLabs at a fake server on this computer; no setting or other variable can change the address.
export const elevenBase = (env: NodeJS.ProcessEnv = process.env): string => (env.KRONOS_E2E === "1" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.KRONOS_E2E_ELEVENLABS_URL ?? "") ? (env.KRONOS_E2E_ELEVENLABS_URL as string) : ELEVEN_BASE);

export function speechTarget(s: Settings, secrets: { get(name: SecretName): string | undefined }, env: NodeJS.ProcessEnv = process.env): Target {
  return s.speechProvider === "elevenlabs"
    ? { kind: "elevenlabs", baseUrl: elevenBase(env), model: s.elevenModel, apiKey: secrets.get("elevenlabs") }
    : { kind: "server", baseUrl: s.speechUrl, model: s.speechModel, apiKey: secrets.get("speech-server"), custom: s.speechCustomVoice !== "" };
}

// The voice's first letter is Kokoro's lang_code: a American, b British, p Brazilian Portuguese.
const LANG_LETTERS: Record<SpeechRequest["lang"], string> = { en: "ab", pt: "p" };
let inflight: AbortController | null = null;

export function checkRequest(r: unknown, kokoro = true): SpeechRequest {
  const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
  const { text, lang, voice, speed } = o;
  if (typeof text !== "string" || text.trim() === "" || text.length > 1000) throw new Error("speech takes 1 to 1000 characters of text");
  if (lang !== "en" && lang !== "pt") throw new Error("speech language must be en or pt");
  if (typeof voice !== "string" || !isVoiceId(voice)) throw new Error("that voice id is not valid");
  if (kokoro && (!/^[a-z]{2}_[a-z]{2,20}$/.test(voice) || !LANG_LETTERS[lang].includes(voice[0]))) throw new Error("that voice does not fit the language");
  if (typeof speed !== "number" || !Number.isFinite(speed)) throw new Error("bad speed");
  return { text, lang, voice, speed: Math.min(1.2, Math.max(0.8, speed)) };
}

export const cancelSpeech = (): void => inflight?.abort();

const redact = (s: string, key?: string): string => (key ? s.split(key).join("[key]") : s);
const mkFail = (key?: string) => (kind: SpeechError["kind"], message: string): { ok: false; error: SpeechError } => ({ ok: false, error: { kind, message: redact(message, key) } });

// A server error comes back as JSON {"detail"|"error": ...}; its text is cut short and shown as the reason.
const reason = (b: Buffer): string => {
  try {
    const j = JSON.parse(b.toString("utf8")) as { detail?: unknown; error?: unknown };
    return String(typeof j.detail === "string" ? j.detail : typeof j.error === "string" ? j.error : JSON.stringify(j.detail ?? j.error ?? j)).slice(0, 200);
  } catch {
    return b.toString("utf8").slice(0, 120);
  }
};

type Sent = { ok: true; status: number; type: string; body: Buffer } | { ok: false; kind: "cancelled" | "timeout" | "too-large" | "unreachable"; host: string; code?: string };
function send(url: URL, method: "GET" | "POST", headers: Record<string, string>, payload: Buffer | null, timeoutMs: number, signal?: AbortSignal): Promise<Sent> {
  return new Promise((resolve) => {
    const done = (x: Sent): void => {
      clearTimeout(timer);
      resolve(x);
    };
    const lib = url.protocol === "https:" ? https : http;
    const h = payload ? { ...headers, "content-length": String(payload.length) } : headers;
    const req = lib.request(url, { method, signal, headers: h }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_AUDIO) req.destroy(new Error("too large"));
        else chunks.push(c);
      });
      res.on("error", () => done({ ok: false, kind: "unreachable", host: url.host, code: "broken" }));
      res.on("end", () => done({ ok: true, status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("timeout"), { code: "KTIMEOUT" })), timeoutMs);
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.name === "AbortError") done({ ok: false, kind: "cancelled", host: url.host });
      else if (e.code === "KTIMEOUT") done({ ok: false, kind: "timeout", host: url.host });
      else if (e.message === "too large") done({ ok: false, kind: "too-large", host: url.host });
      else done({ ok: false, kind: "unreachable", host: url.host, code: e.code });
    });
    req.end(payload);
  });
}

// A WAV file (RIFF....WAVE) from the user's server, an MP3 (ID3 tag or an MPEG frame sync) from ElevenLabs.
const isWav = (b: Buffer): boolean => b.length >= 44 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WAVE";
export const isMp3 = (b: Buffer): boolean => b.length >= 4 && (b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));

// ElevenLabs reports quota as detail.status "quota_exceeded" (with 401 or 429) and a busy account as 429 with a concurrency status; the body is read for the status code and a short message only.
function elevenError(status: number, b: Buffer): { kind: SpeechError["kind"]; message: string } {
  let d: { status?: unknown; message?: unknown } = {};
  try {
    const j = (JSON.parse(b.toString("utf8")) as { detail?: unknown }).detail;
    d = typeof j === "object" && j !== null ? j : typeof j === "string" ? { message: j } : {};
  } catch {
    // not JSON: only the status code is shown
  }
  const code = typeof d.status === "string" ? d.status : "";
  if (status === 429 || code === "quota_exceeded") {
    return /concurrent|busy|rate_limit/i.test(code) ? { kind: "quota", message: "ElevenLabs is busy: too many requests at once. Try again in a moment." } : { kind: "quota", message: "ElevenLabs quota used up: check your plan" };
  }
  if (status === 401) return { kind: "unauthorized", message: "ElevenLabs did not accept the API key: check it in Settings, Speech (it needs the Text to Speech permission)." };
  return { kind: "bad-response", message: `ElevenLabs refused the request (HTTP ${status})${typeof d.message === "string" ? `: ${d.message.slice(0, 160)}` : ""}` };
}

export function synthesize(raw: unknown, t: Target, timeoutMs = TIMEOUT_MS): Promise<SpeechResult> {
  const fail = mkFail(t.apiKey);
  const eleven = t.kind === "elevenlabs";
  let r: SpeechRequest;
  try {
    r = checkRequest(raw, t.kind === "server" && !t.custom);
  } catch (e) {
    return Promise.resolve(fail("bad-response", (e as Error).message));
  }
  if (eleven && !t.apiKey) return Promise.resolve(fail("no-key", "Add your ElevenLabs API key in Settings, Speech."));
  let url: URL;
  try {
    url = eleven ? new URL(`/v1/text-to-speech/${encodeURIComponent(r.voice)}?output_format=mp3_44100_128`, t.baseUrl) : new URL("/v1/audio/speech", t.baseUrl);
  } catch {
    return Promise.resolve(fail("bad-response", eleven ? "the ElevenLabs address is not valid" : "the speech server address is not valid"));
  }
  inflight?.abort(); // one request at a time: a newer one replaces the older
  const ac = new AbortController();
  inflight = ac;
  // language_code is not supported by the multilingual v2 model; the voice_settings override is sent only for a changed speed, so the voice keeps its own saved settings otherwise.
  const body = eleven
    ? { text: r.text, model_id: t.model, ...(t.model === "eleven_multilingual_v2" ? {} : { language_code: r.lang }), ...(r.speed === 1 ? {} : { voice_settings: { speed: r.speed } }) }
    : { model: t.model, input: r.text, voice: r.voice, ...(t.kind === "server" && t.custom ? {} : { lang_code: r.voice[0] }), response_format: "wav", speed: r.speed };
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
  if (eleven) headers["xi-api-key"] = t.apiKey ?? "";
  else if (t.apiKey) headers.authorization = `Bearer ${t.apiKey}`;
  const who = eleven ? "ElevenLabs" : "the speech server";
  return send(url, "POST", headers, Buffer.from(JSON.stringify(body), "utf8"), timeoutMs, ac.signal).then((s): SpeechResult => {
    if (inflight === ac) inflight = null;
    if (!s.ok) {
      if (s.kind === "cancelled") return fail("cancelled", "cancelled");
      if (s.kind === "timeout") return fail("timeout", `${who} did not answer within ${timeoutMs / 1000} seconds`);
      if (s.kind === "too-large") return fail("bad-response", `${who} sent too much audio`);
      return fail("unreachable", s.code === "broken" ? `the connection to ${who} broke` : `${who} is not reachable at ${s.host}${s.code ? ` (${s.code})` : ""}`);
    }
    const typeOk = eleven ? /audio\/(mpeg|mp3)/i.test(s.type) : /audio\/(x-)?wav/i.test(s.type);
    if (s.status !== 200 || !typeOk) {
      if (eleven) {
        const e = elevenError(s.status, s.body);
        return fail(e.kind, e.message);
      }
      return fail("bad-response", `the speech server refused: ${reason(s.body) || `HTTP ${s.status}`}`);
    }
    if (!(eleven ? isMp3(s.body) : isWav(s.body))) return fail("bad-response", `${who} did not return ${eleven ? "an MP3" : "a WAV"} file`);
    return { ok: true, bytes: new Uint8Array(s.body.buffer, s.body.byteOffset, s.body.length) };
  });
}

// The user's own voices, for the voice list. shortcut: one page of up to 100 voices, enough for a personal account; the voice id can still be typed.
export async function listVoices(baseUrl: string, apiKey: string | undefined, timeoutMs = 20_000): Promise<VoicesResult> {
  const fail = mkFail(apiKey);
  if (!apiKey) return fail("no-key", "Add your ElevenLabs API key in Settings, Speech.");
  let url: URL;
  try {
    url = new URL("/v2/voices?page_size=100", baseUrl);
  } catch {
    return fail("bad-response", "the ElevenLabs address is not valid");
  }
  const s = await send(url, "GET", { "xi-api-key": apiKey, accept: "application/json" }, null, timeoutMs);
  if (!s.ok) return s.kind === "timeout" ? fail("timeout", "ElevenLabs did not answer in time") : fail("unreachable", `ElevenLabs is not reachable at ${s.host}${s.code && s.code !== "broken" ? ` (${s.code})` : ""}`);
  if (s.status !== 200) {
    const e = elevenError(s.status, s.body);
    return fail(e.kind, e.message);
  }
  try {
    const list = (JSON.parse(s.body.toString("utf8")) as { voices?: unknown }).voices;
    if (!Array.isArray(list)) throw new Error("no list");
    const voices: Voice[] = [];
    for (const v of list.slice(0, 200) as { voice_id?: unknown; name?: unknown }[]) {
      if (typeof v?.voice_id === "string" && isVoiceId(v.voice_id)) voices.push({ id: v.voice_id, name: (typeof v.name === "string" ? v.name : v.voice_id).replace(/[\u0000-\u001f]/g, " ").slice(0, 80) });
    }
    return { ok: true, voices };
  } catch {
    return fail("bad-response", "ElevenLabs did not return a voice list");
  }
}
