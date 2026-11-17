// Matches a song title or file name to Program and Combi names, and suggests a sound for a MIDI channel. Pure: no DOM or Node imports.
// Names are normalised once in buildIndex; queries never normalise the library again.

export type SoundRef = { key: string; index: number; name: string; kind: "program" | "combi" };
export type Match = SoundRef & { score: number };

interface Entry {
  ref: SoundRef;
  norm: string; // lower-case words joined by one space
  words: Set<string>;
}

export interface SoundIndex {
  readonly entries: Entry[];
}

// Score classes: exact title 1, every significant word present 0.9, partial at most 0.5.
const ALL_WORDS = 0.9;
const LONE_WORD = 0.7; // a suggestion only: below the confident level, so Play never switches to it by itself
const PARTIAL_MAX = 0.5;
const MIN_WORD = 3;

// Words that say nothing about which sound a file means. Matching never uses these alone.
const STOP = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "with", "by", "from", "at", "is", "it",
  "midi", "mid", "song", "songs", "cover", "version", "remix", "live", "piano", "organ", "guitar",
  "instrumental", "karaoke", "arrangement", "edit", "mix", "track", "theme", "original", "full", "demo", "vocal", "vocals",
]);

// Lower-case words, with apostrophes dropped and every other separator or punctuation mark turned into a space.
function words(s: string): string[] {
  return s.toLowerCase().replace(/['’`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
}

// Significant words: at least three characters, and for song titles not a stop word.
function significant(ws: string[], song: boolean): string[] {
  return ws.filter((w) => w.length >= MIN_WORD && (!song || !STOP.has(w)));
}

// One changed, added or dropped letter between words of five letters or more (Heals, Heels).
function oneEdit(a: string, b: string): boolean {
  if (a === b || Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1);
}

// Candidate titles: the part before a bracket, one entry per " - " segment, extension removed.
export function candidateTitles(title: string): string[] {
  let s = title.trim().replace(/\.(mid|midi|kar)$/i, "");
  const bracket = s.search(/[(\[]/);
  if (bracket > 0) s = s.slice(0, bracket);
  const out = new Set<string>();
  for (const seg of s.split(/\s+[-–—]\s+/)) {
    const norm = words(seg).join(" ");
    if (norm) out.add(norm);
  }
  return [...out];
}

export function buildIndex(sounds: SoundRef[]): SoundIndex {
  return {
    entries: sounds.map((s) => {
      const ws = words(s.name);
      return { ref: { key: s.key, index: s.index, name: s.name, kind: s.kind }, norm: ws.join(" "), words: new Set(ws) };
    }),
  };
}

// Best score of one candidate (already normalised) against one entry, 0 for no match.
function scoreOf(cand: string, sig: string[], e: Entry, exactOnly: boolean, song: boolean): number {
  if (e.norm === cand) return 1;
  if (exactOnly) return 0;
  // A song title with one real word is weak. All of it must lead the sound's name, so Love Song is not Send Her My Love Piano. Instrument words (Bass) can sit anywhere.
  if (song && sig.length === 1) return e.norm.startsWith(`${cand} `) ? LONE_WORD : 0;
  let hit = 0;
  for (const w of sig) if (e.words.has(w) || [...e.words].some((x) => oneEdit(w, x))) hit++;
  if (hit === sig.length) return ALL_WORDS;
  // Partial needs two shared words and most of the candidate's words, so a single shared word never matches.
  if (hit >= 2 && hit / sig.length >= 0.75) return (PARTIAL_MAX * hit) / sig.length;
  return 0;
}

function rank(cands: string[], idx: SoundIndex, song = false): Match[] {
  // In "Artist - Title" the earlier segments are the artist, so a lone word there (Journey) only counts when it is a whole sound name.
  const usable = cands.map((c) => ({ c, sig: significant(c.split(" "), song) })).filter((x) => x.sig.length > 0)
    .map((x, i, all) => ({ ...x, exactOnly: all.length > 1 && x.sig.length === 1 && i < all.length - 1 }));
  if (usable.length === 0) return [];
  const out: Match[] = [];
  for (const e of idx.entries) {
    let best = 0;
    for (const { c, sig, exactOnly } of usable) {
      const s = scoreOf(c, sig, e, exactOnly, song);
      if (s > best) best = s;
      if (best === 1) break;
    }
    if (best > 0) out.push({ key: e.ref.key, index: e.ref.index, name: e.ref.name, kind: e.ref.kind, score: best });
  }
  // Stable sort: equal scores keep the order the sounds were indexed in.
  return out.sort((a, b) => b.score - a.score);
}

export function matchSong(title: string, idx: SoundIndex): Match[] {
  return rank(candidateTitles(title), idx, true);
}

const GM_NAMES = [
  "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)", "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar harmonics",
  "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  "String Ensemble 1", "String Ensemble 2", "SynthStrings 1", "SynthStrings 2", "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "SynthBrass 1", "SynthBrass 2",
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)", "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
  "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)", "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
  "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)", "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
  "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai",
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot",
];
const FAMILIES = ["Piano", "Chromatic Percussion", "Organ", "Guitar", "Bass", "Strings", "Ensemble", "Brass", "Reed", "Pipe", "Synth Lead", "Synth Pad", "Synth Effects", "Ethnic", "Percussive", "Sound Effects"];

// General MIDI 1 program number (0..127) to its standard name and one of 16 families.
export function gmInstrument(program: number): { name: string; family: string } {
  if (!Number.isInteger(program) || program < 0 || program > 127) throw new RangeError(`GM program ${program} is out of range`);
  return { name: GM_NAMES[program], family: FAMILIES[program >> 3] };
}

// Track name first, else the GM instrument's name, else its family. Null when nothing matches.
export function suggestSound(ch: { trackName: string | null; program: number | null }, idx: SoundIndex): Match | null {
  if (ch.trackName) {
    const m = rank([words(ch.trackName).join(" ")], idx)[0];
    if (m) return m;
  }
  if (ch.program !== null) {
    const gm = gmInstrument(ch.program);
    return rank([words(gm.name).join(" ")], idx)[0] ?? rank([words(gm.family).join(" ")], idx)[0] ?? null;
  }
  return null;
}

const DRUM_CHANNEL = 9;

// Programs only, best first: the track name, then the GM name, then the GM family. Channel 10 is drums: Programs with Kit or Drum in the name.
export function suggestSounds(ch: { channel: number; trackName: string | null; program: number | null }, idx: SoundIndex, limit = 8): Match[] {
  if (ch.channel === DRUM_CHANNEL) {
    const kits = idx.entries.filter((e) => e.ref.kind === "program" && /\b(kit|drum)/i.test(e.ref.name));
    return kits.slice(0, limit).map((e) => ({ ...e.ref, score: ALL_WORDS }));
  }
  const cands = [ch.trackName ? words(ch.trackName).join(" ") : "", ch.program !== null ? words(gmInstrument(ch.program).name).join(" ") : "", ch.program !== null ? words(gmInstrument(ch.program).family).join(" ") : ""];
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const c of cands.filter(Boolean)) {
    for (const m of rank([c], idx)) {
      const k = `${m.key}/${m.index}`;
      if (m.kind !== "program" || seen.has(k)) continue;
      seen.add(k);
      out.push(m);
    }
  }
  return out.slice(0, limit);
}

// Every query word must be part of a Program's name (pia finds Grand Piano). Combis are never listed.
export function searchPrograms(query: string, idx: SoundIndex, limit = 30): Match[] {
  const q = words(query);
  if (q.length === 0) return [];
  const out: Match[] = [];
  for (const e of idx.entries) {
    if (e.ref.kind !== "program" || !q.every((w) => e.norm.includes(w))) continue;
    out.push({ ...e.ref, score: e.norm === q.join(" ") ? 1 : ALL_WORDS });
    if (out.length === limit) break;
  }
  return out.sort((a, b) => b.score - a.score);
}
