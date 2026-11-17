// Builds src/generated/help.json from KORG's Parameter Guide text (research/param-guide.txt: private, gitignored, never committed). Without the text the file is {} and the app shows no help icons.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseGuide } from "../src/core/pages/helpParse.ts";

const root = path.resolve(import.meta.dirname, "..");
const guide = path.join(root, "research/param-guide.txt");
mkdirSync(path.join(root, "src/generated"), { recursive: true });
if (!existsSync(guide)) {
  writeFileSync(path.join(root, "src/generated/help.json"), "{}");
  console.log("help.json: research/param-guide.txt not found, no help");
} else {
  const { entries, aliases } = parseGuide(readFileSync(guide, "latin1"));
  writeFileSync(path.join(root, "src/generated/help.json"), JSON.stringify({ entries, aliases }));
  console.log(`help.json: ${entries.length} entries, ${aliases.length} tab aliases`);
}
