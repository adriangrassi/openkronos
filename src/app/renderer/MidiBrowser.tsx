import { useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import { usePlaylist } from "./Playlist.tsx";
import { SITES, type MidiHit, type SiteId } from "../../core/midi/sites.ts";
import { matchSong, type SoundIndex } from "../../core/midi/match.ts";
import { describeError } from "./keyboard.ts";
import { soundLabel } from "./midimatch.ts";
import type { MidiLibraryEntry } from "../shared/api.ts";

interface MidiBrowserProps {
  canPlay: boolean;
  // Loads the bytes as the player's current file and plays them through the player's Play path.
  onPlay: (name: string, bytes: Uint8Array) => boolean;
  onStop: () => void;
  endRef: MutableRefObject<(() => void) | null>;
  onError: (msg: string | null) => void;
  ask: (message: string, okLabel: string, run: () => void | Promise<void>) => void;
  soundIdx: SoundIndex | null;
  // Selects a slot in the bank list.
  onPick: (key: string, index: number) => void;
}

type Tab = "search" | "library";

const siteName = (id: SiteId) => SITES.find((s) => s.id === id)?.name ?? id;
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export function MidiBrowser({ canPlay, onPlay, onStop, endRef, onError, ask, soundIdx, onPick }: MidiBrowserProps) {
  const [tab, setTab] = useState<Tab>("search");
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Record<SiteId, boolean>>({ bitmidi: true, midiworld: true, freemidi: true });
  const [hits, setHits] = useState<MidiHit[]>([]);
  const [failed, setFailed] = useState<SiteId[]>([]);
  const [searching, setSearching] = useState(false);
  const [library, setLibrary] = useState<MidiLibraryEntry[]>([]);
  const [libQ, setLibQ] = useState("");
  const [busy, setBusy] = useState(false);

  const pl = usePlaylist({ canPlay, onPlay, onStop, endRef, onError });

  const refresh = async () => {
    try {
      setLibrary(await window.kronos.midiLibraryList());
    } catch (e) {
      onError(describeError(e));
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One guarded action: errors go to the shared message line, and the library list refreshes after it.
  async function act<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    onError(null);
    try {
      return await fn();
    } catch (e) {
      onError(describeError(e));
      return undefined;
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  // One request per checked site, in parallel. A failed site leaves a note and the others still show.
  async function search() {
    const sites = SITES.filter((s) => checked[s.id]);
    if (!q.trim() || sites.length === 0) return;
    setSearching(true);
    onError(null);
    const results = await Promise.allSettled(sites.map((s) => window.kronos.midiSearch(s.id, q)));
    const found: MidiHit[] = [];
    const fails: SiteId[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") found.push(...r.value);
      else fails.push(sites[i].id);
    });
    setHits(found);
    setFailed(fails);
    setSearching(false);
  }

  async function playName(name: string) {
    const bytes = await act(() => window.kronos.midiLibraryRead(name));
    if (bytes) {
      pl.release();
      onPlay(name, bytes);
    }
  }

  async function playHit(h: MidiHit) {
    const name = await act(() => window.kronos.midiDownload(h.site, h.ref, h.title));
    if (name) await playName(name);
  }

  const libRows = library.filter((f) => f.name.toLowerCase().includes(libQ.trim().toLowerCase()));
  // Best match per title, computed when the results or the sound index change, not on every keystroke.
  const hitMatch = useMemo(() => hits.map((h) => (soundIdx ? matchSong(h.title, soundIdx)[0] ?? null : null)), [hits, soundIdx]);
  const libMatch = useMemo(() => new Map(library.map((f) => [f.name, soundIdx ? matchSong(f.name, soundIdx)[0] ?? null : null])), [library, soundIdx]);

  return (
    <div className="midi-browser" aria-label="MIDI browser">
      <div className="midi-tabs" role="tablist">
        <button role="tab" data-testid="midi-tab-search" aria-selected={tab === "search"} onClick={() => setTab("search")}>Search</button>
        <button role="tab" data-testid="midi-tab-library" aria-selected={tab === "library"} onClick={() => { setTab("library"); void refresh(); }}>Library</button>
      </div>

      {tab === "search" && (
        <>
          <form className="midi-search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <input data-testid="midi-q" type="search" aria-label="Search MIDI files" placeholder="Song or artist" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" data-testid="midi-q-go" disabled={searching}>{searching ? "Searching..." : "Search"}</button>
          </form>
          <div className="midi-sites">
            {SITES.map((s) => (
              <label key={s.id} className="check">
                <input type="checkbox" data-testid={`midi-site-${s.id}`} checked={checked[s.id]} onChange={(e) => setChecked({ ...checked, [s.id]: e.target.checked })} />
                {s.name}
              </label>
            ))}
          </div>
          {failed.map((id) => (
            <p key={id} className="muted" data-testid={`midi-site-fail-${id}`}>{siteName(id)} did not answer. The other sites are shown.</p>
          ))}
          <ul className="midi-list">
            {hits.map((h, i) => (
              <li key={`${h.site}:${h.ref}`} className="midi-row" data-testid={`midi-hit-row-${i}`}>
                <span className="midi-title">{h.title}</span>
                <span className="muted">{siteName(h.site)}</span>
                <button data-testid={`midi-hit-save-${i}`} onClick={() => void act(() => window.kronos.midiDownload(h.site, h.ref, h.title))} disabled={busy}>Download</button>
                <button data-testid={`midi-hit-play-${i}`} onClick={() => void playHit(h)} disabled={!canPlay || busy}>Play</button>
                {hitMatch[i] && (
                  <button data-testid={`midimatch-hit-${i}`} onClick={() => onPick(hitMatch[i]!.key, hitMatch[i]!.index)}>Match: {soundLabel(hitMatch[i]!)}</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "library" && (
        <>
          <div className="midi-search">
            <input data-testid="midi-lib-q" type="search" aria-label="Filter the MIDI library" placeholder="Filter" value={libQ} onChange={(e) => setLibQ(e.target.value)} />
            <button data-testid="midi-lib-import" onClick={() => void act(() => window.kronos.midiLibraryImport())} disabled={busy}>Add File...</button>
          </div>
          {pl.panel}
          <p className="muted"><span data-testid="midi-lib-count">{library.length}</span> files in the library</p>
          <ul className="midi-list">
            {libRows.map((f, i) => {
              const m = libMatch.get(f.name) ?? null;
              return (
              <li key={f.name} className="midi-row" data-testid={`midi-lib-row-${i}`}>
                <span className="midi-title">{f.name}</span>
                <span className="muted">{kb(f.size)}</span>
                <button data-testid={`playlist-add-${i}`} onClick={() => pl.add(f.name)}>Add to playlist</button>
                <button data-testid={`midi-lib-play-${i}`} onClick={() => void playName(f.name)} disabled={!canPlay || busy}>Play</button>
                {m && <button data-testid={`midimatch-lib-${i}`} onClick={() => onPick(m.key, m.index)}>Match: {soundLabel(m)}</button>}
                <button
                  data-testid={`midi-lib-del-${i}`}
                  disabled={busy}
                  onClick={() => ask(`Delete ${f.name} from the MIDI library?`, "Delete", () => act(() => window.kronos.midiLibraryDelete(f.name)))}
                >
                  Delete
                </button>
              </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
