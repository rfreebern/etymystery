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

/** All the polygons of a geometry, whatever shape it arrives in. */
function asPolygons(geometry: MapGeometry): number[][][][] {
  return geometry.type === "MultiPolygon"
    ? [...geometry.coordinates]
    : [[...geometry.coordinates]];
}

/**
 * Join world-atlas features (numeric ids) to ISO2 codes via ccn3, MERGING the features
 * that share a code.
 *
 * The atlas splits some countries into several features (`Australia` and `Ashmore and
 * Cartier Is.` share ccn3 036, as do a handful of other territories), and a lookup keyed
 * by ISO code silently kept whichever came last. For Australia that was a one-polygon
 * reef 3,000 km offshore, so every pin on the mainland scored as a miss: `geoContains`
 * said Sydney was in Australia while the context said it was nowhere near it. Unioning
 * the geometries is also the truthful reading: they are all that country.
 */
export function toCountryFeatures(
  geometries: Array<{ id?: string | number; properties?: { name?: string }; geometry: MapGeometry }>,
): CountryFeature[] {
  const byCcn3 = new Map<string, string>();
  for (const [iso, meta] of Object.entries(COUNTRY_META)) {
    if (meta.ccn3) byCcn3.set(meta.ccn3, iso);
  }
  const byIso = new Map<string, CountryFeature>();
  for (const f of geometries) {
    const id = f.id === undefined || f.id === null ? null : String(f.id);
    const iso = id ? byCcn3.get(id) : undefined;
    if (!iso) continue;
    const name = f.properties?.name ?? COUNTRY_META[iso]!.name;
    const existing = byIso.get(iso);
    if (!existing) {
      byIso.set(iso, { iso, name, geometry: f.geometry });
      continue;
    }
    byIso.set(iso, {
      iso,
      name: existing.name,
      geometry: {
        type: "MultiPolygon",
        coordinates: [...asPolygons(existing.geometry), ...asPolygons(f.geometry)],
      },
    });
  }
  return [...byIso.values()];
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
