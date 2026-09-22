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
      lib/language-geo.ts   code list + overlay + world-countries -> languages.tsv
      bootstrap-languages.ts CLI for the above
    web/            static client (Vite + d3-geo, no backend)
      index.html
      src/main.ts           round flow, timeline slider, reveal, summary
      src/game.ts           session state machine (pure, injectable storage)
      src/map.ts            SVG world map: pin drops + reveal highlighting
      src/geo-context.ts    GeocodeContext over Natural Earth + country table
      src/countries.json    generated country table (ISO2 -> ccn3/region)
      public/word-bank.json         the bank, served as a static file
      public/countries-110m.json    world-atlas TopoJSON (Natural Earth)
    curated/        hand-curated inputs (committed, small)
      language-geo.json     language code -> anchor countries + point overlay
      languages.tsv         seed language table (22 languages, bank v1)
      curation.json         seed words: attested year + tier + blurb
      seed-edges.csv        seed etymology edges (etymology-db schema)
    tests/          vitest suites (118 tests)

## Commands

    npm install
    npm run typecheck      # tsc --noEmit
    npm test               # vitest run
    npm run dev            # vite dev server for web/ (http://localhost:5173)
    npm run build:web      # static build -> web/dist/
    npm run preview        # serve the built site
    npm run build:seed     # rebuild web/public/word-bank.json from curated/
    npm run gen:countries  # regenerate web/src/countries.json
    npm run curate -- --mode next|check|merge   # see CURATION.md for the process
    npm run admin          # local curation UI: word on the left, references on the right
    npm run bootstrap:languages -- \
      --codes data/wiktionary_codes.csv \
      --overlay curated/language-geo.json \
      --out data/languages.tsv [--include-proto]
    npm run filter:edges -- \
      --edges data/etymology-db.csv.gz \
      --languages data/languages.tsv \
      --out data/edges-filtered.csv.gz [--all-reltypes]
    npm run build:bank -- \
      --edges data/edges-filtered.csv.gz \
      --languages data/languages.tsv \
      --curation data/curation.json \
      --out data/word-bank.json \
      --version 2 [--epoch-start 2026-09-21] [--english-code en] [--max-depth 3] \
      [--deepest-attested] [--frequency data/en-frequency.txt] \
      [--exclude-origin en,ang,enm] [--worklist-only] \
      [--worklist data/curation-worklist.tsv]

## Playing it

`npm run dev` serves the game. Ten rounds a day, one per difficulty tier.
Each round: drop a pin where the word came from, drag the year slider, lock it
in. The timeline spans **700–2025** with era markers (Old English · Middle
English · Early Modern · Modern), so medieval loanwords are playable; that window
lives in `src/timeline.ts` and is shared with the curation tooling, so the tools
can never disagree with what the game scores. The reveal shows the two score
components separately plus the full origin route, and progress is kept in
`localStorage` under `etymystery:v<bankVersion>:d<dayIndex>` so a reload mid-day
resumes and a finished day is never re-scored. `npm run build:web` emits a fully
static `web/dist/` — any file host serves it.

The committed `web/public/word-bank.json` is a **30-word seed bank** (3 days
of puzzles, 22 languages) generated from `curated/`. It exists so the client is
playable end to end; grow it by curating more words and re-running
`npm run build:seed`.

## Data pipeline

Inputs:

1. **etymology-db** (https://github.com/droher/etymology-db) — 4.2M
   Wiktionary-derived etymology edges (CC BY-SA 3.0). Download the CSV from the
   repo's **GitHub release assets** (the OneDrive links in its README are
   view-only and reject scripted downloads):

       curl -L -o data/etymology-db.csv.gz \
         https://github.com/droher/etymology-db/releases/download/2023-12/etymology.csv.gz

   That is 143 MB gzipped, 456 MB / 4,222,599 rows uncompressed. The pipeline
   filters to donor relations (borrowed_from, learned_borrowing_from,
   inherited_from, ...) and walks origin chains up to `--max-depth` hops.
