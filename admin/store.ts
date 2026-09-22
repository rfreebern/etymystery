/**
 * State + persistence for the curation admin app.
 *
 * Deliberately shares the file formats used by `npm run curate` (see
 * CURATION.md), so the app and the CLI are interchangeable: the same
 * data/curation-batch.json, curated/curation.json and data/skip-words.txt.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  auditCuration,
  mergeCuration,
  parseWorklist,
  selectNextBatch,
  type Curation,
  type CurationAudit,
  type WorklistCandidate,
} from "../scripts/lib/curation";

export interface AdminPaths {
  worklist: string;
  curation: string;
  batch: string;
  skip: string;
  bank: string;
}

export const DEFAULT_PATHS: AdminPaths = {
  worklist: "data/curation-worklist-interesting.tsv",
  curation: "curated/curation.json",
  batch: "data/curation-batch.json",
  skip: "data/skip-words.txt",
  bank: "data/word-bank.json",
};

/** One row of the left-hand panel. */
export interface QueueItem {
  word: string;
  frequencyRank?: number;
  suggestedTier: number;
  chainDepth: number;
  deepestLanguage: string;
  chain: string[];
  inWorklist: boolean;
  year: number;
  tier: number;
  blurb: string;
}

export interface AdminState {
  queue: QueueItem[];
  index: number;
  curatedCount: number;
  worklistCount: number;
  skipWords: string[];
  issues: Array<{ word: string; problem: string }>;
  audit: CurationAudit;
  paths: AdminPaths;
}

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function readCuration(path: string): Curation {
  return readJsonFile<Curation>(path, {});
}

export function readBatch(path: string): Curation {
  return readJsonFile<Curation>(path, {});
}

export function readSkipWords(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.replace(/\r$/, "").trim())
    .filter((line) => line && !line.startsWith("#"));
}

