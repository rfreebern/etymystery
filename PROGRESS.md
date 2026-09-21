# Etymystery — Progress / Resume Protocol

If a session drops, say "continue" and Cline re-orients from this file, then
runs the verification command:

    npx tsc --noEmit && npx vitest run

## Status (as of 2026-09-21)

Core library + data pipeline COMPLETE. 81/81 tests passing, typecheck clean.
CLI smoke-tested end-to-end with fixture files.

## Done

- Scaffold: package.json (TS + Vitest + tsx, zero runtime deps), tsconfig,
  .gitignore, vitest.config.ts
- src/types.ts — BankEntry, LanguageInfo, WordBank, RoundGuess, RoundScore
- src/prng.ts — mulberry32 + FNV-1a + Fisher-Yates (deterministic)
- src/bank.ts — buildWordBank, strict interleave (exactly 10 rounds/day,
  one per tier), appendToBank (append-only versioning), validateEntry,
  validateBank (incl. duplicate word/id + tamper detection)
- src/daily.ts — UTC day math + getDailyPuzzle (pure fn of date + bank)
- src/scoring.ts — scoreTemporal (50y window, 100y decay),
  scoreGeographic (inside-country leniency w/ 10pt cap, border-proximity
  decay 1500km, subregion 50 / continent 25 credit), scoreRound,
  GeocodeContext adapter for pluggable map (d3-geo)
- src/index.ts — barrel
- scripts/lib/etymology-db.ts — streaming RFC4180 CSV, header detection,
  donor-relation filter (7 relations, priority-ordered), multi-hop chain
  walker with cycle pruning
- scripts/lib/languages.ts — languages.tsv parser (code/name/countries/
  region/continent/lat/lng)
- scripts/lib/tiering.ts — chain-depth + frequency tier heuristic
- scripts/lib/bank-builder.ts — orchestration + build report (curation
  worklist: missingYear, missingLanguage, skippedEntries, warnings)
- scripts/build-bank.ts — CLI (gzip support, arg validation, report)
- scoring v2 (hop-aware): answer anchored to DEEPEST origin; intermediate hops
  score only on direct pin (Variant B, weight 0.7); outer limit 5000 km from
  any hop scores 0; region/continent matches are reveal LABELS only and
  never add points beyond border proximity (user rule); GeocodeContext
  gained languageOf(); bank-builder re-anchored to deepest origin with
  intermediate-metadata warnings; credit labels: country > intermediate >
  subregion > continent > proximity; 81 tests green (incl. SA > FR >
  wrong > Tokyo=0)
- README.md, LICENSES.md

## Remaining (next session)

1. Web UI: map (world-atlas TopoJSON + d3-geo GeocodeContext impl),
   timeline selector, daily flow, reveal screens — static hosting
2. Real curation: download etymology-db CSV (OneDrive link in its README),
   bootstrap languages.tsv from its wiktionary_codes.csv, hand-curate
   curation.json (years are facts; consult OED/Etymonline by hand)
3. GitHub Action: nightly append-only bank rebuild + capacity report

## Gotchas learned (do not re-fight)

- run_commands batch items may execute CONCURRENTLY — never rely on
  cross-command ordering; chain dependent steps with && in ONE command.
- Object.keys() on a Map returns [] — spread to arrays first.
- Editor tool has ~6000-char payloads; larger files go via bash heredoc.
- npm blocks esbuild postinstall but tsx works (binary via optional dep).
- etymology-db schema: term_id, lang, term, reltype, related_term_id,
  related_lang, related_term, position, group_tag, parent_tag,
  parent_position; donor relations: *borrowing_from (prio 0),
  inherited_from (1), derived_from (2).
