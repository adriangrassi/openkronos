import { test } from "node:test";
import assert from "node:assert/strict";
import { addTrack, advance, begin, emptyQueue, moveTrack, parsePlaylist, removeTrack, retreat } from "./playlist.ts";

const mk = (...n: string[]) => n.reduce(addTrack, emptyQueue());
const z = () => 0;

test("sequential play ends after the last song, repeat all wraps", () => {
  let q = begin(mk("a.mid", "b.mid"), z);
  q = advance(q, z, true);
  assert.equal(q.current, 1);
  assert.equal(advance(q, z, true).current, null);
  assert.equal(advance({ ...q, repeat: "all" }, z, true).current, 0);
});

test("move and remove keep current on the same song", () => {
  const q = { ...mk("a.mid", "b.mid", "c.mid"), current: 1 };
  assert.equal(moveTrack(q, 2, 0).current, 2);
  assert.equal(removeTrack(q, 0).current, 0);
  assert.equal(removeTrack(q, 1).current, null);
});

test("shuffle never repeats a song within a round", () => {
  let q = begin({ ...mk("a.mid", "b.mid", "c.mid"), shuffle: true }, () => 0.5);
  for (let i = 0; i < 2; i++) q = advance(q, () => 0.99, true);
  assert.deepEqual([...q.played].sort(), [0, 1, 2]);
  assert.equal(advance(q, z, true).current, null);
  assert.equal(retreat({ ...q, current: 0 }).current, 0);
});

test("parsePlaylist drops paths and garbage", () => {
  assert.deepEqual(parsePlaylist({ items: ["a.mid", "../b.mid", 3] }), ["a.mid"]);
  assert.deepEqual(parsePlaylist(null), []);
});
