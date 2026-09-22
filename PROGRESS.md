# Etymystery — Progress / Resume Protocol

If a session drops, say "continue". Cline re-orients from this file, then runs:

    npx tsc --noEmit && npx vitest run && npx vite build web

## Status (as of 2026-09-21, session 3)

Engine + data pipeline + web client COMPLETE and playable end to end against a
30-word seed bank: 129/129 tests passing, typecheck clean, static build green.
Language geography is generated (312 languages from the real Wiktionary code
list, 96.9% of English donor rows covered) and the **real 4.2M-row etymology
dataset has been ingested**: the pipeline yields 41,985 candidate words whose
origin can be mapped, of which 17 are bankable today because only the 30 seed
words have curated years. Curation is the remaining bottleneck, not plumbing.

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

**Session 3 (cont.) — real dataset ingest** (this batch)

- The data comes from the repo's **GitHub release assets**, not the OneDrive
  links in its README:
  https://github.com/droher/etymology-db/releases/download/2023-12/etymology.csv.gz
  (143 MB gz / 456 MB / 4,222,599 rows). The OneDrive links 302 to
  microsoftpersonalcontent.com and 401 to any scripted client.
- scripts/filter-edges.ts + `npm run filter:edges`: chunk-safe streaming gzip ->
  CSV filter that keeps placeable-source donor rows and rewrites a minimal
  5-column CSV. 4,222,599 rows -> 771,573 (143 MB -> 9.1 MB) in ~20 s. Prints
  the blocked-donor histogram, which is the overlay work list.
- scripts/lib/edge-filter.ts: the filtering rules + stats + RFC 4180 quoting.
- createCsvRowParser in scripts/lib/etymology-db.ts: the CSV parser is now a
  chunk-safe state machine (deferred quote/CR decisions), so a 456 MB file can
  be streamed; forEachCsvRow is a thin wrapper and behavior is unchanged.
- bank-builder now normalizes etymology-db language NAMES to CODES (the real
  file says "Ancient Greek"; our table is keyed "grc"); without this the real
  dataset produced an EMPTY bank.
- bank-builder gained `deepestAttested` (anchor to the deepest PLACEABLE hop)
  and `onUncurated` (work-list callback); build-bank gained `--deepest-attested`
  and `--worklist`, plus a readable report instead of a JSON dump.
- curated/language-geo.json grew to 280 entries / 312 generated languages,
  driven by the real donor histogram: Ancient Greek (the #3 donor), Low and
  Middle Low German, Frisian varieties, New/Renaissance/Medieval/Vulgar Latin,
  Frankish, Gaulish, Old/Middle Chinese, Tocharian A/B, Hittite, Classical
  Persian, Classical Nahuatl, Old Tupi, Creoles, regional French/Spanish/
  Portuguese/German, native American and Australian languages, ...
- isCandidateTerm no longer accepts prefix/suffix stubs ("ab-", "acantho-",
  which Wiktionary stores as terms): 255 such rows were in the first work list.
- Real run (bank v2 candidate, epoch 20717 = same as v1 so day numbering is
  continuous): 41,985 candidate words, 17 bankable, 37,211 awaiting a curated
  year, 0 invalid; --deepest-attested recovers 4,141 more (41,348 awaiting) and
  cuts unplaceable deepest languages from 251 to 161. Work list:
  data/curation-worklist.tsv (word, tier, chain depth, deepest language, chain).
- tests: 129 total (+11) incl. chunk-safety, filter rules, and a name-keyed
  end-to-end build covering the normalization seam.

## Verification (re-run before trusting anything)

    npx tsc --noEmit          # clean
    npx vitest run            # 129 passed (10 files)
    npx vite build web        # 59.93 kB js (20.13 kB gzip), 2.63 kB css
    npx tsx scripts/bootstrap-languages.ts --codes data/wiktionary_codes.csv \
      --out data/languages.tsv   # 312 languages, 0 overlay typos
    npx tsx scripts/filter-edges.ts --edges data/etymology-db.csv.gz \
      --languages data/languages.tsv --out data/edges-filtered.csv.gz
                                 # 4,222,599 rows -> 771,573 kept, ~20 s
    npx tsx scripts/build-bank.ts --edges data/edges-filtered.csv.gz \
      --languages data/languages.tsv --curation curated/curation.json \
      --out data/word-bank.json --version 2 --epoch-start 2026-09-21 \
      --worklist data/curation-worklist.tsv
                                 # 41,985 candidates, 17 bankable, 37,211 uncurated

## Remaining (next session)

1. Curation is now THE bottleneck (everything upstream works):
   a. Add a frequency signal so 37k candidates can be ranked, then curate the
      top ~1-2k words' years by hand (years are facts). This is the "frequency
      import" roadmap item and it is now a prerequisite, not a nicety: the raw
      work list is alphabetical and full of rarities (`aalii`, `aardtappel`).
   b. Build the real bank as `appendToBank(v1, curatedWords)` with the SAME
      epoch (20717) and version bump, so shipped tier positions never move.
   c. Ship it: copy to web/public/word-bank.json, rebuild the web app.
2. Decide the proto-language policy with the numbers now available:
   default (respect "deepest origin") = 17 bankable / 4,141 words lost;
   `--deepest-attested` = 21 bankable / 4,137 recovered. The lost words' answers
   would be reconstructions (Proto-Indo-European, Proto-Germanic, ...), which
   have no defensible home on a modern map.
3. GitHub Action: typecheck + tests + validate the shipped bank + days-of-play
   countdown (works today; the nightly rebuild needs the 143 MB asset).
4. Publish: create a remote and host web/dist (nothing is published yet).
5. Optional polish (not requested): share/streak summary, per-round distance
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
- etymology-db's `lang` column holds language NAMES ("Ancient Greek", "Middle
  English"), NOT codes. Anything that keys by code must normalize first; the
  bank builder does this via the name column of languages.tsv. This seam
  silently produced an EMPTY bank from the real file before it was fixed.
- Download etymology-db from its GitHub RELEASE ASSETS, not the OneDrive links
  in its README: `releases/download/2023-12/etymology.csv.gz`. OneDrive returns
  302 -> microsoftpersonalcontent.com -> 401 for any scripted client.
- Streaming CSV parsing must never look ahead (`chunk[i + 1]`) to decide an
  escaped quote: the next character can live in the next chunk. The parser uses
  deferred state (pendingQuote/pendingCr) and a test feeds it one character at a
  time. CRLF inside a quoted field is normalized to LF so terms stay clean.
- `isCandidateTerm` must reject prefix/suffix stubs (`ab-`, `acantho-`): both
  ends have to be letters, otherwise 255 junk "words" reach the curation list.
- A successor bank must reuse bank v1's epoch (20717) and be produced with
  appendToBank, otherwise `dayIndexFor` shifts and served puzzles change.
- The pipeline is now big enough that profiling with shell tools pays off:
  `zcat file.csv.gz | awk -F, '$2=="en"'` and a short Python csv pass answered
  the coverage questions in seconds without writing code.
- run_commands batch items really do run CONCURRENTLY: a language-coverage check
  read data/languages.tsv *while* the bootstrap step was rewriting it and
  reported stale numbers. Chain dependent steps in ONE command string.
