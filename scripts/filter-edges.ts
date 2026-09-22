#!/usr/bin/env node
/**
 * CLI: stream the full etymology-db dataset down to the edges a bank build can
 * use, so the 4.2M-row / 456 MB CSV never has to fit in memory.
 *
 *   npm run filter:edges -- \
 *     --edges data/etymology-db.csv.gz \
 *     --languages data/languages.tsv \
 *     --out data/edges-filtered.csv.gz
 *
 * Keeps rows whose source language we can place on the map (English included)
 * and whose relation type is a donor relation, then rewrites the survivors as a
 * minimal 5-column CSV. It also prints the donor languages that block the most
 * English words: that histogram is the work list for curated/language-geo.json.
 */
import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { createGunzip, createGzip } from "node:zlib";
import { createCsvRowParser, resolveColumn, type ColumnMap } from "./lib/etymology-db";
import { createEdgeFilter, formatCsvRow, MINIMAL_EDGE_HEADER } from "./lib/edge-filter";
import { parseLanguageTsv } from "./lib/languages";

const { values } = parseArgs({
  options: {
    edges: { type: "string" },
    languages: { type: "string" },
    out: { type: "string", short: "o" },
    "english-code": { type: "string", default: "en" },
    "all-reltypes": { type: "boolean", default: false },
    "report-top": { type: "string", default: "20" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!values.edges || !values.languages || !values.out) {
  fail("required: --edges <csv[.gz]> --languages <tsv> --out <csv[.gz]>");
}

const languages = parseLanguageTsv(readFileSync(values.languages!, "utf8"));
const englishCode = values["english-code"]!;
const englishName = languages[englishCode]?.name ?? "English";
const allowedNames = new Set(Object.values(languages).map((entry) => entry.name));

const filter = createEdgeFilter({
  allowedNames,
  englishName,
  allReltypes: values["all-reltypes"],
});

let cols: ColumnMap | null = null;
const decoder = new TextDecoder("utf-8");
const pending: string[] = [];

const parser = createCsvRowParser((row) => {
  if (!cols) {
    const headers = row.map((h) => h.trim());
    cols = {
      lang: resolveColumn(headers, ["lang", "language"], "lang", true),
      term: resolveColumn(headers, ["term"], "term", true),
      reltype: resolveColumn(headers, ["reltype", "relation", "relation_type"], "reltype", true),
      relatedLang: resolveColumn(headers, ["related_lang", "related_language"], "related_lang", false),
      relatedTerm: resolveColumn(headers, ["related_term"], "related_term", false),
    };
    pending.push(formatCsvRow(MINIMAL_EDGE_HEADER));
    return;
  }
  if (!filter.keep(cols, row)) return;
  const get = (idx: number): string => (idx >= 0 ? (row[idx] ?? "").trim() : "");
  pending.push(
    formatCsvRow([
      get(cols.lang),
      get(cols.term),
      get(cols.reltype),
      get(cols.relatedLang),
      get(cols.relatedTerm),
    ]),
  );
});

const transformer = new Transform({
  transform(chunk: Buffer, _encoding, callback) {
    parser.push(decoder.decode(chunk, { stream: true }));
    callback(null, pending.length ? pending.splice(0).join("") : undefined);
  },
  flush(callback) {
    parser.push(decoder.decode());
    parser.flush();
    callback(null, pending.length ? pending.splice(0).join("") : undefined);
  },
});

try {
  const gzipOut = values.out!.endsWith(".gz");
  await pipeline(
    createReadStream(values.edges!),
    values.edges!.endsWith(".gz") ? createGunzip() : new Transform({ transform: (c, _e, cb) => cb(null, c) }),
    transformer,
    gzipOut ? createGzip() : new Transform({ transform: (c, _e, cb) => cb(null, c) }),
    createWriteStream(values.out!),
  );
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

const { stats } = filter;
const limit = Number.parseInt(values["report-top"]!, 10) || 20;
console.log(`wrote ${values.out}`);
console.log(
  `rows: ${stats.rows} | kept: ${stats.kept} | dropped: ` +
    `${stats.droppedUnknownSource} unknown-source-language, ${stats.droppedReltype} non-donor-reltype, ` +
    `${stats.droppedIncomplete} incomplete`,
);
const blocked = [...stats.blockedEnglishDonors.entries()]
  .filter(([name]) => !allowedNames.has(name))
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
if (blocked.length) {
  console.log(`\nEnglish words blocked by languages with no geography (overlay work list, top ${limit}):`);
  for (const [name, count] of blocked.slice(0, limit)) console.log(`  ${String(count).padStart(6)}  ${name}`);
  const totalBlocked = blocked.reduce((sum, [, count]) => sum + count, 0);
  console.log(`  (${blocked.length} languages, ${totalBlocked} rows)`);
}
