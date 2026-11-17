import { test } from "node:test";
import assert from "node:assert/strict";
import { PcgError, parsePcg, serializePcg, verifyChecksums } from "./pcg.ts";
import { bank, concat, container, entry, file, leaf, raw } from "./synthetic.ts";

// Offsets: file header 0..16, PCG1 header 16, DIV1 at 28 (56 bytes), PRG1 at 84, MBK1 at 96 (its data at 108).
const tree = () =>
  file(
    container(
      "PCG1",
      raw("DIV1", new Uint8Array(44), 0x10000),
      container("PRG1", bank("MBK1", 40, 0, [entry("Alpha", 40, 7)]), leaf("GLB1", Uint8Array.of(1, 2, 3))),
    ),
  );

const findTag = (b: Uint8Array, tag: string): number => {
  const t = [...tag].map((c) => c.charCodeAt(0));
  for (let i = 0; i + 4 <= b.length; i++) if (t.every((c, k) => b[i + k] === c)) return i;
  throw new Error(`no ${tag}`);
};

test("an unmodified file round-trips byte-identical, including unknown leaves", () => {
  const src = tree();
  assert.deepEqual(serializePcg(parsePcg(src)), src);
});

test("parsing copies the input, and serialize returns a copy", () => {
  const src = tree();
  const f = parsePcg(src);
  src[0] = 0x41;
  serializePcg(f)[0] = 0x41;
  assert.equal(String.fromCharCode(...serializePcg(f).subarray(0, 4)), "KORG");
});

test("verifyChecksums is empty on good data and names the tag and offset of a bad leaf", () => {
  const src = tree();
  assert.deepEqual(verifyChecksums(parsePcg(src)), []);
  const glb = findTag(src, "GLB1");
  src[glb + 12] ^= 0x01;
  assert.deepEqual(verifyChecksums(parsePcg(src)), [`GLB1 @${glb}`]);
});

test("malformed input throws PcgError, never another error", () => {
  const good = tree();
  const patched = (at: number, v: number) => {
    const c = Uint8Array.from(good);
    new DataView(c.buffer).setUint32(at, v);
    return c;
  };
  const deep = (n: number) => {
    let inner = leaf("GLB1", Uint8Array.of(1));
    for (let i = 0; i < n; i++) inner = container("PRG1", inner);
    return file(container("PCG1", inner));
  };
  const cases: Record<string, Uint8Array> = {
    empty: new Uint8Array(0),
    short: good.subarray(0, 10),
    "wrong magic": Uint8Array.from(good).fill(0x41, 0, 4),
    "PCG1 size past end": patched(20, 0xfffffff0),
    "DIV1 size past PCG1 end": patched(32, 0x7fffffff),
    "truncated mid-block": good.subarray(0, good.length - 5),
    "trailing junk": concat(good, Uint8Array.of(1, 2, 3)),
    "bank count does not match size": patched(108, 999),
    "nested too deep": deep(20),
  };
  for (const [name, bytes] of Object.entries(cases)) {
    assert.throws(() => parsePcg(bytes), PcgError, name);
  }
});
