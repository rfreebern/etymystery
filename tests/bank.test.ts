import { describe, expect, it } from "vitest";
import {
  BankValidationError,
  ROUNDS_PER_DAY,
  TIER_COUNT,
  appendToBank,
  buildWordBank,
  dealSequence,
  interleave,
  validateBank,
  validateEntry,
} from "../src/bank";
import { makeEntry } from "./helpers";
import type { BankEntry } from "../src/types";

function makeBankEntries(perTier: number): BankEntry[] {
  return Array.from({ length: perTier * TIER_COUNT }, () => makeEntry());
}

const LANGUAGES = {
  French: { name: "French", countries: ["FR"], representativePoint: { lat: 47, lng: 2 } },
  "Middle French": { name: "Middle French", countries: ["FR"], representativePoint: { lat: 47, lng: 2 } },
};

describe("buildWordBank", () => {
  it("is deterministic for the same inputs and seed", () => {
    const entries = makeBankEntries(3);
    const a = buildWordBank({ version: 1, epochStartDay: 0, entries, languages: LANGUAGES });
    const b = buildWordBank({ version: 1, epochStartDay: 0, entries, languages: LANGUAGES });
    expect(a.masterSequence.map((e) => e.id)).toEqual(b.masterSequence.map((e) => e.id));
  });

  it("serves exactly one round per tier, in ascending order", () => {
    const bank = buildWordBank({
      version: 1,
      epochStartDay: 0,
      entries: makeBankEntries(3),
      languages: LANGUAGES,
    });
    expect(bank.masterSequence).toHaveLength(3 * ROUNDS_PER_DAY);
    for (let day = 0; day < 3; day++) {
      for (let round = 0; round < ROUNDS_PER_DAY; round++) {
        expect(bank.masterSequence[day * ROUNDS_PER_DAY + round]!.tier).toBe(round + 1);
      }
    }
  });

  it("shuffles within tiers but preserves tier buckets", () => {
    const tier3Ids = ["w0", "w1", "w2", "w3", "w4"];
    const entries = [
      ...tier3Ids.map((id) => makeEntry({ id, word: id, tier: 3 })),
      ...Array.from({ length: TIER_COUNT - 1 }, (_, t) =>
        makeEntry({ id: `filler-${t + 1}`, word: `filler${t + 1}`, tier: t < 2 ? t + 1 : t + 2 }),
      ),
    ];
    const a = buildWordBank({ version: 1, epochStartDay: 0, entries, languages: LANGUAGES, seed: 99 });
    const b = buildWordBank({ version: 1, epochStartDay: 0, entries, languages: LANGUAGES, seed: 99 });
    const bucket = a.tiers[2]!.map((e) => e.id);
    expect([...bucket].sort()).toEqual(tier3Ids); // same elements...
    expect(bucket).toEqual(b.tiers[2]!.map((e) => e.id)); // ...same seed, same order
    const c = buildWordBank({ version: 1, epochStartDay: 0, entries, languages: LANGUAGES, seed: 100 });
    expect(bucket).not.toEqual(c.tiers[2]!.map((e) => e.id)); // different seed, different order
  });
});

describe("appendToBank (append-only versioning)", () => {
  it("preserves the existing master sequence verbatim", () => {
    const v1 = buildWordBank({
      version: 1,
      epochStartDay: 0,
      entries: makeBankEntries(3),
      languages: LANGUAGES,
    });
    const v1Ids = v1.masterSequence.map((e) => e.id);

    const v2 = appendToBank(v1, [makeEntry({ tier: 5, id: "new-word", word: "newword" })], 2);
    expect(v2.version).toBe(2);
    expect(v2.masterSequence).toHaveLength(3 * ROUNDS_PER_DAY);
    expect(v2.masterSequence.map((e) => e.id)).toEqual(v1Ids);

    const batch = Array.from({ length: TIER_COUNT }, (_, i) =>
      makeEntry({ id: `batch-${i}`, word: `batch${i}`, tier: i + 1 }),
    );
    const v3 = appendToBank(v2, batch, 3);
    expect(v3.version).toBe(3);
    expect(v3.masterSequence).toHaveLength(4 * ROUNDS_PER_DAY);
    expect(v3.masterSequence.slice(0, 3 * ROUNDS_PER_DAY).map((e) => e.id)).toEqual(v1Ids);
  });

  it("rejects non-increasing versions", () => {
    const v1 = buildWordBank({ version: 1, epochStartDay: 0, entries: makeBankEntries(1), languages: LANGUAGES });
    expect(() => appendToBank(v1, [], 1)).toThrow(BankValidationError);
    expect(() => appendToBank(v1, [], 0)).toThrow(BankValidationError);
  });

  it("rejects duplicate ids across appends", () => {
    const v1 = buildWordBank({ version: 1, epochStartDay: 0, entries: makeBankEntries(1), languages: LANGUAGES });
    const dup = makeEntry({ id: v1.tiers[0]![0]!.id, tier: 5 });
    expect(() => appendToBank(v1, [dup], 2)).toThrow(BankValidationError);
  });
});

