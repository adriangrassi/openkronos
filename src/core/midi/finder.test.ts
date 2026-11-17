import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCandidate, rankCandidates, type Candidate } from "./finder.ts";

const make = (over: Partial<Candidate>): Candidate => ({
  title: "Bon Jovi - Livin on a Prayer",
  site: "freemidi",
  durationMs: 250_000,
  tempo: 123,
  channelsWithNotes: 14,
  hasDrums: true,
  emptyNamedTracks: 0,
  ref: null,
  ...over,
});

const Q = "Livin on a Prayer Bon Jovi";

test("a full 14-track file with drums outranks a 16 s loop with the same title", () => {
  const full = make({ title: "Livin on a Prayer", ref: "full" });
  const loop = make({ title: "Livin on a Prayer", durationMs: 16_000, channelsWithNotes: 3, hasDrums: false, ref: "loop" });
  assert.deepEqual(rankCandidates(Q, [loop, full]).map((c) => c.ref), ["full", "loop"]);
});

test("a title that matches the query beats an unrelated title with better stats", () => {
  const match = make({ title: "Bon Jovi - Livin on a Prayer", channelsWithNotes: 2, hasDrums: false, ref: "match" });
  const other = make({ title: "Symphony No. 5", channelsWithNotes: 12, hasDrums: true, ref: "other" });
  assert.equal(rankCandidates(Q, [other, match])[0].ref, "match");
});

test("a candidate with no channels with notes is dropped", () => {
  const silent = make({ channelsWithNotes: 0, ref: "silent" });
  assert.deepEqual(rankCandidates(Q, [silent]), []);
});

test("ties are deterministic and the input array is not mutated", () => {
  const b = make({ title: "Livin on a Prayer B", ref: "b" });
  const a = make({ title: "Livin on a Prayer A", ref: "a" });
  const input = [b, a];
  const first = rankCandidates(Q, input).map((c) => c.ref);
  const second = rankCandidates(Q, [a, b]).map((c) => c.ref);
  assert.deepEqual(first, ["a", "b"]);
  assert.deepEqual(second, first);
  assert.deepEqual(input.map((c) => c.ref), ["b", "a"]);
});

test("describeCandidate shows the loop and no-drums warnings", () => {
  assert.equal(
    describeCandidate(make({})),
    '"Bon Jovi - Livin on a Prayer" (FreeMidi), 4:10, 123 bpm, 14 tracks with notes, drums yes',
  );
  assert.equal(
    describeCandidate(make({ durationMs: 16_000, channelsWithNotes: 3, hasDrums: false })),
    '"Bon Jovi - Livin on a Prayer" (FreeMidi), 0:16, 123 bpm, 3 tracks with notes, drums no (short: probably a loop) (no drums)',
  );
});

test("an empty candidate list gives an empty ranking", () => {
  assert.deepEqual(rankCandidates(Q, []), []);
});
