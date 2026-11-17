// The few Markdown shapes a model answer uses: paragraphs, bullet and numbered lists, # headings, | tables |, **bold**, *italic* and `code`. It returns data, never HTML,
// so the caller renders it as React elements and every character stays escaped.
export type Inline = { kind: "text" | "bold" | "italic" | "code"; text: string };
export type Block = { kind: "p" | "h"; inline: Inline[] } | { kind: "ul" | "ol"; items: Inline[][] } | { kind: "table"; head: Inline[][]; rows: Inline[][][] };

// A table is a header row, a |---| row, then body rows. Lines that start with a pipe but have no such second row stay a paragraph.
const cells = (line: string): Inline[][] => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => parseInline(c.trim()));

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(/\*\*(.+?)\*\*|`([^`\n]+)`|\*([^\s*](?:[^*\n]*[^\s*])?)\*/g)) {
    if (m.index > last) out.push({ kind: "text", text: s.slice(last, m.index) });
    out.push(m[1] !== undefined ? { kind: "bold", text: m[1] } : m[2] !== undefined ? { kind: "code", text: m[2] } : { kind: "italic", text: m[3] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ kind: "text", text: s.slice(last) });
  return out;
}

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  let table: string[] | null = null;
  const flush = () => {
    if (table) {
      if (table.length >= 2 && /^[\s|:-]+$/.test(table[1]) && table[1].includes("-")) blocks.push({ kind: "table", head: cells(table[0]), rows: table.slice(2).map(cells) });
      else blocks.push({ kind: "p", inline: parseInline(table.join("\n")) });
    }
    table = null;
    if (para.length) blocks.push({ kind: "p", inline: parseInline(para.join("\n")) });
    if (list) blocks.push({ kind: list.kind, items: list.items.map(parseInline) });
    para = [];
    list = null;
  };
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const row = /^\s*\|/.test(line);
    if (table && !row) flush();
    if (row) {
      if (!table) {
        flush();
        table = [];
      }
      table.push(line);
      continue;
    }
    const h = /^#{1,6}\s+(.+)$/.exec(line), ul = /^\s*[-*•]\s+(.+)$/.exec(line), ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (line.trim() === "") flush();
    else if (h) { flush(); blocks.push({ kind: "h", inline: parseInline(h[1]) }); }
    else if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (para.length || (list && list.kind !== kind)) flush();
      list ??= { kind, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else if (list && /^\s/.test(raw)) list.items[list.items.length - 1] += " " + line.trim();
    else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}
