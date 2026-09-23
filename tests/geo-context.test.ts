import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { feature } from "topojson-client";
import { scoreGeographic } from "../src/scoring";
import { createGeocodeContext, toCountryFeatures, type CountryFeature } from "../web/src/geo-context";
import type { LanguageInfo } from "../src/types";

/** Rect fixtures as real GeoJSON features for d3-geo. */
function featureFromRings(rings: number[][][], id: string): CountryFeature & { id: string } {
  return {
    id,
    iso: id,
    name: id,
    geometry: { type: "Polygon", coordinates: rings },
  };
}

function rectRings(lonMin: number, lonMax: number, latMin: number, latMax: number): number[][] {
  // Clockwise (d3-geo's spherical winding convention for exteriors).
  return [
    [lonMin, latMin],
    [lonMin, latMax],
    [lonMax, latMax],
    [lonMax, latMin],
    [lonMin, latMin],
  ];
}

const LANGUAGES: Record<string, LanguageInfo> = {
  French: { name: "French", countries: ["FR"], representativePoint: { lat: 48.85, lng: 2.35 }, subregion: "Western Europe", continent: "Europe" },
  Norwegian: { name: "Norwegian", countries: ["NO"], representativePoint: { lat: 61, lng: 9 }, subregion: "Northern Europe", continent: "Europe" },
  Russian: { name: "Russian", countries: ["RU"], representativePoint: { lat: 55.8, lng: 37.6 }, subregion: "Eastern Europe", continent: "Europe" },
};

function makeFeatures(): CountryFeature[] {
  const raw = [
    featureFromRings([rectRings(4, 14, 58, 66)], "NO"),
    featureFromRings([rectRings(11, 24, 58, 69)], "SE"),
    featureFromRings([rectRings(3.3, 7.2, 50.8, 53.7)], "NL"),
    featureFromRings([rectRings(28, 179, 40, 75)], "RU"),
    featureFromRings([rectRings(-1, 8, 42, 51)], "FR"),
    featureFromRings([rectRings(34.5, 56, 16, 32)], "SA"),
    featureFromRings([rectRings(129, 146, 31, 46)], "JP"),
    featureFromRings([rectRings(26, 45, 36, 42)], "TR"),
  ];
  // toCountryFeatures joins by ccn3; bypass the join for fixture features by
  // mapping ids directly through the meta table in the test.
  return raw;
}

function makeContext() {
  return createGeocodeContext({ features: makeFeatures(), languages: LANGUAGES });
}

describe("createGeocodeContext (fixture features)", () => {
  const ctx = makeContext();

  it("answers contains() through d3-geo", () => {
    expect(ctx.contains("NO", { lat: 61, lng: 9 })).toBe(true);
    expect(ctx.contains("NO", { lat: 52, lng: 5 })).toBe(false);
    expect(ctx.contains("XX", { lat: 61, lng: 9 })).toBe(false);
  });

  it("reports 0 distance inside, border distance outside", () => {
    expect(ctx.distanceToCountryKm("NO", { lat: 61, lng: 9 })).toBe(0);
    // ~1.10 deg: the border arc bulges poleward (see geo-utils tests).
    const d = ctx.distanceToCountryKm("NO", { lat: 57, lng: 9 });
    expect(d).toBeGreaterThan(112);
    expect(d).toBeLessThan(130);
  });

  it("exposes region metadata and language metadata", () => {
    expect(ctx.regionOf("NO")).toMatchObject({ subregion: "Northern Europe", continent: "Europe" });
    expect(ctx.languageOf("French")).toBeDefined();
    expect(ctx.languageOf("Klingon")).toBeUndefined();
  });
});

