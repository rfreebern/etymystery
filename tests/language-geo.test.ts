import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildLanguageTable,
  deriveGeography,
  isProtoCode,
  loadOverlay,
  parseCodeList,
  toLanguageTsv,
  type CountryRecord,
  type GeoOverlay,
} from "../scripts/lib/language-geo";
import { parseLanguageTsv } from "../scripts/lib/languages";

const CODES = [
  "en,English",
  "sw,Swahili",
  "fa,Persian",
  "xyz,Farsi",
  "ine-pro,Proto-Indo-European",
  "xx-Yyy,Unknown",
].join("\n");

const COUNTRY_FIXTURE: CountryRecord[] = [
  { cca2: "KE", region: "Africa", subregion: "Eastern Africa", latlng: [1, 38], area: 580367, languages: { swa: "Swahili" } },
  { cca2: "TZ", region: "Africa", subregion: "Eastern Africa", latlng: [-6, 35], area: 947303, languages: { swa: "Swahili" } },
  { cca2: "CD", region: "Africa", subregion: "Middle Africa", latlng: [-2, 23], area: 2344858, languages: { swa: "Swahili" } },
  { cca2: "IR", region: "Asia", subregion: "Southern Asia", latlng: [32, 53], area: 1648195, languages: { fas: "Persian" } },
  { cca2: "GB", region: "Europe", subregion: "Northern Europe", latlng: [54, -2], area: 242900, languages: { eng: "English" } },
];

describe("parseCodeList", () => {
  it("reads the headerless, CRLF wiktionary_codes.csv format", () => {
    expect(parseCodeList("aa,Afar\r\nab,Abkhaz\r\n")).toEqual([
      { code: "aa", name: "Afar" },
      { code: "ab", name: "Abkhaz" },
    ]);
  });

  it("keeps names that contain commas intact", () => {
    expect(parseCodeList("xx,Odd, Comma Name").at(0)).toEqual({ code: "xx", name: "Odd, Comma Name" });
  });
});

describe("deriveGeography", () => {
  it("uses the modal subregion and an area-weighted representative point", () => {
    const derived = deriveGeography(COUNTRY_FIXTURE.filter((c) => c.languages?.swa === "Swahili"));
    expect(derived?.countries).toEqual(["CD", "KE", "TZ"]);
    expect(derived?.region).toBe("Eastern Africa"); // 2 of 3 beats Middle Africa
    expect(derived?.continent).toBe("Africa");
    expect(derived?.lat).toBeCloseTo(-2.53, 1); // pulled toward the DRC by area
  });

  it("returns null when nothing matches", () => {
    expect(deriveGeography([])).toBeNull();
  });
});

describe("buildLanguageTable", () => {
  const overlay: GeoOverlay = {
    en: { countries: ["GB"], region: "Northern Europe", continent: "Europe", lat: 54, lng: -2 },
    "ine-pro": { countries: ["UA"], region: "Eastern Europe", continent: "Europe", lat: 49, lng: 32, kind: "proto" },
  };

  it("prefers the overlay over the derivation", () => {
    const { rows } = buildLanguageTable({ codesText: CODES, overlay, countries: COUNTRY_FIXTURE });
    expect(rows.find((r) => r.code === "en")).toMatchObject({
      source: "overlay",
      countries: ["GB"],
      lat: 54,
      lng: -2,
      kind: "modern",
    });
  });

  it("falls back to the derivation for codes without an overlay entry", () => {
    const { rows } = buildLanguageTable({ codesText: CODES, overlay, countries: COUNTRY_FIXTURE });
    expect(rows.find((r) => r.code === "sw")).toMatchObject({
      source: "derived",
      region: "Eastern Africa",
      continent: "Africa",
    });
  });

  it("resolves name aliases between Wiktionary and world-countries", () => {
    const { rows } = buildLanguageTable({ codesText: CODES, overlay, countries: COUNTRY_FIXTURE });
    expect(rows.find((r) => r.code === "xyz")).toMatchObject({ source: "derived", countries: ["IR"] });
  });

  it("excludes reconstruct-only proto codes unless asked for them", () => {
    const excluded = buildLanguageTable({ codesText: CODES, overlay, countries: COUNTRY_FIXTURE });
    expect(excluded.rows.some((r) => r.code === "ine-pro")).toBe(false);
    expect(excluded.stats.protoSkipped).toBe(1);

    const included = buildLanguageTable({ codesText: CODES, overlay, countries: COUNTRY_FIXTURE, includeProto: true });
    expect(included.rows.find((r) => r.code === "ine-pro")).toMatchObject({ kind: "proto", countries: ["UA"] });
  });

  it("reports codes it could not place, and sorts rows by code", () => {
    const { rows, stats } = buildLanguageTable({ codesText: CODES, overlay, countries: COUNTRY_FIXTURE });
    expect(stats.unmatchedCodes).toEqual(["xx-Yyy"]); // no overlay entry, no country match
    expect(rows.map((r) => r.code)).toEqual(["en", "fa", "sw", "xyz"]);
  });

  it("flags derived entries spread across many countries for hand-anchoring", () => {
    const { stats } = buildLanguageTable({
      codesText: CODES,
      overlay,
      countries: COUNTRY_FIXTURE,
      reviewThreshold: 3,
    });
    expect(stats.reviewCodes).toEqual(["sw"]);
  });

  it("derives display labels from the anchor countries when the overlay omits them", () => {
    const { rows } = buildLanguageTable({
      codesText: "yy,Testish",
      overlay: { yy: { countries: ["KE"], lat: 1, lng: 38 } },
      countries: COUNTRY_FIXTURE,
    });
    expect(rows[0]).toMatchObject({ source: "overlay", region: "Eastern Africa", continent: "Africa" });
  });

  it("warns when an overlay's anchor countries are missing from the country table", () => {
    const { rows, stats } = buildLanguageTable({
      codesText: "zz,Testish",
      overlay: { zz: { countries: ["QQ"], lat: 1, lng: 2 } },
      countries: COUNTRY_FIXTURE,
    });
    expect(rows[0]?.region).toBe("");
    expect(stats.labelWarnings).toEqual(["zz: could not derive region/continent from anchor countries (QQ)"]);
  });
});

