// The only web pages the app will ever open from a button. The main process refuses any other address.
export const REPO_URL = "https://github.com/adriangrassi/openkronos";
// Buy Me a Coffee page. If this is ever emptied, the coffee buttons hide themselves.
export const COFFEE_URL: string = "https://buymeacoffee.com/simplesolid";
export const ELEVENLABS_KEYS_URL = "https://elevenlabs.io/app/settings/api-keys";

const ALLOWED = [REPO_URL, COFFEE_URL, ELEVENLABS_KEYS_URL].filter((u) => u !== "");
export const isAllowedLink = (v: unknown): v is string => typeof v === "string" && ALLOWED.includes(v);
