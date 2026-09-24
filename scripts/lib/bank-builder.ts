/**
 * Pipeline orchestrator: etymology-db edges + language metadata TSV + curated
 * year/tier/blurb overrides -> validated WordBank + build report.
 *
 * Curation is a first-class input: only words with a curated attestation year
 * enter the bank (years are facts curated by hand — see PROGRESS/README).
 */

import { buildWordBank, validateEntry } from "../../src/bank";
import { answerSpan } from "../../src/scoring";
import { periodOfSpan } from "../../src/timeline";
import type { BankEntry, LanguageInfo, WordBank } from "../../src/types";
import { DONOR_RELATION_PRIORITY, buildChainsWithVariants, extractEdges, type ChainVariant, type EtymEdge, type OriginChain } from "./etymology-db";
import type { CurationEntryInput } from "./curation";
import { parseSenseKey, senseId } from "./curation";
import type { FrequencyList } from "./frequency";
import { parseLanguageTsv } from "./languages";
import { assignTier } from "./tiering";

/** A curated entry as the bank builder consumes it: a year is required. */
export type CurationEntry = CurationEntryInput & { year: number };

export interface BuildBankOptions {
  edgesText: string;
  /**
   * Extra donor edges to merge in before walking, same CSV schema as `edgesText`.
   *
   * The source is a faithful parse of Wiktionary, not a checked dataset: it
   * sometimes skips a real, locatable language entirely. `coyote` is the example
   * that surfaced the need — Wiktionary records English borrowed it from Spanish
   * and Spanish derived it from the *reconstruction* Proto-Nahuan, so Nahuatl (the
   * answer a player would give) was unreachable, and the puzzle anchored to Spain.
   * A curator-supplied edge restores the missing hop.
   */
  overrideEdgesText?: string;
  languagesText: string;
  curation: Record<string, CurationEntry>;
  version: number;
  epochStartDay: number;
  englishLangCode?: string;
  maxChainDepth?: number;
  /** Called for every candidate sense that needs a curated year. */
  onUncurated?: (candidate: UncuratedCandidate) => void;
  /**
   * Word-frequency ranks. When supplied they feed the tier heuristic and are
   * attached to each work-list candidate, so curation can start with the words
   * players actually know.
   */
  frequency?: FrequencyList;
  /**
   * Answer origins to skip. Excluding `en,ang,enm` ("the word came from
   * England") removes the words whose answer is the same place as the asker,
   * which are unguessable-looking but trivially won by always pinning Britain.
   */
  excludeOriginCodes?: ReadonlySet<string>;
  /**
   * Admit native-answer words to the bank anyway, up to this FRACTION of the entries
   * (0 disables, and is the default).
   *
   * The reason they are kept out at all: a word whose answer is English is won by
   * always pinning Britain and always guessing the earliest window, which is not the
   * knowledge the game is about. Excluding all of them, though, throws away the most
   * common vocabulary in the language - and a curated entry nobody can see is wasted
   * work. A small quota keeps a few easy rounds (tiers 1-2, where a warmed-up player
   * wants them) without the answer becoming a strategy: at 0.1 with 600 entries, 60 of
   * them are native and 540 still ask a real question.
   */
  nativeQuota?: number;
  /** Origins that count as native. Defaults to `excludeOriginCodes`. */
  nativeOriginCodes?: ReadonlySet<string>;
  /** Tiers the native words are pinned to (default [1, 2]). */
  nativeTiers?: readonly number[];
  /**
   * Build the WordBank itself (default true). Set false to generate only the
   * report and work list: curation rounds can then be inspected without the
   * bank being shippable yet (e.g. while a filter leaves a tier empty).
   */
  assembleBank?: boolean;
}

