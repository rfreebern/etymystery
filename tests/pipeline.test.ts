import { describe, expect, it } from "vitest";
import { DONOR_RELATION_PRIORITY, buildChains, extractEdges, isCandidateTerm, parseCsv } from "../scripts/lib/etymology-db";
import { parseLanguageTsv } from "../scripts/lib/languages";
import { buildBankFromInputs } from "../scripts/lib/bank-builder";
import { ROUNDS_PER_DAY, TIER_COUNT } from "../src/bank";

const EDGES_CSV = `term_id,lang,term,reltype,related_term_id,related_lang,related_term,position,group_tag,parent_tag,parent_position
1,en,elapse,borrowed_from,2,frm,elapser,0,,,
2,frm,elapser,derived_from,3,la,elapsus,0,,,
3,en,coffee,borrowed_from,4,ar,qahwa,0,,,
4,en,Runner,has_suffix,5,en,run,0,,,
5,en,quark,cognate_of,6,de,Quark,0,,,
6,en,pizza,derived_from,7,it,pizza,0,,,
7,en,zombie,borrowed_from,8,kg,zumbi,0,,,
8,en,camouflage,borrowed_from,9,fr,camoufler,0,,,
9,fr,camoufler,derived_from,10,it,camuffare,0,,,
10,en,tsunami,borrowed_from,11,ja,tsunami,0,,,
11,en,samovar,borrowed_from,12,ru,samovar,0,,,
12,en,kayak,borrowed_from,13,iu,qajaq,0,,,
13,en,tariff,borrowed_from,14,ar,taarif,0,,,
14,en,kiosk,borrowed_from,15,tr,koeshk,0,,,
15,en,anorak,borrowed_from,16,kl,annoraaq,0,,,
16,en,juggernaut,borrowed_from,17,sa,jagannaath,0,,,
17,en,alpha,borrowed_from,18,fr,alpha,0,,,
18,fr,alpha,derived_from,19,en,alpha,0,,,
19,en,"bulk, term",borrowed_from,20,fr,terme,0,,
`;

const LANGUAGES_TSV = [
  "code\tname\tcountries\tregion\tcontinent\tlat\tlng",
  "en\tEnglish\tGB;US;AU\tNorthern Europe\tEurope\t54\t-2",
  "frm\tMiddle French\tFR\tWestern Europe\tEurope\t47\t2",
  "fr\tFrench\tFR\tWestern Europe\tEurope\t47\t2",
  "la\tLatin\tIT\tSouthern Europe\tEurope\t42\t12",
  "ar\tArabic\tSA;EG;DZ\tWestern Asia\tAsia\t24\t46",
  "it\tItalian\tIT\tSouthern Europe\tEurope\t43\t12",
  "kg\tKikongo\tCD;AO\tMiddle Africa\tAfrica\t-5\t15",
  "de\tGerman\tDE\tWestern Europe\tEurope\t51\t10",
  "ja\tJapanese\tJP\tEastern Asia\tAsia\t36\t138",
  "ru\tRussian\tRU\tEastern Europe\tEurope\t56\t38",
  "iu\tInuktitut\tCA;GL\tNorthern America\tNorth America\t64\t-51",
  "tr\tTurkish\tTR\tWestern Asia\tAsia\t39\t35",
  "kl\tGreenlandic\tGL\tNorthern America\tNorth America\t64\t-51",
  "sa\tSanskrit\tIN;NP\tSouthern Asia\tAsia\t24\t84",
  "xx\tTestlang\tGBR;FR\tWestern Europe\tEurope\t1\t2",
].join("\n");

const CURATION: Record<string, { year: number; tier?: number; blurb?: string }> = {
  pizza: { year: 1935, tier: 1 },
  coffee: { year: 1590, tier: 2 },
  samovar: { year: 1830, tier: 3 },
  elapse: { year: 1640, tier: 4, blurb: "From French, from Latin elapsus, 'to slip away'." },
  kayak: { year: 1750, tier: 5 },
  camouflage: { year: 1890, tier: 3 },
  tariff: { year: 1590, tier: 4 },
  kiosk: { year: 1625, tier: 5 },
  anorak: { year: 1920, tier: 2 },
  juggernaut: { year: 1638, tier: 5 },
  tsunami: { year: 1880 },
};

