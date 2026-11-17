// Turns the text of KORG's Parameter Guide (private, never committed) into short help entries. Pure: no node: imports.
// The PDF text is two columns per page, side by side on each line; a parameter is "Label   [range]" followed by its description.

export type HelpMode = "program" | "exi" | "combi" | "global";
export type HelpEntry = {
  mode: HelpMode;
  engine?: string;
  tab: string; // "3-4"
  tabTitle: string; // "Filter1 EG"
  sub: string; // heading of the lettered part on the tab ("Level Modulation"), or ""
  section: string; // last plain heading before the label ("Level"), or ""
  label: string;
  text: string;
  page: number; // the guide's printed page number
};
export type HelpAlias = { mode: HelpMode; from: string; to: string };
export type HelpData = { entries?: HelpEntry[]; aliases?: HelpAlias[] };

const MAX_CHARS = 400;
const ch = (...c: number[]): string => String.fromCharCode(...c);
// The guide's soft hyphens (173) are its dashes and minus signs, the middle dot (183) its bullets; anything else odd is dropped.
const DASHES = new RegExp(`[${ch(0xad, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212)}]`, "g");
const BULLETS = new RegExp(`[${ch(0xb7, 0x2022)}]`, "g");
const QUOTE1 = new RegExp(`[${ch(0x2018, 0x2019)}]`, "g");
const QUOTE2 = new RegExp(`[${ch(0x201c, 0x201d)}]`, "g");

export function clean(s: string): string {
  return s.replace(DASHES, "-").replace(BULLETS, "-").replace(QUOTE1, "'").replace(QUOTE2, '"').replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim();
}

// Cuts at a sentence end within the limit; one long sentence is cut at a word instead.
export function trimText(s: string, max = MAX_CHARS): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const ends = [...cut.matchAll(/[.!?](?=\s|$)/g)].map((x) => x.index + 1).filter((i) => i <= max);
  if (ends.length > 0 && ends[ends.length - 1] > 60) return cut.slice(0, ends[ends.length - 1]).trim();
  return `${s.slice(0, max).replace(/\s+\S*$/, "")}...`;
}

// Column start: the most common position where text follows a wide gap, if no word crosses it.
export function splitColumn(lines: string[]): number | null {
  const starts = new Map<number, number>();
  for (const l of lines) {
    for (const m of l.matchAll(/\S\s{3,}(?=\S)/g)) {
      const x = m.index + m[0].length;
      if (x >= 40 && x <= 100) starts.set(x, (starts.get(x) ?? 0) + 1);
    }
  }
  let best = -1;
  let n = 0;
  for (const [x, c] of starts) if (c > n || (c === n && x < best)) [best, n] = [x, c];
  if (n < 4) return null;
  const crossing = lines.filter((l) => l.length > best && /\S/.test(l[best - 1] ?? " ") && /\S/.test(l[best] ?? " ")).length;
  return crossing > 2 ? null : best;
}

const HEAD_TAB = /^(\d{1,2})-(\d{1,2})([a-z]?)\s*:\s*(.+)$/;
const RANGE = /^([A-Za-z0-9][^[\]]{0,58}?)\s+(\[.*\])$/;
const PAGE_HEADER = /^(?:(?:EXi )?(?:Program|Combination|Global|Sequencer|Set List|Sampling|Disk) P\d+: [^:]+(?: \d+-\d+: .+)?|Program mode: .+|Combination mode|Global mode|Sequencer mode|EXi: .+|\d+-\d+[a-z]?(?:PMC)?)$/;
const SAME = /identical to those for .*?described under "(\d+-\d+):/;

const MODE_HEAD: [RegExp, HelpMode | "other"][] = [
  [/^Program mode: HD-/, "program"],
  [/^(Program mode: EXi|EXi:)/, "exi"],
  [/^Combination mode/, "combi"],
  [/^Global mode/, "global"],
  [/^(Sequencer mode|Set List mode|Sampling mode|Disk mode|Effect Guide|KARMA GE guide|Appendices|MIDI applications)/, "other"],
];

