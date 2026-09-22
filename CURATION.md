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

Settle the timeline-window decision below **before** curating: it decides which
words are playable at all.

## 1. Pull the next batch

```bash
npm run curate -- --mode next --limit 25
```

This prints, in frequency order, the next uncurated words with the proposed chain
and answer, and writes a skeleton to `data/curation-batch.json` (`"year": 0`
means "not researched yet"). Already-curated words and anything listed in
`data/skip-words.txt` (passed with `--skip`) are skipped.

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
6. **If the year falls outside the slider window, do not enter it yet** (see the
   decision below).

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
tiers out of range, capitalised keys, words with no mappable chain, and years the
slider cannot express, with the score damage quantified.

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

## Decision required: the timeline window

The slider is `1500..2025` (`web/src/main.ts`), yet the shipped bank already
contains `they` (1200), `window` (1225) and `orange` (1300). Those rounds cannot
be won: the best achievable temporal score is 8, 11 and 22 out of 100 no matter
what the player does — `npm run curate -- --mode check` prints exactly this.

It matters because a large share of the most common interesting words are Middle
English loanwords attested before 1500 (`just`, `money`, `please`, `sure`,
`take` …). Two options:

- **Widen the window** to, say, 1100–2025 (one constant, then re-check the
  slider's label granularity) and keep those words, or
- **Exclude pre-1500 words** from curation, which removes a large part of the
  vocabulary because they can never score.

Until that is decided: curate only words whose year falls inside the window, and
let `check` flag the rest.

## Cadence and budget

- 10 words ≈ 1 day of play, so a 25-word batch ≈ 2.5 days and 1,000 words ≈ 100 days.
- Measured coverage: curating the top 5,000 English words yields ~1,007 usable
  words with `--exclude-origin en,ang,enm` (≈100 days). The unfiltered list would
  give 2,380, but includes words whose answer is England.
- Expect some candidates to be unreachable — rarities (unranked), dubious chains,
  pre-1500 dates. Skipping them is part of the loop, not a failure.