function build() {
  return buildBankFromInputs({
    edgesText: EDGES_CSV,
    languagesText: LANGUAGES_TSV,
    curation: CURATION,
    version: 1,
    epochStartDay: 0,
  });
}

describe("curated edge overrides", () => {
  // The shape that surfaced this (from the real `coyote`): the source records a loan
  // through Spanish, then jumps straight to a RECONSTRUCTION. Nahuatl, the answer a
  // player would give, is nowhere in the chain, so the puzzle anchored to Spain and a
  // pin in Mexico scored zero.
  const FILLER = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india"];
  const EDGES = [
    "lang,term,reltype,related_lang,related_term",
    ...FILLER.map((word, i) => `English,${word},borrowed_from,Lang${i + 1},${word}`),
    "English,coyote,borrowed_from,Spanish,coyote",
    "Spanish,coyote,derived_from,Proto-Nahuan,*koyootl",
  ].join("\n");
  const LANGS = [
    "code\tname\tcountries\tregion\tcontinent\tlat\tlng",
    "en\tEnglish\tGB\tNorthern Europe\tEurope\t54\t-2",
    ...FILLER.map((_, i) => `l${i + 1}\tLang${i + 1}\tFR\tWestern Europe\tEurope\t47\t2`),
    "es\tSpanish\tES\tSouthern Europe\tEurope\t40\t-4",
    "nci\tClassical Nahuatl\tMX\tNorth America\tAmericas\t19.4\t-99.1",
  ].join("\n");
  const OVERRIDE = [
    "lang,term,reltype,related_lang,related_term",
    "Spanish,coyote,borrowed_from,Classical Nahuatl,coyōtl",
  ].join("\n");
  const tiers = () => {
    const curation: Record<string, { year: number; tier: number; pos?: string; origin?: string }> = {};
    FILLER.forEach((word, i) => (curation[word] = { year: 1500, tier: (i % TIER_COUNT) + 1 }));
    return curation;
  };
  const build = (options: {
    override?: string;
    coyoteOrigin: string;
    /** Off when the case expects coyote to be skipped: an empty tier cannot build. */
    assemble?: boolean;
  }): ReturnType<typeof buildBankFromInputs> =>
    buildBankFromInputs({
      edgesText: EDGES,
      overrideEdgesText: options.override,
      languagesText: LANGS,
      curation: {
        ...tiers(),
        "coyote:noun": { year: 1759, tier: TIER_COUNT, pos: "noun", origin: options.coyoteOrigin },
      },
      version: 1,
      epochStartDay: 0,
      assembleBank: options.assemble ?? true,
    });

  it("without an override the answer is the shallow language", () => {
    const { bank, report } = build({ coyoteOrigin: "Spanish" });
    const entry = bank!.masterSequence.find((e) => e.word === "coyote")!;
    expect(report.overrideEdges).toBe(0);
    expect(entry.originLanguage).toBe("Spanish");
    expect(entry.countries).toEqual(["ES"]);
  });

  it("cannot name a language the walk never reaches", () => {
    // The player-facing bug: naming Nahuatl is refused, because the only recorded
    // origin is Spanish.
    const { report } = build({ coyoteOrigin: "Classical Nahuatl", assemble: false });
    expect(report.skippedEntries).toBe(1);
    expect(report.warnings.join(" ")).toContain("not among the recorded origins (Spanish)");
  });

  it("with a curator-supplied edge, the answer is the missing language and its country", () => {
    const { bank, report } = build({ override: OVERRIDE, coyoteOrigin: "Classical Nahuatl" });
    const entry = bank!.masterSequence.find((e) => e.word === "coyote")!;
    expect(report.overrideEdges).toBe(1);
    expect(entry.originChain).toEqual(["Spanish", "Classical Nahuatl"]);
    expect(entry.originLanguage).toBe("Classical Nahuatl");
    expect(entry.countries).toEqual(["MX"]);
    expect(entry.point).toEqual({ lat: 19.4, lng: -99.1 });
  });

  it("catches curation left pointing at the old answer", () => {
    // Exactly what happened when the edge went in: the stale `origin` is refused
    // loudly rather than silently anchoring the puzzle to Spain.
    const { report } = build({ override: OVERRIDE, coyoteOrigin: "Spanish", assemble: false });
    expect(report.skippedEntries).toBe(1);
    expect(report.warnings.join(" ")).toContain("not among the recorded origins (Classical Nahuatl)");
  });

  it("ignores an override that repeats an edge the source already has", () => {
    const { report } = build({
      override: "lang,term,reltype,related_lang,related_term\nEnglish,coyote,borrowed_from,Spanish,coyote",
      coyoteOrigin: "Spanish",
    });
    expect(report.overrideEdges).toBe(0);
  });
});

