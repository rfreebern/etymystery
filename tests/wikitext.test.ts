/**
 * The wikitext reader behind `scripts/fetch-senses.ts`.
 *
 * It exists because the etymology data the bank is built from records relations per
 * WORD, so `back` arrives as one pile holding both the inherited word and the French
 * loan. Wiktionary writes the difference down — etymology sections with
 * part-of-speech sub-sections and a gloss for each — and that is what a curator needs
 * to tell two senses of one part of speech apart.
 *
 * Fixtures rather than network: the parser's job is to survive the shapes real pages
 * use, and both shapes below are copied from real ones (`back`, then `money`).
 */

import { describe, expect, it } from "vitest";
import { donorCodes, parseEnglishSenses, stripMarkup } from "../scripts/lib/wikitext";

const BACK = `==English==

===Etymology 1===
From {{inh|en|enm|bak}}, from {{inh|en|ang|bæc}}.

====Adjective====
# At or near the rear.

====Noun====
# The [[rear]] of the body, especially the part between the shoulders.

====Verb====
# To go in the reverse direction.

===Etymology 2===
From {{bor|en|fr|bac}}.

====Noun====
# A large shallow vat; a cistern.

==French==

===Etymology===
From {{bor|fr|en|back}}.

===Noun===
# Not the English word: this section must be ignored.
`;

// `money` is written the other way round: an Etymology section with the parts of
// speech as level-3 siblings rather than level-4 children.
const MONEY = `==English==

===Etymology===
From {{inh|en|enm|moneie}}, from {{der|en|xno|moneie}}, from {{der|en|la|moneta}}.

===Noun===
# A generally accepted means of exchange.

===Adjective===
# Cool; excellent.
`;

describe("stripping wikitext", () => {
  it("keeps the words and drops the markup", () => {
    expect(stripMarkup("The [[rear]] of the [[body|bod]][[y]].")).toBe("The rear of the body.");
    expect(stripMarkup("{{lb|en|anatomy}} The rear.")).toBe("The rear.");
    expect(stripMarkup("A '''bold''' word<ref>{{cite|x}}</ref>")).toBe("A bold word");
  });
});

describe("reading donors from an etymology", () => {
  it("reads the language a word came FROM, not the one it went to", () => {
    expect(donorCodes("From {{inh|en|enm|bak}}, from {{inh|en|ang|bæc}}.")).toEqual(["enm", "ang"]);
    // A template naming English as the SOURCE belongs to another language's section.
    expect(donorCodes("From {{bor|fr|en|back}}.")).toEqual([]);
  });

  it("accepts named arguments and ignores non-etymology templates", () => {
    expect(donorCodes("{{inh|1=en|2=gem-pro|3=*baką}}")).toEqual(["gem-pro"]);
    expect(donorCodes("{{lb|en|obsolete}} {{quote-book|en|year=1590|title=x}}")).toEqual([]);
  });
});

describe("reading the senses of an English word", () => {
  it("returns one sense per (etymology, part of speech), with gloss and donors", () => {
    const senses = parseEnglishSenses(BACK);
    expect(senses.map((sense) => [sense.etymology, sense.pos])).toEqual([
      ["Etymology 1", "adjective"],
      ["Etymology 1", "noun"],
      ["Etymology 1", "verb"],
      ["Etymology 2", "noun"],
    ]);
    // Every sense of Etymology 1 shares its donors: they are the same word.
    expect(senses[1]!.donors).toEqual(["enm", "ang"]);
    expect(senses[2]!.donors).toEqual(["enm", "ang"]);
    expect(senses[3]!.donors).toEqual(["fr"]);
    expect(senses[1]!.gloss).toBe("The rear of the body, especially the part between the shoulders.");
  });

  it("ignores other languages on the same page", () => {
    const senses = parseEnglishSenses(BACK);
    expect(senses.some((sense) => sense.gloss.includes("must be ignored"))).toBe(false);
  });

  it("reads a page whose parts of speech are siblings of the etymology", () => {
    const senses = parseEnglishSenses(MONEY);
    expect(senses.map((sense) => sense.pos)).toEqual(["noun", "adjective"]);
    // The etymology above them applies to both, which is how the donor is known.
    expect(senses[0]!.donors).toEqual(["enm", "xno", "la"]);
    expect(senses[0]!.gloss).toBe("A generally accepted means of exchange.");
  });

  it("returns nothing for a page with no English section", () => {
    expect(parseEnglishSenses("==French==\n\n===Noun===\n# mot\n")).toEqual([]);
    expect(parseEnglishSenses("")).toEqual([]);
  });
});
