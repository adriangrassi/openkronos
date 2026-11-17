// What the AI connection screen and the main process agree on: provider ids, the status shape, the status chip, typed error kinds with their friendly words,
// and the text of each provider's card. No Node or DOM imports, so it runs in the main process and the renderer alike.
// The provider ids are the values of the aiProvider setting: "cloud" is the Codex command-line tool on the user's ChatGPT login.
export type ProviderId = "claude" | "cloud" | "local";
export const PROVIDER_IDS: readonly ProviderId[] = ["claude", "cloud", "local"];
export type ProviderStatus = { installed: boolean; signedIn: boolean | "unknown"; version?: string; detail: string };
export type TestResult = { ok: true; ms: number } | { ok: false; kind: AiErrorKind; message: string };

export type Chip = "ready" | "not-installed" | "not-signed-in" | "unknown" | "not-checked";
export const CHIP_LABEL: Record<Chip, string> = { ready: "Ready", "not-installed": "Not installed", "not-signed-in": "Not signed in", unknown: "Installed, sign-in not known", "not-checked": "Not checked" };
export function chipOf(s: ProviderStatus | null): Chip {
  if (!s) return "not-checked";
  if (!s.installed) return "not-installed";
  return s.signedIn === true ? "ready" : s.signedIn === false ? "not-signed-in" : "unknown";
}

export type AiErrorKind = "not-installed" | "not-signed-in" | "rate-limit-or-plan" | "timeout" | "bad-output" | "failed";
export const PROVIDER_NAME: Record<ProviderId, string> = { claude: "Claude Code", cloud: "Codex", local: "the local router" };

// The one place the words for a failure live, so the Settings screen and the AI window say the same thing.
export function friendlyError(provider: ProviderId, kind: AiErrorKind, detail = ""): string {
  const name = PROVIDER_NAME[provider];
  const where = "Open Settings, AI connection.";
  switch (kind) {
    case "not-installed": return `${name} is not installed on this computer, or OpenKronos cannot find it. ${where}`;
    case "not-signed-in": return `${name} is installed but not signed in. Sign in once in a terminal, then try again. ${where}`;
    case "rate-limit-or-plan": return `Your plan's usage limit for ${name} was reached, or the plan does not include it. Wait for the limit to reset, or pick another provider.`;
    case "timeout": return `${name} did not answer in time. Try again, or ask something shorter.`;
    case "bad-output": return `${name} answered in a form OpenKronos could not read. Try again; if it keeps happening, update ${name}.`;
    default: return `${name} failed${detail ? `: ${detail}` : "."}`;
  }
}

// Errors cross the IPC boundary as plain messages, so the kind rides in a marker the renderer can find again.
const KINDS: readonly AiErrorKind[] = ["not-installed", "not-signed-in", "rate-limit-or-plan", "timeout", "bad-output", "failed"];
export const encodeAiError = (kind: AiErrorKind, message: string): string => `[ai:${kind}] ${message}`;
export function parseAiError(text: string): { kind: AiErrorKind; message: string } | null {
  const m = /\[ai:([a-z-]+)\]\s*([\s\S]*)/.exec(text);
  const kind = KINDS.find((k) => k === m?.[1]);
  return m && kind ? { kind, message: m[2].trim() } : null;
}

// What a command-line tool prints when the problem is the account, not the program.
export function classifyFailure(text: string): "not-signed-in" | "rate-limit-or-plan" | null {
  if (/not logged in|not signed in|please run \/login|codex login|log in again|invalid api key|authentication[_ ](?:error|failed)|oauth token (?:has )?expired|\b401\b/i.test(text)) return "not-signed-in";
  if (/usage limit|rate.?limit|limit reached|out of (?:extra )?usage|quota|credit balance|overloaded|too many requests|\b429\b|upgrade your plan/i.test(text)) return "rate-limit-or-plan";
  return null;
}

export const parseVersion = (text: string): string | undefined => /\d+\.\d+\.\d+[\w.+-]*/.exec(text)?.[0];

