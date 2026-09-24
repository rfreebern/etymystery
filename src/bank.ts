import type { BankEntry, LanguageInfo, WordBank } from "./types";
import { hashString, mulberry32, shuffle } from "./prng";

/**
 * Number of difficulty tiers. A day deals exactly one word per tier, easiest to hardest,
 * so this is also the number of rounds in a day: five tiers, five rounds.
 */
export const TIER_COUNT = 5;
/** Rounds per daily puzzle — one word per tier, so it cannot drift from TIER_COUNT. */
export const ROUNDS_PER_DAY = TIER_COUNT;

/**
 * Separator for composite region keys: a NUL cannot appear in a language or region
 * name, so joining names with it can never collide with a single name.
 */
const KEY_SEP = "\u0000";

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

  return finalizeBank(
    {
      version: input.version,
      epochStartDay: input.epochStartDay,
      seed,
      tiers: buckets,
      languages: input.languages,
    },
    // Days are filled to spread the origins: see `InterleaveOptions`.
    { regionsOf: (entry) => regionsOfLanguage(input.languages, entry.originLanguage) },
  );
}

/**
 * Assemble the master sequence from (already shuffled) tier queues via
 * round-robin interleave: tier1[0], tier2[0], ..., tier10[0], tier1[1], ...
 *
 * The sequence covers exactly `min(tier lengths)` days, so every served day
 * gets precisely one word per tier (one round per tier, easy to hard). Surplus entries
 * in deeper tiers are left unconsumed for the next bank version.
 */
/**
 * How the days are filled.
 *
 * `regionsOf` turns an entry into its origin's regions, coarsest first (for the shipped
 * bank: `["Europe", "Southern Europe"]`). Given it, each day draws from a tier's queue
 * the entry whose region is least represented in that day, so a day's ten rounds span as
 * many origins as the queues allow instead of clumping. Ties go to the region that is
 * least used across the whole bank, which spreads the thin regions over the calendar
 * rather than burning them in the first week, and then to queue order, so the sequence
 * stays a pure function of the shuffled queues.
 */
export interface InterleaveOptions {
  regionsOf?: (entry: BankEntry) => readonly string[];
  /**
   * Deal region-aware only from this day on, taking the earlier days in queue order.
   * `appendToBank` uses it: the days already shipped must not move, so only the days the
   * new entries create are dealt for variety.
   */
  fromDay?: number;
}

/**
 * How a candidate entry ranks for one slot, smallest wins.
 *
 * The first term is what makes the origins last, and it caps a continent AND the thin
 * continents together: a continent may take at most its fair share of a day's rounds, and
 * everything other than the bank's densest continent shares one cap
 * (`ceil(thinRemaining / daysLeft)`). The group cap is the part that was missing: the
 * day-freshness term below is greedy by design — it takes a rare origin whenever one is on
 * offer — so on its own it spends the thin supply in the first weeks and leaves the tail of
 * the calendar with none. Only after the caps does the rest of the vector matter, and it is
 * about the day itself: prefer a region the day has not used yet (continent, then
 * subregion), then the rarest and least-used regions. Queue order breaks the last tie, which
 * keeps the sequence a pure function of the shuffled queues.
 */
function rankVector(
  entry: BankEntry,
  regionsOf: (entry: BankEntry) => readonly string[],
  context: DealContext,
): number[] {
  const regions = regionsOf(entry);
  const continent = regions[0] ?? "unknown";
  const overShare =
    (context.usedTodayByContinent.get(continent) ?? 0) >= (context.share.get(continent) ?? Infinity);
  const thinOver = continent !== context.majority && thinUsedToday(context) >= context.thinShare;
  const vector: number[] = [overShare || thinOver ? 1 : 0];
  for (let level = 0; level < regions.length; level++) {
    vector.push(context.usedToday.get(regions.slice(0, level + 1).join(KEY_SEP)) ?? 0);
  }
  vector.push(context.remaining.get(continent) ?? 0);
  for (let level = 0; level < regions.length; level++) {
    vector.push(context.usedTotal.get(regions.slice(0, level + 1).join(KEY_SEP)) ?? 0);
  }
  return vector;
}

/**
 * What the dealing knows while it fills a day: the regions that day has used, what is left
 * in the queues, and the caps that stop a thin region from being spent too fast.
 */
