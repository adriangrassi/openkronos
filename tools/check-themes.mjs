// Static check of the three themes, no window and no browser: node tools/check-themes.mjs [--base master]
// 1 every token read with var(--x) anywhere in the renderer is defined in ALL THREE theme blocks of themes.css (or is a local token, see LOCAL)
// 2 no literal colour, raw font family, px font size or px radius outside themes.css, except the documented EXCEPTIONS below
// 3 text on its backgrounds meets WCAG AA in each theme, computed from the token values (the pairs are listed in the output)
// 4 the data-testids the gates use still exist in the renderer source
// 5 the font and texture files themes.css points at exist, and the data-theme / Settings wiring is in place
// 6 no leaks: Style A's grain, OLED / amber display tokens, glow text-shadow, bevel shadows and the Doto font stay in theme-a*.css and the Style A block of themes.css
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkTestids } from "./testids.mjs";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "master";
const R = join(root, "src/app/renderer");
const fails = [];
const fail = (m) => fails.push(m);
const read = (f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

// Documented exceptions: the only places a colour or font may be literal outside themes.css.
const EXCEPTIONS = {
  "KronosView.css": 'the .kv[data-skin="kronos-light"] block: the light skin is a replica of the instrument\'s own screen, with its own Arial and greys',
  "SetLists.tsx": "swatch(): the colour a user gives a set list entry is data (an hsl hue), not a theme colour",
  "MidiTransport.tsx": "canvas fallbacks used only when the --accent / --text tokens cannot be read",
};
// Single lines that stay literal: [file, text the line contains, why].
const LINE_EXCEPTIONS = [["fx-routing.css", ".fxr-badge text", "a 7 px glyph drawn in SVG user units inside a fixed-size badge; it must scale with the drawing, not with the theme"]];
const THEMES = { a: ':root, [data-theme="a"]', normal: '[data-theme="normal"]', studio: '[data-theme="studio"]' };

// themes.css: the token blocks ------------------------------------------------
const themesPath = join(R, "themes.css");
if (!existsSync(themesPath)) { console.error("FAIL\n- src/app/renderer/themes.css is missing"); process.exit(1); }
const themesSrc = stripComments(read(themesPath));
const blocks = {};
for (const m of themesSrc.matchAll(/(^|\n)([^{}@\n][^{}]*?)\s*\{([^{}]*)\}/g)) {
  const sel = m[2].trim().replace(/\s+/g, " ");
  const id = Object.keys(THEMES).find((k) => THEMES[k] === sel);
  if (!id) continue;
  const map = new Map();
  for (const d of m[3].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(d[1], d[2].trim());
  blocks[id] = map;
}
for (const id of Object.keys(THEMES)) if (!blocks[id]) fail(`themes.css has no \`${THEMES[id]}\` block`);
if (fails.length) { console.error("\nFAIL\n- " + fails.join("\n- ")); process.exit(1); }

// 1. tokens -------------------------------------------------------------------
const files = (d, ext) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name), ext) : ext.some((x) => e.name.endsWith(x)) && !/\.test\.tsx?$/.test(e.name) ? [join(d, e.name)] : []));
const cssFiles = files(R, [".css"]);
const tsxFiles = files(R, [".tsx", ".ts"]);
const used = new Map(), local = new Set();
for (const f of [...cssFiles, ...tsxFiles]) {
  const src = f.endsWith(".css") ? stripComments(read(f)) : read(f);
  const name = f.slice(R.length + 1);
  for (const m of src.matchAll(/var\(\s*(--[\w-]+)/g)) if (!used.has(m[1])) used.set(m[1], name);
  if (f !== themesPath) {
    // Tokens a stylesheet or a component sets for its own subtree (--p, --sw, the Kronos skin's --k-*) are local, not theme tokens.
    for (const m of src.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) local.add(m[1]);
    for (const m of src.matchAll(/["'`](--[\w-]+)["'`]/g)) local.add(m[1]);
  }
}
let tokenCount = 0;
for (const [tok, where] of [...used].sort()) {
  const inAll = Object.keys(THEMES).every((id) => blocks[id].has(tok));
  if (inAll) { tokenCount++; continue; }
  const isLocal = local.has(tok) && !Object.keys(THEMES).some((id) => blocks[id].has(tok));
  if (isLocal) continue;
  const lacking = Object.keys(THEMES).filter((id) => !blocks[id].has(tok));
  fail(`token ${tok} (read in ${where}) is not defined in the theme block(s): ${lacking.join(", ")}`);
}
const sizes = Object.keys(THEMES).map((id) => blocks[id].size);
for (const a of Object.keys(THEMES)) for (const t of blocks[a].keys()) for (const id of Object.keys(THEMES)) if (!blocks[id].has(t)) fail(`token ${t} is defined in ${a} but not in ${id}`);
console.log(`tokens: ${tokenCount} theme tokens read by the CSS and TSX, all defined in the 3 blocks (${sizes.join(" / ")} defined per theme: a / normal / studio)`);

// 2. literals -----------------------------------------------------------------
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;
const NAMED = /(?:^|[;{\s])(?:color|background(?:-color)?|border(?:-[a-z]+)?(?:-color)?|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration-color)\s*:\s*(?:white|black|red|green|blue|gray|grey|orange|yellow|silver|purple|pink|navy|teal|gold)\b/i;
let literalFiles = 0, converted = 0;
for (const f of [...cssFiles, ...tsxFiles]) {
  if (f === themesPath) continue;
  const name = f.slice(R.length + 1);
  let src = f.endsWith(".css") ? stripComments(read(f)) : read(f);
  if (name === "KronosView.css") src = src.replace(/\.kv\[data-skin="kronos-light"\]\s*\{[^}]*\}/, "");
  literalFiles++;
  const bad = [];
  src.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t || /^(\/\/|\/\*|\*)/.test(t)) return;
    if (LINE_EXCEPTIONS.some(([file, text]) => name.endsWith(file) && line.includes(text))) return;
    if (f.endsWith(".css") ? COLOUR.test(line) : !(name in EXCEPTIONS) && /["'`]#[0-9a-fA-F]{3,8}["'`]|(?:rgba?|hsla?)[(]/.test(line)) bad.push([i + 1, "literal colour", t]);
    if (f.endsWith(".css")) {
      if (NAMED.test(line)) bad.push([i + 1, "named colour", t]);
      for (const m of line.matchAll(/font-family\s*:\s*([^;}]+)/g)) if (!/^\s*(var\(|inherit|initial|unset)/.test(m[1])) bad.push([i + 1, "raw font-family", t]);
      for (const m of line.matchAll(/(?:^|[;{\s])font\s*:\s*([^;}]+)/g)) if (/["']|\b(?:serif|sans-serif|monospace|Georgia|Arial|Consolas)\b/i.test(m[1].replace(/var\([^)]*\)/g, ""))) bad.push([i + 1, "raw font in the font shorthand", t]);
      if (/font-size\s*:\s*[\d.]+px/.test(line) || /(?:^|[;{\s])font\s*:[^;}]*\b\d+px/.test(line)) bad.push([i + 1, "px font size", t]);
      if (/border-radius\s*:[^;}]*\b[1-9]\d*px/.test(line)) bad.push([i + 1, "px radius", t]);
    } else if (/fontFamily/.test(line)) bad.push([i + 1, "raw fontFamily", t]);
  });
  if (bad.length) fail(`${name}: ${bad.length} literal(s) outside themes.css, e.g. line ${bad[0][0]} (${bad[0][1]}): ${bad[0][2].slice(0, 90)}`);
}
for (const [f, why] of Object.entries(EXCEPTIONS)) {
  const hit = [...cssFiles, ...tsxFiles].some((p) => p.endsWith("/" + f) || p.endsWith("\\" + f));
  if (!hit) fail(`documented exception ${f} no longer exists; remove it from EXCEPTIONS`);
}
console.log(`literals: ${literalFiles} files scanned for colours, raw fonts, px font sizes and px radii; documented exceptions: ${[...Object.keys(EXCEPTIONS), ...LINE_EXCEPTIONS.map(([f]) => f)].join(", ")}`);

// 3. contrast -----------------------------------------------------------------
function resolve(theme, v, depth = 0) {
  v = v.trim();
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(v);
  if (!m) return v;
  if (depth > 12) return null;
  const next = blocks[theme].get(m[1]);
  return next === undefined ? (m[2] ?? null) : resolve(theme, next, depth + 1);
}
function toRgb(v) {
  if (!v) return null;
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    return [0, 2, 4].map((i) => ((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))(parseInt(h.slice(i, i + 2), 16) / 255));
  }
  m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(v);
  if (m) {
    const L = +m[1] / 100, C = +m[2], h = (+m[3] * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s].map((x) => Math.min(1, Math.max(0, x)));
  }
  return null;
}
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
// "inherit" is the text colour, "transparent" is the ground behind the control.
const colour = (theme, tok, fallback) => {
  let v = resolve(theme, blocks[theme].get("--" + tok) ?? "", 0);
  if (v === "inherit" || v === "currentColor") v = resolve(theme, `var(--text)`);
  if (v === "transparent") v = resolve(theme, `var(--${fallback})`);
  return toRgb(v);
};
const PAIRS = [
  // [foreground, background, minimum]
  ["text", "bg"], ["text", "panel"], ["text", "well"], ["text", "raise"], ["text", "raise-2"], ["text", "field-bg"],
  ["text-2", "bg"], ["text-2", "panel"], ["text-2", "raise"],
  ["muted", "bg"], ["muted", "panel"], ["muted", "well"], ["muted", "raise"],
  ["accent", "bg"], ["accent", "panel"], ["accent-text", "accent"], ["accent-text", "accent-hi"],
  ["danger", "bg"], ["danger", "panel"],
  ["text", "btn-bg"], ["text", "btn-bg-hover"], ["text", "btn-bg-active"],
  ["sel-fg", "sel-bg"], ["sel-num", "sel-bg"], ["on-fg", "on-bg"],
  ["guard-fg", "guard-bg"], ["state-ok-ink", "state-ok"], ["state-warn-ink", "state-warn"], ["text", "chip-bg"],
  ["display", "oled"], ["oled-dim", "oled"],
];
const lowCount = {};
for (const theme of Object.keys(THEMES)) {
  lowCount[theme] = 0;
  for (const [f, b] of PAIRS) {
    const fg = colour(theme, f, "text"), bg = colour(theme, b, "bg");
    if (!fg || !bg) { fail(`contrast (${theme}): cannot resolve --${f} or --${b} to a colour`); continue; }
    const [x, y] = [lum(fg), lum(bg)];
    const r = (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    if (r < 4.5) { lowCount[theme]++; fail(`contrast (${theme}): --${f} on --${b} is ${r.toFixed(2)}:1, below AA 4.5:1`); }
  }
}
console.log(`contrast: ${PAIRS.length} pairs x 3 themes, below AA: a ${lowCount.a}, normal ${lowCount.normal}, studio ${lowCount.studio}`);
console.log("  pairs: " + PAIRS.map(([f, b]) => `${f}/${b}`).join(", "));

// 4. testids ------------------------------------------------------------------
checkTestids(root, base, fail);

// 5. assets and wiring --------------------------------------------------------
const themesRaw = read(themesPath);
for (const m of themesRaw.matchAll(/url\("\.\/([^"]+)"\)/g)) if (!existsSync(join(R, m[1]))) fail(`themes.css references ${m[1]}, which does not exist`);
for (const lic of ["fonts/OFL.txt"]) if (!existsSync(join(R, lic))) fail(`${lic} (the font licence) is missing`);
for (const face of ["Archivo", "JetBrains Mono"]) if (!themesRaw.includes(`font-family: "${face}"`)) fail(`themes.css bundles no ${face} @font-face`);
const mainSrc = read(join(R, "main.tsx"));
if (!/dataset\.theme\s*=\s*loadTheme/.test(mainSrc)) fail("main.tsx does not set data-theme before the first render");
if (!/data-theme="a"/.test(read(join(R, "index.html")))) fail('index.html has no default data-theme="a"');
const dialog = read(join(R, "SettingsDialog.tsx"));
for (const id of ["normal", "studio", "a"]) if (!dialog.includes("settings-theme-") || !read(join(root, "src/core/theme.ts")).includes(`"${id}"`)) fail(`the Settings dialog or core/theme.ts lacks the ${id} theme`);
console.log("wiring: data-theme set before first render, Settings radio group present, font files present");


// 6. leaks --------------------------------------------------------------------
// Style A's look is a set of tokens plus rules. Only theme-a*.css (every rule scoped to data-theme="a") and the Style A block of themes.css may use it.
const isA = (n) => /^theme-a(\.css|[/\x5c])/.test(n) || n === "themes.css";
// Exception: Studio defines its own amber (--display) and its stage rules may read it; it has no OLED, no grain, no glow.
const A_ONLY_TOKENS = /var\(\s*--(grain|oled|oled-dim|display)\b/;
const STUDIO_OK = new Set(["display"]);
let leakScanned = 0;
for (const f of cssFiles) {
  const name = f.slice(R.length + 1);
  if (isA(name)) continue;
  leakScanned++;
  stripComments(read(f)).split("\n").forEach((line, i) => {
    const t = line.trim(), m = A_ONLY_TOKENS.exec(line);
    if (m && !(/^theme-studio(\.css|[/\x5c])/.test(name) && STUDIO_OK.has(m[1]))) fail(`leak: ${name}:${i + 1} uses Style A token --${m[1]} outside theme-a*.css: ${t.slice(0, 80)}`);
    if (/text-shadow\s*:\s*(?!none\b)\S/.test(line)) fail(`leak: ${name}:${i + 1} sets a text-shadow (a glow is Style A only): ${t.slice(0, 80)}`);
    if (/box-shadow\s*:[^;]*var\(\s*--(key-hi|key-lo|knob-hi)\b/.test(line)) fail(`leak: ${name}:${i + 1} draws a Style A bevel with --key-hi/--key-lo/--knob-hi: ${t.slice(0, 80)}`);
    if (/\b(Doto|IBM Plex)\b|DSEG/i.test(line)) fail(`leak: ${name}:${i + 1} names a Style A font: ${t.slice(0, 80)}`);
  });
}
for (const f of cssFiles) {
  const name = f.slice(R.length + 1);
  if (!/^theme-a(\.css|[/\x5c])/.test(name)) continue;
  for (const m of stripComments(read(f)).matchAll(/(^|\n)([^{}@\n][^{}]*)\{/g))
    for (const sel of m[2].split(",")) if (!sel.includes('data-theme="a"')) fail(`leak: ${name} has a rule not scoped to [data-theme="a"]: ${sel.trim().slice(0, 80)}`);
}
for (const id of ["normal", "studio"]) {
  if (blocks[id].get("--grain") !== "none") fail(`leak: ${id} defines --grain as ${blocks[id].get("--grain")}; only Style A has a texture`);
  for (const [tok, v] of blocks[id]) if (tok.startsWith("--font-") && /Doto|IBM Plex|DSEG/i.test(v)) fail(`font stack: ${id} ${tok} uses a Style A font (${v})`);
}
if (/Archivo/.test(blocks.normal.get("--font-body") ?? "")) fail("font stack: Normal uses Studio's Archivo");
if (!/Archivo/.test(blocks.studio.get("--font-body") ?? "")) fail("font stack: Studio body font is not Archivo");
console.log(`leaks: ${leakScanned} stylesheets outside theme-a*.css scanned for Style A tokens, glow, bevels and fonts; theme-a*.css rules all scoped; no Style A font in the Normal or Studio font tokens; documented exception: theme-studio*.css may read its own --display`);

if (fails.length) { console.error("\nFAIL\n- " + fails.join("\n- ")); process.exit(1); }
console.log("check-themes: ok");
