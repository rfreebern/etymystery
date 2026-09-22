/**
 * Word-frequency ranks, used to rank the curation work list and to feed the
 * tier heuristic (see lib/tiering.ts).
 *
 * Sources are plain text, one entry per line, in either of these shapes:
 *
 *   word<TAB>count        (wordfreq-style exports)
 *   word count            (e.g. hermitdave/FrequencyWords, CC BY-SA 4.0,
 *                          derived from OpenSubtitles 2018)
 *   word                  (bare lists: file order is the ranking)
 *
 * Ranks are 1-based and follow count order, so rank 1 is the most common word.
 * Ranks are what the tier heuristic consumes; the counts themselves are not
 * needed downstream.
 */

export interface FrequencyList {
  /** 1-based rank of a normalized word, or undefined when it is not listed. */
  rankOf(word: string): number | undefined;
  size: number;
}

export interface ParsedFrequencyList extends FrequencyList {
  /** Highest (worst) rank assigned, = size. */
  maxRank: number;
}

/** Normalize a word for lookup: lowercase, trimmed. */
export function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

export function parseFrequencyList(text: string): ParsedFrequencyList {
  const rows: Array<{ word: string; count: number; order: number }> = [];
  let order = 0;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    // Split on the last run of whitespace so words containing spaces survive.
    const match = /^(.+?)[\t ]+(\d+)$/.exec(line);
    if (match) {
      rows.push({ word: normalizeWord(match[1]!), count: Number.parseInt(match[2]!, 10), order: order++ });
    } else {
      rows.push({ word: normalizeWord(line), count: 0, order: order++ });
    }
  }

  // Counts descending; bare lists keep file order. Ties resolve by first
  // appearance so the ranking is deterministic for a given input.
  const sorted = [...rows].sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.order - b.order;
  });

  const ranks = new Map<string, number>();
  let rank = 0;
  for (const row of sorted) {
    if (!row.word) continue;
    rank += 1;
    if (!ranks.has(row.word)) ranks.set(row.word, rank);
  }

  return {
    size: ranks.size,
    maxRank: ranks.size,
    rankOf: (word) => ranks.get(normalizeWord(word)),
  };
}
