import { describe, expect, it } from "vitest";
import { createCsvRowParser, forEachCsvRow, parseCsv } from "../scripts/lib/etymology-db";
import { createEdgeFilter, formatCsvRow, quoteCsvField, MINIMAL_EDGE_HEADER } from "../scripts/lib/edge-filter";
import { buildBankFromInputs, type UncuratedCandidate } from "../scripts/lib/bank-builder";
import { parseFrequencyList } from "../scripts/lib/frequency";

describe("createCsvRowParser (chunk safety)", () => {
  const csv = 'a,b,c\r\n1,"quoted, comma",3\r\n4,"two\r\nlines",6\r\n7,"say ""hi""",9\n';

  function parseChunked(chunks: string[]): string[][] {
    const rows: string[][] = [];
    const parser = createCsvRowParser((row) => rows.push(row));
    for (const chunk of chunks) parser.push(chunk);
    parser.flush();
    return rows;
  }

  it("matches the whole-text parse when fed one character at a time", () => {
    const expected: string[][] = [];
    forEachCsvRow(csv, (row) => expected.push(row));
    expect(parseChunked([...csv])).toEqual(expected);
    expect(expected[1]).toEqual(["1", "quoted, comma", "3"]);
    expect(expected[2]).toEqual(["4", "two\nlines", "6"]);
    expect(expected[3]).toEqual(["7", 'say "hi"', "9"]);
  });

  it("handles a CRLF split across a chunk boundary", () => {
    expect(parseChunked(["a,b\r", "\nc,d\r\n"])).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("keeps multi-byte terms intact when a chunk boundary splits the string", () => {
    const text = "en,English,ἐγκυκλοπαιδεία\n";
    const rows: string[][] = [];
    const parser = createCsvRowParser((row) => rows.push(row));
    parser.push(text.slice(0, 12));
    parser.push(text.slice(12));
    parser.flush();
    expect(rows[0]).toEqual(["en", "English", "ἐγκυκλοπαιδεία"]);
  });
});

describe("createEdgeFilter", () => {
  const COLS = { lang: 0, term: 1, reltype: 2, relatedLang: 3, relatedTerm: 4 };
  const allowed = new Set(["English", "Ancient Greek", "Middle French"]);

  it("keeps donor rows whose source language we can place", () => {
    const filter = createEdgeFilter({ allowedNames: allowed, englishName: "English" });
    expect(filter.keep(COLS, ["English", "music", "borrowed_from", "Ancient Greek", "μουσική"])).toBe(true);
    expect(filter.keep(COLS, ["Middle French", "x", "inherited_from", "Latin", "x"])).toBe(true);
    expect(filter.stats.kept).toBe(2);
  });

  it("drops non-donor relations, incomplete rows and unplaceable sources", () => {
    const filter = createEdgeFilter({ allowedNames: allowed, englishName: "English" });
    expect(filter.keep(COLS, ["English", "runner", "has_suffix", "English", "run"])).toBe(false);
    expect(filter.keep(COLS, ["English", "x", "borrowed_from", "", ""])).toBe(false);
    expect(filter.keep(COLS, ["Sinhala", "x", "borrowed_from", "Pali", "y"])).toBe(false);
    expect(filter.stats).toMatchObject({ droppedReltype: 1, droppedIncomplete: 1, droppedUnknownSource: 1 });
  });

  it("keeps non-donor rows when --all-reltypes is set", () => {
    const filter = createEdgeFilter({ allowedNames: allowed, englishName: "English", allReltypes: true });
    expect(filter.keep(COLS, ["English", "runner", "has_suffix", "English", "run"])).toBe(true);
  });

  it("reports the donors that block English words (the overlay work list)", () => {
    const filter = createEdgeFilter({ allowedNames: allowed, englishName: "English" });
    filter.keep(COLS, ["English", "a", "borrowed_from", "Proto-Germanic", "a"]); // kept, but blocked
    filter.keep(COLS, ["English", "b", "borrowed_from", "Proto-Germanic", "b"]);
    filter.keep(COLS, ["English", "c", "borrowed_from", "Translingual", "c"]);
    expect([...filter.stats.blockedEnglishDonors.entries()]).toEqual([
      ["Proto-Germanic", 2],
      ["Translingual", 1],
    ]);
    expect(formatCsvRow(MINIMAL_EDGE_HEADER)).toBe("lang,term,reltype,related_lang,related_term\n");
  });
});

describe("CSV output", () => {
  it("quotes fields and round-trips through the parser", () => {
    expect(quoteCsvField("plain")).toBe("plain");
    expect(quoteCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(quoteCsvField("a,b")).toBe('"a,b"');
    const rows = `${formatCsvRow(MINIMAL_EDGE_HEADER)}${formatCsvRow(["English", "a,b", "borrowed_from", "Latin", 'x"y'])}`;
    expect(parseCsv(rows).rows[0]).toEqual(["English", "a,b", "borrowed_from", "Latin", 'x"y']);
  });
});

describe("real etymology-db shape (language NAMES, not codes)", () => {
  // The published dataset stores lang as "English"/"Ancient Greek", while our
  // language table is keyed by code. Before bank-builder normalized names this
  // seam silently produced an EMPTY bank from the real 4.2M-row file.
  const EDGES = [
    "term_id,lang,term,reltype,related_term_id,related_lang,related_term,position,group_tag,parent_tag,parent_position",
    ...Array.from(
      { length: 10 },
      (_, i) => `${i + 1},English,word${String.fromCharCode(97 + i)},borrowed_from,${100 + i},Latin,l${i + 1},0,,,`,
    ),
    "11,English,music,borrowed_from,12,Ancient Greek,μουσική,0,,,",
    "12,Ancient Greek,μουσική,derived_from,13,Proto-Indo-European,men-,0,,,",
    "13,English,ab-,borrowed_from,14,Latin,ab,0,,,",
    "14,English,vacuum,borrowed_from,15,Latin,vacuum,0,,,",
    "15,English,gift,inherited_from,16,Old English,gift,0,,,",
    "16,English,smurf,borrowed_from,17,Translingual,smurf,0,,,",
  ].join("\n");

  const LANGUAGES = [
    "code\tname\tcountries\tregion\tcontinent\tlat\tlng",
    "en\tEnglish\tGB;US\tNorthern Europe\tEurope\t54\t-2",
    "grc\tAncient Greek\tGR;TR\tSouthern Europe\tEurope\t38\t23",
    "la\tLatin\tIT\tSouthern Europe\tEurope\t42\t12",
    "ang\tOld English\tGB\tNorthern Europe\tEurope\t52\t-1",
  ].join("\n");

  // One curated word per tier keeps validateBank happy; `music` has a curated
  // year too, so its absence/presence tracks the anchor policy.
  const CURATION = Object.fromEntries([
    ...Array.from({ length: 10 }, (_, i) => [
      `word${String.fromCharCode(97 + i)}`,
      { year: 1000 + i, tier: i + 1, blurb: "From Latin." },
    ]),
    ["music", { year: 1250, tier: 2, blurb: "From Ancient Greek." }],
    ["gift", { year: 1100, tier: 3, blurb: "From Old English." }],
  ]);

  function build() {
    const uncurated: UncuratedCandidate[] = [];
    const result = buildBankFromInputs({
      edgesText: EDGES,
      languagesText: LANGUAGES,
      curation: CURATION,
      version: 2,
      epochStartDay: 20717,
      onUncurated: (candidate) => uncurated.push(candidate),
    });
    return { ...result, bank: result.bank!, uncurated };
  }

  it("normalizes names to codes and anchors each sense at its deepest placeable hop", () => {
    const { bank, report } = build();
    const words = bank.tiers.flat().map((entry) => entry.word);
    expect(words).toHaveLength(12); // 10 tiered words + music + gift
    expect(words).toContain("worda");
    // `music` goes English -> Ancient Greek -> Proto-Indo-European. The
    // reconstruction has no home on a map, so the sense is answered by Greek —
    // this used to be dropped as "unplaceable".
    expect(words).toContain("music");
    expect(words).not.toContain("ab-"); // prefix stub, not a word
    expect(words).not.toContain("smurf"); // only donor is a non-language

    const worda = bank.tiers.flat().find((entry) => entry.word === "worda")!;
    expect(worda.originChain).toEqual(["Latin"]);
    expect(worda.originLanguage).toBe("Latin");
    expect(worda.countries).toEqual(["IT"]);

    const music = bank.tiers.flat().find((entry) => entry.word === "music")!;
    expect(music.originLanguage).toBe("Ancient Greek");
    expect(music.originChain).toEqual(["Ancient Greek", "Proto-Indo-European"]);
    expect(music.countries).toEqual(["GR", "TR"]);

    expect(report.missingLanguage).toEqual({ Translingual: 1 });
    expect(report.missingYear).toBe(1); // vacuum has no curated year
  });

  it("passes one uncurated candidate per sense, with the sense's own origin", () => {
    const { uncurated } = build();
    expect(uncurated).toHaveLength(1);
    expect(uncurated[0]).toMatchObject({
      term: "vacuum",
      origin: "Latin",
      sense: "vacuum",
      chainDepth: 1,
      deepestLanguage: "Latin",
      chain: ["Latin"],
    });
    expect(uncurated[0]!.tier).toBeGreaterThanOrEqual(1);
    expect(uncurated[0]!.tier).toBeLessThanOrEqual(10);
  });

  it("can exclude answer origins (a word that came from England is a dull puzzle)", () => {
    const { bank, report } = buildBankFromInputs({
      edgesText: EDGES,
      languagesText: LANGUAGES,
      curation: CURATION,
      version: 2,
      epochStartDay: 20717,
      excludeOriginCodes: new Set(["ang"]),
    });
    expect(report.excludedByOrigin).toBe(1);
    expect(bank!.tiers.flat().map((entry) => entry.word)).not.toContain("gift");
    expect(bank!.tiers.flat()).toHaveLength(11);
  });

  it("ranks tier assignment with frequency and reports unranked candidates", () => {
    const { report } = buildBankFromInputs({
      edgesText: EDGES,
      languagesText: LANGUAGES,
      curation: CURATION,
      version: 2,
      epochStartDay: 20717,
      frequency: parseFrequencyList("vacuum 300\ngift 5000000\n"),
    });
    // 13 candidate senses; only vacuum and gift have a rank in that list.
    expect(report.candidateSenses).toBe(13);
    expect(report.withoutFrequencyRank).toBe(11);
  });
});

describe("homographs (the `back` case)", () => {
  // Real data: `back` is inherited from Old English in one sense and borrowed
  // from French in another, and the tie-break prefers borrowings — so without a
  // curated origin the game would grade "French" correct for a native word.
  const EDGES = [
    "term_id,lang,term,reltype,related_term_id,related_lang,related_term,position,group_tag,parent_tag,parent_position",
    ...Array.from(
      { length: 10 },
      (_, i) => `${i + 1},English,filler${String.fromCharCode(97 + i)},borrowed_from,${100 + i},French,f${i},0,,,`,
    ),
    "21,English,back,inherited_from,22,Middle English,bak,0,,,",
    "22,Middle English,bak,inherited_from,23,Old English,bæc,0,,,",
    "23,Old English,bæc,inherited_from,25,Proto-West Germanic,bak,0,,,",
    "24,English,back,borrowed_from,26,French,bac,0,,,",
  ].join("\n");
  const LANGUAGES = [
    "code\tname\tcountries\tregion\tcontinent\tlat\tlng",
    "en\tEnglish\tGB\tNorthern Europe\tEurope\t54\t-2",
    "enm\tMiddle English\tGB\tNorthern Europe\tEurope\t52\t-1",
    "ang\tOld English\tGB\tNorthern Europe\tEurope\t52\t-1",
    "fr\tFrench\tFR\tWestern Europe\tEurope\t47\t2",
  ].join("\n");
  const FILLERS = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [
      `filler${String.fromCharCode(97 + i)}`,
      { year: 1800, tier: i + 1, blurb: "From French." },
    ]),
  );

  function build(
    extraCuration: Record<string, { year: number; tier?: number; blurb?: string; pos?: string; origin?: string }> = {},
  ) {
    const uncurated: UncuratedCandidate[] = [];
    const result = buildBankFromInputs({
      edgesText: EDGES,
      languagesText: LANGUAGES,
      curation: { ...FILLERS, ...extraCuration },
      version: 2,
      epochStartDay: 20717,
      onUncurated: (candidate) => uncurated.push(candidate),
    });
    return { ...result, uncurated };
  }

  it("reports every recorded origin instead of silently picking one", () => {
    const { report, uncurated } = build();
    expect(report.ambiguousWords).toBe(1);
    expect(report.missingYear).toBe(2); // both senses need their own entry
    const senses = uncurated.filter((candidate) => candidate.term === "back");
    expect(senses.map((sense) => sense.origin)).toEqual(["French", "Old English"]);
    expect(senses.map((sense) => sense.sense)).toEqual(["back|French", "back|Old English"]);
    for (const sense of senses) expect(sense.origins).toEqual(["French", "Old English"]);
  });

  it("uses the curator's origin when the entry names one, even under a proto hop", () => {
    const { bank, report, uncurated } = build({
      "back:noun": { year: 1000, tier: 5, blurb: "Native, from Old English bæc.", origin: "Old English" },
    });
    const back = bank!.tiers.flat().find((entry) => entry.word === "back")!;
    // The chosen branch ends in a reconstruction, which has no home on a modern
    // map, so the answer anchors to the deepest hop that does: Old English.
    expect(back.id).toBe("back:noun");
    expect(back.pos).toBe("noun");
    expect(back.originChain).toEqual(["Middle English", "Old English", "Proto-West Germanic"]);
    expect(back.originLanguage).toBe("Old English");
    expect(back.countries).toEqual(["GB"]);
    expect(report.skippedEntries).toBe(0);
    // Curating one sense does not settle the other: the French sense stays queued.
    const remaining = uncurated.filter((candidate) => candidate.term === "back");
    expect(remaining.map((candidate) => candidate.origin)).toEqual(["French"]);
  });

  it("refuses an origin the data does not support", () => {
    const { report, bank } = build({
      back: { year: 1000, tier: 5, blurb: "bogus", origin: "Old Norse" },
    });
    expect(report.skippedEntries).toBe(1);
    expect(report.warnings.some((warning) => warning.includes("not among the recorded origins"))).toBe(true);
    expect(bank!.tiers.flat().some((entry) => entry.word === "back")).toBe(false);
  });
});
