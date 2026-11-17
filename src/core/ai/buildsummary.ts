// The owner-facing list of what a build run made, read from the tool calls and their results, so it is true whatever the model says.
import type { Message } from "./agent.ts";
import { noteName } from "./intent.ts";

type Args = Record<string, any>;

export function buildSummary(msgs: Message[], label: (key: string, index: number) => string, geName: (n: number) => string): string[] {
  const calls = msgs.flatMap((m) => (m.role === "assistant" ? m.toolCalls ?? [] : []));
  const okCalls = (name: string) => calls.filter((c) => c.name === name && JSON.parse(msgs.find((m) => m.role === "tool" && m.toolCallId === c.id)?.content ?? "{}").ok === true);
  const built = okCalls("build_combi").at(-1);
  if (!built) return [];
  const res = JSON.parse(msgs.find((m) => m.role === "tool" && m.toolCallId === built.id)!.content) as { key: string; index: number; name: string };
  const parts = (built.arguments.parts ?? []) as Args[];
  const mods = new Map<string, Args>();
  let tempo: number | undefined;
  for (const c of okCalls("configure_combi")) {
    if (c.arguments.key !== res.key || c.arguments.index !== res.index) continue;
    if (typeof c.arguments.tempo === "number") tempo = c.arguments.tempo;
    for (const m of ((c.arguments.karma as Args | undefined)?.modules ?? []) as Args[]) mods.set(m.module, { ...mods.get(m.module), ...m });
  }
  const playedBy = (p: Args, t: number): string | undefined => [...mods.values()].find((m) => m.ge !== undefined && m.run !== false && (m.plays === t || (p.channel !== undefined && p.channel !== 16 && m.channel === p.channel)))?.module;
  const out = [`Built the Combination "${res.name}" in slot ${label(res.key, res.index)}. Nothing is on the keyboard yet.`];
  parts.forEach((p, i) => {
    const t = i + 1, by = playedBy(p, t);
    const vel = (p.velLow ?? 1) !== 1 || (p.velHigh ?? 127) !== 127 ? `, velocity ${p.velLow ?? 1}..${p.velHigh ?? 127}` : "";
    out.push(`Timbre ${t}: ${label(p.key, p.index)}, keys ${noteName(p.keyBottom)}..${noteName(p.keyTop)}${vel}, level ${p.volume ?? "default"}${p.transpose ? `, transpose ${p.transpose}` : ""}${by ? `, played by KARMA module ${by} (silent with KARMA off)` : ""}`);
  });
  for (const [name, m] of [...mods].sort()) if (m.ge !== undefined) out.push(`KARMA module ${name}: ${geName(m.ge)}${m.run === false ? ", switched off" : ""}, keys ${noteName(m.keyBottom ?? 0)}..${noteName(m.keyTop ?? 127)}`);
  if (tempo !== undefined) out.push(`KARMA tempo ${tempo} BPM.`);
  out.push(`Next: select the Combination on the keyboard to play it; nothing is stored until you Store it.${mods.size ? " KARMA has no master switch in the data: press KARMA ON/OFF on the keyboard to hear the pattern." : ""}`);
  return out;
}
