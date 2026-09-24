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

## 1c. Derive the words no source can date (the fast path)

One word in six of the ranked list is *held* in English since a period no reference
dates more precisely. For those there is nothing to look up, so there is nothing to
research either: the chain names the period, and the span IS that period.

    npm run curate -- --mode derive --limit 5000   # writes into the batch, keeps existing work

Measured on the real lists: **490 entries drafted**, 482 in the Middle English period
and 8 in Old English. Each one carries `"yearSource": "chain-period"` plus the span
(`1151 – 1500`, or `700 – 1150`):

```json
"abbey": { "year": 1151, "yearTo": 1500, "tier": 4, "origin": "Ecclesiastical Latin", "yearSource": "chain-period" }
```

It deliberately **skips two classes**:

- **11,214 words with several recorded origins.** A homograph's routes are different
  words and imply different periods (`give` is 700–1150 as the native word and
  1151–1500 as the Old Norse borrowing), so the span cannot be derived before a
  human says which sense it is. In the admin app, picking a route fills its span in
  for you and tells you which period it came from.
- **21,559 words whose chain names no English stage.** Those are borrowings whose
  first use is a real reference lookup (`algebra ← Medieval Latin`).

So the loop for a derived batch is: open `npm run admin`, check the *chain* on each
card (the span is trustworthy exactly as far as the chain is), press Enter. No
reference, no typing. Words the data marks as never-verified-by-a-human
(`"unverified": true`) are a different flag and still need their date checked.

Then rebalance and build:

    npm run curate -- --mode tier --frequency data/en-frequency.txt
    npx tsx scripts/build-bank.ts --edges data/edges-filtered.csv.gz \
      --languages data/languages.tsv --curation curated/curation.json \
      --out data/word-bank.json --version 3 --epoch-start 2026-09-21 \
      --frequency data/en-frequency.txt --exclude-origin en,ang,enm

`--frequency` matters here: a curated word has *left* the work list, so the work list
cannot rank the very entries being tiered. Without it every derived word fell to tier
10 as "unranked" and capped the bank. With it, 385 of 609 entries get a real rank and
the bank went from **10 days of play to 36**.



## 1d. Let the senses tell you which word you are curating

The etymology data records relations per **word**, so `back` arrives as one pile
holding both the inherited word and the French loan — and `bank` as one pile holding
the money sense, the river sense and the row sense. Wiktionary writes the difference
down, and a page is small enough to fetch per word:

    npx tsx scripts/fetch-senses.ts --from-batch data/curation-batch.json
    # -> data/word-senses.json (gitignored), ~1 s per word, resumable: re-run any time

What it keeps per word is exactly three facts per (etymology, part of speech) pair:

```
back   Etymology 1  adjective  "At or near the rear."        donors: Middle English, Old English, Proto-West Germanic
back   Etymology 1  noun       "The rear of the body..."     donors: Middle English, Old English, Proto-West Germanic
back   Etymology 2  noun       "A large shallow vat..."      donors:
bank   Etymology 1  noun       "An institution where one..." donors: Middle English, Middle French, Italian
bank   Etymology 2  noun       "An edge of river, lake..."   donors: Middle English, Old English, Proto-West Germanic
sole   Etymology 2  noun       "The bottom or plantar..."    donors: Middle English, Old English, Anglo-Norman
```

In the admin app each sense is a button. **Clicking one takes the part of speech** (so
the entry files as `back:noun` rather than `back`) **and, when that sense's donor is
one of the recorded origins, takes the route too** — which also fills in the span that
route implies. That is the whole decision for the 11,214 words with several recorded
origins, made from evidence instead of guesswork: `bank`'s river sense names Old
English, so the click says "noun, Old English, 700–1150".

Two things to know:

- A donor that is a **reconstruction** keeps its code when neither language table
  names it (`poz-pol` for the tattoo sense in `tattoo`). That is a feature: a
  reconstruction cannot be pinned, so it is not a candidate answer.
- The file is **optional** and gitignored. Without it the app simply shows no senses.



## 1e. Check a date against the printed record (EEBO-TCP)

