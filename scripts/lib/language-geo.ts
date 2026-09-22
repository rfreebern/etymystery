/**
 * Build a languages.tsv from Wiktionary's language code list, combining
 * (a) a hand-curated geography overlay and (b) an automated derivation from the
 * world-countries dataset.
 *
 * Why both: the code list (wiktionary_codes.csv, ~8.6k codes) carries only
 * `code,name`, and world-countries names only ~155 modern languages — no
 * historical (Latin, Old Norse) or reconstructed (Proto-Indo-European) ones.
 * The overlay therefore carries everything that matters for English etymology;
 * the derivation fills the long tail. Overlay wins per language.
 *
 * Proto/family codes (e.g. ine-pro, gem-pro, sla-pro) are reconstruct-only:
 * anchoring them to a modern country would be indefensible, so they are
 * EXCLUDED by default and opted into with `includeProto`.
 */

import type { LanguageInfo } from "../../src/types";

export type LanguageKind = "modern" | "historical" | "proto";

export interface GeoOverlayEntry {
  countries?: string[];
  /** UN M49 subregion name (scoring vocabulary). */
  region?: string;
  /** UN M49 continent/region name (scoring vocabulary). */
  continent?: string;
  lat?: number;
  lng?: number;
  kind?: LanguageKind;
  note?: string;
}

export type GeoOverlay = Record<string, GeoOverlayEntry>;

/**
 * Read an overlay JSON object, dropping documentation keys (those starting
 * with "_") so callers never have to remember the convention.
 */
export function loadOverlay(raw: unknown): GeoOverlay {
  const overlay: GeoOverlay = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith("_")) continue;
    if (value && typeof value === "object") overlay[key] = value as GeoOverlayEntry;
  }
  return overlay;
}

/** The subset of a world-countries entry this module needs. */
export interface CountryRecord {
  cca2: string;
  name?: { common?: string };
  region?: string;
  subregion?: string;
  latlng?: [number, number] | number[];
  area?: number;
  languages?: Record<string, string>;
}

export interface LanguageRow {
  code: string;
  name: string;
  countries: string[];
  region: string;
  continent: string;
  lat: number;
  lng: number;
  source: "overlay" | "derived";
  kind: LanguageKind;
}

export interface BuildLanguageTableStats {
  codes: number;
  fromOverlay: number;
  derived: number;
  protoSkipped: number;
  unmatched: number;
  /** Codes with no overlay entry and no derivation, alphabetical. */
  unmatchedCodes: string[];
  /** Derived entries spanning many countries: worth hand-anchoring. */
  reviewCodes: string[];
  /** Overlay entries whose region/continent could not be resolved. */
  labelWarnings: string[];
}

export interface BuildLanguageTableResult {
  rows: LanguageRow[];
  stats: BuildLanguageTableStats;
}

/**
 * Names that differ between Wiktionary's code list and world-countries.
 * Small, explicit and test-covered: a curation aid, not a heuristic.
 */
export const LANGUAGE_NAME_ALIASES: Record<string, string> = {
  "mandarin chinese": "chinese",
  "min nan chinese": "chinese",
  cantonese: "chinese",
  farsi: "persian",
  "greek (modern)": "greek",
  "modern greek": "greek",
};

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse `code,name` (wiktionary_codes.csv — no header, CRLF, unquoted). */
export function parseCodeList(text: string): Array<{ code: string; name: string }> {
  const out: Array<{ code: string; name: string }> = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const code = line.slice(0, comma).trim();
    const name = line.slice(comma + 1).trim();
    if (!code || !name) continue;
    out.push({ code, name });
  }
  return out;
}

