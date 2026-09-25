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
import { donorCodes, parseEnglishSenses, senseLabels, stripMarkup } from "../scripts/lib/wikitext";

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


// `abstract` nests its parts of speech under pronunciation sections, so the etymology
// chunk contains none of them. Document order still says which donors apply.
const ABSTRACT = `==English==

===Etymology===
From {{der|en|la|abstractus}}.

===Pronunciation 1===
{{IPA|en|/ˈæb.strækt/}}

====Noun====
# An abridgement or summary.

====Adjective====
# Derived; extracted.

===Pronunciation 2===
====Verb====
# To separate; to disengage.
`;

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


  it("reads parts of speech nested under pronunciation sections", () => {
    // Reported by the fetcher: four words came back with no senses at all, and two of
    // them (`abstract`, `incense`) plainly have an English page. The parts of speech
    // were nested one level deeper than the etymology, which the level-based readers
    // could not see.
    const senses = parseEnglishSenses(ABSTRACT);
    expect(senses.map((sense) => [sense.pos, sense.donors])).toEqual([
      ["noun", ["la"]],
      ["adjective", ["la"]],
      ["verb", ["la"]],
    ]);
    expect(senses[0]!.gloss).toBe("An abridgement or summary.");
    expect(senses[2]!.gloss).toBe("To separate; to disengage.");
  });

  it("returns nothing for a page with no English section", () => {
    expect(parseEnglishSenses("==French==\n\n===Noun===\n# mot\n")).toEqual([]);
    expect(parseEnglishSenses("")).toEqual([]);
  });
});

describe("the register labels on a sense", () => {
  // The signal that keeps words nobody uses off the puzzle: Wiktionary marks such senses
  // itself, and `musard` carries `{{tlb|en|literary}}` on its only English noun sense.
  const MUSARD = `==English==

===Etymology===
From {{bor|en|frm|musard}}.

===Noun===
# {{tlb|en|literary}} A [[dreamer]]; an [[absent-minded]] person.

==French==

===Adjective===
# {{lb|fr|dated}} spending one's time musing
`;

  it("reads the labels off the definition line", () => {
    const [sense] = parseEnglishSenses(MUSARD);
    expect(sense!.gloss).toBe("A dreamer; an absent-minded person.");
    expect(sense!.definitionLabels).toEqual([["literary"]]);
  });

  it("ignores the labels of other languages on the same page", () => {
    // The French section's `dated` must not leak into the English sense.
    expect(parseEnglishSenses(MUSARD).every((sense) => !sense.definitionLabels.flat().includes("dated"))).toBe(true);
  });

  it("collapses duplicates and keeps the order", () => {
    expect(senseLabels("# {{lb|en|archaic|dialectal}} Old use.")).toEqual(["archaic", "dialectal"]);
    expect(senseLabels("# {{lb|en|obsolete}}{{lb|en|obsolete}} Gone.")).toEqual(["obsolete"]);
  });

  it("accepts the named-argument shape", () => {
    expect(senseLabels("# {{lb|1=en|2=obsolete}} Gone.")).toEqual(["obsolete"]);
  });

  it("reads the language code as a language, not as a label", () => {
    expect(senseLabels("# {{lb|en}} A plain sense.")).toEqual([]);
    expect(senseLabels("# {{tlb|en|US}} American.")).toEqual(["us"]);
    expect(senseLabels("# No template at all.")).toEqual([]);
  });

  it("reports nothing for an ordinary current sense", () => {
    // What the shipped regional words look like: no register label anywhere.
    const [sense] = parseEnglishSenses(`==English==

===Etymology===
From {{bor|en|tn|tsetse}}.

===Noun===
# Any fly of the genus Glossina.
`);
    expect(sense!.definitionLabels).toEqual([[]]);
  });

  it("always carries the field, so a record can never look unlabelled by accident", () => {
    for (const sense of parseEnglishSenses(BACK)) expect(Array.isArray(sense.definitionLabels)).toBe(true);
  });
});

describe("connective words in a label template", () => {
  it("does not read 'or' as a label", () => {
    // Wiktionary writes `{{lb|en|archaic|or|historical}}` to mean "archaic or historical".
    expect(senseLabels("# {{lb|en|archaic|or|historical}} A stew.")).toEqual(["archaic", "historical"]);
    expect(senseLabels("# {{lb|en|chiefly|US}} American.")).toEqual(["us"]);
  });
});
