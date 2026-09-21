/**
 * Daily session state machine. Pure logic + injectable storage so the flow
 * (one round at a time, persisted after each guess, no score changes after
 * reveal) is unit-testable independent of the DOM.
 */

import { ROUNDS_PER_DAY } from "../../src/bank";
import { dayIndexFor, getDailyPuzzle } from "../../src/daily";
import { scoreRound, type GeocodeContext } from "../../src/scoring";
import type { LatLng, RoundScore, WordBank } from "../../src/types";

export interface StoredGuess {
  year: number;
  point: LatLng | null;
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
}

export interface Session {
  bankVersion: number;
  dayIndex: number;
  rounds: (StoredRound | null)[];
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
        if (parsed.rounds.length === ROUNDS_PER_DAY) return parsed;
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
  const score: RoundScore = scoreRound(entry, { year: guess.year, point: guess.point }, ctx);
  const stored: StoredRound = {
    wordId: entry.id,
    guess: { ...guess },
    temporal: score.temporal,
    geographic: score.geographic,
    total: score.total,
    credit: score.credit,
    matchedCountry: score.matchedCountry,
    distanceKm: score.distanceKm,
  };
  session.rounds[roundIndex] = stored;
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
