/**
 * Check curated years against the printed record: scan a dated sample of EEBO-TCP
 * and report, per word, the earliest text it appears in.
 *
 *   npx tsx scripts/attest-scan.ts --words data/check-words.txt --sample 400
 *
 * Output goes to data/attest.json (gitignored) and is read by
 * `npm run curate -- --mode check`, which flags a curated year the record contradicts.
 *
 * A hit is a citation. A miss is silence: see the note at the top of scripts/lib/eebo.ts.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { bodyText, headerYear, parseTcpCsv, sampleTexts, wordsPresent } from "./lib/eebo";

const { values } = parseArgs({
  options: {
    words: { type: "string" },
    "from-curation": { type: "string" },
    metadata: { type: "string", default: "data/TCP.csv" },
    out: { type: "string", default: "data/attest.json" },
    sample: { type: "string", default: "400" },
    delay: { type: "string", default: "120" },
    "texts-dir": { type: "string" },
  },
});

export interface Attestation {
  /** Earliest year in the sample where the word appears. */
  firstYear: number;
  /** How many sampled texts contain it. */
  texts: number;
  /** Up to three citations: text id, year, title (trimmed). */
  citations: Array<{ id: string; year: number; title: string }>;
}

export interface AttestFile {
  sample: { texts: number; from: number; to: number; generatedAt: string };
  words: Record<string, Attestation>;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readWords(): string[] {
  if (values.words) {
    return readFileSync(values.words, "utf8")
      .split("\n")
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith("#"));
  }
  if (values["from-curation"]) {
    const curation = JSON.parse(readFileSync(values["from-curation"], "utf8")) as Record<
      string,
      { year?: number }
    >;
    // Only words with a year to check; a derived span has nothing to contradict.
    return Object.entries(curation)
      .filter(([, entry]) => Number.isFinite(entry.year))
      .map(([key]) => key.split(":")[0]!.toLowerCase());
  }
  fail("give --words <file> or --from-curation <file>");
}

const metadataPath = values.metadata!;
if (!existsSync(metadataPath)) {
  fail(
    `no metadata at ${metadataPath}. It comes from the corpus index:\n` +
      `  git clone --depth 1 https://github.com/textcreationpartnership/Texts /tmp/tcp-texts\n` +
      `  cp /tmp/tcp-texts/TCP.csv .`,
  );
}

const records = parseTcpCsv(readFileSync(metadataPath, "utf8"));
const sampleSize = Number.parseInt(values.sample!, 10);
const sample = sampleTexts(records, sampleSize);
const words = new Set(readWords());
console.log(
  `${records.length} dated texts in the index; scanning ${sample.length} sampled ` +
    `(${sample[0]?.year}-${sample[sample.length - 1]?.year}) for ${words.size} words`,
);

const file: AttestFile = {
  sample: {
    texts: 0,
    from: sample[0]?.year ?? 0,
    to: sample[sample.length - 1]?.year ?? 0,
    generatedAt: new Date().toISOString(),
  },
  words: {},
};
const delay = Number.parseInt(values.delay!, 10);
let scanned = 0;
let failed = 0;

const textUrl = (id: string): string =>
  `https://raw.githubusercontent.com/textcreationpartnership/${id}/master/${id}.xml`;

for (const record of sample) {
  // A local copy of the texts (if someone has one) avoids thousands of requests.
  let xml: string | null = null;
  const local = values["texts-dir"] ? `${values["texts-dir"]}/${record.id}.xml` : "";
  if (local && existsSync(local)) xml = readFileSync(local, "utf8");
  else {
    try {
      const response = await fetch(textUrl(record.id), {
        headers: { "user-agent": "etymystery-curation/0.1 (https://github.com/rfreebern/etymystery)" },
      });
      if (response.ok) xml = await response.text();
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  if (xml) {
    // The header's own date is authoritative; the index date is the fallback.
    const year = headerYear(xml) ?? record.year;
    for (const word of wordsPresent(bodyText(xml), words)) {
      const existing = file.words[word];
      file.words[word] = existing
        ? {
            firstYear: Math.min(existing.firstYear, year),
            texts: existing.texts + 1,
            citations:
              year < existing.citations[0]!.year
                ? [{ id: record.id, year, title: record.title.slice(0, 90) }, ...existing.citations.slice(0, 2)]
                : existing.citations,
          }
        : {
            firstYear: year,
            texts: 1,
            citations: [{ id: record.id, year, title: record.title.slice(0, 90) }],
          };
    }
    file.sample.texts += 1;
  }
  scanned += 1;
  if (scanned % 50 === 0) {
    writeFileSync(values.out!, `${JSON.stringify(file, null, 1)}\n`);
    console.log(`  ${scanned}/${sample.length} texts (${Object.keys(file.words).length} words seen)`);
  }
  await new Promise((resolve) => setTimeout(resolve, delay));
}

writeFileSync(values.out!, `${JSON.stringify(file, null, 1)}\n`);
const hits = Object.entries(file.words).sort((a, b) => a[1].firstYear - b[1].firstYear);
console.log(
  `\nscanned ${file.sample.texts} texts (${failed} fetch failures) -> ${values.out!}\n` +
    `${hits.length} of ${words.size} words seen; earliest hits:`,
);
for (const [word, attestation] of hits.slice(0, 15)) {
  console.log(
    `  ${word.padEnd(12)} by ${attestation.firstYear} in ${attestation.texts} text(s) ` +
      `(${attestation.citations[0]!.id}: ${attestation.citations[0]!.title.slice(0, 50)})`,
  );
}
