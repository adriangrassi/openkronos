// Pure validate-and-merge logic for the Settings dialog. Bulk-write confirmations are never configurable, and no secret is ever a setting (the router key is an environment variable; speech keys live in the main-process secrets store).
import { DEFAULT_THEME, isTheme, type ThemeId } from "./theme.ts";

// The model aliases the Claude Code command line accepts; a fixed list, so no text from the settings file ever becomes a command-line argument.
export const CLAUDE_MODELS = ["sonnet", "haiku", "opus"] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];
export type AiLength = "brief" | "normal" | "detailed";
// "auto" is the default: this computer's own voices, unless the user has set up a server address.
export type SpeechProvider = "auto" | "system" | "server" | "elevenlabs";
// ElevenLabs text-to-speech models, from https://elevenlabs.io/docs/overview/models (turbo is deprecated there but still served).
export const ELEVEN_MODELS = ["eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_turbo_v2_5"] as const;
export type ElevenModel = (typeof ELEVEN_MODELS)[number];
export type AccentColorId = "amber" | "ice" | "green" | "red";
// "theme" means no override: the active theme chooses its own accent.
export type AccentId = AccentColorId | "theme";
export type Settings = { theme: ThemeId; accent: AccentId; scale: number; density: "compact" | "comfortable"; channelMode: string; globalChannel: string; liveParams: boolean; verifyLive: boolean; aiProvider: "cloud" | "claude" | "local"; aiClaudeModel: ClaudeModel; aiBaseUrl: string; aiModel: string; aiLength: AiLength; speechProvider: SpeechProvider; speechSystemVoiceEn: string; speechSystemVoicePt: string; speechUrl: string; speechModel: string; speechCustomVoice: string; elevenModel: ElevenModel; elevenVoice: string; speechLang: "en" | "pt"; speechVoice: string; speechAuto: boolean; speechSpeed: number };

export const DEFAULT_SPEECH_URL = "http://localhost:8081";
export const DEFAULT_SETTINGS: Settings = { theme: DEFAULT_THEME, accent: "theme", scale: 100, density: "comfortable", channelMode: "keyboard", globalChannel: "file", liveParams: false, verifyLive: false, aiProvider: "cloud", aiClaudeModel: "sonnet", aiBaseUrl: "http://127.0.0.1:4503/v1", aiModel: "spark/auto:code:medium:proxy", aiLength: "normal", speechProvider: "auto", speechSystemVoiceEn: "", speechSystemVoicePt: "", speechUrl: DEFAULT_SPEECH_URL, speechModel: "mlx-community/Kokoro-82M-bf16", speechCustomVoice: "", elevenModel: "eleven_multilingual_v2", elevenVoice: "", speechLang: "en", speechVoice: "af_heart", speechAuto: false, speechSpeed: 1 };
export const ACCENTS: Record<AccentColorId, string> = { amber: "#e8a33d", ice: "#6fb6d9", green: "#7bb661", red: "#d9534f" };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const CHANNELS = new Set(["auto", "keyboard", "file", ...Array.from({ length: 16 }, (_, i) => String(i + 1))]);
const GLOBAL_CHANNELS = new Set(["file", ...Array.from({ length: 16 }, (_, i) => String(i + 1))]);

// A voice id typed by the user (a custom server voice or an ElevenLabs voice id). It is only ever sent as a JSON string or one URL path segment.
export const isVoiceId = (v: string): boolean => /^[A-Za-z0-9._:-]{1,64}$/.test(v);
// The voice a request uses: the ElevenLabs voice, else a custom server voice, else the Kokoro voice picked for the language.
export const activeVoice = (s: Settings): string => (s.speechProvider === "elevenlabs" ? s.elevenVoice : s.speechCustomVoice || s.speechVoice);
// What actually speaks. Only an explicit choice reaches ElevenLabs (a missing key is then an error, never a silent fall back to another voice); a changed server address counts as having set a server up.
export type ResolvedSpeech = "system" | "server" | "elevenlabs";
export const resolveSpeechProvider = (s: Pick<Settings, "speechProvider" | "speechUrl">): ResolvedSpeech =>
  s.speechProvider === "elevenlabs" ? "elevenlabs" : s.speechProvider === "server" || (s.speechProvider === "auto" && s.speechUrl !== DEFAULT_SPEECH_URL) ? "server" : "system";
export const isModelId = (v: string): boolean => /^[A-Za-z0-9._:/@+-]{1,120}$/.test(v);
// http(s) only and no credentials in the URL, because the router key header goes to this address.
export function isRouterUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return v.length <= 200 && (u.protocol === "http:" || u.protocol === "https:") && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}

// The speech server gets the answer text, so it must be a machine on this computer or network: loopback, a bare or .local/.lan/.ts.net name, or a private or tailnet address.
export function isSpeechUrl(v: string): boolean {
  if (!isRouterUrl(v)) return false;
  const h = new URL(v).hostname;
  if (/^\d+(\.\d+){3}$/.test(h)) return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h);
  return h === "localhost" || h === "[::1]" || /^[a-z0-9-]+$/i.test(h) || /\.(local|lan|ts\.net)$/i.test(h);
}