interface DealContext {
  /** Region paths the current day has used (continent, continent+subregion, ...). */
  usedToday: Map<string, number>;
  /** The same, continent only, because that is what the day's caps are spent against. */
  usedTodayByContinent: Map<string, number>;
  /** Region paths the whole calendar has used so far. */
  usedTotal: Map<string, number>;
  /** Rounds still unplayed per continent. */
  remaining: ReadonlyMap<string, number>;
  /** The most one day may take from a single continent. */
  share: ReadonlyMap<string, number>;
  /** The continent the bank is densest in; every other continent counts as thin. */
  majority: string;
  /** The most one day may take from all the thin continents together. */
  thinShare: number;
}

/** Rounds the current day has already taken from the thin continents. */
function thinUsedToday(context: DealContext): number {
  let used = 0;
  for (const [continent, count] of context.usedTodayByContinent) {
    if (continent !== context.majority) used += count;
  }
  return used;
}

function isBetter(candidate: readonly number[], best: readonly number[]): boolean {
  for (let i = 0; i < Math.min(candidate.length, best.length); i++) {
    if (candidate[i]! !== best[i]!) return candidate[i]! < best[i]!;
  }
  return false;
}

interface ContinentBudget {
  remaining: Map<string, number>;
  share: Map<string, number>;
  majority: string;
  thinShare: number;
}

/** Rounds of each continent still unplayed, and the caps a day has to respect. */
function continentBudget(
  queues: readonly BankEntry[][],
  regionsOf: (entry: BankEntry) => readonly string[],
  daysLeft: number,
): ContinentBudget {
  const remaining = new Map<string, number>();
  for (const queue of queues) {
    for (const entry of queue) {
      const continent = regionsOf(entry)[0] ?? "unknown";
      remaining.set(continent, (remaining.get(continent) ?? 0) + 1);
    }
  }
  const share = new Map<string, number>();
  let majority = "unknown";
  let most = -1;
  let thinRemaining = 0;
  for (const [continent, count] of remaining) {
    share.set(continent, Math.max(1, Math.ceil(count / Math.max(1, daysLeft))));
    if (count > most) {
      most = count;
      majority = continent;
    }
  }
  for (const [continent, count] of remaining) {
    if (continent !== majority) thinRemaining += count;
  }
  return {
    remaining,
    share,
    majority,
    thinShare: Math.max(1, Math.ceil(thinRemaining / Math.max(1, daysLeft))),
  };
}

/**
 * Deal the days from the tier queues: the round-robin sequence AND the queues in the
 * order they will be played.
 *
 * The queues come back in play order because the two must agree: `validateBank` checks
 * that `tiers[t][d]` is exactly round `d` of tier `t`, and `appendToBank` relies on the
 * played entries sitting at the front so appending cannot move an existing day.
 */
export function dealSequence(
  tiers: BankEntry[][],
  options: InterleaveOptions = {},
): { master: BankEntry[]; tiers: BankEntry[][] } {
  if (tiers.length !== TIER_COUNT) {
    throw new BankValidationError(`expected exactly ${TIER_COUNT} tiers, got ${tiers.length}`);
  }
  const days = Math.min(...tiers.map((t) => t.length));
  const queues = tiers.map((tier) => [...tier]);
  const regionsOf = options.regionsOf;
  const fromDay = Math.max(0, options.fromDay ?? 0);
  const usedTotal = new Map<string, number>();
  const master: BankEntry[] = [];
  const played: BankEntry[][] = Array.from({ length: TIER_COUNT }, () => []);

  for (let day = 0; day < days; day++) {
    // A continent may take at most its fair share of this day (see continentBudget),
    // which is what spreads a thin origin over the calendar instead of the first week.
    const context: DealContext = {
      usedToday: new Map<string, number>(),
      usedTodayByContinent: new Map<string, number>(),
      usedTotal,
      ...(regionsOf
        ? continentBudget(queues, regionsOf, days - day)
        : {
            remaining: new Map<string, number>(),
            share: new Map<string, number>(),
            majority: "unknown",
            thinShare: Number.POSITIVE_INFINITY,
          }),
    };
    for (const [tierIndex, queue] of queues.entries()) {
      let index = 0;
      // Days already shipped keep their order; only the new ones are dealt for variety.
      if (regionsOf && day >= fromDay) {
        let best = rankVector(queue[0]!, regionsOf, context);
        for (let i = 1; i < queue.length; i++) {
          const candidate = rankVector(queue[i]!, regionsOf, context);
          if (isBetter(candidate, best)) {
            best = candidate;
            index = i;
          }
        }
      }
      const [entry] = queue.splice(index, 1);
      if (!entry) throw new BankValidationError(`tier queue unexpectedly empty at day ${day}`);
      master.push(entry);
      played[tierIndex]!.push(entry);
      if (regionsOf) {
        const regions = regionsOf(entry);
        for (let level = 0; level < regions.length; level++) {
          const key = regions.slice(0, level + 1).join(KEY_SEP);
          context.usedToday.set(key, (context.usedToday.get(key) ?? 0) + 1);
          context.usedTotal.set(key, (context.usedTotal.get(key) ?? 0) + 1);
        }
        // The continent tally is what the day's caps are spent against.
        const continent = regions[0] ?? "unknown";
        context.usedTodayByContinent.set(
          continent,
          (context.usedTodayByContinent.get(continent) ?? 0) + 1,
        );
      }
    }
  }
  return {
    master,
    // Played entries first, in play order, then whatever is left for later days.
    tiers: queues.map((queue, tierIndex) => [...played[tierIndex]!, ...queue]),
  };
}

