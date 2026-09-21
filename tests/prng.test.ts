import { describe, expect, it } from "vitest";
import { hashString, mulberry32, shuffle } from "../src/prng";

describe("mulberry32", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds", () => {
    const a = Array.from({ length: 32 }, () => mulberry32(1)());
    const b = Array.from({ length: 32 }, () => mulberry32(2)());
    expect(a).not.toEqual(b);
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("has a reasonable mean over many draws", () => {
    const rng = mulberry32(123);
    let sum = 0;
    const n = 10_000;
    for (let i = 0; i < n; i++) sum += rng();
    const mean = sum / n;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});

describe("hashString", () => {
  it("is deterministic", () => {
    expect(hashString("etymystery")).toBe(hashString("etymystery"));
  });

  it("returns 32-bit unsigned integers", () => {
    const h = hashString("elapse");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it("differs for different inputs", () => {
    expect(hashString("a")).not.toBe(hashString("b"));
  });
});

describe("shuffle", () => {
  it("preserves all elements (is a bijection)", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const sortedOriginal = [...items].sort((x, y) => x - y);
    shuffle(items, mulberry32(3));
    expect([...items].sort((x, y) => x - y)).toEqual(sortedOriginal);
  });

  it("is deterministic for the same seed", () => {
    const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(9));
    const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(9));
    expect(a).toEqual(b);
  });

  it("shuffles in place and returns the same array reference", () => {
    const items = [1, 2, 3, 4, 5];
    const returned = shuffle(items, mulberry32(11));
    expect(returned).toBe(items);
    expect([...items].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });
});
