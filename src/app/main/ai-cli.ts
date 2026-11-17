// Finding and running the user's own command-line AI tools (claude, codex) without a shell. Main process only; no electron import.
import { spawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type CliName = "claude" | "codex";
// A .js launcher (the npm build of Codex) runs under this program's own runtime, so `script` marks the one case that needs ELECTRON_RUN_AS_NODE.
export type Cli = { file: string; pre: string[]; script: boolean };
export type ResolveOpts = { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string; isFile?: (p: string) => boolean; execPath?: string };

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

// What npm's .cmd shortcut on Windows points at; a .cmd cannot be started without a shell, so the real file inside the package is started instead.
const NPM_PACKAGE: Record<CliName, { pkg: string; entry: string }> = {
  claude: { pkg: "@anthropic-ai/claude-code", entry: "bin/claude.exe" },
  codex: { pkg: "@openai/codex", entry: "bin/codex.js" },
};

// PATH first, then where the vendors' installers and npm put the tool, because a desktop app often starts with a shorter PATH than a terminal.
// KRONOS_CLAUDE_PATH / KRONOS_CODEX_PATH replace the search, only when KRONOS_E2E=1, and must be an absolute path to an existing file.
export function resolveCli(name: CliName, o: ResolveOpts = {}): Cli | null {
  const env = o.env ?? process.env;
  const win = (o.platform ?? process.platform) === "win32";
  const P = win ? path.win32 : path.posix;
  const ok = o.isFile ?? isFile;
  const wrap = (file: string): Cli => (/\.(?:m?js|cjs)$/.test(file) ? { file: o.execPath ?? process.execPath, pre: [file], script: true } : { file, pre: [], script: false });
  const override = env.KRONOS_E2E === "1" ? env[`KRONOS_${name.toUpperCase()}_PATH`] : undefined;
  if (override !== undefined) return P.isAbsolute(override) && ok(override) ? wrap(override) : null;
  const home = o.home ?? os.homedir();
  const pathVar = Object.entries(env).find(([k]) => k.toUpperCase() === "PATH")?.[1] ?? "";
  const dirs = pathVar.split(win ? ";" : ":").map((d) => d.replace(/^"|"$/g, "")).filter(Boolean);
  const extra = win
    ? [P.join(home, ".local", "bin"), ...(env.APPDATA ? [P.join(env.APPDATA, "npm")] : []), ...(env.LOCALAPPDATA ? [P.join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin")] : [])]
    : [P.join(home, ".local", "bin"), "/usr/local/bin", "/opt/homebrew/bin"];
  const all = [...dirs, ...extra];
  const exe = win ? `${name}.exe` : name;
  for (const d of all) if (ok(P.join(d, exe))) return wrap(P.join(d, exe));
  if (win) {
    const { pkg, entry } = NPM_PACKAGE[name];
    for (const d of all) if (ok(P.join(d, `${name}.cmd`)) && ok(P.join(d, "node_modules", pkg, entry))) return wrap(P.join(d, "node_modules", pkg, entry));
  }
  return null;
}

// The child gets only what a command-line tool needs to find itself, its own sign-in and the network. Nothing else of this app's environment is passed on:
// no ANTHROPIC_* or OPENAI_* variable (so no API key and no base-URL override), no AUTOROUTER_KEY, no KRONOS_* switch.
// PATH, HOME, USERPROFILE, APPDATA, LOCALAPPDATA, SYSTEMROOT, TEMP, TMP, LANG, USER and LOGNAME (the last two for the macOS keychain), HTTP_PROXY, HTTPS_PROXY, NO_PROXY,
// NODE_EXTRA_CA_CERTS and SSL_CERT_FILE (a path to extra trusted certificates, for networks that inspect HTTPS; never NODE_TLS_REJECT_UNAUTHORIZED, which switches checking off),
// and the tool's own config folder (CLAUDE_CONFIG_DIR, CODEX_HOME). Names match in any case, as Windows does.
const KEEP = new Set(["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "TEMP", "TMP", "LANG", "USER", "LOGNAME", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]);
const OWN_CONFIG: Record<CliName, string> = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME" };

export function cliEnv(name: CliName, cli: Cli, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && (KEEP.has(k.toUpperCase()) || k.toUpperCase() === OWN_CONFIG[name])) out[k] = v;
  if (cli.script) out.ELECTRON_RUN_AS_NODE = "1";
  return out;
}

export type Captured = { code: number | null; out: Buffer; err: string; timedOut: boolean; tooBig: boolean; cancelled: boolean; missing: boolean };
const cancels = new Set<() => void>();
export const cancelCli = (): void => {
  for (const c of [...cancels]) c();
};

// Runs one command to the end: stdin is the prompt (never argv), stdout is capped, stderr keeps its last 2000 characters, and a timer kills it.
export function capture(cli: Cli, args: string[], o: { input?: string; timeoutMs: number; maxOut?: number; cwd?: string; env: NodeJS.ProcessEnv }): Promise<Captured> {
  return new Promise((resolve) => {
    const r: Captured = { code: null, out: Buffer.alloc(0), err: "", timedOut: false, tooBig: false, cancelled: false, missing: false };
    let child: ChildProcess;
    try {
      child = spawn(cli.file, [...cli.pre, ...args], { cwd: o.cwd, env: o.env, windowsHide: true, shell: false, stdio: [o.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    } catch (e) {
      r.missing = true;
      r.err = String(e);
      resolve(r);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const cancel = () => {
      r.cancelled = true;
      child.kill();
    };
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cancels.delete(cancel);
      r.out = Buffer.concat(chunks);
      resolve(r);
    };
    const timer = setTimeout(() => {
      r.timedOut = true;
      child.kill();
    }, o.timeoutMs);
    cancels.add(cancel);
    child.stdout?.on("data", (c: Buffer) => {
      size += c.length;
      if (size > (o.maxOut ?? 8_000_000)) {
        r.tooBig = true;
        child.kill();
      } else chunks.push(c);
    });
    child.stderr?.on("data", (c: Buffer) => {
      r.err = (r.err + c.toString("utf8")).slice(-2000);
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      r.missing = e.code === "ENOENT" || e.code === "EACCES" || e.code === "EINVAL";
      r.err = e.message;
      finish();
    });
    child.on("close", (code) => {
      r.code = code;
      finish();
    });
    child.stdin?.on("error", () => {}); // the tool exiting early is reported by close
    if (o.input !== undefined) child.stdin?.end(o.input);
  });
}
