/**
 * State + persistence for the curation admin app.
 *
 * Deliberately shares the file formats used by `npm run curate` (see
 * CURATION.md), so the app and the CLI are interchangeable: the same
 * data/curation-batch.json, curated/curation.json and data/skip-words.txt.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { ANSWER_YEAR_MAX, ANSWER_YEAR_MIN } from "../src/timeline";
import {
  auditCuration,
  mergeCuration,
  parseWorklist,
  selectNextBatch,
  settledSenseIds,
  wordOfSenseId,
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
  /** Batch key: the work-list sense id (`back`, or `back|Old English`). */
  sense: string;
  word: string;
  frequencyRank?: number;
  suggestedTier: number;
  chainDepth: number;
  deepestLanguage: string;
  chain: string[];
  /** Every origin the recorded chains support; more than one = homograph. */
  origins: string[];
  inWorklist: boolean;
  year: number;
  /**
   * Upper bound of the answer's span, or 0 for a precisely dated word. Undated
   * words ("recorded in Old English") are curated as a span, not a guessed year.
   */
  yearTo: number;
  tier: number;
  blurb: string;
  /** Part of speech this entry is about (required for homographs). */
  pos: string;
  /**
   * The origin the curator verified. Empty when the routes disagree and nobody
   * has chosen one yet — the card must make the curator pick, never default to
   * the tie-break (that is how `back` became a French loanword).
   */
  origin: string;
  /** Drafted but not checked against a reference by a human yet. */
  unverified: boolean;
}

export interface AdminState {
  queue: QueueItem[];
  index: number;
  curatedCount: number;
  worklistCount: number;
  skipWords: string[];
  issues: Array<{ word: string; problem: string }>;
  audit: CurationAudit;
  /** The timeline window the game can score, from src/timeline.ts. */
  yearFloor: number;
  yearCeiling: number;
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
    if (entry.yearTo !== undefined) parts.push(`"yearTo": ${entry.yearTo}`);
    if (entry.tier !== undefined) parts.push(`"tier": ${entry.tier}`);
    if (entry.blurb !== undefined) parts.push(`"blurb": ${JSON.stringify(entry.blurb)}`);
    if (entry.pos !== undefined) parts.push(`"pos": ${JSON.stringify(entry.pos)}`);
    if (entry.origin !== undefined) parts.push(`"origin": ${JSON.stringify(entry.origin)}`);
    if (entry.unverified) parts.push(`"unverified": true`);
    return `  ${JSON.stringify(word)}: { ${parts.join(", ")} }`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
}

export function writeBatch(path: string, batch: Curation): void {
  writeFileSync(path, formatCuration(batch));
}

