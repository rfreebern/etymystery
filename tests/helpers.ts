import { TIER_COUNT } from "../src/bank";
import type { BankEntry } from "../src/types";

let counter = 0;

/** Deterministic entry factory for tests. Cycles the tiers across calls. */
export function makeEntry(overrides: Partial<BankEntry> = {}): BankEntry {
  counter += 1;
  return {
    id: `word-${counter}`,
    word: `word${counter}`,
    year: 1900,
    tier: ((counter - 1) % TIER_COUNT) + 1,
    originChain: ["French"],
    originLanguage: "French",
    countries: ["FR"],
    point: { lat: 47, lng: 2 },
    blurb: "From French.",
    ...overrides,
  };
}
