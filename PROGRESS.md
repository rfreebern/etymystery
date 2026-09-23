# Etymystery — Progress / Resume Protocol

If a session drops, say "continue". Cline re-orients from this file, then runs:

    npx tsc --noEmit && npx vitest run && npx vite build web

## Status (as of 2026-09-21, session 5)

Engine + pipeline + web client COMPLETE, published at
<https://rfreebern.github.io/etymystery/> (GitHub Pages, auto-deployed from
`main`): 269/269 tests passing, typecheck clean, static build green. The bank is
110 entries / 10 days from 119 curated words, all flagged `unverified` until a
human checks the dates against a reference. Session 5 reworked the two inputs: the
map now zooms and pans, and the timeline asks for a **100-year window** (tablet
handle, 25-year steps, answer inside the window = perfect temporal score) instead
of a single year — with the slider/era-scale geometry now derived from one mapping
so the period labels change exactly where the handle crosses them.

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
- web/public/countries-50m.json — world-atlas TopoJSON (Natural Earth, 241 features)
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

**Session 3 (cont. 6) — admin app ergonomics** (this batch)

- Merriam-Webster now always links to the `#word-history` anchor: the dated note
  is the only part of the page worth reading for curation, and M-W blocks framing
  with `X-Frame-Options: SAMEORIGIN` so it can only be linked.
- Removed the OED source (no access); the source list is 9 now — 7 embeddable
  iframes plus Merriam-Webster and HathiTrust as link cards.
- Shortcut discoverability: a `?` help panel listing every key with a description
  (toggle with `?`, the header button, or Escape), inline `<kbd>` hints on the
  buttons themselves (Save & next = Enter, Save = Shift+Enter, Skip = s,
  Merge = m), and the source numbers that were already in each header act as the
  digit-jump hint. `Shift+Enter` now really saves without advancing, so the hint
  is true rather than aspirational.
- Iframe zoom: frames render at 80% by default (`z` cycles 60→100%, or pick from
  the header; the choice persists in localStorage). Implementation is the
  oversize-and-scale trick — the iframe viewport is made 1/zoom larger and then
  `transform: scale(zoom)` from the top-left inside a fixed-height wrapper — which
  also makes the embedded site lay out wider, so noticeably more of each
  reference page is visible without scrolling.
- New regression guard: admin/public/app.js is neither typechecked nor imported
  by any test, so `new Function(source)` compiles it inside a test plus a check for
  TypeScript-only syntax. That guard immediately caught a real bug I introduced —
  a non-null assertion (`ZOOM_STEPS[next]!`) that tsc happily accepted in a .ts
  file but which is a hard syntax error in a browser, i.e. the whole app would
  have failed to load.
- tests: 170 total (+4) for the M-W anchor, the removed source, client-JS
  parsability/wiring, and the zoom/help markup.

**Session 3 (cont. 7) — part of speech and multiple origins** (this batch)

- Found while the curator examined `back`: the real data has six donor edges for
  it, covering two different senses — inherited from Old English (`bæc`) in one,
  borrowed from French (`bac`) in another. The pipeline's tie-break prefers
  borrowings, so it silently anchored `back` to Middle French: the game would
  have graded "French" as correct for a native English word. No automatic rule
  can fix that, because the branches are different senses.
- buildChainsWithVariants (new; buildChains delegates to it): returns every
  distinct chain per word alongside the chosen one, so a homograph is visible
  instead of collapsed. 14,127 of 41,985 candidates (~34%) have more than one
  recorded origin.
- The work list gained an `origins` column, and the report/`check` count
  ambiguous candidates. An origin is a variant's deepest *placeable* hop, so a
  branch buried under a reconstruction (Old English under Proto-West Germanic,
  as with `back`) still offers Old English as an answer — my first attempt
  mirrored the "deepest hop" rule here and hid exactly that sense.
- curation.json gained `pos` and `origin`. `origin` overrides the tie-break: the
  builder picks the matching variant and anchors to the deepest placeable hop,
  warns and skips an origin the data does not support, and the audit insists on
  both fields for homographs. BankEntry carries `pos` (validated as a lowercase
  label) and the web client now asks "Where did this noun originally come from…?"
- Curation surfaces: the app shows a warning with "N recorded origins", a POS
  field (with suggestions) and an origin picker; `--mode next` prints them.
- tests: 176 total (+6): variant detection, the origin override under a proto hop,
  refusal of an unsupported origin, the audit's pos/origin rules, and the
  extended work-list column.

**Session 3 (cont. 8) — published to GitHub Pages** (this batch)

- Pushed `main` to `git@github.com:rfreebern/etymystery.git` (the remote already
  pointed at the last green commit, so this was a fast-forward).
- .github/workflows/pages.yml: on pushes to `main` (and manually) it runs `npm ci`,
  the typecheck and the test suite, builds `web/dist`, then deploys with
  configure-pages/upload-pages-artifact/deploy-pages. Tests gate the deploy, so a
  red build cannot publish.
- web/vite.config.ts (new) sets `base: "./"`, and the client now fetches
  `word-bank.json` / `countries-110m.json` document-relative instead of from the
  domain root. Project sites live at `/<repo>/`, so the previous root-anchored
  URLs would have 404'd: verified by serving the build from a subdirectory — page,
  both assets and both data files returned 200, while the old root-anchored paths
  returned 404.
