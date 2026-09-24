/**
 * The copy-pasteable result: one coloured square per round, in the order played.
 *
 * Deliberately DOM-free and dependency-free so the thresholds and the exact text can be
 * tested, which matters more than usual here: this is the only thing a player takes away
 * from the day, and a wrong colour is a lie about their own score.
 *
 * The thresholds are the ones asked for: blue 90-100, green 60-90, yellow 30-60, red
 * 0-30. A score exactly on a boundary takes the HIGHER colour (90 is blue, 60 is green,
 * 30 is yellow), because a boundary belongs to the band it opens, and a player looking at
 * "60" reads it as two thirds of the way up rather than a third.
 */

export const SCORE_EMOJI = {
  blue: "🟦",
  green: "🟩",
  yellow: "🟨",
  red: "🟥",
} as const;

/** The square for one round's score. */
export function scoreEmoji(total: number): string {
  if (total >= 90) return SCORE_EMOJI.blue;
  if (total >= 60) return SCORE_EMOJI.green;
  if (total >= 30) return SCORE_EMOJI.yellow;
  return SCORE_EMOJI.red;
}

/** The colour name, for the legend and for screen readers. */
export function scoreBand(total: number): keyof typeof SCORE_EMOJI {
  if (total >= 90) return "blue";
  if (total >= 60) return "green";
  if (total >= 30) return "yellow";
  return "red";
}

export interface ShareInput {
  /** The date the puzzle is for, as the app labels it (`2026-09-24`). */
  date: string;
  /** Round totals in play order: one square each. */
  totals: readonly number[];
  /** Mean score for the day, as the summary shows it. */
  average: number;
  /** Rounds played, so a part-finished day says so. */
  played: number;
  rounds: number;
  url: string;
}

/**
 * The whole share, as plain text: no em dashes (the project's copy rule), no markup, and
 * nothing that needs explaining, because a shared result is usually read out of context.
 */
export function shareText(input: ShareInput): string {
  const squares = input.totals.map(scoreEmoji).join("");
  const progress =
    input.played >= input.rounds ? `Average ${input.average}/100` : `${input.played}/${input.rounds} rounds, average ${input.average}/100`;
  return [
    `Etymystery ${input.date}`,
    squares,
    progress,
    input.url,
  ].join("\n");
}
