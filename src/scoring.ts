/**
 * Scoring: temporal + geographic proximity, both normalized to 0..100.
 *
 * Temporal: the player positions a 100-year window on the timeline, so any answer
 * that falls INSIDE the guessed range is a perfect score; outside it the score
 * decays with how far out the answer fell.
 *
 * Geographic: hop-aware and country-aware. The answer is anchored to the
 * word's DEEPEST origin (the last entry of originChain); intermediate hops
 * (e.g. the French in Arabic -> French -> English) score partial credit
 * (INTERMEDIATE_WEIGHT) only when the pin lands directly inside them. Country is
 * the unit of knowledge: a pin anywhere inside the answer's country is full marks,
 * while a wrong country scores by border proximity (1500 km decay scale) and a pin
 * farther than MAX_RELEVANCE_KM from every hop scores nothing. Region/continent
 * matches are reveal-time LABELS only and never add points. This yields: deep
 * origin's country > on-the-route country > nearby wrong country > far away = zero.
 */

import type { BankEntry, CountryCode, LanguageInfo, LatLng, RoundGuess, RoundScore } from "./types";
import { haversineKm } from "./geo-utils";

export { haversineKm };


/** Width of the window of years a player chooses on the timeline. */
export const GUESS_SPAN_YEARS = 100;
/** The slider moves in these increments — 4 placements per window width. */
export const GUESS_STEP_YEARS = 25;
/** Years over which temporal score decays beyond the guessed window. */
export const TEMPORAL_DECAY_YEARS = 100;
/** Curator's rule: the country IS the unit of knowledge, so a pin inside the
 *  answer's country scores full marks. Distance within a country is not a signal:
 *  the representative point of a long-dead language is a rough centroid (Rome for
 *  Latin, Oslo for Old Norse), and dozens of mapped languages share one country
 *  (20 in Italy alone), so nudging the pin cannot mean "wrong language". */
export const GEO_DECAY_KM = 1500;
/** Ordering of credit labels by match quality (labels only; score unaffected). */
const CREDIT_RANK: Record<RoundScore["credit"], number> = {
  none: 0,
  proximity: 1,
  continent: 2,
  subregion: 3,
  intermediate: 4,
  country: 5,
};
/** Weight of a direct hit on an intermediate hop's country (deep origin = 1.0). */
export const INTERMEDIATE_WEIGHT = 0.7;
/** Pins farther than this from every hop score nothing. */
export const MAX_RELEVANCE_KM = 5000;
/**
 * How far outside a country a pin may land and still count as inside it. Pins come
 * from a click on a 960x500 SVG and country outlines are the generalized 50m Natural
 * Earth ones, so a click on a coastal city can land a few km "at sea": the answer
 * point for `kiosk` and `yogurt` sits 4 km outside Turkey as drawn. The tolerance
 * keeps those clicks from being told they are in the wrong country. It is tiny next
 * to the 1500 km wrong-country decay, so it cannot rescue a genuine miss.
 */
export const COASTAL_TOLERANCE_KM = 25;
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

/**
 * Temporal proximity on 0..100 for a guessed RANGE of years. The player picks a
 * 100-year window; an answer anywhere inside it scores 100 (the answer years are
 * century-granular, so demanding a tighter hit would be luck, not knowledge).
 * An answer outside decays with its distance from the nearer edge.
 */
export function scoreTemporalRange(answerYear: number, from: number, to: number): number {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const over =
    answerYear < start ? start - answerYear : answerYear > end ? answerYear - end : 0;
  return Math.round(100 * Math.exp(-over / TEMPORAL_DECAY_YEARS));
}

/** A place the pin can be scored against: the deep origin, or an intermediate hop. */
interface Hop {
  countries: CountryCode[];
  point: LatLng;
}

interface HopDistance {
  /** Kilometers to the hop, or 0 when the pin is inside it. */
  km: number;
  /** Which of the hop's countries that distance belongs to, when known. */
  country: CountryCode | null;
}

/**
 * Distance from the pin to a hop, in km.
 *
 * When the hop's territory is not drawn on the map at all, there is no outline to
 * measure against and every pin would score zero however accurate (`Infinity`
 * distance). The 50m Natural Earth set still omits 76 small territories — French
 * Polynesia, Tuvalu, Tokelau, Guam, Malta, Singapore among them — so the
 * representative point stands in for the country: exactly on it is a country hit,
 * and away from it decays like any wrong-country pin. That keeps a Tahitian or
 * Tuvaluan answer winnable instead of impossible.
 */
