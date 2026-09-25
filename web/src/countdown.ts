/**
 * When the next puzzle arrives.
 *
 * The daily sequence is keyed on UTC days (`dayIndexFor` splits on `MS_PER_DAY`), so the
 * page counts down to midnight UTC and no further: the instant the sequence advances is
 * the instant this reaches zero. Deliberately DOM-free and free of `Date.now()` so the
 * arithmetic and the exact wording can be tested without a clock.
 */

import { MS_PER_DAY } from "../../src/daily";

const SECONDS_PER_DAY = 86_400;

/** The top bar's second line, before the numbers. */
export const COUNTDOWN_PREFIX = "Check back for a new puzzle in ";

/**
 * What that line says once the day has turned while the page was open. It only reaches
 * the screen when a round is in progress (see `tickCountdown` in main.ts): a finished day
 * reloads into the new one instead of asking the player to.
 */
export const TURNOVER_LABEL = "A new puzzle is ready. Reload to play it.";

/**
 * Whole seconds left in the current UTC day.
 *
 * Range is 1..86_400, and it is 86_400 only during the midnight second itself, once the
 * day has already turned: that instant prints as `00:00:00`, because the end of the
 * countdown is the new day starting rather than the old one running out. Negative
 * timestamps (a clock before 1970, or a badly set one) still land inside the range.
 */
export function secondsLeftInUtcDay(nowMs: number): number {
  const msIntoDay = ((nowMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  return SECONDS_PER_DAY - Math.floor(msIntoDay / 1000);
}

/** `17:24:56`, zero-padded so the line does not shift about as the numbers change. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = totalSeconds % SECONDS_PER_DAY;
  const parts = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

/** The top bar's second line: `Check back for a new puzzle in 17:24:56`. */
export function countdownLabel(nowMs: number): string {
  return `${COUNTDOWN_PREFIX}${formatCountdown(secondsLeftInUtcDay(nowMs))}`;
}
