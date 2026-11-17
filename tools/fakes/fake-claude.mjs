// A stand-in for the `claude` command line, for the unit tests and gate-connect (never shipped, never run by the app itself).
// It reads mode.json from its own folder, answers like the real tool in the shapes captured from claude 2.1.326, and records what it was given in capture.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mode = JSON.parse(fs.readFileSync(path.join(here, "mode.json"), "utf8"));
const args = process.argv.slice(2);
const out = (s) => process.stdout.write(s);

if (args[0] === "--version") {
  out(`${mode.version ?? "2.1.326 (Claude Code)"}\n`);
  process.exit(0);
}
if (args[0] === "auth") {
  if (mode.authStderr) process.stderr.write(mode.authStderr);
  if (mode.auth !== undefined) out(mode.auth);
  process.exit(mode.authCode ?? 0);
}
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  fs.writeFileSync(path.join(here, "capture.json"), JSON.stringify({ argv: args, stdin, env: process.env, cwd: process.cwd() }));
  if (mode.hang) return void setInterval(() => {}, 1000);
  if (mode.stderr) process.stderr.write(mode.stderr);
  if (mode.big) out("x".repeat(9_000_000));
  else if (mode.rawHex) process.stdout.write(Buffer.from(mode.rawHex, "hex"));
  else if (mode.stdout !== undefined) out(mode.stdout);
  process.exit(mode.code ?? 0);
});
