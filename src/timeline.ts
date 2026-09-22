/**
 * The answer window: the span of years a player can express on the timeline,
 * plus the periods that make that span legible. This is the single source of
 * truth — the web client, the curation CLI and the admin app all read it, so the
 * curation tools can never disagree with what the game can actually score.
 *
 * Floor = 700: the start of the English written record (Cædmon's Hymn). It keeps
 * the Old English loanword layer (cheese, butter, mile, church ... from Latin and
 * Greek) curatable instead of unusable, while leaving difficulty to the tiers.
 */

import { scoreTemporal } from "./scoring";

export const ANSWER_YEAR_MIN = 700;
export const ANSWER_YEAR_MAX = 2025;

export interface Era {
  label: string;
  from: number;
  /** Inclusive end year. */
  to: number;
}

export const ERAS: readonly Era[] = [
  { label: "Old English", from: ANSWER_YEAR_MIN, to: 1150 },
  { label: "Middle English", from: 1151, to: 1500 },
  { label: "Early Modern", from: 1501, to: 1700 },
  { label: "Modern", from: 1701, to: ANSWER_YEAR_MAX },
];

/** The period a year falls in, for labels. */
export function eraOf(year: number): Era {
  return ERAS.find((era) => year >= era.from && year <= era.to) ?? ERAS[ERAS.length - 1]!;
}

/**
 * The best temporal score a player could possibly get for an answer year, given
 * the window the slider can express. Delegates to the real scorer — the maximum
 * is achieved by guessing exactly `clamp(year)` — so this can never drift from
 * what the game actually awards.
 */
export function bestPossibleTemporal(
  year: number,
  floor: number = ANSWER_YEAR_MIN,
  ceiling: number = ANSWER_YEAR_MAX,
): number {
  const nearest = Math.min(Math.max(year, floor), ceiling);
  return scoreTemporal(year, nearest);
}

/** Is this year playable on the timeline at all? */
export function isPlayableYear(
  year: number,
  floor: number = ANSWER_YEAR_MIN,
  ceiling: number = ANSWER_YEAR_MAX,
): boolean {
  return Number.isFinite(year) && year >= floor && year <= ceiling;
}
