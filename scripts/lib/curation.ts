/**
 * Curation loop helpers: pick the next batch of words to curate, and audit a
 * curation file before it is allowed to influence a bank build.
 *
 * "Curation" here means the hand-researched facts for one word:
 *   - year:  when ENGLISH first used it (not when the donor language had it)
 *   - yearTo: the upper bound, when the record only bounds the first use
 *   - tier:  optional difficulty override (1 easy .. 10 hard)
 *   - blurb: optional one-line reveal text
 *
 * Words without a year never enter the bank, so this file is the bottleneck of
 * the whole project (see CURATION.md).
 */

import { answerSpan } from "../../src/scoring";
import { bestPossibleTemporal, earliestEnglishEra, periodOfSpan } from "../../src/timeline";

export interface CurationEntryInput {
  year?: number;
  /**
   * Upper bound of the answer's span, for words no source dates precisely.
   * "Recorded in Old English" is only "in use by 1150": set `year` to the earliest
   * year the record allows (the timeline floor for anything inherited) and
   * `yearTo` to that bound. Never invent a point for a coarse date: a fabricated
   * year makes the player's score depend on the curator's coin flip.
   */
  yearTo?: number;
  /**
   * Why the entry has a span rather than a looked-up date. `"chain-period"` means it
   * was taken from the period the word's own recorded chain names: `give` was in
   * English by Old English, so the answer IS the Old English period. There is
   * nothing a reference could narrow, so these need no reference check at all — and
   * inventing a year for them would make the player's score depend on a coin flip.
   */
  yearSource?: "chain-period";
  tier?: number;
  blurb?: string;
  /**
   * Part of speech the puzzle is about. Required in practice for homographs —
   * a word whose recorded origins disagree (see `origin`).
   */
  pos?: string;
  /**
   * The origin the curator verified, as a language name from the work list's
   * `origins` column. Required for a word with several recorded origins: it
   * selects which sense this entry is.
   */
  origin?: string;
  /**
   * Set when the year was NOT checked by a human against a reference (e.g. it was
   * drafted by a model). Such entries are counted in the build report and listed
   * by `curate --mode check`, so a shipped bank can always say how much of itself
   * is unverified.
   */
  unverified?: boolean;
  /**
   * The curation key this entry should be filed under, when it differs from the
   * key it was queued under. Set by the tools; ignored on read.
   */
  key?: string;
}

/**
 * A puzzle entry is a *sense*, not a word: `back` the noun is inherited from Old
 * English while another sense came via French, and `sole` has four recorded
 * origins. So the curation key and the bank id are sense keys:
 *
 *   word            one recorded origin, no part of speech recorded yet
 *   word:pos        this sense's part of speech, e.g. `back:noun`
 *   word:pos:2      a further sense of the same part of speech (`bank:noun:2`)
 */
export interface SenseKey {
  word: string;
  pos?: string;
  ordinal?: number;
}

