import type { BankEntry, LanguageInfo, WordBank } from "./types";
import { hashString, mulberry32, shuffle } from "./prng";

/** Number of difficulty tiers (one word per tier per daily puzzle). */
export const TIER_COUNT = 10;
/** Rounds per daily puzzle — one word per tier. */
export const ROUNDS_PER_DAY = 10;

/** Errors thrown when a word bank fails structural validation. */
export class BankValidationError extends Error {}

export interface BuildBankInput {
  version: number;
  epochStartDay: number;
  /** Curated entries. */
  entries: BankEntry[];
  languages: Record<string, LanguageInfo>;
  /** Optional explicit seed; defaults to a hash of the version. */
  seed?: number;
}

/**
 * Build a word bank from curated entries:
 * 1. bucket entries by tier,
 * 2. shuffle each tier with the bank seed (stable for the bank's lifetime),
 * 3. round-robin interleave the tier queues into the master sequence.
 *
 * The resulting bank must be treated as append-only: later versions append
 * entries to each tier's queue without re-shuffling earlier positions.
 */
export function buildWordBank(input: BuildBankInput): WordBank {
  const seed = input.seed ?? hashString(`etymystery-bank-v${input.version}`);
  const rng = mulberry32(seed);

  const buckets: BankEntry[][] = Array.from({ length: TIER_COUNT }, () => []);
  for (const entry of input.entries) {
    validateEntry(entry);
    buckets[entry.tier - 1]!.push(entry);
  }
  for (const bucket of buckets) shuffle(bucket, rng);

  return finalizeBank({
    version: input.version,
    epochStartDay: input.epochStartDay,
    seed,
    tiers: buckets,
    languages: input.languages,
  });
}

/**
 * Assemble the master sequence from (already shuffled) tier queues via
 * round-robin interleave: tier1[0], tier2[0], ..., tier10[0], tier1[1], ...
 *
 * The sequence covers exactly `min(tier lengths)` days, so every served day
 * gets precisely one word per tier (10 rounds, easy to hard). Surplus entries
 * in deeper tiers are left unconsumed for the next bank version.
 */
export function interleave(tiers: BankEntry[][]): BankEntry[] {
  if (tiers.length !== TIER_COUNT) {
    throw new BankValidationError(`expected exactly ${TIER_COUNT} tiers, got ${tiers.length}`);
  }
  const days = Math.min(...tiers.map((t) => t.length));
  const master: BankEntry[] = [];
  for (let i = 0; i < days; i++) {
    for (const tier of tiers) {
      const entry = tier[i];
      if (!entry) throw new BankValidationError(`tier queue unexpectedly empty at day ${i}`);
      master.push(entry);
    }
  }
  return master;
}

/** Internal: attach a master sequence and validate the assembled bank. */
function finalizeBank(bank: Omit<WordBank, "masterSequence">): WordBank {
  const withMaster: WordBank = { ...bank, masterSequence: interleave(bank.tiers) };
  validateBank(withMaster);
  return withMaster;
}

/**
 * Append new entries to an existing bank, producing the next version.
 * Existing queue order is preserved verbatim (append-only guarantee); only
 * the newly added entries are shuffled (with a derived seed) and appended to
 * their tier queues.
 */
export function appendToBank(
  bank: WordBank,
  newEntries: BankEntry[],
  nextVersion: number,
): WordBank {
  if (!Number.isInteger(nextVersion) || nextVersion <= bank.version) {
    throw new BankValidationError(
      `nextVersion (${nextVersion}) must be an integer greater than current version (${bank.version})`,
    );
  }
  const tiers: BankEntry[][] = bank.tiers.map((t) => [...t]);
  const perTierNew: BankEntry[][] = Array.from({ length: TIER_COUNT }, () => []);
  for (const entry of newEntries) {
    validateEntry(entry);
    perTierNew[entry.tier - 1]!.push(entry);
  }
  const rng = mulberry32(hashString(`etymystery-append-v${nextVersion}`));
  for (let t = 0; t < TIER_COUNT; t++) {
    shuffle(perTierNew[t]!, rng);
    tiers[t]!.push(...perTierNew[t]!);
  }
  return finalizeBank({
    version: nextVersion,
    epochStartDay: bank.epochStartDay,
    seed: bank.seed,
    tiers,
    languages: bank.languages,
  });
}

