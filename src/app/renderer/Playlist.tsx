import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { addTrack, advance, begin, emptyQueue, moveTrack, removeTrack, retreat, type Queue } from "../../core/midi/playlist.ts";
import { describeError } from "./keyboard.ts";
import "./Playlist.css";

interface Opts {
  canPlay: boolean;
  onPlay: (name: string, bytes: Uint8Array) => boolean;
  onStop: () => void;
  // MidiPanel calls this when a song from the file ends on its own.
  endRef: MutableRefObject<(() => void) | null>;
  onError: (msg: string | null) => void;
}

const NEXT_REPEAT = { off: "all", all: "one", one: "off" } as const;

// shortcut: the queue lives only while the MIDI browser is open (it stops advancing when closed), when it should outlive it move this state up to MidiPanel
export function usePlaylist({ canPlay, onPlay, onStop, endRef, onError }: Opts): { add: (name: string) => void; release: () => void; panel: ReactNode } {
  const [q, setQ] = useState<Queue>(emptyQueue);
  const qRef = useRef(q);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const token = useRef(0);
  const edited = useRef(false);
  const playing = useRef<string | null>(null); // the song actually sounding, even after its row is removed
  const orphan = useRef<number | null>(null); // where the playing song's row was, when it was removed mid-song
  const rows = useRef<(HTMLLIElement | null)[]>([]);

  const set = (next: Queue) => {
    qRef.current = next;
    setQ(next);
  };
  const edit = (next: Queue) => {
    edited.current = true;
    set(next);
    window.kronos.playlistSave(next.items).catch((e) => onError(describeError(e)));
  };

  useEffect(() => {
    window.kronos.playlistLoad().then((items) => {
      if (!edited.current) return set({ ...qRef.current, items });
      // shortcut: an edit made before the load returned is appended after the saved list (a removal made then is lost), upgrade by loading before enabling edits
      edit({ ...qRef.current, items: [...items, ...qRef.current.items] });
    }, (e) => onError(describeError(e)));
    return () => {
      endRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Plays the queue's current song. A file that cannot be read is skipped with a note, up to one lap.
  async function go(start: Queue, back = false) {
    const mine = ++token.current;
    let next = start;
    for (let tries = 0; tries <= start.items.length; tries++) {
      if (next.current === null) break;
      const name = next.items[next.current];
      try {
        const bytes = await window.kronos.midiLibraryRead(name);
        if (mine !== token.current) return;
        if (!onPlay(name, bytes)) throw new Error("not playable");
        set(next);
        playing.current = name;
        orphan.current = null;
        setSkipped((s) => s.filter((n) => n !== name));
        return;
      } catch (e) {
        if (mine !== token.current) return;
        const why = e instanceof Error && e.message === "not playable" ? "could not be played" : "file is missing";
        setSkipped((s) => [...s, name]);
        setNote(`Skipped ${name}: ${why}`);
        next = back ? retreat(next) : advance(next, Math.random, false);
      }
    }
    set({ ...next, current: null });
    playing.current = null;
    orphan.current = null;
    onStop();
  }

  // The next queue position; after the playing row was removed it carries on from where that row was.
  function following(auto: boolean): Queue {
    const q = qRef.current, o = orphan.current;
    if (q.current !== null || o === null) return advance(q, Math.random, auto);
    if (!q.items.length) return q;
    return o === 0 ? { ...q, current: 0, played: [0] } : advance({ ...q, current: o - 1 }, Math.random, auto);
  }
  function previous(): Queue {
    const q = qRef.current, o = orphan.current;
    return q.current === null && o !== null && q.items.length ? retreat({ ...q, current: Math.min(o, q.items.length - 1) }) : retreat(q);
  }

  endRef.current = () => {
    if (qRef.current.current !== null || orphan.current !== null) void go(following(true));
  };

  const stop = () => {
    token.current++;
    playing.current = null;
    orphan.current = null;
    set({ ...qRef.current, current: null });
    onStop();
  };
  // A hand-picked song ends the queue run without touching the keyboard.
  const release = () => {
    token.current++;
    playing.current = null;
    orphan.current = null;
    if (qRef.current.current !== null) set({ ...qRef.current, current: null });
  };

  function drag(from: number, e: ReactPointerEvent<HTMLElement>) {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const done = () => {
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", done);
      el.removeEventListener("lostpointercapture", done);
    };
    const up = (ev: PointerEvent) => {
      done();
      const mids = rows.current.map((r) => (r ? r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2 : 0));
      const to = mids.filter((m, j) => j !== from && m < ev.clientY).length;
      if (to !== from) edit(moveTrack(qRef.current, from, to));
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", done);
    el.addEventListener("lostpointercapture", done);
  }

  function remove(i: number) {
    if (qRef.current.current === i) orphan.current = i;
    edit(removeTrack(qRef.current, i));
  }

  const cur = q.current === null ? playing.current : q.items[q.current];
  const running = cur !== null;
  const panel = (
    <section className="pl" data-testid="playlist-panel" aria-label="Playlist">
      <div className="pl-bar">
        <strong>Playlist</strong>
        <button data-testid="playlist-play-all" onClick={() => void go(begin(qRef.current, Math.random))} disabled={!canPlay || !q.items.length}>Play All</button>
        <button data-testid="playlist-stop" onClick={stop}>Stop</button>
        <button data-testid="playlist-prev" onClick={() => void go(previous(), true)} disabled={!running}>Previous</button>
        <button data-testid="playlist-next" onClick={() => void go(following(false))} disabled={!running}>Next</button>
        <button data-testid="playlist-shuffle" aria-pressed={q.shuffle} onClick={() => set({ ...qRef.current, shuffle: !qRef.current.shuffle })}>Shuffle</button>
        <button data-testid="playlist-repeat" data-repeat={q.repeat} onClick={() => set({ ...qRef.current, repeat: NEXT_REPEAT[qRef.current.repeat] })}>Repeat: {q.repeat}</button>
      </div>
      <p className="pl-now" data-testid="playlist-current">{cur ? `Now playing: ${cur}` : "Stopped"}</p>
      <p className="muted" data-testid="playlist-note">{note}</p>
      <ul className="pl-list">
        {q.items.map((name, i) => (
          <li key={i} ref={(r) => { rows.current[i] = r; }} className="pl-row" data-testid={`playlist-row-${i}`} data-current={q.current === i}>
            <span className="pl-handle" role="button" aria-label={`Drag ${name}`} data-testid={`playlist-handle-${i}`} onPointerDown={(e) => drag(i, e)}>::</span>
            <span className="pl-title" data-testid={`playlist-title-${i}`}>{name}</span>
            <button data-testid={`playlist-remove-${i}`} onClick={() => remove(i)}>Remove</button>
            {skipped.includes(name) && <span className="pl-skip muted" data-testid={`playlist-skip-${i}`}>missing, skipped</span>}
          </li>
        ))}
      </ul>
    </section>
  );

  return { add: (name) => {
      setSkipped((s) => s.filter((n) => n !== name));
      edit(addTrack(qRef.current, name));
    }, release, panel };
}