2. **languages.tsv** — Wiktionary language code -> modern geography (columns:
   code, name, countries, region, continent, lat, lng). Generate it from
   `wiktionary_codes.csv` (which ships with etymology-db) with:

       curl -o data/wiktionary_codes.csv \
         https://raw.githubusercontent.com/droher/etymology-db/master/wiktionary_codes.csv
       npm run bootstrap:languages -- --codes data/wiktionary_codes.csv

   The generator merges two sources: the committed `curated/language-geo.json`
   overlay (hand-picked anchor countries + answer point for the languages that
   matter in English etymology, incl. historical ones like Latin and Old Norse)
   and an automated derivation from `world-countries` for the long tail. Codes
   are only included when one of the two can place them; everything else is
   reported. **Reconstructed proto/family codes** (`ine-pro`, `gem-pro`, …) are
   excluded by default — anchoring a reconstruction to a modern country would
   be indefensible — and can be opted into with `--include-proto`. The build
   report's `missingLanguage` list is the work list for growing the overlay.
   Note etymology-db stores language NAMES ("Ancient Greek") while this file is
   keyed by CODE ("grc"); the bank builder normalizes between them.
   Running the generator against the real code list yields 312 languages.
3. **curation.json** — hand-curated attestation years (facts, checked by
   hand against OED/Etymonline/your reference of choice), optional tier
   overrides and reveal blurbs. Words without a year are excluded and
   counted in the build report — this is the curation worklist. Two more fields
   matter for homographs: `pos` (the part of speech the puzzle is about) and
   `origin` (the sense's origin when the recorded chains disagree — `back` is
   Old English as a noun but came via French in another sense; see CURATION.md).

The full dataset never fits in memory comfortably, so filter it once to the
edges a bank build can use:

    npm run filter:edges -- \
      --edges data/etymology-db.csv.gz \
      --languages data/languages.tsv \
      --out data/edges-filtered.csv.gz

This streams the gzip (never holding the file as one string), keeps rows whose
source language we can place on the map plus donor relations only, and prints
the languages that block the most English words. On the 2023-12 release it
reduces **4,222,599 rows to 771,573** (143 MB -> 9.1 MB) in ~20 s, and reports
that 96.9% of English donor rows are covered by the generated language table.

### Curation order

`--frequency <file>` ranks the work list and feeds the tier heuristic. Fetch an
English list with:

    curl -o data/en-frequency.txt \
      https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt

Two measurements matter. **Coverage:** of the 41,985 candidates, 584 are in the
top 1,000 English words, 2,380 in the top 5,000, 4,065 in the top 10,000 and
11,349 in the top 50,000 — so curating the top 5,000 words yields ~2,380
playable words, about 238 days at 10 rounds a day. **Ordering:** raw frequency
puts function words first (`you`, `the`, `to`, `that`), whose answer is always
"England, ~900 AD"; a puzzle where pinning Britain always wins is broken.
`--exclude-origin en,ang,enm` drops those 10,622 words and leaves 26,590
candidates starting with genuinely interesting answers (`just` ← Old French,
`must` ← Middle Persian, `money` ← Old French).

Curation must check the *chain*, not only the year: etymology-db is a faithful
parse of Wiktionary, not a validated dataset, so it contains dubious relations
(`name` ← Wolof, `so` ← Japanese). The supplied chain is a claim to verify.
The step-by-step loop lives in [CURATION.md](CURATION.md), and `npm run admin`
opens a local page that puts the word and its reference pages side by side for
exactly this step.

The repo also ships a tiny stand-in for input 1 so the client can be built
without the 4.2M-edge download: `curated/seed-edges.csv` (32 edges, in
etymology-db's exact column schema). Together with the 22-language
`curated/languages.tsv` and the 30-word `curated/curation.json`,
`npm run build:seed` regenerates the seed bank committed at
`web/public/word-bank.json`.

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
- [x] Frequency import (FrequencyWords / OpenSubtitles 2018) for the curation
      order and tier heuristics
- [ ] GitHub Action: nightly append-only bank rebuild + capacity report
