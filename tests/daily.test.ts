import { describe, expect, it } from "vitest";
import { PuzzleRangeError, dayIndexFor, dayNumberForDate, getDailyPuzzle, getDailyPuzzleForTimestamp, totalPuzzles } from "../src/daily";
import { ROUNDS_PER_DAY, buildWordBank } from "../src/bank";
import { makeEntry } from "./helpers";

const EPOCH = dayNumberForDate("2026-01-01");
const LANGUAGES = {
  French: { name: "French", countries: ["FR"], representativePoint: { lat: 47, lng: 2 } },
};

function makeTestBank() {
  return buildWordBank({
    version: 1,
    epochStartDay: EPOCH,
    entries: Array.from({ length: 30 }, () => makeEntry()), // 6 per tier
    languages: LANGUAGES,
  });
}

describe("day math", () => {
  it("computes UTC day indexes from the epoch", () => {
    expect(dayNumberForDate("2026-01-01")).toBe(dayNumberForDate("2026-01-01"));
    const bank = makeTestBank();
    // 2026-09-21 is 263 days after 2026-01-01 (non-leap year).
    expect(dayIndexFor(bank, Date.parse("2026-09-21T12:00:00Z"))).toBe(263);
  });

  it("maps any time within a UTC day to the same day index", () => {
    const bank = makeTestBank();
    const early = Date.parse("2026-01-01T00:00:00Z");
    const late = Date.parse("2026-01-01T23:59:59Z");
    expect(dayIndexFor(bank, early)).toBe(0);
    expect(dayIndexFor(bank, late)).toBe(0);
  });

  it("is timezone-safe: local-offset timestamps resolve to UTC days", () => {
    const bank = makeTestBank();
    // 2026-01-02T00:30:00+02:00 == 2026-01-01T22:30Z -> day 0.
    expect(dayIndexFor(bank, Date.parse("2026-01-02T00:30:00+02:00"))).toBe(0);
  });
});

describe("getDailyPuzzle", () => {
  it("returns one round per tier, in ascending difficulty", () => {
    const bank = makeTestBank();
    const rounds = getDailyPuzzle(bank, 0);
    expect(rounds).toHaveLength(ROUNDS_PER_DAY);
    rounds.forEach((entry, i) => expect(entry.tier).toBe(i + 1));
  });

  it("is deterministic: same day, same puzzle", () => {
    const bank = makeTestBank();
    const a = getDailyPuzzle(bank, 1).map((e) => e.id);
    const b = getDailyPuzzle(bank, 1).map((e) => e.id);
    expect(a).toEqual(b);
  });

  it("never repeats words within the bank's capacity", () => {
    const bank = makeTestBank();
    const capacity = totalPuzzles(bank);
    expect(capacity).toBe(6); // 30 entries, 6 per tier
    const seen = new Set<string>();
    for (let day = 0; day < capacity; day++) {
      for (const entry of getDailyPuzzle(bank, day)) {
        expect(seen.has(entry.id)).toBe(false);
        seen.add(entry.id);
      }
    }
    expect(seen.size).toBe(30);
  });

  it("serves the same puzzle for the same UTC calendar day", () => {
    const bank = makeTestBank();
    const a = getDailyPuzzleForTimestamp(bank, Date.parse("2026-01-02T00:00:01Z")).map((e) => e.id);
    const b = getDailyPuzzleForTimestamp(bank, Date.parse("2026-01-02T23:00:00Z")).map((e) => e.id);
    expect(a).toEqual(b);
  });

  it("throws before the epoch and beyond capacity", () => {
    const bank = makeTestBank();
    expect(() => getDailyPuzzle(bank, -1)).toThrow(PuzzleRangeError);
    expect(() => getDailyPuzzle(bank, totalPuzzles(bank))).toThrow(/capacity/);
  });

  it("serves different puzzles on consecutive days", () => {
    const bank = makeTestBank();
    const day0 = new Set(getDailyPuzzle(bank, 0).map((e) => e.id));
    const day1 = getDailyPuzzle(bank, 1).map((e) => e.id);
    expect(day1.every((id) => !day0.has(id))).toBe(true);
  });
});