describe("parseCsv / extractEdges", () => {
  it("parses quoted fields with commas", () => {
    const csv = parseCsv('a,b,c\n"x, y",2,3');
    expect(csv.headers).toEqual(["a", "b", "c"]);
    expect(csv.rows[0]).toEqual(["x, y", "2", "3"]);
  });

  it("parses escaped quotes and CRLF line endings", () => {
    const csv = parseCsv('a,b\r\n"say ""hi""",1\r\n');
    expect(csv.rows[0]).toEqual(['say "hi"', "1"]);
  });

  it("extracts edges with case-insensitive header matching", () => {
    const edges = extractEdges(EDGES_CSV);
    expect(edges.length).toBeGreaterThan(15);
    expect(edges).toContainEqual({ lang: "en", term: "elapse", reltype: "borrowed_from", relatedLang: "frm", relatedTerm: "elapser" });
  });

  it("filters by relation type", () => {
    const edges = extractEdges(EDGES_CSV, new Set(["borrowed_from"]));
    expect(edges.every((e) => e.reltype === "borrowed_from")).toBe(true);
    expect(edges.some((e) => e.reltype === "derived_from")).toBe(false);
  });

  it("fails with a helpful message on a missing required column", () => {
    expect(() => extractEdges("lang,term\nen,dog")).toThrow(/reltype/);
  });
});

describe("buildChains", () => {
  const donorEdges = extractEdges(EDGES_CSV, new Set(Object.keys(DONOR_RELATION_PRIORITY)));
  const chains = buildChains(donorEdges, { englishLangCode: "en", maxDepth: 3 });

  it("builds multi-hop chains, immediate donor first", () => {
    expect(chains.get("elapse")!.chainLangs).toEqual(["frm", "la"]);
    expect(chains.get("camouflage")!.chainLangs).toEqual(["fr", "it"]);
    expect(chains.get("coffee")!.chainLangs).toEqual(["ar"]);
  });

  it("excludes formation and non-directional relations", () => {
    expect(chains.has("runner")).toBe(false);
    expect(chains.has("quark")).toBe(false);
  });

  it("excludes non-candidate terms", () => {
    expect(isCandidateTerm("elapse")).toBe(true);
    expect(isCandidateTerm("bulk, term")).toBe(false);
    expect(isCandidateTerm("Runner")).toBe(false);
    // Wiktionary stores prefix/suffix stubs as terms too: those are not words.
    expect(isCandidateTerm("ab-")).toBe(false);
    expect(isCandidateTerm("-ism")).toBe(false);
    expect(isCandidateTerm("acantho-")).toBe(false);
    expect(isCandidateTerm("well-made")).toBe(true);
    expect(isCandidateTerm("go")).toBe(true);
    expect(isCandidateTerm("a-")).toBe(false);
    expect(chains.has("bulk, term")).toBe(false);
  });

  it("prunes cycles without hanging", () => {
    expect(chains.get("alpha")!.chainLangs).toEqual(["fr"]);
  });
});

describe("parseLanguageTsv", () => {
  const byCode = parseLanguageTsv(LANGUAGES_TSV);

  it("parses countries, points, and region metadata", () => {
    expect(byCode["iu"]!.countries).toEqual(["CA", "GL"]);
    expect(byCode["iu"]!.representativePoint).toEqual({ lat: 64, lng: -51 });
    expect(byCode["iu"]!.subregion).toBe("Northern America");
    expect(byCode["iu"]!.continent).toBe("North America");
  });

  it("filters malformed country codes", () => {
    expect(byCode["xx"]!.countries).toEqual(["FR"]);
  });

  it("throws when required columns are missing", () => {
    expect(() => parseLanguageTsv("name\tfoo\nBar\t1")).toThrow(/code/);
  });
});