const PROSE = (p: string): boolean => p.length >= 25 && (p.match(/\b[a-z]{2,}\b/g)?.length ?? 0) >= 5 && !/^\d/.test(p);
const ENDS = (p: string): boolean => /[.!?:")]$/.test(p);

// The paragraph after line i (the blank line, then lines up to the next blank).
function nextPara(ls: string[], i: number): string {
  const out: string[] = [];
  for (let j = i + 1; j < ls.length; j++) {
    if (ls[j] === "") {
      if (out.length > 0) break;
      continue;
    }
    out.push(ls[j]);
  }
  return out.join(" ");
}

export function parseGuide(guide: string, maxChars = MAX_CHARS): { entries: HelpEntry[]; aliases: HelpAlias[] } {
  const entries: HelpEntry[] = [];
  const aliases: HelpAlias[] = [];
  const pages = guide.replace(/\r/g, "").split("\f");
  let mode: HelpMode | "other" | null = null;
  let engine: string | undefined;
  let printed = 0;
  let tab = "";
  let tabTitle = "";
  let sub = "";
  let section = "";
  let skip = false;
  let pending: { e: HelpEntry; paras: string[]; open: boolean } | null = null;
  let para: string[] = [];
  let top = false; // the paragraph being read opens its column
  let colParas = 0;
  const seen = new Set<string>();
  type Ctx = { tab: string; tabTitle: string; sub: string; section: string };
  // Two or more tabs that are only prose at the end of a column (Filter2, Filter2 Modulation...): the next column goes on with the tab before them.
  let before: Ctx | null = null;
  let bare = 0;
  let carry: Ctx | null = null;

  const flushEntry = () => {
    if (!pending) return;
    const { e, paras } = pending;
    pending = null;
    const text = trimText(clean(paras.join(" ")), maxChars);
    // a bare pointer to another section says nothing about the parameter
    if (text.length >= 20 && !/^(These|The) (parameters|settings) (are|is) (the same|identical)/i.test(text)) entries.push({ ...e, text });
  };
  const endPara = () => {
    if (para.length === 0) return;
    const p = clean(para.join(" "));
    const opens = top;
    para = [];
    colParas++;
    const same = SAME.exec(p);
    if (same && mode && mode !== "other") {
      // the second oscillator's tabs sit four after the first one's (3-5 repeats 3-1)
      const [pg, mi] = same[1].split("-").map(Number);
      const from = `${pg}-${mi + 4}`;
      if (seen.has(`${mode}|${from}`) && !aliases.some((a) => a.mode === mode && a.from === from)) aliases.push({ mode, from, to: same[1] });
    }
    if (!pending?.open) return;
    const last = pending.paras[pending.paras.length - 1];
    // a paragraph cut by a column end goes on at the top of the next column
    if (last !== undefined && opens && !ENDS(last)) pending.paras[pending.paras.length - 1] = `${last} ${p}`;
    else if (PROSE(p) && pending.paras.join(" ").length < maxChars * 0.7) pending.paras.push(p);
    else pending.open = false;
  };

  for (const raw of pages) {
    const all = raw.split("\n").map((l) => l.replace(/\s+$/, ""));
    const nonEmpty = all.filter((l) => l.trim());
    const num = nonEmpty.slice(-4).reverse().find((l) => /^\s*\d{1,4}\s*$/.test(l));
    printed = num ? Number(num.trim()) : printed + 1;
    const x = splitColumn(all);
    const cols: string[][] = x === null ? [all] : [all.map((l) => l.slice(0, x)), all.map((l) => l.slice(x))];
    for (const l of [clean(nonEmpty[0] ?? ""), clean(nonEmpty[1] ?? "")]) {
      const hit = MODE_HEAD.find(([re]) => re.test(l));
      if (!hit) continue;
      if (hit[1] !== mode) [tab, tabTitle, sub, section] = ["", "", "", ""];
      mode = hit[1];
      engine = mode === "exi" ? /^EXi: ([A-Za-z0-9-]+)/.exec(l)?.[1] ?? engine : undefined;
      break;
    }
    if (mode === null || mode === "other") continue;
    const md: HelpMode = mode;
    for (const col of cols) {
      // running heads and page numbers are dropped (they count as blank lines)
      const ls = col.map((l) => clean(l).replace(/\s+\d+-\d+[a-z]?PMC$/, "")).map((l) => (/^\d{1,4}$/.test(l) || PAGE_HEADER.test(l) ? "" : l));
      endPara();
      colParas = 0;
      let restore = carry;
      carry = null;
      ls.forEach((l, i) => {
        if (l === "") return endPara();
        const prevBlank = i === 0 || ls[i - 1] === "";
        const nextBlank = i === ls.length - 1 || ls[i + 1] === "";
        const ht = HEAD_TAB.exec(l.replace(/^v\s+/, ""));
        if (ht && prevBlank && nextBlank && ht[4].length < 50 && !/[.,]$/.test(ht[4])) {
          endPara();
          flushEntry();
          colParas++;
          restore = null;
          if (!ht[3] && !/^Page Menu/.test(ht[4])) {
            if (bare++ === 0) before = { tab, tabTitle, sub, section };
          }
          skip = /^Page Menu/.test(ht[4]);
          section = "";
          // the page menu list sits in the right column beside the next tab, so it must not change the current tab
          if (skip) return;
          if (ht[3]) sub = ht[4];
          else {
            [tab, tabTitle, sub] = [`${ht[1]}-${ht[2]}`, ht[4], ""];
            seen.add(`${mode}|${tab}`);
          }
          return;
        }
        const rm = RANGE.exec(l);
        if (rm && !skip && tab) {
          endPara();
          flushEntry();
          colParas++;
          if (restore) ({ tab, tabTitle, sub, section } = restore);
          restore = null;
          before = null;
          bare = 0;
          pending = { e: { mode: md, ...(engine ? { engine } : {}), tab, tabTitle, sub, section, label: rm[1].trim(), text: "", page: printed }, paras: [], open: true };
          return;
        }
        // a short line standing alone between blank lines is a heading; the rest is prose or figure text
        if (prevBlank && nextBlank && PROSE(nextPara(ls, i)) && l.length <= 45 && /^[A-Z]/.test(l) && !/[.,;:]$/.test(l) && l.split(" ").length <= 6 && !skip) {
          endPara();
          flushEntry();
          colParas++;
          restore = null;
          section = l;
          return;
        }
        if (para.length === 0) top = colParas === 0;
        para.push(l);
      });
      endPara();
      carry = bare >= 2 ? before : null;
      before = null;
      bare = 0;
    }
  }
  flushEntry();
  return { entries, aliases };
}
