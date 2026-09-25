/**
 * Which senses the bank refuses, by the register label Wiktionary puts on them.
 *
 * A daily puzzle has to be a word the player can plausibly know, or at least recognise
 * once the answer is in front of them. Wiktionary marks the senses that fail that test
 * itself: `musard` (which reached a player) is `{{tlb|en|literary}}`, `tristful` is
 * `obsolete`, and a word in ordinary current use carries no label at all. Reading those
 * labels means the judgement is the dictionary's, not a hand-written list of words that
 * has to be guessed at twice a week.
 *
 * The labels come from the sense cache (`data/word-senses.json`, written by
 * `scripts/fetch-senses.ts`); without that file nothing can be judged, so the build says
 * so rather than pretending it checked.
 */

/**
 * Register labels that mean "not ordinary current English".
 *
 * `literary` is in the list on purpose, and not only `obsolete`: it is the label on
 * `musard`, and a word only found in literary writing is exactly what a player means by
 * "a word nobody has ever encountered". Deliberately absent: `dated` (recognisable, just
 * old-fashioned), `informal`/`colloquial`, `historical`, `regional`/`dialectal` (these are
 * the borrowed regional words the bank wants) and `rare` (see `--mode check`, which
 * reports how much of the pool a stricter line would cost).
 */
export const UNUSABLE_SENSE_LABELS = ["obsolete", "archaic", "literary"] as const;

/** True when any label on a sense rules that sense out. */
export function hasUnusableLabel(labels: readonly string[]): boolean {
  const unusable: readonly string[] = UNUSABLE_SENSE_LABELS;
  return labels.some((label) => unusable.includes(label.toLowerCase()));
}

/** The part of a sense record this rule needs: its part of speech and its definition lines. */
export interface SenseLabels {
  pos: string;
  /** Register labels per definition line, as `scripts/lib/wikitext.ts` reads them. */
  definitionLabels?: readonly (readonly string[])[];
}

/**
 * The sense keys (`word:pos`, the same shape as a curation key) the bank must not ship,
 * and the bare word when it has no current sense in any part of speech.
 *
 * Two signals have to agree, because neither is reliable alone:
 *
 * - Wiktionary's label says the sense is not ordinary current English. It is the only
 *   signal that knows `musard` (literary) from `okra` (plain), but it also calls
 *   `disparage` obsolete twice over, which is simply wrong about a word in daily use.
 * - The word is absent from the frequency list. That is the only signal that knows
 *   `disparage` is current, but on its own it would refuse every unranked word, which is
 *   most of the borrowed vocabulary the bank is for (`okra`, `tsetse`, `samovar`).
 *
 * So a word is refused only when the label is there AND the rank is not: labelled and
 * unranked is `musard`; labelled and ranked is `disparage`; unlabelled and unranked is
 * `okra`. `isKnown` answers the second question, and defaults to "nothing is known", which
 * makes a caller with no frequency list stricter rather than looser.
 *
 * A word is refused for a part of speech only when EVERY definition line of it carries a
 * label: a word can be both obsolete and current (`disparage`), and the curated key names a
 * part of speech rather than a line.
 */
export function unusableSenseKeys(
  senses: Record<string, { senses: SenseLabels[] }>,
  isKnown: (word: string) => boolean = () => false,
): Set<string> {
  const unusable = new Set<string>();
  for (const [word, record] of Object.entries(senses)) {
    if (isKnown(word)) continue;
    // Every definition line of a part of speech, across its etymology sections: the
    // question is whether that part of speech still has a sense in current use.
    const byPos = new Map<string, string[][]>();
    const everyLine: string[][] = [];
    for (const sense of record.senses ?? []) {
      if (!sense.pos) continue;
      const lines = (sense.definitionLabels ?? []).map((labels) => [...labels]);
      byPos.set(sense.pos, [...(byPos.get(sense.pos) ?? []), ...lines]);
      everyLine.push(...lines);
    }
    for (const [pos, lines] of byPos) {
      if (lines.length > 0 && lines.every((labels) => hasUnusableLabel(labels))) {
        unusable.add(`${word}:${pos}`);
      }
    }
    // Also the bare word, for a key with no part of speech in it (`musard`, not
    // `musard:noun`): the same question asked of every part of speech at once.
    if (everyLine.length > 0 && everyLine.every((labels) => hasUnusableLabel(labels))) {
      unusable.add(word);
    }
  }
  return unusable;
}