describe("buildBankFromInputs", () => {
  const { bank: assembledBank, report } = build();
  const bank = assembledBank!;

  it("produces a valid bank (validation runs inside)", () => {
    expect(bank.version).toBe(1);
    // Days of play is the scarcest tier, so the sequence is that many days long.
    expect(bank.masterSequence.length).toBe(Math.min(...report.tierCounts) * ROUNDS_PER_DAY);
  });

  it("curates years/tiers/blurbs and auto-fills the rest", () => {
    const elapse = bank.tiers.flat().find((e) => e.word === "elapse")!;
    expect(elapse.originLanguage).toBe("Latin"); // answer anchored to the deep origin
    expect(elapse.originChain).toEqual(["Middle French", "Latin"]);
    expect(elapse.countries).toEqual(["IT"]);
    expect(elapse.year).toBe(1640);
    expect(elapse.tier).toBe(4);
    expect(elapse.blurb).toContain("elapsus");

    const coffee = bank.tiers.flat().find((e) => e.word === "coffee")!;
    expect(coffee.countries).toEqual(["SA", "EG", "DZ"]);
    expect(coffee.tier).toBe(2);
    expect(coffee.blurb).toBe("From Arabic.");

    const camouflage = bank.tiers.flat().find((e) => e.word === "camouflage")!;
    expect(camouflage.originLanguage).toBe("Italian");
    expect(camouflage.countries).toEqual(["IT"]);
    expect(camouflage.originChain).toEqual(["French", "Italian"]);
    expect(camouflage.blurb).toBe("From French, ultimately from Italian.");
  });

  it("reports candidates, missing years, and tier coverage", () => {
    expect(report.candidateWords).toBe(13);
    expect(report.acceptedWords).toBe(11);
    expect(report.missingYear).toBe(2); // zombie (no year), alpha (not curated)
    // Every tier holds a word (an empty tier cannot build) and the curated entries all
    // landed somewhere: the exact split is `--mode tier`'s business, not the builder's.
    expect(report.tierCounts).toHaveLength(TIER_COUNT);
    expect(report.tierCounts.reduce((a, b) => a + b, 0)).toBe(report.acceptedWords);
    expect(Math.min(...report.tierCounts)).toBeGreaterThan(0);
    expect(report.missingLanguage).toEqual({});
  });

  it("is deterministic across runs", () => {
    expect(JSON.stringify(bank)).toEqual(JSON.stringify(build().bank));
  });

  it("reports languages missing metadata instead of failing", () => {
    const withoutKikongo = LANGUAGES_TSV.split("\n").filter((line) => !line.startsWith("kg\t")).join("\n");
    const result = buildBankFromInputs({
      edgesText: EDGES_CSV,
      languagesText: withoutKikongo,
      curation: CURATION,
      version: 1,
      epochStartDay: 0,
    });
    expect(result.report.missingLanguage["kg"]).toBe(1);
    expect(result.bank!.masterSequence.some((e) => e.word === "zombie")).toBe(false);
  });
});

  it("keeps a word when only an INTERMEDIATE language lacks metadata (with a warning)", () => {
    const withoutMiddleFrench = LANGUAGES_TSV.split("\n")
      .filter((line) => !line.startsWith("frm\t"))
      .join("\n");
    const result = buildBankFromInputs({
      edgesText: EDGES_CSV,
      languagesText: withoutMiddleFrench,
      curation: CURATION,
      version: 1,
      epochStartDay: 0,
    });
    expect(result.report.warnings.some((w) => w.includes('"frm"'))).toBe(true);
    const elapse = result.bank!.tiers.flat().find((e) => e.word === "elapse")!;
    expect(elapse.originChain).toEqual(["frm", "Latin"]); // raw code fallback for display
  });

