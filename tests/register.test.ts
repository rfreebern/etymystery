import { describe, expect, it } from "vitest";
import { UNUSABLE_SENSE_LABELS, hasUnusableLabel, unusableSenseKeys } from "../scripts/lib/register";

/** A sense record as the cache holds it: one entry per definition line, in page order. */
const sense = (pos: string, ...definitionLabels: string[][]): { pos: string; definitionLabels: string[][] } => ({
  pos,
  definitionLabels,
});

describe("the register rule", () => {
  it("refuses senses Wiktionary marks obsolete, archaic or literary", () => {
    expect(hasUnusableLabel(["literary"])).toBe(true); // the musard case
    expect(hasUnusableLabel(["obsolete"])).toBe(true);
    expect(hasUnusableLabel(["archaic"])).toBe(true);
    expect(hasUnusableLabel(["obsolete", "rare"])).toBe(true);
  });

  it("keeps the labels that are not a problem", () => {
    for (const label of [
      "dated", "informal", "colloquial", "historical", "regional", "dialectal", "rare", "us", "slang",
    ]) {
      expect(hasUnusableLabel([label]), label).toBe(false);
    }
    expect(hasUnusableLabel([])).toBe(false);
  });

  it("refuses a part of speech whose every definition line is labelled", () => {
    const keys = unusableSenseKeys({
      musard: { senses: [sense("noun", ["literary"])] },
      tristful: { senses: [sense("adjective", ["obsolete"], ["obsolete"])] },
    });
    expect([...keys].sort()).toEqual(["musard", "musard:noun", "tristful", "tristful:adjective"]);
  });

  it("keeps a part of speech that still has an unlabelled line", () => {
    // `disparage` verb: Wiktionary labels the obsolete sense first and leaves the ordinary
    // sense unlabelled, so reading only the first line would condemn a word in daily use.
    const keys = unusableSenseKeys({
      disparage: { senses: [sense("verb", ["obsolete"], [])] },
    });
    expect([...keys]).toEqual([]);
  });

  it("still refuses the parts of speech that have nothing current left", () => {
    // Same word, but the noun really is obsolete in both lines: that key goes, the verb stays.
    const keys = unusableSenseKeys({
      disparage: { senses: [sense("noun", ["obsolete"], ["obsolete"]), sense("verb", ["obsolete"], [])] },
    });
    expect([...keys]).toEqual(["disparage:noun"]);
  });

  it("treats a record with no labels as ordinary English", () => {
    // A cache written before labels existed has no field at all. Reading that as unusable
    // would empty the pool, so it reads as "not judged" (the build reports how much of the
    // bank it actually judged, so a stale cache cannot pass silently).
    const keys = unusableSenseKeys({
      okra: { senses: [{ pos: "noun" }, sense("noun", [])] },
    });
    expect([...keys]).toEqual([]);
  });

  it("names the labels it refuses, so the policy lives in one place", () => {
    expect([...UNUSABLE_SENSE_LABELS]).toEqual(["obsolete", "archaic", "literary"]);
  });
});

describe("when the label and the frequency list disagree", () => {
  it("keeps a labelled word the frequency list knows", () => {
    const senses = { disparage: { senses: [sense("verb", ["obsolete"])] } };
    expect([...unusableSenseKeys(senses)].length).toBeGreaterThan(0);
    expect([...unusableSenseKeys(senses, (word) => word === "disparage")]).toEqual([]);
  });

  it("still refuses a labelled word with no rank", () => {
    const senses = { musard: { senses: [sense("noun", ["literary"])] } };
    expect([...unusableSenseKeys(senses, () => false)]).toContain("musard");
  });

  it("keeps an unlabelled word whether or not it is ranked", () => {
    // `okra` and `tsetse` are unranked borrowed words, and exactly what the bank is for.
    const senses = { okra: { senses: [sense("noun", [])] } };
    expect([...unusableSenseKeys(senses, () => false)]).toEqual([]);
    expect([...unusableSenseKeys(senses, () => true)]).toEqual([]);
  });
});
