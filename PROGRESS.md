# Etymystery — Progress / Resume Protocol

If a session drops, say "continue". Cline re-orients from this file, then runs:

    npx tsc --noEmit && npx vitest run && npx vite build web

## Status (as of 2026-09-21, session 3)

Engine + data pipeline + web client COMPLETE and playable end to end against a
30-word seed bank: 166/166 tests passing, typecheck clean, static build green.
Language geography is generated (312 languages from the real Wiktionary code
list, 96.9% of English donor rows covered) and the **real 4.2M-row etymology
dataset has been ingested**: 41,985 candidate words whose origin can be mapped,
17 bankable today because only the 30 seed words have curated years. Curation is
the bottleneck, and it is now **ordered** (frequency rank: 2,380 of the top 5,000
English words usable once English-origin words are excluded) and **tooled**
(`npm run curate` for the loop, `npm run admin` for the word-plus-references UI).
The timeline window was widened to **700–2025** in `src/timeline.ts`, which
retroactively fixed three unwinnable rounds in the shipped bank.

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

**Session 3 (cont. 2) — frequency ranking for the curation order** (this batch)

- scripts/lib/frequency.ts: parses rank lists in "word count" (FrequencyWords,
  CC BY-SA 4.0 via OpenSubtitles 2018), "word<TAB>count" (wordfreq exports) or
  bare-word forms; ranks by count, normalizes case, keeps the best rank for
  duplicates, deterministic on ties.
- build-bank `--frequency <file>`: ranks the work list (most common first,
  unranked rarities last) and feeds `assignTier`'s existing frequencyRank input;
  new work-list column `freq_rank`; prints a frequency coverage curve and the 15
  most common uncurated words.
- Measurements: coverage of the 41,985 candidates — top 1k 584, 5k 2,380,
  10k 4,065, 50k 11,349. Raw frequency ordering surfaced a PRODUCT problem: the
  first rows are function words (`you`, `the`, `to`, `that`) whose answer is
  always "England ~900 AD", i.e. a game where always pinning Britain is optimal.
- build-bank `--exclude-origin en,ang,enm`: drops words whose answer origin is
  the asker's own language/country (10,622 words), leaving 26,590 candidates that
  begin with `just` ← Old French, `must` ← Middle Persian, `money` ← Old French.
- build-bank `--worklist-only` + `assembleBank: false`: generate the report and
  work list without assembling a shippable bank. Needed because a filter can
  legitimately empty a tier while only 30 words are curated, and validateBank
  rightly refuses to emit such a bank. `buildBankFromInputs` now returns
  `bank: WordBank | null`.
- LICENSES.md: FrequencyWords/OpenSubtitles attribution, world-countries row, and
  an explicit note that Google-corpus lists and SUBTLEX-derived data are avoided
  while the chosen source is CC BY-SA 4.0.
- tests: 138 total (+9) for parsing/ranking, origin exclusion, and the
  unranked-candidate count.

**Session 3 (cont. 3) — curation loop tooling** (this batch)

- CURATION.md: the end-to-end process (setup, batch, per-word research rules,
  merge, check, ship, plus the timeline-window decision and the budget).
- scripts/lib/curation.ts + scripts/curate.ts (`npm run curate`): `--mode next`
  picks the next uncurated words (skipping curated + a skip list) and writes a
  skeleton batch with the proposed chain; `--mode merge` refuses entries without
  a year, folds them into curated/curation.json in the hand-written one-line
  style (verified byte-stable: merging a finished file is a no-op diff), and
  reports what needs attention; `--mode check` reports curated count, per-tier
  histogram, days-of-play capacity and all issues.
- The audit quantifies unplayable years using the same decay envelope as
  scoreTemporal, so "this round can never score above N/100" is printed rather
  than guessed.
- Finding: the shipped slider (1500..2025) cannot express `they` (1200, max
  score 8/100), `window` (1225, 11) or `orange` (1300, 22). Since a large share
  of the most common interesting words are Middle English loanwords attested
  before 1500, this must be decided (widen the window vs exclude pre-1500 words)
  before curating in volume.
