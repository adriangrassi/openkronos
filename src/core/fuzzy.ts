// Subsequence matching for the command palette. Pure: no DOM, no Electron.

// Score for query found in text (case-insensitive), or null when the query letters do not appear in order.
// Consecutive letters and word starts score up; skipped letters and long text score down.
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const t = text.toLowerCase();
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, from);
    if (at < 0) return null;
    score -= at - from; // letters skipped since the last match
    if (at === prev + 1) score += 6;
    if (at === 0 || /[^a-z0-9]/.test(t[at - 1])) score += 4;
    prev = at;
    from = at + 1;
  }
  // Shorter text wins a tie, so "Save" ranks above "Save As" for "save".
  return score - t.length * 0.1;
}

// Matching items only, best score first; ties keep input order. A blank query returns the items in order.
export function fuzzyFilter<T>(query: string, items: readonly T[], text: (item: T) => string, limit = Infinity): T[] {
  if (query.trim() === "") return items.slice(0, limit);
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query, text(item)) }))
    .filter((r): r is { item: T; i: number; s: number } => r.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.item);
}
