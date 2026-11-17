// A stand-in for `codex` (see fake-claude.mjs). `exec` writes the reply to the -o file and prints a turn.completed event like codex-cli 0.169.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mode = JSON.parse(fs.readFileSync(path.join(here, "mode.json"), "utf8"));
const args = process.argv.slice(2);

if (args[0] === "--version") {
  process.stdout.write("codex-cli 0.169.0\n");
  process.exit(0);
}
if (args[0] === "login") {
  process.stderr.write(mode.loggedIn === false ? "Not logged in\n" : "Logged in using ChatGPT\n");
  process.exit(mode.loggedIn === false ? 1 : 0);
}
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  fs.writeFileSync(path.join(here, "capture.json"), JSON.stringify({ argv: args, stdin }));
  if (mode.loggedIn === false) {
    process.stderr.write("Not logged in. Run codex login\n");
    process.exit(1);
  }
  fs.writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ text: mode.text ?? "OK", tool_calls: [] }));
  process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":2,"output_tokens":3}}\n');
});
