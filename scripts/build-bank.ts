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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { dayNumberForDate } from "../src/daily";
import { buildBankFromInputs, type CurationEntry } from "./lib/bank-builder";
import { parseFrequencyList } from "./lib/frequency";

const { values } = parseArgs({
  options: {
    edges: { type: "string" },
    languages: { type: "string" },
    curation: { type: "string" },
    out: { type: "string", short: "o" },
    version: { type: "string", short: "v" },
    "epoch-start": { type: "string", default: "2026-01-01" },
    "english-code": { type: "string", default: "en" },
    "max-depth": { type: "string", default: "3" },
    "deepest-attested": { type: "boolean", default: false },
    frequency: { type: "string" },
    "exclude-origin": { type: "string" },
    "worklist-only": { type: "boolean", default: false },
    worklist: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!values.edges || !values.languages || !values.curation || !values.out || !values.version) {
  fail(
    "required: --edges <csv[.gz]> --languages <tsv> --curation <json> --out <bank.json> --version N " +
      "[--epoch-start YYYY-MM-DD] [--english-code en] [--max-depth 3]",
  );
}

const version = Number.parseInt(values.version!, 10);
if (!Number.isInteger(version) || version < 1) {
  fail(`--version must be a positive integer, got "${values.version}"`);
}
const epochStartDay = dayNumberForDate(values["epoch-start"]!);
if (!Number.isFinite(epochStartDay)) {
  fail(`--epoch-start must be a YYYY-MM-DD date, got "${values["epoch-start"]}"`);
}
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
  const worklist: Array<{ rank: number; line: string }> = [];
  const { bank, report } = buildBankFromInputs({
    edgesText: readMaybeGzip(values.edges!),
    languagesText: readMaybeGzip(values.languages!),
    curation,
    version,
    epochStartDay,
    englishLangCode: values["english-code"],
    maxChainDepth,
    deepestAttested: values["deepest-attested"],
    frequency,
    excludeOriginCodes,
    assembleBank: !values["worklist-only"],
    onUncurated: (candidate) => {
      worklist.push({
        rank: candidate.frequencyRank ?? Number.POSITIVE_INFINITY,
        line:
          `${candidate.term}\t${candidate.frequencyRank ?? ""}\t${candidate.tier}\t` +
          `${candidate.chainDepth}\t${candidate.deepestLanguage}\t${candidate.chain.join(" <- ")}`,
      });
    },
  });
  if (bank) {
    mkdirSync(path.dirname(values.out!), { recursive: true });
    writeFileSync(values.out!, `${JSON.stringify(bank, null, 2)}\n`);
    console.log(
      `wrote ${values.out}: bank v${bank.version}, ${bank.masterSequence.length} entries ` +
        `(${bank.masterSequence.length / 10} days of puzzles), epoch start day ${bank.epochStartDay}`,
    );
  } else {
    console.log(`bank not assembled (--worklist-only); nothing written to ${values.out}`);
  }
  console.log(
    `report: ${report.candidateWords} candidate words | ${report.acceptedWords} accepted (curated) | ` +
      `${report.missingYear} awaiting a curated year | ${report.skippedEntries} skipped as invalid`,
  );
  console.log(
    `        ${report.salvageableWithAttestedAnchor} dropped only because their deepest hop is unplaceable ` +
      `(recoverable with --deepest-attested)`,
  );
  console.log(`tier counts: ${report.tierCounts.join(", ")}`);
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
    const header = "word\tfreq_rank\ttier\tchain_depth\tdeepest_language\tchain";
    writeFileSync(values.worklist, `${[header, ...worklist.map((row) => row.line)].join("\n")}\n`);
    console.log(`wrote curation work list: ${values.worklist} (${worklist.length} words)`);
    if (frequency) {
      const within = (limit: number): number => worklist.filter((row) => row.rank <= limit).length;
      console.log(
        `work list coverage by frequency: top 1k ${within(1000)} | 5k ${within(5000)} | ` +
          `10k ${within(10_000)} | 50k ${within(50_000)}`,
      );
      console.log("most common uncurated words (curation starts here):");
      for (const row of worklist.slice(0, 15)) {
        const [word, rank, tier, depth, deepest, chain] = row.line.split("\t");
        console.log(`  ${word} (rank ${rank}, tier ${tier}, ${depth} hops) — ${chain} [${deepest}]`);
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
