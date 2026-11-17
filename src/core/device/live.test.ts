import { test } from "node:test";
import assert from "node:assert/strict";
import { Latest } from "./live.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

test("a push waits for the send in flight, and only the newest waiting value goes next", async () => {
  const sent: number[] = [], done: Array<() => void> = [];
  const s = new Latest<number>((v) => { sent.push(v); return new Promise<void>((r) => done.push(r)); }, () => assert.fail("no error expected"));
  s.push(1); s.push(2); s.push(3);
  assert.deepEqual(sent, [1]);
  done.shift()!(); await tick();
  assert.deepEqual(sent, [1, 3]);
  done.shift()!(); await tick();
  s.push(4);
  assert.deepEqual(sent, [1, 3, 4]);
});

test("a failed send is reported and later pushes still go out", async () => {
  const sent: number[] = [], errs: unknown[] = [];
  const s = new Latest<number>((v) => { sent.push(v); return v === 1 ? Promise.reject(new Error("x")) : Promise.resolve(); }, (e) => errs.push(e));
  s.push(1); await tick(); await tick();
  assert.equal(errs.length, 1);
  s.push(2); await tick();
  assert.deepEqual(sent, [1, 2]);
});
