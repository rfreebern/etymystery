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

  it("degrades safely on a degenerate track or window", () => {
    expect(tabletWidthPx(0, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)).toBe(0);
    expect(tabletWidthPx(TRACK, 1600, 1600)).toBe(0);
    expect(eraSegments(1600, 1600)).toEqual([]);
  });
});
