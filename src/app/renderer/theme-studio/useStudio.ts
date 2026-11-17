import { useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  const watch = new MutationObserver(notify);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => watch.disconnect();
};
const isStudio = () => document.documentElement.dataset.theme === "studio";

// True while the Studio theme is selected. Components that need different structure (not just different tokens) branch on this.
export const useStudio = (): boolean => useSyncExternalStore(subscribe, isStudio);

// Parameter rows are a windowed list with a fixed row height, so the Studio rows (56 px targets) need their own number; theme-studio.css sets .param-row to the same.
export const PARAM_ROW = 32;
export const PARAM_ROW_STUDIO = 56;
