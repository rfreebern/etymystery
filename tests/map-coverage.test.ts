/**
 * The curation-side coverage check: which countries the shipped map can draw.
 * Its job is to catch an answer anchored to a territory with no outline (Tuvalu,
 * Tokelau, ...), where the puzzle is winnable only through the point fallback.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadDrawableCountries } from "../scripts/lib/map-coverage";
import { feature } from "topojson-client";
import { createGeocodeContext, toCountryFeatures } from "../web/src/geo-context";
import type { WordBank } from "../src/types";

const drawable = loadDrawableCountries("web/public/countries-50m.json", "web/src/countries.json");

describe("loadDrawableCountries", () => {
  it("knows the small territories 50m gained (and the two it still lacks)", () => {
    for (const code of ["US", "FR", "CN", "PF", "MT", "SG", "GU", "WS", "TO", "FO", "IM", "MU"]) {
      expect(drawable.has(code), code).toBe(true);
    }
    // Absent even from world-atlas 10m: these can only be scored by the point fallback.
    expect(drawable.has("TV")).toBe(false);
    expect(drawable.has("TK")).toBe(false);
  });

  it("agrees with the map the client actually loads", () => {
    const topo = JSON.parse(readFileSync("web/public/countries-50m.json", "utf8"));
    const collection = feature(topo, topo.objects.countries) as unknown as {
      features: Array<{ id?: string | number; geometry: never }>;
    };
    const bank = JSON.parse(readFileSync("web/public/word-bank.json", "utf8")) as WordBank;
    const ctx = createGeocodeContext({
      features: toCountryFeatures(collection.features),
      languages: bank.languages,
    });
    // Tahiti: reported in play as unfindable, now both drawn and reachable.
    expect(ctx.contains("PF", { lat: -17.65, lng: -149.45 })).toBe(true);
    expect(ctx.distanceToCountryKm("TV", { lat: -8.52, lng: 179.2 })).toBe(Number.POSITIVE_INFINITY);
  });
});