export function parseSenseKey(key: string): SenseKey | null {
  const parts = key.split(":");
  if (parts.length > 3) return null;
  const [word, pos, ordinal] = parts;
  if (!word || !/^[a-z][a-z' -]{1,40}$/.test(word)) return null;
  if (pos !== undefined && !/^[a-z][a-z -]{1,19}$/.test(pos)) return null;
  if (ordinal !== undefined && !/^[2-9][0-9]?$/.test(ordinal)) return null;
  return {
    word,
    ...(pos ? { pos } : {}),
    ...(ordinal ? { ordinal: Number(ordinal) } : {}),
  };
}

export function composeSenseKey(word: string, pos?: string, ordinal?: number): string {
  if (!pos) return word;
  return ordinal && ordinal > 1 ? `${word}:${pos}:${ordinal}` : `${word}:${pos}`;
}

/** The candidate id of a sense in the work list: `word`, or `word|origin`. */
export function senseId(word: string, origin: string | undefined, originCount: number): string {
  return originCount > 1 && origin ? `${word}|${origin}` : word;
}

/** The word part of a work-list sense id (`back|Old English` -> `back`). */
export function wordOfSenseId(id: string): string {
  return id.split("|")[0] ?? id;
}

/**
 * Which words a curation file has already settled. Work-list rows are one per
 * recorded route, but the routes are usually *alternatives for the same sense*
 * (`sugar` has five: Arabic, Middle French, Middle Persian, Old French,
 * Sanskrit) rather than different puzzles. So curating a word settles the word:
 * a curator who wants a second sense adds a second key deliberately
 * (`word:pos:2`), which is what the ordinals are for.
 */
export function settledSenseIds(
  curation: Curation,
  _candidatesByWord?: ReadonlyMap<string, { origins: string[]; deepestLanguage: string }>,
): Set<string> {
  const settled = new Set<string>();
  for (const key of Object.keys(curation)) {
    const parsed = parseSenseKey(key);
    if (!parsed) continue;
    settled.add(parsed.word);
  }
  return settled;
}

export type Curation = Record<string, CurationEntryInput>;

/** One row of the ranked work list produced by build-bank --worklist. */
export interface WorklistCandidate {
  word: string;
  /** This row's answer origin (each row is one sense of the word). */
  origin: string;
  /** Work-list sense id: `word`, or `word|origin` when the word has several. */
  sense: string;
  frequencyRank?: number;
  tier: number;
  chainDepth: number;
  deepestLanguage: string;
  chain: string[];
  /**
   * Every origin this word's recorded chains support; more than one means the
   * word is a homograph and each origin is its own puzzle entry.
   */
  origins: string[];
}

/**
 * Parse a work list. Header-driven so it reads both the sense-scoped rows
 * written today and the older one-row-per-word files.
 */
export function parseWorklist(text: string): WorklistCandidate[] {
  const lines = text.split("\n");
  const header = (lines[0] ?? "").replace(/\r$/, "").split("\t").map((name) => name.trim());
  const at = (name: string): number => header.indexOf(name);
  const wordIdx = at("word");
  if (wordIdx < 0) return [];
  const idx = {
    origin: at("origin"),
    sense: at("sense"),
    freq: at("freq_rank"),
    tier: at("tier"),
    depth: at("chain_depth"),
    deepest: at("deepest_language"),
    chain: at("chain"),
    origins: at("origins"),
  };

  const out: WorklistCandidate[] = [];
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const get = (i: number): string => (i >= 0 ? (cols[i] ?? "").trim() : "");
    const word = get(wordIdx);
    if (!word) continue;
    const deepestLanguage = get(idx.deepest) || get(idx.origin);
    if (!deepestLanguage) continue;
    const origins = get(idx.origins).split("|").filter(Boolean).sort();
    const origin = get(idx.origin) || deepestLanguage;
    const rank = Number.parseInt(get(idx.freq), 10);
    out.push({
      word,
      origin,
      sense: get(idx.sense) || senseId(word, origin, origins.length || 1),
      frequencyRank: Number.isFinite(rank) ? rank : undefined,
      tier: Number.parseInt(get(idx.tier), 10) || 1,
      chainDepth: Number.parseInt(get(idx.depth), 10) || 1,
      deepestLanguage,
      chain: get(idx.chain).split(" <- ").filter(Boolean),
      origins,
    });
  }
  return out;
}

/**
 * The next senses to curate, in work-list order (already most-common-first).
 * `settled` holds the sense ids the curation file already covers, so finishing
 * the noun of a homograph leaves its verb in the queue.
 */
/**
 * The curation file format, shared by the CLI and the admin app.
 *
 * It lives here, in one place, because it was duplicated before and one copy silently
 * lost a field: the CLI's writer omitted `yearTo`, so every coarse span became a
 * fabricated point the moment it was merged. A format needs one writer, and the
 * round-trip test in tests/curation.test.ts is what keeps it honest.
 */
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
    if (entry.yearSource) parts.push(`"yearSource": ${JSON.stringify(entry.yearSource)}`);
    return `  ${JSON.stringify(word)}: { ${parts.join(", ")} }`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
}

/**
 * Draft entries for words no source can date: when a word's recorded chain names an
 * English stage, it was already in English by then, so its answer's span IS that
 * period — 700-1150 for Old English, 1151-1500 for Middle English. One word in six
 * of the ranked list is this shape, which is why hand-dating them was the bottleneck.
 *
 * These entries carry `yearSource: "chain-period"`: the span is not a lookup, it is
 * the chain's own claim, so there is nothing a reference could confirm.
 *
 * Only single-route words are drafted. A word with several recorded routes needs a
 * human to say which sense it is FIRST (the routes often imply different periods:
 * `give` is 700-1150 as the native word and 1151-1500 as the Old Norse borrowing),
 * and that decision must never be made on the curator's behalf.
 */
