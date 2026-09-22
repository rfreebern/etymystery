#!/usr/bin/env node
/**
 * CLI: build a languages.tsv from Wiktionary's language code list, combining
 * the hand-curated overlay (curated/language-geo.json) with an automated
 * derivation from world-countries.
 *
 * Usage:
 *   npm run bootstrap:languages -- \
 *     --codes data/wiktionary_codes.csv \
 *     --overlay curated/language-geo.json \
 *     --out data/languages.tsv [--include-proto] [--review 30]
 *
 * wiktionary_codes.csv ships with etymology-db:
 *   https://raw.githubusercontent.com/droher/etymology-db/master/wiktionary_codes.csv
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildLanguageTable,
  loadOverlay,
  parseCodeList,
  toLanguageTsv,
  type CountryRecord,
} from "./lib/language-geo";
import { parseLanguageTsv } from "./lib/languages";

const { values } = parseArgs({
  options: {
    codes: { type: "string" },
    overlay: { type: "string", default: "curated/language-geo.json" },
    out: { type: "string", short: "o", default: "data/languages.tsv" },
    "include-proto": { type: "boolean", default: false },
    review: { type: "string", default: "30" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!values.codes) {
  fail("Usage: npm run bootstrap:languages -- --codes <wiktionary_codes.csv> [--out data/languages.tsv]");
}

const require_ = createRequire(import.meta.url);
const worldCountries = require_("world-countries") as CountryRecord[];

const codesText = readFileSync(values.codes!, "utf8");
const overlay = loadOverlay(JSON.parse(readFileSync(values.overlay!, "utf8")));

const { rows, stats } = buildLanguageTable({
  codesText,
  overlay,
  countries: worldCountries,
  includeProto: values["include-proto"],
});

// Catch overlay typos: overlay codes that Wiktionary's list does not define.
const codeSet = new Set(parseCodeList(codesText).map((entry) => entry.code));
const unknownOverlayCodes = Object.keys(overlay).filter((code) => !codeSet.has(code));

const tsv = toLanguageTsv(rows);
mkdirSync(path.dirname(values.out!), { recursive: true });
writeFileSync(values.out!, tsv);

// Contract self-check: the production parser must read back what we wrote.
const reparsed = parseLanguageTsv(tsv);
if (Object.keys(reparsed).length !== rows.length) {
  fail(`round-trip mismatch: wrote ${rows.length} rows, parser read ${Object.keys(reparsed).length}`);
}

console.log(`wrote ${values.out} — ${rows.length} languages`);
console.log(
  `codes: ${stats.codes} | overlay: ${stats.fromOverlay} | derived: ${stats.derived} | ` +
    `proto skipped: ${stats.protoSkipped} | unmatched: ${stats.unmatched}`,
);
if (unknownOverlayCodes.length) {
  console.warn(`overlay codes not present in the Wiktionary list (typos?): ${unknownOverlayCodes.join(", ")}`);
}
if (stats.reviewCodes.length) {
  const limit = Number.parseInt(values.review!, 10) || 30;
  console.log(
    `review recommended (derived across many countries, likely mis-anchored): ` +
      `${stats.reviewCodes.slice(0, limit).join(", ")}${stats.reviewCodes.length > limit ? " …" : ""}`,
  );
}
if (stats.unmatchedCodes.length) {
  console.log(`unmatched (no overlay, not derivable) — first 20: ${stats.unmatchedCodes.slice(0, 20).join(", ")}`);
}

