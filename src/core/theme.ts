// Which [data-theme] block of themes.css the app wears. The Settings value is the truth; localStorage is a synchronous copy so the first paint is already right.
export const THEMES = ["normal", "studio", "a"] as const;
export type ThemeId = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeId = "a";
export const THEME_KEY = "kronos.theme";

export const isTheme = (v: unknown): v is ThemeId => (THEMES as readonly unknown[]).includes(v);
export const parseTheme = (v: unknown): ThemeId => (isTheme(v) ? v : DEFAULT_THEME);

type Store = Pick<Storage, "getItem" | "setItem">;
export function loadTheme(store: Store | null): ThemeId {
  try {
    return parseTheme(store?.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}
export function saveTheme(store: Store | null, theme: ThemeId): void {
  try {
    store?.setItem(THEME_KEY, theme);
  } catch {
    // Storage can be unavailable; the Settings file still holds the choice.
  }
}
