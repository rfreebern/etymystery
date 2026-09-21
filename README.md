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
      geo-utils.ts    haversine + spherical point-to-border distance
    scripts/        Node-side data pipeline
      lib/etymology-db.ts   etymology-db CSV ingest + origin-chain builder
      lib/languages.ts      language metadata TSV (code -> modern geography)
      lib/tiering.ts        difficulty heuristic (curation overrides it)
      lib/bank-builder.ts   orchestration: edges + languages + curation -> bank
      build-bank.ts         CLI
      gen-countries.ts      world-countries -> web/src/countries.json
    web/            static client (Vite + d3-geo, no backend)
      index.html
      src/main.ts           round flow, timeline slider, reveal, summary
      src/game.ts           session state machine (pure, injectable storage)
      src/map.ts            SVG world map: pin drops + reveal highlighting
      src/geo-context.ts    GeocodeContext over Natural Earth + country table
      src/countries.json    generated country table (ISO2 -> ccn3/region)
      public/word-bank.json         the bank, served as a static file
      public/countries-110m.json    world-atlas TopoJSON (Natural Earth)
    curated/        hand-curated starter dataset (see below)
    tests/          vitest suites (102 tests)

## Commands

    npm install
    npm run typecheck      # tsc --noEmit
    npm test               # vitest run
    npm run dev            # vite dev server for web/ (http://localhost:5173)
    npm run build:web      # static build -> web/dist/
    npm run preview        # serve the built site
    npm run build:seed     # rebuild web/public/word-bank.json from curated/
    npm run gen:countries  # regenerate web/src/countries.json
    npm run build:bank -- \
      --edges data/etymology-db.csv.gz \
      --languages data/languages.tsv \
      --curation data/curation.json \
      --out data/word-bank.json \
      --version 1 [--epoch-start 2026-01-01] [--english-code en] [--max-depth 3]

## Playing it

`npm run dev` serves the game. Ten rounds a day, one per difficulty tier.
Each round: drop a pin where the word came from, drag the year slider, lock it
in. The reveal shows the two score components separately plus the full origin
route, and progress is kept in `localStorage` under
`etymystery:v<bankVersion>:d<dayIndex>` so a reload mid-day resumes and a
finished day is never re-scored. `npm run build:web` emits a fully static
`web/dist/` — any file host serves it.

The committed `web/public/word-bank.json` is a **30-word seed bank** (3 days
of puzzles, 22 languages) generated from `curated/`. It exists so the client is
playable end to end; grow it by curating more words and re-running
`npm run build:seed`.

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

The repo also ships a tiny hand-written stand-in for inputs 1 and 2 so the
client can be built without the 4.2M-edge download: `curated/seed-edges.csv`
(32 edges, in etymology-db's exact column schema) and `curated/languages.tsv`
(22 language codes with modern geography). Together with the 30-word
`curated/curation.json`, `npm run build:seed` regenerates the seed bank
committed at `web/public/word-bank.json`.

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
  - region/continent matches (UN M49 subregion / continent, anchored to
    the deep origin) are shown as reveal-time labels only — they never
    add points beyond border proximity;
  - outer limit: pins farther than 5000 km from every hop score 0.
  - Result: Saudi Arabia > France > wrong-but-near > zero (covered by
    explicit tests, including the Russia-vs-Netherlands case).
- Round total: mean of the two axes; both components are shown separately
  on reveal.

Geographic scoring binds to the map through the `GeocodeContext` adapter
(`contains`, `distanceToCountryKm`, `allCountryCodes`, `regionOf`,
`languageOf`) so the core never depends on a map library. Border distance
lives in `src/geo-utils.ts`: the great-circle distance from the pin to the
nearest segment of every ring in the country's (Multi)Polygon, so a pin can
sit 0 km inside a frontier yet thousands of km from the capital — which is
exactly the leniency this game wants. The real adapter is
`web/src/geo-context.ts` (d3-geo + world-atlas TopoJSON), joined to the
generated country table through the UN M49 numeric code.

## Licensing

See LICENSES.md. In short: code is proprietary to this project until you
choose a license; all word/etymology data is CC BY-SA and requires
attribution + share-alike, which this project honors by open-sourcing the
curation artifacts.

## Roadmap

- [x] Web UI: map (world-atlas TopoJSON + d3-geo), timeline selector,
      daily flow, reveal screens
- [ ] Grow the curated bank to ~1-2k words (today: 30 words = 3 days) and
      bootstrap `languages.tsv` from etymology-db's `wiktionary_codes.csv`
- [ ] Frequency import (wordfreq export) for tier heuristics
- [ ] GitHub Action: nightly append-only bank rebuild + capacity report
