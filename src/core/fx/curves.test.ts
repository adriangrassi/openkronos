import { test } from "node:test";
import assert from "node:assert/strict";
import { logHz, peqDb, dynOut, approxRatio, decayDb, noteMs, lfoY, driveY } from "./curves.ts";

test("logHz: log-spaced 20 Hz..20 kHz", () => {
  assert.equal(logHz(0, 5), 20);
  assert.equal(logHz(4, 5), 20000);
  assert.ok(Math.abs(logHz(2, 5) - 632.455532) < 1e-4); // 20 * 1000^0.5
  assert.ok(Math.abs(logHz(0, 3, 100, 10000) - 100) < 1e-9);
});

test("peqDb: band centre gives gain; shelf at hz gives gain/2", () => {
  const peak = (gain: number) => ({ hz: 1000, q: 1, gain, shape: "peak" as const });
  assert.equal(peqDb([peak(6)], 1000), 6);
  assert.ok(Math.abs(peqDb([peak(6)], 2000) - 6 / 3.25) < 1e-9); // q*(2 - 0.5) = 1.5, 1+2.25
  assert.ok(Math.abs(peqDb([{ hz: 1000, q: 2, gain: 6, shape: "peak" }], 2000) - 0.6) < 1e-9);
  assert.equal(peqDb([{ hz: 100, q: 1, gain: 6, shape: "lowshelf" }], 100), 3);
  assert.equal(peqDb([{ hz: 100, q: 1, gain: 6, shape: "highshelf" }], 100), 3);
  assert.equal(peqDb([peak(6), peak(-2)], 1000), 4); // bands sum
});

test("dynOut comp: slope 1/R above threshold, identity below", () => {
  const p = { threshold: -20, ratio: 4, knee: 0, mode: "comp" as const };
  assert.equal(dynOut(-30, p), -30);
  assert.ok(Math.abs(dynOut(-10, p) - -17.5) < 1e-9); // -20 + 10/4
  const slope = (dynOut(-6, p) - dynOut(-10, p)) / 4; // -16.5 - -17.5 over 4 dB in
  assert.ok(Math.abs(slope - 0.25) < 1e-9);
});

test("dynOut comp knee: soft knee is continuous with both sides", () => {
  const p = { threshold: -20, ratio: 4, knee: 10, mode: "comp" as const };
  assert.ok(Math.abs(dynOut(-20, p) - -20.9375) < 1e-9); // -20 + (-0.75)*25/20
  assert.ok(Math.abs(dynOut(-15, p) - -18.75) < 1e-9);   // upper edge of knee
  assert.ok(Math.abs(dynOut(-25, p) - -25) < 1e-9);      // lower edge of knee
});

test("dynOut limit: never above ceiling, infinite ratio flattens at threshold", () => {
  const lim = { threshold: -6, ratio: Infinity, knee: 0, mode: "limit" as const, ceiling: -0.3 };
  assert.equal(dynOut(-2, lim), -6);
  assert.equal(dynOut(0, { ...lim, threshold: -1, ratio: 1 }), -0.3);
  for (let x = -60; x <= 6; x += 0.5) assert.ok(dynOut(x, lim) <= -0.3);
});

test("dynOut expand: unity above threshold, steeper below, floored at -96", () => {
  const p = { threshold: -40, ratio: 2, knee: 0, mode: "expand" as const };
  assert.equal(dynOut(-30, p), -30);
  assert.equal(dynOut(-50, p), -60); // -40 + (-10)*2
  assert.equal(dynOut(-80, p), -96);
});

test("approxRatio: 1/(1-t), infinite at t >= 1", () => {
  assert.equal(approxRatio(0), 1);
  assert.equal(approxRatio(0.5), 2);
  assert.equal(approxRatio(0.75), 4);
  assert.equal(approxRatio(1), Infinity);
  assert.equal(approxRatio(1.5), Infinity);
});

test("decayDb: silent before pre delay, -60 dB per time span after", () => {
  assert.equal(decayDb(50, { preDelay: 100, timeSec: 1 }), -Infinity);
  assert.equal(decayDb(0, { preDelay: 0, timeSec: 2 }), 0);
  assert.equal(decayDb(1000, { preDelay: 0, timeSec: 2 }), -30);
  assert.equal(decayDb(600, { preDelay: 100, timeSec: 1 }), -30);
});

test("noteMs: quarter at 120 BPM is 500 ms; 1/8 x3 is 750 ms", () => {
  assert.equal(noteMs(120, "1/4", 1), 500);
  assert.equal(noteMs(120, "1/8", 3), 750);
  assert.equal(noteMs(120, "1/2", 1), 1000);
});

test("lfoY: Triangle peak at quarter period; shape 0 is linear", () => {
  assert.equal(lfoY("Triangle", 0, 0, 0.25), 1);
  assert.equal(lfoY("Triangle", 0, 0, 0), 0);
  assert.equal(lfoY("Triangle", 0, 0, 0.75), -1);
  assert.equal(lfoY("Triangle", 0, 90, 0), 1); // phase 90 deg shifts the peak to x=0
  assert.equal(lfoY("Square", 0, 0, 0.25), 1);
  assert.equal(lfoY("Square", 0, 0, 0.75), -1);
  assert.equal(lfoY("Saw Up", 0, 0, 0.5), 0);
  assert.equal(lfoY("Saw Down", 0, 0, 0.25), 0.5);
  assert.ok(Math.abs(lfoY("Sine", 0, 0, 0.25) - 1) < 1e-9);
  assert.ok(Math.abs(lfoY("Triangle", 50, 0, 0.125) - Math.sqrt(0.5)) < 1e-9); // 0.5^0.5
  assert.ok(Math.abs(lfoY("Triangle", 50, 0, 0.625) + Math.sqrt(0.5)) < 1e-9); // sign kept
});

test("driveY: odd, monotonic, unity at x=1 with no drive", () => {
  assert.equal(driveY(1, 0), 1);
  assert.ok(Math.abs(driveY(0.5, 0) - 0.60678) < 1e-4); // tanh(0.5)/tanh(1)
  assert.equal(driveY(0, 0.7), 0);
  for (const d of [0, 0.3, 1]) {
    assert.ok(Math.abs(driveY(-0.4, d) + driveY(0.4, d)) < 1e-12);
    let prev = -Infinity;
    for (let x = -1; x <= 1.0001; x += 0.1) {
      const y = driveY(x, d);
      assert.ok(y >= prev);
      prev = y;
    }
  }
});
