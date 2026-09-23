import { describe, expect, it } from "vitest";
import {
  BankValidationError,
  appendToBank,
  buildWordBank,
  interleave,
  validateBank,
  validateEntry,
} from "../src/bank";
import { makeEntry } from "./helpers";
import type { BankEntry } from "../src/types";

function makeBankEntries(perTier: number): BankEntry[] {
  return Array.from({ length: perTier * 10 }, () => makeEntry());
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

  it("serves exactly 10 rounds per day with tiers in ascending order", () => {
    const bank = buildWordBank({
      version: 1,
      epochStartDay: 0,
      entries: makeBankEntries(3),
      languages: LANGUAGES,
    });
    expect(bank.masterSequence).toHaveLength(30);
    for (let day = 0; day < 3; day++) {
      for (let round = 0; round < 10; round++) {
        expect(bank.masterSequence[day * 10 + round]!.tier).toBe(round + 1);
      }
    }
  });

  it("shuffles within tiers but preserves tier buckets", () => {
    const tier3Ids = ["w0", "w1", "w2", "w3", "w4"];
    const entries = [
      ...tier3Ids.map((id) => makeEntry({ id, word: id, tier: 3 })),
      ...Array.from({ length: 9 }, (_, t) =>
        makeEntry({ id: `filler-${t + 1}`, word: `filler${t + 1}`, tier: t + 1 <= 2 ? t + 1 : t + 2 }),
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
    expect(v2.masterSequence).toHaveLength(30);
    expect(v2.masterSequence.map((e) => e.id)).toEqual(v1Ids);

    const batch = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ id: `batch-${i}`, word: `batch${i}`, tier: i + 1 }),
    );
    const v3 = appendToBank(v2, batch, 3);
    expect(v3.version).toBe(3);
    expect(v3.masterSequence).toHaveLength(40);
    expect(v3.masterSequence.slice(0, 30).map((e) => e.id)).toEqual(v1Ids);
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
    entries[11]!.word = "SameWord";
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
    entries[11]!.id = "sameword:verb";
    entries[11]!.word = "sameword";
    entries[11]!.originLanguage = "Middle French";
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
  it("requires exactly 10 tiers", () => {
    const oneTier = Array.from({ length: 10 }, () => makeEntry({ tier: 1 }));
    expect(() => interleave([oneTier])).toThrow(/exactly 10 tiers/);
  });

  it("caps the sequence at the shallowest tier", () => {
    const tiers = Array.from({ length: 10 }, (_, t) =>
      Array.from({ length: t === 7 ? 2 : 5 }, () => makeEntry({ tier: t + 1 })),
    );
    const master = interleave(tiers);
    expect(master).toHaveLength(20);
    for (let day = 0; day < 2; day++) {
      for (let round = 0; round < 10; round++) {
        expect(master[day * 10 + round]!.tier).toBe(round + 1);
      }
    }
  });
});