// `claude auth status` prints JSON that also carries the account's e-mail and organisation; only the sign-in flag and the method name are read, and nothing else is kept.
export function parseClaudeAuth(out: string): { signedIn: boolean | "unknown"; method?: string } {
  try {
    const j = JSON.parse(out) as { loggedIn?: unknown; authMethod?: unknown };
    if (typeof j.loggedIn !== "boolean") return { signedIn: "unknown" };
    return { signedIn: j.loggedIn, ...(typeof j.authMethod === "string" && /^[\w.-]{1,30}$/.test(j.authMethod) ? { method: j.authMethod } : {}) };
  } catch {
    return { signedIn: "unknown" };
  }
}

// `codex login status` writes "Logged in using ChatGPT" or "Not logged in" (to stderr in 0.169; both streams are read) and exits 1 when signed out.
export function parseCodexLogin(text: string): boolean | "unknown" {
  return /not logged in/i.test(text) ? false : /logged in/i.test(text) ? true : "unknown";
}

export type SetupStep = { text: string; commands?: { label: string; command: string }[] };
export type ProviderCard = { title: string; what: string; steps: SetupStep[]; docs: { label: string; url: string }[] };

export const CARDS: Record<ProviderId, ProviderCard> = {
  claude: {
    title: "Claude (your Claude plan)",
    what: "OpenKronos asks the Claude Code app on this computer, signed in with your own Claude plan (Pro, Max, Team or Enterprise; the free plan does not include it). It adds no cost of its own, but each question counts against your plan's usage limits. Your question, and the open sound's data when you ask about a sound, leave this computer for Anthropic. OpenKronos never sees your password or sign-in: you sign in once, in a terminal.",
    steps: [
      { text: "Install Claude Code. Use the line for your system:", commands: [
        { label: "Windows (PowerShell)", command: "irm https://claude.ai/install.ps1 | iex" },
        { label: "macOS, Linux", command: "curl -fsSL https://claude.ai/install.sh | bash" },
        { label: "Or with npm (Node.js 22 or newer)", command: "npm install -g @anthropic-ai/claude-code" },
      ] },
      { text: "Open a new terminal, start it, and sign in:", commands: [{ label: "Terminal", command: "claude" }, { label: "Then, inside Claude Code", command: "/login" }] },
      { text: "Come back here and press Check." },
    ],
    docs: [{ label: "Install Claude Code", url: "https://code.claude.com/docs/en/setup" }, { label: "Sign in", url: "https://code.claude.com/docs/en/authentication" }],
  },
  cloud: {
    title: "ChatGPT / Codex (your ChatGPT plan)",
    what: "OpenKronos asks the Codex app on this computer, signed in with your own ChatGPT plan. It adds no cost of its own, but each question counts against your plan's Codex usage limits. Your question, and the open sound's data when you ask about a sound, leave this computer for OpenAI. OpenKronos never sees your password or sign-in: you sign in once, in a terminal.",
    steps: [
      { text: "Install Codex:", commands: [{ label: "With npm (Node.js required)", command: "npm install -g @openai/codex" }, { label: "macOS, Linux", command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh" }] },
      { text: "Open a new terminal and sign in with ChatGPT:", commands: [{ label: "Terminal", command: "codex login" }] },
      { text: "Come back here and press Check." },
    ],
    docs: [{ label: "Codex command line", url: "https://developers.openai.com/codex/cli" }, { label: "Codex source and install notes", url: "https://github.com/openai/codex" }],
  },
  local: {
    title: "Local server (advanced)",
    what: "An OpenAI-compatible server you run yourself, on this computer or another one on your network. Your text goes only to that server. The server's key is never stored by OpenKronos: set it as the environment variable AUTOROUTER_KEY before you start OpenKronos.",
    steps: [
      { text: "Set the key in the environment, then start OpenKronos again:", commands: [{ label: "Windows (PowerShell)", command: "$env:AUTOROUTER_KEY = \"your-key\"" }, { label: "macOS, Linux", command: "export AUTOROUTER_KEY=your-key" }] },
      { text: "Enter the server's address and model name below, then press Check." },
    ],
    docs: [],
  },
};
