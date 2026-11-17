import test from "node:test";
import assert from "node:assert/strict";
import { ELEVENLABS_KEYS_URL, REPO_URL, isAllowedLink } from "./links.ts";

test("only the listed pages can be opened", () => {
  assert.equal(isAllowedLink(REPO_URL), true);
  assert.equal(isAllowedLink(ELEVENLABS_KEYS_URL), true);
  for (const bad of ["", "https://example.com", `${REPO_URL}/../x`, "file:///C:/x", "javascript:alert(1)", `${REPO_URL}?a=1`, `${ELEVENLABS_KEYS_URL}?x=1`, "https://elevenlabs.io", "http://elevenlabs.io/app/settings/api-keys", null, 5]) assert.equal(isAllowedLink(bad), false);
});