describe("validateEntry", () => {
  it("accepts a well-formed entry", () => {
    expect(() => validateEntry(makeEntry())).not.toThrow();
  });

  it.each([
    ["tier out of range", { tier: 0 }],
    ["invalid latitude", { point: { lat: 95, lng: 2 } }],
    ["invalid longitude", { point: { lat: 47, lng: 200 } }],
    ["bad country code", { countries: ["FRA"] }],
    ["empty countries", { countries: [] }],
    ["empty chain", { originChain: [] }],
    ["id with whitespace", { id: "two words" }],
    ["empty blurb", { blurb: "" }],
    ["absurd year", { year: 5000 }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => validateEntry(makeEntry(overrides))).toThrow(BankValidationError);
  });
});

describe("validateBank", () => {
  it("accepts a well-formed bank", () => {
    const bank = buildWordBank({ version: 1, epochStartDay: 0, entries: makeBankEntries(2), languages: LANGUAGES });
    expect(() => validateBank(bank)).not.toThrow();
  });

  it("detects a tampered master sequence", () => {
    const bank = buildWordBank({ version: 1, epochStartDay: 0, entries: makeBankEntries(2), languages: LANGUAGES });
    const tampered = { ...bank, masterSequence: [...bank.masterSequence] };
    const first = tampered.masterSequence[0]!;
    const second = tampered.masterSequence[1]!;
    tampered.masterSequence[0] = second;
    tampered.masterSequence[1] = first;
    expect(() => validateBank(tampered)).toThrow(BankValidationError);
  });

  it("detects the same word answered by the same origin twice", () => {
    const entries = makeBankEntries(2);
    // Different ids and different tiers, but the same puzzle: same word, same
    // answer language.
    entries[0]!.word = "sameword";
    entries[TIER_COUNT]!.word = "SameWord";
    expect(() =>
      buildWordBank({ version: 1, epochStartDay: 0, entries, languages: LANGUAGES }),
    ).toThrow(/duplicate puzzle/i);
  });

  it("allows one word to be two puzzles when the senses have different origins", () => {
    // `back` the noun is inherited; another sense arrived via French. Entry ids
    // are sense keys, so both can ship — they are not the same puzzle.
    const entries = makeBankEntries(2);
    entries[0]!.id = "sameword:noun";
    entries[0]!.word = "sameword";
    entries[0]!.originLanguage = "French";
    entries[TIER_COUNT]!.id = "sameword:verb";
    entries[TIER_COUNT]!.word = "sameword";
    entries[TIER_COUNT]!.originLanguage = "Middle French";
    expect(() =>
      buildWordBank({ version: 1, epochStartDay: 0, entries, languages: LANGUAGES }),
    ).not.toThrow();
  });

  it("detects missing language metadata", () => {
    const entries = makeBankEntries(1);
    const bank = buildWordBank({ version: 1, epochStartDay: 0, entries, languages: LANGUAGES });
    const broken = { ...bank, languages: {} };
    expect(() => validateBank(broken)).toThrow(/missing language metadata/);
  });
});

