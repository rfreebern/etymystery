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
  /**
   * Anchor a word to its deepest hop that we can place on the map, instead of
   * blindly to its deepest hop. Off by default: the project rule is "answer
   * anchored to the DEEPEST origin", and a reconstructed proto language has no
   * defensible home on a modern map.
   */
  deepestAttested?: boolean;
  /** Called for every candidate word that needs a curated year. */
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
  candidateWords: number;
  acceptedWords: number;
  missingYear: number;
  missingLanguage: Record<string, number>;
  skippedEntries: number;
  tierCounts: number[];
  /**
   * Words dropped only because their DEEPEST hop is a language we cannot place
   * (typically a reconstructed proto language), although the chain contains a
   * placeable hop. Setting `deepestAttested` would recover these.
   */
  salvageableWithAttestedAnchor: number;
  /** Candidates with a usable chain but no frequency rank (usually rarities). */
  withoutFrequencyRank: number;
  /** Words whose chains disagree on the origin: homographs needing a POS + origin. */
  ambiguousWords: number;
  /** Words dropped because their answer origin language was excluded. */
  excludedByOrigin: number;
  warnings: string[];
}

/** A word with a usable chain but no curated year. */
export interface UncuratedCandidate {
  term: string;
  tier: number;
  chainDepth: number;
  deepestLanguage: string;
  chain: string[];
  /** 1-based frequency rank when a frequency list was supplied. */
  frequencyRank?: number;
  /**
   * Every origin the recorded chains support, alphabetically. More than one means
   * the word is a homograph and the curator must say which sense this entry is
   * about (`origin` in curation.json).
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
    acceptedWords: 0,
    missingYear: 0,
    missingLanguage: {},
    skippedEntries: 0,
    tierCounts: new Array<number>(10).fill(0),
    salvageableWithAttestedAnchor: 0,
    withoutFrequencyRank: 0,
    ambiguousWords: 0,
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
   * another), which only a curator can resolve — see CURATION.md.
   */
  const possibleOrigins = (term: string): string[] => {
    const names = new Set<string>();
    for (const variant of variants.get(term.toLowerCase()) ?? []) {
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
  for (const term of [...chains.keys()].sort()) {
    const chain: OriginChain = chains.get(term)!;
    const origins = possibleOrigins(term);
    if (origins.length > 1) report.ambiguousWords += 1;

    const curated = options.curation[term];

    // A curated origin overrides the pipeline's pick. Without it, a homograph
    // would be answered with whichever branch won the tie-break — for `back`
    // that was French, while the sense a player knows is Old English.
    let effectiveLangs = chain.chainLangs;
    if (curated?.origin) {
      const chosen = (variants.get(term.toLowerCase()) ?? []).find(
        (variant) => variantOriginName(variant) === curated.origin,
      );
      if (!chosen) {
        report.warnings.push(
          `"${term}": curated origin "${curated.origin}" is not among the recorded origins ` +
            `(${origins.join(", ") || "none"}); entry skipped`,
        );
        report.skippedEntries += 1;
        continue;
      }
      effectiveLangs = chosen.hops.map((hop) => hop.lang);
    }

    // The answer is anchored to the DEEPEST origin; intermediate hops stay in
    // originChain for partial "on the route" scoring at the client. A curated
    // origin is authoritative, so when one is given the anchor is the deepest
    // hop we can place (the curator already decided the answer is answerable).
    const anchorAttested = options.deepestAttested || Boolean(curated?.origin);
    const placeable = effectiveLangs.filter((code) => byCode[code]);
    let deepest = effectiveLangs[effectiveLangs.length - 1]!;
    let meta = byCode[deepest];
    if (!meta && anchorAttested) {
      // Reconstruct-only hops (Proto-Indo-European, Proto-Germanic, ...) have no
      // defensible modern home: anchor to the deepest hop that does.
      deepest = placeable[placeable.length - 1] ?? deepest;
      meta = byCode[deepest];
    }
    if (!meta) {
      report.missingLanguage[deepest] = (report.missingLanguage[deepest] ?? 0) + 1;
      if (placeable.length > 0) report.salvageableWithAttestedAnchor += 1;
      continue;
    }
    if (options.excludeOriginCodes?.has(deepest)) {
      report.excludedByOrigin += 1;
      continue;
    }
    if (!meta.representativePoint || meta.countries.length === 0) {
      report.warnings.push(
        `language "${deepest}" (${meta.name}) lacks a representative point or countries; skipping its words`,
      );
      continue;
    }
    for (const code of effectiveLangs.slice(0, -1)) {
      const info = byCode[code];
      if (!info?.representativePoint || info.countries.length === 0) {
        if (!warnedLanguages.has(code)) {
          warnedLanguages.add(code);
          report.warnings.push(
            `intermediate language "${code}" lacks map metadata; pins on it will not score`,
          );
        }
      }
    }
    const chainNames = effectiveLangs.map((code) => byCode[code]?.name ?? code);
    const frequencyRank = options.frequency?.rankOf(term);
    if (options.frequency && frequencyRank === undefined) report.withoutFrequencyRank += 1;
    if (!curated || !Number.isFinite(curated.year)) {
      report.missingYear += 1;
      options.onUncurated?.({
        term,
        tier: assignTier({ chainDepth: effectiveLangs.length, frequencyRank }),
        chainDepth: effectiveLangs.length,
        deepestLanguage: meta.name,
        chain: chainNames,
        frequencyRank,
        origins,
      });
      continue;
    }
    const entry: BankEntry = {
      id: term,
      word: term,
      ...(curated.pos ? { pos: curated.pos.trim() } : {}),
      year: Math.round(curated.year),
      tier: curated.tier ?? assignTier({ chainDepth: chain.chainLangs.length, frequencyRank }),
      originChain: chainNames,
      originLanguage: meta.name,
      countries: meta.countries,
      point: meta.representativePoint,
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
