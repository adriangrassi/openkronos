import assert from "node:assert/strict";
import { test } from "node:test";
import type { Row } from "../params/params.ts";
import { bankLabel, eqCurve, eqHz, hzText, geText, mixerCells, nameTag, panText, programText, statusText } from "./mixer.ts";

const row = (ofs: number, group: string, name: string): Row => ({
  ofs, bitHi: null, bitLo: null, group, name, rawMin: 0, rawMax: 127, fixed: false, valueText: "~", signed: false,
  continuation: false, parts: [[ofs, 6, 0]], typ: null, soc: null, sub: null, pid: null, idx: null,
});

test("bank column to the label the keyboard shows", () => {
  assert.equal(bankLabel(0), "I-A");
  assert.equal(bankLabel(5), "I-F");
  assert.equal(bankLabel(17), "U-A");
  assert.equal(bankLabel(24), "U-AA");
  assert.equal(bankLabel(30), "U-GG");
  assert.equal(bankLabel(6), "g");
  assert.equal(bankLabel(8), "g(2)");
  assert.equal(bankLabel(16), "g(d)");
  assert.equal(programText(22, 5), "U-F005");
  assert.equal(programText(29, 5), "U-FF005");
});

test("pan text follows the keyboard: RND, L, c064, R", () => {
  assert.equal(panText(0), "RND");
  assert.equal(panText(22), "L022");
  assert.equal(panText(64), "c064");
  assert.equal(panText(78), "R078");
});

test("status text names only the two values known to be Off and INT", () => {
  assert.equal(statusText(0, "Off"), "Off");
  assert.equal(statusText(1, "1"), "INT");
  assert.equal(statusText(2, "2"), "2");
  assert.equal(statusText(4, "External2"), "External2");
});

test("mixerCells picks the rows of each timbre by name", () => {
  const names = ["Program Number", "Bank Number", "Status", "Volume", "Pan", "Mute"];
  const rows: Row[] = [];
  let o = 0;
  for (let t = 1; t <= 16; t++) for (const n of names) rows.push(row(o++, `Timbre${t}`, n));
  const cells = mixerCells(rows);
  assert.equal(cells.length, 16);
  assert.equal(cells[2].timbre, 3);
  assert.equal(cells[2].volume.name, "Volume");
  assert.equal(cells[2].volume.group, "Timbre3");
  assert.equal(mixerCells(rows.slice(0, 5)).length, 0);
});

test("GE text is the 4 digit number, a colon and the name", () => {
  assert.equal(geText(550, ["a"]), "0550");
  assert.equal(geText(1, ["x", "Pad"]), "0001: Pad");
  assert.equal(nameTag(0, "HD-1 High Definition Syn"), "000: HD-1 High Definition Syn");
});

test("EQ curve: flat is 0 dB, boosting low gain lifts the low end only", () => {
  const flat = eqCurve({ low: 0, mid: 0, high: 0, midHz: 1000 }, 48);
  assert.ok(flat.every((v) => Math.abs(v) < 1e-9));
  const c = eqCurve({ low: 12, mid: 0, high: 0, midHz: 1000 }, 48);
  assert.ok(c[0] > 10 && Math.abs(c[47]) < 1);
});

test("EQ mid frequency runs 100 Hz to 10 kHz and prints like the screen", () => {
  assert.equal(Math.round(eqHz(0, 165)), 100);
  assert.equal(Math.round(eqHz(165, 165)), 10000);
  assert.equal(hzText(970.4), "970");
  assert.equal(hzText(5200), "5.20k");
});
