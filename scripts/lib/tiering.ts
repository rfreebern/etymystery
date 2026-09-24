/**
 * Difficulty tiering heuristic — a deterministic starting point for the
 * curation pass, which is expected to override tiers by hand.
 *
 * Signal: deeper borrowing chains and rarer words are harder.
 */

import { TIER_COUNT } from "../../src/bank";

export interface TierInput {
  /** Number of languages in the origin chain (immediate donor counts as 1). */
  chainDepth: number;
  /** Optional frequency rank (1 = most common word). */
  frequencyRank?: number;
}

export function assignTier({ chainDepth, frequencyRank }: TierInput): number {
  // The signal is built on a ten-point scale (it predates the bank's tier count), then
  // squeezed onto the tiers that exist: a tier outside 1..TIER_COUNT is rejected by
  // `validateEntry`, so this has to track the bank rather than assume ten.
  let raw = 2 + 2 * (Math.max(1, Math.min(4, chainDepth)) - 1); // depth 1..4+ -> 2, 4, 6, 8
  if (frequencyRank !== undefined) {
    if (frequencyRank <= 3_000) raw -= 2;
    else if (frequencyRank <= 20_000) raw -= 1;
    else if (frequencyRank >= 150_000) raw += 2;
  }
  const scaled = Math.ceil((Math.min(10, Math.max(1, raw)) * TIER_COUNT) / 10);
  return Math.min(TIER_COUNT, Math.max(1, scaled));
}