A borrowed word has no English stage in its chain, so its first use is a real lookup, the one thing the derived spans could not do. What a corpus *can* do is contradict a year: if the word is in print by 1587, it did not enter English in 1650.

    # one-time: the dated index of the whole corpus (61,315 texts, CC0)
    git clone --depth 1 https://github.com/textcreationpartnership/Texts /tmp/tcp-texts
    cp /tmp/tcp-texts/TCP.csv data/TCP.csv

    npx tsx scripts/attest-scan.ts --from-curation curated/curation.json --sample 400
    # -> data/attest.json, ~0.4 s per text, progress every 50

Then `npm run curate -- --mode check` reports any curated year the record contradicts:

    banked: year 1650 is later than the printed record already shows it:
      found in 3 sampled text(s), earliest 1587

**What a hit does and does not mean.** The first full run reported 8 of 119 curated
years as contradicted, and two of those were not really the word at all:

- `video:noun` (curated 1935) appears in a 1587 text because EEBO is **not
  English-only**: `video` is Latin for "I see".
- `guy:noun` (curated 1806, the Guy Fawkes effigy) appears from 1473 because `Guy` is
  a person's name.

The genuine-looking ones (`ballet` 1587, `chili` 1641, `mission` 1578, `tea` 1502) are
worth opening the citation for: the tool prints the text id, year and title, and the
rule is to change the year only after reading it. Raising `--sample` makes a hit
earlier, never a miss.

Three things decide how to read that report:

- **A hit is a citation.** The tool records the text id, its year and its title, so the
  claim can be looked up (text A60932, 1697). That is firmer footing than a model's
  memory of a dictionary date.
- **A miss is silence, not evidence.** The scan reads a *sample*: 400 of 61,315 texts,
  spread evenly by date, so a rare word is simply not seen. The check therefore only
  fires on a hit; treating absence as a finding would flag hundreds of correct entries.
  To look harder, raise `--sample`.
- **EEBO ends at 1700.** It dates the Renaissance loanword layer well and says nothing
  about the 18th century onward.

The index carries a few hundred rows whose date column is junk (`1`, or a non-year), so
the sampler keeps to the corpus's own period (1450-1800).

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
   "16th century" is fine. Do not invent precision. If the reference will not give
   a year at all, see "Undated words: curate the span" below.
4. **Adjust the tier only if the suggestion is wrong.** The suggested tier comes
   from chain depth and frequency; the difficulty ladder matters more than any
   single word. Tier 1 should be easy for a casual player, the hardest tier genuinely so.
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

### Undated words: curate the span, never a point

Roughly **one word in six** of the ranked list is inherited from Old or Middle
English, and no reference dates those first uses more precisely than a period:
"recorded in Old English", "before 1150". **Do not pick a year for them.** A
fabricated year makes the player's score depend on the curator's coin flip — the
same word dated 1000 or 1100 turns a guess of 900-1000 into 100/100 or 5/100, so
the difficulty of the round is decided by curation mood, not by knowledge.

Instead state the span the record allows:

```json
"give": { "year": 700, "yearTo": 1150, "pos": "verb", "origin": "Old English", "unverified": true }
```

- `year` is the **earliest** year the record allows. For anything inherited that is
  the timeline floor, 700 (the start of the English written record).
- `yearTo` is the **upper bound**: the year by which the word was in use.
- Leave `yearTo` off, or equal to `year`, for a normally dated word. Nothing else
  changes for those.
- You rarely type this by hand: `--mode derive` fills it in for every word whose chain
  names an English period (see "1c. Derive the words no source can date"), and the
  admin app fills it in when you pick a route. Those entries carry
  `"yearSource": "chain-period"`, which tells the tools that no reference lookup is
  pending for them.

The game then scores any 100-year window **overlapping** the span as a full hit and
decays by the gap to the nearer end; when the span is a whole period exactly, the
reveal names it (`recorded in the Middle English period (1151 – 1500)`) with a note
saying why, and the timeline draws the answer as a **band** across those years
instead of a dot on one. `give` measured end to end: windows
700-1200 all score 100, 1200-1300 scores 61, 1300-1400 scores 22.

In the admin app this is the "Only dated as *in use by* a year?" field under the
year. `check` flags a `yearTo` before its `year` and any bound past the end of the
timeline; a coarse inherited word is never reported as unplayable.



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

`check` also reports the two automated contradictions it can see: a year after the period the word's own chain records, and a year the printed record (see 1e) already contradicts. Both are one-directional by design, and neither treats silence as a finding.


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
frequency and cuts it into one slice per tier, most common in tier 1, rarest in the
hardest tier. The slice size IS the days of play (each day deals one word per tier), so
rebalancing today's pool gives 94 curated entries per tier, i.e. 94 days; the shipped
bank holds 90, because the build drops entries whose language has no place on the map.

