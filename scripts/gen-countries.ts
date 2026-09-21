/**
 * Generate web/src/countries.json from the world-countries dataset:
 * ISO2 -> { numericId (world-atlas feature id), name, subregion, continent }.
 * Region names use UN M49 vocabulary, matching the languages.tsv curation.
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const worldCountries = require_("world-countries") as Array<{
  cca2: string;
  ccn3?: string;
  name: { common: string };
  region?: string;
  subregion?: string;
}>;

const out: Record<string, { ccn3: string | null; name: string; subregion: string | null; continent: string | null }> = {};
for (const c of worldCountries) {
  if (!c.cca2 || !/^[A-Z]{2}$/.test(c.cca2)) continue;
  out[c.cca2] = {
    ccn3: c.ccn3 ?? null,
    name: c.name.common,
    subregion: c.subregion ?? null,
    continent: c.region ?? null,
  };
}
writeFileSync("web/src/countries.json", `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote web/src/countries.json (${Object.keys(out).length} countries)`);
