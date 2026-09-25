/** Core shared types for Etymystery. */

/** ISO 3166-1 alpha-2 country code, e.g. "RU", "NO". */
export type CountryCode = string;

/** A geographic point in degrees. */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * A curated language entry: a Wiktionary/etymology-db language or dialect name
 * mapped to the modern-day location(s) of its speech community.
 */
export interface LanguageInfo {
  /** Canonical name as used in etymology-db / Wiktionary, e.g. "Old Norse". */
  name: string;
  /** Modern countries associated with this language's speech community. */
  countries: CountryCode[];
  /** Primary representative point (city centroid, etc.). Optional. */
  representativePoint?: LatLng;
  /** UN M49 subregion name used for partial credit, e.g. "Northern Europe". */
  subregion?: string;
  /** Continent name used for partial credit, e.g. "Europe". */
  continent?: string;
}

/** One vetted puzzle word. */
export interface BankEntry {
  /** Stable unique ID (slug of the word). Never reused across epochs. */
  id: string;
  /** The puzzle word itself, e.g. "elapse". */
  word: string;
  /**
   * Part of speech the puzzle is about, when the word is a homograph whose senses
   * differ (`back` the native word is Old English; the borrowed sense came via
   * French). Set by curation; absent for unambiguous words.
   */
  pos?: string;
  /** Year the word entered English (negative = BCE). Fact data, curated by hand. */
  year: number;
  /**
   * Latest year of the answer's span, when the record only bounds the first use
   * ("recorded in Old English" is "before 1150"). Absent for a precisely dated
   * entry, where `year` is the whole answer. A guessed window overlapping
   * `year`..`yearTo` scores full marks.
   */
  yearTo?: number;
  /** Difficulty tier 1 (easiest) upward; the bank deals one round per tier. */
  tier: number;
  /** Ordered origin chain from the word's immediate source outwards, e.g. ["French", "Latin"]. */
  originChain: string[];
  /** The language the player is asked to locate: the deepest origin (last chain entry). */
  originLanguage: string;
  /** Answer countries for the deep origin; intermediate hops score partial credit. */
  countries: CountryCode[];
  /** Point of the deep origin, revealed on the map. */
  point: LatLng;
  /** Short reveal-time blurb, original prose. */
  blurb: string;
  /**
   * What this entry should have said, when curation changed after it had already shipped.
   *
   * A shipped day is frozen - a player scored it, so a corrected year must not move under
   * them (`appendToBank`'s append-only guarantee). But the correction is worth keeping, so
   * it rides along here: the entry keeps the values that were played, and `superseded`
   * records the ones a fresh build from curation would use instead. A rebuild reads
   * curation directly and is right on its own; this is what makes the OLD bank file honest
   * about what is known now.
   */
  superseded?: Superseded;
}

/**
 * The fields of an entry a later curation can disagree with.
 *
 * `id` and `word` are deliberately absent: an entry that changed identity is a different
 * puzzle, and the bank would rather keep the one it shipped than swap a word under a day
 * someone has played.
 */
export type CorrectableField =
  | "pos"
  | "year"
  | "yearTo"
  | "tier"
  | "originChain"
  | "originLanguage"
  | "countries"
  | "point"
  | "blurb";

/** The corrected values a `Superseded` annotation can carry, field by field. */
export interface CorrectedFields {
  pos?: string;
  year?: number;
  /**
   * `null` means the field should be ABSENT in a fresh build: a span a later check narrowed
   * to a single year. `undefined` would mean "unchanged", which is not what this records.
   */
  yearTo?: number | null;
  tier?: number;
  originChain?: string[];
  originLanguage?: string;
  countries?: CountryCode[];
  point?: LatLng;
  blurb?: string;
}

/** A correction to an entry that had already shipped; see `BankEntry.superseded`. */
export interface Superseded {
  /** The bank version that recorded the correction (annotations do not bump the version). */
  version: number;
  /** The corrected values, for the fields that differ. */
  corrected: CorrectedFields;
}

/**
 * Static, versioned word bank. Tiers contain pre-shuffled, append-only queues;
 * `masterSequence` is the round-robin interleave consumed one round per tier each day.
 */
export interface WordBank {
  /** Monotonic bank version; increments on every rebuild that appends words. */
  version: number;
  /** Day (UTC ms / 86_400_000) the deterministic sequence starts on. */
  epochStartDay: number;
  /** Seeded shuffle seed for this bank version. */
  seed: number;
  /** Per-tier shuffled queues, index 0 = tier 1, and so on. */
  tiers: BankEntry[][];
  /** Round-robin interleave of the tier queues; one entry per tier per day. */
  masterSequence: BankEntry[];
  /** Language metadata referenced by bank entries. */
  languages: Record<string, LanguageInfo>;
}

/** A player's guess for one round. */
export interface RoundGuess {
  /** First year of the guessed window (the timeline slider's value). */
  yearStart: number;
  /** Last year of the guessed window, inclusive; inside it is a perfect score. */
  yearEnd: number;
  /** Guessed point on the map (null if the player skipped pinning). */
  point?: LatLng | null;
}

/** Per-round score breakdown. */
export interface RoundScore {
  /** 0..100 temporal component. */
  temporal: number;
  /** 0..100 geographic component. */
  geographic: number;
  /** Simple 0..100 total (mean of the two axes). */
  total: number;
  /** Geographic detail: best matched answer country, if any. */
  matchedCountry: CountryCode | null;
  /** Geographic detail: distance in km used for the proximity component. */
  distanceKm: number | null;
  /** Best match level found (label for the reveal; region levels never add points). */
  credit: "country" | "intermediate" | "subregion" | "continent" | "proximity" | "none";
  /** Years the window fell outside the answer's span; 0 when it overlapped. */
  yearsMissed: number;
  /** Kilometers from the pin to the answer's territory (0 inside it); null with no pin. */
  kmMissed: number | null;
}
