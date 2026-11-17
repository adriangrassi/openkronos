import { useState } from "react";
import type { Match } from "../../core/midi/match.ts";
import { soundLabel } from "./midimatch.ts";
import "./MidiMatch.css";

export interface ChannelRow {
  channel: number; // 0..15
  trackName: string | null;
  sound: Match | null;
  gm: string | null; // the file's General MIDI instrument, when that is what the track will play
  picked: boolean; // the user's pick (normal text) rather than a suggestion (muted)
}

interface MidiMatchProps {
  song: Match | null; // best match for the loaded file's name
  useSong: boolean;
  onUseSong: (on: boolean) => void;
  status: string; // empty unless Play used the song match, or the per-track line
  statusTitle?: string;
  channels: ChannelRow[] | null; // null when no file is loaded
  canPlay: boolean;
  onUse: (channel: number, sound: Match) => void;
  onRevert: (channel: number) => void;
  onSearch: (query: string) => Match[];
  onBest: (channel: number) => Match[];
  onAssign: (channel: number, sound: Match) => void;
}

// The song match, the "Use matching sound" choice, the status line and the per-channel rows with their sound search.
export function MidiMatch({ song, useSong, onUseSong, status, statusTitle, channels, canPlay, onUse, onRevert, onSearch, onBest, onAssign }: MidiMatchProps) {
  const [query, setQuery] = useState<Record<number, string>>({});
  // One result list is open at a time, under its row.
  const [open, setOpen] = useState<{ channel: number; list: Match[] } | null>(null);
  return (
    <div className="midimatch">
      <label className="check">
        <input type="checkbox" data-testid="midimatch-use" checked={useSong} onChange={(e) => onUseSong(e.target.checked)} />
        Use matching sound
      </label>
      {song && <p data-testid="midimatch-song" className="midimatch-line">Song match: {soundLabel(song)}</p>}
      <p data-testid="midimatch-status" className="midimatch-line muted" title={statusTitle}>{status}</p>
      {channels && channels.length > 0 && (
        <ul className="midimatch-channels" aria-label="Channels">
          {channels.map((c) => {
            const n = c.channel + 1;
            const q = query[c.channel] ?? "";
            return (
              <li key={c.channel} className="midimatch-row" data-testid={`midimatch-ch-${n}`}>
                <div className="midimatch-channel">
                  <span className="muted">Ch {n}</span>
                  <span data-testid={`midimatch-ch-track-${n}`}>{c.trackName ?? ""}</span>
                  <span data-testid={`midimatch-ch-sound-${n}`} className={c.picked ? undefined : "muted"}>
                    {c.sound ? soundLabel(c.sound) : c.gm ? `GM: ${c.gm}` : "file's own"}
                  </span>
                  <button data-testid={`midimatch-ch-use-${n}`} disabled={!canPlay || !c.sound} onClick={() => c.sound && onUse(c.channel, c.sound)}>
                    Use
                  </button>
                </div>
                <div className="midimatch-find">
                  <input
                    type="search"
                    data-testid={`tracks-search-${n}`}
                    aria-label={`Search sounds for channel ${n}`}
                    placeholder="Search sounds"
                    value={q}
                    onChange={(e) => {
                      const text = e.target.value;
                      setQuery((all) => ({ ...all, [c.channel]: text }));
                      setOpen(text.trim() ? { channel: c.channel, list: onSearch(text) } : null);
                    }}
                  />
                  {c.picked && <button data-testid={`tracks-revert-${n}`} title="Back to the instrument in the file" onClick={() => onRevert(c.channel)}>Revert</button>}
                  <button data-testid={`tracks-best-${n}`} onClick={() => setOpen({ channel: c.channel, list: onBest(c.channel) })}>Best</button>
                </div>
                {open?.channel === c.channel && (
                  <ul className="midimatch-results" aria-label={`Sounds for channel ${n}`}>
                    {open.list.map((m, i) => (
                      <li key={`${m.key}/${m.index}`}>
                        <button
                          data-testid={`tracks-result-${n}-${i}`}
                          onClick={() => {
                            onAssign(c.channel, m);
                            setQuery((all) => ({ ...all, [c.channel]: "" }));
                            setOpen(null);
                          }}
                        >
                          {soundLabel(m)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
