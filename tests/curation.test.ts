import { describe, expect, it } from "vitest";
import {
  auditCuration,
  composeSenseKey,
  mergeCuration,
  parseSenseKey,
  parseWorklist,
  selectNextBatch,
  settledSenseIds,
  wordOfSenseId,
  type Curation,
} from "../scripts/lib/curation";
import { bestPossibleTemporal } from "../src/timeline";
import { scoreTemporalRange } from "../src/scoring";

const WORKLIST = [
  "word\torigin\tsense\tfreq_rank\ttier\tchain_depth\tdeepest_language\tchain\torigins",
  "just\tOld French\tjust\t39\t2\t2\tOld French\tMiddle English <- Old French\tOld French",
  "money\tOld French\tmoney\t186\t2\t2\tOld French\tMiddle English <- Old French\tOld French",
  "must\tMiddle Persian\tmust\t156\t2\t2\tMiddle Persian\tPersian <- Middle Persian\tMiddle Persian",
  "tea\tMin Nan\ttea\t\t7\t3\tMin Nan\tDutch <- Malay <- Min Nan\tMin Nan",
  "back\tMiddle French\tback|Middle French\t83\t2\t2\tMiddle French\tFrench <- Middle French\tMiddle French|Old English",
  "back\tOld English\tback|Old English\t83\t2\t3\tOld English\tMiddle English <- Old English\tMiddle French|Old English",
].join("\n");

describe("parseWorklist", () => {
  it("parses sense rows, tolerating a missing frequency rank", () => {
    const parsed = parseWorklist(WORKLIST);
    expect(parsed).toHaveLength(6);
    expect(parsed[0]).toEqual({
      word: "just",
      origin: "Old French",
      sense: "just",
      frequencyRank: 39,
      tier: 2,
      chainDepth: 2,
      deepestLanguage: "Old French",
      chain: ["Middle English", "Old French"],
      origins: ["Old French"],
    });
    expect(parsed[3]!.frequencyRank).toBeUndefined();
    expect(parsed[3]!.chain).toEqual(["Dutch", "Malay", "Min Nan"]);
  });

  it("gives every sense of a homograph its own row and id", () => {
    const back = parseWorklist(WORKLIST).filter((candidate) => candidate.word === "back");
    expect(back.map((candidate) => candidate.sense)).toEqual(["back|Middle French", "back|Old English"]);
    expect(back.map((candidate) => candidate.origin)).toEqual(["Middle French", "Old English"]);
    for (const sense of back) expect(sense.origins).toEqual(["Middle French", "Old English"]);
  });

  it("still reads an older one-row-per-word work list", () => {
    const legacy = [
      "word\tfreq_rank\ttier\tchain_depth\tdeepest_language\tchain\torigins",
      "just\t39\t2\t2\tOld French\tMiddle English <- Old French\tOld French",
    ].join("\n");
    expect(parseWorklist(legacy)[0]).toMatchObject({ word: "just", origin: "Old French", sense: "just" });
  });

  it("ignores blank lines and the header", () => {
    expect(parseWorklist(`word\torigin\tsense\tfreq_rank\ttier\tchain_depth\tdeepest_language\tchain\torigins\n\n`)).toEqual(
      [],
    );
  });
});

describe("sense keys", () => {
  it("parses key, key:pos and key:pos:n", () => {
    expect(parseSenseKey("back")).toEqual({ word: "back" });
    expect(parseSenseKey("back:noun")).toEqual({ word: "back", pos: "noun" });
    expect(parseSenseKey("bank:noun:2")).toEqual({ word: "bank", pos: "noun", ordinal: 2 });
  });

  it("rejects anything that is not a sense key", () => {
    expect(parseSenseKey("back|Old English")).toBeNull(); // a work-list id, not a key
    expect(parseSenseKey("back:Noun")).toBeNull();
    expect(parseSenseKey("back:noun:1")).toBeNull(); // ordinals start at 2
    expect(parseSenseKey("back:noun:2:3")).toBeNull();
    expect(parseSenseKey("")).toBeNull();
  });

  it("composes keys the way the builder looks them up", () => {
    expect(composeSenseKey("back")).toBe("back");
    expect(composeSenseKey("back", "noun")).toBe("back:noun");
    expect(composeSenseKey("bank", "noun", 2)).toBe("bank:noun:2");
    expect(composeSenseKey("bank", "noun", 1)).toBe("bank:noun");
  });

  it("splits a work-list sense id back into its word", () => {
    expect(wordOfSenseId("back|Old English")).toBe("back");
    expect(wordOfSenseId("back")).toBe("back");
  });
});

