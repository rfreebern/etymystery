/**
 * Reveal text for the origin route.
 *
 * Three facts shape this, and the first two have been got wrong on screen before:
 *
 * 1. `originChain` is ordered from the word's IMMEDIATE source outwards, but the
 *    route is DISPLAYED oldest-first, ending at English: `Latin → Old French →
 *    Middle English → English`. English reads left to right, so a route that starts
 *    at the word and walks backwards asks the reader to reverse every hop — and an
 *    earlier version reversed the array instead, which printed the derivation
 *    inside out ("English ← Latin ← Old French ← Middle English").
 * 2. The arrow follows the order: `→` means "became" once, with the oldest at the
 *    left. A `←` glyph in oldest-first order would claim the opposite.
 * 3. The chain can continue PAST the answer. The answer is the oldest hop with a
 *    home on a modern map, so `due` is recorded as `English ← Old French ← Latin ←
 *    Proto-Italic` and the question is about Latin — Proto-Italic is a
 *    reconstruction that cannot be pinned. The route therefore stops at the answer
 *    and names what lies beyond it, rather than leaving an older hop looking like
 *    the answer.
 */

export interface RouteLine {
  /**
   * Every stop in display order, oldest first, with the word itself last:
   * `["Latin", "Old French", "Middle English", "English"]`.
   */
  hops: string[];
  /** Stops older than the answer: no place on a modern map. Oldest first. */
  beyond: string[];
}

/** How a hop reads in the route: `A → B` means A became B. */
export const ROUTE_ARROW = " → ";

export function routeLine(originChain: readonly string[], answerLanguage: string): RouteLine {
  const at = originChain.indexOf(answerLanguage);
  // A chain that does not name its own answer (should not happen: the builder
  // anchors the answer to a hop in this chain) is shown whole rather than truncated.
  const toAnswer = at < 0 ? [...originChain] : originChain.slice(0, at + 1);
  const beyond = at < 0 ? [] : originChain.slice(at + 1);
  return {
    // Stored immediate-source-first; display reads left to right in time.
    hops: [...toAnswer].reverse().concat("English"),
    beyond: [...beyond].reverse(),
  };
}

/** The route as one line: `Latin → Old French → Middle English → English`. */
export function routeLabel(originChain: readonly string[], answerLanguage: string): string {
  return routeLine(originChain, answerLanguage).hops.join(ROUTE_ARROW);
}

/**
 * Explains hops recorded older than the answer, or null when there are none.
 * Phrased as "no anchor on a modern map" rather than assuming a reconstruction:
 * today every such hop is Proto-*, but the reason it is not asked about is that it
 * cannot be located.
 */
export function beyondNote(answerLanguage: string, beyond: readonly string[]): string | null {
  if (beyond.length === 0) return null;
  return (
    `Older still: ${beyond.join(ROUTE_ARROW)}. ` +
    `No anchor on a modern map, so the answer is ${answerLanguage}, the oldest stop that can be placed.`
  );
}

/**
 * How the answer's date reads. Many words have no precise date: the references say
 * "recorded in Old English" or "before 1150", which the bank stores as a span
 * (`year`..`yearTo`) rather than one invented year. The wording follows the data,
 * so the reveal never claims a precision the record does not have. When the span
 * covers a whole period exactly, name the period: that is what the record says.
 */
export function answerYearLabel(year: number, yearTo?: number, period?: string): string {
  if (yearTo === undefined || yearTo <= year) return `first used around ${year}`;
  if (period) return `recorded in the ${period} period (${year} – ${yearTo})`;
  return `first recorded between ${year} and ${yearTo}`;
}

/**
 * Why a coarse span is graded the way it is, or null for a precisely dated word.
 * Without this a player who guessed 700-800 on an undated word sees 100/100 and
 * cannot tell whether the window was right or the game was generous.
 */
export function coarseSpanNote(year: number, yearTo?: number, period?: string): string | null {
  if (yearTo === undefined || yearTo <= year) return null;
  const dated = period
    ? `The sources date it only by period`
    : `No source dates this more exactly than “in use by ${yearTo}”`;
  return `${dated}, so any window touching ${year} – ${yearTo} counts as a hit.`;
}

