import assert from "node:assert/strict";
import { test } from "node:test";
import { activeVoice, DEFAULT_SETTINGS, DEFAULT_SPEECH_URL, mergeSettings, parseSettingsFile, resolveSpeechProvider, validateSettings } from "./settings.ts";

test("validate clamps and defaults", () => {
  assert.deepEqual(validateSettings(null), DEFAULT_SETTINGS);
  assert.equal(validateSettings({ scale: 500 }).scale, 125);
  assert.equal(validateSettings({ scale: "110" }).scale, 100);
  assert.equal(validateSettings({ channelMode: "17" }).channelMode, "keyboard");
});
test("merge keeps current for bad fields", () => {
  const cur = { ...DEFAULT_SETTINGS, accent: "red" as const };
  assert.deepEqual(mergeSettings(cur, { accent: "pink", scale: 95 }), { ...cur, scale: 95 });
});
test("corrupt file gives defaults", () => {
  assert.deepEqual(parseSettingsFile("{nope"), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettingsFile("[]"), DEFAULT_SETTINGS);
});
test("live single-parameter send is off by default and only a boolean turns it on", () => {
  assert.equal(DEFAULT_SETTINGS.liveParams, false);
  assert.equal(DEFAULT_SETTINGS.verifyLive, false);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { verifyLive: true }).verifyLive, true);
  assert.equal(validateSettings({ liveParams: true }).liveParams, true);
  assert.equal(validateSettings({ liveParams: "yes" }).liveParams, false);
  assert.equal(mergeSettings({ ...DEFAULT_SETTINGS, liveParams: true }, { liveParams: 1 }).liveParams, true);
});
test("the AI provider is cloud by default, and the local router settings round trip", () => {
  assert.equal(DEFAULT_SETTINGS.aiProvider, "cloud");
  assert.equal(DEFAULT_SETTINGS.aiBaseUrl, "http://127.0.0.1:4503/v1");
  assert.equal(DEFAULT_SETTINGS.aiModel, "spark/auto:code:medium:proxy");
  const s = mergeSettings(DEFAULT_SETTINGS, { aiProvider: "local", aiBaseUrl: "http://localhost:4503/v1", aiModel: "spark/auto:code:low:proxy" });
  assert.deepEqual(parseSettingsFile(JSON.stringify(s)), s);
});
test("bad AI settings keep the current value", () => {
  const cur = { ...DEFAULT_SETTINGS, aiProvider: "local" as const };
  for (const bad of [{ aiProvider: "other" }, { aiBaseUrl: "file:///etc/passwd" }, { aiBaseUrl: "http://user:pw@host/v1" }, { aiBaseUrl: "nope" }, { aiModel: "has space" }, { aiModel: "" }]) {
    assert.deepEqual(mergeSettings(cur, bad), cur, JSON.stringify(bad));
  }
});
test("no key or secret field can be stored in settings", () => {
  const s = validateSettings({ aiKey: "secret", AUTOROUTER_KEY: "secret", apiKey: "secret" });
  assert.equal(JSON.stringify(s).includes("secret"), false);
  assert.deepEqual(Object.keys(s).filter((k) => /key/i.test(k)), []);
});
test("the Volume channel setting is 'file' by default, 1..16 round trip, and a bad value falls back to 'file'", () => {
  assert.equal(DEFAULT_SETTINGS.globalChannel, "file");
  assert.equal(validateSettings({ globalChannel: "15" }).globalChannel, "15");
  assert.equal(validateSettings({ globalChannel: "file" }).globalChannel, "file");
  for (const bad of [{ globalChannel: "17" }, { globalChannel: "0" }, { globalChannel: 5 }, { globalChannel: "" }]) {
    assert.equal(validateSettings(bad).globalChannel, "file", JSON.stringify(bad));
  }
  const s = mergeSettings(DEFAULT_SETTINGS, { globalChannel: "16" });
  assert.deepEqual(parseSettingsFile(JSON.stringify(s)), s);
  assert.deepEqual(mergeSettings(s, { globalChannel: "bogus" }), s);
});