// Each field returns undefined when invalid, so validate falls back to the default and merge to the current value.
const field = {
  theme: (v: unknown) => (isTheme(v) ? v : undefined),
  accent: (v: unknown) => (v === "theme" || (typeof v === "string" && Object.hasOwn(ACCENTS, v)) ? (v as AccentId) : undefined),
  scale: (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(125, Math.max(90, Math.round(v))) : undefined),
  density: (v: unknown) => (v === "compact" || v === "comfortable" ? v : undefined),
  channelMode: (v: unknown) => (typeof v === "string" && CHANNELS.has(v) ? v : undefined),
  globalChannel: (v: unknown) => (typeof v === "string" && GLOBAL_CHANNELS.has(v) ? v : undefined),
  liveParams: (v: unknown) => (typeof v === "boolean" ? v : undefined),
  verifyLive: (v: unknown) => (typeof v === "boolean" ? v : undefined),
  aiProvider: (v: unknown) => (v === "cloud" || v === "claude" || v === "local" ? v : undefined),
  aiClaudeModel: (v: unknown) => (typeof v === "string" && (CLAUDE_MODELS as readonly string[]).includes(v) ? (v as ClaudeModel) : undefined),
  aiBaseUrl: (v: unknown) => (typeof v === "string" && isRouterUrl(v.trim()) ? v.trim() : undefined),
  aiModel: (v: unknown) => (typeof v === "string" && isModelId(v.trim()) ? v.trim() : undefined),
  aiLength: (v: unknown) => (v === "brief" || v === "normal" || v === "detailed" ? v : undefined),
  speechProvider: (v: unknown) => (v === "auto" || v === "system" || v === "server" || v === "elevenlabs" ? v : undefined),
  speechSystemVoice: (v: unknown) => (typeof v === "string" && v.trim().length <= 200 && !/[\x00-\x1f\x7f]/.test(v) ? v.trim() : undefined),
  speechModel: (v: unknown) => (typeof v === "string" && isModelId(v.trim()) ? v.trim() : undefined),
  speechCustomVoice: (v: unknown) => (typeof v === "string" && (v.trim() === "" || isVoiceId(v.trim())) ? v.trim() : undefined),
  elevenModel: (v: unknown) => (typeof v === "string" && (ELEVEN_MODELS as readonly string[]).includes(v) ? (v as ElevenModel) : undefined),
  elevenVoice: (v: unknown) => (typeof v === "string" && (v.trim() === "" || isVoiceId(v.trim())) ? v.trim() : undefined),
  speechUrl: (v: unknown) => (typeof v === "string" && isSpeechUrl(v.trim()) ? v.trim() : undefined),
  speechLang: (v: unknown) => (v === "en" || v === "pt" ? v : undefined),
  speechVoice: (v: unknown) => (typeof v === "string" && /^[a-z]{2}_[a-z]{2,20}$/.test(v) ? v : undefined),
  speechAuto: (v: unknown) => (typeof v === "boolean" ? v : undefined),
  speechSpeed: (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1.2, Math.max(0.8, Math.round(v * 100) / 100)) : undefined),
};

export function mergeSettings(current: Settings, patch: unknown): Settings {
  const p = isObj(patch) ? patch : {};
  return {
    theme: field.theme(p.theme) ?? current.theme,
    accent: field.accent(p.accent) ?? current.accent,
    scale: field.scale(p.scale) ?? current.scale,
    density: field.density(p.density) ?? current.density,
    channelMode: field.channelMode(p.channelMode) ?? current.channelMode,
    globalChannel: field.globalChannel(p.globalChannel) ?? current.globalChannel,
    liveParams: field.liveParams(p.liveParams) ?? current.liveParams,
    verifyLive: field.verifyLive(p.verifyLive) ?? current.verifyLive,
    aiProvider: field.aiProvider(p.aiProvider) ?? current.aiProvider,
    aiClaudeModel: field.aiClaudeModel(p.aiClaudeModel) ?? current.aiClaudeModel,
    aiBaseUrl: field.aiBaseUrl(p.aiBaseUrl) ?? current.aiBaseUrl,
    aiModel: field.aiModel(p.aiModel) ?? current.aiModel,
    aiLength: field.aiLength(p.aiLength) ?? current.aiLength,
    speechProvider: field.speechProvider(p.speechProvider) ?? current.speechProvider,
    speechSystemVoiceEn: field.speechSystemVoice(p.speechSystemVoiceEn) ?? current.speechSystemVoiceEn,
    speechSystemVoicePt: field.speechSystemVoice(p.speechSystemVoicePt) ?? current.speechSystemVoicePt,
    speechUrl: field.speechUrl(p.speechUrl) ?? current.speechUrl,
    speechModel: field.speechModel(p.speechModel) ?? current.speechModel,
    speechCustomVoice: field.speechCustomVoice(p.speechCustomVoice) ?? current.speechCustomVoice,
    elevenModel: field.elevenModel(p.elevenModel) ?? current.elevenModel,
    elevenVoice: field.elevenVoice(p.elevenVoice) ?? current.elevenVoice,
    speechLang: field.speechLang(p.speechLang) ?? current.speechLang,
    speechVoice: field.speechVoice(p.speechVoice) ?? current.speechVoice,
    speechAuto: field.speechAuto(p.speechAuto) ?? current.speechAuto,
    speechSpeed: field.speechSpeed(p.speechSpeed) ?? current.speechSpeed,
  };
}

export const validateSettings = (raw: unknown): Settings => mergeSettings(DEFAULT_SETTINGS, raw);

export function parseSettingsFile(text: string): Settings {
  try {
    return validateSettings(JSON.parse(text));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
