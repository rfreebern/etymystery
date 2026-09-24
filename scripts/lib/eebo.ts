/**
 * Attestation checking against EEBO-TCP: the corpus of Early English Books Online
 * transcripts (1475-1700), released by the Text Creation Partnership under CC0.
 *
 * Why this matters: most borrowed words have no English stage in their etymology, so
 * their first use is a real reference lookup — the remaining manual bottleneck after
 * `--mode derive` cleared the inherited layer. This corpus is a *dated* record, so it
 * can say "the word is in print by 1587" with a citation, and flag a draft year that
 * the record contradicts.
 *
 * Two honest limits, both of which the report must state:
 *
 * 1. We scan a SAMPLE. The whole corpus is 61,000 texts in as many GitHub repos, and
 *    fetching all of them is not reasonable, so the tool takes an even spread by date
 *    (see `sampleTexts`). A HIT is a citation; a MISS is silence, not evidence of
 *    absence — a rare word in a 3% sample is simply not seen.
 * 2. A corpus gives an upper bound on the first use ("in use by X"), never a precise
 *    date, which is exactly what the curated `year`/`yearTo` span is for.
 */

/** One row of TCP.csv: the metadata index for the whole corpus, with a date each. */
export interface TextRecord {
  id: string;
  year: number;
  title: string;
}

/**
 * Read TCP.csv. Columns: TCP,EEBO,VID,STC,Status,Author,Date,Title,Terms,Pages.
 * Titles contain commas and quotes, so this is a real CSV reader rather than a split.
 */
export function parseTcpCsv(text: string): TextRecord[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const records: TextRecord[] = [];
  for (const cells of rows.slice(1)) {
    const id = (cells[0] ?? "").trim();
    const year = Number.parseInt((cells[6] ?? "").trim(), 10);
    const title = (cells[7] ?? "").trim();
    if (!/^[A-Z]\d{5}$/.test(id) || !Number.isFinite(year)) continue;
    records.push({ id, year, title });
  }
  return records;
}

/**
 * An even spread by date: sort by year, then take every `stride`-th text. Spreading
 * across the whole period matters more than volume — a clustered sample would make
 * every word look like it appeared in the years the cluster covers.
 *
 * The frame is limited to the corpus's own period (1450-1800, with 1700 as the
 * practical end of EEBO): the index has a few hundred rows whose date column is junk
 * (`1`, `1774`, or a parse failure), and sampling from those would put texts at years
 * the corpus does not cover.
 */
export function sampleTexts(
  records: readonly TextRecord[],
  count: number,
  from = 1450,
  to = 1800,
): TextRecord[] {
  const inFrame = records.filter((record) => record.year >= from && record.year <= to);
  const sorted = [...inFrame].sort((a, b) =>
    a.year === b.year ? a.id.localeCompare(b.id) : a.year - b.year,
  );
  if (sorted.length <= count) return sorted;
  const stride = sorted.length / count;
  const sample: TextRecord[] = [];
  for (let i = 0; i < count; i++) {
    const record = sorted[Math.floor(i * stride)];
    if (record) sample.push(record);
  }
  return sample;
}

/** The publication year a TCP text header states, e.g. `<date>1598</date>`. */
export function headerYear(xml: string): number | null {
  const match = /<edition>[\s\S]{0,400}?<date>(\d{4})<\/date>/.exec(xml) ?? /<date>(\d{4})<\/date>/.exec(xml);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

/** The readable text of a TEI transcript, markup removed. */
export function bodyText(xml: string): string {
  const body = /<text>([\s\S]*)<\/text>/.exec(xml)?.[1] ?? xml;
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Which of `words` occur in a text. Word boundaries are on letters only, and case is
 * ignored, so "Back" and "back" match but "backward" does not.
 */
export function wordsPresent(body: string, words: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const token of body.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []) {
    if (words.has(token)) found.add(token);
    // Hyphen and apostrophe forms: "to-day", "would'st" should still hit "day"/"would".
    for (const piece of token.split(/['-]/)) if (piece && words.has(piece)) found.add(piece);
  }
  return [...found];
}