describe("every shipped puzzle can be won", () => {
  // The property that matters most and was previously unguarded: clicking the exact
  // answer point must earn full country credit. It held by luck before — a language
  // anchored to a territory the map omits (Tahitian, Tuvaluan, Maltese, Samoan ...)
  // would score ZERO for every possible pin, because there is no outline to measure
  // against, and nothing in the pipeline said so.
  const topo = JSON.parse(readFileSync("web/public/countries-50m.json", "utf8")) as Parameters<typeof feature>[0];
  const collection = feature(
    topo as never,
    (topo as unknown as { objects: Record<string, never> }).objects.countries as never,
  ) as unknown as {
    features: Array<{ id?: string | number; properties?: { name?: string }; geometry: never }>;
  };
  const bank = JSON.parse(readFileSync("web/public/word-bank.json", "utf8")) as {
    masterSequence: Array<{
      word: string;
      originLanguage: string;
      countries: string[];
      point: { lat: number; lng: number };
      originChain: string[];
      year: number;
    }>;
    languages: Record<string, LanguageInfo>;
  };
  const features = toCountryFeatures(collection.features);
  const ctx = createGeocodeContext({ features, languages: bank.languages });

  it("scores 100 on the answer point of every entry in the shipped bank", () => {
    const failures: string[] = [];
    for (const entry of bank.masterSequence) {
      const detail = scoreGeographic(entry as never, entry.point, ctx);
      if (detail.score !== 100 || detail.credit !== "country") {
        failures.push(
          `${entry.word} (${entry.originLanguage} / ${entry.countries.join(",")}): ` +
            `${detail.score} credit ${detail.credit}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("lists the answers the map cannot draw at all, so a new one is visible", () => {
    // These rely on the representative-point fallback instead of an outline.
    // Tuvalu and Tokelau are absent even from world-atlas 10m, so no resolution
    // upgrade removes them; the fallback is what keeps them winnable. Pinned to an
    // exact list: if a new language joins it, this fails and someone looks.
    const unrepresentable = Object.entries(bank.languages)
      .filter(([, info]) =>
        info.countries.length > 0 &&
        info.representativePoint &&
        info.countries.every(
          (code) => ctx.distanceToCountryKm(code, info.representativePoint!) === Number.POSITIVE_INFINITY,
        ),
      )
      .map(([name]) => name)
      .sort();
    expect(unrepresentable).toEqual(["Tokelauan", "Tuvaluan"]);
  });
});

describe("world-atlas integration", () => {
  const topo = JSON.parse(readFileSync("web/public/countries-50m.json", "utf8")) as Parameters<typeof feature>[0];
  const collection = feature(
    topo as never,
    (topo as unknown as { objects: Record<string, never> }).objects.countries as never,
  ) as unknown as {
    features: Array<{ id?: string | number; properties?: { name?: string }; geometry: never }>;
  };
  const features = toCountryFeatures(collection.features);
  const ctx = createGeocodeContext({ features, languages: LANGUAGES });

  it("loads real country features and answers queries about the real map", () => {
    expect(features.length).toBeGreaterThan(150);

    expect(ctx.contains("NO", { lat: 59.91, lng: 10.75 })).toBe(true); // Oslo
    expect(ctx.contains("RU", { lat: 43.1, lng: 131.9 })).toBe(true); // Vladivostok
    expect(ctx.contains("NO", { lat: 0, lng: 0 })).toBe(false);

    const distance = ctx.distanceToCountryKm("NO", { lat: 52.08, lng: 5.12 });
    expect(distance).toBeGreaterThan(600); // Utrecht is ~700+ km from Norway
    expect(distance).toBeLessThan(1000);

    expect(ctx.regionOf("NO")).toMatchObject({ subregion: "Northern Europe" });
    expect(ctx.regionOf("JP")).toMatchObject({ subregion: "Eastern Asia" });
  });

  it("REQUIREMENT: edge-of-Russia beats Netherlands-for-Norway on the real map", () => {
    const russianWord = {
      id: "samovar", word: "samovar", year: 1830, tier: 4,
      originChain: ["Russian"], originLanguage: "Russian", countries: ["RU"],
      point: { lat: 55.8, lng: 37.6 }, blurb: "From Russian.",
    };
    const norwegianWord = {
      id: "window", word: "window", year: 1225, tier: 8,
      originChain: ["Norwegian"], originLanguage: "Norwegian", countries: ["NO"],
      point: { lat: 61, lng: 9 }, blurb: "From Old Norse.",
    };

    const vladivostok = scoreGeographic(russianWord, { lat: 43.1, lng: 131.9 }, ctx);
    expect(vladivostok.credit).toBe("country");
    // Full marks: the right country is the right answer, wherever inside it the
    // pin lands (this used to score 90 for being far from Moscow).
    expect(vladivostok.score).toBe(100);

    const utrecht = scoreGeographic(norwegianWord, { lat: 52.08, lng: 5.12 }, ctx);
    expect(utrecht.credit).toBe("continent");
    expect(utrecht.score).toBeGreaterThan(55);
    expect(utrecht.score).toBeLessThan(75);

    expect(vladivostok.score).toBeGreaterThan(utrecht.score);
  });
});
