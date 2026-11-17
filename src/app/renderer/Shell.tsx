// The app-wide shell: top-bar buttons, Ctrl+K palette, shortcut sheet, Recent Files, Undo History, drop-to-open and reopen at start.
import { EXPLAIN_HINT } from "../../core/ai/explain.ts";
import { useEffect, useRef, useState } from "react";
import type { OpenedFile } from "../shared/api.ts";
import type { Workspace } from "./document.ts";
import { CommandPalette, type ShellCommand } from "./CommandPalette.tsx";
import { RecentMenu } from "./RecentMenu.tsx";
import { UndoHistory } from "./UndoHistory.tsx";
import { describeError } from "./keyboard.ts";
import "./Shell.css";

const SHORTCUTS: [string, string][] = [
  ["Ctrl+K", "Command palette: commands and sound names"],
  ["Ctrl+O", "Open a .PCG file"],
  ["Ctrl+S", "Save"],
  ["Ctrl+Shift+S", "Save As"],
  ["Ctrl+Z", "Undo (not while typing in a field)"],
  ["Ctrl+Y", "Redo (not while typing in a field)"],
  ["Ctrl+F", "Focus the name search"],
  ["?", "This sheet (not while typing)"],
  ["Esc", "Close the sheet, menu, palette or dialog"],
];

// Ctrl+letter keys that run a command by id. Shift changes S to Save As.
const KEY_COMMAND: Record<string, string> = { o: "open", s: "save", z: "undo", y: "redo", f: "find" };

const HOLD_TITLE = "Keep or Discard the AI changes first";
const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

interface Props {
  ws: Workspace | null;
  commands: ShellCommand[];
  undoLabels: string[];
  modalOpen: boolean;
  onDismissModal: () => void;
  onJump: (key: string, index: number) => void;
  onUndoTo: (steps: number) => void;
  // A file read outside the normal Open flow: from Recent Files, the reopen setting or a drop. unnamed means Save acts as Save As.
  onOpened: (opened: OpenedFile, unnamed: boolean) => void;
  onError: (message: string) => void;
}

export function Shell(props: Props) {
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [recent, setRecent] = useState(false);
  const [history, setHistory] = useState(false);
  // The window handlers are registered once, so they read the latest props and state through this ref.
  const live = useRef({ ...props, palette, sheet, recent, history });
  live.current = { ...props, palette, sheet, recent, history };
  const started = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = live.current;
      if (e.key === "Escape") {
        if (s.palette) setPalette(false);
        else if (s.sheet) setSheet(false);
        else if (s.recent) setRecent(false);
        else if (s.history) setHistory(false);
        else if (s.modalOpen) s.onDismissModal();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      // While an overlay is up, the document shortcuts stay off: they would act on an edit the user cannot see.
      const overlay = s.palette || s.sheet || s.recent || s.history || s.modalOpen;
      if (mod && !e.altKey) {
        if (k === "k") {
          e.preventDefault();
          if (!s.modalOpen) setPalette((p) => !p);
          return;
        }
        if (overlay) return;
        const id = k === "s" && e.shiftKey ? "save-as" : KEY_COMMAND[k];
        // Undo and redo are left to the text field while the user is typing in one.
        if (!id || (isTyping(e.target) && (k === "z" || k === "y"))) return;
        const cmd = s.commands.find((c) => c.id === id);
        if (cmd?.enabled) {
          e.preventDefault();
          cmd.run();
        }
        return;
      }
      if (e.key === "?" && !mod && !isTyping(e.target) && !overlay) setSheet((v) => !v);
    };
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const s = live.current;
      const file = e.dataTransfer?.files[0];
      if (!file || s.modalOpen) return;
      if (!/\.pcg$/i.test(file.name)) {
        s.onError("Drop a .PCG file to open it.");
        return;
      }
      file.arrayBuffer().then(
        (buf) => live.current.onOpened({ name: file.name, bytes: new Uint8Array(buf) }, true),
        (err: unknown) => live.current.onError(describeError(err)),
      );
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  // Reopen the last file at start, when the setting is on.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    window.kronos.reopenLast().then(
      (o) => {
        if (o) live.current.onOpened(o, o.unnamed === true);
      },
      (e: unknown) => live.current.onError(describeError(e)),
    );
  }, []);

  async function openRecent(id: string) {
    setRecent(false);
    try {
      props.onOpened(await window.kronos.recentOpen(id), false);
    } catch (e) {
      props.onError(describeError(e));
    }
  }

  const allCommands: ShellCommand[] = [
    ...props.commands,
    { id: "shortcuts", title: "Show Shortcuts", keys: "?", enabled: true, run: () => setSheet(true) },
  ];

  const held = props.ws?.held ?? false;
  return (
    <>
      <button data-testid="shell-help-button" onClick={() => setSheet((v) => !v)} title="Keyboard shortcuts (?)">Help</button>
      <button data-testid="shell-recent-button" aria-expanded={recent} onClick={() => setRecent((v) => !v)} disabled={held} title={held ? HOLD_TITLE : undefined}>Recent</button>
      <button data-testid="shell-history-button" aria-expanded={history} onClick={() => setHistory((v) => !v)} disabled={held} title={held ? HOLD_TITLE : undefined}>History</button>
      {recent && <RecentMenu onOpen={(id) => void openRecent(id)} onError={props.onError} />}
      {history && <UndoHistory labels={props.undoLabels} onUndoTo={props.onUndoTo} />}
      {palette && <CommandPalette ws={props.ws} commands={allCommands} onJump={props.onJump} onClose={() => setPalette(false)} />}
      {sheet && (
        <div className="shell-scrim" onMouseDown={() => setSheet(false)}>
          <section className="shell-dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-testid="shell-shortcuts" onMouseDown={(e) => e.stopPropagation()}>
            <h2>Keyboard shortcuts</h2>
            <dl className="shell-keys">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys}>
                  <dt>
                    <kbd>{keys}</kbd>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
            <p className="muted" data-testid="shell-explain-hint">{EXPLAIN_HINT}</p>
          </section>
        </div>
      )}
    </>
  );
}