export function derivePeriodEntries(
  candidates: readonly WorklistCandidate[],
  options: { settled?: ReadonlySet<string>; skip?: ReadonlySet<string>; limit?: number },
): { entries: Curation; derived: number; needsSense: number; noPeriod: number } {
  const settled = options.settled ?? new Set<string>();
  const skip = options.skip ?? new Set<string>();
  const entries: Curation = {};
  const seen = new Set<string>();
  let derived = 0;
  let needsSense = 0;
  let noPeriod = 0;
  for (const candidate of candidates) {
    if (options.limit !== undefined && derived >= options.limit) break;
    if (seen.has(candidate.word)) continue; // one card per word, as everywhere else
    if (settled.has(candidate.word) || skip.has(candidate.word)) continue;
    seen.add(candidate.word);
    // A homograph is decided FIRST: its routes are different words, so the period one
    // of them implies does not apply to the sense the curator will pick. Deriving
    // before asking would pin a span to a sense nobody chose.
    if (candidate.origins.length > 1) {
      needsSense += 1;
      continue;
    }
    const era = earliestEnglishEra(candidate.chain);
    if (!era) {
      noPeriod += 1; // borrowed with no English stage recorded: needs a reference
      continue;
    }
    entries[candidate.word] = {
      year: era.from,
      yearTo: era.to,
      tier: candidate.tier,
      ...(candidate.origin ? { origin: candidate.origin } : {}),
      yearSource: "chain-period",
      blurb: "",
    };
    derived += 1;
  }
  return { entries, derived, needsSense, noPeriod };
}

