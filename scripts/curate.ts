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
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ANSWER_YEAR_MAX, ANSWER_YEAR_MIN } from "../src/timeline";
import {
  auditCuration,
  mergeCuration,
  parseWorklist,
  selectNextBatch,
  settledSenseIds,
  type Curation,
  type CurationEntryInput,
} from "./lib/curation";

const DEFAULT_WORKLIST = "data/curation-worklist-interesting.tsv";
const DEFAULT_CURATION = "curated/curation.json";
const DEFAULT_BATCH = "data/curation-batch.json";

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
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** One entry in the hand-written style: `{ "year": 1590, "tier": 1, ... }`. */
function formatEntry(entry: CurationEntryInput): string {
  const parts: string[] = [];
  if (entry.year !== undefined) parts.push(`"year": ${entry.year}`);
  if (entry.tier !== undefined) parts.push(`"tier": ${entry.tier}`);
  if (entry.pos !== undefined) parts.push(`"pos": ${JSON.stringify(entry.pos)}`);
  if (entry.origin !== undefined) parts.push(`"origin": ${JSON.stringify(entry.origin)}`);
  if (entry.unverified) parts.push(`"unverified": true`);
  if (entry.blurb !== undefined) parts.push(`"blurb": ${JSON.stringify(entry.blurb)}`);
  return parts.length ? `{ ${parts.join(", ")} }` : "{}";
}

/** Match the hand-written style: one word per line, sorted. */
function formatCuration(curation: Curation): string {
  const words = Object.keys(curation).sort();
  const lines = words.map((word) => `  ${JSON.stringify(word)}: ${formatEntry(curation[word]!)}`);
  return `{\n${lines.join(",\n")}\n}\n`;
}

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

if (!["next", "merge", "check", "tier"].includes(mode)) {
  fail(`--mode must be next | merge | check | tier, got "${mode}"`);
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
} else if (mode === "merge") {
  const batch = readJson<Curation>(values.batch!);
  const { merged, added, skipped } = mergeCuration(curation, batch);
  const candidates = parseWorklist(readFileSync(values.worklist!, "utf8"));
  const knownWords = new Set(candidates.map((candidate) => candidate.word));
  const audit = auditCuration(merged, {
    knownWords,
    bankWords: readBankWords(values.bank!),
    originsByWord: new Map(candidates.map((candidate) => [candidate.word, candidate.origins])),
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
  const rankOf = new Map(candidates.map((candidate) => [candidate.word, candidate.frequencyRank]));
  const keys = Object.keys(curation).filter((key) => Number.isFinite(curation[key]!.year));
  // Only words the work list ranks can enter the bank at all (an unranked word has
  // no mappable chain). Letting those consume slice slots would skew every tier.
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
