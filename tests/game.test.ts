import { describe, expect, it } from "vitest";
import { buildWordBank } from "../src/bank";
import { dayNumberForDate } from "../src/daily";
import { createGeocodeContext, type CountryFeature } from "../web/src/geo-context";
import {
  currentRoundIndex,
  guessRange,
  isComplete,
  loadSession,
  storageKey,
  submitGuess,
  summarize,
  type StorageLike,
} from "../web/src/game";
import type { LanguageInfo } from "../src/types";

const LANGUAGES: Record<string, LanguageInfo> = {
  French: { name: "French", countries: ["FR"], representativePoint: { lat: 47, lng: 2 }, subregion: "Western Europe", continent: "Europe" },
};

function makeFeatures(): CountryFeature[] {
  return [
    {
      iso: "FR",
      name: "France",
      geometry: {
        type: "Polygon",
        coordinates: [[[ -1, 42 ], [ -1, 51 ], [ 8, 51 ], [ 8, 42 ], [ -1, 42 ]]],
      },
    },
  ];
}

function makeBank() {
  const entries = Array.from({ length: 30 }, (_, i) => ({
    id: `w${i}`,
    word: `w${i}`,
    year: 1800,
    tier: ((i % 10) + 1),
    originChain: ["French"],
    originLanguage: "French",
    countries: ["FR"],
    point: { lat: 47, lng: 2 },
    blurb: "From French.",
  }));
  return buildWordBank({ version: 7, epochStartDay: dayNumberForDate("2026-01-01"), entries, languages: LANGUAGES });
}

function makeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("guessRange", () => {
  it("reads the window from a current guess", () => {
    expect(guessRange({ yearStart: 1450, yearEnd: 1550, point: null })).toEqual({
      start: 1450,
      end: 1550,
    });
  });

  it("tolerates a session saved before the timeline became a window", () => {
    // A resumed day must keep the score it already earned: an old single-year
    // guess becomes a zero-width window, not a 100-year one.
    expect(guessRange({ year: 1400, point: null })).toEqual({ start: 1400, end: 1400 });
  });

  it("degrades safely on nonsense", () => {
    expect(guessRange({ yearStart: Number.NaN, yearEnd: 1000, point: null })).toEqual({
      start: 0,
      end: 0,
    });
    expect(guessRange({ yearStart: 1400, yearEnd: Number.NaN, point: null })).toEqual({
      start: 1400,
      end: 1400,
    });
  });
});

describe("game session", () => {
  const bank = makeBank();
  const ctx = createGeocodeContext({ features: makeFeatures(), languages: LANGUAGES });
  const utcMs = Date.parse("2026-01-01T12:00:00Z"); // day 0 of the bank epoch

  it("persists each guess and restores partial progress", () => {
    const storage = makeStorage();
    const session = loadSession(bank, utcMs, storage);
    expect(session.rounds).toHaveLength(10);
    expect(currentRoundIndex(session)).toBe(0);

    submitGuess(bank, session, 0, { yearStart: 1800, yearEnd: 1900, point: { lat: 47, lng: 2 } }, ctx, storage);
    // Reload from the SAME storage to prove persistence:
    const reloadedSame = loadSession(bank, utcMs, storage);
    expect(reloadedSame.rounds[0]).not.toBeNull();
    expect(currentRoundIndex(reloadedSame)).toBe(1);
  });

  it("rejects double-playing a round", () => {
    const storage = makeStorage();
    const session = loadSession(bank, utcMs, storage);
    submitGuess(bank, session, 0, { yearStart: 1800, yearEnd: 1900, point: null }, ctx, storage);
    expect(() => submitGuess(bank, session, 0, { yearStart: 1900, yearEnd: 2000, point: null }, ctx, storage)).toThrow(/already played/);
  });

  it("completes after 10 rounds and summarizes", () => {
    const storage = makeStorage();
    const session = loadSession(bank, utcMs, storage);
    for (let i = 0; i < 10; i++) {
      submitGuess(bank, session, i, { yearStart: 1800, yearEnd: 1900, point: { lat: 47, lng: 2 } }, ctx, storage);
    }
    expect(isComplete(session)).toBe(true);
    expect(currentRoundIndex(session)).toBeNull();
    const summary = summarize(session);
    expect(summary.played).toBe(10);
    expect(summary.temporal).toBe(100);
    expect(summary.geographic).toBe(100);
    expect(summary.total).toBe(100);
  });

  it("keys storage per bank version and day (no cross-day bleed)", () => {
    const nextDayMs = utcMs + 86_400_000;
    const a = loadSession(bank, utcMs, makeStorage());
    const b = loadSession(bank, nextDayMs, makeStorage());
    expect(storageKey(a.bankVersion, a.dayIndex)).not.toBe(storageKey(b.bankVersion, b.dayIndex));
    submitGuess(bank, a, 0, { yearStart: 1800, yearEnd: 1900, point: null }, ctx, makeStorage());
    expect(b.rounds[0]).toBeNull();
  });

  it("serves the same rounds for the same day regardless of time of day", () => {
    const morning = loadSession(bank, Date.parse("2026-01-01T00:00:01Z"), makeStorage());
    const evening = loadSession(bank, Date.parse("2026-01-01T23:00:00Z"), makeStorage());
    expect(morning.dayIndex).toBe(evening.dayIndex);
  });
});
