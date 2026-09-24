#!/usr/bin/env node
/**
 * Curation loop CLI. See CURATION.md for the process this supports.
 *
 *   npm run curate -- --mode next  --limit 25      # next words to research
 *   npm run curate -- --mode merge --batch out.json  # validate + fold in
 *   npm run curate -- --mode check                  # audit + progress
 *
 * "next" prints the batch with its proposed etymology chain and writes a
 * skeleton JSON (`year: 0` = to be researched). "merge" refuses entries without
 * a year and writes curated/curation.json in its one-entry-per-line style.
 * "check" audits the file against the current work list and reports progress per
 * tier, which is what actually determines days of play.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ANSWER_YEAR_MAX, ANSWER_YEAR_MIN, earliestEnglishEra } from "../src/timeline";
import { loadDrawableCountries } from "./lib/map-coverage";
import { parseFrequencyList } from "./lib/frequency";
import {
  auditCuration,
  derivePeriodEntries,
  formatCuration,
  mergeCuration,
  parseWorklist,
  selectNextBatch,
  settledSenseIds,
  type Curation,
  type CurationEntryInput,
  type WorklistCandidate,
} from "./lib/curation";

const DEFAULT_WORKLIST = "data/curation-worklist-interesting.tsv";
const DEFAULT_CURATION = "curated/curation.json";
const DEFAULT_BATCH = "data/curation-batch.json";
/** The shipped map + its country table, for the coverage check. */
const MAP_PATH = "web/public/countries-50m.json";
const COUNTRIES_PATH = "web/src/countries.json";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "next" },
    worklist: { type: "string", default: DEFAULT_WORKLIST },
    curation: { type: "string", default: DEFAULT_CURATION },
    batch: { type: "string", default: DEFAULT_BATCH },
    bank: { type: "string", default: "data/word-bank.json" },
    skip: { type: "string" },
    limit: { type: "string", default: "25" },
    floor: { type: "string", default: String(ANSWER_YEAR_MIN) },
    ceiling: { type: "string", default: String(ANSWER_YEAR_MAX) },
    frequency: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** One entry in the hand-written style: `{ "year": 1590, "tier": 1, ... }`. */
/** Match the hand-written style: one word per line, sorted. */
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Words already accepted into a bank, so the audit can tell them from typos. */
function readBankWords(path: string): Set<string> | undefined {
  try {
    const bank = readJson<{ tiers: Array<Array<{ word: string }>> }>(path);
    return new Set(bank.tiers.flat().map((entry) => entry.word));
  } catch {
    return undefined; // no bank yet: only the work list can vouch for a word
  }
}

/**
 * Accepted bank entries, for checks that need their chains or countries, not just
 * their words. This is also the only source of chains for words that are ALREADY
 * curated: curating a word removes it from the work list, so an audit of the
 * curation file cannot otherwise see what the etymology of its own entries is.
 */
function readBankEntries(
  path: string,
): Array<{ word: string; originLanguage: string; countries: string[]; originChain: string[] }> {
  try {
    const bank = readJson<{
      tiers: Array<
        Array<{ word: string; originLanguage: string; countries: string[]; originChain: string[] }>
      >;
    }>(path);
    return bank.tiers.flat();
  } catch {
    return [];
  }
}

/** A recorded route for a word: where it came from, and the chain that shows it. */
interface Route {
  origin: string;
  chain: string[];
}

/**
 * Every route we can attribute to a word, from the work list (candidates) and the
 * bank (already accepted). The audit matches an entry's chosen `origin` against
 * these, because a word's other routes are different senses: `back` may be late if
 * this entry is the French sense and early if it is the native one.
 */
function collectRoutes(
  candidates: readonly WorklistCandidate[],
  bank: Array<{ word: string; originLanguage: string; originChain: string[] }>,
): Map<string, Route[]> {
  const routes = new Map<string, Route[]>();
  const add = (word: string, route: Route): void => {
    const list = routes.get(word) ?? [];
    if (!list.some((existing) => existing.origin === route.origin)) list.push(route);
    routes.set(word, list);
  };
  for (const candidate of candidates) add(candidate.word, { origin: candidate.origin, chain: candidate.chain });
  for (const entry of bank) add(entry.word, { origin: entry.originLanguage, chain: entry.originChain });
  return routes;
}

