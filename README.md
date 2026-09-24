# Etymystery

**Play it: <https://rfreebern.github.io/etymystery/>** (the published build serves
a 110-entry bank — 10 days of puzzles — built from `curated/`, so it is playable
end to end; see [CURATION.md](CURATION.md) for what grows it.)

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
      src/main.ts           round flow, timeline, reveal, summary
      src/game.ts           session state machine (pure, injectable storage)
      src/map.ts            SVG world map: zoom/pan, pin drops, reveal highlighting
      src/view.ts           zoom/pan maths (pure: clamp, zoom-at-cursor, inverse)
      src/slider.ts         timeline geometry (pure: tablet width, era slices)
      src/geo-context.ts    GeocodeContext over Natural Earth + country table
      src/countries.json    generated country table (ISO2 -> ccn3/region)
      public/word-bank.json         the bank, served as a static file
      public/countries-50m.json     world-atlas TopoJSON, 241 features (756 KB)
    curated/        hand-curated inputs (committed, small)
      language-geo.json     language code -> anchor countries + point overlay
      languages.tsv         seed language table (22 languages, bank v1)
      curation.json         seed words: attested year + tier + blurb
      seed-edges.csv        seed etymology edges (etymology-db schema)
      edge-overrides.csv    donor edges the source omits (see CURATION.md)
    tests/          vitest suites (251 tests)

## Commands

    npm install
    npm run typecheck      # tsc --noEmit
    npm test               # vitest run
    npm run dev            # vite dev server for web/ (http://localhost:5173)
    npm run build:web      # static build -> web/dist/
    npm run preview        # serve the built site
    npm run build:seed     # rebuild web/public/word-bank.json from curated/
    npm run gen:countries  # regenerate web/src/countries.json
    npm run curate -- --mode next|derive|merge|check|tier  # see CURATION.md for the process
    npm run admin          # local curation UI: word on the left, references on the right
    npx tsx scripts/fetch-senses.ts --from-batch data/curation-batch.json
                           # Wiktionary senses (POS + gloss + donors) for the batch
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
      [--extra-edges curated/edge-overrides.csv] [--no-overrides] \
      [--worklist data/curation-worklist.tsv]

## Playing it

`npm run dev` serves the game. Ten rounds a day, one per difficulty tier.
Each round: drop a pin where the word came from, place the year window on the
timeline, lock it in.

**The map** zooms and pans: scroll to zoom (toward the cursor), drag to pan,
double-click to zoom in, **two fingers to pinch** on a touch screen, and
`+` / `−` / `Reset` sit in the map's corner. A drag is never mistaken for a pin drop
— the gesture is only a click if the pointer stayed within a few pixels, and a pinch
never places a pin at all — and the pin markers are counter-scaled so they stay a
readable size at any zoom. Pins cannot be dragged off screen: panning and pinching
are clamped to the map's own edges.

On a narrow screen (< 640px) the era ruler under the slider is hidden, because four
absolutely positioned labels do not fit; the period names are still spelled out above
the slider (`1450 – 1550 · Middle English · Early Modern`). A custom range thumb is
aligned differently by touch engines: on a phone the tablet hung below the timeline
box, while desktop browsers centre it on the track. So `--thumb-lift` is 0 by default
and the thumb is lifted by half its height only in the touch layout
(`@media (hover: none) and (pointer: coarse)`).

**The timeline** asks for a **100-year window**, not a single year: the handle is a
tablet spanning exactly 100 years and it moves in 25-year steps (arrow keys work).
Any answer inside the window is a **perfect** temporal score; outside, the score
decays by how far out it fell. Above the slider the window reads as a range
(`1450 – 1550`) with every period it touches (`Middle English · Early Modern`) —
naming one period would be wrong a third of the time, since a 100-year window often
straddles a boundary. Both the tablet's width and the era scale below it are
derived from the same mapping (`web/src/slider.ts`), so the labels change exactly
when the handle crosses a period, not near it.

The timeline spans **700–2025** — a window position is the first year of the
player's 100 years, so the slider's last position is 1925 — with era markers
(Old English · Middle English · Early Modern · Modern), so medieval loanwords are
playable; that window lives in `src/timeline.ts` and is shared with the curation
tooling, so the tools can never disagree with what the game scores.

