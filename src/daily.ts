import type { BankEntry, WordBank } from "./types";
import { ROUNDS_PER_DAY } from "./bank";

/**
 * Deterministic daily puzzle engine.
 *
 * The day → puzzle mapping is a pure function of (dayIndex, bank). Day 0 is
 * `bank.epochStartDay`; each subsequent UTC day consumes the next 10 entries
 * of the bank's master sequence. No server, no state, no repetition until a
 * tier queue is exhausted.
 */

export const MS_PER_DAY = 86_400_000;

/** Day number (UTC) for a timestamp, e.g. from Date.now() or Date.parse(). */
export function dayNumber(utcMs: number): number {
  return Math.floor(utcMs / MS_PER_DAY);
}

/** Day number for a calendar date string like "2026-09-21" (interpreted as UTC midnight). */
export function dayNumberForDate(isoDate: string): number {
  return dayNumber(Date.parse(`${isoDate}T00:00:00Z`));
}

/** The day index (0-based) the given timestamp falls on, relative to the bank epoch. */
export function dayIndexFor(bank: WordBank, utcMs: number): number {
  return dayNumber(utcMs) - bank.epochStartDay;
}

/** Total number of complete daily puzzles the bank can serve without reuse. */
export function totalPuzzles(bank: WordBank): number {
  return Math.floor(bank.masterSequence.length / ROUNDS_PER_DAY);
}

export class PuzzleRangeError extends Error {}

/**
 * Get the 10 rounds for the day identified by `dayIndex`.
 * Throws PuzzleRangeError for negative indexes (before epoch) or days beyond
 * the bank's capacity — such days require a new bank version.
 */
export function getDailyPuzzle(bank: WordBank, dayIndex: number): BankEntry[] {
  if (!Number.isInteger(dayIndex)) throw new PuzzleRangeError(`dayIndex must be an integer, got ${dayIndex}`);
  if (dayIndex < 0) {
    throw new PuzzleRangeError(`dayIndex ${dayIndex} is before the bank epoch (0 required)`);
  }
  const capacity = totalPuzzles(bank);
  if (dayIndex >= capacity) {
    throw new PuzzleRangeError(
      `dayIndex ${dayIndex} exceeds bank capacity (${capacity} puzzles in version ${bank.version}); ` +
        `append a new bank version`,
    );
  }
  const start = dayIndex * ROUNDS_PER_DAY;
  return bank.masterSequence.slice(start, start + ROUNDS_PER_DAY);
}

/** Convenience: puzzle for a raw UTC timestamp. */
export function getDailyPuzzleForTimestamp(bank: WordBank, utcMs: number): BankEntry[] {
  return getDailyPuzzle(bank, dayIndexFor(bank, utcMs));
}
