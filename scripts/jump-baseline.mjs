// Jump baseline: the AI panel's agent, run from the command line on the factory library with the two Jump sounds hidden.
// It prints the tool log and scores the result against the hidden U-AA 078 "Jump", next to a plain unedited search hit.
// Saves nothing. Needs AUTOROUTER_KEY in the environment (an OpenAI-compatible router).
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const mod = (p) => import(pathToFileURL(path.join(root, p)).href);

if (!process.env.AUTOROUTER_KEY) {
  console.error("AUTOROUTER_KEY is not set. The baseline needs an OpenAI-compatible model router.");
  process.exit(1);
}

const [L, P, A, S, Agent, AI] = await Promise.all([
  mod("src/core/pcg/library.ts"),
  mod("src/core/pcg/pcg.ts"),
  mod("src/core/ai/session.ts"),
  mod("src/core/ai/score.ts"),
  mod("src/core/ai/agent.ts"),
  mod("src/app/main/ai.ts"),
]);
const T = JSON.parse(readFileSync(path.join(root, "src/generated/params.json"), "utf8"));
const file = P.parsePcg(new Uint8Array(readFileSync(path.join(root, "research/korg-factory/pcg/PRELOAD_KRONOSX.PCG"))));

const JUMP = { key: "program:U-AA", index: 78 };
const JUMP2 = { key: "program:U-BB", index: 107 };
const hide = [JUMP, JUMP2];
const reference = Uint8Array.from(L.getEntry(file, JUMP.key, JUMP.index));

// A free Program: rename one unused, unnamed-looking slot to Init, so the agent has somewhere to write.
const spare = new A.SoundSession(T, file).search({ kind: "program", type: "exi", used: false, limit: 5000 }).find((x) => !/^init/i.test(x.name.trim()));
if (!spare) throw new Error("no unused EXi Program to use as the free slot");
L.setName(file, spare.key, spare.index, "Init Program");

// The plain baseline: the first AL-1 Program a search finds with no AI involved, scored before the run edits anything.
const session = new A.SoundSession(T, file, { hide });
const plain = session.search({ kind: "program", type: "exi", engine: "AL-1", limit: 1 })[0];
const plainScore = S.scoreSound(T, "exi", reference, "exi", Uint8Array.from(L.getEntry(file, plain.key, plain.index)));

const prompt =
  "Make a program like the main synth sound from the song Jump by Van Halen, starting from the closest sound you can find. Copy it to a free slot, name it, and set it up.";
const result = await Agent.runAgent({ session, prompt, chat: (m, t) => AI.aiChat(m, t), maxTurns: 24 });

console.log("Tool log");
for (const e of session.log()) console.log(`  ${e.action}${e.key ? ` ${e.key} ${e.index}` : ""}: ${e.detail}`);
console.log(`\nRun status: ${result.status}${result.error ? ` (${result.error})` : ""}`);
console.log(`Model's last words: ${result.finalText.trim() || "(none)"}\n`);

const show = (label, sc) => console.log(`${label.padEnd(44)} total ${String(sc.total).padStart(6)}  ${Object.entries(sc.parts).map(([k, v]) => `${k} ${v === null ? "-" : v.toFixed(1)}`).join("  ")}`);
console.log("Scores against the hidden U-AA 078 Jump:");
show(`Plain search hit (${plain.key} ${plain.index} ${plain.name})`, plainScore);
for (const t of session.touched()) {
  const info = L.listBanks(file).find((b) => b.key === t.key);
  const sc = S.scoreSound(T, "exi", reference, info.type ?? "exi", Uint8Array.from(L.getEntry(file, t.key, t.index)));
  show(`AI result (${t.key} ${t.index} ${L.getName(file, t.key, t.index)})`, sc);
}
if (session.touched().length === 0) console.log("AI result: no slot was changed.");

// Undo everything the run did, so this script never leaves an edited file behind even in memory.
session.undoAll();