function readSkip(path: string | undefined): Set<string> {
  if (!path) return new Set();
  return new Set(
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.replace(/\r$/, "").trim())
      .filter((line) => line && !line.startsWith("#")),
  );
}

const mode = values.mode!;
const limit = Number.parseInt(values.limit!, 10) || 25;
const yearFloor = Number.parseInt(values.floor!, 10);
const yearCeiling = Number.parseInt(values.ceiling!, 10);

if (!["next", "merge", "check", "tier", "derive"].includes(mode)) {
  fail(`--mode must be next | derive | merge | check | tier, got "${mode}"`);
}

const curation = readJson<Curation>(values.curation!);

if (mode === "next") {
  const candidates = parseWorklist(readFileSync(values.worklist!, "utf8"));
  const candidatesByWord = new Map(candidates.map((candidate) => [candidate.word, candidate]));
  const settled = settledSenseIds(curation, candidatesByWord);
  const batch = selectNextBatch(candidates, {
    settled,
    skip: readSkip(values.skip),
    limit,
  });
  const skeleton: Curation = {};
  for (const candidate of batch) {
    // Keyed by WORD, not by work-list route: a word's other recorded origins are
    // alternative routes to the same sense (`sugar` has five), so prompting per
    // route would ask the curator the same question repeatedly. `origin` is left
    // unset when the routes disagree — pinning the tie-break pick there is how
    // `back` silently became a French loanword.
    skeleton[candidate.word] = {
      year: 0,
      tier: candidate.tier,
      ...(candidate.origins.length > 1 ? {} : { origin: candidate.origin }),
      blurb: "",
    };
  }
  writeFileSync(values.batch!, formatCuration(skeleton));

  const words = new Set(candidates.map((candidate) => candidate.word));
  console.log(`${batch.length} senses to curate (wrote skeleton to ${values.batch!})`);
  console.log(
    `researched so far: ${Object.keys(curation).length} entries settling ${settled.size} of ` +
      `${candidates.length} candidate senses (${words.size} words)\n`,
  );
  for (const [index, candidate] of batch.entries()) {
    const rank = candidate.frequencyRank ?? "unranked";
    console.log(
      `${String(index + 1).padStart(3)}. ${candidate.word} → ${candidate.origin}  [freq ${rank}, tier ${candidate.tier}]`,
    );
    console.log(`     chain: ${candidate.chain.join(" <- ")}`);
    if (candidate.origins.length > 1) {
      console.log(
        `     this word has ${candidate.origins.length} recorded origins (${candidate.origins.join(", ")}): ` +
          `give it a "pos" and it files as ${candidate.word}:<pos>`,
      );
    }
  }
  console.log(
    `\nNow, for each word: check the chain against your reference, put the year English` +
      ` first used it in ${values.batch!}, then run --mode merge.`,
  );
} else if (mode === "derive") {
  // Words no source dates: the chain names an English stage, so the answer's span is
  // that period. This is the batch the manual pass could not have reached.
  const candidates = parseWorklist(readFileSync(values.worklist!, "utf8"));
  const candidatesByWord = new Map(candidates.map((candidate) => [candidate.word, candidate]));
  const settled = settledSenseIds(curation, candidatesByWord);
  const skip = readSkip(values.skip);
  // Existing research is kept: derive adds, never replaces.
  const existing = existsSync(values.batch!) ? readJson<Curation>(values.batch!) : {};
  const result = derivePeriodEntries(candidates, { settled, skip, limit });
  const batch: Curation = { ...existing, ...result.entries };
  writeFileSync(values.batch!, formatCuration(batch));

  const periods = new Map<string, number>();
  for (const candidate of candidates) {
    const era = earliestEnglishEra(candidate.chain);
    if (era) periods.set(era.label, (periods.get(era.label) ?? 0) + 1);
  }
  console.log(
    `drafted ${result.derived} entries from the period their chain records into ${values.batch!}`,
  );
  console.log(
    `  by period: ${[...periods].map(([label, n]) => `${label} ${n}`).join(", ") || "none"}`,
  );
  console.log(
    `  skipped: ${result.needsSense} words with several recorded origins (they need a human to` +
      ` say which sense it is, and the routes imply different periods)`,
  );
  console.log(`  skipped: ${result.noPeriod} words whose chain names no English stage`);
  console.log(
    `\nThese need no reference lookup: the span IS what the chain claims. Check the chain, then` +
      ` merge. For the words skipped above, use --mode next.`,
  );
} else if (mode === "merge") {
  const batch = readJson<Curation>(values.batch!);
  const { merged, added, skipped } = mergeCuration(curation, batch);
  const candidates = parseWorklist(readFileSync(values.worklist!, "utf8"));
  const knownWords = new Set(candidates.map((candidate) => candidate.word));
  const audit = auditCuration(merged, {
    knownWords,
    bankWords: readBankWords(values.bank!),
    originsByWord: new Map(candidates.map((candidate) => [candidate.word, candidate.origins])),
    routesByWord: collectRoutes(candidates, readBankEntries(values.bank!)),
    yearFloor,
    yearCeiling,
  });
  const blocking = audit.issues.filter((issue) => !issue.problem.startsWith("no mappable chain"));
  writeFileSync(values.curation!, formatCuration(merged));
  console.log(`merged ${added.length} researched words into ${values.curation!}`);
  if (skipped.length) {
    console.log(`skipped ${skipped.length} (no year yet, or already curated): ${skipped.join(", ")}`);
  }
  if (blocking.length) {
    console.log(`\n${blocking.length} entries need attention:`);
    for (const issue of blocking) console.log(`  ${issue.word}: ${issue.problem}`);
  }
} else if (mode === "tier") {
  // Days of play = the smallest tier, so tiers have to be *balanced* or the
  // scarcest one caps the bank. The chain-depth heuristic cannot do that (it
  // clumps most curated words into the easy tiers), so assign tiers by
  // obscurity instead: rank the curated pool by word frequency and cut it into
  // ten equal slices. Rarest first-class entries land in tier 10.
  const candidates = parseWorklist(readFileSync(values.worklist!, "utf8"));
  // Rank from the frequency list when there is one: a curated word has LEFT the work
  // list, so the work list cannot rank the very entries being tiered (they all fell
  // to tier 10 as "unranked", which capped the bank at whatever the work list had).
  const rankOf = new Map(candidates.map((candidate) => [candidate.word, candidate.frequencyRank]));
  if (values.frequency && existsSync(values.frequency)) {
    const frequency = parseFrequencyList(readFileSync(values.frequency, "utf8"));
    for (const key of Object.keys(curation)) {
      const bare = key.split(":")[0] ?? key;
      const rank = frequency.rankOf(bare);
      if (rank !== undefined && rankOf.get(bare) === undefined) rankOf.set(bare, rank);
    }
  }
  const keys = Object.keys(curation).filter((key) => Number.isFinite(curation[key]!.year));
  // Only words we can rank and that the pipeline can bank (a rank means the word has
  // a mappable chain) enter a tier; the rest are unfinishable today.
  const ranked = keys.filter((key) => rankOf.get(key.split(":")[0] ?? key) !== undefined);
  const ordered = ranked.sort((a, b) => {
    const ra = rankOf.get(a.split(":")[0] ?? a)!;
    const rb = rankOf.get(b.split(":")[0] ?? b)!;
    return ra === rb ? a.localeCompare(b) : ra - rb;
  });
  const counts = new Array<number>(10).fill(0);
  ordered.forEach((key, index) => {
    const tier = Math.min(10, Math.floor((index * 10) / ordered.length) + 1);
    curation[key]!.tier = tier;
    counts[tier - 1]! += 1;
  });
  for (const key of keys) {
    if (ranked.includes(key)) continue;
    curation[key]!.tier = 10; // unbankable today; tier is a placeholder
  }
  writeFileSync(values.curation!, formatCuration(curation));
  console.log(
    `balanced ${ordered.length} curated entries across 10 tiers by frequency rank` +
      (keys.length > ordered.length ? ` (${keys.length - ordered.length} unranked left at tier 10)` : ""),
  );
  console.log(`tier counts: ${counts.join(", ")}`);
  console.log(`capacity: ${Math.min(...counts)} days of puzzles (the scarcest tier sets it)`);
} else {
  const candidates = parseWorklist(readFileSync(values.worklist!, "utf8"));
  const audit = auditCuration(curation, {
    knownWords: new Set(candidates.map((candidate) => candidate.word)),
    bankWords: readBankWords(values.bank!),
    originsByWord: new Map(candidates.map((candidate) => [candidate.word, candidate.origins])),
    routesByWord: collectRoutes(candidates, readBankEntries(values.bank!)),
    yearFloor,
    yearCeiling,
  });
  const suggested = new Map(candidates.map((candidate) => [candidate.word, candidate.tier]));
  const tierCounts = new Array<number>(10).fill(0);
  for (const [word, entry] of Object.entries(curation)) {
    if (!Number.isFinite(entry.year)) continue;
    const tier = entry.tier ?? suggested.get(word) ?? 1;
    if (tier >= 1 && tier <= 10) tierCounts[tier - 1]! += 1;
  }

  console.log(`${audit.curated} of ${candidates.length} candidate senses have a year`);
  console.log(`tier counts: ${tierCounts.join(", ")}`);
  console.log(`capacity: ${Math.min(...tierCounts)} days of puzzles (the scarcest tier sets it)`);
  const unverified = Object.entries(curation)
    .filter(([, entry]) => entry.unverified && Number.isFinite(entry.year))
    .map(([word]) => word);
  if (unverified.length) {
    console.log(
      `\n${unverified.length} entries are marked "unverified" (drafted, not checked against a ` +
        `reference): ${unverified.join(", ")}`,
    );
  }
  // A period-derived span needs no reference check: it is what the chain claims.
  const periodic = Object.entries(curation)
    .filter(([, entry]) => entry.yearSource === "chain-period")
    .map(([word]) => word);
  if (periodic.length) {
    console.log(
      `\n${periodic.length} entries take their span from the period their chain records ` +
        `(no reference can narrow these): ${periodic.slice(0, 12).join(", ")}${
          periodic.length > 12 ? ", …" : ""
        }`,
    );
  }

  // A puzzle whose answer territory the map cannot draw is winnable only through the
  // representative-point fallback (see scripts/lib/map-coverage.ts), so say so rather
  // than letting curation add one without noticing.
  const drawable = loadDrawableCountries(MAP_PATH, COUNTRIES_PATH);
  const undrawable = readBankEntries(values.bank!).filter(
    (entry) => entry.countries.length > 0 && entry.countries.every((code) => !drawable.has(code)),
  );
  if (undrawable.length) {
    console.log(
      `\n${undrawable.length} entries answer for a territory the map cannot draw ` +
        `(scored by distance to the answer point, not by country):`,
    );
    for (const entry of undrawable) {
      console.log(`  ${entry.word} (${entry.originLanguage} ${entry.countries.join(",")})`);
    }
  }
  const ambiguousWords = new Set(
    candidates.filter((candidate) => candidate.origins.length > 1).map((candidate) => candidate.word),
  ).size;
  if (ambiguousWords) {
    console.log(
      `${ambiguousWords} words have more than one recorded origin: each sense is dated and filed separately`,
    );
  }
  if (audit.issues.length) {
    console.log(`\n${audit.issues.length} issues:`);
    for (const issue of audit.issues) console.log(`  ${issue.word}: ${issue.problem}`);
  } else {
    console.log("\nno issues");
  }
}