- The served bank was validated over HTTP with the real `validateBank` (v1, 10
  rounds/day, 30 words), and the built bundle contains no absolute
  `/word-bank.json` reference.
- README gained a "Hosting" section, including the one step that cannot be done
  from a push: Settings → Pages → Source: GitHub Actions.
- The one-entry-per-sense refactor is parked on branch `feat/one-entry-per-pos`
  (commit 5caf295) so `main` stayed shippable; it does not typecheck yet and is the
  next piece of work.

**Session 3 (cont. 9) — one entry per sense** (this batch)

- A puzzle entry is a SENSE, not a word: different senses have different origins
  and dates (`back` is inherited from Old English in one sense, borrowed from
  French in another; `sole` has four recorded origins), so the work list is one
  row per sense and each row is its own entry.
- Sense keys are the bank's ids: `word`, `word:pos`, or `word:pos:2` for a second
  sense of the same part of speech (`bank:noun` the river vs `bank:noun:2` the
  money). parseSenseKey / composeSenseKey / senseId / wordOfSenseId live in
  scripts/lib/curation.ts; `mergeCuration` composes the key from the curator's
  `pos` and bumps to `:2` when that key is already taken by another origin.
- Work list: 62,469 candidate senses from 41,985 words (an `origin` and `sense`
  column per row). Coverage of the top 1k words rose from 163 to 661 senses,
  because a word is no longer dropped when one of its senses is excluded.
- bank-builder emits one entry per curated sense, anchors each to the deepest
  placeable hop of its own branch, and marks a filtered-out sense as settled so it
  cannot reappear as an uncurated candidate. A homograph with no curated `origin`
  still falls back to the tie-break (so the demo bank keeps building) but the
  report counts it — 11 entries today. `--deepest-attested` is gone: anchoring per
  sense to the deepest placeable hop is the only sensible behaviour now.
- admin app: the queue is senses, each card shows that sense's origin and chain
  with a live "files as" key preview, the origin picker is gone (the card *is* the
  sense) and Skip skips one sense. `saveEntry` keeps the sense's origin when a
  caller omits it.
- The code is MIT (LICENSE, package.json, LICENSES.md splitting code from the
  CC BY-SA data), and README gained play/hosting/licensing sections.
- tests: 189 total (+13) for sense keys, per-sense queueing, settled-sense logic,
  key composition, ordinal collisions, and one-row-per-sense parsing.

**Session 4 — curation drafting, provenance, tier balance** (this batch)

- The real download URL (the repo's README only advertises dead OneDrive links):
  https://github.com/droher/etymology-db/releases/download/2023-12/etymology.csv.gz
- **Drafted 89 curated entries** (years + pos + the verified origin + blurbs) for
  high-frequency loanwords: the Arabic/Persian layer (hazard, algebra, alcohol,
  sugar, magazine, monsoon, sofa, cotton, lemon, cipher), Indic (shampoo,
  bungalow, bandana, thug, yoga), Chinese/Japanese (ketchup, soy), the Taïno and
  Nahuatl contact layer (hurricane, barbecue, canoe, hammock, maize, potato,
  tomato, chocolate, avocado, chili, coyote) and the medieval Latin/Old French/
  Old Norse core (country, court, prison, state, college, government, guard …).
  Every drafted entry was validated against the work list FIRST — an entry whose
  `origin` did not match a recorded route was rejected before merge. Result: 17 →
  110 banked entries, 3 → 10 days of play.
- `unverified` provenance flag (CurationEntryInput, carried by mergeCuration and
  both formatCuration writers, counted in the build report, listed by `check`,
  cleared in the admin app by ticking "checked against a reference"). All 119
  curated entries are flagged: the seed set was model-drafted too. The bank never
  overstates what a human has confirmed.
- The 11 demo seed entries that were missing `pos`/`origin` were filled in and
  their keys renamed to sense keys (`window` → `window:noun`); `tattoo`'s blurb
  described the Tahitian skin sense while the recorded chains are Dutch and Hindi
  only, so the entry was re-anchored to the sense the data supports (the 1640s
  drum signal) rather than left contradicting itself.
- **One prompt per word.** Work-list rows are one per recorded *route*, but routes
  are usually alternatives for one sense (`sugar` has five: Arabic, Middle French,
  Middle Persian, Old French, Sanskrit) — prompting per route asked the same
  question five times. `settledSenseIds`/`selectNextBatch` now settle the word,
  the batch is keyed by word, and a homograph's card pre-fills NO origin (that
  default is exactly how `back` became a French loanword); the admin app refuses
  to save such a card until one is picked. A deliberate second sense is still
  `word:pos:2`.
- `npm run curate -- --mode tier`: balances the curated pool across the ten tiers
  by frequency decile, because days of play is the SMALLEST tier and the
  chain-depth heuristic clumps everything into tiers 1–4 (110 entries produced
  tier counts 28,25,15,27,5,1,2,3,2,2 = 1 day). Unranked words are skipped by the
  slicing and left at tier 10. Balanced: 10 × 10 = 10 days.