export function writeSkipWords(path: string, words: readonly string[]): void {
  const header = "# Senses rejected during curation (dubious chain, no mappable origin, ...).\n";
  const note = "# One sense id per line (`word`, or `word|Origin`); also passed to `npm run curate -- --skip <file>`.\n";
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

/**
 * Recorded routes per word, from the work list (candidates) and the bank (already
 * accepted). The bank matters because curating a word removes it from the work
 * list, so an audit of the curation file cannot see the etymology of its own
 * entries otherwise — and the period check needs exactly that.
 */
function collectRoutes(
  worklist: readonly WorklistCandidate[],
  bankPath: string,
): Map<string, Array<{ origin: string; chain: string[] }>> {
  const routes = new Map<string, Array<{ origin: string; chain: string[] }>>();
  const add = (word: string, route: { origin: string; chain: string[] }): void => {
    const list = routes.get(word) ?? [];
    if (!list.some((existing) => existing.origin === route.origin)) list.push(route);
    routes.set(word, list);
  };
  for (const candidate of worklist) add(candidate.word, { origin: candidate.origin, chain: candidate.chain });
  const bank = readJsonFile<{
    tiers?: Array<Array<{ word?: string; originLanguage?: string; originChain?: string[] }>>;
  } | null>(bankPath, null);
  for (const entry of bank?.tiers?.flat() ?? []) {
    if (entry.word && entry.originLanguage) {
      add(entry.word, { origin: entry.originLanguage, chain: entry.originChain ?? [] });
    }
  }
  return routes;
}

/** Join the batch (what to curate) with the work list (what we know about it). */
export function buildQueue(paths: AdminPaths, index = 0): AdminState {
  const batch = readBatch(paths.batch);
  const worklist = readWorklist(paths.worklist);
  const bySense = new Map(worklist.map((candidate) => [candidate.sense, candidate]));
  const byWord = new Map(worklist.map((candidate) => [candidate.word, candidate]));
  const skipWords = readSkipWords(paths.skip);

  // The batch is keyed by WORD: the work list's other rows for the same word are
  // alternative routes to the same sense, and prompting per route asks the
  // curator the same question several times.
  const queue: QueueItem[] = Object.keys(batch).map((sense) => {
    const candidate = bySense.get(sense) ?? byWord.get(wordOfSenseId(sense));
    const entry = batch[sense]!;
    // With several recorded origins and none chosen, offer no default: the
    // curator has to pick which sense this is.
    const routeOrigin = candidate && candidate.origins.length > 1 ? "" : candidate?.origin ?? "";
    return {
      sense,
      word: candidate?.word ?? wordOfSenseId(sense),
      frequencyRank: candidate?.frequencyRank,
      suggestedTier: entry.tier ?? candidate?.tier ?? 5,
      chainDepth: candidate?.chainDepth ?? 0,
      deepestLanguage: candidate?.deepestLanguage ?? "",
      chain: candidate?.chain ?? [],
      origins: candidate?.origins ?? [],
      inWorklist: Boolean(candidate),
      year: entry.year ?? 0,
      yearTo: entry.yearTo ?? 0,
      tier: entry.tier ?? candidate?.tier ?? 5,
      blurb: entry.blurb ?? "",
      pos: entry.pos ?? "",
      origin: entry.origin ?? routeOrigin,
      unverified: Boolean(entry.unverified),
    };
  });

  const curation = readCuration(paths.curation);
  const audit = auditCuration(curation, {
    knownWords: new Set(worklist.map((candidate) => candidate.word)),
    bankWords: readBankWords(paths.bank),
    originsByWord: new Map(worklist.map((candidate) => [candidate.word, candidate.origins])),
    routesByWord: collectRoutes(worklist, paths.bank),
    yearFloor: ANSWER_YEAR_MIN,
    yearCeiling: ANSWER_YEAR_MAX,
  });

  return {
    queue,
    index: Math.max(0, Math.min(index, Math.max(0, queue.length - 1))),
    curatedCount: audit.curated,
    worklistCount: worklist.length,
    skipWords,
    issues: audit.issues,
    audit,
    yearFloor: ANSWER_YEAR_MIN,
    yearCeiling: ANSWER_YEAR_MAX,
    paths,
  };
}

/** Replace the batch with the next `limit` uncurated, non-skipped senses. */
export function pullNextBatch(paths: AdminPaths, limit: number): AdminState {
  const curation = readCuration(paths.curation);
  const batch = readBatch(paths.batch);
  const alreadyQueued = new Set(Object.keys(batch));
  const skip = new Set([...readSkipWords(paths.skip), ...alreadyQueued]);
  const candidates = readWorklist(paths.worklist);

  // Senses already in the batch keep their place: pulling "next" should not
  // discard in-progress research, so ask for the ones after them.
  const fresh = selectNextBatch(candidates, {
    settled: settledSenseIds(curation, new Map(candidates.map((candidate) => [candidate.word, candidate]))),
    skip,
    limit,
  });

  const nextBatch: Curation = {};
  for (const candidate of fresh) {
    nextBatch[candidate.word] = {
      year: 0,
      tier: candidate.tier,
      // Only a single-route word has an origin to pre-fill.
      ...(candidate.origins.length > 1 ? {} : { origin: candidate.origin }),
      blurb: "",
    };
  }
  writeBatch(paths.batch, nextBatch);
  return buildQueue(paths, 0);
}

/** Save one researched sense into the batch file. Returns the updated state. */
export function saveEntry(
  paths: AdminPaths,
  entry: {
    sense: string;
    year: number;
    /**
     * Upper bound of the answer's span for an undated word ("in use by 1150").
     * Omitted or equal to `year` means the answer is a single year.
     */
    yearTo?: number;
    tier: number;
    blurb: string;
    pos?: string;
    origin?: string;
    /** True when this year is a draft nobody has checked against a reference. */
    unverified?: boolean;
  },
  index: number,
): AdminState {
  const batch = readBatch(paths.batch);
  if (!(entry.sense in batch)) throw new Error(`"${entry.sense}" is not in the current batch`);
  const year = Math.round(entry.year);
  if (!Number.isFinite(year) || year < 0 || year > 2200) throw new Error(`year ${entry.year} is out of range`);
  // Reject a backwards span rather than narrowing it silently: the curator is
  // stating a fact about the record, and getting it inverted means the entry is
  // wrong, not that it needs tidying.
  let yearTo: number | undefined;
  if (entry.yearTo !== undefined && Number.isFinite(entry.yearTo) && entry.yearTo > 0) {
    const bound = Math.round(entry.yearTo);
    if (bound < year) throw new Error(`yearTo ${entry.yearTo} must be at or after year ${year}`);
    if (bound > year) yearTo = bound;
  }
  const tier = Math.round(entry.tier);
  if (!Number.isInteger(tier) || tier < 1 || tier > 10) throw new Error(`tier ${entry.tier} must be 1..10`);
  const pos = (entry.pos ?? "").trim().toLowerCase();
  if (pos && !/^[a-z][a-z -]{1,19}$/.test(pos)) {
    throw new Error(`pos "${entry.pos}" should be a lowercase label like "noun"`);
  }
  const existing = batch[entry.sense];
  const saved: Curation[string] = { year, tier };
  if (yearTo !== undefined) saved.yearTo = yearTo;
  if (entry.blurb.trim()) saved.blurb = entry.blurb.trim();
  if (pos) saved.pos = pos;
  // The sense's origin comes from the work list and is not the caller's to lose:
  // keep whatever is already recorded when the caller omits it.
  const origin = entry.origin?.trim() || existing?.origin;
  if (origin) saved.origin = origin;
  // Saved fresh each time, so un-ticking "unverified" clears the flag.
  if (entry.unverified) saved.unverified = true;
  batch[entry.sense] = saved;
  writeBatch(paths.batch, batch);
  return buildQueue(paths, index);
}

/** Move a sense to the skip list and drop it from the batch. */
export function skipSense(paths: AdminPaths, sense: string, index: number): AdminState {
  const skip = new Set(readSkipWords(paths.skip));
  skip.add(sense);
  writeSkipWords(paths.skip, [...skip]);
  const batch = readBatch(paths.batch);
  delete batch[sense];
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
