// Pure rules for the MIDI browser: where to search, how to read results, where a file comes from. No DOM, no Node, no network.

export type SiteId = "bitmidi" | "midiworld" | "freemidi";

export interface SiteInfo {
  id: SiteId;
  name: string;
  hosts: string[];
}

export interface MidiHit {
  site: SiteId;
  ref: string;
  title: string;
}

export const SITES: SiteInfo[] = [
  { id: "bitmidi", name: "BitMidi", hosts: ["bitmidi.com"] },
  { id: "midiworld", name: "MIDIWorld", hosts: ["www.midiworld.com"] },
  { id: "freemidi", name: "FreeMidi", hosts: ["freemidi.org"] },
];

const siteOf = (site: string): SiteInfo => {
  const s = SITES.find((x) => x.id === site);
  if (!s) throw new Error(`unknown MIDI site ${site}`);
  return s;
};

export function searchUrl(site: string, query: string): string {
  const q = query.trim();
  if (!q) throw new Error("type something to search for");
  const id = siteOf(site).id;
  switch (id) {
    case "bitmidi":
      return `https://bitmidi.com/api/midi/search?q=${encodeURIComponent(q)}&page=0`;
    case "midiworld":
      return `https://www.midiworld.com/search/?q=${encodeURIComponent(q)}`;
    case "freemidi":
      return `https://freemidi.org/search?q=${encodeURIComponent(q)}`;
  }
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

// A page that doesn't match the expected format gives no results, never an error.
export function parseResults(site: string, body: string): MidiHit[] {
  const id = siteOf(site).id;
  if (id === "bitmidi") {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return [];
    }
    const list = (json as { result?: { results?: unknown } } | null)?.result?.results;
    if (!Array.isArray(list)) return [];
    const hits: MidiHit[] = [];
    for (const r of list) {
      const o = r as { id?: unknown; name?: unknown } | null;
      if (!Number.isSafeInteger(o?.id) || typeof o?.name !== "string" || !/\.mid$/i.test(o.name)) continue;
      const title = o.name.replace(/\.mid$/i, "").trim();
      if (title) hits.push({ site: id, ref: String(o.id), title });
    }
    return hits;
  }
  if (id === "midiworld") {
    return [...body.matchAll(/([^\n<>]+?) - <a href="https:\/\/www\.midiworld\.com\/download\/(\d+)"/g)].map((m) => ({
      site: id,
      ref: m[2],
      title: decodeEntities(m[1]).trim(),
    }));
  }
  return [...body.matchAll(/<h5 class=card-title><a href=download3-(\d+-[a-z0-9-]+) title="([^"]*)"/gi)].map((m) => ({
    site: id,
    ref: m[1],
    title: decodeEntities(m[2]).trim(),
  }));
}

// FreeMidi hands out files only after its page has been opened, so that page comes first.
export function downloadRequest(site: string, ref: string): { url: string; pageFirst?: string } {
  const id = siteOf(site).id;
  switch (id) {
    case "bitmidi":
      if (/^\d+$/.test(ref)) return { url: `https://bitmidi.com/uploads/${ref}.mid` };
      break;
    case "midiworld":
      if (/^\d+$/.test(ref)) return { url: `https://www.midiworld.com/download/${ref}` };
      break;
    case "freemidi": {
      const m = /^(\d+)-[a-z0-9][a-z0-9-]*$/i.exec(ref);
      if (m) return { url: `https://freemidi.org/getter-${m[1]}`, pageFirst: `https://freemidi.org/download3-${ref}` };
      break;
    }
  }
  throw new Error(`bad file reference for ${id}`);
}

// Only https on a site's own host; anything else (redirects included) is refused.
export function allowedUrl(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.username && !url.password && !url.port && SITES.some((s) => s.hosts.includes(url.hostname));
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export function safeFileName(title: string): string {
  let base = title.replace(/\.mid$/i, "").replace(/[\x00-\x1f/\\:*?"<>|]/g, "_").replace(/^[\s.]+/, "").slice(0, 80).replace(/[\s.]+$/, "");
  if (!base) base = "Untitled";
  if (RESERVED.test(base)) base = `_${base}`;
  return `${base}.mid`;
}

// The file must start with an SMF header chunk ("MThd").
export function isMidi(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64;
}