The hints name the gesture the device actually has: **pinch, drag and tap** on a
touch-first device (`(hover: none) and (pointer: coarse)`), and **scroll, drag and
click** — plus `←`/`→` for 25-year steps — with a mouse and keyboard. The wording
lives in `web/src/copy.ts` so the two vocabularies cannot drift apart, and a test
asserts no mouse-only word leaks into the touch set.

**Once you lock it in, the round is frozen for input**: the pin cannot be moved and
the window cannot be dragged, because the score is already persisted and a movable
guess would misrepresent it. The answer is then marked on the timeline: a green
circle on its year, or a green band across those years when the record only bounds
the date. Either way it shows *in front of* the tablet when the answer falls inside
your 100 years rather than disappearing behind it. Zoom and pan stay live — inspecting
the answer is what the map is for at that point. The reveal leads with the word in
medium type, then the answer in larger type (`Latin · first used around 1200`, or
`Old English · first recorded between 700 and 1150`) since the answer is what
the round was about, then the score chips, the credit line and the full origin route
**oldest first**, ending at English — `Latin → Old French → Middle English → English`
— with the hop you were asked about picked out in amber. The recorded chain can
continue older than that, to a reconstruction that has no place on the map, which
the reveal says plainly rather than leaving it looking like the answer. It also says
whether the window caught the year; progress is kept in
`localStorage` under `etymystery:v<bankVersion>:d<dayIndex>` so a reload mid-day
resumes and a finished day is never re-scored. `npm run build:web` emits a fully
static `web/dist/` — any file host serves it.

The committed `web/public/word-bank.json` is the **bank v2**: 110 entries across
10 balanced tiers (10 days of puzzles), 22 languages, built from
`curated/curation.json`. Rebuild it after curating — see "Ship it" in
[CURATION.md](CURATION.md); the old `npm run build:seed` path still exists as a
30-word stand-in for bootstrapping without the 4.2M-edge download.

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
   counted in the build report — this is the curation worklist. Entries are
   keyed by **sense**, not by word: `back`, or `back:noun`, or `bank:noun:2` for a
   second sense of the same part of speech (a word like `sole` has four recorded
   origins), with `pos` and `origin` fields saying which sense it is. A word no
   source dates precisely takes a **span** (`year` + `yearTo`, meaning "first used
   somewhere in here") instead of a fabricated year — and for the one word in six
   whose chain names an English period, `npm run curate -- --mode derive` writes that
   span for you, marked `"yearSource": "chain-period"` because no reference lookup is
   possible or pending. See [CURATION.md](CURATION.md).

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

### Correcting the source

The parse is faithful, not checked: it sometimes *skips a real, locatable
language*, which silently moves a puzzle's answer elsewhere (`coyote` reached
English via Spanish but the source jumps from Spanish straight to the
reconstruction Proto-Nahuan, so Nahuatl was unreachable and the answer became
Spain — a pin in Mexico scored zero). `curated/edge-overrides.csv` supplies the
missing hops; `build:bank` applies it by default and reports how many edges were
used. The full story, the rules for using it, and the follow-up step of re-reading
the `origins` column are in [CURATION.md](CURATION.md).

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
Two traps cost real puzzles before they were closed: choosing a *thin* sibling
route when the same word has a fuller recorded chain beneath it (that is how
`kiosk` came to ask about Persia while its blurb said Turkish), and writing a blurb
that names a language the route cannot credit — a player follows the prose, pins
that country, and is told they are wrong. `tests/reveal.test.ts` now enforces the
blurb rule over the shipped bank.
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

- **Temporal** (0-100): the player places a **100-year window**; any answer inside
  it scores 100 (answer years are century-granular, so demanding a tighter hit
  would be luck). Outside, the score decays as `exp(-years_out/100)`: one year out
  is 99, a century out is 37, two centuries out is 14. The slider's geometry lives
  in `src/scoring.ts` (`GUESS_SPAN_YEARS`, `GUESS_STEP_YEARS`) and the client's
  alignment maths in `web/src/slider.ts`.
  Many words have **no precise date**: an inherited word is recorded only by period
  ("in use by 1150"), so its answer is a **span** (`year`..`yearTo`) rather than one
  invented year. Any window *overlapping* the span scores 100, and the score decays
  by the gap to the nearer end; the reveal says `first recorded between 700 and 1150`
  and explains why, and the timeline draws the answer as a band instead of a dot.
  Curating a guessed year instead would make the player's score depend on the
  curator's coin flip — see "Undated words" in [CURATION.md](CURATION.md).
