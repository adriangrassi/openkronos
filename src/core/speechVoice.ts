// Picks one of the computer's own voices (the browser's speechSynthesis list) for the answer language. Pure: no DOM, so it is unit-tested with plain objects.
export type SysVoice = { name: string; lang: string; default?: boolean; localService?: boolean };
type Lang = "en" | "pt";

const norm = (l: string): string => l.toLowerCase().replace(/_/g, "-");
const inLang = (v: SysVoice, lang: Lang): boolean => norm(v.lang) === lang || norm(v.lang).startsWith(`${lang}-`);
const REGION: Record<Lang, string[]> = { en: ["en-us", "en-gb"], pt: ["pt-br", "pt-pt"] };
const isLocal = (v: SysVoice): boolean => v.localService !== false;

// Lower is better: a voice on this computer (no network) first, then the preferred region, then a Natural/Neural one (only counted when local), then the system default.
const rank = (v: SysVoice, lang: Lang): number[] => {
  const r = REGION[lang].indexOf(norm(v.lang));
  return [isLocal(v) ? 0 : 1, r < 0 ? REGION[lang].length : r, isLocal(v) && /natural|neural/i.test(v.name) ? 0 : 1, v.default ? 0 : 1];
};
const cmp = (a: number[], b: number[]): number => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

// The installed voices for one language, best first (the order the Settings list shows).
export const voicesFor = <T extends SysVoice>(voices: T[], lang: Lang): T[] =>
  voices.filter((v) => inLang(v, lang)).map((v) => ({ v, r: rank(v, lang) })).sort((a, b) => cmp(a.r, b.r)).map((x) => x.v);

// The saved voice if it is still installed and speaks the language, else the best match; null when the computer has no voice for the language.
export function pickSystemVoice<T extends SysVoice>(voices: T[], uiLang: Lang, preferredName = ""): T | null {
  const list = voicesFor(voices, uiLang);
  return list.find((v) => preferredName !== "" && v.name === preferredName) ?? list[0] ?? null;
}

export const NO_VOICE_HINT = (lang: Lang): string =>
  `No ${lang === "pt" ? "Portuguese" : "English"} voice is installed on this computer: add one in Windows Settings > Time & language > Speech, or in macOS System Settings > Accessibility > Spoken Content`;
