/**
 * Timeline slider geometry. The alignment invariant is the point of these tests:
 * the tablet's leading edge must land exactly where the era scale says that year
 * is, which is what stopped the label changing "at unexpected times".
 */

import { describe, expect, it } from "vitest";
import { ANSWER_YEAR_MAX, ANSWER_YEAR_MIN, sliderStartBounds } from "../src/timeline";
import {
  GUESS_SPAN_YEARS,
  eraSegments,
  outsideYears,
  rangeEraLabel,
  rangeLabel,
  tabletWidthPx,
  windowYears,
  yearFraction,
  yearPositionPct,
} from "../web/src/slider";

const TRACK = 800;

describe("timeline slider geometry", () => {
  it("sizes the tablet to the years it spans, on a full-window scale", () => {
    const years = windowYears(ANSWER_YEAR_MIN, ANSWER_YEAR_MAX); // 1325
    const tablet = tabletWidthPx(TRACK, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX);
    expect(tablet).toBeCloseTo((TRACK * GUESS_SPAN_YEARS) / years, 6);
    // 100 of 1325 years of an 800px track ≈ 60px.
    expect(Math.round(tablet)).toBe(60);
  });

  it("REQUIREMENT: the tablet tracks the era scale exactly", () => {
    // Native range inputs place the thumb's leading edge at
    //   (value - min) / (max - min) * (track - thumb)      <- travel-width slider
    // while the era scale is a full-window scale over the whole track:
    //   (year - floor) / windowYears * track
    // Those two denominators differ, which is exactly why full-width labels under a
    // travel-width slider drifted. With `thumb = track * span / windowYears` the
    // travel shrinks by the same ratio and the two agree for every value.
    const { min, max } = sliderStartBounds();
    const tablet = tabletWidthPx(TRACK, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX);
    const travel = TRACK - tablet;
    for (let year = min; year <= max; year += 25) {
      const thumbLeft = ((year - min) / (max - min)) * travel;
      const onScale = yearFraction(year, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX) * TRACK;
      expect(thumbLeft).toBeCloseTo(onScale, 6);
    }
    // And it is not a measurement that happens to pass: a differently-sized tablet
    // breaks the identity.
    const wrong = tabletWidthPx(TRACK, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX) * 2;
    const wrongLeft = ((1300 - min) / (max - min)) * (TRACK - wrong);
    const wanted = yearFraction(1300, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX) * TRACK;
    expect(Math.abs(wrongLeft - wanted)).toBeGreaterThan(20);
  });

  it("keeps every slider position's window inside the answer window", () => {
    const { min, max, step, span } = sliderStartBounds();
    expect(min).toBe(ANSWER_YEAR_MIN);
    expect(max + span).toBe(ANSWER_YEAR_MAX);
    expect((max - min) % step).toBe(0); // whole steps from end to end
  });

  it("lays the eras out over the track with no gaps and no overlap", () => {
    const segments = eraSegments(ANSWER_YEAR_MIN, ANSWER_YEAR_MAX);
    expect(segments.map((s) => s.label)).toEqual([
      "Old English",
      "Middle English",
      "Early Modern",
      "Modern",
    ]);
    expect(segments[0]!.leftPct).toBe(0);
    const last = segments[segments.length - 1]!;
    expect(last.leftPct + last.widthPct).toBeCloseTo(100, 6);
    for (let i = 1; i < segments.length; i++) {
      // Each era starts where the previous one ends, to the pixel.
      expect(segments[i]!.leftPct).toBeCloseTo(
        segments[i - 1]!.leftPct + segments[i - 1]!.widthPct,
        6,
      );
    }
  });

  it("describes a window as a range of years and the periods it touches", () => {
    expect(rangeLabel(1450, 1550)).toBe("1450 – 1550");
    expect(rangeLabel(1550, 1450)).toBe("1450 – 1550"); // order-agnostic
    expect(rangeEraLabel(1450, 1550)).toBe("Middle English · Early Modern");
    expect(rangeEraLabel(900, 1000)).toBe("Old English");
  });

  it("measures how far an answer fell outside the window", () => {
    expect(outsideYears(1500, 1450, 1550)).toBe(0);
    expect(outsideYears(1450, 1450, 1550)).toBe(0); // edges count as inside
    expect(outsideYears(1550, 1450, 1550)).toBe(0);
    expect(outsideYears(1380, 1450, 1550)).toBe(70);
    expect(outsideYears(1601, 1450, 1550)).toBe(51);
    expect(outsideYears(1380, 1550, 1450)).toBe(70); // order-agnostic
  });

  it("places the answer marker on the year's own position", () => {
    expect(yearPositionPct(ANSWER_YEAR_MIN, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)).toBe(0);
    expect(yearPositionPct(ANSWER_YEAR_MAX, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)).toBe(100);
    // 1151 is where Middle English starts: 451 of 1325 years in.
    expect(yearPositionPct(1151, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)).toBeCloseTo(34.0377, 3);
    // Same value as the era boundary the label sits under, by construction.
    const [, middle] = eraSegments(ANSWER_YEAR_MIN, ANSWER_YEAR_MAX);
    expect(yearPositionPct(1151, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)).toBeCloseTo(middle!.leftPct, 6);
  });

  it("clamps a year outside the answer window onto the track", () => {
    // An unplayable year (curated but predating the window) must still land on an
    // end of the track rather than off the element.
    expect(yearPositionPct(300, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)).toBe(0);
    expect(yearPositionPct(2100, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)).toBe(100);
    expect(yearPositionPct(900, 1600, 1600)).toBe(0); // degenerate window
  });

  it("REQUIREMENT: an answer inside the window lands on the tablet, so the marker must sit in front of it", () => {
    // The tablet spans its 100 years, so a correct answer is *under* the thumb —
    // which is exactly why the marker has to be layered above it.
    const { min, max, span } = sliderStartBounds();
    const tablet = tabletWidthPx(TRACK, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX);
    const travel = TRACK - tablet;
    const cases: Array<[start: number, answer: number]> = [
      [1450, 1450], // left edge of the window
      [1450, 1492], // inside
      [1450, 1550], // right edge of the window
      [700, 700],
      [max, max + span],
    ];
    for (const [start, answer] of cases) {
      const thumbLeft = ((start - min) / (max - min)) * travel;
      const markerX = (yearPositionPct(answer, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX) / 100) * TRACK;
      expect(markerX).toBeGreaterThanOrEqual(thumbLeft - 0.001);
      expect(markerX).toBeLessThanOrEqual(thumbLeft + tablet + 0.001);
    }
    // And a miss genuinely falls outside the tablet, so the marker is visible on
    // the bare track instead.
    const thumbLeft = ((1450 - min) / (max - min)) * travel;
    const missed = (yearPositionPct(1700, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX) / 100) * TRACK;
    expect(missed).toBeGreaterThan(thumbLeft + tablet);
  });

  it("degrades safely on a degenerate track or window", () => {
    expect(tabletWidthPx(0, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)).toBe(0);
    expect(tabletWidthPx(TRACK, 1600, 1600)).toBe(0);
    expect(eraSegments(1600, 1600)).toEqual([]);
  });
});