export interface BuildBankReport {
  /** Distinct candidate words with at least one answerable chain. */
  candidateWords: number;
  /** Candidate senses: candidateWords, plus one extra per extra recorded origin. */
  candidateSenses: number;
  acceptedWords: number;
  missingYear: number;
  missingLanguage: Record<string, number>;
  skippedEntries: number;
  tierCounts: number[];
  /** Candidates with a usable chain but no frequency rank (usually rarities). */
  withoutFrequencyRank: number;
  /** Words whose chains disagree on the origin: homographs needing a POS + origin. */
  ambiguousWords: number;
  /**
   * Curated homographs with no curated `origin`: the tie-break picked for them,
   * so their answer is a guess rather than a verified fact.
   */
  ambiguousWithoutOrigin: number;
  /**
   * Accepted entries whose year nobody has checked against a reference yet (a
   * model draft). The bank is playable either way; this is how it reports its
   * own trustworthiness.
   */
  unverifiedEntries: number;
  /**
   * Curator-supplied donor edges merged in from `overrideEdgesText` (new edges
   * only; a row that repeats a recorded edge is ignored).
   */
  overrideEdges: number;
  /** Candidates dropped from the work list because their answer language was excluded. */
  excludedByOrigin: number;
  /** Native-answer entries admitted to the bank under the quota. */
  nativeAdmitted: number;
  /** Native-answer entries left out because the quota was already filled. */
  nativeDropped: number;
  warnings: string[];
}

/** A sense with a usable chain but no curated year. */
export interface UncuratedCandidate {
  term: string;
  /** This sense's answer origin (one entry per origin). */
  origin: string;
  /** Work-list sense id: `word`, or `word|origin` when the word has several. */
  sense: string;
  tier: number;
  chainDepth: number;
  deepestLanguage: string;
  chain: string[];
  /** 1-based frequency rank when a frequency list was supplied. */
  frequencyRank?: number;
  /**
   * Every origin the word's recorded chains support, alphabetically. More than
   * one means the senses are curated separately: each needs its own sense key
   * (`word:pos`) and its `origin`.
   */
  origins: string[];
}

const DONOR_RELTYPES: ReadonlySet<string> = new Set(Object.keys(DONOR_RELATION_PRIORITY));

/** Stable identity of an edge, for de-duplicating overrides against the source. */
function edgeKey(edge: EtymEdge): string {
  return [edge.lang, edge.term, edge.reltype, edge.relatedLang ?? "", edge.relatedTerm ?? ""].join("\u0000");
}

/**
 * Merge curator-supplied edges into the source edges, keeping only genuinely new
 * ones (an override that repeats a recorded edge is ignored rather than duplicated).
 */
function mergeOverrideEdges(
  base: EtymEdge[],
  overrides: EtymEdge[],
): { edges: EtymEdge[]; applied: number } {
  const seen = new Set(base.map(edgeKey));
  const edges = [...base];
  let applied = 0;
  for (const edge of overrides) {
    const key = edgeKey(edge);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(edge);
    applied += 1;
  }
  return { edges, applied };
}

function autoBlurb(chainNames: string[], span: { from: number; to: number }, period: string | null): string {
  const immediate = chainNames[0]!;
  const deepest = chainNames[chainNames.length - 1]!;
  // A word dated only by period has something worth saying that the route line cannot
  // (the route names languages, not dates): that the date IS the period. Without this,
  // 490 derived entries would all carry "From Middle English, ultimately from X.",
  // which is the route line again in prose.
  if (period && span.to > span.from) return `The sources date it to the ${period} period.`;
  return chainNames.length > 1 ? `From ${immediate}, ultimately from ${deepest}.` : `From ${immediate}.`;
}

