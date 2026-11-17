// Names and shape of the secrets the main process may store. A secret is never part of Settings, and the window can only set, clear or ask whether one exists.
export const SECRET_NAMES = ["elevenlabs", "speech-server"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];
export const isSecretName = (v: unknown): v is SecretName => typeof v === "string" && (SECRET_NAMES as readonly string[]).includes(v);
// Printable ASCII without spaces: the value becomes an HTTP header, so a newline or a space must never get in.
export const isSecretValue = (v: unknown): v is string => typeof v === "string" && /^[\x21-\x7e]{8,400}$/.test(v);
