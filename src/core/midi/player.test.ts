import { test } from "node:test";
import assert from "node:assert/strict";
import { MidiPlayer, modeBytes, selectBytes, testPattern, type PlayClock } from "./player.ts";

// A clock that runs only when the test advances it.
function virtualClock() {
  let t = 0;
  let id = 0;
  const q = new Map<number, { at: number; fn: () => void }>();
  const clock: PlayClock & { advance(to: number): void } = {
    now: () => t,
    setTimeout: (fn, ms) => {
      q.set(++id, { at: t + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (i) => {
      q.delete(i);
    },
    advance(to) {
      for (;;) {
        const due = [...q].filter(([, v]) => v.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        q.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = to;
    },
  };
  return clock;
}

const rig = () => {
  const clock = virtualClock();
  const sent: number[][] = [];
  const player = new MidiPlayer((m) => sent.push([...m]), clock);
  return { clock, sent, player };
};

test("events are sent on time and playing ends after the last one", () => {
  const { clock, sent, player } = rig();
  let ended = 0;
  player.play([{ ms: 0, data: [0x90, 60, 100] }, { ms: 300, data: [0x80, 60, 0] }], { channel: 0, onEnd: () => ended++ });
  clock.advance(0);
  assert.equal(sent.length, 1);
  clock.advance(299);
  assert.equal(sent.length, 1);
  clock.advance(300);
  assert.equal(sent.length, 2);
  assert.equal(player.playing, false);
  assert.equal(ended, 1);
});

test("stop sends note-offs for held notes and All Notes Off, then nothing more", () => {
  const { clock, sent, player } = rig();
  player.play([{ ms: 0, data: [0x91, 64, 90] }, { ms: 500, data: [0x91, 64, 0] }], { channel: null });
  clock.advance(10);
  player.stop();
  assert.deepEqual(sent.slice(1), [[0x81, 64, 0], [0xb1, 64, 0], [0xb1, 123, 0]]);
  const n = sent.length;
  clock.advance(1000);
  assert.equal(sent.length, n);
  assert.equal(player.playing, false);
});

test("selectBytes follows the Bank Map and rejects banks that are not Programs or Combis", () => {
  const b = (key: string, i: number) => selectBytes(key, i, 2).map((x) => [...x]);
  assert.deepEqual(b("program:INT-F", 7), [[0xb2, 0, 0], [0xb2, 32, 5], [0xc2, 7]]);
  assert.deepEqual(b("combi:INT-G", 0)[1], [0xb2, 32, 6]);
  assert.deepEqual(b("program:U-B", 0)[1], [0xb2, 32, 9]);
  assert.deepEqual(b("program:U-GG", 127)[1], [0xb2, 32, 21]);
  assert.throws(() => selectBytes("drumkit:INT", 0, 0));
  assert.throws(() => selectBytes("program:INT-G", 0, 0));
  assert.throws(() => selectBytes("program:INT-A", 128, 0));
});

test("modeBytes and the test pattern", () => {
  assert.deepEqual([...modeBytes("combi", 3)], [0xf0, 0x42, 0x33, 0x68, 0x4e, 0, 0xf7]);
  assert.deepEqual([...modeBytes("program", 0)], [0xf0, 0x42, 0x30, 0x68, 0x4e, 2, 0xf7]);
  const t = testPattern();
  assert.ok(t.every((e, i) => i === 0 || e.ms >= t[i - 1].ms), "sorted");
  assert.equal(t.filter((e) => e.data[0] === 0x90).length, t.filter((e) => e.data[0] === 0x80).length);
});

import { gmSelectBytes, withoutBankSelect } from "./player.ts";

test("General MIDI selects use the G bank, and the drum bank on channel 10", () => {
  assert.deepEqual(gmSelectBytes(2, 33).map((b) => [...b]), [[0xb2, 0, 0x79], [0xb2, 32, 0], [0xc2, 33]]);
  assert.deepEqual(gmSelectBytes(9, 0).map((b) => [...b]), [[0xb9, 0, 0x78], [0xb9, 32, 0], [0xc9, 0]]);
  assert.throws(() => gmSelectBytes(0, 128));
});

test("withoutBankSelect keeps Program Change and other controllers", () => {
  const e = [[0xb0, 0, 1], [0xb1, 32, 2], [0xc0, 5], [0xb0, 7, 90], [0x90, 60, 100]].map((data) => ({ ms: 0, data }));
  assert.deepEqual(withoutBankSelect(e).map((x) => x.data), [[0xc0, 5], [0xb0, 7, 90], [0x90, 60, 100]]);
});