function modal(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = "";
  let bestCount = -1;
  // Deterministic: highest count, then alphabetical.
  for (const [value, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Invert world-countries: normalized language name -> countries speaking it. */
export function deriveCountryIndex(countries: readonly CountryRecord[]): Map<string, CountryRecord[]> {
  const index = new Map<string, CountryRecord[]>();
  for (const country of countries) {
    for (const name of Object.values(country.languages ?? {})) {
      const key = normalizeName(name);
      const list = index.get(key);
      if (list) list.push(country);
      else index.set(key, [country]);
    }
  }
  return index;
}

/**
 * Derive geography for a modern language from the countries that speak it:
 * modal subregion/continent for the scoring labels, and an area-weighted mean
 * of country coordinates as the representative point (area weighting keeps a
 * language spoken in one large country anchored near that country's centre of
 * mass rather than in a microstate).
 */
export function deriveGeography(
  matching: readonly CountryRecord[],
): { countries: string[]; region: string; continent: string; lat: number; lng: number } | null {
  const usable = matching.filter(
    (c) => c.cca2 && Array.isArray(c.latlng) && c.latlng.length >= 2 && c.latlng.every((v) => Number.isFinite(v)),
  );
  if (usable.length === 0) return null;

  let weightSum = 0;
  let latSum = 0;
  let lngSum = 0;
  for (const country of usable) {
    const weight = country.area && country.area > 0 ? country.area : 1;
    const lat = Number(country.latlng![0]);
    const lng = Number(country.latlng![1]);
    weightSum += weight;
    latSum += lat * weight;
    lngSum += lng * weight;
  }

  const regions = usable.map((c) => c.subregion ?? "").filter(Boolean);
  const continents = usable.map((c) => c.region ?? "").filter(Boolean);
  return {
    countries: [...new Set(usable.map((c) => c.cca2))].sort(),
    region: modal(regions),
    continent: modal(continents),
    lat: Number((latSum / weightSum).toFixed(3)),
    lng: Number((lngSum / weightSum).toFixed(3)),
  };
}

function overlayRow(
  code: string,
  name: string,
  entry: GeoOverlayEntry,
  kind: LanguageKind,
  byIso: ReadonlyMap<string, CountryRecord>,
  warnings: string[],
): LanguageRow | null {
  const countries = (entry.countries ?? []).filter((c) => /^[A-Z]{2}$/.test(c));
  if (!countries.length || !Number.isFinite(entry.lat) || !Number.isFinite(entry.lng)) return null;

  // Labels are derived from the anchor countries unless stated explicitly, so
  // they always use the same region vocabulary as the pin's country lookup.
  const subregions = countries.map((iso) => byIso.get(iso)?.subregion).filter((v): v is string => Boolean(v));
  const continents = countries.map((iso) => byIso.get(iso)?.region).filter((v): v is string => Boolean(v));
  const region = entry.region ?? modal(subregions);
  const continent = entry.continent ?? modal(continents);
  if (!region || !continent) {
    warnings.push(`${code}: could not derive region/continent from anchor countries (${countries.join(";")})`);
  }

  return {
    code,
    name,
    countries,
    region,
    continent,
    lat: Number(entry.lat),
    lng: Number(entry.lng),
    source: "overlay",
    kind,
  };
}

/** Family/proto codes only exist as reconstructions and have no modern home. */
export function isProtoCode(code: string): boolean {
  return /-pro$/.test(code);
}

export function buildLanguageTable(options: {
  codesText: string;
  overlay: GeoOverlay;
  countries: readonly CountryRecord[];
  includeProto?: boolean;
  /** Countries-per-language threshold that flags an entry for hand-anchoring. */
  reviewThreshold?: number;
}): BuildLanguageTableResult {
  const { codesText, overlay, countries } = options;
  const includeProto = options.includeProto ?? false;
  const reviewThreshold = options.reviewThreshold ?? 5;

  const codeList = parseCodeList(codesText);
  const countryIndex = deriveCountryIndex(countries);
  const byIso = new Map(countries.map((c) => [c.cca2, c]));
  const rows: LanguageRow[] = [];
  const unmatchedCodes: string[] = [];
  const reviewCodes: string[] = [];
  const labelWarnings: string[] = [];
  let fromOverlay = 0;
  let derived = 0;
  let protoSkipped = 0;

  for (const { code, name } of codeList) {
    const entry = overlay[code];
    const kind: LanguageKind = entry?.kind ?? (isProtoCode(code) ? "proto" : "modern");

    if (kind === "proto" && !includeProto) {
      protoSkipped += 1;
      continue;
    }

    if (entry) {
      const row = overlayRow(code, name, entry, kind, byIso, labelWarnings);
      if (row) {
        rows.push(row);
        fromOverlay += 1;
        continue;
      }
    }

    const normalized = normalizeName(name);
    const aliased = LANGUAGE_NAME_ALIASES[normalized] ?? normalized;
    const matching = countryIndex.get(normalized) ?? countryIndex.get(aliased);
    const geography = matching ? deriveGeography(matching) : null;
    if (!geography) {
      unmatchedCodes.push(code);
      continue;
    }
    rows.push({ code, name, ...geography, source: "derived", kind });
    derived += 1;
    if (geography.countries.length >= reviewThreshold) reviewCodes.push(code);
  }

  rows.sort((a, b) => a.code.localeCompare(b.code));
  return {
    rows,
    stats: {
      codes: codeList.length,
      fromOverlay,
      derived,
      protoSkipped,
      unmatched: unmatchedCodes.length,
      unmatchedCodes: unmatchedCodes.sort(),
      reviewCodes: reviewCodes.sort(),
      labelWarnings,
    },
  };
}

/** Serialize rows to the languages.tsv contract (see parseLanguageTsv). */
export function toLanguageTsv(rows: readonly LanguageRow[]): string {
  const lines = ["code\tname\tcountries\tregion\tcontinent\tlat\tlng"];
  for (const row of rows) {
    lines.push(
      [row.code, row.name, row.countries.join(";"), row.region, row.continent, row.lat, row.lng].join("\t"),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Project a generated row into the LanguageInfo shape used by the bank. */
export function languageInfoOf(row: LanguageRow): LanguageInfo {
  return {
    name: row.name,
    countries: row.countries,
    representativePoint: { lat: row.lat, lng: row.lng },
    subregion: row.region || undefined,
    continent: row.continent || undefined,
  };
}
