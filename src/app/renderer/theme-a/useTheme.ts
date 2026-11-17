// The theme the page wears, read from <html data-theme> (main.tsx and Settings write it). One observer is shared by every control that asks.
import { useSyncExternalStore } from "react";
import { parseTheme, type ThemeId } from "../../../core/theme.ts";

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!observer) {
    observer = new MutationObserver(() => listeners.forEach((l) => l()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) { observer?.disconnect(); observer = null; }
  };
}

export const useTheme = (): ThemeId => parseTheme(useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme, () => undefined));
export const useThemeA = (): boolean => useTheme() === "a";
