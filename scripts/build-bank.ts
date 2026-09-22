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
  const worklistRows: string[] = ["word\ttier\tchain_depth\tdeepest_language\tchain"];
  const { bank, report } = buildBankFromInputs({
    edgesText: readMaybeGzip(values.edges!),
    languagesText: readMaybeGzip(values.languages!),
    curation,
    version,
    epochStartDay,
    englishLangCode: values["english-code"],
    maxChainDepth,
    deepestAttested: values["deepest-attested"],
    onUncurated: (candidate) => {
      worklistRows.push(
        `${candidate.term}\t${candidate.tier}\t${candidate.chainDepth}\t${candidate.deepestLanguage}\t${candidate.chain.join(" <- ")}`,
      );
    },
  });
  mkdirSync(path.dirname(values.out!), { recursive: true });
  writeFileSync(values.out!, `${JSON.stringify(bank, null, 2)}\n`);
  console.log(
    `wrote ${values.out}: bank v${bank.version}, ${bank.masterSequence.length} entries ` +
      `(${bank.masterSequence.length / 10} days of puzzles), epoch start day ${bank.epochStartDay}`,
  );
  console.log(
    `report: ${report.candidateWords} candidate words | ${report.acceptedWords} accepted (curated) | ` +
      `${report.missingYear} awaiting a curated year | ${report.skippedEntries} skipped as invalid`,
  );
  console.log(
    `        ${report.salvageableWithAttestedAnchor} dropped only because their deepest hop is unplaceable ` +
      `(recoverable with --deepest-attested)`,
  );
  console.log(`tier counts: ${report.tierCounts.join(", ")}`);
  const missing = Object.entries(report.missingLanguage).sort((a, b) => b[1] - a[1]);
  if (missing.length) {
    console.log(`unplaceable deepest languages (top 10 of ${missing.length}):`);
    for (const [code, count] of missing.slice(0, 10)) console.log(`  ${String(count).padStart(6)}  ${code}`);
  }
  if (values.worklist) {
    writeFileSync(values.worklist, `${worklistRows.join("\n")}\n`);
    console.log(`wrote curation work list: ${values.worklist} (${worklistRows.length - 1} words)`);
  }
  if (report.warnings.length) {
    console.log(`warnings (${report.warnings.length}), first 5:`);
    for (const warning of report.warnings.slice(0, 5)) console.log(`  ${warning}`);
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
