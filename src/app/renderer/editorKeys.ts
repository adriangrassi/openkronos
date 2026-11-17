// React keys for the editor's sibling panels. Siblings sharing a key make React leak the unmatched one (a new Effects button per edit), so each gets its own.
export const editorKeys = (key: string, index: number) => {
  const k = `${key}-${index}`;
  return { live: `live-${k}`, variations: `variations-${k}`, effects: `effects-${k}`, params: k };
};