/** The format the CLI writes: one word per line, `{ "year": ..., "tier": ... }`. */
export function formatCuration(curation: Curation): string {
  const words = Object.keys(curation).sort();
  const lines = words.map((word) => {
    const entry = curation[word]!;
    const parts: string[] = [];
    if (entry.year !== undefined) parts.push(`"year": ${entry.year}`);
    if (entry.tier !== undefined) parts.push(`"tier": ${entry.tier}`);
    if (entry.blurb !== undefined) parts.push(`"blurb": ${JSON.stringify(entry.blurb)}`);
    return `  ${JSON.stringify(word)}: { ${parts.join(", ")} }`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
}

export function writeBatch(path: string, batch: Curation): void {
  writeFileSync(path, formatCuration(batch));
}

export function writeSkipWords(path: string, words: readonly string[]): void {
  const header = "# Words rejected during curation (dubious chain, no mappable origin, ...).\n";
  const note = "# One word per line; also passed to `npm run curate -- --skip <file>`.\n";
  writeFileSync(path, `${header}${note}${[...words].sort().join("\n")}\n`);
}

export function readWorklist(path: string): WorklistCandidate[] {
  if (!existsSync(path)) return [];
  return parseWorklist(readFileSync(path, "utf8"));
}

function readBankWords(path: string): Set<string> {
  const bank = readJsonFile<{ tiers?: Array<Array<{ word?: string }>> } | null>(path, null);
  if (!bank?.tiers) return new Set();
  return new Set(bank.tiers.flat().map((entry) => entry.word ?? "").filter(Boolean));
}

/** Join the batch (what to curate) with the work list (what we know about it). */
export function buildQueue(paths: AdminPaths, index = 0): AdminState {
  const batch = readBatch(paths.batch);
  const worklist = readWorklist(paths.worklist);
  const byWord = new Map(worklist.map((candidate) => [candidate.word, candidate]));
  const skipWords = readSkipWords(paths.skip);

  const queue: QueueItem[] = Object.keys(batch).map((word) => {
    const candidate = byWord.get(word);
    const entry = batch[word]!;
    return {
      word,
      frequencyRank: candidate?.frequencyRank,
      suggestedTier: entry.tier ?? candidate?.tier ?? 5,
      chainDepth: candidate?.chainDepth ?? 0,
      deepestLanguage: candidate?.deepestLanguage ?? "",
      chain: candidate?.chain ?? [],
      inWorklist: Boolean(candidate),
      year: entry.year ?? 0,
      tier: entry.tier ?? candidate?.tier ?? 5,
      blurb: entry.blurb ?? "",
    };
  });

  const curation = readCuration(paths.curation);
  const audit = auditCuration(curation, {
    knownWords: new Set(worklist.map((candidate) => candidate.word)),
    bankWords: readBankWords(paths.bank),
    yearFloor: 1500,
    yearCeiling: 2025,
  });

  return {
    queue,
    index: Math.max(0, Math.min(index, Math.max(0, queue.length - 1))),
    curatedCount: audit.curated,
    worklistCount: worklist.length,
    skipWords,
    issues: audit.issues,
    audit,
    paths,
  };
}

/** Replace the batch with the next `limit` uncurated, non-skipped words. */
export function pullNextBatch(paths: AdminPaths, limit: number): AdminState {
  const curation = readCuration(paths.curation);
  const batch = readBatch(paths.batch);
  const alreadyQueued = new Set(Object.keys(batch));
  const skip = new Set([...readSkipWords(paths.skip), ...alreadyQueued]);
  const candidates = readWorklist(paths.worklist);

  // Words already in the batch keep their place: pulling "next" should not
  // discard in-progress research, so ask for the next ones after them.
  const fresh = selectNextBatch(candidates, {
    curated: new Set(Object.keys(curation)),
    skip,
    limit,
  });

  const nextBatch: Curation = {};
  for (const candidate of fresh) nextBatch[candidate.word] = { year: 0, tier: candidate.tier, blurb: "" };
  writeBatch(paths.batch, nextBatch);
  return buildQueue(paths, 0);
}

/** Save one researched word into the batch file. Returns the updated state. */
export function saveEntry(
  paths: AdminPaths,
  entry: { word: string; year: number; tier: number; blurb: string },
  index: number,
): AdminState {
  const batch = readBatch(paths.batch);
  if (!(entry.word in batch)) throw new Error(`"${entry.word}" is not in the current batch`);
  const year = Math.round(entry.year);
  if (!Number.isFinite(year) || year < 0 || year > 2200) throw new Error(`year ${entry.year} is out of range`);
  const tier = Math.round(entry.tier);
  if (!Number.isInteger(tier) || tier < 1 || tier > 10) throw new Error(`tier ${entry.tier} must be 1..10`);
  const saved: Curation[string] = { year, tier };
  if (entry.blurb.trim()) saved.blurb = entry.blurb.trim();
  batch[entry.word] = saved;
  writeBatch(paths.batch, batch);
  return buildQueue(paths, index);
}

/** Move a word to the skip list and drop it from the batch. */
export function skipWord(paths: AdminPaths, word: string, index: number): AdminState {
  const skip = new Set(readSkipWords(paths.skip));
  skip.add(word);
  writeSkipWords(paths.skip, [...skip]);
  const batch = readBatch(paths.batch);
  delete batch[word];
  writeBatch(paths.batch, batch);
  return buildQueue(paths, index);
}

/** Fold the researched batch into curated/curation.json, keeping a backup. */
export function mergeBatch(
  paths: AdminPaths,
): { state: AdminState; added: string[]; skipped: string[]; backup: string | null } {
  const curation = readCuration(paths.curation);
  const batch = readBatch(paths.batch);
  const { merged, added, skipped } = mergeCuration(curation, batch);

  let backup: string | null = null;
  if (existsSync(paths.curation) && added.length > 0) {
    backup = `${paths.curation}.bak`;
    copyFileSync(paths.curation, backup);
    writeFileSync(paths.curation, formatCuration(merged));
  }
  return { state: buildQueue(paths, 0), added, skipped, backup };
}
