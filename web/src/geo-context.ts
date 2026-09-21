/**
 * Real-map implementation of GeocodeContext, backed by Natural Earth
 * country features (from world-atlas TopoJSON via topojson-client) and the
 * generated country metadata table. Pure and dependency-light enough to
 * unit test with small fixture polygons.
 */

import { geoContains } from "d3-geo";
import { distanceToGeometryKm, type MapGeometry } from "../../src/geo-utils";
import type { GeocodeContext } from "../../src/scoring";
import type { LanguageInfo } from "../../src/types";
import countriesMeta from "./countries.json";

export interface CountryFeature {
  /** ISO 3166-1 alpha-2 code. */
  iso: string;
  name: string;
  geometry: MapGeometry;
}

export interface CountryMetaEntry {
  ccn3: string | null;
  name: string;
  subregion: string | null;
  continent: string | null;
}

export const COUNTRY_META = countriesMeta as unknown as Record<string, CountryMetaEntry>;

/** Join world-atlas features (numeric ids) to ISO2 codes via ccn3. */
export function toCountryFeatures(
  geometries: Array<{ id?: string | number; properties?: { name?: string }; geometry: MapGeometry }>,
): CountryFeature[] {
  const byCcn3 = new Map<string, string>();
  for (const [iso, meta] of Object.entries(COUNTRY_META)) {
    if (meta.ccn3) byCcn3.set(meta.ccn3, iso);
  }
  const features: CountryFeature[] = [];
  for (const f of geometries) {
    const id = f.id === undefined || f.id === null ? null : String(f.id);
    const iso = id ? byCcn3.get(id) : undefined;
    if (!iso) continue;
    features.push({ iso, name: f.properties?.name ?? COUNTRY_META[iso]!.name, geometry: f.geometry });
  }
  return features;
}

export function createGeocodeContext(options: {
  features: CountryFeature[];
  languages: Record<string, LanguageInfo>;
}): GeocodeContext {
  const byIso = new Map(options.features.map((f) => [f.iso, f]));
  const allCodes = options.features.map((f) => f.iso);
  return {
    contains: (iso, p) => {
      const feature = byIso.get(iso);
      if (!feature) return false;
      return geoContains(
        { type: "Feature", geometry: feature.geometry, properties: {} },
        [p.lng, p.lat],
      ) === true;
    },
    distanceToCountryKm: (iso, p) => {
      const feature = byIso.get(iso);
      if (!feature) return Number.POSITIVE_INFINITY;
      return distanceToGeometryKm(p, feature.geometry);
    },
    allCountryCodes: () => allCodes,
    regionOf: (iso) => {
      const meta = COUNTRY_META[iso];
      if (!meta) return undefined;
      return { subregion: meta.subregion ?? undefined, continent: meta.continent ?? undefined };
    },
    languageOf: (name) => options.languages[name],
  };
}
