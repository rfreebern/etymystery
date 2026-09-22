/**
 * Reference sources for the curation admin app.
 *
 * `framable` was measured, not assumed: send a request and look for
 * `X-Frame-Options` / CSP `frame-ancestors`. Sites that block framing still
 * appear, as link-out cards, because two of them (Merriam-Webster, HathiTrust)
 * are genuinely useful for dating a word.
 *
 * No server-side fetching of these sites: embedding is normal browser
 * behaviour, scraping is not (see LICENSES.md on Etymonline's ToS).
 */

export interface ReferenceSource {
  id: string;
  label: string;
  /** Build the URL to load for a word. */
  url: (word: string) => string;
  /** true when the site sends no X-Frame-Options / frame-ancestors directive. */
  framable: boolean;
  /** What this source is good for, shown in the UI. */
  purpose: string;
  /** Why it cannot be embedded. */
  blockedReason?: string;
}

const wiki = (word: string): string =>
  `https://en.wiktionary.org/wiki/${encodeURIComponent(word).replace(/%20/g, "_")}`;

export const REFERENCE_SOURCES: readonly ReferenceSource[] = [
  {
    id: "etymonline",
    label: "Etymonline",
    url: (word) => `https://www.etymonline.com/word/${encodeURIComponent(word)}`,
    framable: true,
    purpose: "the year reference: dated etymology prose",
  },
  {
    id: "wiktionary",
    label: "Wiktionary",
    url: wiki,
    framable: true,
    purpose: "the underlying data: etymology section, citations",
  },
  {
    id: "ngram",
    label: "Google Ngrams",
    url: (word) =>
      `https://books.google.com/ngrams/interactive_chart?content=${encodeURIComponent(word)}` +
      `&year_start=1400&year_end=2022&corpus=en&smoothing=0`,
    framable: true,
    purpose: "print-attestation onset: a sanity check on the year",
  },
  {
    id: "wikitext",
    label: "Wiktionary wikitext",
    url: (word) =>
      `https://en.wiktionary.org/w/index.php?title=${encodeURIComponent(word).replace(/%20/g, "_")}&action=raw`,
    framable: true,
    purpose: "the raw entry: date templates the parse may have missed",
  },
  {
    id: "free-dictionary",
    label: "The Free Dictionary",
    url: (word) => `https://www.thefreedictionary.com/${encodeURIComponent(word)}`,
    framable: true,
    purpose: "aggregated dictionary + etymology sections",
  },
  {
    id: "archive-org",
    label: "archive.org search",
    url: (word) => `https://archive.org/search?query=${encodeURIComponent(word)}&sin=TXT`,
    framable: true,
    purpose: "scanned books: find an actual dated use",
  },
  {
    id: "bing",
    label: "Bing (etymology)",
    url: (word) => `https://www.bing.com/search?q=${encodeURIComponent(`${word} etymology first known use`)}`,
    framable: true,
    purpose: "catch-all when the sources above disagree",
  },
  {
    id: "merriam-webster",
    label: "Merriam-Webster",
    url: (word) => `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`,
    framable: false,
    blockedReason: "X-Frame-Options: SAMEORIGIN",
    purpose: "'First Known Use' — a second date to cross-check",
  },
  {
    id: "hathitrust",
    label: "HathiTrust full text",
    url: (word) =>
      `https://babel.hathitrust.org/cgi/ls?q1=${encodeURIComponent(word)};a=srchls;anyall1=all;lmt=ft`,
    framable: false,
    blockedReason: "X-Frame-Options: SAMEORIGIN",
    purpose: "dated full-text search in digitised books",
  },
  {
    id: "oed",
    label: "OED (paywalled)",
    url: (word) => `https://www.oed.com/search/dictionary/?scope=Entries&q=${encodeURIComponent(word)}`,
    framable: false,
    blockedReason: "not embeddable",
    purpose: "authoritative dated citations, if you have access",
  },
];

export function sourcesFor(word: string): Array<ReferenceSource & { href: string }> {
  return REFERENCE_SOURCES.map((source) => ({ ...source, href: source.url(word) }));
}