/** Validate a single bank entry. Throws BankValidationError. */
export function validateEntry(entry: BankEntry): void {
  const problems: string[] = [];
  if (!entry.id || /\s/.test(entry.id)) problems.push("id must be a non-empty slug without whitespace");
  if (!entry.word.trim()) problems.push("word must be non-empty");
  if (entry.pos !== undefined && !/^[a-z][a-z -]{1,19}$/.test(entry.pos)) {
    problems.push(`pos must be a lowercase label like "noun" or "verb", got "${entry.pos}"`);
  }
  if (!Number.isFinite(entry.year) || entry.year < -4000 || entry.year > 2200) {
    problems.push("year must be a finite year between -4000 and 2200");
  }
  if (!Number.isInteger(entry.tier) || entry.tier < 1 || entry.tier > TIER_COUNT) {
    problems.push(`tier must be an integer in 1..${TIER_COUNT}`);
  }
  if (entry.originChain.length === 0 || entry.originChain.some((l) => !l.trim())) {
    problems.push("originChain must be non-empty with non-empty names");
  }
  if (!entry.originLanguage.trim()) problems.push("originLanguage must be non-empty");
  if (entry.countries.length === 0) problems.push("countries must not be empty");
  if (entry.countries.some((c) => !/^[A-Z]{2}$/.test(c))) {
    problems.push("countries must contain ISO 3166-1 alpha-2 codes");
  }
  if (!Number.isFinite(entry.point.lat) || entry.point.lat < -90 || entry.point.lat > 90) {
    problems.push("point.lat must be within -90..90");
  }
  if (!Number.isFinite(entry.point.lng) || entry.point.lng < -180 || entry.point.lng > 180) {
    problems.push("point.lng must be within -180..180");
  }
  if (!entry.blurb.trim()) problems.push("blurb must be non-empty");
  if (problems.length > 0) {
    throw new BankValidationError(`invalid entry "${entry.word}": ${problems.join("; ")}`);
  }
}

/** Validate the structural invariants of an assembled bank. */
export function validateBank(bank: WordBank): void {
  const problems: string[] = [];
  if (!Number.isInteger(bank.version) || bank.version < 1) {
    problems.push("version must be a positive integer");
  }
  if (!Number.isInteger(bank.epochStartDay)) problems.push("epochStartDay must be an integer day number");
  if (!Number.isInteger(bank.seed)) problems.push("seed must be an integer");

  if (bank.tiers.length !== TIER_COUNT) {
    problems.push(`tiers must have exactly ${TIER_COUNT} buckets`);
  } else {
    const seenIds = new Set<string>();
    const seenWords = new Set<string>();
    for (let t = 0; t < bank.tiers.length; t++) {
      for (const entry of bank.tiers[t]!) {
        try {
          validateEntry(entry);
        } catch (err) {
          problems.push(err instanceof Error ? err.message : String(err));
        }
        if (entry.tier !== t + 1) {
          problems.push(`entry ${entry.id} sits in tier bucket ${t + 1} but claims tier ${entry.tier}`);
        }
        if (seenIds.has(entry.id)) problems.push(`duplicate entry id: ${entry.id}`);
        seenIds.add(entry.id);
        if (seenWords.has(entry.word.toLowerCase())) problems.push(`duplicate word: ${entry.word}`);
        seenWords.add(entry.word.toLowerCase());
      }
    }
  }

  const minLen = Math.min(...bank.tiers.map((t) => t.length));
  if (minLen < 1) problems.push("every tier must contain at least one entry");
  if (bank.masterSequence.length !== minLen * ROUNDS_PER_DAY) {
    problems.push("masterSequence length must equal minTierLength * 10");
  }

  if (bank.tiers.length === TIER_COUNT) {
    const expected = interleave(bank.tiers);
    for (let i = 0; i < expected.length; i++) {
      if (expected[i]!.id !== bank.masterSequence[i]?.id) {
        problems.push(`masterSequence out of order at index ${i}`);
        break;
      }
    }
    dayLoop: for (let d = 0; d < minLen; d++) {
      for (let k = 0; k < ROUNDS_PER_DAY; k++) {
        if (bank.masterSequence[d * ROUNDS_PER_DAY + k]?.tier !== k + 1) {
          problems.push("each day must have one word per tier in ascending difficulty");
          break dayLoop;
        }
      }
    }
  }

  for (const lang of new Set(bank.masterSequence.map((e) => e.originLanguage))) {
    if (!bank.languages[lang]) problems.push(`missing language metadata for "${lang}"`);
  }

  if (problems.length > 0) throw new BankValidationError(`invalid bank: ${problems.join("; ")}`);
}