describe("interleave", () => {
  it("requires exactly the bank's tier count", () => {
    const oneTier = Array.from({ length: TIER_COUNT }, () => makeEntry({ tier: 1 }));
    expect(() => interleave([oneTier])).toThrow(`expected exactly ${TIER_COUNT} tiers`);
  });

  it("caps the sequence at the shallowest tier", () => {
    const tiers = Array.from({ length: TIER_COUNT }, (_, t) =>
      Array.from({ length: t === 3 ? 2 : 5 }, () => makeEntry({ tier: t + 1 })),
    );
    const master = interleave(tiers);
    expect(master).toHaveLength(2 * ROUNDS_PER_DAY);
    for (let day = 0; day < 2; day++) {
      for (let round = 0; round < ROUNDS_PER_DAY; round++) {
        expect(master[day * ROUNDS_PER_DAY + round]!.tier).toBe(round + 1);
      }
    }
  });
});

describe("the answer span in a bank entry", () => {
  it("accepts a coarse span and reads it back", () => {
    // Validate only rejects data problems: the span is a fact about the record.
    expect(() => validateEntry(makeEntry({ year: 700, yearTo: 1150 }))).not.toThrow();
    expect(() => validateEntry(makeEntry({ year: 700 }))).not.toThrow();
  });

  it("rejects a span that runs backwards or past the timeline", () => {
    expect(() => validateEntry(makeEntry({ year: 1150, yearTo: 700 }))).toThrow(/yearTo/);
    expect(() => validateEntry(makeEntry({ year: 700, yearTo: 2201 }))).toThrow(/yearTo/);
    expect(() => validateEntry(makeEntry({ year: 700, yearTo: Number.NaN }))).toThrow(/yearTo/);
  });
});

