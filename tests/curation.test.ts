import { describe, expect, it } from "vitest";
import {
  auditCuration,
  mergeCuration,
  parseWorklist,
  selectNextBatch,
  type Curation,
} from "../scripts/lib/curation";
import { bestPossibleTemporal } from "../src/timeline";
import { scoreTemporal } from "../src/scoring";

const WORKLIST = [
  "word\tfreq_rank\ttier\tchain_depth\tdeepest_language\tchain\torigins",
  "just\t39\t2\t2\tOld French\tMiddle English <- Old French\tOld French",
  "money\t186\t2\t2\tOld French\tMiddle English <- Old French\tOld French",
  "must\t156\t2\t2\tMiddle Persian\tPersian <- Middle Persian\tMiddle Persian",
  "tea\t\t7\t3\tMin Nan\tDutch <- Malay <- Min Nan\tMin Nan",
  "back\t83\t2\t2\tMiddle French\tFrench <- Middle French\tMiddle French|Old English",
].join("\n");

describe("parseWorklist", () => {
  it("parses the ranked work list, tolerating a missing frequency rank", () => {
    const parsed = parseWorklist(WORKLIST);
    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toEqual({
      word: "just",
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

  it("parses a homograph's several origins (sorted)", () => {
    const back = parseWorklist(WORKLIST).find((candidate) => candidate.word === "back")!;
    expect(back.origins).toEqual(["Middle French", "Old English"]);
  });

  it("ignores blank lines and the header", () => {
    expect(parseWorklist(`word\tfreq_rank\ttier\tchain_depth\tdeepest_language\tchain\torigins\n\n`)).toEqual([]);
  });
});

describe("selectNextBatch", () => {
  const candidates = parseWorklist(WORKLIST);

  it("selectNextBatch skips curated and skipped words, keeping work-list order", () => {
    const batch = selectNextBatch(parseWorklist(WORKLIST), {
      curated: new Set(["just"]),
      skip: new Set(["money"]),
      limit: 10,
    });
    expect(batch.map((candidate) => candidate.word)).toEqual(["must", "tea", "back"]);
  });

  it("respects the limit", () => {
    expect(selectNextBatch(candidates, { curated: new Set(), limit: 2 }).map((c) => c.word)).toEqual([
      "just",
      "money",
    ]);
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
    expect(problems.get("just")!.join(" | ")).toContain("~61/100");
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
    expect(noPos.issues[0]!.problem).toContain('add "pos" and "origin"');

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
    // 'they' (1200) in the shipped bank can never score above 8/100.
    expect(bestPossibleTemporal(1200, 1500, 2025)).toBe(scoreTemporal(1200, 1500));
    expect(bestPossibleTemporal(1200, 1500, 2025)).toBe(8);
    expect(bestPossibleTemporal(1225, 1500, 2025)).toBe(11);
    expect(bestPossibleTemporal(1300, 1500, 2025)).toBe(22);
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
});
