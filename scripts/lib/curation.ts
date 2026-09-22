/**
 * Curation loop helpers: pick the next batch of words to curate, and audit a
 * curation file before it is allowed to influence a bank build.
 *
 * "Curation" here means the hand-researched facts for one word:
 *   - year:  when ENGLISH first used it (not when the donor language had it)
 *   - tier:  optional difficulty override (1 easy .. 10 hard)
 *   - blurb: optional one-line reveal text
 *
 * Words without a year never enter the bank, so this file is the bottleneck of
 * the whole project (see CURATION.md).
 */

import { bestPossibleTemporal } from "../../src/timeline";

export interface CurationEntryInput {
  year?: number;
  tier?: number;
  blurb?: string;
}

export type Curation = Record<string, CurationEntryInput>;

/** One row of the ranked work list produced by build-bank --worklist. */
export interface WorklistCandidate {
  word: string;
  frequencyRank?: number;
  tier: number;
  chainDepth: number;
  deepestLanguage: string;
  chain: string[];
}

export function parseWorklist(text: string): WorklistCandidate[] {
  const out: WorklistCandidate[] = [];
  for (const raw of text.split("\n").slice(1)) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    const [word, freqRank, tier, chainDepth, deepestLanguage, chain] = line.split("\t");
    if (!word || !deepestLanguage) continue;
    const rank = Number.parseInt(freqRank ?? "", 10);
    out.push({
      word,
      frequencyRank: Number.isFinite(rank) ? rank : undefined,
      tier: Number.parseInt(tier ?? "", 10) || 1,
      chainDepth: Number.parseInt(chainDepth ?? "", 10) || 1,
      deepestLanguage,
      chain: (chain ?? "").split(" <- ").filter(Boolean),
    });
  }
  return out;
}

/**
 * The next words to curate, in work-list order (already most-common-first).
 * Already-curated words and anything on the skip list are excluded.
 */
export function selectNextBatch(
  candidates: readonly WorklistCandidate[],
  options: { curated: ReadonlySet<string>; skip?: ReadonlySet<string>; limit: number },
): WorklistCandidate[] {
  const skip = options.skip ?? new Set<string>();
  const batch: WorklistCandidate[] = [];
  for (const candidate of candidates) {
    if (batch.length >= options.limit) break;
    if (options.curated.has(candidate.word) || skip.has(candidate.word)) continue;
    batch.push(candidate);
  }
  return batch;
}

export interface CurationIssue {
  word: string;
  problem: string;
}

export interface CurationAudit {
  issues: CurationIssue[];
  entries: number;
  curated: number;
  /** Curated words whose answer year the shipped UI cannot even express. */
  unplayableOnSlider: string[];
}

/**
 * Audit a curation file. `knownWords` is every word the pipeline can currently
 * bank (the work list); `yearFloor/yearCeiling` is the range the timeline
 * slider can express — src/timeline.ts holds that window for the client, this
 * CLI and the admin app alike, so the tooling cannot drift from the game.
 */

/**
 * Audit a curation file. `knownWords` is every word the pipeline can currently
 * bank (the work list); `yearFloor/yearCeiling` is the range the timeline
 * slider can express — a year outside it makes a round unwinnable, which
 * already happened to three words in the shipped seed bank.
 */
export function auditCuration(
  curation: Curation,
  options: {
    /** Words from the uncurated work list. */
    knownWords: ReadonlySet<string>;
    /** Words already accepted into a bank (curated ones with a chain). */
    bankWords?: ReadonlySet<string>;
    yearFloor: number;
    yearCeiling: number;
  },
): CurationAudit {
  const issues: CurationIssue[] = [];
  const unplayableOnSlider: string[] = [];
  let curated = 0;

  for (const [word, entry] of Object.entries(curation)) {
    if (!word.trim()) {
      issues.push({ word, problem: "empty word key" });
      continue;
    }
    if (word !== word.toLowerCase()) {
      issues.push({ word, problem: "keys are lowercase words; the builder looks words up verbatim" });
    }
    // The work list holds UNCURATED candidates, so already-curated words are
    // only "known" through the bank they were accepted into. A word in neither
    // has no mappable chain at all (or is a typo).
    if (!options.knownWords.has(word) && !options.bankWords?.has(word)) {
      issues.push({ word, problem: "no mappable chain in the current data (typo, or the word is not a candidate)" });
    }
    if (entry.year === undefined || !Number.isFinite(entry.year)) {
      issues.push({ word, problem: "missing year (required for the word to enter the bank)" });
      continue;
    }
    curated += 1;
    if (entry.year < options.yearFloor || entry.year > options.yearCeiling) {
      issues.push({
        word,
        problem:
          `year ${entry.year} is outside the slider range ${options.yearFloor}..${options.yearCeiling}: ` +
          `best possible temporal score ~${bestPossibleTemporal(entry.year, options.yearFloor, options.yearCeiling)}/100`,
      });
      unplayableOnSlider.push(word);
    }
    if (entry.tier !== undefined && (!Number.isInteger(entry.tier) || entry.tier < 1 || entry.tier > 10)) {
      issues.push({ word, problem: `tier ${entry.tier} must be an integer 1..10` });
    }
    if (entry.blurb !== undefined && entry.blurb.trim() === "") {
      issues.push({ word, problem: "blurb is present but empty (omit the field instead)" });
    }
  }

  return {
    issues,
    entries: Object.keys(curation).length,
    curated,
    unplayableOnSlider: unplayableOnSlider.sort(),
  };
}

/** Merge filled-in batch entries into a curation file, reporting what happened. */
export function mergeCuration(
  curation: Curation,
  batch: Curation,
): { merged: Curation; added: string[]; skipped: string[] } {
  const merged: Curation = { ...curation };
  const added: string[] = [];
  const skipped: string[] = [];
  for (const [word, entry] of Object.entries(batch)) {
    // A batch skeleton ships with `year: 0` for "not researched yet".
    if (entry.year === undefined || !Number.isFinite(entry.year) || entry.year <= 0) {
      skipped.push(word);
      continue;
    }
    if (merged[word]) {
      skipped.push(word);
      continue;
    }
    const cleaned: CurationEntryInput = { year: Math.round(entry.year) };
    if (entry.tier !== undefined) cleaned.tier = entry.tier;
    if (entry.blurb?.trim()) cleaned.blurb = entry.blurb.trim();
    merged[word] = cleaned;
    added.push(word);
  }
  return { merged, added: added.sort(), skipped: skipped.sort() };
}
