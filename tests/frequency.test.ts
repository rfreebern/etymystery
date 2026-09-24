import { describe, expect, it } from "vitest";
import { normalizeWord, parseFrequencyList } from "../scripts/lib/frequency";
import { TIER_COUNT } from "../src/bank";
import { assignTier } from "../scripts/lib/tiering";

describe("parseFrequencyList", () => {
  it("ranks by count, most common first", () => {
    const list = parseFrequencyList("you 22484400\nthe 17594291\na 14484562\n");
    expect(list.rankOf("you")).toBe(1);
    expect(list.rankOf("the")).toBe(2);
    expect(list.rankOf("a")).toBe(3);
    expect(list.size).toBe(3);
    expect(list.rankOf("zebra")).toBeUndefined();
  });

  it("accepts tab-separated (wordfreq-style) input", () => {
    const list = parseFrequencyList("word\tcount\nmusic\t5000\nchat\t900\n");
    expect(list.rankOf("music")).toBe(1);
    expect(list.rankOf("chat")).toBe(2);
  });

  it("treats a bare word list as file order", () => {
    const list = parseFrequencyList("first\nsecond\nthird\n");
    expect(list.rankOf("first")).toBe(1);
    expect(list.rankOf("third")).toBe(3);
  });

  it("normalizes case and whitespace, and keeps the best rank for duplicates", () => {
    const list = parseFrequencyList("Tea 100\ntea 50\n  tea 10\n");
    expect(normalizeWord("  Tea ")).toBe("tea");
    expect(list.rankOf("TEA")).toBe(1);
    expect(list.size).toBe(1);
  });

  it("ignores blank lines and comments", () => {
    const list = parseFrequencyList("\n# a comment\nword 5\n\n");
    expect(list.size).toBe(1);
    expect(list.rankOf("word")).toBe(1);
  });

  it("resolves ties deterministically by first appearance", () => {
    const list = parseFrequencyList("beta 7\nalpha 7\n");
    expect(list.rankOf("beta")).toBe(1);
    expect(list.rankOf("alpha")).toBe(2);
  });
});

describe("chain depth and frequency feed the tier heuristic", () => {
  it("rises with chain depth, squeezed onto the tiers the bank has", () => {
    expect(assignTier({ chainDepth: 1 })).toBe(1);
    expect(assignTier({ chainDepth: 2 })).toBe(2);
    expect(assignTier({ chainDepth: 3 })).toBe(3);
    expect(assignTier({ chainDepth: 4 })).toBe(4);
    // Depth saturates at 4 and the result can never leave the bank's range: the
    // heuristic builds a ten-point score, then maps it onto the tiers that exist.
    for (let depth = 1; depth <= 8; depth++) {
      const tier = assignTier({ chainDepth: depth });
      expect(tier).toBeGreaterThanOrEqual(1);
      expect(tier).toBeLessThanOrEqual(TIER_COUNT);
    }
  });

  it("lifts common words and demotes rare ones for the same chain depth", () => {
    const middle = assignTier({ chainDepth: 3 });
    expect(assignTier({ chainDepth: 3, frequencyRank: 500 })).toBeLessThan(middle);
    expect(assignTier({ chainDepth: 3, frequencyRank: 10_000 })).toBeLessThanOrEqual(middle);
    expect(assignTier({ chainDepth: 3, frequencyRank: 200_000 })).toBeGreaterThan(middle);
  });

  it("clamps to the ends of the range", () => {
    expect(assignTier({ chainDepth: 1, frequencyRank: 1 })).toBe(1);
    expect(assignTier({ chainDepth: 99, frequencyRank: 9_999_999 })).toBe(TIER_COUNT);
  });
});
