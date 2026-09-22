import { describe, expect, it } from "vitest";
import {
  ANSWER_YEAR_MAX,
  ANSWER_YEAR_MIN,
  ERAS,
  bestPossibleTemporal,
  eraOf,
  isPlayableYear,
} from "../src/timeline";
import { scoreTemporal } from "../src/scoring";

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
    // best possible = guess clamped into the window, scored by the real scorer
    for (const year of [700, 900, 1200, 1650, 2025]) {
      expect(bestPossibleTemporal(year)).toBe(scoreTemporal(year, year));
      expect(bestPossibleTemporal(year)).toBe(100);
    }
    expect(bestPossibleTemporal(400)).toBe(scoreTemporal(400, ANSWER_YEAR_MIN));
    expect(bestPossibleTemporal(400)).toBeLessThan(100);
    expect(bestPossibleTemporal(2400)).toBe(scoreTemporal(2400, ANSWER_YEAR_MAX));
  });

  it("flags years the slider cannot express", () => {
    expect(isPlayableYear(699)).toBe(false);
    expect(isPlayableYear(2026)).toBe(false);
    expect(isPlayableYear(Number.NaN)).toBe(false);
  });
});
