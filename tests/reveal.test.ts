/**
 * The reveal's route line. Order is load-bearing: the route is DISPLAYED oldest
 * first, ending at English, because English reads left to right. `originChain` is
 * stored the other way round (immediate source first), which is why this lives in
 * one place — and why both a reversed array and a mismatched arrow have shipped as
 * a confidently-wrong derivation.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTE_ARROW, answerYearLabel, beyondNote, coarseSpanNote, routeLabel, routeLine } from "../web/src/reveal";
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

describe("blurbs never name a language the puzzle cannot credit", () => {
  // The report that prompted this: `kiosk`'s blurb said "From Turkish koshk" while
  // the answer was Persian, so a player who followed the prose pinned Turkey and was
  // told they were wrong. A blurb may name a language that is IN the route, or one
  // whose country set overlaps the answer's (a pin there still scores), but never one
  // that is neither — that is prose pointing at a country the game refuses.
  const bank = JSON.parse(readFileSync("web/public/word-bank.json", "utf8")) as WordBank;

  it("names only languages the route shows, or ones that share the answer's country", () => {
    const names = Object.keys(bank.languages).sort((a, b) => b.length - a.length);
    const offenders: string[] = [];
    // Every entry, not just the ones in the master sequence: the sequence stops at the
  // scarcest tier, so a whole-bank check is the only one that cannot miss a word.
  for (const entry of bank.tiers.flat()) {
      const inChain = new Set([...entry.originChain, "English"]);
      const countries = new Set(entry.countries);
      // Remove every language the route already shows, so "French" inside "Old
      // French" is not mistaken for a missing language. Case-insensitive, because
      // prose says "medieval Latin" where the chain says "Medieval Latin".
      let rest = entry.blurb;
      for (const lang of inChain) {
        const esc = lang.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        rest = rest.replace(new RegExp(esc, "gi"), " ");
      }
      for (const name of names) {
        if (inChain.has(name)) continue;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`\\b${escaped}\\b`, "i").test(rest)) continue;
        const info = bank.languages[name];
        if ((info?.countries ?? []).some((code) => countries.has(code))) continue;
        offenders.push(
          `${entry.word}: blurb names ${name} (${(info?.countries ?? []).join(",")}) ` +
            `but the answer is ${entry.originLanguage} (${entry.countries.join(",")})`,
        );
      }
    }
    expect(offenders).toEqual([]);
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

describe("the answer's date wording", () => {
  it("distinguishes a precise year from a coarse span", () => {
    // The reveal must not claim precision the record does not have.
    expect(answerYearLabel(1590)).toBe("first used around 1590");
    expect(answerYearLabel(700, 1150)).toBe("first recorded between 700 and 1150");
    // An "equal bounds" pair is a point, not a span.
    expect(answerYearLabel(1000, 1000)).toBe("first used around 1000");
  });

  it("explains why a coarse span is graded generously", () => {
    expect(coarseSpanNote(1590)).toBeNull();
    const note = coarseSpanNote(700, 1150)!;
    expect(note).toContain("in use by 1150");
    expect(note).toContain("700 – 1150");
    // No em dashes in user-visible prose (the project's copy rule).
    expect(note).not.toContain("—");
  });

  it("names the period when the span is exactly a period", () => {
    // A span taken from the chain IS the period it names, so the reveal says so
    // rather than printing the same two numbers with no explanation.
    expect(answerYearLabel(1151, 1500, "Middle English")).toBe(
      "recorded in the Middle English period (1151 – 1500)",
    );
    expect(coarseSpanNote(700, 1150, "Old English")).toBe(
      "The sources date it only by period, so any window touching 700 – 1150 counts as a hit.",
    );
    // A period label without a span (or with a point span) must not be borrowed.
    expect(answerYearLabel(1590, undefined, "Modern")).toBe("first used around 1590");
    expect(coarseSpanNote(1590, undefined, "Modern")).toBeNull();
  });
});

