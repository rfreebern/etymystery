# Licensing & Attribution

## Code

All original code in this repository. A license has not yet been chosen by
the project owner (MIT is a reasonable default for this kind of project).

## Data provenance (all open)

| Source | License | Notes |
|---|---|---|
| Wiktionary (en.wiktionary.org) | CC BY-SA 4.0 (dual GFDL) | Ultimate source of etymology-db and kaikki data |
| etymology-db (droher) | CC BY-SA 3.0 (code Apache-2.0) | Machine-readable etymology edges parsed from Wiktionary |
| kaikki.org / wiktextract | CC BY-SA + GFDL | Weekly JSONL extracts; see citation request below |
| Natural Earth / world-atlas | Public domain | Country polygons for the map |
| Glottolog (if used for language coords) | CC BY 4.0 | Language centroids/geoography |

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
