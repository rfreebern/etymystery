/**
 * Scoring: temporal + geographic proximity, both normalized to 0..100.
 *
 * Temporal: distance between the guessed year and the attested year, with a
 * scoring window so that "same century" guesses score well (answers are
 * century-granular).
 *
 * Geographic: hop-aware and country-aware. The answer is anchored to the
 * word's DEEPEST origin (the last entry of originChain); intermediate hops
 * (e.g. the French in Arabic -> French -> English) score partial credit
 * (INTERMEDIATE_WEIGHT) only when the pin lands directly inside them, while
 * the deep origin additionally gets border-proximity falloff and
 * subregion/continent fallback. Pins farther than MAX_RELEVANCE_KM from
 * every hop score nothing. This yields: deep origin > on-the-route country
 * > nearby wrong country > far away = zero.
 */

import type { BankEntry, LanguageInfo, LatLng, RoundScore } from "./types";

/** Full temporal credit within this many years of the answer. */
export const SCORING_WINDOW_YEARS = 50;
/** Years over which temporal score decays beyond the scoring window. */
export const TEMPORAL_DECAY_YEARS = 100;
/** Distance over which geographic score decays beyond the answer border. */
export const GEO_DECAY_KM = 1500;
/** Max penalty for pinning far from the answer point *inside* the right country. */
export const INSIDE_PENALTY_MAX = 0.1;
/** Distance at which the in-country penalty reaches its max. */
export const INSIDE_PENALTY_DISTANCE_KM = 3000;
/** Partial credit for guessing within the answer's subregion. */
export const SUBREGION_CREDIT = 0.5;
/** Partial credit for guessing within the answer's continent. */
export const CONTINENT_CREDIT = 0.25;
/** Weight of a direct hit on an intermediate hop's country (deep origin = 1.0). */
export const INTERMEDIATE_WEIGHT = 0.7;
/** Pins farther than this from every hop score nothing. */
export const MAX_RELEVANCE_KM = 5000;
/** Weight of the temporal component in the round total. */
export const TEMPORAL_WEIGHT = 0.5;
/** Weight of the geographic component in the round total. */
export const GEOGRAPHIC_WEIGHT = 0.5;

/** Adapter the host app provides to bind scoring to its map + language data. */
export interface GeocodeContext {
  /** Whether the point lies inside the given country's borders. */
  contains(countryCode: string, point: LatLng): boolean;
  /** Kilometers from the point to the nearest border of the country (0 if inside). */
  distanceToCountryKm(countryCode: string, point: LatLng): number;
  /** All country codes known to the map (for reverse lookup of the guessed country). */
  allCountryCodes(): string[];
  /** Region metadata for a country code, if known. */
  regionOf(countryCode: string): { subregion?: string; continent?: string } | undefined;
  /** Map metadata for a language named in BankEntry.originChain. */
  languageOf(languageName: string): LanguageInfo | undefined;
}

export interface GeographicDetail {
  score: number;
  credit: RoundScore["credit"];
  matchedCountry: string | null;
  distanceKm: number | null;
}

/** Great-circle distance in km between two points. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371.0088;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Temporal proximity on 0..100. */
export function scoreTemporal(year: number, guess: number): number {
  const diff = Math.abs(year - guess);
  const over = Math.max(0, diff - SCORING_WINDOW_YEARS);
  return Math.round(100 * Math.exp(-over / TEMPORAL_DECAY_YEARS));
}

