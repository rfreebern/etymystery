import { describe, expect, it } from "vitest";
import {
  ANSWER_YEAR_MAX,
  ANSWER_YEAR_MIN,
  ERAS,
  bestPossibleTemporal,
  earliestEnglishEra,
  eraOf,
  erasSpanned,
  isPlayableYear,
  periodOfSpan,
  sliderStartBounds,
} from "../src/timeline";
import { scoreTemporalRange } from "../src/scoring";

describe("answer window", () => {
  it("spans the English written record to the present", () => {
    expect(ANSWER_YEAR_MIN).toBe(700); // Cædmon's Hymn, the start of the record
    expect(ANSWER_YEAR_MAX).toBe(2025);
    expect(ANSWER_YEAR_MIN).toBeLessThan(ANSWER_YEAR_MAX);
  });

  it("covers every word in the shipped bank, including the medieval ones", () => {
    // these three were unwinnable while the floor was 1500
    for (const year of [1200, 1225, 1300]) {
      expect(isPlayableYear(year)).toBe(true);
      expect(bestPossibleTemporal(year)).toBe(100);
    }
  });

  it("describes the periods without gaps or overlaps", () => {
    expect(ERAS[0]!.from).toBe(ANSWER_YEAR_MIN);
    expect(ERAS[ERAS.length - 1]!.to).toBe(ANSWER_YEAR_MAX);
    for (let i = 1; i < ERAS.length; i++) {
      expect(ERAS[i]!.from).toBe(ERAS[i - 1]!.to + 1);
    }
    expect(eraOf(900).label).toBe("Old English");
    expect(eraOf(1200).label).toBe("Middle English");
    expect(eraOf(1590).label).toBe("Early Modern");
    expect(eraOf(1975).label).toBe("Modern");
  });

  it("never drifts from the real scorer", () => {
    // Best possible = the legal window that sits closest to the answer, scored by
    // the real scorer. Inside the window that is a centred window = 100.
    const { min, max, span } = sliderStartBounds();
    for (const year of [700, 900, 1200, 1650, 2025]) {
      const start = Math.min(Math.max(year - span / 2, min), max);
      expect(bestPossibleTemporal(year)).toBe(scoreTemporalRange(year, start, start + span));
      expect(bestPossibleTemporal(year)).toBe(100);
    }
    // Below the floor the best window is the earliest one, and it is not enough.
    expect(bestPossibleTemporal(400)).toBe(scoreTemporalRange(400, min, min + span));
    expect(bestPossibleTemporal(400)).toBeLessThan(100);
    expect(bestPossibleTemporal(400)).toBe(5);
  });

  it("bounds the slider to windows that stay inside the answer window", () => {
    const { min, max, step, span } = sliderStartBounds();
    expect({ min, max, step, span }).toEqual({ min: 700, max: 1925, step: 25, span: 100 });
    // Every position on the slider yields a window inside the window we can score:
    expect(max + span).toBe(ANSWER_YEAR_MAX);
    for (let start = min; start <= max; start += step) {
      for (const year of [start, start + 50, start + span]) {
        expect(isPlayableYear(year)).toBe(true);
      }
    }
  });

  it("names every period a window touches", () => {
    // A 100-year window straddles a boundary a third of the time, so naming one
    // period would be wrong: 1450-1550 is both.
    expect(erasSpanned(1450, 1550).map((era) => era.label)).toEqual(["Middle English", "Early Modern"]);
    expect(erasSpanned(800, 900).map((era) => era.label)).toEqual(["Old English"]);
    expect(erasSpanned(1700, 1800).map((era) => era.label)).toEqual(["Early Modern", "Modern"]);
  });

  it("flags years the slider cannot express", () => {
    expect(isPlayableYear(699)).toBe(false);
    expect(isPlayableYear(2026)).toBe(false);
    expect(isPlayableYear(Number.NaN)).toBe(false);
  });
});

describe("the period a chain implies", () => {
  it("finds the oldest English stage named in a chain", () => {
    expect(earliestEnglishEra(["Middle English", "Old French"])?.label).toBe("Middle English");
    // A chain that reaches back to Old English is older than one stopping at ME.
    expect(earliestEnglishEra(["Middle English", "Old English", "Old Norse"])?.label).toBe("Old English");
    expect(earliestEnglishEra(["Old English (Anglian)"])?.label).toBe("Old English");
    // A borrowing described only from outside English claims no English period:
    // `just <- Latin` says nothing about when English took it up.
    expect(earliestEnglishEra(["Latin", "Proto-Italic"])).toBeNull();
    expect(earliestEnglishEra([])).toBeNull();
  });

  it("names the period a span covers exactly, and only then", () => {
    // A span taken from the record is set to its period's bounds, which is how the
    // reveal can say "recorded in Old English" instead of printing the numbers.
    expect(periodOfSpan({ from: 700, to: 1150 })?.label).toBe("Old English");
    expect(periodOfSpan({ from: 1151, to: 1500 })?.label).toBe("Middle English");
    expect(periodOfSpan({ from: 700, to: 1100 })).toBeNull();
    expect(periodOfSpan({ from: 1590, to: 1590 })).toBeNull();
  });
});

describe("bestPossibleTemporal with a coarse span", () => {
  it("finds the best legal window for a span, not just a point", () => {
    const span = { from: 700, to: 1150 };
    // Some legal window always overlaps the span, so an undated inherited word is
    // always winnable — this is the promise that keeps them curatable.
    expect(bestPossibleTemporal(span)).toBe(100);
    expect(bestPossibleTemporal({ from: 1400, to: 1450 })).toBe(100);
    // Below the floor, the span's own start is what the earliest window misses.
    expect(bestPossibleTemporal({ from: 600, to: 650 }, 1500, 2025)).toBe(
      scoreTemporalRange(650, 1500, 1600),
    );
  });

  it("agrees with the single-year form when the span is zero-width", () => {
    for (const year of [700, 1200, 1590, 2025, 2050]) {
      expect(bestPossibleTemporal({ from: year, to: year })).toBe(bestPossibleTemporal(year));
    }
  });
});
