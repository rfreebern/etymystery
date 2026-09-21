/**
 * Language metadata TSV — the curation artifact that maps etymology-db /
 * Wiktionary language codes to modern geography:
 *
 *   code<TAB>name<TAB>countries<TAB>region<TAB>continent<TAB>lat<TAB>lng
 *
 * `countries` is a semicolon-separated list of ISO 3166-1 alpha-2 codes;
 * lat/lng are optional (decimal degrees); region/continent are optional and
 * should use UN M49 subregion names for scoring partial credit.
 */

import type { LanguageInfo } from "../../src/types";

export interface LanguageMetadata extends LanguageInfo {
  code: string;
}

export function parseLanguageTsv(text: string): Record<string, LanguageMetadata> {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const header = (lines[0] ?? "").split("\t").map((h) => h.trim().toLowerCase());
  const idx = (name: string): number => header.indexOf(name);
  const codeIdx = idx("code");
  const nameIdx = idx("name");
  if (codeIdx < 0 || nameIdx < 0) {
    throw new Error(`languages TSV is missing required columns 'code'/'name'; header: ${header.join(", ")}`);
  }
  const countriesIdx = idx("countries");
  const regionIdx = idx("region");
  const continentIdx = idx("continent");
  const latIdx = idx("lat");
  const lngIdx = idx("lng");

  const byCode: Record<string, LanguageMetadata> = {};
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const code = cols[codeIdx]?.trim();
    const name = cols[nameIdx]?.trim();
    if (!code || !name) continue;
    const countries = (cols[countriesIdx] ?? "")
      .split(";")
      .map((c) => c.trim())
      .filter((c) => /^[A-Z]{2}$/.test(c));
    const lat = latIdx >= 0 ? Number.parseFloat(cols[latIdx] ?? "") : Number.NaN;
    const lng = lngIdx >= 0 ? Number.parseFloat(cols[lngIdx] ?? "") : Number.NaN;
    const meta: LanguageMetadata = { code, name, countries };
    if (Number.isFinite(lat) && Number.isFinite(lng)) meta.representativePoint = { lat, lng };
    const region = regionIdx >= 0 ? (cols[regionIdx] ?? "").trim() : "";
    if (region) meta.subregion = region;
    const continent = continentIdx >= 0 ? (cols[continentIdx] ?? "").trim() : "";
    if (continent) meta.continent = continent;
    byCode[code] = meta;
  }
  return byCode;
}
