import { useEffect, useRef, useState } from "react";
import { SITES, type MidiHit } from "../../core/midi/sites.ts";
import { candidateFacts, describeCandidate, rankCandidates, titleShare, type Candidate } from "../../core/midi/finder.ts";
import { describeError } from "./keyboard.ts";

interface SongFinderProps {
  // The MIDI Player's own load path (loadBytes), so auto-assign of the owner's sounds runs as usual.
  onLoad: (name: string, bytes: Uint8Array) => void;
}

const MAX_CHECK = 6;
const MAX_BYTES = 2 * 1024 * 1024;
const NONE = "No usable MIDI file found for that name. Try different words or the MIDI Browser.";

// A checked file: its facts, and the library name and bytes that loading it needs.
type Found = Candidate & { ref: { name: string; bytes: Uint8Array } };

export function SongFinder({ onLoad }: SongFinderProps) {
  const [q, setQ] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [ranked, setRanked] = useState<Found[]>([]);
  const [at, setAt] = useState(-1); // index in ranked of the file loaded now
  const cancelRef = useRef(false);
  useEffect(() => () => { cancelRef.current = true; }, []);

  // Loads ranked[i] and names the two after it.
  function loadAt(list: Found[], i: number, note = "") {
    const c = list[i];
    onLoad(c.ref.name, c.ref.bytes);
    const others = list.slice(i + 1, i + 3).map((o) => describeCandidate(o));
    setAt(i);
    setStatus(`Loaded ${describeCandidate(c)}.${others.length ? ` Other matches: ${others.join("; ")}.` : ""}${note}`);
  }

  async function find() {
    const query = q.trim();
    if (!query || running) return;
    cancelRef.current = false;
    setRunning(true);
    setRanked([]);
    setAt(-1);
    setStatus(`Searching for "${query}"...`);
    try {
      const answers = await Promise.allSettled(SITES.map((s) => window.kronos.midiSearch(s.id, query)));
      const hits: MidiHit[] = answers.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      const picks = hits.map((h, i) => ({ h, i, t: titleShare(query, h.title) })).sort((x, y) => y.t - x.t || x.i - y.i).slice(0, MAX_CHECK).map((p) => p.h);
      if (!picks.length) return setStatus(NONE);
      const found: Found[] = [];
      let failed = 0;
      let big = 0;
      for (let i = 0; i < picks.length && !cancelRef.current; i++) {
        const h = picks[i];
        setStatus(`Checking ${i + 1} of ${picks.length}: ${h.title}`);
        try {
          const name = await window.kronos.midiDownload(h.site, h.ref, h.title);
          const bytes = await window.kronos.midiLibraryRead(name);
          if (bytes.length > MAX_BYTES) big++;
          else found.push({ title: h.title, site: h.site, ...candidateFacts(bytes), ref: { name, bytes } });
        } catch {
          failed++;
        }
      }
      if (cancelRef.current) return setStatus("Cancelled. Nothing was loaded.");
      const list = rankCandidates(query, found);
      const notes = `${failed ? ` ${failed} failed to download or parse.` : ""}${big ? ` ${big} over 2 MB skipped.` : ""}`;
      if (!list.length) return setStatus(`${NONE}${notes}`);
      setRanked(list);
      loadAt(list, 0, notes);
    } catch (e) {
      setStatus(describeError(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <form className="buttons song-finder" data-testid="song-form" onSubmit={(e) => { e.preventDefault(); void find(); }}>
      <input
        data-testid="song-query"
        type="text"
        aria-label="Song name"
        placeholder="Song name, e.g. Livin' on a Prayer Bon Jovi"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <button type="submit" data-testid="song-find" disabled={running || !q.trim()}>Find and load</button>
      {running && <button type="button" data-testid="song-cancel" onClick={() => { cancelRef.current = true; }}>Cancel</button>}
      {!running && at >= 0 && at < ranked.length - 1 && (
        <button type="button" data-testid="song-next" onClick={() => loadAt(ranked, at + 1)}>Try next</button>
      )}
      {status && <p className="status" data-testid="song-status">{status}</p>}
    </form>
  );
}
