// Pure queue logic for the MIDI Library playlist. Every function returns a new Queue. No DOM or Node imports.

export interface Queue {
  items: string[];
  current: number | null; // null = stopped or finished
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  played: number[]; // indices already played in this shuffle round
}

export const emptyQueue = (): Queue => ({ items: [], current: null, shuffle: false, repeat: "off", played: [] });

export const addTrack = (q: Queue, name: string): Queue => ({ ...q, items: [...q.items, name] });

export function removeTrack(q: Queue, i: number): Queue {
  if (!Number.isInteger(i) || i < 0 || i >= q.items.length) return q;
  const shift = (n: number) => (n > i ? n - 1 : n);
  return {
    ...q,
    items: q.items.filter((_, j) => j !== i),
    current: q.current === null || q.current === i ? null : shift(q.current),
    played: q.played.filter((n) => n !== i).map(shift),
  };
}

export function moveTrack(q: Queue, from: number, to: number): Queue {
  const n = q.items.length;
  if (![from, to].every((v) => Number.isInteger(v) && v >= 0 && v < n) || from === to) return q;
  // Where the song that sat at index k ends up.
  const at = (k: number) => {
    if (k === from) return to;
    let c = k;
    if (from < c) c--;
    if (to <= c) c++;
    return c;
  };
  const items = [...q.items];
  items.splice(to, 0, ...items.splice(from, 1));
  return { ...q, items, current: q.current === null ? null : at(q.current), played: q.played.map(at) };
}

const pick = (n: number, rnd: () => number) => Math.min(n - 1, Math.floor(rnd() * n));

export function begin(q: Queue, rnd: () => number): Queue {
  if (!q.items.length) return { ...q, current: null, played: [] };
  const current = q.shuffle ? pick(q.items.length, rnd) : 0;
  return { ...q, current, played: [current] };
}

export function advance(q: Queue, rnd: () => number, auto: boolean): Queue {
  if (q.current === null) return q;
  if (q.repeat === "one" && auto) return q;
  const n = q.items.length;
  if (q.shuffle) {
    const left = q.items.map((_, i) => i).filter((i) => !q.played.includes(i));
    if (left.length) {
      const current = left[pick(left.length, rnd)];
      return { ...q, current, played: [...q.played, current] };
    }
    if (q.repeat === "all" && n) {
      const current = pick(n, rnd);
      return { ...q, current, played: [current] };
    }
    return { ...q, current: null };
  }
  const next = q.current + 1;
  if (next < n) return { ...q, current: next, played: [...q.played, next] };
  return q.repeat === "all" && n ? { ...q, current: 0, played: [0] } : { ...q, current: null };
}

export function retreat(q: Queue): Queue {
  if (q.current === null) return q;
  if (q.current > 0) return { ...q, current: q.current - 1 };
  return q.repeat === "all" ? { ...q, current: q.items.length - 1 } : q;
}

// A plain *.mid file name: no path characters, no empty stem.
export const isPlaylistName = (v: unknown): v is string => typeof v === "string" && v.length <= 196 && /^[^\\/:*?"<>|\0]+\.midi?$/i.test(v) && v !== "..";

export function parsePlaylist(json: unknown): string[] {
  const items = (json as { items?: unknown } | null | undefined)?.items;
  return Array.isArray(items) ? items.filter(isPlaylistName) : [];
}

export const serializePlaylist = (items: string[]): string => JSON.stringify({ version: 1, items });
