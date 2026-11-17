// Mode numbers from KORG's System Exclusive document (*5).
export const MODES = [
  { id: 2, label: "Prog" },
  { id: 0, label: "Combi" },
  { id: 4, label: "Seq" },
  { id: 6, label: "Sampling" },
  { id: 7, label: "Global" },
  { id: 8, label: "Disk" },
  { id: 9, label: "Set List" },
] as const;

export const modeChangeBytes = (mode: number, channel: number): Uint8Array => Uint8Array.of(0xf0, 0x42, 0x30 | channel, 0x68, 0x4e, mode, 0xf7);
export const modeRequestBytes = (channel: number): Uint8Array => Uint8Array.of(0xf0, 0x42, 0x30 | channel, 0x68, 0x12, 0xf7);

// The mode named by a Mode Change (4E) or Mode Data (42) message, else null.
export function modeFromMessage(m: Uint8Array): number | null {
  if (m[0] !== 0xf0 || m[1] !== 0x42 || (m[2] & 0xf0) !== 0x30 || m[3] !== 0x68) return null;
  return m[4] === 0x4e || m[4] === 0x42 ? m[5] & 0x0f : null;
}