function hopDistanceKm(ctx: GeocodeContext, hop: Hop, pin: LatLng): HopDistance {
  let best: HopDistance = { km: Number.POSITIVE_INFINITY, country: null };
  for (const country of hop.countries) {
    if (ctx.contains(country, pin)) return { km: 0, country };
    const d = ctx.distanceToCountryKm(country, pin);
    if (d < best.km) best = { km: d, country };
  }
  if (Number.isFinite(best.km)) return best;
  return { km: haversineKm(hop.point, pin), country: hop.countries[0] ?? null };
}

/** Geographic proximity on 0..100, hop-aware and country-aware. */
export function scoreGeographic(entry: BankEntry, guess: LatLng, ctx: GeocodeContext): GeographicDetail {
  const deep: Hop = { countries: entry.countries, point: entry.point };
  const intermediates: Hop[] = entry.originChain
    .slice(0, -1)
    .map((name) => ctx.languageOf(name))
    .filter(
      (info): info is LanguageInfo =>
        !!info && info.countries.length > 0 && !!info.representativePoint,
    )
    .map((info) => ({ countries: info.countries, point: info.representativePoint! }));

  const deepDistance = hopDistanceKm(ctx, deep, guess);
  const intermediateDistances = intermediates.map((hop) => hopDistanceKm(ctx, hop, guess));

  // Outer limit: the pin must be within MAX_RELEVANCE_KM of some hop.
  const nearestHopKm = Math.min(deepDistance.km, ...intermediateDistances.map((d) => d.km));
  if (!Number.isFinite(nearestHopKm) || nearestHopKm > MAX_RELEVANCE_KM) {
    return { score: 0, credit: "none", matchedCountry: null, distanceKm: null };
  }

  // 1. Direct hit on the deep origin's country: full marks, wherever in the
  //    country the pin lands. Distance inside a country is not evidence of a wrong
  //    answer (see GEO_DECAY_KM) — a pin in northern Italy is as correct for Latin
  //    as one on Rome. A pin just off the drawn coastline still counts
  //    (COASTAL_TOLERANCE_KM), and for a territory the map cannot draw, on the
  //    answer point counts (see hopDistanceKm).
  if (deepDistance.km <= COASTAL_TOLERANCE_KM) {
    return {
      score: 100,
      credit: "country",
      matchedCountry: deepDistance.country,
      distanceKm: Math.round(haversineKm(deep.point, guess)),
    };
  }

  // 2. Direct hit on an intermediate hop: partial credit, flat (Variant B — no
  //    border falloff; you must land inside the actual hop country).
  for (const [index, distance] of intermediateDistances.entries()) {
    if (distance.km <= COASTAL_TOLERANCE_KM) {
      return {
        score: Math.round(100 * INTERMEDIATE_WEIGHT),
        credit: "intermediate",
        matchedCountry: distance.country,
        distanceKm: Math.round(haversineKm(intermediates[index]!.point, guess)),
      };
    }
  }

  // 3. Wrong country: proximity to the deep origin's border (or, for a territory
  //    with no outline, to its point). This is both the floor and the ceiling for
  //    wrong-country pins: region matches never add points beyond it.
  let best: GeographicDetail =
    deepDistance.country === null || !Number.isFinite(deepDistance.km)
      ? { score: 0, credit: "none", matchedCountry: null, distanceKm: null }
      : {
          score: Math.round(100 * Math.exp(-deepDistance.km / GEO_DECAY_KM)),
          credit: "proximity",
          matchedCountry: deepDistance.country,
          distanceKm: Math.round(deepDistance.km),
        };

  // 4. Region/continent matches are reveal-time labels only: they never add
  //    points beyond border proximity (score is unchanged here).
  const primary = deep.countries[0];
  if (primary) {
    const answerRegion = ctx.regionOf(primary);
    if (answerRegion?.subregion || answerRegion?.continent) {
      for (const code of ctx.allCountryCodes()) {
        if (!ctx.contains(code, guess)) continue;
        const guessed = ctx.regionOf(code);
        if (!guessed) break;
        let level: RoundScore["credit"] | null = null;
        if (answerRegion.subregion && guessed.subregion === answerRegion.subregion) {
          level = "subregion";
        } else if (answerRegion.continent && guessed.continent === answerRegion.continent) {
          level = "continent";
        }
        if (level && CREDIT_RANK[level] > CREDIT_RANK[best.credit]) {
          best = { ...best, credit: level };
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
  guess: RoundGuess,
  ctx: GeocodeContext,
): RoundScore {
  const temporal = scoreTemporalRange(entry.year, guess.yearStart, guess.yearEnd);
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
