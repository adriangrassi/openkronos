import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, mergeSettings, validateSettings } from "./settings.ts";
import { DEFAULT_THEME, loadTheme, parseTheme, saveTheme, THEME_KEY } from "./theme.ts";

const memory = (): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

test("an unknown theme falls back to Style A", () => {
  assert.equal(DEFAULT_THEME, "a");
  for (const bad of [undefined, null, "", "A", "dark", 3, {}, ["studio"]]) assert.equal(parseTheme(bad), "a", JSON.stringify(bad));
});
test("each theme parses to itself and survives a storage round trip", () => {
  const store = memory();
  for (const t of ["normal", "studio", "a"] as const) {
    assert.equal(parseTheme(t), t);
    saveTheme(store, t);
    assert.equal(store.data.get(THEME_KEY), t);
    assert.equal(loadTheme(store), t);
  }
});
test("a missing, corrupt or throwing store gives the default", () => {
  assert.equal(loadTheme(null), "a");
  const junk = memory();
  junk.data.set(THEME_KEY, "neon");
  assert.equal(loadTheme(junk), "a");
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.equal(loadTheme(broken), "a");
  assert.doesNotThrow(() => saveTheme(broken, "studio"));
});
test("the theme is a Settings field: default A, bad values keep the current theme, a good one is stored", () => {
  assert.equal(DEFAULT_SETTINGS.theme, "a");
  assert.equal(validateSettings({ theme: "x" }).theme, "a");
  assert.equal(validateSettings({ theme: "studio" }).theme, "studio");
  const cur = { ...DEFAULT_SETTINGS, theme: "normal" as const };
  assert.equal(mergeSettings(cur, { theme: 7 }).theme, "normal");
  assert.equal(mergeSettings(cur, { theme: "a" }).theme, "a");
});
test("the accent defaults to the theme's own and a chosen accent still wins", () => {
  assert.equal(DEFAULT_SETTINGS.accent, "theme");
  assert.equal(validateSettings({ accent: "ice" }).accent, "ice");
  assert.equal(validateSettings({ accent: "pink" }).accent, "theme");
});
