/**
 * Reveal text for the origin route.
 *
 * Two facts about `originChain` shape this, and both have been misread on screen:
 *
 * 1. It is ordered from the word's IMMEDIATE source outwards, so the route reads
 *    `English ← Middle English ← Old French ← Latin` — deepest at the END, which is
 *    also where the arrow points. An earlier version reversed it and printed
 *    `English ← Latin ← Old French ← Middle English`, i.e. claimed English came from
 *    Latin via Middle English. Reporting the chain backwards is worse than saying
 *    nothing: it is confidently wrong.
 * 2. The chain can continue PAST the answer. The answer is the deepest hop with a
 *    home on a modern map, so `due` is recorded as
 *    `English ← Old French ← Latin ← Proto-Italic` and the question is about Latin —
 *    Proto-Italic is a reconstruction that cannot be pinned. The route therefore
 *    stops at the answer and names what lies beyond it, instead of leaving a deeper
 *    hop looking like the answer.
 */

export interface RouteParts {
  /** Hops from English outward, ending at the answer hop. */
  hops: string[];
  /** Hops recorded deeper than the answer: no place on a modern map. */
  beyond: string[];
}

export function routeParts(originChain: readonly string[], answerLanguage: string): RouteParts {
  const at = originChain.indexOf(answerLanguage);
  // A chain that does not name its own answer (should not happen: the builder
  // anchors the answer to a hop in this chain) is shown whole rather than truncated.
  if (at < 0) return { hops: [...originChain], beyond: [] };
  return { hops: originChain.slice(0, at + 1), beyond: originChain.slice(at + 1) };
}

/** The route as one line: `English ← Middle English ← Old French ← Latin`. */
export function routeLabel(originChain: readonly string[], answerLanguage: string): string {
  return ["English", ...routeParts(originChain, answerLanguage).hops].join(" ← ");
}

/**
 * Explains a chain recorded deeper than the answer, or null when there is nothing
 * beyond it. Phrased as "no anchor on a modern map" rather than assuming a
 * reconstruction: today every such hop is Proto-*, but the reason it is not asked
 * about is that it cannot be located.
 */
export function beyondNote(answerLanguage: string, beyond: readonly string[]): string | null {
  if (beyond.length === 0) return null;
  return (
    `Recorded deeper: ${beyond.join(" ← ")} — no anchor on a modern map, ` +
    `so the answer is ${answerLanguage}, the deepest place this word can be pinned.`
  );
}
