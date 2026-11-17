// Pure curve math for the effect graphs. Formulas as in the FX spec (section B5).

export function logHz(i: number, n: number, lo = 20, hi = 20000): number {
  return lo * (hi / lo) ** (i / (n - 1));
}

export function peqDb(
  bands: { hz: number; q: number; gain: number; shape: "peak" | "lowshelf" | "highshelf" }[],
  f: number,
): number {
  let sum = 0;
  for (const b of bands) {
    if (b.shape === "lowshelf") sum += b.gain / (1 + (f / b.hz) ** 2);
    else if (b.shape === "highshelf") sum += b.gain / (1 + (b.hz / f) ** 2);
    else sum += b.gain / (1 + (b.q * (f / b.hz - b.hz / f)) ** 2);
  }
  return sum;
}

export function dynOut(
  inDb: number,
  p: { threshold: number; ratio: number; knee: number; mode: "comp" | "expand" | "limit"; ceiling?: number },
): number {
  const T = p.threshold;
  const R = p.ratio;
  if (p.mode === "expand") return inDb >= T ? inDb : Math.max(-96, T + (inDb - T) * R);
  const half = p.knee / 2;
  let out: number;
  if (inDb < T - half) out = inDb;
  // >= not > : with knee 0 the middle formula would divide 0 by 0 at in === T
  else if (inDb >= T + half) out = T + (inDb - T) / R;
  else out = inDb + (1 / R - 1) * (inDb - T + half) ** 2 / (2 * p.knee);
  if (p.mode === "limit") out = Math.min(out, p.ceiling ?? 0);
  return out;
}

export function approxRatio(t: number): number {
  return t >= 1 ? Infinity : 1 / (1 - t);
}

export function decayDb(ms: number, p: { preDelay: number; timeSec: number }): number {
  if (ms < p.preDelay) return -Infinity;
  return (60 * (p.preDelay - ms)) / (p.timeSec * 1000);
}

export function noteMs(bpm: number, note: string, times: number): number {
  const [a, b] = note.split("/").map(Number);
  return (240000 / bpm) * (a / b) * times;
}

export function lfoY(wave: string, shape: number, phaseDeg: number, x: number): number {
  const p = (((x + phaseDeg / 360) % 1) + 1) % 1;
  let y: number;
  if (wave === "Triangle") y = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
  else if (wave === "Square") y = p < 0.5 ? 1 : -1;
  else if (wave === "Saw Up") y = 2 * p - 1;
  else if (wave === "Saw Down") y = 1 - 2 * p;
  else y = Math.sin(2 * Math.PI * p);
  return Math.sign(y) * Math.abs(y) ** (2 ** (-shape / 50));
}

export function driveY(x: number, drive01: number): number {
  const g = 1 + 19 * drive01;
  return Math.tanh(g * x) / Math.tanh(g);
}
