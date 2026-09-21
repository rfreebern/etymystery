/**
 * Difficulty tiering heuristic — a deterministic starting point for the
 * curation pass, which is expected to override tiers by hand.
 *
 * Signal: deeper borrowing chains and rarer words are harder.
 */

export interface TierInput {
  /** Number of languages in the origin chain (immediate donor counts as 1). */
  chainDepth: number;
  /** Optional frequency rank (1 = most common word). */
  frequencyRank?: number;
}

export function assignTier({ chainDepth, frequencyRank }: TierInput): number {
  let tier = 2 + 2 * (Math.max(1, Math.min(4, chainDepth)) - 1); // depth 1..4+ -> 2, 4, 6, 8
  if (frequencyRank !== undefined) {
    if (frequencyRank <= 3_000) tier -= 2;
    else if (frequencyRank <= 20_000) tier -= 1;
    else if (frequencyRank >= 150_000) tier += 2;
  }
  return Math.min(10, Math.max(1, tier));
}