describe("dealing the days for variety", () => {
  // A region per entry, coarsest first, exactly as `regionsOfLanguage` supplies it.
  const regions = new Map<string, string[]>();
  const entry = (region: string, tier: number, n: number): BankEntry => {
    const made = makeEntry({ id: `${region}-t${tier}-${n}`, word: `${region}${tier}${n}`, tier });
    regions.set(made.id, [region]);
    return made;
  };
  const regionsOf = (e: BankEntry): readonly string[] => regions.get(e.id) ?? ["unknown"];

  /** Every tier starts Europe, Europe, Asia, Africa: the naive layout gives whole
   *  European days and then whole Asian days. */
  function clumpedTiers(): BankEntry[][] {
    return Array.from({ length: TIER_COUNT }, (_, tier) => [
      entry("Europe", tier + 1, 1),
      entry("Europe", tier + 1, 2),
      entry("Asia", tier + 1, 1),
      entry("Africa", tier + 1, 1),
    ]);
  }

  it("spreads the regions of a day instead of clumping them", () => {
    const tiers = clumpedTiers();
    const naive = interleave(tiers.map((tier) => [...tier]));
    const spread = interleave(tiers, { regionsOf });
    const distinct = (sequence: BankEntry[]): number =>
      new Set(sequence.map((e) => regionsOf(e)[0])).size;

    expect(distinct(naive.slice(0, ROUNDS_PER_DAY))).toBe(1); // a whole European day
    expect(distinct(spread.slice(0, ROUNDS_PER_DAY))).toBe(3); // Europe, Asia, Africa
    // And it keeps it up rather than spending the variety on one day.
    expect(distinct(spread.slice(ROUNDS_PER_DAY, 2 * ROUNDS_PER_DAY))).toBe(3);
  });

  it("still uses every entry exactly once, one per tier per day", () => {
    const tiers = clumpedTiers();
    const { master, tiers: dealt } = dealSequence(tiers, { regionsOf });
    expect(master).toHaveLength(TIER_COUNT * 4);
    expect(new Set(master.map((e) => e.id)).size).toBe(TIER_COUNT * 4);
    for (let day = 0; day < 4; day++) {
      for (let k = 0; k < ROUNDS_PER_DAY; k++) {
        expect(master[day * ROUNDS_PER_DAY + k]!.tier).toBe(k + 1);
      }
    }
    // The queues come back in play order, which is the invariant validateBank checks.
    for (let k = 0; k < ROUNDS_PER_DAY; k++) {
      for (let day = 0; day < 4; day++) {
        expect(dealt[k]![day]!.id).toBe(master[day * ROUNDS_PER_DAY + k]!.id);
      }
    }
  });

  it("leaves days it is told not to touch alone", () => {
    // Append semantics: the days already shipped keep their order, so a player's day
    // cannot change because someone added words.
    const tiers = clumpedTiers();
    const before = interleave(tiers.map((tier) => [...tier]));
    const after = interleave(tiers, { regionsOf, fromDay: 2 });
    expect(after.slice(0, 2 * ROUNDS_PER_DAY).map((e) => e.id)).toEqual(
      before.slice(0, 2 * ROUNDS_PER_DAY).map((e) => e.id),
    );
    // From day 3 on it is dealt for variety, so the days differ from the naive layout.
    expect(after.slice(2 * ROUNDS_PER_DAY, 3 * ROUNDS_PER_DAY).map((e) => e.id)).not.toEqual(
      before.slice(2 * ROUNDS_PER_DAY, 3 * ROUNDS_PER_DAY).map((e) => e.id),
    );
  });

  it("gives a thin continent its fair share of a day instead of front-loading it", () => {
    // Every tier starts with one African entry followed by three European ones: one
    // African round per tier and three European ones, over four days. Dealt by index,
    // day 1 takes every African round and the rest of the calendar has none.
    const days = 4;
    const tiers = Array.from({ length: TIER_COUNT }, (_, tier) => [
      entry("Africa", tier + 1, 1),
      entry("Europe", tier + 1, 1),
      entry("Europe", tier + 1, 2),
      entry("Europe", tier + 1, 3),
    ]);
    const dayContinents = (sequence: BankEntry[]) =>
      Array.from({ length: days }, (_, d) =>
        sequence
          .slice(d * ROUNDS_PER_DAY, (d + 1) * ROUNDS_PER_DAY)
          .filter((e) => regionsOf(e)[0] === "Africa").length,
      );

    expect(dayContinents(interleave(tiers.map((tier) => [...tier])))).toEqual([
      TIER_COUNT,
      0,
      0,
      0,
    ]);
    const spread = dayContinents(interleave(tiers, { regionsOf }));
    expect(spread.reduce((a, b) => a + b, 0)).toBe(TIER_COUNT); // every African round still played
    // ceil(5 African rounds / 4 days) = 2: a day may not spend more than its share.
    expect(Math.max(...spread)).toBeLessThanOrEqual(Math.ceil(TIER_COUNT / days));
    expect(spread.every((n) => n > 0)).toBe(true); // every day gets some
  });

  it("keeps a thin continent available for the late days, not just the first ones", () => {
    // Thin entries are fresh regions, which the day-level rule prefers, so on its own it
    // spends them as fast as they appear and the tail of the calendar goes without. Six
    // days and one African round per tier: the group cap makes that one-per-day.
    const days = 6;
    const tiers = Array.from({ length: TIER_COUNT }, (_, tier) => [
      entry("Africa", tier + 1, 1),
      ...Array.from({ length: days - 1 }, (_, n) => entry("Europe", tier + 1, n + 1)),
    ]);
    const perDay = (sequence: BankEntry[]): number[] =>
      Array.from({ length: days }, (_, d) =>
        sequence
          .slice(d * ROUNDS_PER_DAY, (d + 1) * ROUNDS_PER_DAY)
          .filter((e) => regionsOf(e)[0] === "Africa").length,
      );

    expect(perDay(interleave(tiers, { regionsOf }))).toEqual([1, 1, 1, 1, 1, 0]);
  });

  it("is exactly the old layout when no regions are given", () => {
    // The default must not change a single day: day d of tier t is still tiers[t][d].
    const tiers = clumpedTiers();
    const naive = interleave(tiers.map((tier) => [...tier]));
    for (let day = 0; day < 4; day++) {
      for (let k = 0; k < ROUNDS_PER_DAY; k++) {
        expect(naive[day * ROUNDS_PER_DAY + k]!.id).toBe(tiers[k]![day]!.id);
      }
    }
  });
});
