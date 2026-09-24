/**
 * Fetch the senses of words a curator is working on, from the Wiktionary API.
 *
 * Why this and not the full dump: kaikki/wiktextract ships the same data as a 2.7 GB
 * download, but we need it for a few hundred words at a time, and Wiktionary serves a
 * page in ~0.3 s. So this fetches per word, at a polite rate, and caches the three
 * facts we keep (part of speech, gloss, donor languages) in one small JSON file.
 * Re-running is free: words already in the file are skipped unless --refresh.
 *
 * It is the same source as the etymology data (Wiktionary, CC BY-SA): no licensed
 * reference work is touched, and nothing but these facts is stored. See LICENSES.md.
 *
 * Usage:
 *   npx tsx scripts/fetch-senses.ts --from-batch data/curation-batch.json
 *   npx tsx scripts/fetch-senses.ts --words data/some-words.txt --limit 50
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseLanguageTsv } from "./lib/languages";
import { parseEnglishSenses } from "./lib/wikitext";

const { values } = parseArgs({
  options: {
    words: { type: "string" },
    "from-batch": { type: "string" },
    languages: { type: "string", default: "data/languages.tsv" },
    codes: { type: "string", default: "data/wiktionary_codes.csv" },
    out: { type: "string", default: "data/word-senses.json" },
    limit: { type: "string" },
    delay: { type: "string", default: "900" },
    refresh: { type: "boolean", default: false },
  },
});

const API = "https://en.wiktionary.org/w/api.php";
/** Wikimedia asks for a descriptive User-Agent; an anonymous one can be blocked. */
const USER_AGENT = "etymystery-curation/0.1 (https://github.com/rfreebern/etymystery)";

export interface SenseRecord {
  pos: string;
  gloss: string;
  etymology: string;
  donors: string[];
}

type SenseFile = Record<string, { fetchedAt: string; senses: SenseRecord[]; error?: string }>;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readWordList(): string[] {
  if (values.words) {
    return readFileSync(values.words, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  }
  if (values["from-batch"]) {
    const batch = JSON.parse(readFileSync(values["from-batch"], "utf8")) as Record<string, unknown>;
    // Batch keys are sense ids; the word is the part before any `:pos`.
    return Object.keys(batch).map((key) => key.split(":")[0] ?? key);
  }
  fail("give --words <file> or --from-batch <file>");
}

/** Language code -> the name the work list and bank use. */
function codeToName(path: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(path)) return map;
  const parsed = parseLanguageTsv(readFileSync(path, "utf8"));
  for (const [code, metadata] of Object.entries(parsed)) map.set(code, metadata.name);
  return map;
}

/**
 * Wiktionary's own code list, for codes our table deliberately leaves out: a donor
 * that is a reconstruction (`gem-pro`, `poz-pol`) has no place on the map, but a
 * curator still needs to read its name rather than a code.
 */
function wiktionaryNames(path: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split("\n").slice(1)) {
    const [code, name] = line.replace(/\r$/, "").split(",");
    if (code && name) map.set(code.trim(), name.trim());
  }
  return map;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sorted-key JSON. Note: the second argument of JSON.stringify is a REPLACER, so
 *  passing a key list there whitelists keys at every level and strips the data. */
function stringify(file: SenseFile): string {
  const sorted: SenseFile = {};
  for (const key of Object.keys(file).sort()) sorted[key] = file[key]!;
  return `${JSON.stringify(sorted, null, 1)}\n`;
}


/** One page's senses, or an error string. Retries because the API can be busy. */
async function fetchSenses(word: string): Promise<{ senses: SenseRecord[]; error?: string }> {
  const url = `${API}?action=parse&page=${encodeURIComponent(word)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
      if (response.status === 429 || response.status >= 500) {
        await sleep(2000 * attempt);
        continue;
      }
      if (!response.ok) return { senses: [], error: `HTTP ${response.status}` };
      const body = (await response.json()) as {
        parse?: { wikitext?: string };
        error?: { info?: string };
      };
      if (body.error) return { senses: [], error: body.error.info ?? "api error" };
      const senses = parseEnglishSenses(body.parse?.wikitext ?? "");
      return senses.length > 0 ? { senses } : { senses: [], error: "no English senses on the page" };
    } catch (error) {
      if (attempt === 3) {
        return { senses: [], error: error instanceof Error ? error.message : String(error) };
      }
      await sleep(1500 * attempt);
    }
  }
  return { senses: [], error: "gave up after retries" };
}

const words = [...new Set(readWordList())];
const limit = values.limit ? Number.parseInt(values.limit, 10) : words.length;
const delay = Number.parseInt(values.delay!, 10);
const names = codeToName(values.languages!);
const extraNames = wiktionaryNames(values.codes!);
const nameOf = (code: string): string => names.get(code) ?? extraNames.get(code) ?? code;
const out = values.out!;
const file: SenseFile = existsSync(out)
  ? (JSON.parse(readFileSync(out, "utf8")) as SenseFile)
  : {};

const todo = words.slice(0, limit).filter((word) => values.refresh || !file[word]);
console.log(
  `${words.length} words, ${todo.length} to fetch (${words.length - todo.length} already cached) -> ${out}`,
);

let fetched = 0;
let failed = 0;
for (const word of todo) {
  const { senses, error } = await fetchSenses(word);
  file[word] = {
    fetchedAt: new Date().toISOString(),
    // Donors as the names the rest of the toolchain uses, not bare codes.
    senses: senses.map((sense) => ({
      pos: sense.pos,
      gloss: sense.gloss,
      etymology: sense.etymology,
      donors: sense.donors.map(nameOf),
    })),
    ...(error ? { error } : {}),
  };
  fetched += 1;
  if (senses.length === 0) failed += 1;
  if (fetched % 25 === 0) {
    writeFileSync(out, `${stringify(file).trimEnd()}\n`);
    console.log(`  ${fetched}/${todo.length} (last: ${word}, ${senses.length} senses)`);
  }
  await sleep(delay);
}
writeFileSync(out, `${stringify(file).trimEnd()}\n`);
const withSenses = Object.values(file).filter((entry) => entry.senses.length > 0).length;
console.log(
  `\ndone: ${fetched} fetched (${failed} without senses), ${withSenses} of ${Object.keys(file).length} words have senses`,
);
