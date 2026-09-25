/**
 * Daily session state machine. Pure logic + injectable storage so the flow
 * (one round at a time, persisted after each guess, no score changes after
 * reveal) is unit-testable independent of the DOM.
 *
 * Everything the player has done today lives in storage: each scored round as it is
 * locked in, and the round in progress as a draft, so a reload resumes the day rather
 * than replaying it.
 */

import { ROUNDS_PER_DAY } from "../../src/bank";
import { dayIndexFor, getDailyPuzzle } from "../../src/daily";
import { scoreRound, type GeocodeContext } from "../../src/scoring";
import type { BankEntry, LatLng, RoundScore, WordBank } from "../../src/types";

export interface StoredGuess {
  /** First year of the guessed window. */
  yearStart: number;
  /** Last year of the guessed window, inclusive. */
  yearEnd: number;
  point: LatLng | null;
}

/**
 * A guess as it may exist in storage. Sessions saved before the timeline became a
 * 100-year window hold a single `year`; those must not break a resumed day.
 */
export type StoredGuessLike = StoredGuess | { year: number; point?: LatLng | null };

/**
 * Read a stored guess's year window, tolerating pre-window sessions. An old
 * single-year guess becomes a zero-width window, so a day in progress keeps the
 * score it already earned rather than being re-scored under the new rule.
 */
export function guessRange(guess: StoredGuessLike): { start: number; end: number } {
  const windowed = guess as Partial<StoredGuess>;
  if (Number.isFinite(windowed.yearStart)) {
    const start = windowed.yearStart as number;
    return { start, end: Number.isFinite(windowed.yearEnd) ? (windowed.yearEnd as number) : start };
  }
  const legacy = (guess as { year?: number }).year;
  return Number.isFinite(legacy) ? { start: legacy as number, end: legacy as number } : { start: 0, end: 0 };
}

export interface StoredRound {
  wordId: string;
  guess: StoredGuess;
  temporal: number;
  geographic: number;
  total: number;
  credit: RoundScore["credit"];
  matchedCountry: string | null;
  distanceKm: number | null;
  /** Years off the answer's span, and km off its territory; absent in older sessions. */
  yearsMissed?: number;
  kmMissed?: number | null;
}

export interface Session {
  bankVersion: number;
  dayIndex: number;
  rounds: (StoredRound | null)[];
  /**
   * The round in progress, if the player has placed a window or a pin but not locked it
   * in. See `saveDraft`: scored rounds are already durable, this is the part a reload
   * would otherwise throw away.
   */
  draft?: { round: number; guess: StoredGuess };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function storageKey(bankVersion: number, dayIndex: number): string {
  return `etymystery:v${bankVersion}:d${dayIndex}`;
}

/** Load today's session, or start a fresh one. Restores partial progress. */
export function loadSession(bank: WordBank, utcMs: number, storage: StorageLike): Session {
  const dayIndex = Math.max(0, dayIndexFor(bank, utcMs));
  const key = storageKey(bank.version, dayIndex);
  const raw = storage.getItem(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Session;
      if (parsed.bankVersion === bank.version && parsed.dayIndex === dayIndex) {
        if (parsed.rounds.length === ROUNDS_PER_DAY) {
          // A draft means something only for the round it was written in. A session saved
          // mid-round and resumed after that round was scored must not put the pin back
          // on the map: the score is the record, and the round is over.
          const round = parsed.rounds.findIndex((r) => r === null);
          if (round === -1 || parsed.draft?.round !== round) delete parsed.draft;
          return parsed;
        }
      }
    } catch {
      // corrupt storage: fall through to a fresh session
    }
  }
  return { bankVersion: bank.version, dayIndex, rounds: Array(ROUNDS_PER_DAY).fill(null) };
}

function persist(storage: StorageLike, session: Session): void {
  storage.setItem(storageKey(session.bankVersion, session.dayIndex), JSON.stringify(session));
}

