// A one-line summary of which setting groups a set_params call (or a whole run on one sound) changed. No DOM imports.
export type ChangedRow = { id: string; name: string; to?: string };

const MAX_GROUPS = 6;

// Row names read "Group / Setting"; an Effect Type change adds the new type to its group.
export function digest(rows: ChangedRow[]): { count: number; groups: string } {
  const ids = new Set<string>();
  const groups = new Map<string, string>();
  for (const r of rows) {
    ids.add(r.id);
    const [group, setting] = r.name.includes(" / ") ? r.name.split(" / ") : [r.name, ""];
    if (setting === "Effect Type" && r.to) groups.set(group, `${group} (${r.to})`);
    else if (!groups.has(group)) groups.set(group, group);
  }
  const all = [...groups.values()];
  const shown = all.slice(0, MAX_GROUPS);
  if (all.length > MAX_GROUPS) shown.push(`+${all.length - MAX_GROUPS} more`);
  return { count: ids.size, groups: shown.join(", ") };
}