- **Geographic** (0-100), hop-aware, and the **country is the unit of knowledge**.
  The answer is anchored to the word's DEEPEST origin (e.g. Arabic for a word that
  went Arabic -> French -> English):
  - pin anywhere inside the deep origin's country: **full marks**. Where inside a
    country you pin is not evidence of a wrong answer: the answer point is a rough
    centroid for a historical language (Rome for Latin, Oslo for Old Norse), and
    dozens of mapped languages can share one country (20 of them claim Italy), so
    distance-to-centroid would penalise correct answers arbitrarily. The distance is
    still reported for the reveal, it just does not score;
  - pin inside an intermediate-hop country (e.g. France): direct hit only, flat 0.7,
    meaning "right route, right stop";
  - pin in the wrong country: proximity to the deep origin's *border* (not
    centroid), 1500 km decay scale;
  - a pin up to 25 km outside the answer's country still counts as inside
    (`COASTAL_TOLERANCE_KM`): clicks come from a 960x500 SVG over the outlines, and
    Istanbul — the obvious pin for an Ottoman Turkish answer — sat 10.8 km outside
    Turkey as the old 110m map drew it. It is far too small to rescue a real miss;
  - a territory the map cannot draw at all (Tuvalu, Tokelau — absent even from
    world-atlas 10m) is scored by distance to its **representative point** instead:
    on the point is full marks, and near it decays like any wrong-country pin. That
    is what keeps such an answer winnable rather than impossible, and it is the only
    place the answer point is used for scoring;
  - region/continent matches (UN M49 subregion / continent, anchored to
    the deep origin) are shown as reveal-time labels only; they never
    add points beyond border proximity;
  - outer limit: pins farther than 5000 km from every hop score 0.
  - Result: right country = 100, Saudi Arabia > France > wrong-but-near > zero
    (covered by explicit tests, including the Russia-vs-Netherlands and
    northern-Italy-for-Latin cases).
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

## Hosting

`npm run build:web` emits a fully static `web/dist/`, so any file host serves it.
The included workflow (`.github/workflows/pages.yml`) publishes it to GitHub
Pages on every push to `main`: it runs the typecheck and the test suite first, so
a red build cannot deploy.

Project sites are served from a subdirectory
(`https://<user>.github.io/<repo>/`), which is why `web/vite.config.ts` sets
`base: "./"` and the client fetches its data with document-relative paths
(`word-bank.json`, not `/word-bank.json`). Root-anchored URLs work locally and
404 on Pages, so keep both rules in mind when adding assets.

One-time setup, once per repository: **Settings → Pages → Source: GitHub
Actions.** Until that is set the deploy step fails with a permissions error
(a push cannot grant it). Pages on a private repository requires GitHub Pro or
Team; on any free plan the repository has to be public, or point the same build
output at another static host.

The published site serves whatever `web/public/word-bank.json` contains — today
bank v2: 110 entries, 10 days, every curated entry flagged `unverified` until a
human checks it against a reference (see [CURATION.md](CURATION.md)).

## Licensing

The code is **MIT** (see [LICENSE](LICENSE)); the word and etymology data is
**CC BY-SA 4.0** and requires attribution + share-alike, which this project honors
by publishing its curation artifacts rather than only the generated bank.
LICENSES.md has the full breakdown of sources and what is deliberately unused.

## Roadmap

- [x] Web UI: map (world-atlas TopoJSON + d3-geo), timeline selector,
      daily flow, reveal screens
- [~] Grow the curated bank to ~1-2k words (today: 119 curated words = 110
      banked entries = 10 days; the drafting loop and tier balancer exist, and
      every entry is flagged unverified until checked)
- [x] Frequency import (FrequencyWords / OpenSubtitles 2018) for the curation
      order and tier heuristics
- [ ] GitHub Action: nightly append-only bank rebuild + capacity report