describe("settledSenseIds", () => {
  const byWord = new Map(parseWorklist(WORKLIST).map((candidate) => [candidate.word, candidate]));

  it("settles a single-origin word as one id", () => {
    expect([...settledSenseIds({ just: { year: 1400 } }, byWord)]).toEqual(["just"]);
  });

  it("settles a homograph as a word: its routes are alternatives, not more puzzles", () => {
    const settled = settledSenseIds({ "back:noun": { year: 1000, pos: "noun", origin: "Old English" } }, byWord);
    expect([...settled]).toEqual(["back"]);
  });

  it("settles a homograph even without an origin — the word is researched either way", () => {
    expect([...settledSenseIds({ "back:noun": { year: 1000, pos: "noun" } }, byWord)]).toEqual(["back"]);
  });
});

describe("selectNextBatch", () => {
  const candidates = parseWorklist(WORKLIST);

  it("skips settled words and skipped ones, keeping work-list order", () => {
    const batch = selectNextBatch(candidates, {
      settled: new Set<string>(["just"]),
      skip: new Set<string>(["money"]),
      limit: 10,
    });
    expect(batch.map((candidate) => candidate.sense)).toEqual(["must", "tea", "back|Middle French"]);
  });

  it("asks about a homograph once, not once per recorded route", () => {
    const batch = selectNextBatch(candidates, {
      settled: new Set<string>(["just", "money", "must", "tea"]),
      limit: 10,
    });
    // Both `back` rows are the same question, so only the first is queued.
    expect(batch.map((candidate) => candidate.sense)).toEqual(["back|Middle French"]);
  });

  it("respects the limit", () => {
    expect(selectNextBatch(candidates, { limit: 2 }).map((candidate) => candidate.sense)).toEqual(["just", "money"]);
  });
});