- `validateBank` now rejects the same word answered by the same origin language
  twice, instead of rejecting any repeated word: "one entry per POS" needs
  `back:noun` and `back:verb` to coexist (ids are sense keys and already unique).
- Shipped bank v2 (110 entries, epoch unchanged at 20717) to
  `web/public/word-bank.json`; the published site serves it.
- tests: 191 total (+2) for the provenance round-trip and the duplicate-puzzle
  invariant (plus two rewritten for word-level queueing).

**Session 5 — map zoom/pan and a 100-year timeline window** (this batch)

- `web/src/view.ts` (new, DOM-free): zoom/pan maths — zoom-at-cursor, pan,
  clamping (at zoom 1 panning is a no-op; when zoomed you can only pan within the
  scaled map, so the map can never be dragged off screen) and the screen->map
  inverse. 9 tests pin those invariants, including that a zero zoom cannot produce
  NaN.
- `web/src/map.ts`: layers wrapped in a transformed `<g>`; wheel zoom toward the
  cursor, double-click zoom, pointer drag pan with a 4px slop so a drag is never
  mistaken for a pin drop, `touch-action: none` so touch drag pans instead of
  scrolling, and pin markers counter-scaled by 1/k so they stay readable at 8x.
  `+` / `−` / `Reset` buttons live in the map corner.
- **The timeline now asks for a 100-year window**, not a year: the handle is a
  tablet spanning exactly 100 years, moving in 25-year steps (arrows work), and
  `scoreTemporalRange` gives 100 for any answer inside it, decaying outside
  (`exp(-out/100)`: 1 year out = 99, 100 out = 37, 200 out = 14).
  `SCORING_WINDOW_YEARS` is gone; `RoundGuess` carries `yearStart`/`yearEnd`, and
  `guessRange` tolerates a session stored by the pre-window client (an old
  single-year guess becomes a zero-width window, so a resumed day keeps the score
  it already earned).
- **The label/era alignment bug is fixed by geometry, not by eye.** Two causes: the
  era scale spanned the full track while a native range thumb travels
  `track - thumbWidth` (so boundaries drifted further from their years the further
  right you went), and the label sat beside the slider so its text width resized
  the track mid-drag. Now `web/src/slider.ts` derives the tablet width
  (`track * span / windowYears`), which makes the thumb's leading edge equal the
  year's position on a full-window scale — verified numerically at every era
  boundary (306.3px == 306.3px on a 900px track) and pinned by a test that also
  shows a wrongly-sized tablet breaking the identity. The layout became three rows
  (label / slider / scale) so text can never reflow the slider, and the period
  labels are absolutely positioned from the same fractions.
- Era slices are partitioned at each period's START year: inclusive
  `to - from + 1` counts made the slices sum to 100.075% of a 1325-year axis.
- A 100-year window straddles a period boundary often, so the label names every
  period it touches (`1450 – 1550`, `Middle English · Early Modern`) via
  `erasSpanned`, and the reveal says plainly whether the window caught the year.
- **A scored round is frozen for input**: `lockRound()` disables the slider, stops
  pin drops (`worldMap.allowPicking(false)`, a gate separate from the zoom/pan
  handlers so exploration still works) and disables the Lock button, all before the
  reveal renders. The pin handler also checks the flag, so a click that arrives
  after locking cannot quietly move a pin that no longer affects the score. The
  next round re-enables picking, and the hint text switches to what is still
  possible ("zoom and pan the map").
- The reveal's chips are named in full: `Year Score` / `Map Score` / `Round Score`.
- `tests/web-ui.test.ts` guards this: those modules build DOM and there is no jsdom
  here, so (like the admin client) they are checked as source — including that
  freezing does NOT touch `zoomBy`/`resetView`, that the lock happens before the
  reveal, and that the round re-enables picking. Verified to fail when the slider
  freeze or the labels are reverted.
- The reveal marks the answer year on the timeline with a green circle
  (`markAnswerYear` + `yearPositionPct`, the same mapping the thumb uses). It is a
  *sibling* of the slider inside a `.tl-track` wrapper with explicit z-indices
  (slider 1, marker 2), because a native range's thumb is a pseudo-element painted
  with its input — nothing inside the input can paint above it. `pointer-events:
  none` keeps it from eating a drag, and a test asserts the geometry: when the
  answer is inside the window its marker position falls within the tablet's pixel
  span (that is the case the layering exists for), and a miss falls outside it.
  Another test asserts `renderRound` never calls `markAnswerYear` — showing the
  answer early would give the round away — and both were verified to fail when
  broken.
- tests: 227 total (+36 this session: 22 for the range/zoom work, 6 for the marker,
  8 UI-contract checks) — `tests/view.test.ts`, `tests/slider.test.ts`, range
  scoring (inside/edges/outside/zero-width/reversed/BCE/monotonic), slider bounds,
  `erasSpanned`, `guessRange`'s legacy tolerance.

**Session 5 (cont.) — the route line read backwards** (this batch)

- Reported from play: `enemy` showed `Route: English ← Latin ← Old French ← Middle
  English` next to "From Middle English, ultimately from Latin." The blurb was
  right and the route was reversed — `originChain` is ordered immediate-source-first
  and the renderer called `.reverse()` on it, which does not just look odd, it
  asserts the opposite derivation (English from Latin via Middle English).