test("speech and answer-length settings: defaults, validators, LAN-only speech url", () => {
  assert.deepEqual([DEFAULT_SETTINGS.speechUrl, DEFAULT_SETTINGS.speechLang, DEFAULT_SETTINGS.speechVoice, DEFAULT_SETTINGS.speechAuto, DEFAULT_SETTINGS.speechSpeed, DEFAULT_SETTINGS.aiLength], ["http://localhost:8081", "en", "af_heart", false, 1, "normal"]);
  for (const ok of ["http://mybox:8081", "http://127.0.0.1:3900", "http://localhost:8081", "http://192.168.1.5:8081", "http://100.65.169.111:8081", "http://mac.local:8081", "http://x.example.ts.net:8081", "https://mybox"]) assert.equal(mergeSettings(DEFAULT_SETTINGS, { speechUrl: ok }).speechUrl, ok, ok);
  for (const bad of ["http://example.com", "http://8.8.8.8", "http://user:pw@mybox:8081", "ftp://mybox", "file:///x", "mybox", "http://172.32.0.1", ""]) assert.equal(mergeSettings(DEFAULT_SETTINGS, { speechUrl: bad }).speechUrl, DEFAULT_SETTINGS.speechUrl, bad);
  const m = mergeSettings(DEFAULT_SETTINGS, { speechLang: "pt", speechVoice: "pf_dora", speechAuto: true, speechSpeed: 5, aiLength: "brief" });
  assert.deepEqual([m.speechLang, m.speechVoice, m.speechAuto, m.speechSpeed, m.aiLength], ["pt", "pf_dora", true, 1.2, "brief"]);
  const bad = mergeSettings(m, { speechLang: "fr", speechVoice: "../x", speechAuto: "yes", speechSpeed: "fast", aiLength: "long" });
  assert.deepEqual(bad, m);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { speechSpeed: 0.1 }).speechSpeed, 0.8);
});
test("the Claude provider and model are validated and the defaults stay as they were", () => {
  assert.equal(DEFAULT_SETTINGS.aiProvider, "cloud");
  assert.equal(DEFAULT_SETTINGS.aiClaudeModel, "sonnet");
  assert.equal(validateSettings({ aiProvider: "claude" }).aiProvider, "claude");
  assert.equal(validateSettings({ aiProvider: "Claude" }).aiProvider, "cloud");
  assert.equal(validateSettings({ aiProvider: "gemini" }).aiProvider, "cloud");
  for (const m of ["sonnet", "haiku", "opus"]) assert.equal(validateSettings({ aiClaudeModel: m }).aiClaudeModel, m);
  for (const bad of ["fable", "sonnet; rm -rf /", "--help", "", 3, null, "claude-sonnet-4"]) assert.equal(validateSettings({ aiClaudeModel: bad }).aiClaudeModel, "sonnet", String(bad));
  const cur = { ...DEFAULT_SETTINGS, aiProvider: "claude" as const, aiClaudeModel: "haiku" as const };
  assert.deepEqual(mergeSettings(cur, { aiProvider: "nope", aiClaudeModel: "--x" }), cur);
  assert.equal(mergeSettings(cur, { aiClaudeModel: "opus" }).aiClaudeModel, "opus");
  assert.equal(parseSettingsFile('{"aiProvider":"claude","aiClaudeModel":"haiku"}').aiClaudeModel, "haiku");
});