describe("auditCuration", () => {
  const knownWords = new Set(["just", "money", "must"]);

  it("flags unknown words, missing years and out-of-range years with the damage done", () => {
    const curation: Curation = {
      just: { year: 1400 },
      money: {}, // no year
      must: { year: 1500, tier: 11, blurb: "   " },
      zzz: { year: 1500 }, // not a candidate anywhere
    };
    const audit = auditCuration(curation, { knownWords, yearFloor: 1500, yearCeiling: 2025 });
    expect(audit.entries).toBe(4);
    expect(audit.curated).toBe(3);
    expect(audit.unplayableOnSlider).toEqual(["just"]);
    const problems = new Map<string, string[]>();
    for (const issue of audit.issues) problems.set(issue.word, [...(problems.get(issue.word) ?? []), issue.problem]);
    // 1400 with a floor of 1500: the earliest legal window still misses it by
    // 100 years, which the audit quantifies with the real scorer (~37/100).
    expect(problems.get("just")!.join(" | ")).toContain("~37/100");
    expect(problems.get("money")!.join(" | ")).toContain("missing year");
    expect(problems.get("must")!.join(" | ")).toContain("tier 11");
    expect(problems.get("must")!.join(" | ")).toContain("blurb is present but empty");
    expect(problems.get("zzz")!.join(" | ")).toContain("no mappable chain");
  });

  it("treats already-curated words as known once the bank confirms them", () => {
    const audit = auditCuration(
      { coffee: { year: 1590 } },
      { knownWords: new Set<string>(), bankWords: new Set(["coffee"]), yearFloor: 1500, yearCeiling: 2025 },
    );
    expect(audit.issues).toEqual([]);
  });

  it("flags capitalised keys, which would never match a word", () => {
    const audit = auditCuration({ Tea: { year: 1650 } }, { knownWords, yearFloor: 1100, yearCeiling: 2025 });
    expect(audit.issues.some((issue) => issue.problem.includes("lowercase"))).toBe(true);
  });

  it("insists on a part of speech and an origin for homographs", () => {
    const originsByWord = new Map([["back", ["Middle French", "Old English"]]]);
    const base = { knownWords: new Set(["back"]), originsByWord, yearFloor: 700, yearCeiling: 2025 };

    const noPos = auditCuration({ back: { year: 1000 } }, base);
    expect(noPos.issues[0]!.problem).toContain("give the entry a part of speech");

    const posOnly = auditCuration({ back: { year: 1000, pos: "noun" } }, base);
    expect(posOnly.issues[0]!.problem).toContain('no "origin"');

    const wrongOrigin = auditCuration({ back: { year: 1000, pos: "noun", origin: "Old Norse" } }, base);
    expect(wrongOrigin.issues[0]!.problem).toContain("not one of");

    const good = auditCuration({ back: { year: 1000, pos: "noun", origin: "Old English" } }, base);
    expect(good.issues).toEqual([]);
  });

  it("rejects a part of speech that is not a plain lowercase label", () => {
    const audit = auditCuration(
      { just: { year: 1400, pos: "Noun!" } },
      { knownWords: new Set(["just"]), yearFloor: 700, yearCeiling: 2025 },
    );
    expect(audit.issues.some((issue) => issue.problem.includes("lowercase label"))).toBe(true);
  });

  it("agrees with the real scorer about how bad an out-of-range year is", () => {
    // A year below the floor can only be caught by the earliest window, and the
    // damage is quantified by the real scorer, not a mirrored formula.
    expect(bestPossibleTemporal(1200, 1500, 2025)).toBe(scoreTemporalRange(1200, 1500, 1600));
    expect(bestPossibleTemporal(1200, 1500, 2025)).toBe(5); // 300 years below the floor
    expect(bestPossibleTemporal(1225, 1500, 2025)).toBe(6); // 275 years below
    expect(bestPossibleTemporal(1300, 1500, 2025)).toBe(14); // 200 years below
  });
});

describe("mergeCuration", () => {
  it("only accepts researched entries and reports the rest", () => {
    const merged = mergeCuration(
      { just: { year: 1400 } },
      {
        just: { year: 1400 }, // already there
        money: { year: 0 }, // not researched yet
        must: { year: 1500, tier: 3, blurb: "  From Middle Persian.  " },
      },
    );
    expect(merged.added).toEqual(["must"]);
    expect(merged.skipped).toEqual(["just", "money"]);
    expect(merged.merged.must).toEqual({ year: 1500, tier: 3, blurb: "From Middle Persian." });
  });

  it("rounds years and drops an empty blurb", () => {
    const merged = mergeCuration({}, { tea: { year: 1650.6, blurb: "   " } });
    expect(merged.merged.tea).toEqual({ year: 1651 });
  });

  it("files a sense under the key its part of speech composes", () => {
    const merged = mergeCuration({}, { "back|Old English": { year: 1000, pos: "noun", origin: "Old English" } });
    expect(merged.added).toEqual(["back:noun"]);
    expect(merged.merged["back:noun"]).toEqual({ year: 1000, pos: "noun", origin: "Old English" });
  });

  it("files a second sense of the same part of speech as :2", () => {
    const first = mergeCuration({}, { "back|Old English": { year: 1000, pos: "noun", origin: "Old English" } }).merged;
    const second = mergeCuration(first, {
      "back|Middle French": { year: 1400, pos: "noun", origin: "Middle French" },
    });
    expect(second.added).toEqual(["back:noun:2"]);
    expect(second.merged["back:noun:2"]).toMatchObject({ pos: "noun", origin: "Middle French" });
  });

  it("skips a sense that is already filed", () => {
    const existing = { "back:noun": { year: 1000, pos: "noun", origin: "Old English" } };
    const result = mergeCuration(existing, { "back|Old English": { year: 1000, pos: "noun", origin: "Old English" } });
    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual(["back|Old English"]);
  });
});

