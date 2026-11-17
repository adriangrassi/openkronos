import { test } from "node:test";
import assert from "node:assert/strict";
import { addRecent, RECENT_LIMIT, withoutRecent, type RecentEntry } from "./recent.ts";

test("newest first, same path moves to the top, capped at 10", () => {
  let list: RecentEntry[] = [];
  for (let i = 1; i <= 12; i++) list = addRecent(list, "C:/x/f" + i + ".PCG", "id" + i);
  assert.equal(list.length, RECENT_LIMIT);
  assert.equal(list[0].name, "f12.PCG");
  assert.equal(list[9].name, "f3.PCG");
  list = addRecent(list, "C:/x/f05.PCG", "again");
  assert.equal(list[0].id, "again");
  assert.equal(list.filter((e) => e.name === "f05.PCG").length, 1);
  assert.equal(list.length, RECENT_LIMIT);
});

test("name is the file name for Windows paths too", () => {
  const list = addRecent([], "C:\\Users\\me\\work.PCG", "1");
  assert.equal(list[0].name, "work.PCG");
  assert.equal(list[0].path, "C:\\Users\\me\\work.PCG");
});

test("remove by id", () => {
  const list = addRecent(addRecent([], "/a/one.PCG", "1"), "/a/two.PCG", "2");
  assert.deepEqual(withoutRecent(list, "2").map((e) => e.id), ["1"]);
});
