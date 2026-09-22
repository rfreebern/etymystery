# Etymystery — Progress / Resume Protocol

If a session drops, say "continue". Cline re-orients from this file, then runs:

    npx tsc --noEmit && npx vitest run && npx vite build web

## Status (as of 2026-09-21, session 3)

Engine + data pipeline + web client COMPLETE and playable end to end against a
30-word seed bank: 118/118 tests passing, typecheck clean, static build green.
Language geography is now generated (237 languages from the real Wiktionary
code list) rather than hand-written. The 4.2M-edge etymology dataset is the only
missing input, and it needs a manual OneDrive download (see Remaining).

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

**Session 3 — language geography bootstrap** (this batch)

- curated/language-geo.json — hand-curated overlay: anchor countries + answer
  point for 188 language codes, including historical (Latin, Old Norse, Old
  English, Koine/Byzantine Greek, Old Church Slavonic, Akkadian, Avestan …) and
  17 reconstruct-only proto languages marked `kind: "proto"`.
- scripts/lib/language-geo.ts — testable core: parses the code list, merges the
  overlay with a derivation from world-countries (name matching + aliases, modal
  subregion/continent, area-weighted representative point), excludes proto codes
  by default, reports what it could not place, and serializes the TSV contract.
- scripts/bootstrap-languages.ts — CLI (+ `npm run bootstrap:languages`);
  writes data/languages.tsv, self-checks by re-parsing with the production
  parser, and warns about overlay codes Wiktionary does not define.
- tests/language-geo.test.ts (16 tests) incl. that the overlay reproduces the
  committed 22-language seed table exactly (bank v1 stays reproducible).
- Result on the real 8,652-code list: 237 languages (188 overlay, 49 derived,
  268 proto skipped, 8,147 unmatched dialects/etymology-only codes).

## Verification (re-run before trusting anything)

    npx tsc --noEmit          # clean
    npx vitest run            # 118 passed (9 files)
    npx vite build web        # 59.93 kB js (20.13 kB gzip), 2.63 kB css
    npx tsx scripts/bootstrap-languages.ts --codes data/wiktionary_codes.csv \
      --out data/languages.tsv   # 237 languages, 0 overlay typos

## Remaining (next session)

1. Real curation — in this order:
   a. Download the etymology-db CSV by HAND in a browser (its OneDrive share
      link 302s to microsoftpersonalcontent.com and returns 401 to curl, so it
      cannot be fetched with a tool without an authenticated session) and save
      it as data/etymology-db.csv.gz. data/ is gitignored on purpose.
   b. curl -o data/wiktionary_codes.csv \
        https://raw.githubusercontent.com/droher/etymology-db/master/wiktionary_codes.csv
      npm run bootstrap:languages -- --codes data/wiktionary_codes.csv
   c. npm run build:bank -- --edges data/etymology-db.csv.gz \
        --languages data/languages.tsv --curation curated/curation.json \
        --out data/word-bank.json --version 2
      Then read the report: `missingLanguage` is the overlay growth work list
      (current snapshot from the code list: Austrian German, Canadian/Acadian
      French, Kölsch, Insular/Borders Scots, Middle Irish (MIr.), Lombardic, and
      the Latin/Greek abbreviations LL/ML/EL.), `missingYear` is the curation
      work list.
   d. Hand-curate years for the top candidates, re-run, then append to the
      shipped bank (appendToBank — never re-shuffle shipped positions).
      Capacity today is 3 days of play; ~1-2k words = 100-200 days.
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
- wiktionary_codes.csv contains NAME-SHAPED codes (`Late Latin`, `Koine`,
  `British English`) and abbreviations (`LL`, `ML`, `EL.`) alongside ISO ones.
  Do not invent codes: two of my first overlay drafts used `ave` and `ku`, which
  do not exist (Avestan is `ae`, Kurdish is `ckb`/`kmr`/`sdh`). The CLI prints
  an "overlay codes not present in the Wiktionary list (typos?)" warning — heed
  it.
- world-countries region names are CLDR-flavoured, not strict UN M49: expect
  `Central Europe`, `Southeast Europe`, `North America`,
  `Australia and New Zealand`. Overlay labels are derived from anchor countries
  for exactly this reason; only specify them by hand when a multi-country tie
  would resolve alphabetically (see the Koine Greek note).
- The language `region`/`continent` in languages.tsv are DISPLAY metadata only.
  scoreGeographic compares the pinned country's metadata against the deep
  origin's FIRST country via GeocodeContext.regionOf() on both sides, so a
  vocabulary mismatch in languages.tsv cannot corrupt scoring. Both sides come
  from web/src/countries.json.
- 268 of the 8,652 Wiktionary codes are `*-pro` reconstructions. They are
  excluded by default because anchoring a reconstruction to a modern country is
  indefensible; `--include-proto` adds only the 17 that are in the overlay, so
  it is not a way to recover the other 251.
- Generated files never live in git: `data/languages.tsv` is derived from the
  public code list + the committed overlay, so regenerate it rather than
  committing it. `curated/` holds only the small hand-authored artifacts.
