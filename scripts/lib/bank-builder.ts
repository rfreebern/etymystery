/**
 * Pipeline orchestrator: etymology-db edges + language metadata TSV + curated
 * year/tier/blurb overrides -> validated WordBank + build report.
 *
 * Curation is a first-class input: only words with a curated attestation year
 * enter the bank (years are facts curated by hand — see PROGRESS/README).
 */

import { buildWordBank, validateEntry } from "../../src/bank";
import type { BankEntry, LanguageInfo, WordBank } from "../../src/types";
import { DONOR_RELATION_PRIORITY, buildChains, extractEdges, type EtymEdge, type OriginChain } from "./etymology-db";
import { parseLanguageTsv } from "./languages";
import { assignTier } from "./tiering";

export interface CurationEntry {
  /** Attested year the word entered English (required to include the word). */
  year: number;
  /** Manual difficulty override (1..10); defaults to the tiering heuristic. */
  tier?: number;
  /** Manual reveal blurb; defaults to an auto-generated one-liner. */
  blurb?: string;
}

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
  warnings: string[];
}

/** A word with a usable chain but no curated year. */
export interface UncuratedCandidate {
  term: string;
  tier: number;
  chainDepth: number;
  deepestLanguage: string;
  chain: string[];
}

const DONOR_RELTYPES: ReadonlySet<string> = new Set(Object.keys(DONOR_RELATION_PRIORITY));

function autoBlurb(chainNames: string[]): string {
  const immediate = chainNames[0]!;
  const deepest = chainNames[chainNames.length - 1]!;
  return chainNames.length > 1 ? `From ${immediate}, ultimately from ${deepest}.` : `From ${immediate}.`;
}

export function buildBankFromInputs(options: BuildBankOptions): { bank: WordBank; report: BuildBankReport } {
  const report: BuildBankReport = {
    candidateWords: 0,
    acceptedWords: 0,
    missingYear: 0,
    missingLanguage: {},
    skippedEntries: 0,
    tierCounts: new Array<number>(10).fill(0),
    salvageableWithAttestedAnchor: 0,
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

  const chains = buildChains(normalizedEdges, {
    englishLangCode: options.englishLangCode ?? "en",
    maxDepth: options.maxChainDepth ?? 3,
  });
  report.candidateWords = chains.size;
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
    // The answer is anchored to the DEEPEST origin; intermediate hops stay in
    // originChain for partial "on the route" scoring at the client.
    const placeable = chain.chainLangs.filter((code) => byCode[code]);
    let deepest = chain.chainLangs[chain.chainLangs.length - 1]!;
    let meta = byCode[deepest];
    if (!meta && options.deepestAttested) {
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
    if (!meta.representativePoint || meta.countries.length === 0) {
      report.warnings.push(
        `language "${deepest}" (${meta.name}) lacks a representative point or countries; skipping its words`,
      );
      continue;
    }
    for (const code of chain.chainLangs.slice(0, -1)) {
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
    const chainNames = chain.chainLangs.map((code) => byCode[code]?.name ?? code);
    const curated = options.curation[term];
    if (!curated || !Number.isFinite(curated.year)) {
      report.missingYear += 1;
      options.onUncurated?.({
        term,
        tier: assignTier({ chainDepth: chain.chainLangs.length }),
        chainDepth: chain.chainLangs.length,
        deepestLanguage: meta.name,
        chain: chainNames,
      });
      continue;
    }
    const entry: BankEntry = {
      id: term,
      word: term,
      year: Math.round(curated.year),
      tier: curated.tier ?? assignTier({ chainDepth: chain.chainLangs.length }),
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

  const bank = buildWordBank({
    version: options.version,
    epochStartDay: options.epochStartDay,
    entries,
    languages: languagesByName,
  });
  return { bank, report };
}