/** Current round index (first unplayed), or null when the day is complete. */
export function currentRoundIndex(session: Session): number | null {
  const index = session.rounds.findIndex((r) => r === null);
  return index === -1 ? null : index;
}
/**
 * Save the round in progress: the window and pin placed but not yet locked in.
 *
 * Scored rounds are durable on their own (`rounds`), so this is only about what would
 * otherwise be lost to a reload - a pin someone had chosen and was about to submit. A
 * completed day has no round in progress, so the draft goes away rather than lingering.
 */
export function saveDraft(session: Session, guess: StoredGuess, storage: StorageLike): void {
  const round = currentRoundIndex(session);
  if (round === null) delete session.draft;
  else session.draft = { round, guess: { ...guess } };
  persist(storage, session);
}

/** The saved draft, if it belongs to the round now being played (else null). */
export function currentDraft(session: Session): StoredGuess | null {
  const round = currentRoundIndex(session);
  if (round === null || session.draft?.round !== round) return null;
  return session.draft.guess;
}


/**
 * Record a guess for the given round. The round's word comes from the bank's
 * deterministic daily sequence, so the same day always yields the same rounds.
 */
export function submitGuess(
  bank: WordBank,
  session: Session,
  roundIndex: number,
  guess: StoredGuess,
  ctx: GeocodeContext,
  storage: StorageLike,
): StoredRound {
  const entries = getDailyPuzzle(bank, session.dayIndex);
  if (roundIndex < 0 || roundIndex >= entries.length) {
    throw new RangeError(`roundIndex ${roundIndex} out of range`);
  }
  if (session.rounds[roundIndex]) {
    throw new Error(`round ${roundIndex} already played`);
  }
  const entry = entries[roundIndex]!;
  const score: RoundScore = scoreRound(entry, guess, ctx);
  const stored: StoredRound = {
    wordId: entry.id,
    guess: { ...guess },
    temporal: score.temporal,
    geographic: score.geographic,
    total: score.total,
    credit: score.credit,
    matchedCountry: score.matchedCountry,
    distanceKm: score.distanceKm,
    yearsMissed: score.yearsMissed,
    kmMissed: score.kmMissed,
  };
  session.rounds[roundIndex] = stored;
  delete session.draft;
  persist(storage, session);
  return stored;
}

export function isComplete(session: Session): boolean {
  return session.rounds.every((r) => r !== null);
}

export interface SessionSummary {
  temporal: number;
  geographic: number;
  total: number;
  played: number;
}

/** One played round, with the entry it was about and the guess that scored it. */
export interface RoundSummary {
  index: number;
  entry: BankEntry;
  guess: { start: number; end: number; point: LatLng | null };
  score: StoredRound;
}

/**
 * Every round played today, in order, with its entry. The summary screen needs the
 * words and their answers as well as the scores, and the session only stores ids.
 */
export function dayRounds(bank: WordBank, session: Session): RoundSummary[] {
  const entries = getDailyPuzzle(bank, session.dayIndex);
  const rows: RoundSummary[] = [];
  session.rounds.forEach((score, index) => {
    const entry = entries[index];
    if (!score || !entry) return;
    const { start, end } = guessRange(score.guess);
    rows.push({ index, entry, guess: { start, end, point: score.guess.point ?? null }, score });
  });
  return rows;
}

export function summarize(session: Session): SessionSummary {
  const played = session.rounds.filter((r) => r !== null) as StoredRound[];
  if (played.length === 0) return { temporal: 0, geographic: 0, total: 0, played: 0 };
  const mean = (pick: (r: StoredRound) => number): number =>
    Math.round(played.reduce((sum, r) => sum + pick(r), 0) / played.length);
  return {
    temporal: mean((r) => r.temporal),
    geographic: mean((r) => r.geographic),
    total: mean((r) => r.total),
    played: played.length,
  };
}