describe("a coarse answer reaches the bank as a span", () => {
  it("keeps yearTo for a period-dated word and nothing for a precise one", () => {
    const result = buildBankFromInputs({
      edgesText: EDGES_CSV,
      languagesText: LANGUAGES_TSV,
      curation: {
        ...CURATION,
        // "recorded in Old English": no source narrows it, so the entry states the
        // span the record allows rather than inventing a year.
        pizza: { year: 700, yearTo: 1150, tier: 1 },
      },
      version: 1,
      epochStartDay: 0,
    });
    const coarse = result.bank!.masterSequence.find((entry) => entry.word === "pizza")!;
    expect(coarse.year).toBe(700);
    expect(coarse.yearTo).toBe(1150);
    // A precisely dated neighbour gains no span at all. (Read from the tiers: the
    // interleaved sequence stops at the shallowest tier, which here holds one word.)
    const precise = result.bank!.tiers.flat().find((entry) => entry.word === "coffee")!;
    expect(precise.yearTo).toBeUndefined();
  });
});

describe("the reveal blurb for an automatically dated word", () => {
  // 563 of the curated entries have no hand-written blurb, and the old fallback just
  // restated the route line ("From Middle English, ultimately from Old French."). A
  // word dated only by period now says the thing the route cannot say.
  const FILLER = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
  const EDGES = [
    "lang,term,reltype,related_lang,related_term",
    ...FILLER.map((word, i) => `English,${word},borrowed_from,Lang${i + 1},${word}`),
    "English,helmet,borrowed_from,Old French,helme",
  ].join("\n");
  const LANGS = [
    "code\tname\tcountries\tregion\tcontinent\tlat\tlng",
    "en\tEnglish\tGB\tNorthern Europe\tEurope\t54\t-2",
    ...FILLER.map((_, i) => `l${i + 1}\tLang${i + 1}\tFR\tWestern Europe\tEurope\t47\t2`),
    "fro\tOld French\tFR\tWestern Europe\tEurope\t47\t2",
  ].join("\n");
  const build = (entry: { year: number; yearTo?: number; tier: number }) => {
    const curation: Record<string, { year: number; yearTo?: number; tier: number }> = {};
    FILLER.forEach((word, i) => (curation[word] = { year: 1500, tier: (i % TIER_COUNT) + 1 }));
    curation.helmet = entry;
    return buildBankFromInputs({ edgesText: EDGES, languagesText: LANGS, curation, version: 1, epochStartDay: 0 });
  };

  it("names the period when the whole span is one", () => {
    const { bank } = build({ year: 1151, yearTo: 1500, tier: 5 });
    const helmet = bank!.tiers.flat().find((e) => e.word === "helmet")!;
    expect(helmet.blurb).toBe("The sources date it to the Middle English period.");
  });

  it("falls back to the route sentence for a point date", () => {
    const { bank } = build({ year: 1200, tier: 5 });
    const helmet = bank!.tiers.flat().find((e) => e.word === "helmet")!;
    expect(helmet.blurb).toBe("From Old French.");
  });
});