/** Geographic proximity on 0..100, hop-aware and country-aware. */
export function scoreGeographic(entry: BankEntry, guess: LatLng, ctx: GeocodeContext): GeographicDetail {
  const deep = { countries: entry.countries, point: entry.point };
  const intermediates = entry.originChain
    .slice(0, -1)
    .map((name) => ctx.languageOf(name))
    .filter(
      (info): info is LanguageInfo =>
        !!info && info.countries.length > 0 && !!info.representativePoint,
    );

  // Outer limit: the pin must be within MAX_RELEVANCE_KM of some hop.
  let nearestHopKm = Number.POSITIVE_INFINITY;
  const hops = [
    ...intermediates.map((info) => ({ countries: info.countries, point: info.representativePoint! })),
    deep,
  ];
  for (const hop of hops) {
    for (const country of hop.countries) {
      const d = ctx.distanceToCountryKm(country, guess);
      if (Number.isFinite(d) && d < nearestHopKm) nearestHopKm = d;
    }
  }
  if (!Number.isFinite(nearestHopKm) || nearestHopKm > MAX_RELEVANCE_KM) {
    return { score: 0, credit: "none", matchedCountry: null, distanceKm: null };
  }

  // 1. Direct hit on the deep origin's country: high score, gentle decay.
  for (const country of deep.countries) {
    if (ctx.contains(country, guess)) {
      const dist = haversineKm(deep.point, guess);
      const penalty = INSIDE_PENALTY_MAX * Math.min(1, dist / INSIDE_PENALTY_DISTANCE_KM);
      return {
        score: Math.round(100 * (1 - penalty)),
        credit: "country",
        matchedCountry: country,
        distanceKm: Math.round(dist),
      };
    }
  }

  // 2. Direct hit on an intermediate hop: partial credit (Variant B — no
  //    border falloff; you must land inside the actual hop country).
  for (const hop of intermediates) {
    for (const country of hop.countries) {
      if (ctx.contains(country, guess)) {
        const dist = haversineKm(hop.representativePoint!, guess);
        const penalty = INSIDE_PENALTY_MAX * Math.min(1, dist / INSIDE_PENALTY_DISTANCE_KM);
        return {
          score: Math.round(100 * (1 - penalty) * INTERMEDIATE_WEIGHT),
          credit: "intermediate",
          matchedCountry: country,
          distanceKm: Math.round(dist),
        };
      }
    }
  }

  // 3. Wrong country: proximity to the deep origin's border.
  let best: GeographicDetail = { score: 0, credit: "none", matchedCountry: null, distanceKm: null };
  for (const country of deep.countries) {
    const d = ctx.distanceToCountryKm(country, guess);
    if (!Number.isFinite(d)) continue;
    const score = Math.round(100 * Math.exp(-d / GEO_DECAY_KM));
    if (score > best.score) {
      best = { score, credit: "proximity", matchedCountry: country, distanceKm: Math.round(d) };
    }
  }

  // 4. Partial credit for the right region/continent of the guessed country.
  const primary = deep.countries[0];
  if (primary) {
    const answerRegion = ctx.regionOf(primary);
    if (answerRegion?.subregion || answerRegion?.continent) {
      for (const code of ctx.allCountryCodes()) {
        if (!ctx.contains(code, guess)) continue;
        const guessed = ctx.regionOf(code);
        if (!guessed) break;
        let credit: RoundScore["credit"] = "none";
        let boost = 0;
        if (answerRegion.subregion && guessed.subregion === answerRegion.subregion) {
          credit = "subregion";
          boost = SUBREGION_CREDIT;
        } else if (answerRegion.continent && guessed.continent === answerRegion.continent) {
          credit = "continent";
          boost = CONTINENT_CREDIT;
        }
        if (Math.round(100 * boost) > best.score) {
          best = { score: Math.round(100 * boost), credit, matchedCountry: code, distanceKm: null };
        }
        break;
      }
    }
  }

  return best;
}

/** Score a full round. */
export function scoreRound(
  entry: BankEntry,
  guess: { year: number; point?: LatLng | null },
  ctx: GeocodeContext,
): RoundScore {
  const temporal = scoreTemporal(entry.year, guess.year);
  const geo = guess.point
    ? scoreGeographic(entry, guess.point, ctx)
    : ({ score: 0, credit: "none", matchedCountry: null, distanceKm: null } as GeographicDetail);
  return {
    temporal,
    geographic: geo.score,
    total: Math.round(TEMPORAL_WEIGHT * temporal + GEOGRAPHIC_WEIGHT * geo.score),
    matchedCountry: geo.matchedCountry,
    distanceKm: geo.distanceKm,
    credit: geo.credit,
  };
}
