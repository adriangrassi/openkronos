// Static check of the skin, no window: node tools/check-skin.mjs [--base master]
// 1 every data-testid the gates use is still in the renderer (and which ones changed file against the base branch)
// 2 the font files and the grain texture are referenced from the CSS, present, and emitted by the build as files (CSP blocks data: URLs)
// 3 no literal hex colours outside token blocks in the CSS/TSX files changed against the base
// 4 text/background token pairs meet WCAG AA, computed from the oklch values in themes.css
// 5 focus-visible and prefers-reduced-motion rules exist in the built CSS
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkTestids } from "./testids.mjs";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "master";
const R = join(root, "src/app/renderer");
const fails = [];
const fail = (m) => fails.push(m);
const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const read = (f) => readFileSync(f, "utf8");

// 1. testids ------------------------------------------------------------------
checkTestids(root, base, fail);

// 2. fonts and texture --------------------------------------------------------
// The skin's tokens, fonts and texture now live in themes.css (block `:root, [data-theme="a"]` comes first).
const styles = read(join(R, "themes.css"));
const assets = ["fonts/IBMPlexSansCondensed-400.woff2", "fonts/IBMPlexSansCondensed-600.woff2", "fonts/IBMPlexMono-400.woff2", "fonts/Doto-700.woff2", "textures/grain.svg"];
for (const a of assets) {
  if (!styles.includes(`url("./${a}")`)) fail(`themes.css does not reference ${a}`);
  if (!existsSync(join(R, a))) fail(`missing file ${a}`);
}
if (!existsSync(join(R, "fonts/OFL.txt"))) fail("fonts/OFL.txt (the licence) is missing");
const out = join(root, "out/renderer/assets");
if (!existsSync(out)) fail("no build output: run npx electron-vite build first");
else {
  const built = readdirSync(out);
  const css = built.filter((n) => n.endsWith(".css")).map((n) => read(join(out, n))).join("\n");
  for (const a of assets) {
    const stem = a.split("/").pop().replace(/\.[^.]+$/, ""), ext = a.split(".").pop();
    const file = built.find((n) => n.startsWith(stem + "-") && n.endsWith("." + ext));
    if (!file) fail(`build output has no ${stem} file`);
    else if (!css.includes(file)) fail(`built CSS does not reference ${file}`);
  }
  if (/url\(\s*["']?data:(font|image)/.test(css)) fail("built CSS inlines a font or image as a data: URL, which the page's CSP blocks");
  if (!/:focus-visible/.test(css)) fail("no :focus-visible rule in the built CSS");
  if (!/prefers-reduced-motion:\s*reduce/.test(css)) fail("no prefers-reduced-motion rule in the built CSS");
  console.log(`fonts: ${assets.length} assets referenced, present and emitted as files; focus-visible and reduced-motion rules present`);
}

// 3. hex colours outside token blocks -----------------------------------------
// A token block is a rule on :root or a .kv[data-skin] skin (the Kronos screen replica keeps the device's own colours there).
const changed = new Set([
  ...git("diff", "--name-only", base).split("\n"),
  ...git("ls-files", "--others", "--exclude-standard").split("\n"),
].filter((n) => /^src\/app\/renderer\/.*\.(css|tsx)$/.test(n)));
const HEX = /(?<![&\w])#[0-9a-fA-F]{3,8}\b/;
let hexFiles = 0;
for (const n of changed) {
  if (n.endsWith("/themes.css")) continue; // the one file that chooses colours
  hexFiles++;
  let src = read(join(root, n));
  if (n.endsWith(".css")) src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)(:root|\.kv\[data-skin="[^"]+"\])\s*\{[^}]*\}/g, "$1");
  const bad = src.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l) && HEX.test(l));
  if (bad.length) fail(`${n}: literal hex colours outside a token block: ${bad.slice(0, 3).map((l) => l.trim().slice(0, 70)).join(" | ")}`);
}
console.log(`hex: ${hexFiles} changed CSS/TSX files scanned`);

// 4. contrast -----------------------------------------------------------------
const tokens = new Map();
for (const m of styles.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) if (!tokens.has(m[1])) tokens.set(m[1], m[2].trim());
const resolve = (v, depth = 0) => {
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  if (m) return depth > 8 ? null : resolve(tokens.get(m[1]) ?? "", depth + 1);
  return v;
};
function oklch(v) {
  const m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(v);
  if (!m) return null;
  const L = +m[1] / 100, C = +m[2], h = (+m[3] * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s];
  return lin.map((x) => Math.min(1, Math.max(0, x)));
}
const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
const get = (name) => oklch(resolve(`var(--${name})`) ?? "");
const ratio = (fg, bg) => { const a = lum(get(fg)), b = lum(get(bg)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
const pairs = [
  ["text", "panel"], ["text", "bg"], ["text", "well"], ["text", "key"], ["text", "key-hi"], ["text", "oled"],
  ["text-2", "panel"], ["text-2", "key"], ["muted", "panel"], ["muted", "bg"], ["muted", "well"], ["muted", "key"],
  ["accent", "bg"], ["accent", "panel"], ["accent", "oled"], ["accent-text", "accent"], ["accent-text", "accent-hi"],
  ["display", "oled"], ["oled-dim", "oled"], ["danger", "bg"], ["danger", "panel"], ["led-red", "paper-2"],
];
let low = 0;
for (const [f, b] of pairs) {
  const r = ratio(f, b);
  if (Number.isNaN(r)) { fail(`contrast: cannot resolve --${f} or --${b}`); continue; }
  if (r < 4.5) { low++; fail(`contrast: --${f} on --${b} is ${r.toFixed(2)}:1, below AA 4.5:1`); }
}
console.log(`contrast: ${pairs.length} text/background pairs checked, ${low} below AA`);

if (fails.length) { console.error("\nFAIL\n- " + fails.join("\n- ")); process.exit(1); }
console.log("check-skin: ok");