test("speech provider settings: defaults keep today's behaviour, validators, active voice", () => {
  assert.deepEqual([DEFAULT_SETTINGS.speechProvider, DEFAULT_SETTINGS.speechModel, DEFAULT_SETTINGS.speechCustomVoice, DEFAULT_SETTINGS.elevenModel, DEFAULT_SETTINGS.elevenVoice], ["auto", "mlx-community/Kokoro-82M-bf16", "", "eleven_multilingual_v2", ""]);
  const old = validateSettings({ speechUrl: "http://mybox:8081", speechVoice: "pf_dora" });
  assert.equal(resolveSpeechProvider(old), "server", "a settings file from before the provider setting keeps speaking through its server");
  assert.equal(resolveSpeechProvider(validateSettings({ speechProvider: "server" })), "server", "a saved server choice stays on the server, even at the default address");
  const m = mergeSettings(DEFAULT_SETTINGS, { speechProvider: "elevenlabs", speechModel: " tts-1 ", speechCustomVoice: " my_voice-1 ", elevenModel: "eleven_flash_v2_5", elevenVoice: "21m00Tcm4TlvDq8ikWAM" });
  assert.deepEqual([m.speechProvider, m.speechModel, m.speechCustomVoice, m.elevenModel, m.elevenVoice], ["elevenlabs", "tts-1", "my_voice-1", "eleven_flash_v2_5", "21m00Tcm4TlvDq8ikWAM"]);
  const bad = mergeSettings(m, { speechProvider: "openai", speechModel: "a b", speechCustomVoice: "a/b", elevenModel: "eleven_v3", elevenVoice: "x y", speechApiKey: "secret" });
  assert.deepEqual(bad, m, "invalid values keep the current ones, and no key field exists");
  assert.equal(mergeSettings(m, { speechCustomVoice: "", elevenVoice: "" }).speechCustomVoice, "");
  assert.ok(!("speechApiKey" in bad) && !Object.keys(DEFAULT_SETTINGS).some((k) => /key|secret|token/i.test(k)), "no secret is a setting");
  assert.equal(activeVoice(DEFAULT_SETTINGS), "af_heart");
  assert.equal(activeVoice({ ...DEFAULT_SETTINGS, speechCustomVoice: "v1" }), "v1");
  assert.equal(activeVoice({ ...DEFAULT_SETTINGS, speechCustomVoice: "v1", speechProvider: "elevenlabs", elevenVoice: "e1" }), "e1");
});

test("resolveSpeechProvider: nothing set up speaks with this computer, a configured server or an explicit choice wins", () => {
  assert.equal(DEFAULT_SETTINGS.speechProvider, "auto");
  assert.equal(resolveSpeechProvider(DEFAULT_SETTINGS), "system");
  assert.equal(resolveSpeechProvider({ speechProvider: "auto", speechUrl: "http://192.168.1.5:3900" }), "server");
  assert.equal(resolveSpeechProvider({ speechProvider: "auto", speechUrl: DEFAULT_SPEECH_URL }), "system");
  assert.equal(resolveSpeechProvider({ speechProvider: "system", speechUrl: "http://mybox:8081" }), "system", "an explicit system choice ignores a saved address");
  assert.equal(resolveSpeechProvider({ speechProvider: "server", speechUrl: DEFAULT_SPEECH_URL }), "server");
  assert.equal(resolveSpeechProvider({ speechProvider: "elevenlabs", speechUrl: DEFAULT_SPEECH_URL }), "elevenlabs", "never swapped for another provider, so a missing key is an error");
  assert.equal(resolveSpeechProvider({ speechProvider: "auto", speechUrl: "http://localhost:8081/" }), "server", "a different spelling of the default is a configured address");
});
test("speech provider and system voice validators", () => {
  for (const p of ["auto", "system", "server", "elevenlabs"]) assert.equal(validateSettings({ speechProvider: p }).speechProvider, p);
  for (const bad of ["Auto", "openai", "", 3, null]) assert.equal(validateSettings({ speechProvider: bad }).speechProvider, "auto", String(bad));
  assert.deepEqual([DEFAULT_SETTINGS.speechSystemVoiceEn, DEFAULT_SETTINGS.speechSystemVoicePt], ["", ""]);
  const m = mergeSettings(DEFAULT_SETTINGS, { speechSystemVoiceEn: " Microsoft Zira - English (United States) ", speechSystemVoicePt: "Luciana" });
  assert.deepEqual([m.speechSystemVoiceEn, m.speechSystemVoicePt], ["Microsoft Zira - English (United States)", "Luciana"]);
  assert.equal(mergeSettings(m, { speechSystemVoiceEn: "" }).speechSystemVoiceEn, "", "empty means automatic");
  assert.deepEqual(mergeSettings(m, { speechSystemVoiceEn: "x".repeat(201), speechSystemVoicePt: 5 }), m, "too long or not a string keeps the saved value");
  assert.equal(mergeSettings(m, { speechSystemVoiceEn: "a\u0000b" }).speechSystemVoiceEn, m.speechSystemVoiceEn, "control characters are refused");
  assert.deepEqual(parseSettingsFile(JSON.stringify(m)), m);
});
