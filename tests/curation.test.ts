import { describe, expect, it } from "vitest";
import {
  auditCuration,
  bestPossibleTemporal,
  mergeCuration,
  parseWorklist,
  selectNextBatch,
  type Curation,
} from "../scripts/lib/curation";
import { scoreTemporal } from "../src/scoring";

const WORKLIST = [
  "word\tfreq_rank\ttier\tchain_depth\tdeepest_language\tchain",
  "just\t39\t2\t2\tOld French\tMiddle English <- Old French",
  "money\t186\t2\t2\tOld French\tMiddle English <- Old French",
  "must\t156\t2\t2\tMiddle Persian\tPersian <- Middle Persian",
  "tea\t\t7\t3\tMin Nan\tDutch <- Malay <- Min Nan",
].join("\n");

describe("parseWorklist", () => {
  it("parses the ranked work list, tolerating a missing frequency rank", () => {
    const parsed = parseWorklist(WORKLIST);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toEqual({
      word: "just",
      frequencyRank: 39,
      tier: 2,
      chainDepth: 2,
      deepestLanguage: "Old French",
      chain: ["Middle English", "Old French"],
    });
    expect(parsed[3]!.frequencyRank).toBeUndefined();
    expect(parsed[3]!.chain).toEqual(["Dutch", "Malay", "Min Nan"]);
  });

  it("ignores blank lines and the header", () => {
    expect(parseWorklist(`word\tfreq_rank\ttier\tchain_depth\tdeepest_language\tchain\n\n`)).toEqual([]);
  });
});

describe("selectNextBatch", () => {
  const candidates = parseWorklist(WORKLIST);

  it("skips curated and skipped words, keeping work-list order", () => {
    const batch = selectNextBatch(candidates, {
      curated: new Set(["just"]),
      skip: new Set(["money"]),
      limit: 10,
    });
    expect(batch.map((candidate) => candidate.word)).toEqual(["must", "tea"]);
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
    const audit = auditCuration({ Tea: { year: 1650 } }, { knownWords, yearFloor: 1500, yearCeiling: 2025 });
    expect(audit.issues.some((issue) => issue.problem.includes("lowercase"))).toBe(true);
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
