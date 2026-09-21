/**
 * Pipeline orchestrator: etymology-db edges + language metadata TSV + curated
 * year/tier/blurb overrides -> validated WordBank + build report.
 *
 * Curation is a first-class input: only words with a curated attestation year
 * enter the bank (years are facts curated by hand — see PROGRESS/README).
 */

import { buildWordBank, validateEntry } from "../../src/bank";
import type { BankEntry, LanguageInfo, WordBank } from "../../src/types";
import { DONOR_RELATION_PRIORITY, buildChains, extractEdges, type OriginChain } from "./etymology-db";
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
}

export interface BuildBankReport {
  candidateWords: number;
  acceptedWords: number;
  missingYear: number;
  missingLanguage: Record<string, number>;
  skippedEntries: number;
  tierCounts: number[];
  warnings: string[];
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
    warnings: [],
  };

  const donorEdges = extractEdges(options.edgesText, DONOR_RELTYPES);
  const chains = buildChains(donorEdges, {
    englishLangCode: options.englishLangCode ?? "en",
    maxDepth: options.maxChainDepth ?? 3,
  });
  report.candidateWords = chains.size;

  const byCode = parseLanguageTsv(options.languagesText);
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
    const deepest = chain.chainLangs[chain.chainLangs.length - 1]!;
    const meta = byCode[deepest];
    if (!meta) {
      report.missingLanguage[deepest] = (report.missingLanguage[deepest] ?? 0) + 1;
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
    const curated = options.curation[term];
    if (!curated || !Number.isFinite(curated.year)) {
      report.missingYear += 1;
      continue;
    }
    const chainNames = chain.chainLangs.map((code) => byCode[code]?.name ?? code);
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