- Finding: `curated/curation.json` is DEMO data — its 30 words were curated
  against the hand-written seed fixture, so only 17 of them have a chain in the
  real 4.2M-row dataset. Starting real curation means treating it as the seed of
  a new file, not as already-done work.
- tests: 148 total (+10) for work-list parsing, batch selection, the audit rules
  (including agreement with scoreTemporal on out-of-range years) and merging.

**Session 3 (cont. 4) — local curation admin app** (this batch)

- admin/ — a zero-dependency local app (`npm run admin`, http://127.0.0.1:8765):
  word + proposed chain + answer + the three fields on the left, every reference
  source for that word on the right, so dating a word is one screen instead of
  five tabs.
- admin/sources.ts: ten reference sources with URL builders. Framing support was
  MEASURED with curl, not assumed: Etymonline, Wiktionary (article and raw
  wikitext), Google Ngrams, The Free Dictionary, archive.org and Bing send no
  framing restriction; Merriam-Webster, HathiTrust and OED send
  `X-Frame-Options: SAMEORIGIN` and render as one-click link cards instead.
- admin/store.ts: state + persistence over the same files as the CLI
  (data/curation-batch.json, data/skip-words.txt, curated/curation.json), so the
  app and `npm run curate` are interchangeable. Merge keeps a `.bak` copy.
- admin/server.ts: node:http only, bound to 127.0.0.1, static assets + six JSON
  routes, 64 KB body cap, no directory traversal. Exported as createAdminServer()
  so tests bind port 0 and no process is spawned.
- Keyboard-first flow: Enter saves and advances, arrows navigate (an entered year
  is saved on the way so research is never lost), digits jump between sources.
- It never fetches a reference site server-side: iframes are the browser loading
  pages a human could open, which keeps Etymonline's ToS intact (LICENSES.md).
- tests: 161 total (+13) covering URL building, the measured framing flags, queue
  building, batch pulls, save/skip/merge semantics and a real HTTP round trip
  (page, assets, path traversal, state, sources, save, validation error, merge).

**Session 3 (cont. 5) — timeline window widened to 700–2025** (this batch)

- src/timeline.ts — the window is now defined ONCE: `ANSWER_YEAR_MIN = 700`,
  `ANSWER_YEAR_MAX = 2025`, the `ERAS` labels the slider shows, `isPlayableYear()`
  and `bestPossibleTemporal()`, which delegates to the real `scoreTemporal`. A
  mirrored copy of a scoring formula is exactly how the tooling drifted before.
- web/src/main.ts: slider min/max and the year label come from that module, so the
  label reads "1400 · Middle English", with an era scale under the slider — a
  1,300-year range is unreadable without periods.
- Propagated to every other copy, removing four more hardcoded values:
  scripts/curate.ts (`--floor`/`--ceiling` defaults), admin/store.ts (audit window,
  now also returned in the API state), admin/public/app.js (reads the window from
  the server instead of literals) and scripts/lib/curation.ts (imports the shared
  helper).
- Effect: the three previously unwinnable shipped rounds are fixed with no bank
  rebuild (`they` 1200, `window` 1225, `orange` 1300 can now reach 100/100); the
  CLI audit drops from 16 issues to 13 with ZERO "outside the slider" flags; the
  admin API reports yearFloor 700 / yearCeiling 2025.
- Rationale for 700: the start of the English written record. It makes the Old
  English loanword layer (`cheese`, `butter`, `mile`, `church`, `pepper` — Latin
  and Greek before 1150) curatable instead of unusable. The wider window does make
  the temporal axis harder, which is what the tier ladder is for.
- tests: 166 total (+5) for the window constants, era boundaries (no gaps or
  overlaps), playability, and agreement between bestPossibleTemporal and the real
  scorer at both ends of the window.

## Verification (re-run before trusting anything)

    npx tsc --noEmit          # clean
    npx vitest run            # 166 passed (14 files)
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
    # ranked curation order (add --frequency data/en-frequency.txt):
    npx tsx scripts/build-bank.ts --edges data/edges-filtered.csv.gz \
      --languages data/languages.tsv --curation curated/curation.json \
      --out /dev/null --version 2 --frequency data/en-frequency.txt \
      --exclude-origin en,ang,enm --worklist-only \
      --worklist data/curation-worklist-interesting.tsv
                                 # 26,590 words; top 5k coverage 1,007

## Remaining (next session)

1. Curate — the process is in CURATION.md, the window is settled (700–2025), and
   the tools are ready (`npm run admin` is the fastest path). Then:
   a. `npm run curate -- --mode next --limit 25`, research each word (verify the
      CHAIN as well as the year — the chain is a claim from an unvalidated
      parse), `--mode merge`, `--mode check` for capacity.
   b. Treat the 30 existing entries as demo data: only 17 have a chain in the
      real dataset, so most of the file is fixture-based history.
   c. Build the real bank as `appendToBank(v1, curatedWords)` with the SAME
      epoch (20717) and version bump, so shipped tier positions never move.
   d. Ship it: copy to web/public/word-bank.json, rebuild the web app.
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
- Rank the work list by frequency, but do NOT ship that order raw: the most
  common English words are function words whose answer is the asker's own
  country (`the`, `you`, `to`, `that` -> England). Exclude `en,ang,enm` for the
  curation order (10,622 words).
- etymology-db chains are UNVALIDATED (its README says so). Spot checks show
  dubious relations (`name` <- Wolof, `so` <- Japanese), so the chain is a claim
  the curator must check, not just the year.
- A curation filter can legitimately empty a tier (only 30 words are curated),
  and validateBank then refuses to emit a bank. Use `--worklist-only`
  (assembleBank: false) to get the report and work list anyway; `bank` in the
  result is nullable because of it.
- Frequency source choice is a licensing decision: FrequencyWords is CC BY-SA 4.0
  (attribution to OpenSubtitles required) and plain text; the Google Trillion
  corpus lists have no explicit license and SUBTLEX redistribution needs
  permission, so both are deliberately unused. Update LICENSES.md whenever a new
  data source enters the pipeline.
- The work list contains only UNCURATED candidates, so `auditCuration` needs the
  bank as well to tell a legitimately-curated word from a typo: a typo never gets
  a chain, so it never reaches the bank and is still flagged. `--bank
  data/word-bank.json` must be built with the SAME flags as the work list.
- `curated/curation.json` is demo data curated against the hand-written seed
  fixture: only 17 of its 30 words have a chain in the real dataset, so `--mode
  check` reports the rest as "no mappable chain". That is correct, not a bug.
- The curation file's order is normalised to alphabetical by `--mode merge`
  (it was hand-grouped by tier). Content is unchanged; the writer is otherwise
  byte-stable, so merging a finished file is a no-op diff.
- Do not `pkill -f 'tsx admin/server.ts'` from a shell whose own command line
  contains that string: pkill matches itself and kills the shell mid-command
  (the server does stop, but the rest of the command line never runs). Use a PID
  file or `pkill -f 'admin/server'` after the shell exits.
- The admin server is single-instance by design: createAdminServer() injects its
  paths into module-level state rather than closing over them, which keeps the
  request handler a plain function. One server per process; tests get their own
  temp data dir via the factory.
- Reference sites' framing headers must be re-measured if the source list grows:
  embedding is only legal/possible where the site allows it, and the app's
  framable flags are the record of what was measured.
- The answer window was hardcoded in FIVE places (web slider, curate CLI, admin
  store, admin client, docs) and they had already drifted: the slider said 1500
  while the shipped bank contained 1200/1225/1300 answers. Anything the game
  scores and the tools validate must live in one module (`src/timeline.ts`), and
  the client must read it from the API rather than keep a copy.
- Never mirror a scoring formula in tooling: `bestPossibleTemporal` used to
  re-implement the decay envelope and could silently disagree with
  `scoreTemporal`. It now calls the real scorer with the clamped year, and a test
  asserts they agree at both ends of the window.
