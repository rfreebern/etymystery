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

import { GUESS_SPAN_YEARS, GUESS_STEP_YEARS, scoreTemporalSpan, type AnswerSpan } from "./scoring";

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

/** Every period a window of years touches — a 100-year window can straddle two. */
export function erasSpanned(from: number, to: number): Era[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const spanned = ERAS.filter((era) => era.to >= start && era.from <= end);
  return spanned.length > 0 ? spanned : [eraOf(start)];
}

/**
 * The range of values the timeline slider can take: its position is the FIRST
 * year of the player's window, and the window must stay inside the answer window,
 * so the last legal position is `ceiling - span`.
 */
export function sliderStartBounds(
  floor: number = ANSWER_YEAR_MIN,
  ceiling: number = ANSWER_YEAR_MAX,
): { min: number; max: number; step: number; span: number } {
  return {
    min: floor,
    max: Math.max(floor, ceiling - GUESS_SPAN_YEARS),
    step: GUESS_STEP_YEARS,
    span: GUESS_SPAN_YEARS,
  };
}

/**
 * The best temporal score a player could possibly get for an answer, given the
 * window the slider can express. Delegates to the real scorer — the best window is
 * the legal one closest to the answer (centred on it where possible) — so this can
 * never drift from what the game actually awards. Accepts a coarse span as well as
 * a single year, because an undated word is a range.
 */
export function bestPossibleTemporal(
  answer: number | AnswerSpan,
  floor: number = ANSWER_YEAR_MIN,
  ceiling: number = ANSWER_YEAR_MAX,
): number {
  const span: AnswerSpan = typeof answer === "number" ? { from: answer, to: answer } : answer;
  const { min, max, span: width } = sliderStartBounds(floor, ceiling);
  const centre = (span.from + span.to) / 2;
  const start = Math.min(Math.max(centre - width / 2, min), max);
  return scoreTemporalSpan(span, start, start + width);
}

/** Is this year playable on the timeline at all? */
export function isPlayableYear(
  year: number,
  floor: number = ANSWER_YEAR_MIN,
  ceiling: number = ANSWER_YEAR_MAX,
): boolean {
  return Number.isFinite(year) && year >= floor && year <= ceiling;
}

/**
 * The oldest English period named anywhere in an `originChain` (stored immediate
 * source first), e.g. `["Middle English", "Old Norse"]` gives Middle English.
 *
 * A chain that names an English stage is claiming the word was already IN English
 * by that period, which bounds its entry year: a word whose chain reaches back to
 * Old English cannot have entered English in 1590. This is what lets the tools
 * catch a drafted year contradicting the etymology it was drafted for, and what
 * lets a word with no datable first use take its span from the period itself.
 */
export function earliestEnglishEra(chain: readonly string[]): Era | null {
  for (const era of ERAS) {
    if (chain.some((hop) => hop === era.label || hop.startsWith(`${era.label} `))) return era;
  }
  return null;
}

/**
 * The period a span covers exactly, or null when it names specific years.
 *
 * A span taken from the record rather than from a date is set to its period's own
 * bounds (`earliestEnglishEra`), so this is how the reveal says "recorded in Old
 * English" rather than printing 700 and 1150 at the reader.
 */
export function periodOfSpan(span: { from: number; to: number }): Era | null {
  return ERAS.find((era) => era.from === span.from && era.to === span.to) ?? null;
}
