import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { capture, cliEnv, resolveCli } from "./ai-cli.ts";

const files = (list: string[]) => (p: string) => list.includes(p);

test("Windows: PATH is searched for the .exe first, then the installers' folders", () => {
  const w = { platform: "win32" as const, home: "C:\\Users\\u", env: { Path: "C:\\bin;C:\\tools", APPDATA: "C:\\Users\\u\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" } };
  assert.deepEqual(resolveCli("claude", { ...w, isFile: files(["C:\\tools\\claude.exe", "C:\\Users\\u\\.local\\bin\\claude.exe"]) }), { file: "C:\\tools\\claude.exe", pre: [], script: false });
  assert.equal(resolveCli("claude", { ...w, isFile: files(["C:\\Users\\u\\.local\\bin\\claude.exe"]) })?.file, "C:\\Users\\u\\.local\\bin\\claude.exe");
  assert.equal(resolveCli("codex", { ...w, isFile: files(["C:\\Users\\u\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe"]) })?.file, "C:\\Users\\u\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe");
  assert.equal(resolveCli("claude", { ...w, isFile: files([]) }), null);
});

test("Windows: an npm .cmd shortcut is replaced by the real file inside the package, because a .cmd cannot start without a shell", () => {
  const npm = "C:\\Users\\u\\AppData\\Roaming\\npm";
  const w = { platform: "win32" as const, home: "C:\\Users\\u", execPath: "C:\\app\\studio.exe", env: { PATH: "C:\\bin", APPDATA: "C:\\Users\\u\\AppData\\Roaming" } };
  assert.deepEqual(resolveCli("claude", { ...w, isFile: files([`${npm}\\claude.cmd`, `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`]) }), { file: `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`, pre: [], script: false });
  const js = `${npm}\\node_modules\\@openai\\codex\\bin\\codex.js`;
  assert.deepEqual(resolveCli("codex", { ...w, isFile: files([`${npm}\\codex.cmd`, js]) }), { file: "C:\\app\\studio.exe", pre: [js], script: true });
  assert.equal(resolveCli("claude", { ...w, isFile: files([`${npm}\\claude.cmd`]) }), null, "a shortcut with no package behind it is not a tool");
});

test("macOS and Linux: PATH, then ~/.local/bin, /usr/local/bin and Homebrew", () => {
  const w = { platform: "linux" as const, home: "/home/u", env: { PATH: "/usr/bin:/opt/x" } };
  assert.equal(resolveCli("claude", { ...w, isFile: files(["/opt/x/claude"]) })?.file, "/opt/x/claude");
  assert.equal(resolveCli("claude", { ...w, isFile: files(["/home/u/.local/bin/claude"]) })?.file, "/home/u/.local/bin/claude");
  assert.equal(resolveCli("codex", { ...w, isFile: files(["/opt/homebrew/bin/codex"]) })?.file, "/opt/homebrew/bin/codex");
});

test("the path override works only in an E2E run, and only for an absolute path to an existing file", () => {
  const base = { platform: "linux" as const, home: "/h", isFile: files(["/fake/claude.mjs", "/real/claude"]), execPath: "/rt/node" };
  const env = { PATH: "/real", KRONOS_CLAUDE_PATH: "/fake/claude.mjs" };
  assert.equal(resolveCli("claude", { ...base, env })?.file, "/real/claude", "ignored without KRONOS_E2E=1");
  assert.deepEqual(resolveCli("claude", { ...base, env: { ...env, KRONOS_E2E: "1" } }), { file: "/rt/node", pre: ["/fake/claude.mjs"], script: true });
  for (const bad of ["claude.mjs", "/fake/missing.mjs", "../fake/claude.mjs", ""]) assert.equal(resolveCli("claude", { ...base, env: { ...env, KRONOS_E2E: "1", KRONOS_CLAUDE_PATH: bad } }), null, bad);
});

test("the environment passed on is the documented allowlist and nothing else", () => {
  const cli = { file: "x", pre: [], script: false };
  const env = cliEnv("claude", cli, { Path: "p", HOME: "h", USERPROFILE: "u", APPDATA: "a", LOCALAPPDATA: "l", SYSTEMROOT: "s", TEMP: "t", TMP: "t", LANG: "en", https_proxy: "hp", NO_PROXY: "n", NODE_EXTRA_CA_CERTS: "ca.pem", NODE_TLS_REJECT_UNAUTHORIZED: "0", CLAUDE_CONFIG_DIR: "c", CODEX_HOME: "no", ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: "b", CLAUDE_CODE_SESSION_ID: "x", AUTOROUTER_KEY: "r", KRONOS_E2E: "1" });
  assert.deepEqual(Object.keys(env).sort(), ["APPDATA", "CLAUDE_CONFIG_DIR", "HOME", "LANG", "LOCALAPPDATA", "NODE_EXTRA_CA_CERTS", "NO_PROXY", "Path", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "https_proxy"].sort());
  assert.equal(cliEnv("codex", cli, { CODEX_HOME: "c", CLAUDE_CONFIG_DIR: "x" }).CODEX_HOME, "c");
  assert.equal(cliEnv("codex", cli, { CLAUDE_CONFIG_DIR: "x" }).CLAUDE_CONFIG_DIR, undefined);
  assert.equal(cliEnv("claude", { ...cli, script: true }, {}).ELECTRON_RUN_AS_NODE, "1");
});

test("capture feeds stdin, reads stdout, and reports a program that does not exist", async () => {
  const node = { file: process.execPath, pre: ["-e", "process.stdin.on('data',d=>process.stdout.write(String(d).toUpperCase()))"], script: false };
  const r = await capture(node, [], { input: "abc", timeoutMs: 10_000, env: { PATH: path.dirname(process.execPath) } });
  assert.equal(r.out.toString(), "ABC");
  assert.equal(r.code, 0);
  const none = await capture({ file: path.join(process.cwd(), "no-such-program.exe"), pre: [], script: false }, [], { timeoutMs: 5000, env: {} });
  assert.equal(none.missing, true);
});
