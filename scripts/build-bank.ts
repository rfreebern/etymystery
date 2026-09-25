#!/usr/bin/env node
/**
 * CLI: assemble word-bank.json from etymology-db CSV + languages TSV + curation JSON.
 *
 * Usage:
 *   npm run build:bank -- \
 *     --edges data/etymology-db.csv.gz \
 *     --languages data/languages.tsv \
 *     --curation data/curation.json \
 *     --out data/word-bank.json \
 *     --version 1 \
 *     [--epoch-start 2026-01-01] [--english-code en] [--max-depth 3]
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { ROUNDS_PER_DAY, extendBank, validateBank } from "../src/bank";
import type { WordBank } from "../src/types";
import { dayNumberForDate } from "../src/daily";
import { buildBankFromInputs, type CurationEntry } from "./lib/bank-builder";
import { parseFrequencyList } from "./lib/frequency";
import { unusableSenseKeys } from "./lib/register";

/** Default start of the deterministic sequence: the day the site went up. */
const DEFAULT_EPOCH = "2026-01-01";

/**
 * Default start of the deterministic sequence. Changing it renumbers every day, so append
 * mode refuses to move it.
 */
const { values } = parseArgs({
  options: {
    edges: { type: "string" },
    languages: { type: "string" },
    curation: { type: "string" },
    out: { type: "string", short: "o" },
    version: { type: "string", short: "v" },
    "epoch-start": { type: "string", default: DEFAULT_EPOCH },
    "english-code": { type: "string", default: "en" },
    "max-depth": { type: "string", default: "3" },
    frequency: { type: "string" },
    "exclude-origin": { type: "string" },
    "native-quota": { type: "string" },
    "native-tiers": { type: "string" },
    /**
     * Curated donor edges to merge in (default: curated/edge-overrides.csv when it
     * exists). The source is a faithful parse of Wiktionary, not a checked dataset:
     * it sometimes skips a real, locatable language, which silently anchors a puzzle
     * to the wrong place (`coyote` reached English via Spanish but the source jumps
     * straight from Spanish to the reconstruction Proto-Nahuan, so Nahuatl was
     * unreachable and the answer became Spain).
     */
    "extra-edges": { type: "string" },
    "no-overrides": { type: "boolean", default: false },
    "worklist-only": { type: "boolean", default: false },
    worklist: { type: "string" },
    /** Sense cache used for the register rule; see the load below. */
    senses: { type: "string", default: "data/word-senses.json" },
    /**
     * Grow this shipped bank instead of replacing it: new entries are appended, shipped days
     * stay byte-identical, and corrections are recorded as `superseded`. See the load below.
     */
    "append-to": { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (
  !values.edges ||
  !values.languages ||
  !values.curation ||
  !values.out ||
  (!values.version && !values["append-to"])
) {
  fail(
    "required: --edges <csv[.gz]> --languages <tsv> --curation <json> --out <bank.json> " +
      "--version N, or --append-to <shipped bank.json> to grow one " +
      "[--epoch-start YYYY-MM-DD] [--english-code en] [--max-depth 3]",
  );
}
/**
 * Append mode: grow the bank a player is already playing, instead of building a new one.
 *
 * A rebuild produces a fresh shuffle, so every day that has already shipped would change -
 * and the day in progress would be orphaned, because the client keys its stored session on
 * the bank version. Extending is therefore append-only: `appendToBank` keeps the shipped days
 * verbatim, and a correction to an entry that already shipped is recorded as `superseded`
 * rather than applied, so no round anyone scored moves under them. `extendBank` (src/bank.ts)
 * owns those rules; this reads the bank they apply to and refuses to guess at it.
 */
const appendPath = values["append-to"];
let shipped: WordBank | undefined;
if (appendPath) {
  if (!existsSync(appendPath)) fail(`--append-to ${appendPath} does not exist`);
  shipped = JSON.parse(readFileSync(appendPath, "utf8")) as WordBank;
  try {
    validateBank(shipped);
  } catch (error) {
    fail(
      `--append-to ${appendPath} is not a valid bank: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

const version = values.version ? Number.parseInt(values.version, 10) : (shipped?.version ?? 0) + 1;
if (!Number.isInteger(version) || version < 1) {
  fail(`--version must be a positive integer, got "${values.version}"`);
}
if (shipped && version <= shipped.version) {
  fail(`--version ${version} must be greater than the shipped bank's version ${shipped.version}`);
}
const requestedEpoch = dayNumberForDate(values["epoch-start"]!);
if (!Number.isFinite(requestedEpoch)) {
  fail(`--epoch-start must be a YYYY-MM-DD date, got "${values["epoch-start"]}"`);
}
if (shipped && values["epoch-start"] !== DEFAULT_EPOCH && requestedEpoch !== shipped.epochStartDay) {
  fail(
    `--epoch-start ${values["epoch-start"]} disagrees with the shipped bank's epoch ` +
      `(day ${shipped.epochStartDay}): appending cannot move the day numbering`,
  );
}
// The shipped bank's epoch wins: it is what every stored day already counts from.
const epochStartDay = shipped ? shipped.epochStartDay : requestedEpoch;
const maxChainDepth = Number.parseInt(values["max-depth"]!, 10);
if (!Number.isInteger(maxChainDepth) || maxChainDepth < 1) {
  fail(`--max-depth must be a positive integer, got "${values["max-depth"]}"`);
}

function readMaybeGzip(file: string): string {
  const bytes = readFileSync(file);
  return file.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
}

try {
  const curation: Record<string, CurationEntry> = JSON.parse(readFileSync(values.curation!, "utf8"));
  const frequency = values.frequency ? parseFrequencyList(readFileSync(values.frequency, "utf8")) : undefined;
  const excludeOriginCodes = values["exclude-origin"]
    ? new Set(
        values["exclude-origin"]
          .split(",")
          .map((code) => code.trim())
          .filter(Boolean),
      )
    : undefined;
  const DEFAULT_OVERRIDES = "curated/edge-overrides.csv";
const overridePath = values["no-overrides"]
  ? null
  : values["extra-edges"] ?? DEFAULT_OVERRIDES;
let overrideEdgesText: string | undefined;
if (overridePath) {
  if (existsSync(overridePath)) {
    overrideEdgesText = readMaybeGzip(overridePath);
  } else if (values["extra-edges"]) {
    // An explicitly named file must exist; a missing default is simply "no overrides".
    fail(`--extra-edges ${overridePath} does not exist`);
  }
}

/**
 * The sense cache, for Wiktionary's register labels.
 *
 * A word whose curated sense is marked obsolete, archaic or literary does not reach the
 * bank: a daily puzzle has to be a word someone can plausibly know, and `musard`
 * ({{tlb|en|literary}}) reached a player before this rule existed. Without the cache
 * nothing can be judged, and the build says so rather than looking like it checked.
 */
const sensesPath = values.senses!;
let excludedSenses: Set<string> | undefined;
let cachedWords = 0;
let judgedWords = 0;
if (existsSync(sensesPath)) {
  const senses = JSON.parse(readFileSync(sensesPath, "utf8")) as Record<
    string,
    { senses: Array<{ pos: string; definitionLabels?: string[][] }> }
  >;
  cachedWords = Object.keys(senses).length;
  judgedWords = Object.values(senses).filter(
    (record) => record.senses.length > 0 && record.senses.every((sense) => Array.isArray(sense.definitionLabels)),
  ).length;
  // The label alone is not enough: Wiktionary also calls `disparage` obsolete, and it is
  // an ordinary word. A labelled word the frequency list knows is current English.
  excludedSenses = unusableSenseKeys(senses, (word) => frequency?.rankOf(word) !== undefined);
}

const worklist: Array<{ rank: number; line: string }> = [];
  const { bank, report } = buildBankFromInputs({
    edgesText: readMaybeGzip(values.edges!),
    overrideEdgesText,
    languagesText: readMaybeGzip(values.languages!),
    curation,
    version,
    epochStartDay,
    englishLangCode: values["english-code"],
    maxChainDepth,
    frequency,
    excludeOriginCodes,
    excludedSenses,
    nativeQuota: values["native-quota"] ? Number.parseFloat(values["native-quota"]!) : undefined,
    nativeTiers: values["native-tiers"]
      ? values["native-tiers"]!.split(",").map((tier) => Number.parseInt(tier, 10))
      : undefined,
    assembleBank: !values["worklist-only"],
    onUncurated: (candidate) => {
      worklist.push({
        rank: candidate.frequencyRank ?? Number.POSITIVE_INFINITY,
        line:
          `${candidate.term}\t${candidate.origin}\t${candidate.sense}\t${candidate.frequencyRank ?? ""}\t` +
          `${candidate.tier}\t${candidate.chainDepth}\t${candidate.deepestLanguage}\t` +
          `${candidate.chain.join(" <- ")}\t${candidate.origins.join("|")}`,
      });
    },
  });
  const extension = bank && shipped ? extendBank(shipped, bank.tiers.flat(), version) : undefined;
  const final = extension ? extension.bank : bank;
  // An extension that adds nothing and corrects nothing comes back as the input bank, so a
  // repeated run is a no-op rather than a rewrite of the file a player's days come from.
  const changed = extension ? extension.added.length > 0 || extension.annotated.length > 0 : Boolean(final);
  if (!final) {
    console.log(`bank not assembled (--worklist-only); nothing written to ${values.out}`);
  } else if (!changed) {
    console.log(
      `nothing to append and no corrections to record: ${appendPath} left untouched ` +
        `(bank v${final.version}, ${final.masterSequence.length / ROUNDS_PER_DAY} days)`,
    );
  } else {
    mkdirSync(path.dirname(values.out!), { recursive: true });
    const payload = `${JSON.stringify(final, null, 2)}\n`;
    // Append mode is usually pointed at the bank it just read, so write beside it and rename:
    // an interrupted run must not leave a half-written file that a player's days depend on.
    if (appendPath) {
      writeFileSync(`${values.out!}.tmp`, payload);
      renameSync(`${values.out!}.tmp`, values.out!);
    } else {
      writeFileSync(values.out!, payload);
    }
    console.log(
      `wrote ${values.out}: bank v${final.version}, ${final.masterSequence.length} entries ` +
        `(${final.masterSequence.length / ROUNDS_PER_DAY} days of puzzles), epoch start day ${final.epochStartDay}`,
    );
  }
  if (extension && shipped) {
    const before = shipped.masterSequence.length / ROUNDS_PER_DAY;
    const after = extension.bank.masterSequence.length / ROUNDS_PER_DAY;
    console.log(
      extension.added.length > 0
        ? `append: ${extension.added.length} entries in curation that the bank did not have: ` +
            `${before} days -> ${after} days (v${shipped.version} -> v${extension.bank.version})`
        : `append: no new entries in curation: still ${before} days at v${shipped.version}`,
    );
    if (extension.annotated.length > 0) {
      console.log(
        `corrections: ${extension.annotated.length} shipped entries a later curation disagrees with, ` +
          `recorded as "superseded" (the played values are untouched): ` +
          `${extension.annotated.slice(0, 8).map(({ id, fields }) => `${id} [${fields.join(", ")}]`).join(", ")}` +
          `${extension.annotated.length > 8 ? `, and ${extension.annotated.length - 8} more` : ""}`,
      );
    }
    if (extension.uncurated.length > 0) {
      console.log(
        `no longer curated: ${extension.uncurated.length} shipped entries are absent from the ` +
          `curation file, left in place because a shipped day cannot lose its word: ` +
          `${extension.uncurated.slice(0, 6).join(", ")}` +
          `${extension.uncurated.length > 6 ? ", ..." : ""}`,
      );
    }
  }
  console.log(
    `report: ${report.candidateSenses} candidate senses (${report.candidateWords} words) | ` +
      `${report.acceptedWords} accepted (curated) | ${report.missingYear} awaiting a curated year | ` +
      `${report.skippedEntries} skipped as invalid`,
  );
  console.log(`tier counts: ${report.tierCounts.join(", ")}`);
  if (overridePath) {
    console.log(
      report.overrideEdges > 0
        ? `override edges: ${report.overrideEdges} applied from ${overridePath}`
        : `override edges: none new in ${overridePath} (already recorded, or the file is empty)`,
    );
  } else {
    console.log("override edges: disabled (--no-overrides)");
  }
  if (excludedSenses) {
    console.log(
      `register labels: ${report.excludedByLabel} dropped as obsolete, archaic or literary ` +
        `(${judgedWords} of ${cachedWords} cached words carry labels, from ${sensesPath})`,
    );
  } else {
    console.log(
      `register labels: NOT checked (no ${sensesPath}; run scripts/fetch-senses.ts to fill it), ` +
        `so obsolete words can still ship`,
    );
  }
  if (report.ambiguousWords) {
    console.log(
      `        ${report.ambiguousWords} candidates have more than one recorded origin (homographs: ` +
        `part of speech and origin must be curated for those)`,
    );
  }
  if (report.ambiguousWithoutOrigin) {
    console.log(
      `        ${report.ambiguousWithoutOrigin} curated entries name no "origin" despite several being recorded: ` +
        `the tie-break picked for them`,
    );
  }
  if (report.unverifiedEntries) {
    console.log(
      `        ${report.unverifiedEntries} accepted entries are marked "unverified": a draft nobody has ` +
        `checked against a reference yet (listed by \`npm run curate -- --mode check\`)`,
    );
  }
  if (report.nativeAdmitted > 0 || report.nativeDropped > 0) {
    console.log(
      `native answers: ${report.nativeAdmitted} admitted (tier ${
        (values["native-tiers"] ?? "1,2")
      }), ${report.nativeDropped} left out by the ${values["native-quota"]} quota`,
    );
  }
  if (report.excludedByOrigin) {
    console.log(
      `excluded by origin (${[...(excludeOriginCodes ?? [])].join(", ")}): ${report.excludedByOrigin} words`,
    );
  }
  const missing = Object.entries(report.missingLanguage).sort((a, b) => b[1] - a[1]);
  if (missing.length) {
    console.log(`unplaceable deepest languages (top 10 of ${missing.length}):`);
    for (const [code, count] of missing.slice(0, 10)) console.log(`  ${String(count).padStart(6)}  ${code}`);
  }
  if (frequency) {
    console.log(
      `frequency list: ${frequency.size} words | candidates with no rank: ${report.withoutFrequencyRank}`,
    );
  }
  if (values.worklist) {
    // Curation order: most common first, unranked rarities last, alphabetical
    // within a rank so the file is reproducible.
    worklist.sort((a, b) => a.rank - b.rank || a.line.localeCompare(b.line));
    const header = "word\torigin\tsense\tfreq_rank\ttier\tchain_depth\tdeepest_language\tchain\torigins";
    writeFileSync(values.worklist, `${[header, ...worklist.map((row) => row.line)].join("\n")}\n`);
    console.log(`wrote curation work list: ${values.worklist} (${worklist.length} words)`);
    if (frequency) {
      const within = (limit: number): number => worklist.filter((row) => row.rank <= limit).length;
      console.log(
        `work list coverage by frequency: top 1k ${within(1000)} | 5k ${within(5000)} | ` +
          `10k ${within(10_000)} | 50k ${within(50_000)}`,
      );
      console.log("most common uncurated senses (curation starts here):");
      for (const row of worklist.slice(0, 15)) {
        const [word, origin, , rank, tier, depth, , chain] = row.line.split("\t");
        console.log(`  ${word} → ${origin} (rank ${rank}, tier ${tier}, ${depth} hops) — ${chain}`);
      }
    }
  }
  if (report.warnings.length) {
    console.log(`warnings (${report.warnings.length}), first 5:`);
    for (const warning of report.warnings.slice(0, 5)) console.log(`  ${warning}`);
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
