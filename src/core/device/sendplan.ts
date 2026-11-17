// Slots whose bytes differ between the file and the keyboard. Different lengths count as different.
export function differingSlots(count: number, mine: (i: number) => Uint8Array, theirs: (i: number) => Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = mine(i), b = theirs(i);
    if (a.length !== b.length || a.some((x, j) => x !== b[j])) out.push(i);
  }
  return out;
}