- `web/src/reveal.ts` (new, DOM-free) now owns the formatting: `routeLabel` returns
  `English ← Middle English ← Old French ← Latin` — deepest last, immediate source
  beside English — and `main.ts` no longer touches the chain order.
- Driving the fix against the shipped bank turned up a second confusion waiting
  behind it: **16 of 100 entries record hops DEEPER than the answer** (`due`:
  `English ← Old French ← Latin ← Proto-Italic`, answer Latin), because the answer
  is the deepest hop with a home on a modern map. So the route now stops at the
  answer, picks that hop out in the accent colour, and `beyondNote` says why:
  "Recorded deeper: Proto-Italic — no anchor on a modern map, so the answer is
  Latin". Checked across the bank: the answer is always a hop in its own chain, no
  hop before the answer is unlocatable, and all seven beyond-the-answer hops are
  Proto-* reconstructions.
- `tests/reveal.test.ts` (+11) covers the direction, single-hop chains, the
  past-the-answer split and the note; plus four assertions over the shipped bank
  (the reported `enemy` case exactly, answer present in chain, nothing locatable is
  skipped, the answer itself is always locatable). A source guard in
  `tests/web-ui.test.ts` fails if `.reverse()` ever comes back — verified by
  reintroducing it.



**Session 5 (cont. 2) — the route reads oldest first** (this batch)

- Requested after reading the fixed line: the route should run oldest → newest,
  because English reads left to right. So the display order is now
  `Latin → Old French → Middle English → English` — the arrow flips to `→`
  ("became" once) because `←` in that order would claim the reverse, which is the
  same class of error as the reversal it replaced.
- `routeLine()` returns the stops already in display order (oldest first, English
  last) plus the older-than-the-answer stops also oldest-first, and
  `ROUTE_ARROW` is a constant so the glyph and the order can never drift apart.
  `beyondNote` now reads "Older still: Proto-Italic — no anchor on a modern map, so
  the answer is Latin, the oldest stop that can be placed."
- Real output: `enemy` → `Latin → Old French → Middle English → English`;
  `sugar` → `Arabic → Middle English → English`; `due` → `Latin → Old French →
  English` plus the note about Proto-Italic.
- tests updated to the new direction (+2): oldest hop first, immediate source beside
  English, single hop, a chain that does not name its answer, the older-than split
  and its ordering, the note wording, and the shipped `enemy` case. The `web-ui`
  guard now also asserts main.ts uses `ROUTE_ARROW` rather than its own glyph.

**Session 5 (cont. 3) — reveal heading, dash-free copy, quieter attributions**
(this batch)

- The reveal now leads with the word in medium type (`19px`) and then the answer in
  larger type (`clamp(26px, 4.6vw, 36px)`) — previously the answer was a 14px muted
  line below the route, i.e. the least prominent thing on the panel. The `Answer:`
  prefix is gone, so the line reads `Latin · first used around 1200`, with the
  language in the same accent class as the highlighted route hop.
- **Em dashes removed from every user-visible string**, as requested: the credit
  labels, the search-prompt line, the window verdict, the "locked in" hint, the day
  label, the summary line, the timeline marker tooltip, the beyond-note, the page
  title — and **8 curated blurbs**, which are data: `curated/curation.json` had them
  in `samovar`, `tea:noun`, `they`, `window:noun`, `karaoke`, `malaria`, `rickshaw`,
  `tycoon`.
- Because blurbs live in the bank, that prose fix meant rebuilding it. Verified the
  edit was prose-only: same 110 entries, `masterSequence` ids in the SAME order
  (so day mapping is untouched), and every entry identical once `blurb` is excluded.
  Only 4 of the 8 changed blurbs are inside the 10-day window; the rest sit in the
  tier-10 overflow.
- The attributions footer is centred, 12px, muted at 0.65 opacity with
  `color: inherit` links, so it stays licence-visible without competing with the
  game (browser-default blue links on a dark panel were the loudest thing on
  screen).
