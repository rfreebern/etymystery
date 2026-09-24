/**
 * Timeline slider geometry. Pure maths, so the tablet's position, the era scale
 * beneath it and the year labels cannot disagree with each other or with the
 * game — the whole point of extracting it.
 *
 * The trap this exists to avoid: a native range input puts its thumb's leading
 * edge at
 *
 *   (value - min) / (max - min) * (trackWidth - thumbWidth)
 *
 * i.e. the *travel* is narrower than the track by the thumb. The previous client
 * drew full-width era labels under a travel-width slider, so era boundaries sat
 * progressively further from the years they named — the label changed at the
 * wrong moment. Making the tablet `trackWidth * span / windowYears` wide fixes it
 * exactly: the leading edge then equals the year's position on a full-window
 * scale, so the era scale can simply span the full track.
 */

import { GUESS_SPAN_YEARS, GUESS_STEP_YEARS, spanGapYears } from "../../src/scoring";
import { ERAS, erasSpanned, type Era } from "../../src/timeline";

/** Re-exported so the client reads the guess geometry from one module. */
export { GUESS_SPAN_YEARS, GUESS_STEP_YEARS };

export function windowYears(floor: number, ceiling: number): number {
  return ceiling - floor;
}

/**
 * Width in px of the tablet thumb, so that it spans exactly the years the guess
 * covers across a full-window scale. Derived by solving
 * `thumb = (track - thumb) * span / windowYears`, which reduces to
 * `thumb = track * span / windowYears`.
 */
export function tabletWidthPx(trackWidthPx: number, floor: number, ceiling: number): number {
  const years = windowYears(floor, ceiling);
  if (!(trackWidthPx > 0) || !(years > 0)) return 0;
  // A window narrower than the span cannot hold the window: cap the tablet at the
  // whole track rather than overflow it.
  return (trackWidthPx * Math.min(GUESS_SPAN_YEARS, years)) / years;
}

/** Where a year sits along the full track, as a 0..1 fraction. */
export function yearFraction(year: number, floor: number, ceiling: number): number {
  const years = windowYears(floor, ceiling);
  if (!(years > 0)) return 0;
  return (year - floor) / years;
}

/**
 * A year's position along the track as a percentage, clamped to the track so a
 * year outside the answer window still lands on an end rather than off-screen.
 * This is the same mapping the slider's thumb uses, so a marker placed with it
 * sits exactly on the year it names.
 */
export function yearPositionPct(year: number, floor: number, ceiling: number): number {
  const fraction = yearFraction(year, floor, ceiling);
  return Math.min(Math.max(fraction, 0), 1) * 100;
}

/** An era's slice of the scale: percentages of the track, ready for CSS. */
export interface EraSegment {
  label: string;
  from: number;
  to: number;
  /** Left edge as a percentage of the track. */
  leftPct: number;
  widthPct: number;
}

export function eraSegments(
  floor: number,
  ceiling: number,
  eras: readonly Era[] = ERAS,
): EraSegment[] {
  const total = windowYears(floor, ceiling);
  if (!(total > 0)) return [];
  const visible = eras
    .map((era) => ({ ...era, from: Math.max(era.from, floor), to: Math.min(era.to, ceiling) }))
    .filter((era) => era.to >= era.from);
  return visible.map((era, index) => {
    // Boundaries fall on each period's START year. The axis is a continuum, so an
    // era runs until the next one begins: using `to` would overlap the next era and
    // `to + 1` would leave a year-wide sliver, and either way the slices stop
    // summing to the full width.
    const next = visible[index + 1]?.from ?? ceiling;
    const right = Math.max(next, era.from);
    return {
      label: era.label,
      from: era.from,
      to: era.to,
      leftPct: ((era.from - floor) / total) * 100,
      widthPct: ((right - era.from) / total) * 100,
    };
  });
}

/** `1450 – 1550`: the player's window, as shown above the slider. */
export function rangeLabel(start: number, end: number): string {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return `${from} – ${to}`;
}

/**
 * The periods the window touches, e.g. `Middle English · Early Modern` for
 * 1450–1550. A 100-year window often straddles a boundary, so naming one period
 * would be wrong half the time.
 */
export function rangeEraLabel(start: number, end: number): string {
  return erasSpanned(start, end).map((era) => era.label).join(" · ");
}

/** How far an answer fell outside the guessed window (0 when inside). */
export function outsideYears(answerYear: number, start: number, end: number): number {
  return outsideSpanYears({ from: answerYear, to: answerYear }, start, end);
}

/**
 * How far an answer SPAN fell outside the guessed window (0 when they overlap). A
 * coarse answer covers a range of years, so only a window missing the whole span counts
 * as a miss, and the distance is the gap between the two ranges.
 *
 * Delegates to the scorer: "missed by" is the same number on the timeline, in the
 * reveal and in the round summary, and a second copy of that arithmetic is how they
 * would come to disagree.
 */
export function outsideSpanYears(
  answer: { from: number; to: number },
  start: number,
  end: number,
): number {
  return spanGapYears(answer, start, end);
}

/**
 * A span's band on the track, as percentages ready for CSS: the same mapping the
 * thumb uses, so the band starts and ends on the years it names. A coarse answer
 * is drawn as a band rather than a dot because "somewhere in 700 – 1150" is what
 * the record actually says.
 */
export function spanBandPct(
  span: { from: number; to: number },
  floor: number,
  ceiling: number,
): { leftPct: number; widthPct: number } {
  const left = yearPositionPct(span.from, floor, ceiling);
  const right = yearPositionPct(span.to, floor, ceiling);
  return { leftPct: Math.min(left, right), widthPct: Math.abs(right - left) };
}
