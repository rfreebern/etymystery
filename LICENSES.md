# Licensing & Attribution

## Code

**MIT** — see [LICENSE](LICENSE). It covers the code in this repository:
`src/`, `scripts/`, `admin/`, `web/`, `tests/` and the CI workflow.

## Data (a different licence: CC BY-SA)

The **data** is not MIT: everything derived from Wiktionary inherits its
share-alike terms, so `curated/`, `web/public/word-bank.json` and the generated
language/country tables are distributed under **CC BY-SA 4.0**. That is the whole
reason this repository publishes its curation artifacts rather than only the
generated bank: it keeps the share-alike obligation satisfied.

## Data provenance (all open)

| Source | License | Notes |
|---|---|---|
| Wiktionary (en.wiktionary.org) | CC BY-SA 4.0 (dual GFDL) | Ultimate source of etymology-db and kaikki data |
| etymology-db (droher) | CC BY-SA 3.0 (code Apache-2.0) | Machine-readable etymology edges parsed from Wiktionary |
| kaikki.org / wiktextract | CC BY-SA + GFDL | Weekly JSONL extracts; see citation request below |
| Natural Earth / world-atlas | Public domain | Country polygons for the map |
| Glottolog (if used for language coords) | CC BY 4.0 | Language centroids/geoography |
| FrequencyWords (hermitdave) | CC BY-SA 4.0 (code MIT) | English word-frequency ranks for the curation order; derived from the **OpenSubtitles 2018** corpus (attribution required to OpenSubtitles) |
| world-countries | MIT (ODbL for the data) | Country metadata: ISO codes, subregion/continent, coordinates |

**Share-alike obligation:** because the word bank is derived from CC BY-SA
data, `word-bank.json` and the curation artifacts are distributed under
CC BY-SA 4.0 as well. This is compatible with the game being free and
open.

## Attribution to ship in the app (About page)

- "Etymological data derived from [Wiktionary](https://en.wiktionary.org),
  used under CC BY-SA 4.0, via [etymology-db](https://github.com/droher/etymology-db)
  and [kaikki.org](https://kaikki.org)."
- Map data: "[Natural Earth](https://www.naturalearthdata.com) via
  [world-atlas](https://github.com/topojson/world-atlas)."
- Word-frequency ranks (used only to order the curation work list, never
  shipped in the bank): "Frequency data from
  [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (CC BY-SA 4.0),
  derived from the [OpenSubtitles](https://www.opensubtitles.org/) 2018 corpus."
- Country metadata: "[world-countries](https://github.com/mledoze/countries)."

## Academic citation requested by kaikki.org

> Tatu Ylonen: Wiktextract: Wiktionary as Machine-Readable Structured Data,
> Proceedings of the 13th Conference on Language Resources and Evaluation
> (LREC), pp. 1317-1325, Marseille, 20-25 June 2022.

## What deliberately is NOT used

- **Etymonline**: copyrighted; no open license or API; scraping violates
  its ToS. Used (if at all) only by a human curator as a *reference*,
  never bulk-copied.
- **Merriam-Webster API**: free tier is non-commercial with no automated
  bulk querying; incompatible with baking data into a static bank. Its
  "first known use" dates are facts, so a human curator may consult them
  while writing `curation.json`.
- **WordWeb / Wordnik**: proprietary/licensed content, not redistributable
  into this project.
- **Scraping or proxying the reference sites** (e.g. fetching Etymonline
  server-side to render it): the curation admin app embeds reference pages in
  iframes and links out where a site forbids framing, so the browser loads them
  exactly as a human would. Nothing is fetched, stored or re-published by this
  project's own server.
- **Google Books / Google Trillion Word Corpus lists** (`google-10000-english`
  and similar): no explicit license, so not used. The SUBTLEX lists that
  `wordfreq` redistributes with permission are also avoided here; the chosen
  source is CC BY-SA 4.0 and needs only attribution.
