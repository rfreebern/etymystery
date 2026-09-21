# Etymystery

A daily etymology puzzle game: given a word, trace **where** it came from
(the map) and **when** it entered English (the timeline). Ten rounds a day,
ramping from easy to hard, scored on temporal *and* geographic proximity.

Non-commercial and **client-side only**: no database, no backend. The daily
puzzle is a pure function of the date and a static word bank, so any static
file host serves the whole game.

## How the daily puzzle works (deterministic engine)

- The word bank is a static JSON file: 10 tiered, pre-shuffled queues
  (tier 1 easy .. tier 10 hard) plus a round-robin **master sequence**.
- Day N (UTC days since the bank's epoch) serves `master[N*10 .. N*10+10]`
  — exactly one word per tier per day, rounds ordered easy -> hard.
- **No word repeats** until a tier queue is exhausted; `getDailyPuzzle`
  throws beyond capacity, signalling that a new bank version is due.
- Banks are **append-only**: new versions append to each tier queue without
  re-shuffling shipped positions, so past puzzles never change
  (verified by tests).

## Layout

    src/            browser-safe core (zero runtime deps)
      types.ts        BankEntry, LanguageInfo, WordBank, RoundScore
      prng.ts         mulberry32 + FNV-1a + Fisher-Yates
      bank.ts         buildWordBank / interleave / appendToBank / validators
      daily.ts        day math + getDailyPuzzle
      scoring.ts      temporal + country-aware geographic scoring
    scripts/        Node-side data pipeline
      lib/etymology-db.ts   etymology-db CSV ingest + origin-chain builder
      lib/languages.ts      language metadata TSV (code -> modern geography)
      lib/tiering.ts        difficulty heuristic (curation overrides it)
      lib/bank-builder.ts   orchestration: edges + languages + curation -> bank
      build-bank.ts         CLI
    tests/          vitest suites (75 tests)

## Commands

    npm install
    npm run typecheck      # tsc --noEmit
    npm test               # vitest run
    npm run build:bank -- \
      --edges data/etymology-db.csv.gz \
      --languages data/languages.tsv \
      --curation data/curation.json \
      --out data/word-bank.json \
      --version 1 [--epoch-start 2026-01-01] [--english-code en] [--max-depth 3]

## Data pipeline

Inputs:

1. **etymology-db** (https://github.com/droher/etymology-db) — 4.2M
   Wiktionary-derived etymology edges (CC BY-SA 3.0). Downloads are
   OneDrive links in the repo README (Gzipped CSV recommended; generated
   2023-12-05). The pipeline filters to donor relations
   (borrowed_from, learned_borrowing_from, inherited_from, ...) and walks
   origin chains up to `--max-depth` hops.
2. **languages.tsv** — curated mapping from Wiktionary language codes to
   modern geography (columns: code, name, countries, region, continent,
   lat, lng). Start from `wiktionary_codes.csv` shipped with etymology-db.
3. **curation.json** — hand-curated attestation years (facts, checked by
   hand against OED/Etymonline/your reference of choice), optional tier
   overrides and reveal blurbs. Words without a year are excluded and
   counted in the build report — this is the curation worklist.

## Scoring

- **Temporal** (0-100): full credit within +/-50 years of the attested
  year (answers are century-granular), then exponential decay with a
  100-year half-life scale.
- **Geographic** (0-100), hop-aware and deliberately lenient. The answer is
  anchored to the word's DEEPEST origin (e.g. Arabic for a word that went
  Arabic -> French -> English):
  - pin inside the deep origin's country: high score with only a gentle
    decay from the answer point (max 10-point penalty);
  - pin inside an intermediate-hop country (e.g. France): direct hit only,
    weighted 0.7 — "right route, right stop";
  - pin in the wrong country: proximity to the deep origin's *border* (not
    centroid), 1500 km decay scale;
  - partial credit tiers: right UN M49 subregion (50), right continent
    (25), anchored to the deep origin;
  - outer limit: pins farther than 5000 km from every hop score 0.
  - Result: Saudi Arabia > France > wrong-but-near > zero (covered by
    explicit tests, including the Russia-vs-Netherlands case).
- Round total: mean of the two axes; both components are shown separately
  on reveal.

Geographic scoring binds to the map through the `GeocodeContext` adapter
(`contains`, `distanceToCountryKm`, `allCountryCodes`, `regionOf`) so the
client can plug in d3-geo over world-atlas TopoJSON (Natural Earth,
public domain) without coupling the core to any map library.

## Licensing

See LICENSES.md. In short: code is proprietary to this project until you
choose a license; all word/etymology data is CC BY-SA and requires
attribution + share-alike, which this project honors by open-sourcing the
curation artifacts.

## Roadmap

- [ ] Web UI: map (world-atlas TopoJSON + d3-geo), timeline selector,
      daily flow, reveal screens
- [ ] Curated starter bank (~1-2k words, all 10 tiers) + languages.tsv
      bootstrap from etymology-db's wiktionary_codes.csv
- [ ] Frequency import (wordfreq export) for tier heuristics
- [ ] GitHub Action: nightly append-only bank rebuild + capacity report
