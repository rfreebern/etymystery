# Curating years — the process

Everything upstream is automated. The bank's size is set by **one hand-researched
fact per word: the year English first used it**. This is the loop that turns the
26,590-word ranked work list into playable rounds.

The tooling never guesses a year. Years are facts; the tool only handles the
mechanics (picking the next words, checking the file, merging it, reporting what
changed).

## 0. One-time setup

```bash
# frequency list (CC BY-SA 4.0, see LICENSES.md)
curl -o data/en-frequency.txt \
  https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt

# full dataset -> usable edges, then the ranked work list
npm run filter:edges -- --edges data/etymology-db.csv.gz \
  --languages data/languages.tsv --out data/edges-filtered.csv.gz
npm run build:bank -- --edges data/edges-filtered.csv.gz --languages data/languages.tsv \
  --curation curated/curation.json --out /dev/null --version 2 --epoch-start 2026-09-21 \
  --frequency data/en-frequency.txt --exclude-origin en,ang,enm --worklist-only \
  --worklist data/curation-worklist-interesting.tsv

# same flags WITHOUT --worklist-only: `check` uses this bank to tell a
# legitimately-curated word apart from a typo that has no chain at all
npm run build:bank -- --edges data/edges-filtered.csv.gz --languages data/languages.tsv \
  --curation curated/curation.json --out data/word-bank.json --version 2 \
  --epoch-start 2026-09-21 --frequency data/en-frequency.txt --exclude-origin en,ang,enm
```

Settle the timeline window before curating? It is **already settled and shared**:
`src/timeline.ts` defines the window (currently **700–2025**) and the web client,
the CLI and the admin app all read it, so the tools cannot disagree with the game.
See "The timeline window" below.

## 1. Pull the next batch

```bash
npm run curate -- --mode next --limit 25
```

This prints, in frequency order, the next uncurated words with the proposed chain
and answer, and writes a skeleton to `data/curation-batch.json` (`"year": 0`
means "not researched yet"). Already-curated words and anything listed in
`data/skip-words.txt` (passed with `--skip`) are skipped.

It asks about each **word** once. The work list carries a row per recorded route
(`sugar` has five), but those routes are usually alternatives for one sense
rather than five puzzles, so the row lists them all and you pick the one you
verified — see "Parts of speech and multiple origins".

## 1b. Or use the admin app (recommended)

```bash
npm run admin          # http://127.0.0.1:8765
```

A local, dependency-free page for the same loop: the word, its chain, the answer
and the three fields on the left; every reference source for that word on the
right. Seven of them embed directly in iframes — Etymonline, Wiktionary (article
and raw wikitext), Google Ngrams, The Free Dictionary, archive.org and a Bing
search — and two cannot be embedded (Merriam-Webster and HathiTrust send
`X-Frame-Options: SAMEORIGIN`), so they render as prominent one-click links.
Merriam-Webster's link always points at its `#word-history` anchor, since the
dated note is the only part worth reading. Framing support in `admin/sources.ts`
was measured with curl, not assumed.

Frames render at **80% zoom** by default (adjustable in the header or by pressing
`z`), which shows noticeably more of each reference page at once. Press `?` for
the full shortcut list — `Enter` saves and advances, `Shift+Enter` saves in
place, `←`/`→` move between words, `1`–`9` jump to a source, `r` reloads it,
`s` skips, `m` merges.

The app writes the same `data/curation-batch.json`, `data/skip-words.txt` and
`curated/curation.json` as the CLI, so the two can be interleaved: curate in the
app, `npm run curate -- --mode check` from the terminal, whatever suits.

Keyboard: `Enter` saves and advances, `←`/`→` move (an entered year is saved on
the way, so nothing is lost), `1`–`9` jump to a source, `r` reloads it,
`s` skips the word, `m` merges the batch. Merge keeps a `.bak` copy of
`curated/curation.json`. The server binds to `127.0.0.1` only, and it never
fetches the reference sites itself — the iframes are just your browser loading
pages you could open by hand.

## 2. Research each word

For every word in the batch:

1. **Verify the chain first.** It comes from an unvalidated parse of Wiktionary,
   so it is a claim, not a fact (`name ← Wolof` and `so ← Japanese` are real
   entries in the data). Check that the word really comes from that donor and
   that the *deepest* language is the right answer. If the chain is wrong, do not
   curate the word — add it to `data/skip-words.txt` and pull another batch.
