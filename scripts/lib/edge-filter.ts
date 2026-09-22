/**
 * Edge filtering: reduce the 4.2M-row etymology dataset to the edges a bank
 * build can actually use.
 *
 * Only edges whose SOURCE language is one we can place on the map matter: a
 * chain is walked from an English word through donor languages, and a hop can
 * only be continued (or scored) when we have geography for it. Everything else
 * is noise for this pipeline, and dropping it early keeps memory flat.
 *
 * The dropped-donor histogram is the overlay growth work list: it shows which
 * languages block the most English words.
 */

import { DONOR_RELATION_PRIORITY, type ColumnMap } from "./etymology-db";

export const MINIMAL_EDGE_HEADER = ["lang", "term", "reltype", "related_lang", "related_term"] as const;

export interface EdgeFilterOptions {
  /** Language names we can place on the map (from the generated languages.tsv). */
  allowedNames: ReadonlySet<string>;
  /** Name of the English source language, e.g. "English". */
  englishName: string;
  /** Keep only donor relations unless `allReltypes` is set. */
  allReltypes?: boolean;
}

export interface EdgeFilterStats {
  rows: number;
  kept: number;
  droppedIncomplete: number;
  droppedReltype: number;
  droppedUnknownSource: number;
  /** related_lang -> count, for English rows whose donor we cannot place. */
  blockedEnglishDonors: Map<string, number>;
}

export interface EdgeFilter {
  /** Decide whether a data row survives, updating stats as a side effect. */
  keep(cols: ColumnMap, row: string[]): boolean;
  stats: EdgeFilterStats;
}

export function createEdgeFilter(options: EdgeFilterOptions): EdgeFilter {
  const donorReltypes = new Set(Object.keys(DONOR_RELATION_PRIORITY));
  const stats: EdgeFilterStats = {
    rows: 0,
    kept: 0,
    droppedIncomplete: 0,
    droppedReltype: 0,
    droppedUnknownSource: 0,
    blockedEnglishDonors: new Map(),
  };

  return {
    stats,
    keep(cols: ColumnMap, row: string[]): boolean {
      const get = (idx: number): string => (idx >= 0 ? (row[idx] ?? "").trim() : "");
      const lang = get(cols.lang);
      const reltype = get(cols.reltype);
      const relatedLang = get(cols.relatedLang);
      const relatedTerm = get(cols.relatedTerm);
      stats.rows += 1;

      if (!lang || !relatedLang || !relatedTerm) {
        stats.droppedIncomplete += 1;
        return false;
      }
      if (!options.allReltypes && !donorReltypes.has(reltype)) {
        stats.droppedReltype += 1;
        return false;
      }
      if (lang !== options.englishName && !options.allowedNames.has(lang)) {
        // A source language we cannot place: its rows cannot continue a chain.
        stats.droppedUnknownSource += 1;
        if (lang === options.englishName) {
          const count = stats.blockedEnglishDonors.get(relatedLang) ?? 0;
          stats.blockedEnglishDonors.set(relatedLang, count + 1);
        }
        return false;
      }
      if (lang === options.englishName && !options.allowedNames.has(relatedLang)) {
        // Keep the row (its source is usable) but note the blocked donor.
        const count = stats.blockedEnglishDonors.get(relatedLang) ?? 0;
        stats.blockedEnglishDonors.set(relatedLang, count + 1);
      }
      stats.kept += 1;
      return true;
    },
  };
}

/** RFC 4180 quoting for a single field. */
export function quoteCsvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function formatCsvRow(values: readonly string[]): string {
  return `${values.map(quoteCsvField).join(",")}\n`;
}