- New guards in `tests/web-ui.test.ts`: a `literals()` helper strips comments and
  extracts string literals, then asserts no literal anywhere in `main.ts` or
  `reveal.ts` contains an em dash (comments may: this repo's prose is full of them);
  plus the heading order/sizes (with the answer asserted *larger* than the word),
  the absence of the `Answer:` prefix, and the footer's centring/subtlety. All three
  verified to fail when the rule is broken.
- tests: 246 total.

**Session 6 — the source skipped a language, so `coyote` asked about Spain**
(this batch)

- Reported from play: pinning Mexico for `coyote` highlighted Spain and scored ~0,
  while the blurb said "Mexican Spanish from Nahuatl". Traced to the data: the
  4.2M rows record `English coyote --borrowed_from--> Spanish` and
  `Spanish coyote --derived_from--> Proto-Nahuan`, and **no
  `Spanish -> Nahuatl` edge exists at all**. Since Proto-Nahuan is a reconstruction
  with no place on a map, the deepest *placeable* hop was Spanish, so the answer
  became Spain (ES) and a Mexico pin fell outside MAX_RELEVANCE_KM of every hop:
  map 0, round 50, credit "none". The pipeline did what it was designed to; the
  source has a hole.
- Fixed with a new curated input, `curated/edge-overrides.csv` (same schema and
  direction as the filtered edges), merged into the donor edges before the walk:
  `Spanish,coyote,borrowed_from,Classical Nahuatl,coyōtl`. `build:bank` applies the
  file by default, prints `override edges: N applied from <path>`, ignores rows that
  repeat a recorded edge, accepts `--extra-edges <file>` and `--no-overrides`.
- Re-curated `coyote:noun` to `origin: Classical Nahuatl` (with the new hop, the
  recorded origins list is just Nahuatl, so the old value was refused — the audit
  caught the stale entry with `origin "Spanish" is not among the recorded origins
  (Classical Nahuatl)` and skipped it, which is exactly why the build reports
  skipped entries instead of quietly shipping stale puzzles).
- Verified before/after on the player's own scenario, scoring a pin at Mexico City
  against the old and new banks: **before** answer=Spanish/ES, map **0**, round 50,
  credit none; **after** answer=Classical Nahuatl/MX, map **100**, round **100**,
  credit country. `masterSequence` ids are in the SAME order in both banks, so day
  mapping never shifted. Route now reads `Classical Nahuatl → Spanish → English`.
- Scanned the rest of the bank for the same shape (blurb naming a language the
  chain does not contain): 34 of 100 entries, but nearly all benign — the other
  recorded branch, or prose naming the parent language. The one genuine near-miss
  is `geyser` (blurb says Icelandic; the source records Icelandic only as
  `etymologically_related_to`, which this pipeline drops, while Old Norse is the
  recorded donor) — and it is harmless because Old Norse already anchors to Iceland,
  so a pin at Geysir still scores.
- tests: 251 total (+5) for the override mechanism: the fixture reproduces the
  coyote shape, asserts the shallow answer without an override, the missing language
  becoming the answer (with its country and point) with one, the stale-curation
  refusal, and that a duplicate override row is ignored. Negative cases build with
  `assembleBank: false`, because a skipped word leaves its tier empty and a bank
  cannot be assembled from that.

**Session 7 — the country is the unit of knowledge** (this batch)

- Asked: can several language centroids share one country (Cantonese vs Mandarin
  vs Fuzhounese), and if so does the exact pin matter? And if not, shouldn't a pin
  anywhere in the right country be full marks? (A northern-Italy pin for Latin
  scored 98 only because it is far from Rome.)
- **Measured it.** The bank maps 304 languages over 155 countries, and multi-language
  countries are the norm, not the exception: the US hosts 17 mapped languages (spread
  11,392 km English to Hawaiian), CN 13 (Mandarin, Cantonese, Hokkien, Min Nan, Wu,
  Middle Chinese, Tocharian A/B ... spread 3,813 km), IN 14, IT 20, CA 8, RU 7, MX 2
  (Nahuatl in Mexico City vs Yucatec Maya in Yucatán, ~1,063 km). **99 of 100 bank
  entries share their country with another mapped language.**
- But the distance was a bad proxy: most of those rivals are in the same country only
  because the curated country sets are generous and overlapping (Ancient Greek claims
  IT through Magna Graecia; Chinese claims SG). So the old rule was mostly measuring
  distance from an arbitrary centroid, which is exactly why a correct Milan pin lost
  2 points.
- **Changed it:** a pin anywhere inside the deep origin's country now scores 100, and
  an intermediate hop inside its country scores a flat 70. `INSIDE_PENALTY_MAX` and
  `INSIDE_PENALTY_DISTANCE_KM` are gone; `distanceKm` is still reported for the
  reveal, it just no longer scores. Wrong-country behaviour is untouched (border
  proximity, 5000 km outer limit).
- Measured the effect against the real map: of 166 (entry, country) pairs, **every
  one** had a reachable point that scored under 100 before (median 96, worst 90) and
  scores 100 now. 88 of them are more than 1000 km from the answer point, 22 more
  than 3000 km (FR 7,637 km, RU 6,841 km, DZ 5,397 km).
- The 22 are the wrinkle worth knowing: "inside the country" includes far-flung
  territory, so a pin in French Guiana is 100 for Old French and Vladivostok is 100
  for Russian. That is consistent with the rule and with the language table (Arabic
  genuinely claims SA/EG/DZ), so it is left as is; a distance cap would reintroduce
  the arbitrariness the change removes.
- tests: 252 (+1). The scoring suite now has an IT rectangle and a Latin fixture, and
  asserts the reported case directly (Milan and Sicily both 100 for Latin), plus full
  marks at Vladivostok for Russian (was 90) and the flat intermediate credit (was
  65-70, now exactly 70).

**Session 8 — `kiosk` asked Persia while its blurb said Turkish** (this batch)

- Reported from play: pinning Turkey was "wrong" although the reveal said the word
  comes from Turkish. Cause was **my curation, not the data**: the entry named
  `origin: "Persian"`, which selected a bare one-hop route (`English <- Persian`)
  from Wiktionary's *group* of sibling edges, so the chain was `["Persian"]`, the
  answer was Iran, and Turkish appeared nowhere. A Turkey pin could only earn border
  proximity, labelled "not the origin".
- The data actually held the documented borrowed chain — `French <- Italian <-
  Ottoman Turkish` at priority `borrowed_from` — which the tie-break prefers on its
  own. Re-curated `kiosk:noun` to `origin: "Ottoman Turkish"`, so the route now reads
  `Ottoman Turkish → Italian → French → English` and the blurb matches the answer.
- **Then swept for the class.** Writing a blurb that names a language the route
  cannot credit is the same failure the `coyote` report exposed, so the bank was
  scanned for it: 21 of 100 entries named a language outside their chain. About half
  were artifacts of partial names ("Greek" for Ancient Greek, "Turkish" for Ottoman
  Turkish, "French" for Old French) or harmless (same country, so the pin still
  scores). Six were real:
  - `kiosk` → re-curated to Ottoman Turkish (above).
  - `cipher`, `cotton`, `magazine`, `avocado`, `algebra` → the documented hop was
    missing between recorded ones, so it went into `curated/edge-overrides.csv`:
    `Old French cyfre ← Arabic صِفْر`, `Old French coton ← Old Italian cotone ← Arabic
    قُطُن`, `Middle French magasin ← Italian magazzino ← Arabic مَخَازِن`, `Spanish
    avocado ← Classical Nahuatl āhuacatl`, `Medieval Latin algebrāica ← Arabic الجبر`.
    Their answers follow the deepest hop: `cipher` and `algebra` now ask Arabic
    (both blurbs already said so), and `cotton`/`magazine`/`avocado` keep their answer
    while gaining the intermediate countries for partial credit.
  - `sugar`, `orange` → their routes need English-internal hops that the source does
    not record, so the blurbs were cut back to what the route shows.
- **Fixed a second, unrelated way the same pin could be refused.** The Istanbul test
  point that prompted the report reads 10.8 km *outside* Turkey as drawn: clicks come
  from a 960x500 SVG over the generalized 110m outlines. Nine other coastal cities
  (Lisbon, New York, Sydney, Mumbai, Tokyo, Cairo, Athens, Rome, Oslo) all test
  inside, so this is rare but it lands exactly on the city a player would click for an
  Ottoman answer. Added `COASTAL_TOLERANCE_KM = 25`: a pin up to 25 km outside the
  answer's country still counts as inside. Measured that it cannot rescue a real miss
  (1 degree of latitude is ~111 km, still refused).
- Verified end to end: `kiosk` now answers Ottoman Turkish (TR); Istanbul and Ankara
  score **100 / credit country**, Paris 70 ("on the route"), Tehran 66. The six
  re-curated entries' routes:
  `Arabic → Old Italian → Old French → English` (cotton),
  `Arabic → Medieval Latin → English` (algebra),
  `Ottoman Turkish → Italian → French → English` (kiosk),
  `Arabic → Italian → Middle French → English` (magazine),
  `Arabic → Old French → Middle English → English` (cipher),
  `Classical Nahuatl → Spanish → English` (avocado).
  `masterSequence` order is unchanged, so day mapping is untouched.
- New guard: `tests/reveal.test.ts` asserts over the shipped bank that every language
  a blurb names is either in the route or shares a country with the answer. It caught
  two leftovers while being written (`algebra`, `magazine`), and its own removal step
  had to be case-insensitive ("medieval Latin" vs "Medieval Latin").
  `curated/edge-overrides.csv` now carries 8 edges.
- tests: 255 total (+3).

**Session 9 — small territories: a higher-resolution map, a point fallback, and
on-land anchors** (this batch)

- Reported from play: "Tahiti is really tiny and I can't actually find it on the
  map; a click in the south Pacific near Tahiti should get a reasonable score."
  First correction: `tattoo` no longer asks about Tahiti — it was re-anchored to
  Dutch last session because the recorded chains only ever held Dutch and Hindi. By
  request it stays that way: a second noun sense (`tattoo:noun:2`) would need a gloss
  on screen to tell the senses apart, which the model has no field for (noted under
  Remaining).
- **The defect the report pointed at was bigger than the pin.** The shipped
  110m Natural Earth map (174 features) drew no outline for 76 territories, and for
  every one of them `distanceToCountryKm` returns `Infinity` — so an answer anchored
  there scored **0 for every possible pin**. Verified for Guam, Tahiti, Samoa, Malta
  and Singapore. 17 languages in the generated table are anchored only to such
  places, and **33 candidate words** in the ranked work list already answer for one
  (Samoan 10, Manx 6, Maltese 5, Tahitian 4, Tongan 3, Gilbertese 2, Dhivehi,
  Chamorro, Marshallese 1 each). Nothing in the pipeline warned: the entry builds
  fine and `validateBank` cannot see the map.
- **Adopted world-atlas 50m** (756 KB, 241 features) in place of 110m (108 KB, 174).
  It draws every previously-missing territory except Tuvalu and Tokelau (absent even
  from 10m, 3.66 MB). Side benefits: Istanbul now reads *inside* Turkey (it was
  10.8 km outside as 110m drew it), so `kiosk`/`yogurt` no longer lean on the coastal
  tolerance at their answer points, and small islands are visible when zoomed.
- **Added the point fallback**: when no hop country has a drawn outline,
  `hopDistanceKm` measures to the hop's representative point instead. On the point is
  a country hit (100); away from it decays like any wrong-country pin. Measured on
  the real map with a Tahitian answer: the point **100**, 50 km **100**, 100 km
  **95**, 250 km **86**, 1000 km **96** (French Polynesia's islands are everywhere in
  that ocean). A genuine miss is unaffected, and the outer limit still scores 0.
- **Fixed the anchor points**: a probe over all 312 languages found **27 whose
  representative point sat off their own territory** by up to 243 km (Vietnamese 93,
  Indonesian 128, Fiji Hindi 243, Hawaiian 33, Swahili 22, Hebrew 10 …). 25 were
  nudged to the nearest on-land point inside their countries, 2 atolls (Maldives,
  Marshall Islands) needed the country polygon's own centroid because they are
  smaller than the search step, and 9 derived languages gained overlay entries. The 2
  undrawable territories are now documented in the overlay with a note. Result:
  **310 of 312 anchors land on land**, 0 unexplained. The committed seed table moved
  with them (`sw`), so the overlay-reproduces-the-seed contract still passes.
- **Guards**: `tests/geo-context.test.ts` now asserts the property that matters —
  **every entry in the shipped bank scores 100 with credit `country` on its own
  answer point** (110/110) — and pins the list of undrawable answers to exactly
  Tokelauan and Tuvaluan so a new one is visible rather than silent.
  `tests/map-coverage.test.ts` covers the coverage table (PF/MT/SG/GU/WS/TO drawn;
  TV/TK not) and the real Tahiti containment. `curate --mode check` reports any
  banked entry whose answer territory the map cannot draw, and CURATION.md gains
  "Anchors must land on land".
- Also regenerated both work lists: they predated the edge overrides, so the audit
  was falsely flagging `algebra` and `coyote` as naming an origin the data does not
  record.
- tests: 263 total (+2). Verification: tsc clean, 263/263, vite build green (serves
  `countries-50m.json`), subpath serve returns 200 for page, bundle, bank and map.

**Session 10 — mobile: pinch to zoom, a readable timeline, a thumb that sits still**
(this batch)

- **Pinch zoom.** The map tracked a single pointer for panning and nothing for two,
  so a two-finger gesture was either ignored or read as a drag. It now tracks every
  active pointer in viewBox coordinates; one pans, two scale by their spread and
  follow their midpoint. The maths is a new `pinch()` in `web/src/view.ts` (DOM-free,
  like the rest of the view state) so its invariants are testable: the map point under
  the fingers stays under them, `k` scales by the distance ratio, the same clamps
  apply as wheel zoom (a pinch cannot drag the world off screen or exceed 8x), and a
  degenerate span cannot produce NaN. Verified the guard bites by deleting the pinch
  call and watching the test fail.
- **A pinch never becomes a pin.** Lifting two fingers raises `draggedRecently`, so
  the click that ends a gesture cannot drop a pin at the last touch. `touch-action:
  none` (already set) is what stops the browser zooming the page instead.
- **Era ruler hidden below 640px.** Four absolutely positioned labels do not fit a
  phone (`Early Modern` is 15% of the track), and the same information is already in
  words above the slider. The `.tl-era` line is deliberately *not* hidden.
- **The tablet thumb lifted by half its height** (`--thumb-lift: -50%`, applied as
  `translateY` to both the `-webkit` and `-moz` thumb), because it hung off the bottom
  of the timeline panel on the device. One variable, and the comment says so: if a
  device wants a different offset, that number is the only thing to change. Applied
  unconditionally rather than behind a media query — a `pointer: coarse` scope would
  leave touchscreen laptops misaligned — so this is the one change in this batch worth
  eyeballing on a desktop browser.
- tests: 269 total (+6: four pinch cases in `tests/view.test.ts`, plus three
  source/CSS guards in `tests/web-ui.test.ts` for the pinch wiring, the hidden ruler
  and the thumb lift). Build verified: `Math.hypot`, `pointercancel`,
  `setPointerCapture` and `touchAction` all present in the shipped bundle, and the
  mobile `timeline-scale{display:none}` rule ships in the CSS.

## Verification (re-run before trusting anything)













    npx tsc --noEmit          # clean
    npx vitest run            # 269 passed (19 files)
    npx vite build web        # 66.0 kB js (22.6 kB gzip) / 4.6 kB css
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

1. Curate more — the loop is in CURATION.md. The bank is now 110 entries / 10 days
   from 119 curated words, all of them `unverified` drafts. Two jobs, in order:
   a. **Verify the drafts.** `npm run curate -- --mode check` lists them;
      `npm run admin` shows each word beside Etymonline/Wiktionary/Ngrams so the
      date can be confirmed in one screen. Tick "checked against a reference" to
      clear the flag. This is the highest-value work: the years are claims, and
      the whole game rests on them.
   b. Pull the next batch (`--mode next`), research, `--mode merge`, then
      `--mode tier` to re-balance and rebuild. 10 days of play needs 100 banked
      entries; each additional day needs one more word in EVERY tier.
2. Proto-language policy (unchanged, still open): default (respect "deepest
   origin") = 17 bankable / 4,141 words lost; `--deepest-attested` = 21 bankable /
   4,137 recovered. The lost words' answers would be reconstructions
   (Proto-Indo-European, Proto-Germanic, ...), which have no defensible home on a
   modern map.
3. A word with two senses of the SAME part of speech cannot be told apart on
   screen: `tattoo:noun` and `tattoo:noun:2` both render as "TATTOO (noun)", so the
   player cannot know which sense is being asked about (this is why the Tahitian
   tattoo sense was not added). A short `gloss` field shown under the prompt would
   fix it.
3. Chained data errors found in the real data while drafting — worth a filter:
   `seen ← Arabic` and `sent ← Estonian` are foreign-language homographs, and
   `yoga ← Chamorro` is a Wiktionary artifact. The work list's `chain` column is a
   claim to verify, not just the year.
4. GitHub Action: typecheck + tests + validate the shipped bank + days-of-play
   countdown (works today; the nightly rebuild needs the 143 MB asset).
5. Optional polish (not requested): share/streak summary, per-round distance
   readout on reveal, keyboard + screen-reader pass over slider and map.

## Gotchas learned (do not re-fight)

- A source that skips a real, locatable language silently moves a puzzle's answer to
  a shallower one. `coyote` had no `Spanish -> Nahuatl` edge at all, so the answer
  became Spain and a correct pin scored zero. Check the *chain*, not just the year:
  the blurb naming a placeable language the chain lacks is the tell.
- `buildWordBank` refuses a bank with an empty tier, so a test whose fixture drops a
  word by design must pass `assembleBank: false` and assert on the report instead.
- A word can have several routes recorded as separate one-hop edges from English
  (Wiktionary lists a group of related etymons, not a chain). Naming the most exotic
  one picks a bare 1-hop route and can contradict the blurb: `kiosk` asked Persia
  while its blurb said Turkish. Check the variants and prefer the route whose chain
  matches the documented history.
- Distance inside a country is not evidence of a wrong answer: the curated country
  sets are generous and overlapping (99 of 100 entries share their country with
  another mapped language; 20 languages claim Italy), so distance-to-centroid mostly
  measured arbitrariness. Country is the unit; the pin's distance is reported, not
  scored.
- A native range input's thumb is a pseudo-element of the input: nothing inside the
  input paints above it. To put something "in front of the thumb" it must be a
  sibling with a higher z-index, and both need explicit z-indices so the result does
  not depend on paint order.
- When inserting a section before an existing heading, put the heading in the
  replacement text: replacing `## Verification` with a new block deletes the
  heading and orphans everything under it (it happened here in session 4).
- A native range input's thumb travels `track - thumbWidth`, not the full track.
  Any scale drawn beneath it must use the same denominator or the labels drift
  progressively; deriving the thumb width from the span makes the two identical.
- Anything that resizes a control mid-interaction (a label whose text length
  changes the track) will feel broken while dragging. Give the text its own row.
- Inclusive year counts (`to - from + 1`) and a year *continuum* (`ceiling - floor`)
  differ by one: mixing them made era slices total 100.075%. Partition on period
  start years.
- Never name a variable `window` in client code — it shadows the global, which is
  where `localStorage` lives.

- A model-drafted fact is a claim, not a fact. Keep the provenance flag on it and
  make the tooling report the count; do not quietly mix it with verified data.
- Days of play is the SMALLEST tier, not the number of curated words. Curating
  without re-balancing tiers can add 93 words and add zero days (it did: 28,25,
  15,27,5,1,2,3,2,2 = 1 day from 110 entries).
- A per-route work list is not a per-route questionnaire: `sugar`'s five origins
  are one sense recorded five ways. Prompt per word, and never pre-fill an origin
  where the routes disagree.
- `getDailyPuzzle(bank, n)` takes a 0-based day INDEX (days since the epoch), not
  an absolute day number — passing 20717 throws "bank exhausted" and looks like a
  capacity bug.
- Two senses of one word must be able to coexist, so bank identity is the sense
  key; a uniqueness rule on `word` alone makes "one entry per POS" impossible.

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
- The admin client (`admin/public/app.js`) is plain JavaScript that nothing
  typechecks and no test imports, so a TypeScript-only construct in it is invisible
  until the browser rejects the whole file — a stray non-null assertion did exactly
  that. Tests now compile it with `new Function(source)` and assert no `x!`
  patterns; run `node --check admin/public/app.js` when editing it by hand.
- Embedded iframes can be effectively zoomed out without touching the child
  document: size the frame to 1/zoom of the wrapper and `transform: scale(zoom)`
  from the top-left. The site also lays out at the larger viewport, so more content
  fits on screen.
- Homographs are the pipeline's worst silent failure mode: `back` has edges from
  both Old English (inherited) and French (borrowed), and the "prefer borrowing"
  tie-break picked French. A word is not a puzzle entry — a *sense* is, so `pos`
  and an optional `origin` are part of the curated contract, and the work list now
  lists every recorded origin instead of hiding the alternatives.
- When offering candidate origins, do not mirror the pipeline's "deepest hop"
  rule: offering must use the deepest *placeable* hop, otherwise a sense buried
  under a reconstruction (`back`'s Old English under Proto-West Germanic) is
  invisible to the curator — which is exactly the sense that was wrong.
- Two different notions of "the answer" now coexist deliberately:
  `--deepest-attested` changes the pipeline's default anchoring, while a curated
  `origin` is authoritative for that one entry (it anchors to the deepest
  placeable hop of the chosen branch).