export function buildBankFromInputs(options: BuildBankOptions): {
  /** null when `assembleBank: false` — work-list generation does not need one. */
  bank: WordBank | null;
  report: BuildBankReport;
} {
  const report: BuildBankReport = {
    candidateWords: 0,
    candidateSenses: 0,
    acceptedWords: 0,
    missingYear: 0,
    missingLanguage: {},
    skippedEntries: 0,
    tierCounts: new Array<number>(10).fill(0),
    withoutFrequencyRank: 0,
    ambiguousWords: 0,
    ambiguousWithoutOrigin: 0,
    unverifiedEntries: 0,
    overrideEdges: 0,
    excludedByOrigin: 0,
    nativeAdmitted: 0,
    nativeDropped: 0,
    warnings: [],
  };

  const { edges: donorEdges, applied: overrideEdgesApplied } = mergeOverrideEdges(
    extractEdges(options.edgesText, DONOR_RELTYPES),
    options.overrideEdgesText ? extractEdges(options.overrideEdgesText, DONOR_RELTYPES) : [],
  );
  report.overrideEdges = overrideEdgesApplied;
  const byCode = parseLanguageTsv(options.languagesText);

  // etymology-db stores language NAMES ("Ancient Greek"); our language table is
  // keyed by CODE ("grc"). Normalize once here so chain walking, hop lookups and
  // the shipped bank contract all speak codes. Names we cannot map are left
  // untouched and surface in report.missingLanguage.
  const codeByName = new Map<string, string>();
  for (const meta of Object.values(byCode)) {
    const existing = codeByName.get(meta.name);
    if (!existing || meta.code < existing) codeByName.set(meta.name, meta.code);
  }
  const normalizeCode = (lang: string): string => codeByName.get(lang) ?? lang;
  const normalizedEdges: EtymEdge[] = donorEdges.map((edge) => ({
    ...edge,
    lang: normalizeCode(edge.lang),
    relatedLang: edge.relatedLang === null ? null : normalizeCode(edge.relatedLang),
  }));

  const { chains, variants } = buildChainsWithVariants(normalizedEdges, {
    englishLangCode: options.englishLangCode ?? "en",
    maxDepth: options.maxChainDepth ?? 3,
  });
  report.candidateWords = chains.size;

  /**
   * The origin a variant would answer with: its deepest hop we can place on the
   * map. Note this deliberately ignores `deepestAttested`: the point here is to
   * offer the curator every *answerable* place, and a variant buried under a
   * reconstructions hop (Old English under Proto-West Germanic, as with `back`)
   * is still answerable — that is the sense the curator is choosing.
   */
  const variantOriginName = (variant: ChainVariant): string | undefined => {
    const placeable = variant.hops.map((hop) => hop.lang).filter((code) => byCode[code]);
    const deepest = placeable[placeable.length - 1];
    return deepest ? byCode[deepest]?.name : undefined;
  };

  /**
   * Every place a word could have come from, across its distinct chains. More
   * than one means the word is a homograph whose senses have different origins
   * (`back` is inherited from Old English in one sense, borrowed from French in
   * another) and each becomes its own entry — see CURATION.md.
   */
  const possibleOrigins = (term: string): string[] => {
    const names = new Set<string>();
    for (const variant of variants.get(term) ?? []) {
      const name = variantOriginName(variant);
      if (name) names.add(name);
    }
    return [...names].sort();
  };

  const languagesByName: Record<string, LanguageInfo> = {};
  for (const meta of Object.values(byCode)) {
    if (!languagesByName[meta.name]) {
      languagesByName[meta.name] = {
        name: meta.name,
        countries: meta.countries,
        representativePoint: meta.representativePoint,
        subregion: meta.subregion,
        continent: meta.continent,
      };
    }
  }

  const entries: BankEntry[] = [];
  const warnedLanguages = new Set<string>();
  // ---- senses -------------------------------------------------------------
  // A puzzle entry is a SENSE, not a word. Each distinct chain variant is one
  // sense, so `back` the noun (Old English) and `back` the verb (via French) are
  // two entries, curated independently, and `sole` has four.

  /** Curation keys grouped by their word, so each word's senses are independent. */
  const keysByWord = new Map<string, string[]>();
  for (const key of Object.keys(options.curation)) {
    const sense = parseSenseKey(key);
    if (!sense) continue;
    const list = keysByWord.get(sense.word);
    if (list) list.push(key);
    else keysByWord.set(sense.word, [key]);
  }

  /**
   * A word's senses: variants in tie-break order, one per answer origin (the
   * intermediate path does not change the answer, which is what the entry is).
   */
  const sensesOf = (term: string): Array<{ origin: string; variant: ChainVariant }> => {
    const ordered = [...(variants.get(term) ?? [])].sort(
      (a, b) => a.firstPriority - b.firstPriority || b.hops.length - a.hops.length,
    );
    const byOrigin = new Map<string, ChainVariant>();
    for (const variant of ordered) {
      const origin = variantOriginName(variant);
      if (origin && !byOrigin.has(origin)) byOrigin.set(origin, variant);
    }
    return [...byOrigin].map(([origin, variant]) => ({ origin, variant }));
  };

  // Native-answer entries, held back until every entry is built: how many may enter
  // depends on how many there are in total (see `nativeQuota`).
  const pendingNative: Array<{ entry: BankEntry; rank: number | undefined }> = [];

  const warnIntermediates = (langs: readonly string[]): void => {
    for (const code of langs.slice(0, -1)) {
      const info = byCode[code];
      if (!info?.representativePoint || info.countries.length === 0) {
        if (!warnedLanguages.has(code)) {
          warnedLanguages.add(code);
          report.warnings.push(`intermediate language "${code}" lacks map metadata; pins on it will not score`);
        }
      }
    }
  };

  for (const term of [...chains.keys()].sort()) {
    const senses = sensesOf(term);
    const origins = senses.map((sense) => sense.origin).sort();
    if (origins.length > 1) report.ambiguousWords += 1;
    report.candidateSenses += senses.length;
    const frequencyRank = options.frequency?.rankOf(term);
    const settled = new Set<string>();

    if (senses.length === 0) {
      // Nothing answerable in any branch: report why, using the tie-break chain.
      const langs = chains.get(term)!.chainLangs;
      const reason = langs[langs.length - 1]!;
      report.missingLanguage[reason] = (report.missingLanguage[reason] ?? 0) + 1;
      continue;
    }
    if (options.frequency && frequencyRank === undefined) report.withoutFrequencyRank += 1;

    // 1. Every curated sense becomes a bank entry of its own.
    for (const key of keysByWord.get(term) ?? []) {
      const sense = parseSenseKey(key)!;
      const curated = options.curation[key]!;
      const match = curated.origin
        ? senses.find((candidate) => candidate.origin === curated.origin)
        : senses[0];
      if (!match) {
        report.warnings.push(
          `"${key}": curated origin "${curated.origin}" is not among the recorded origins (${origins.join(", ")}); entry skipped`,
        );
        report.skippedEntries += 1;
        continue;
      }
      if (!curated.origin && senses.length > 1) {
        // No origin chosen: the tie-break decides, which is a guess for a
        // homograph. Counted so the build report can say how much of the bank
        // rests on it, and flagged by `curate --mode check`.
        report.ambiguousWithoutOrigin += 1;
        report.warnings.push(
          `"${key}": ${origins.length} recorded origins (${origins.join(", ")}) and no "origin"; using the tie-break pick ${match.origin}`,
        );
      }
      const langs = match.variant.hops.map((hop) => hop.lang);
      const deepestCode = langs.filter((code) => byCode[code]).pop()!;
      const meta = byCode[deepestCode]!;
      // Settled either way: a sense that is filtered out is still curated, and
      // must not come back round as an uncurated candidate. Curating a word
      // settles the word — its other recorded origins are alternative routes to
      // the same sense, not further puzzles (a deliberate second sense is added
      // by hand as `word:pos:2`).
      settled.add(term);
      settled.add(senseId(term, match.origin, origins.length));
      if (curated.unverified) report.unverifiedEntries += 1;
      if (curated.pos && sense.pos !== curated.pos) {
        report.warnings.push(
          `"${key}": the entry's "pos" (${curated.pos}) does not match its sense key; the key wins`,
        );
      }
      const nativeCodes = options.nativeOriginCodes ?? options.excludeOriginCodes;
      const isNative = nativeCodes?.has(deepestCode) ?? false;
      if (isNative && !(options.nativeQuota && options.nativeQuota > 0)) {
        report.excludedByOrigin += 1;
        continue;
      }
      warnIntermediates(langs);
      const chainNames = langs.map((code) => byCode[code]?.name ?? code);
      // The span decides how the blurb reads, so compute it once.
      const answer = answerSpan({ year: curated.year, yearTo: curated.yearTo });
      const entry: BankEntry = {
        id: key,
        word: sense.word,
        ...(sense.pos ? { pos: sense.pos } : {}),
        year: Math.round(curated.year),
        // A coarse answer ("in use by 1150") keeps its upper bound, so the game
        // scores any window overlapping the span rather than one invented year.
        ...(curated.yearTo !== undefined && Math.round(curated.yearTo) > Math.round(curated.year)
          ? { yearTo: Math.round(curated.yearTo) }
          : {}),
        tier: curated.tier ?? assignTier({ chainDepth: langs.length, frequencyRank }),
        originChain: chainNames,
        originLanguage: meta.name,
        countries: meta.countries,
        point: meta.representativePoint!,
        blurb: curated.blurb?.trim() || autoBlurb(chainNames, answer, periodOfSpan(answer)?.label ?? null),
      };
      try {
        validateEntry(entry);
      } catch (err) {
        report.skippedEntries += 1;
        report.warnings.push(err instanceof Error ? err.message : String(err));
        continue;
      }
      if (isNative) {
        pendingNative.push({ entry, rank: frequencyRank });
        continue;
      }
      entries.push(entry);
      report.tierCounts[entry.tier - 1]! += 1;
    }

    // 2. Senses with no curated entry become work-list candidates, each with its
    //    own chain and origin so the curator can pick out the ones they know.
    for (const { origin, variant } of senses) {
      if (settled.has(senseId(term, origin, origins.length))) continue;
      const langs = variant.hops.map((hop) => hop.lang);
      const deepestCode = langs.filter((code) => byCode[code]).pop()!;
      if (options.excludeOriginCodes?.has(deepestCode)) {
        report.excludedByOrigin += 1;
        continue;
      }
      report.missingYear += 1;
      options.onUncurated?.({
        term,
        origin,
        sense: senseId(term, origin, origins.length),
        tier: assignTier({ chainDepth: langs.length, frequencyRank }),
        chainDepth: langs.length,
        deepestLanguage: byCode[deepestCode]!.name,
        chain: langs.map((code) => byCode[code]?.name ?? code),
        frequencyRank,
        origins,
      });
    }
  }
  // Native-answer words enter up to the quota, most common first: those are the ones
  // a player meets early, so they are the ones worth spending an easy round on. Their
  // tier is FORCED, so `--mode tier` cannot scatter them out of the easy tiers.
  const nativeTotal = entries.length + pendingNative.length;
  const quota = Math.round((options.nativeQuota ?? 0) * nativeTotal);
  const nativeTiers = (options.nativeTiers ?? [1, 2]).filter((tier) => tier >= 1 && tier <= 10);
  const tiersForNatives = nativeTiers.length > 0 ? nativeTiers : [1, 2];
  pendingNative
    .sort((a, b) => {
      const rankA = a.rank ?? Number.POSITIVE_INFINITY;
      const rankB = b.rank ?? Number.POSITIVE_INFINITY;
      return rankA === rankB ? a.entry.word.localeCompare(b.entry.word) : rankA - rankB;
    })
    .slice(0, Math.max(0, quota))
    .forEach((pending, index) => {
      pending.entry.tier = tiersForNatives[index % tiersForNatives.length]!;
      entries.push(pending.entry);
      report.tierCounts[pending.entry.tier - 1]! += 1;
      report.nativeAdmitted += 1;
    });
  report.nativeDropped = pendingNative.length - report.nativeAdmitted;
  report.acceptedWords = entries.length;

  const bank = options.assembleBank === false
    ? null
    : buildWordBank({
        version: options.version,
        epochStartDay: options.epochStartDay,
        entries,
        languages: languagesByName,
      });
  return { bank, report };
}