describe("coarse answer spans", () => {
  it("carries yearTo through a merge, and refuses to call a point a span", () => {
    const merged = mergeCuration(
      {},
      {
        give: { year: 700, yearTo: 1150, tier: 3 },
        take: { year: 1000, yearTo: 1000 }, // equal bounds are just a year
      },
    );
    expect(merged.merged.give).toMatchObject({ year: 700, yearTo: 1150 });
    expect(merged.merged.take).toEqual({ year: 1000 });
  });

  it("flags a backwards span and one running past the timeline", () => {
    const audit = auditCuration(
      { give: { year: 1150, yearTo: 700 }, take: { year: 1900, yearTo: 2100 } },
      { knownWords: new Set(["give", "take"]), yearFloor: 700, yearCeiling: 2025 },
    );
    const problems = audit.issues.map((issue) => `${issue.word}: ${issue.problem}`).join(" | ");
    expect(problems).toContain("yearTo 700 must be at or after year 1150");
    expect(problems).toContain("past the end of the timeline (2025)");
  });

  it("does not call a coarse inherited word unplayable", () => {
    // The point of spans: "in use by 1150" is winnable, unlike a fabricated year
    // below the slider floor, and the audit must not tell the curator otherwise.
    const audit = auditCuration(
      { give: { year: 700, yearTo: 1150 } },
      { knownWords: new Set(["give"]), yearFloor: 700, yearCeiling: 2025 },
    );
    expect(audit.issues).toEqual([]);
    expect(audit.unplayableOnSlider).toEqual([]);
  });

describe("a year that contradicts its own chain", () => {
  // The one dating check that needs no reference: a chain naming an English stage
  // claims the word was already in English by then, so a later year refutes itself.
  const routesByWord = new Map([
    ["give", [{ origin: "Old English", chain: ["Middle English", "Old English"] }]],
    [
      "back",
      [
        { origin: "Middle French", chain: ["Middle French"] },
        { origin: "Old English", chain: ["Middle English", "Old English"] },
      ],
    ],
  ]);
  const base = {
    knownWords: new Set(["give", "back"]),
    routesByWord,
    yearFloor: 700,
    yearCeiling: 2025,
  };

  it("flags a year after the period the chain records", () => {
    const late = auditCuration({ give: { year: 1590 } }, base);
    const problems = late.issues.map((issue) => issue.problem).join(" ");
    expect(problems).toContain("after the Old English period");
    expect(problems).toContain("ends 1150");
    // A year inside the period is fine, and a span ending in it too.
    expect(auditCuration({ give: { year: 1000 } }, base).issues).toEqual([]);
    expect(auditCuration({ give: { year: 700, yearTo: 1150 } }, base).issues).toEqual([]);
    // A span reaching past the period contradicts it just as a point does.
    expect(
      auditCuration({ give: { year: 700, yearTo: 1400 } }, base).issues[0]!.problem,
    ).toContain("after the Old English period");
  });

  it("follows the entry's own route, because a homograph's routes are senses", () => {
    // `back` the French loan may be late...
    const french = auditCuration(
      { "back:noun": { year: 1600, pos: "noun", origin: "Middle French" } },
      base,
    );
    expect(french.issues).toEqual([]);
    // ...but the native word cannot: it was in English by Old English.
    const native = auditCuration(
      { "back:noun": { year: 1600, pos: "noun", origin: "Old English" } },
      base,
    );
    expect(native.issues.map((issue) => issue.problem).join(" ")).toContain("Old English period");
  });

  it("stays quiet when it cannot tell which route applies", () => {
    // Several routes and none named: guessing would flag half of them wrongly.
    const audit = auditCuration({ back: { year: 1600 } }, { ...base });
    expect(audit.issues).toEqual([]);
  });
});

});