describe("native-answer words and the quota", () => {
  // A word whose answer is English is won by always pinning Britain and always
  // guessing the earliest window, so the build keeps them out by default. Excluding
  // ALL of them throws away the most common vocabulary in the language, so a small
  // quota lets a few in as easy rounds - pinned to the easy tiers, at most the
  // fraction asked for.
  // Real-looking words: `isCandidateTerm` rejects anything with digits (it filters
  // Wiktionary prefix stubs), which silently made this fixture one word long.
  const FILLER = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
  const EDGES = [
    "lang,term,reltype,related_lang,related_term",
    ...FILLER.map((word, i) => `English,${word},borrowed_from,Lang${i + 1},${word}`),
    "English,go,inherited_from,Old English,gān",
    "English,craft,inherited_from,Old English,cræft",
    "English,take,borrowed_from,Old Norse,taka",
  ].join("\n");
  const LANGS = [
    "code\tname\tcountries\tregion\tcontinent\tlat\tlng",
    "en\tEnglish\tGB\tNorthern Europe\tEurope\t54\t-2",
    "ang\tOld English\tGB\tNorthern Europe\tEurope\t54\t-2",
    ...FILLER.map((_, i) => `l${i + 1}\tLang${i + 1}\tFR\tWestern Europe\tEurope\t47\t2`),
    "non\tOld Norse\tNO\tNorthern Europe\tEurope\t61\t9",
  ].join("\n");
  const curation = () => {
    const entries: Record<string, { year: number; yearTo?: number; tier?: number; origin?: string }> = {};
    FILLER.forEach((word, i) => (entries[word] = { year: 1500, tier: (i % TIER_COUNT) + 1 }));
    entries.go = { year: 700, yearTo: 1150, tier: 5, origin: "Old English" };
    entries.craft = { year: 700, yearTo: 1150, tier: 5, origin: "Old English" };
    entries.take = { year: 1151, yearTo: 1500, tier: 5, origin: "Old Norse" };
    return entries;
  };
  const build = (options: { quota?: number; tiers?: number[] } = {}): ReturnType<typeof buildBankFromInputs> =>
    buildBankFromInputs({
      edgesText: EDGES,
      languagesText: LANGS,
      curation: curation(),
      version: 1,
      epochStartDay: 0,
      // The worlds of the work list keep native answers out of the ORDER, and the
      // quota is what relaxes that for the bank itself.
      excludeOriginCodes: new Set(["en", "ang", "enm"]),
      nativeQuota: options.quota,
      nativeTiers: options.tiers,
    });

  it("drops native answers entirely when no quota is given", () => {
    const { bank, report } = build();
    expect(report.nativeAdmitted).toBe(0);
    expect(report.excludedByOrigin).toBe(2);
    const words = bank!.tiers.flat().map((entry) => entry.word);
    expect(words).not.toContain("go");
    expect(words).not.toContain("craft");
  });

  it("admits them up to the quota, in the easy tiers, however they were curated", () => {
    const { bank, report } = build({ quota: 0.5, tiers: [1, 2] });
    expect(report.nativeAdmitted).toBe(2);
    expect(report.nativeDropped).toBe(0);
    const go = bank!.tiers.flat().find((entry) => entry.word === "go")!;
    // Curated tier 5, forced into the easy tiers: that is the point of the quota.
    expect([1, 2]).toContain(go.tier);
    expect(report.tierCounts[go.tier - 1]).toBeGreaterThan(0);
    // A borrowed word keeps its curated tier.
    const take = bank!.tiers.flat().find((entry) => entry.word === "take")!;
    expect(take.tier).toBe(5);
  });

  it("caps how many get in, without a curator having to choose", () => {
    // Two native words and a quota that admits one of them: 5% of 13 entries rounds to
    // one, so one is dropped and the build says which kind of word it dropped.
    const { bank, report } = build({ quota: 0.05, tiers: [1, 2] });
    expect(report.nativeAdmitted).toBe(1);
    expect(report.nativeDropped).toBe(1);
    const words = bank!.tiers.flat().map((entry) => entry.word);
    // No frequency list in this fixture, so the tie-break is alphabetical and stable.
    expect(words).toContain("craft");
    expect(words).not.toContain("go");
  });
});

describe("the register rule at build time", () => {
  it("drops a word the sense cache marks obsolete, and says which", () => {
    const result = buildBankFromInputs({
      edgesText: EDGES_CSV,
      languagesText: LANGUAGES_TSV,
      curation: CURATION,
      version: 1,
      epochStartDay: 0,
      // What `unusableSenseKeys()` returns for a cache that labels `tsunami` obsolete.
      excludedSenses: new Set(["tsunami"]),
    });
    const words = result.bank!.tiers.flat().map((entry) => entry.word);
    expect(words).not.toContain("tsunami");
    expect(result.report.excludedByLabel).toBe(1);
    expect(result.report.warnings.join(" ")).toContain("obsolete");
  });

  it("filters nothing when the caller supplies no sense data", () => {
    // The rule lives in scripts/lib/register.ts and is applied by the caller, so a build
    // with no cache behaves exactly as before; the CLI prints that it did not check.
    const { bank, report } = build();
    expect(report.excludedByLabel).toBe(0);
    expect(bank!.tiers.flat().map((entry) => entry.word)).toContain("tsunami");
  });
});
