# Etymystery — Progress / Resume Protocol

If a session drops, say "continue". Cline re-orients from this file, then runs:

    npx tsc --noEmit && npx vitest run && npx vite build web

## Status (as of 2026-09-21, session 2)

Engine + data pipeline + web client COMPLETE and playable end to end against a
30-word seed bank: 102/102 tests passing, typecheck clean, static build green.

## Done

**Session 1 — engine, pipeline, scoring** (commits `9d64bb6`, `dee7263`)

- Scaffold: package.json (TS + Vitest + tsx), tsconfig, .gitignore,
  vitest.config.ts
- src/types.ts — BankEntry, LanguageInfo, WordBank, RoundGuess, RoundScore
- src/prng.ts — mulberry32 + FNV-1a + Fisher-Yates (deterministic)
- src/bank.ts — buildWordBank, strict interleave (exactly 10 rounds/day, one per
  tier), appendToBank (append-only versioning), validateEntry, validateBank
  (duplicate word/id + tamper detection)
- src/daily.ts — UTC day math + getDailyPuzzle (pure fn of date + bank)
- src/scoring.ts — scoreTemporal (50y window, 100y decay), scoreGeographic,
  scoreRound, GeocodeContext adapter (pluggable map)
- scripts/lib/etymology-db.ts — streaming RFC4180 CSV, header detection,
  donor-relation filter (7 relations, priority-ordered), multi-hop chain walker
  with cycle pruning
- scripts/lib/languages.ts — languages.tsv parser (code/name/countries/region/
  continent/lat/lng)
- scripts/lib/tiering.ts — chain-depth + frequency tier heuristic
- scripts/lib/bank-builder.ts — orchestration + build report (curation
  worklist: missingYear, missingLanguage, skippedEntries, warnings)
- scripts/build-bank.ts — CLI (gzip support, arg validation, report)
- Scoring v2 (hop-aware): answer anchored to the DEEPEST origin; intermediate
  hops score only on a direct pin (weight 0.7); outer limit 5000 km = 0;
  region/continent matches are reveal LABELS only and never add points beyond
  border proximity (user rule); GeocodeContext gained languageOf()
- README.md, LICENSES.md

**Session 2 — geometry, curation seed, web client** (this batch)

- src/geo-utils.ts — haversineKm (moved out of scoring.ts, still re-exported
  there), distanceToSegmentKm, distanceToGeometryKm (border distance over every
  ring), ringContains (planar ray cast). This is what makes border-proximity
  scoring real rather than centroid-based.
- scripts/gen-countries.ts — world-countries -> web/src/countries.json (250
  entries: ISO2 -> ccn3, name, subregion, continent)
- web/src/geo-context.ts — real GeocodeContext: geoContains + border distance
  over Natural Earth features; toCountryFeatures() joins world-atlas numeric
  ids to ISO2 through ccn3
- web/src/map.ts — SVG map (geoNaturalEarth1, 960x500 viewBox, responsive via
  CSS width), click-to-pin with antimeridian wrap, reveal highlight by ISO
- web/src/game.ts — DOM-free session machine: loadSession / currentRoundIndex /
  submitGuess / isComplete / summarize over an injectable StorageLike
- web/src/main.ts — round flow: word -> pin + year slider (1500..2025) -> a pin
  is mandatory before submit -> reveal (year/map/round chips, route, blurb) ->
  summary with per-round grid and a session reset
- web/index.html, web/src/style.css — static page with data attribution footer
- curated/ — seed-edges.csv (32 edges), languages.tsv (22 languages),
  curation.json (30 words, hand-checked years + blurbs)
- web/public/word-bank.json — seed bank v1: 10 tiers x 3 words = 30 words,
  22 languages, 3 days of puzzles, epoch 2026-09-21
- web/public/countries-110m.json — world-atlas TopoJSON (Natural Earth)
- New tests: geo-utils.test.ts (11), geo-context.test.ts (5, incl. the real-map
  Vladivostok-beats-Utrecht case), game.test.ts (5) -> 102 total

## Verification (re-run before trusting anything)

    npx tsc --noEmit          # clean
    npx vitest run            # 102 passed (8 files)
    npx vite build web        # 59.93 kB js (20.13 kB gzip), 2.63 kB css

## Remaining (next session)

1. Real curation: download the etymology-db CSV (OneDrive links in its README),
   bootstrap languages.tsv from its wiktionary_codes.csv, then hand-curate
   curation.json (years are facts — check them by hand) up to ~1-2k words and
   run `npm run build:seed`. Capacity today is 3 days of play.
2. GitHub Action: nightly append-only bank rebuild + capacity report.
3. Optional polish (not requested): share/streak summary, per-round distance
   readout on reveal, keyboard + screen-reader pass over slider and map.

## Gotchas learned (do not re-fight)

- run_commands batch items may execute CONCURRENTLY — never rely on
  cross-command ordering; chain dependent steps with && in ONE command.
- Object.keys() on a Map returns [] — spread to arrays first.
- Editor payloads should stay under ~6000 chars; larger files go via heredoc.
- npm blocks esbuild postinstall but tsx works (binary via optional dep).
- etymology-db schema: term_id, lang, term, reltype, related_term_id,
  related_lang, related_term, position, group_tag, parent_tag,
  parent_position; donor relations: *borrowing_from (prio 0),
  inherited_from (1), derived_from (2).
- d3-geo is winding-sensitive: exterior rings must be clockwise or geoContains
  answers inside-out. Test fixture rects therefore run [lonMin,latMin] ->
  [lonMin,latMax] -> [lonMax,latMax] -> [lonMax,latMin].
- world-atlas TopoJSON feature ids are UN M49 numeric codes, NOT ISO2. Join
  them via web/src/countries.json (ccn3 -> cca2) using toCountryFeatures().
- Vite runs config-free here: `vite web` implies root=web and
  publicDir=web/public, so the client fetches "/word-bank.json" and
  "/countries-110m.json".
- web/src/countries.json is generated (npm run gen:countries) and
  web/public/word-bank.json is generated (npm run build:seed) — never hand-edit
  them; edit curated/ or scripts/ instead.
- getDailyPuzzle throws once the bank is exhausted; main.ts catches that and
  shows the "bank exhausted" panel. That is the signal a new bank version is
  due, not a bug.
- Commit identity for this repo is `etymystery <dev@etymystery.local>`, applied
  with `git -c user.name=... -c user.email=...` (it differs from the global
  git config, so plain `git commit` would break history consistency).