describe("toLanguageTsv", () => {
  it("round-trips through the production languages.tsv parser", () => {
    const overlay: GeoOverlay = {
      en: { countries: ["GB", "US"], region: "Northern Europe", continent: "Europe", lat: 54, lng: -2 },
    };
    const { rows } = buildLanguageTable({ codesText: "en,English", overlay, countries: COUNTRY_FIXTURE });
    const tsv = toLanguageTsv(rows);
    expect(tsv.split("\n")[0]).toBe("code\tname\tcountries\tregion\tcontinent\tlat\tlng");

    expect(parseLanguageTsv(tsv).en).toEqual({
      code: "en",
      name: "English",
      countries: ["GB", "US"],
      representativePoint: { lat: 54, lng: -2 },
      subregion: "Northern Europe",
      continent: "Europe",
    });
  });
});

describe("curated overlay (committed artifact)", () => {
  const overlay = loadOverlay(JSON.parse(readFileSync("curated/language-geo.json", "utf8")));
  const seedRows = Object.values(parseLanguageTsv(readFileSync("curated/languages.tsv", "utf8")));

  it("reproduces the shipped seed languages exactly (bank v1 stays reproducible)", () => {
    const codesText = seedRows.map((row) => `${row.code},${row.name}`).join("\n");
    // Empty country list: these assertions must come from the overlay alone.
    const { rows } = buildLanguageTable({ codesText, overlay, countries: [] });
    expect(rows.map((r) => r.code).sort()).toEqual(seedRows.map((r) => r.code).sort());

    for (const seed of seedRows) {
      const generated = rows.find((r) => r.code === seed.code)!;
      expect(generated.countries, seed.code).toEqual(seed.countries);
      expect(generated.region, seed.code).toBe(seed.subregion);
      expect(generated.continent, seed.code).toBe(seed.continent);
      expect(generated.lat, seed.code).toBeCloseTo(seed.representativePoint!.lat, 6);
      expect(generated.lng, seed.code).toBeCloseTo(seed.representativePoint!.lng, 6);
    }
  });

  it("only marks family/proto codes as proto", () => {
    const protoEntries = Object.entries(overlay).filter(([, entry]) => entry.kind === "proto");
    expect(protoEntries.length).toBeGreaterThan(0);
    expect(protoEntries.every(([code]) => isProtoCode(code))).toBe(true);
  });

  it("has complete geography on every entry (anchor countries, valid point)", () => {
    for (const [code, entry] of Object.entries(overlay)) {
      expect(entry.countries?.length, code).toBeGreaterThan(0);
      expect(Number.isFinite(entry.lat), code).toBe(true);
      expect(Number.isFinite(entry.lng), code).toBe(true);
      expect(entry.lat! >= -90 && entry.lat! <= 90, code).toBe(true);
      expect(entry.lng! >= -180 && entry.lng! <= 180, code).toBe(true);
      for (const iso of entry.countries!) expect(iso, code).toMatch(/^[A-Z]{2}$/);
    }
  });
});
