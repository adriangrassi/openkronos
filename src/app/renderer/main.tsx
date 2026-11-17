import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadTheme } from "../../core/theme.ts";
import { App } from "./App.tsx";
import "./styles.css";
// After the component stylesheets: the Normal theme overrides a few of their ordering rules.
import "./themes.css";
// Last: Style A's component skins, all scoped to [data-theme="a"].
import "./theme-a.css";
import "./theme-a/layout.css";
import "./theme-a/panel.css";
// Last: the Studio structure rules sit on top of the shared rules and the tokens.
import "./theme-studio.css";

// Before the first paint: the Settings value arrives later over IPC, this copy is already here.
document.documentElement.dataset.theme = loadTheme(window.localStorage);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
