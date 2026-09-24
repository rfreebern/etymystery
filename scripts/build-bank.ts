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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