export function interleave(tiers: BankEntry[][], options: InterleaveOptions = {}): BankEntry[] {
  return dealSequence(tiers, options).master;
}

/** Internal: attach a master sequence and validate the assembled bank. */
function finalizeBank(
  bank: Omit<WordBank, "masterSequence">,
  options: InterleaveOptions = {},
): WordBank {
  // Deal first: the queues come back in play order, which is what validateBank checks.
  const { master, tiers } = dealSequence(bank.tiers, options);
  const withMaster: WordBank = { ...bank, tiers, masterSequence: master };
  validateBank(withMaster);
  return withMaster;
}

/**
 * The regions a day's answer should vary over: continent first, then subregion. Both
 * levels matter, in that order: without the continent level a day could take four rounds
 * from four European subregions and call itself varied, and without the subregion level a
 * day with two Asian rounds would not care that both were Arabic.
 */
export function regionsOfLanguage(languages: Record<string, LanguageInfo>, name: string): string[] {
  const info = languages[name];
  const regions = [info?.continent, info?.subregion].filter(
    (region): region is string => Boolean(region),
  );
  return regions.length > 0 ? regions : ["unknown"];
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
  // The days already shipped are indexed, not re-dealt: a player's day must not change
  // because someone appended words. Only the days the new entries create are dealt to
  // spread their origins.
  const shippedDays = Math.floor(bank.masterSequence.length / ROUNDS_PER_DAY);
  return finalizeBank(
    {
      version: nextVersion,
      epochStartDay: bank.epochStartDay,
      seed: bank.seed,
      tiers,
      languages: bank.languages,
    },
    { regionsOf: (entry) => regionsOfLanguage(bank.languages, entry.originLanguage), fromDay: shippedDays },
  );
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
  if (
    entry.yearTo !== undefined &&
    (!Number.isFinite(entry.yearTo) || entry.yearTo < entry.year || entry.yearTo > 2200)
  ) {
    problems.push("yearTo must be a finite year at or after year (the upper bound of the answer span)");
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
    const seenProvenance = new Set<string>();
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
        // A puzzle entry is a *sense*, so one word may legitimately appear twice
        // (`back` the noun is inherited from Old English; another sense came via
        // French). What must never repeat is the same word answered by the same
        // origin language — that is the same puzzle twice.
        const provenance = `${entry.word.toLowerCase()}|${entry.originLanguage.toLowerCase()}`;
        if (seenProvenance.has(provenance)) {
          problems.push(`duplicate puzzle: ${entry.word} answered by ${entry.originLanguage} appears twice`);
        }
        seenProvenance.add(provenance);
      }
    }
  }

  const minLen = Math.min(...bank.tiers.map((t) => t.length));
  if (minLen < 1) problems.push("every tier must contain at least one entry");
  if (bank.masterSequence.length !== minLen * ROUNDS_PER_DAY) {
    problems.push(`masterSequence length must equal minTierLength * ${ROUNDS_PER_DAY}`);
  }

  if (bank.tiers.length === TIER_COUNT) {
    // Check the tier queues and the sequence AGREE, rather than recomputing the sequence
    // with one fixed rule: the dealing may be region-aware (see dealSequence), and a
    // recomputation would then disagree with a bank that is perfectly consistent.
    for (let i = 0; i < bank.masterSequence.length; i++) {
      const tier = i % ROUNDS_PER_DAY;
      const day = Math.floor(i / ROUNDS_PER_DAY);
      if (bank.tiers[tier]?.[day]?.id !== bank.masterSequence[i]!.id) {
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
