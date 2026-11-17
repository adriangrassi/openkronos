import { useEffect, useState } from "react";
import { stateBlocks, type StateInput } from "./stateBlocks.ts";
import { useStudio } from "./useStudio.ts";

// Rendered by App as children of the top bar, only under data-theme="studio". theme-studio.css orders them next to the file name and the Connected pill.
export function StudioBlocks(input: StateInput) {
  const studio = useStudio();
  if (!studio) return null;
  return (
    <>
      <span className="studio-break" aria-hidden="true" />
      {stateBlocks(input).map((b) => (
        <span key={b.id} className="studio-block" data-testid={`studio-${b.id}`} data-tone={b.tone} role="status">
          <b>{b.title}</b>
          <small>{b.sub}</small>
        </span>
      ))}
    </>
  );
}

// The secondary tools. They stay mounted (the Studio CSS hides or moves them) so every handler and test id keeps working; this control only flips data-studio-tools.
const TOOL_IDS = ["save-as", "exchange-open", "shell-recent-button", "shell-history-button", "overview-open", "shell-help-button", "settings-open"];

export function StudioTools() {
  const studio = useStudio();
  const [open, setOpen] = useState(false);
  const shown = studio && open;
  useEffect(() => {
    const root = document.documentElement;
    if (shown) root.dataset.studioTools = "open";
    else delete root.dataset.studioTools;
    if (!shown) return;
    // After a tool's own click ran, the sheet gets out of the way of the dialog the tool opened.
    const onClick = (e: MouseEvent) => {
      const id = (e.target as Element | null)?.closest?.("button[data-testid]")?.getAttribute("data-testid");
      if (id && TOOL_IDS.includes(id)) setTimeout(() => setOpen(false), 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      delete root.dataset.studioTools;
    };
  }, [shown]);
  if (!studio) return null;
  return (
    <>
      <button type="button" className="studio-tools" data-testid="studio-tools" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        Tools
      </button>
      {open && <div className="studio-scrim" data-testid="studio-tools-scrim" onClick={() => setOpen(false)} />}
      {open && (
        <div className="studio-sheet" role="group" aria-label="Tools">
          <b>Tools</b>
        </div>
      )}
    </>
  );
}
