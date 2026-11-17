// The gates' data-testids against the renderer source, shared by check-skin.mjs and check-themes.mjs.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function checkTestids(root, base, fail) {
const R = join(root, "src/app/renderer");
const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const read = (f) => readFileSync(f, "utf8");
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".tsx") ? [[e.name, read(join(d, e.name))]] : []));
const rendererFiles = walk(R);
function idsIn(src) {
  const exact = new Set(), prefix = new Set();
  for (const m of src.matchAll(/data-testid=(?:"([^"]+)"|\{`([^`]*)`\}|\{"([^"]+)"\})/g)) {
    const v = m[1] ?? m[2] ?? m[3];
    if (v.includes("${")) { const p = v.slice(0, v.indexOf("${")); if (p.length >= 3) prefix.add(p); } // an id built from a prop gives no prefix to check
    else exact.add(v);
  }
  return { exact, prefix };
}
function locate(files) {
  const where = new Map(), pre = [];
  for (const [f, src] of files) {
    const { exact, prefix } = idsIn(src);
    for (const id of exact) where.set(id, [...(where.get(id) ?? []), f]);
    for (const p of prefix) pre.push([p, f]);
  }
  return { where, pre };
}
const now = locate(rendererFiles);
let baseFiles = [];
try {
  const names = git("ls-tree", "-r", "--name-only", base, "src/app/renderer").split("\n").filter((n) => n.endsWith(".tsx"));
  baseFiles = names.map((n) => [n.split("/").pop(), git("show", `${base}:${n}`)]);
} catch { baseFiles = []; }
const was = locate(baseFiles);

const used = new Set(), usedPrefix = new Set();
for (const f of readdirSync(join(root, "tools")).filter((n) => /^gate-.*\.mjs$/.test(n))) {
  const src = read(join(root, "tools", f));
  for (const m of src.matchAll(/\b(?:getByTestId|T|X)\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
    const v = m[2];
    if (v.includes("${")) usedPrefix.add(v.slice(0, v.indexOf("${")));
    else used.add(v);
  }
  for (const m of src.matchAll(/data-testid(\^?)=\\?["']([^"'\\\]]+)/g)) (m[1] ? usedPrefix : used).add(m[2]);
}
// An id passed to a component as a prop (id="ai-dest") is only visible as a string literal, so that counts too.
const literal = (id, files) => files.some(([, src]) => src.includes(`"${id}"`) || src.includes(`'${id}'`));
const has = (id, w, p, files) => w.has(id) || p.some(([x]) => id.startsWith(x)) || literal(id, files);
const missing = [], moved = [];
for (const id of [...used].sort()) {
  const hadBefore = has(id, was.where, was.pre, baseFiles);
  if (!has(id, now.where, now.pre, rendererFiles)) { if (hadBefore || baseFiles.length === 0) missing.push(id); continue; }
  const a = (was.where.get(id) ?? []).join(), b = (now.where.get(id) ?? []).join();
  if (a && b && a !== b) moved.push(`${id}: ${a} -> ${b}`);
}
for (const p of [...usedPrefix].sort()) {
  const ok = now.pre.some(([x]) => x.startsWith(p) || p.startsWith(x)) || [...now.where.keys()].some((k) => k.startsWith(p));
  if (!ok && (was.pre.some(([x]) => x.startsWith(p) || p.startsWith(x)) || [...was.where.keys()].some((k) => k.startsWith(p)))) missing.push(`${p}*`);
}
if (missing.length) fail(`testids used by the gates but gone from the renderer: ${missing.join(", ")}`);
console.log(`testids: ${used.size} exact + ${usedPrefix.size} prefix used by the gates, ${missing.length} missing, ${moved.length} moved to another file`);
for (const m of moved) console.log(`  moved ${m}`);

}