2. **Find the year English first used it** — not the year the donor language had
   it. Use a reference by hand (Etymonline, OED, Chambers, Merriam-Webster); see
   "What deliberately is NOT used" in LICENSES.md: a reference for a human, never
   bulk-copied into the repo.
3. **Match the granularity the reference gives you.** Scoring gives full credit
   within ±50 years, so a decade ("1640s" → 1640) or a mid-century value for
   "16th century" is fine. Do not invent precision.
4. **Adjust the tier only if the suggestion is wrong.** The suggested tier comes
   from chain depth and frequency; the difficulty ladder matters more than any
   single word. Tier 1 should be easy for a casual player, tier 10 genuinely hard.
5. **Write the blurb** (optional but expected): one factual line naming the donor
   term, e.g. `"From Arabic qahwah, likely via Turkish kahve and Dutch koffie."`
   Never add colour you cannot source.
6. **Any attested year from 700 onward is playable.** `check` flags years outside
   the window with the exact score they could reach.
7. **Say who checked it.** An entry you verified against a reference needs
   nothing extra. An entry you did *not* verify — a draft from a model, a guess
   from general knowledge — gets `"unverified": true` (in the admin app, leave
   the "I checked this date against a reference" box unticked). The build report
   counts those and `check` lists them, so the bank never overstates itself.

### Letting a model draft the years

Hand-writing thousands of years is the bottleneck, so drafting is allowed — with
provenance. The entries marked `"unverified": true` in `curated/curation.json` were
produced that way: a batch drafted from general knowledge, then validated against
the work list (every entry's `origin` had to match a recorded route or it was
rejected before it could be merged), merged with `--mode merge`, and flagged. Those
89 drafted words plus the seed set took the bank from 17 accepted entries to 110
and from 3 days of play to 10.

A drafted `year` is a claim about a fact, exactly like the chain. It is the entry
to trust *last*: check it in the admin app (Etymonline and Wiktionary have the
date in the first screen) and clear the flag. `npm run curate -- --mode check`
lists every unverified entry by name.

## 3. Validate and merge

```bash
npm run curate -- --mode merge
```

`merge` refuses entries that still have `year: 0`, reports what it added and what
it skipped, writes `curated/curation.json` in the same one-entry-per-line style
the file already uses, and lists anything that needs attention. An unfinished
batch is safe: nothing without a year is written.

## 4. Check progress

```bash
npm run curate -- --mode check
```

Reports how many ranked candidates have a year, the per-tier histogram, and
**capacity in days of play** — the scarcest tier sets it, because every day needs
exactly one word from each of the ten tiers. It also lists issues: missing years,
tiers out of range, capitalised keys, words with no mappable chain, years the
slider cannot express (with the score damage quantified), and the entries that
are still marked `unverified`. Finally it reports any entry whose answer territory
the shipped map cannot draw (see `scripts/lib/map-coverage.ts`): those puzzles are
winnable, but only through the representative-point fallback, so a normal one is
preferable.

## 4a. Anchors must land on land

An answer's representative point is where the reveal pin is drawn and, for a
territory the map cannot draw, the target the player is scored against. So it has to
be *inside* one of the language's anchor countries as the map draws them. The test
suite probes every language in `data/languages.tsv`: 310 of 312 land on land, and the
two exceptions are Tokelauan and Tuvaluan, whose territories no world-atlas
resolution draws (documented as such in the overlay, and scored by the point
fallback). When a new language's point lands in the sea, move it to the nearest
on-land point inside its countries; the probe names it and says how far it missed by.

## 4b. Balance the tiers (do this before shipping)

```bash
npm run curate -- --mode tier
```

Days of play is the **smallest** tier, so an unbalanced bank wastes everything
else. The chain-depth heuristic cannot balance anything — it clumps most curated
words into the easy tiers (the first curation round produced tier counts
`28, 25, 15, 27, 5, 1, 2, 3, 2, 2`, i.e. one day of play from 110 entries) — so
this mode assigns tiers by **obscurity** instead: it ranks the curated pool by
frequency and cuts it into ten equal slices, most common in tier 1, rarest in
tier 10. Same 110 entries, balanced: `10 × 10`, ten days.

Words with no frequency rank are skipped by the slicing (they mostly cannot build
at all) and left at tier 10. Re-run it whenever you add a batch, then rebuild.

## 5. Ship it

Once every tier has enough words for the days you want:

```bash
npm run build:bank -- --edges data/edges-filtered.csv.gz --languages data/languages.tsv \
  --curation curated/curation.json --out data/word-bank.json --version 3 \
  --epoch-start 2026-09-21 --frequency data/en-frequency.txt --exclude-origin en,ang,enm
cp data/word-bank.json web/public/word-bank.json
npm run build:web
```

