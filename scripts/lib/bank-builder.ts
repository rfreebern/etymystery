/**
 * Pipeline orchestrator: etymology-db edges + language metadata TSV + curated
 * year/tier/blurb overrides -> validated WordBank + build report.
 *
 * Curation is a first-class input: only words with a curated attestation year
 * enter the bank (years are facts curated by hand — see PROGRESS/README).
 */

import { buildWordBank, validateEntry } from "../../src/bank";
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
  /** Words dropped because their answer origin language was excluded. */
  excludedByOrigin: number;
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

function autoBlurb(chainNames: string[]): string {
  const immediate = chainNames[0]!;
  const deepest = chainNames[chainNames.length - 1]!;
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
    excludedByOrigin: 0,
    warnings: [],
  };

  const donorEdges = extractEdges(options.edgesText, DONOR_RELTYPES);
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
      // must not come back round as an uncurated candidate.
      settled.add(senseId(term, match.origin, origins.length));
      if (curated.pos && sense.pos !== curated.pos) {
        report.warnings.push(
          `"${key}": the entry's "pos" (${curated.pos}) does not match its sense key; the key wins`,
        );
      }
      if (options.excludeOriginCodes?.has(deepestCode)) {
        report.excludedByOrigin += 1;
        continue;
      }
      warnIntermediates(langs);
      const chainNames = langs.map((code) => byCode[code]?.name ?? code);
      const entry: BankEntry = {
        id: key,
        word: sense.word,
        ...(sense.pos ? { pos: sense.pos } : {}),
        year: Math.round(curated.year),
        tier: curated.tier ?? assignTier({ chainDepth: langs.length, frequencyRank }),
        originChain: chainNames,
        originLanguage: meta.name,
        countries: meta.countries,
        point: meta.representativePoint!,
        blurb: curated.blurb?.trim() || autoBlurb(chainNames),
      };
      try {
        validateEntry(entry);
      } catch (err) {
        report.skippedEntries += 1;
        report.warnings.push(err instanceof Error ? err.message : String(err));
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