Words with no frequency rank are skipped by the slicing (they mostly cannot build
at all) and left at the hardest tier. Re-run it whenever you add a batch, then rebuild.

### Native answers: the 10% quota

A word whose answer is English is won by always pinning Britain and always choosing
the earliest window, so the build keeps those out by default (`--exclude-origin
en,ang,enm`). That is right for the work list, and wrong for the bank: it threw away
the most common vocabulary in the language, and a curated entry nobody can see is
wasted work. So native answers are admitted up to a **fraction of the bank**, in the
easy tiers:

    --native-quota 0.1 --native-tiers 1,2

- The quota is a fraction of the entries, so it scales with the bank: at 138 curated
  entries a 0.1 quota allows 14 and only 8 exist, so all 8 got in.
- **The tier is forced**, so `--mode tier` cannot scatter them out of the easy tiers
  (they are the rounds a player warms up on).
- The most **common** native words get the places first (by frequency rank), so the
  ones that make the cut are the ones a player meets early. With no frequency list the
  tie-break is alphabetical and stable.
- Default is off, which reproduces the previous build exactly.

Measured on the real curation: 8 native words admitted (`leave`, `may`, `mean`, `put`
in tier 1; `long`, `must`, `mother`, `name` in tier 2), and a 0.02 quota admits 3 and
drops 5, so the cap really caps. Their spans are `700-1150`, which is exactly the Old
English period, so the reveal reads *"recorded in the Old English period"* rather than
printing two numbers.

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

### Words from thin regions

The calendar's regional mix is set by the *pool*, so this is the loop that changes it.
The bank started 93% Europe (0 African, 0 Southeast Asian, 0 Oceanian rounds), and the
deal could only spread what existed: the fix is more curated words from thin regions, not
a smarter shuffle. In practice one word needs three things in this order.

**1. The language's geography.** A word whose deepest language has no country cannot be
placed at all — for Dharug, Kimbundu, Wiradhuri and seven others the missing piece was
the overlay, not the etymology. Add the code to `curated/language-geo.json`
(`name`, `lat`/`lng`, `countries`) and re-run `npm run bootstrap:languages`, then
`npm run filter:edges` (the overlay changes which edges are usable) before building. Pick
the point inside the country: section 4a's probe runs over every language in the table and
names anything in the sea.

**2. The donor, if the source got it wrong.** `banana` is recorded as Arabic and `manatee`
as Spanish, so both were dropped from the batch rather than shipped as wrong answers.
Where the true donor is missing but documented (`zombie` ← Kongo, `banjo` ← Kimbundu,
`toboggan` ← Mi'kmaq, `savanna` ← Taíno), record it as an edge override — see above.

**3. A blurb the route can credit.** A *transmission* language counts as an uncredited
language even when it is historically true: `puma` and `llama` reached English through
Spanish, but their recorded chain goes straight to Quechua, so a blurb saying "by way of
Spanish" promised a pin that scores nothing. Either record the hop as an override
(preferred — it earns partial credit) or trim the mention to the donor, which is what
`candy`, `jar`, `genie`, `giraffe`, `azure` and `bamboo` needed.

Then measure the property you actually want, not a proxy: rounds per continent, distinct
subregions per day, and **days with no non-European round** (the last one is what "every
day feels varied" means; it went from 13 of 37 days, to 0 of 42 at ten rounds a day, to 0
of 90 at five). Shortening the day is what stressed it: with five slots instead of ten the
same supply has to reach twice as many days, and the day-level preference for fresh regions
spent it early until the thin continents were capped as a group (`dealSequence`).

Two things to expect when the batch lands:

- A new override can *activate* entries that were unbankable when they were curated, and
  an activated bare entry can collide with the sense-keyed one curated since: the build
  refuses it with `duplicate puzzle: taboo answered by Tongan appears twice`. Keep the
  sense-keyed entry (it names the part of speech and the origin) and drop the bare one.
- The *last* days of a calendar are the least varied, because by then the thin pool is
  spent and each tier's tail is whatever is left. That is the pool, not the scheduler;
  adding words from thin regions is what moves it.

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
