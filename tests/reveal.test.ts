/**
 * The reveal's route line. Order is load-bearing: the route is DISPLAYED oldest
 * first, ending at English, because English reads left to right. `originChain` is
 * stored the other way round (immediate source first), which is why this lives in
 * one place — and why both a reversed array and a mismatched arrow have shipped as
 * a confidently-wrong derivation.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTE_ARROW, beyondNote, routeLabel, routeLine } from "../web/src/reveal";
import type { WordBank } from "../src/types";

describe("routeLabel", () => {
  it("reads oldest first, ending at English", () => {
    expect(routeLabel(["Middle English", "Old French", "Latin"], "Latin")).toBe(
      "Latin → Old French → Middle English → English",
    );
  });

  it("puts the oldest hop first and the immediate source beside English", () => {
    const line = routeLabel(["Middle English", "Old French", "Latin"], "Latin");
    expect(line.startsWith("Latin → ")).toBe(true);
    expect(line.endsWith("Middle English → English")).toBe(true);
  });

  it("uses a rightward arrow, since the order is chronological", () => {
    // `←` in oldest-first order would read as "Latin came from Old French".
    expect(ROUTE_ARROW).toBe(" → ");
    expect(routeLabel(["Arabic"], "Arabic")).not.toContain("←");
  });

  it("handles a single hop", () => {
    expect(routeLabel(["Arabic"], "Arabic")).toBe("Arabic → English");
  });

  it("shows a chain that does not name its own answer in full", () => {
    // Should not happen (the builder anchors the answer to a hop in the chain), but
    // truncating at nothing would silently drop hops. English is still the end of
    // the line: it is the word the chain describes.
    expect(routeLine(["Old French", "Latin"], "Basque")).toEqual({
      hops: ["Latin", "Old French", "English"],
      beyond: [],
    });
    expect(routeLabel(["Old French", "Latin"], "Basque")).toBe("Latin → Old French → English");
  });
});

describe("routeLine", () => {
  it("splits off hops older than the answer", () => {
    // `due` is recorded back to a reconstruction; the question is about Latin, the
    // oldest hop that has a place on a modern map.
    const line = routeLine(["Old French", "Latin", "Proto-Italic"], "Latin");
    expect(line.hops).toEqual(["Latin", "Old French", "English"]);
    expect(line.beyond).toEqual(["Proto-Italic"]);
  });

  it("orders the hops older than the answer the same way round", () => {
    const line = routeLine(["Old French", "Latin", "Proto-Italic", "Proto-Indo-European"], "Latin");
    expect(line.hops).toEqual(["Latin", "Old French", "English"]);
    expect(line.beyond).toEqual(["Proto-Indo-European", "Proto-Italic"]);
  });

  it("has nothing older when the answer is the oldest recorded hop", () => {
    expect(routeLine(["Middle English", "Arabic"], "Arabic").beyond).toEqual([]);
  });

  it("explains what lies older than the answer, or says nothing", () => {
    expect(beyondNote("Latin", [])).toBeNull();
    const note = beyondNote("Latin", ["Proto-Italic"]);
    expect(note).toContain("Proto-Italic");
    expect(note).toContain("Latin");
    expect(note!.toLowerCase()).toContain("no anchor on a modern map");
    expect(note!.startsWith("Older still:")).toBe(true);
    // The copy rule: no em dashes in user-visible text.
    expect(note).not.toContain("—");
  });
});

describe("the shipped bank's chains", () => {
  const bank = JSON.parse(readFileSync("web/public/word-bank.json", "utf8")) as WordBank;

  it("never reports a word's chain backwards (the reported case)", () => {
    const enemy = bank.masterSequence.find((entry) => entry.word === "enemy")!;
    expect(enemy.originChain).toEqual(["Middle English", "Old French", "Latin"]);
    expect(routeLabel(enemy.originChain, enemy.originLanguage)).toBe(
      "Latin → Old French → Middle English → English",
    );
    // And it agrees with the curated blurb, which was always right.
    expect(enemy.blurb).toBe("From Middle English, ultimately from Latin.");
  });

  it("always asks about a hop that is in the chain it shows", () => {
    for (const entry of bank.masterSequence) {
      expect(entry.originChain, entry.word).toContain(entry.originLanguage);
    }
  });

  it("only ever records an older hop when that hop cannot be located", () => {
    // This is the rule the answer follows: the oldest hop with a home on a modern
    // map. Anything older than the answer must therefore be missing from the bank's
    // language table (today, all seven are Proto-* reconstructions).
    for (const entry of bank.masterSequence) {
      const { beyond } = routeLine(entry.originChain, entry.originLanguage);
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
