// Ctrl+K: one fuzzy search over the app's commands and every sound name. Arrow keys pick a row, Enter runs it.
import { useEffect, useRef, useState } from "react";
import { fuzzyFilter } from "../../core/fuzzy.ts";
import type { Workspace } from "./document.ts";

export interface ShellCommand {
  id: string;
  title: string;
  keys?: string;
  enabled: boolean;
  run: () => void;
}

type Item = { kind: "command"; cmd: ShellCommand } | { kind: "sound"; key: string; index: number; name: string; bank: string };

const SHOWN = 100;

function sounds(ws: Workspace): Item[] {
  // Wave Sequences are not sound names the palette jumps to.
  return ws
    .banks()
    .filter((b) => b.kind !== "waveseq")
    .flatMap((b) => Array.from({ length: b.count }, (_, i): Item => ({ kind: "sound", key: b.key, index: i, name: ws.nameOf(b.key, i), bank: b.label })));
}

interface Props {
  ws: Workspace | null;
  commands: ShellCommand[];
  onJump: (key: string, index: number) => void;
  onClose: () => void;
}

export function CommandPalette({ ws, commands, onJump, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const items: Item[] = [...commands.map((cmd): Item => ({ kind: "command", cmd })), ...(ws ? sounds(ws) : [])];
  const shown = fuzzyFilter(query, items, (it) => (it.kind === "command" ? it.cmd.title : it.name), SHOWN);
  const label = (it: Item) => (it.kind === "command" ? it.cmd.title : it.name);

  function run(it: Item | undefined) {
    if (!it) return;
    if (it.kind === "command" && !it.cmd.enabled) {
      // Stay open, so the user sees why nothing ran.
      setNote(`${it.cmd.title} is not available right now.`);
      return;
    }
    onClose();
    if (it.kind === "command") it.cmd.run();
    else onJump(it.key, it.index);
  }

  return (
    <div className="shell-scrim" onMouseDown={onClose}>
      <div className="shell-dialog shell-palette" role="dialog" aria-modal="true" aria-label="Command palette" data-testid="shell-palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          data-testid="shell-palette-input"
          aria-label="Command or sound name"
          placeholder="Type a command or a sound name"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setNote("");
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((a) => Math.min(Math.max(a + step, 0), Math.max(shown.length - 1, 0)));
            } else if (e.key === "Enter") {
              run(shown[active]);
            }
          }}
        />
        {note && <p className="shell-note" role="status">{note}</p>}
        {shown.length === 0 ? (
          <p className="shell-note" data-testid="shell-palette-empty">No matches</p>
        ) : (
          <ul className="shell-list">
            {shown.map((it, n) => (
              <li key={it.kind === "command" ? `c-${it.cmd.id}` : `s-${it.key}-${it.index}`}>
                <button
                  data-testid={`shell-palette-row-${n}`}
                  data-kind={it.kind}
                  aria-current={n === active ? "true" : undefined}
                  title={it.kind === "command" ? it.cmd.keys : it.bank}
                  onClick={() => run(it)}
                >
                  {label(it)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