Two invariants: keep the **same epoch** (20717) so day numbering never shifts,
and grow the shipped bank with `appendToBank` so already-shipped tier positions
never change (see PROGRESS.md). Rebuilding from scratch is only acceptable while
the bank has no players.

## Parts of speech and multiple origins

A puzzle entry is a **sense**, not a word. Different senses of the same word have
different origins *and* different dates: `back` is inherited from Old English
(`bæc`) in one sense and came via French (`bac`) in another, `sole` has four
recorded origins, `mail` has three. So the work list has **one row per sense**,
and each row becomes its own entry.

The curation key — which is also the bank's entry id — says which sense it is:

    word            the word has one recorded origin, no part of speech recorded
    word:pos        this sense's part of speech, e.g. back:noun
    word:pos:2      a second sense of the same part of speech, e.g. bank:noun:2
                    (bank the river vs bank the money are both nouns)

The tools compose that key for you: give a sense a `pos` and it files as
`word:pos`, and if that key is already taken by a *different* origin it becomes
`word:pos:2`. You rarely type a key by hand.

When you curate a sense:

- **`pos`** — always set it. It appears in the puzzle ("Where did this noun
  originally come from…?") and in the reveal, so the player knows which sense is
  being asked about.
- **`origin`** — required whenever the row's `origins` column lists more than one
  place, naming the one you verified for that sense (spelled exactly as in that
  column). This is the difference between a correct answer and a
  plausible-but-wrong one: without it the builder falls back to its tie-break
  (which prefers borrowings, hence the `back` → French mistake) and the build
  report counts how many entries rest on that guess.

Whether a word is a homograph is not a judgement call: the `origins` column lists
every place its recorded chains support. But **curating a word settles the word** —
the queue prompts once, the card lists every route, and you pick the one this sense
came from. The routes are usually not separate puzzles: `sugar`'s five "origins"
(Arabic, Middle French, Middle Persian, Old French, Sanskrit) are the same
etymology recorded as alternative routes and truncated at different depths, so
prompting per route asked the same question five times. A genuinely separate sense
is added deliberately, as `word:pos:2`.

Nothing is pre-filled for a word whose routes disagree. Defaulting to the
builder's tie-break is precisely how `back` silently became a French loanword, so
the admin app refuses to save such a card until you choose, and the CLI leaves
`origin` empty.

Two details worth knowing:

- A chosen branch may end in a reconstruction (Old English under Proto-West
  Germanic, as with `back`). Picking it anchors the answer to the deepest hop
  that has a home on a modern map — the curator's choice is authoritative, so it
  is never dropped as "buried". The full chain still shows on the reveal.
- The `origins` column lists *answerable* places: a branch whose deepest hop is a
  reconstruction still contributes the deepest real place inside it.

`npm run curate -- --mode next` prints each sense with its origin, and the admin
app gives each sense its own card (with a live "files as" key preview).

## When the recorded chain is wrong

The chain comes from a faithful *parse* of Wiktionary, not a checked dataset. One
failure mode is invisible but changes the answer: **the source can skip a real,
locatable language**, so the walk never reaches it and the puzzle anchors to a
shallower one.

The case that surfaced it (`coyote`, reported from play): Wiktionary records

    English coyote --borrowed_from--> Spanish coyote
    Spanish coyote --derived_from--> Proto-Nahuan *koyootl

There is no `Spanish -> Nahuatl` edge anywhere in the 4.2M rows. Since
Proto-Nahuan is a reconstruction with no place on a map, the deepest *placeable*
hop was Spanish, so the puzzle asked about **Spain**. A player pinning Mexico, the
actual answer, scored zero.

### Fixing it: curated edge overrides

Add the missing hop to `curated/edge-overrides.csv`, in the same schema as the
filtered edges (and the same direction: `lang,term <reltype> related_lang,related_term`
means lang's term came from related_lang's term):

    lang,term,reltype,related_lang,related_term
    Spanish,coyote,borrowed_from,Classical Nahuatl,coyōtl

`npm run build:bank` picks that file up automatically (default path
`curated/edge-overrides.csv`) and prints how many edges it applied. Use
`--extra-edges <file>` for a different file, `--no-overrides` to ignore it
entirely. An override that repeats an edge the source already has is ignored, so
the file is safe to keep as a record of what the source gets wrong.

Then **rebuild and re-read the `origins` column** of the work list, because the
new branch changes the answer. The audit makes this hard to miss: an entry whose
`origin` names the old answer is refused with
`origin "Spanish" is not among the recorded origins (Classical Nahuatl)`, and the
build reports it as skipped rather than shipping a stale puzzle. Update the
entry's `origin` (and its `pos` if the word is a homograph) and rebuild.

Rules of thumb:

- One override should restore a hop the source *omits*, not invent a derivation.
  If a reference genuinely disagrees with the source, the entry's blurb is the
  place to say so.
- Overrides are the curator's assertion, so entries that depend on one stay
  `unverified` until a human checks the chain as well as the year.
- Prefer an override over a different answer: the alternative is picking a
  shallower origin, which puts the puzzle somewhere the word never came from.

### Two traps in choosing the origin

**Do not pick a thin sibling route.** A word often has several routes recorded as
separate one-hop edges from English, because Wiktionary lists a group of related
etymons rather than a chain. `kiosk` had all of these, each a direct edge from
English: French, Italian, Ottoman Turkish, Persian, Middle Persian. Choosing
"Persian" (the most exotic) selected a bare one-hop route, so the puzzle asked about
Iran, the route showed nothing else, and the curated blurb — "From Turkish koshk" —
described a different word than the one being asked. Meanwhile the data *did* hold
the full borrowed chain (`English <- French <- Italian <- Ottoman Turkish`, priority
`borrowed_from`), which the tie-break would have picked by itself. Check the
variants before naming an origin, and prefer the route whose chain matches the
word's documented history.

**A blurb may only name languages the route can credit.** If the blurb says "via
Old French" and the chain has no Old French, a player who follows the prose pins
France and is told they are in the wrong country. Either record the hop as an
override (preferred, since it also earns partial credit) or drop the mention.
`tests/reveal.test.ts` enforces this over the shipped bank: every language a blurb
names must be in the route, or share a country with the answer (so the pin would
still score). It is not about tidiness — a mismatch between the prose and the route
is a player being told their correct answer is wrong.

Known shape to watch for (a blurb that names a language the chain does not
contain). Most such mentions are benign prose — the other recorded branch, or the
parent language — but a mention of a *placeable* language that is the true donor
means the source skipped a hop. `geyser` is the deliberate contrast: its blurb
mentions Icelandic, but Icelandic is recorded only as `etymologically_related_to`
(a relation this pipeline drops), Old Norse *is* the recorded donor, and Old Norse
already anchors to Iceland, so a player pinning Geysir still scores.

## The timeline window (700–2025)

The slider spans `ANSWER_YEAR_MIN`–`ANSWER_YEAR_MAX` from `src/timeline.ts`, which
is the single source of truth: the web client, `npm run curate` and the admin app
all read that one module, so the curation tooling can never drift from what the
game can actually score. It also exposes the era labels the slider shows
(Old English · Middle English · Early Modern · Modern) and `bestPossibleTemporal()`,
which delegates to the real `scoreTemporal` so "this answer cannot score above
N/100" is computed, never guessed.

Why 700: that is the start of the English written record (Cædmon's Hymn, c. 730).
It makes the Old English loanword layer curatable — `cheese`, `butter`, `mile`,
`church`, `pepper` came from Latin and Greek before 1150 — instead of unusable.
Previously the floor was 1500, which silently made three shipped words
(`they` 1200, `window` 1225, `orange` 1300) unwinnable: the best possible
temporal score was 8, 11 and 22 out of 100 with no way for a player to do better.
Widening the window fixed those rounds retroactively; no bank rebuild was needed.

The wider window does make the temporal axis harder (the player searches ~1300
years instead of ~525), which is intended: the difficulty ladder is what keeps
round 1 easy, and the tier heuristic already pushes early-attested words toward
high tiers.

Rule of thumb for curation: any attested year from 700 onward is playable, and
`npm run curate -- --mode check` flags anything outside the window with its exact
score ceiling.

## Cadence and budget

- 10 words ≈ 1 day of play, so a 25-word batch ≈ 2.5 days and 1,000 words ≈ 100 days.
- Measured coverage: curating the top 5,000 English words yields ~1,007 usable
  words with `--exclude-origin en,ang,enm` (≈100 days). The unfiltered list would
  give 2,380, but includes words whose answer is England.
- Expect some candidates to be unreachable — rarities (unranked), dubious chains,
  pre-1500 dates. Skipping them is part of the loop, not a failure.
