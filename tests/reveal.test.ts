/**
 * The reveal's route line. The order here is load-bearing: `originChain` runs from
 * the word's immediate source outward, so the deepest origin must come LAST. A
 * reversed route reads as a confident claim that English came from Latin via
 * Middle English, which is what prompted this file.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { beyondNote, routeLabel, routeParts } from "../web/src/reveal";
import type { WordBank } from "../src/types";

describe("routeLabel", () => {
  it("reads in the direction of derivation, deepest hop last", () => {
    expect(routeLabel(["Middle English", "Old French", "Latin"], "Latin")).toBe(
      "English ← Middle English ← Old French ← Latin",
    );
  });

  it("puts the immediate source next to English", () => {
    const line = routeLabel(["Middle English", "Old French", "Latin"], "Latin");
    expect(line.startsWith("English ← Middle English")).toBe(true);
  });

  it("handles a single hop", () => {
    expect(routeLabel(["Arabic"], "Arabic")).toBe("English ← Arabic");
  });

  it("shows a chain that does not name its own answer in full", () => {
    // Should not happen (the builder anchors the answer to a hop in the chain), but
    // truncating at nothing would silently drop hops.
    expect(routeParts(["Old French", "Latin"], "Basque")).toEqual({
      hops: ["Old French", "Latin"],
      beyond: [],
    });
    expect(routeLabel(["Old French", "Latin"], "Basque")).toBe("English ← Old French ← Latin");
  });
});

describe("routeParts", () => {
  it("splits off hops recorded deeper than the answer", () => {
    // `due` is recorded as far as a reconstruction; the question is about Latin,
    // the deepest hop that has a place on a modern map.
    const parts = routeParts(["Old French", "Latin", "Proto-Italic"], "Latin");
    expect(parts.hops).toEqual(["Old French", "Latin"]);
    expect(parts.beyond).toEqual(["Proto-Italic"]);
  });

  it("has nothing beyond when the answer is the deepest hop", () => {
    expect(routeParts(["Middle English", "Arabic"], "Arabic").beyond).toEqual([]);
  });

  it("explains what lies beyond the answer, or says nothing", () => {
    expect(beyondNote("Latin", [])).toBeNull();
    const note = beyondNote("Latin", ["Proto-Italic"]);
    expect(note).toContain("Proto-Italic");
    expect(note).toContain("Latin");
    expect(note).toContain("no anchor on a modern map");
  });
});

describe("the shipped bank's chains", () => {
  const bank = JSON.parse(readFileSync("web/public/word-bank.json", "utf8")) as WordBank;

  it("never reports a word's chain backwards (the reported case)", () => {
    const enemy = bank.masterSequence.find((entry) => entry.word === "enemy")!;
    expect(enemy.originChain).toEqual(["Middle English", "Old French", "Latin"]);
    expect(routeLabel(enemy.originChain, enemy.originLanguage)).toBe(
      "English ← Middle English ← Old French ← Latin",
    );
    // And it agrees with the curated blurb, which was always right.
    expect(enemy.blurb).toBe("From Middle English, ultimately from Latin.");
  });

  it("always asks about a hop that is in the chain it shows", () => {
    for (const entry of bank.masterSequence) {
      expect(entry.originChain, entry.word).toContain(entry.originLanguage);
    }
  });

  it("only ever records a deeper hop when that hop cannot be located", () => {
    // This is the rule the answer follows: the deepest hop with a home on a modern
    // map. Anything past the answer must therefore be missing from the bank's
    // language table (today, all seven are Proto-* reconstructions).
    for (const entry of bank.masterSequence) {
      const { beyond } = routeParts(entry.originChain, entry.originLanguage);
      for (const hop of beyond) {
        expect(bank.languages[hop], `${entry.word}: ${hop} is locatable but not the answer`).toBeUndefined();
      }
    }
  });

  it("never asks about a hop it cannot locate", () => {
    for (const entry of bank.masterSequence) {
      expect(bank.languages[entry.originLanguage], `${entry.word}: answer has no location`).toBeDefined();
    }
  });
});
