// Drum Kit note map: 128 notes laid out in octaves like a keyboard. Each note shows how many of its zones are on; a click selects it.
import { useMemo } from "react";
import { drumMap } from "../../core/params/graphs2.ts";
import type { ParamTables } from "../../core/params/params.ts";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK = [1, 3, 6, 8, 10];
const noteName = (n: number) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

export function DrumMap({ tables, entry, selected, onSelect }: { tables: ParamTables; entry: Uint8Array; selected: number | null; onSelect: (note: number) => void }) {
  const notes = useMemo(() => drumMap(tables, entry), [tables, entry]);
  return (
    <div className="dm" data-testid="drum-map">
      {notes.map(({ note, zones }) => {
        const on = zones.filter((z) => z.on).length;
        return (
          <button
            key={note}
            data-testid={`drum-note-${note}`}
            className={`dm-note${BLACK.includes(note % 12) ? " black" : ""}${on ? " on" : ""}`}
            aria-pressed={selected === note}
            aria-label={`Note ${noteName(note)}, ${on} of 8 zones on`}
            title={noteName(note)}
            onClick={() => onSelect(note)}
          >
            {on > 0 && <span className="dm-count">{on}</span>}
          </button>
        );
      })}
    </div>
  );
}