export function selectNextBatch(
  candidates: readonly WorklistCandidate[],
  options: { settled?: ReadonlySet<string>; skip?: ReadonlySet<string>; limit: number },
): WorklistCandidate[] {
  const skip = options.skip ?? new Set<string>();
  const settled = options.settled ?? new Set<string>();
  const batch: WorklistCandidate[] = [];
  const seenWords = new Set<string>();
  for (const candidate of candidates) {
    if (batch.length >= options.limit) break;
    if (settled.has(candidate.sense) || settled.has(candidate.word)) continue;
    if (skip.has(candidate.sense) || skip.has(candidate.word)) continue;
    // One row per word: its other origins are alternatives to choose between,
    // not further prompts (the row carries the whole `origins` list).
    if (seenWords.has(candidate.word)) continue;
    seenWords.add(candidate.word);
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
    /** word -> every origin its recorded chains support (homograph detection). */
    originsByWord?: ReadonlyMap<string, string[]>;
    /**
     * word -> the routes its recorded chains support, each with its chain. A chain
     * that names an English stage bounds the entry year: the word was already in
     * English by then, so a later year contradicts the etymology the entry was
     * curated for. The entry's own `origin` picks which route applies.
     */
    routesByWord?: ReadonlyMap<string, ReadonlyArray<{ origin: string; chain: readonly string[] }>>;
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
      issues.push({ word, problem: "sense keys are lowercase; the builder looks them up verbatim" });
    }
    const sense = parseSenseKey(word);
    if (!sense) {
      issues.push({
        word,
        problem:
          "key must be a sense key: `word`, `word:pos`, or `word:pos:2` for a second sense of that part of speech",
      });
      continue;
    }
    // The work list holds UNCURATED candidates, so already-curated words are
    // only "known" through the bank they were accepted into. A word in neither
    // has no mappable chain at all (or is a typo).
    if (!options.knownWords.has(sense.word) && !options.bankWords?.has(sense.word)) {
      issues.push({
        word,
        problem: "no mappable chain in the current data (typo, or the word is not a candidate)",
      });
    }
    if (entry.year === undefined || !Number.isFinite(entry.year)) {
      issues.push({ word, problem: "missing year (required for the word to enter the bank)" });
      continue;
    }
    curated += 1;
    if (entry.yearTo !== undefined && (!Number.isFinite(entry.yearTo) || entry.yearTo < entry.year)) {
      issues.push({
        word,
        problem: `yearTo ${entry.yearTo} must be at or after year ${entry.year} (it is the upper bound)`,
      });
    } else if (entry.yearTo !== undefined && entry.yearTo > options.yearCeiling) {
      // Playable (the span covers `year`) but nonsense data: nothing can be first
      // used after the timeline ends.
      issues.push({
        word,
        problem: `yearTo ${entry.yearTo} is past the end of the timeline (${options.yearCeiling})`,
      });
    }
    // A chain that names an English stage claims the word was already in English by
    // then, so a later year contradicts the etymology the entry was curated for.
    // This is the one dating check that needs no reference: the claim refutes
    // itself. It matches the entry's own route, because a homograph's other routes
    // are different senses (`back` the French loan may be late; the native word
    // cannot).
    const routes = options.routesByWord?.get(sense.word) ?? [];
    const chosen =
      entry.origin !== undefined
        ? routes.find(
            (route) => route.origin === entry.origin || route.chain.includes(entry.origin as string),
          )
        : routes.length === 1
          ? routes[0]
          : undefined;
    const era = chosen ? earliestEnglishEra(chosen.chain) : null;
    const spanEnd = entry.yearTo ?? entry.year;
    if (era && spanEnd > era.to) {
      issues.push({
        word,
        problem:
          `year ${entry.year}${entry.yearTo !== undefined ? `..${entry.yearTo}` : ""} is after the ` +
          `${era.label} period its own chain records (ends ${era.to}): the chain says the word ` +
          `was already in English by then, so the year or the chain is wrong`,
      });
    }
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
    if (entry.pos !== undefined && !/^[a-z][a-z -]{1,19}$/.test(entry.pos)) {
      issues.push({ word, problem: `pos "${entry.pos}" should be a lowercase label like "noun"` });
    }
    const origins = options.originsByWord?.get(sense.word) ?? [];
    if (origins.length > 1) {
      // Different senses of a homograph really do come from different places
      // (`back`: Old English vs French), so each sense is its own entry and has
      // to name the one it is about.
      if (!entry.pos) {
        issues.push({
          word,
          problem: `has ${origins.length} recorded origins (${origins.join(", ")}); give the entry a part of speech (\`${sense.word}:pos\`) and the "origin" it is about`,
        });
      } else if (!entry.origin) {
        issues.push({
          word,
          problem: `pos is set but no "origin"; the recorded origins are ${origins.join(", ")}`,
        });
      } else if (!origins.includes(entry.origin)) {
        issues.push({ word, problem: `origin "${entry.origin}" is not one of ${origins.join(", ")}` });
      }
    } else if (entry.origin && origins.length === 1 && entry.origin !== origins[0]) {
      issues.push({ word, problem: `origin "${entry.origin}" does not match the recorded origin ${origins[0]}` });
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
  for (const [batchKey, entry] of Object.entries(batch)) {
    // A batch skeleton ships with `year: 0` for "not researched yet".
    if (entry.year === undefined || !Number.isFinite(entry.year) || entry.year <= 0) {
      skipped.push(batchKey);
      continue;
    }
    // The batch is keyed by work-list sense id (`back|Old English`); the curated
    // entry is filed under a sense key the curator composed (`back:noun`).
    const word = wordOfSenseId(batchKey);
    const pos = entry.pos?.trim() || undefined;
    let key = entry.key?.trim() || composeSenseKey(word, pos);
    if (merged[key]) {
      // Already curated under that sense key. If this is a *different* origin it
      // is another sense of the same part of speech, so file it as `word:pos:2`.
      const existing = merged[key]!;
      const differentSense = Boolean(entry.origin && existing.origin && entry.origin !== existing.origin);
      if (!differentSense || !pos) {
        skipped.push(batchKey);
        continue;
      }
      let ordinal = 2;
      while (ordinal <= 99 && merged[composeSenseKey(word, pos, ordinal)]) ordinal += 1;
      if (ordinal > 99) {
        skipped.push(batchKey);
        continue;
      }
      key = composeSenseKey(word, pos, ordinal);
    }
    const cleaned: CurationEntryInput = { year: Math.round(entry.year) };
    // A span only means something wider than a point; `yearTo == year` is just a
    // year, and a backwards pair is a data error the audit reports.
    if (entry.yearTo !== undefined && Math.round(entry.yearTo) > cleaned.year!) {
      cleaned.yearTo = Math.round(entry.yearTo);
    }
    // The provenance only travels with a span that really is a period's own bounds,
    // so the flag can never claim more than the data says.
    // The provenance only travels with a span that really is a period's own bounds,
    // so the flag can never claim more than the data says.
    if (entry.yearSource === "chain-period" && periodOfSpan(answerSpan({ year: cleaned.year!, yearTo: cleaned.yearTo }))) {
      cleaned.yearSource = "chain-period";
    }
    if (entry.tier !== undefined) cleaned.tier = entry.tier;
    if (entry.blurb?.trim()) cleaned.blurb = entry.blurb.trim();
    if (pos) cleaned.pos = pos;
    if (entry.origin?.trim()) cleaned.origin = entry.origin.trim();
    // Provenance travels with the entry: a drafted year stays marked until a
    // human clears the flag, so the shipped bank can always state how much of
    // itself nobody has checked against a reference.
    if (entry.unverified) cleaned.unverified = true;
    merged[key] = cleaned;
    added.push(key);
  }
  return { merged, added: added.sort(), skipped: skipped.sort() };
}
