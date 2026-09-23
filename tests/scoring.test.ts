import { describe, expect, it } from "vitest";
import {
  haversineKm,
  scoreGeographic,
  scoreRound,
  scoreTemporalRange,
  type GeocodeContext,
} from "../src/scoring";
import type { BankEntry, LatLng } from "../src/types";

interface Rect { lonMin: number; lonMax: number; latMin: number; latMax: number }

const RECTS: Record<string, Rect> = {
  NO: { lonMin: 4, lonMax: 14, latMin: 58, latMax: 66 },
  SE: { lonMin: 11, lonMax: 24, latMin: 58, latMax: 69 },
  NL: { lonMin: 3.3, lonMax: 7.2, latMin: 50.8, latMax: 53.7 },
  RU: { lonMin: 28, lonMax: 179, latMin: 40, latMax: 75 },
  FR: { lonMin: -1, lonMax: 8, latMin: 42, latMax: 51 },
  SA: { lonMin: 34.5, lonMax: 56, latMin: 16, latMax: 32 },
  JP: { lonMin: 129, lonMax: 146, latMin: 31, latMax: 46 },
  TR: { lonMin: 26, lonMax: 45, latMin: 36, latMax: 42 },
  IN: { lonMin: 68, lonMax: 97, latMin: 8, latMax: 35 },
  CN: { lonMin: 73, lonMax: 135, latMin: 18, latMax: 53 },
  EG: { lonMin: 25, lonMax: 34.4, latMin: 22, latMax: 31.5 },
  DZ: { lonMin: -8.7, lonMax: 12, latMin: 19, latMax: 37 },
};

const REGIONS: Record<string, { subregion?: string; continent?: string }> = {
  NO: { subregion: "Northern Europe", continent: "Europe" },
  SE: { subregion: "Northern Europe", continent: "Europe" },
  NL: { subregion: "Western Europe", continent: "Europe" },
  FR: { subregion: "Western Europe", continent: "Europe" },
  RU: { subregion: "Eastern Europe", continent: "Europe" },
  SA: { subregion: "Western Asia", continent: "Asia" },
  JP: { subregion: "Eastern Asia", continent: "Asia" },
  TR: { subregion: "Western Asia", continent: "Asia" },
  IN: { subregion: "Southern Asia", continent: "Asia" },
  CN: { subregion: "Eastern Asia", continent: "Asia" },
  EG: { subregion: "Northern Africa", continent: "Africa" },
  DZ: { subregion: "Northern Africa", continent: "Africa" },
};

function inRect(rect: Rect, p: LatLng): boolean {
  return p.lng >= rect.lonMin && p.lng <= rect.lonMax && p.lat >= rect.latMin && p.lat <= rect.latMax;
}

function distToRectKm(iso: string, p: LatLng): number {
  const rect = RECTS[iso];
  if (!rect) return Number.POSITIVE_INFINITY;
  if (inRect(rect, p)) return 0;
  const clamped: LatLng = {
    lat: Math.min(Math.max(p.lat, rect.latMin), rect.latMax),
    lng: Math.min(Math.max(p.lng, rect.lonMin), rect.lonMax),
  };
  return haversineKm(p, clamped);
}

function makeContext(): GeocodeContext {
  return {
    contains: (iso, p) => (RECTS[iso] ? inRect(RECTS[iso]!, p) : false),
    distanceToCountryKm: (iso, p) => distToRectKm(iso, p),
    allCountryCodes: () => Object.keys(RECTS),
    regionOf: (iso) => REGIONS[iso],
    languageOf: (name) =>
      name === "French"
        ? {
            name: "French",
            countries: ["FR"],
            representativePoint: { lat: 48.85, lng: 2.35 },
            subregion: "Western Europe",
            continent: "Europe",
          }
        : undefined,
  };
}

const norwegianWord: BankEntry = {
  id: "window",
  word: "window",
  year: 1225,
  tier: 8,
  originChain: ["Old Norse"],
  originLanguage: "Old Norse",
  countries: ["NO"],
  point: { lat: 61, lng: 9 },
  blurb: "From Old Norse vindauga, 'wind-eye'.",
};

const russianWord: BankEntry = {
  id: "samovar",
  word: "samovar",
  year: 1830,
  tier: 4,
  originChain: ["Russian"],
  originLanguage: "Russian",
  countries: ["RU"],
  point: { lat: 55.8, lng: 37.6 },
  blurb: "From Russian samovar, 'self-boiler'.",
};

const arabicWord: BankEntry = {
  id: "coffee",
  word: "coffee",
  year: 1590,
  tier: 1,
  originChain: ["Arabic"],
  originLanguage: "Arabic",
  countries: ["SA"],
  point: { lat: 24, lng: 46 },
  blurb: "From Arabic qahwah.",
};

describe("haversineKm", () => {
  it("computes known great-circle distances", () => {
    const london = { lat: 51.5074, lng: -0.1278 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    const d = haversineKm(london, paris);
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(360);
    expect(haversineKm(paris, london)).toBeCloseTo(d, 6);
    expect(haversineKm(paris, paris)).toBe(0);
  });
});

describe("scoreTemporalRange", () => {
  it("gives full credit for any answer inside the guessed window", () => {
    // The window is 1550-1650: every year in it is a perfect score, including
    // both edges, because answers are century-granular.
    for (const answer of [1550, 1551, 1600, 1649, 1650]) {
      expect(scoreTemporalRange(answer, 1550, 1650)).toBe(100);
    }
  });

  it("decays with the distance outside the window", () => {
    expect(scoreTemporalRange(1551, 1550, 1650)).toBe(100); // inside
    expect(scoreTemporalRange(1549, 1550, 1650)).toBe(99); // one year out
    expect(scoreTemporalRange(1651, 1550, 1650)).toBe(99); // either side
    expect(scoreTemporalRange(1450, 1550, 1650)).toBe(37); // 100 years out
    expect(scoreTemporalRange(1850, 1550, 1650)).toBe(14); // 200 years out
  });

  it("treats a zero-width window as a point guess", () => {
    expect(scoreTemporalRange(1600, 1600, 1600)).toBe(100);
    expect(scoreTemporalRange(1600, 1650, 1650)).toBe(61);
  });

  it("does not care which end is given first", () => {
    expect(scoreTemporalRange(1600, 1650, 1550)).toBe(100);
    expect(scoreTemporalRange(1450, 1650, 1550)).toBe(37);
  });

  it("is monotonically non-increasing with distance", () => {
    let prev = Infinity;
    for (let start = 1600; start <= 2100; start += 10) {
      const s = scoreTemporalRange(1600, start, start + 100);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });

  it("handles BCE years (negative)", () => {
    expect(scoreTemporalRange(-500, -550, -450)).toBe(100);
    expect(scoreTemporalRange(-500, -300, -200)).toBeLessThan(100);
  });
});

describe("scoreGeographic - country-aware leniency", () => {
  const ctx = makeContext();

  it("scores any pin inside the answer country high, even far from the answer point", () => {
    const detail = scoreGeographic(russianWord, { lat: 43.1, lng: 131.9 }, ctx);
    expect(detail.credit).toBe("country");
    expect(detail.score).toBe(90);
  });

  it("gives a perfect score at the answer point", () => {
    expect(scoreGeographic(russianWord, russianWord.point, ctx).score).toBe(100);
  });

  it("REQUIREMENT: edge-of-Russia beats Netherlands-for-Norway", () => {
    const russia = scoreGeographic(russianWord, { lat: 43.1, lng: 131.9 }, ctx).score;
    const utrecht = scoreGeographic(norwegianWord, { lat: 52.08, lng: 5.12 }, ctx);
    expect(utrecht.credit).toBe("continent"); // Netherlands: right-continent label
    expect(utrecht.matchedCountry).toBe("NO");
    expect(utrecht.score).toBeGreaterThan(55);
    expect(utrecht.score).toBeLessThan(75);
    expect(russia).toBeGreaterThan(utrecht.score);
  });

  it("scores near misses by border proximity and labels the subregion match", () => {
    const stockholm = scoreGeographic(norwegianWord, { lat: 59.33, lng: 18.07 }, ctx);
    expect(stockholm.score).toBeGreaterThan(75);
    expect(stockholm.credit).toBe("subregion");
  });

  it("labels subregion matches without inflating the score", () => {
    // Ankara is in the right subregion (Western Asia) but ~780 km from the
    // Saudi border: points come from border proximity (60), label says subregion.
    const ankara = scoreGeographic(arabicWord, { lat: 39, lng: 35 }, ctx);
    expect(ankara.credit).toBe("subregion");
    expect(ankara.score).toBe(60);
  });

  it("labels continent matches without inflating the score", () => {
    // Chengdu is ~4600 km from the Saudi border: right continent (Asia),
    // but points come from proximity alone (5).
    const chengdu = scoreGeographic(arabicWord, { lat: 30.6, lng: 104.1 }, ctx);
    expect(chengdu.credit).toBe("continent");
    expect(chengdu.score).toBe(5);
  });

  it("scores Delhi by proximity and labels the continent match", () => {
    // Delhi's nearest Saudi-rect edge is ~2100 km away: 25 points of pure
    // border proximity, with the continent match shown as a label.
    const delhi = scoreGeographic(arabicWord, { lat: 28.61, lng: 77.21 }, ctx);
    expect(delhi.score).toBe(25);
    expect(delhi.credit).toBe("continent");
  });

  it("scores zero beyond the outer relevance limit (Tokyo for an Arabic word)", () => {
    const detail = scoreGeographic(arabicWord, { lat: 35.68, lng: 139.76 }, ctx);
    expect(detail.score).toBe(0);
    expect(detail.credit).toBe("none");
  });

  it("gives near-zero credit for ocean pins and wrong continents", () => {
    const atlantic = scoreGeographic(norwegianWord, { lat: 0, lng: -30 }, ctx);
    expect(atlantic.score).toBeLessThanOrEqual(5);
    const japanForNorway = scoreGeographic(norwegianWord, { lat: 35.68, lng: 139.76 }, ctx);
    expect(japanForNorway.score).toBeLessThanOrEqual(5);
  });

  it("decays smoothly with border distance", () => {
    const near = scoreGeographic(norwegianWord, { lat: 57.5, lng: 8 }, ctx).score;
    const far = scoreGeographic(norwegianWord, { lat: 52.08, lng: 5.12 }, ctx).score;
    expect(near).toBeGreaterThan(far);
  });
});

describe("scoreRound", () => {
  const ctx = makeContext();

  it("combines both axes with equal weight", () => {
    const perfect = scoreRound(
      norwegianWord,
      { yearStart: 1175, yearEnd: 1275, point: { lat: 61, lng: 9 } },
      ctx,
    );
    expect(perfect).toMatchObject({ temporal: 100, geographic: 100, total: 100, credit: "country" });

    const yearOnly = scoreRound(norwegianWord, { yearStart: 1175, yearEnd: 1275, point: null }, ctx);
    expect(yearOnly.temporal).toBe(100);
    expect(yearOnly.geographic).toBe(0);
    expect(yearOnly.total).toBe(50);
  });

  it("rewards the leniency design end-to-end", () => {
    const s = scoreRound(
      norwegianWord,
      { yearStart: 1225, yearEnd: 1325, point: { lat: 59.33, lng: 18.07 } },
      ctx,
    );
    expect(s.temporal).toBe(100);
    expect(s.geographic).toBeGreaterThan(70);
    expect(s.total).toBeGreaterThan(85);
  });

  it("loses temporal credit only when the window misses the answer", () => {
    const missed = scoreRound(norwegianWord, { yearStart: 1625, yearEnd: 1725, point: null }, ctx);
    expect(missed.temporal).toBeLessThan(100);
    expect(missed.temporal).toBeGreaterThan(0);
  });
});

describe("scoreGeographic - multi-hop words (deep origin + intermediate)", () => {
  const ctx = makeContext();
  // Arabic -> French -> English, exactly as the pipeline stores it:
  // anchored to the deep origin (Arabic), French kept in originChain.
  const multiHop: BankEntry = {
    id: "transit",
    word: "transit",
    year: 1750,
    tier: 5,
    originChain: ["French", "Arabic"],
    originLanguage: "Arabic",
    countries: ["SA", "EG", "DZ"],
    point: { lat: 24.71, lng: 46.68 },
    blurb: "via French from Arabic.",
  };

  it("scores the deep origin full credit", () => {
    const riyadh = scoreGeographic(multiHop, { lat: 24.71, lng: 46.68 }, ctx);
    expect(riyadh.credit).toBe("country");
    expect(riyadh.score).toBe(100);
    const cairo = scoreGeographic(multiHop, { lat: 30.05, lng: 31.24 }, ctx);
    expect(cairo.credit).toBe("country");
    expect(cairo.score).toBeGreaterThan(90);
  });

  it("gives partial credit for landing on an intermediate hop (Variant B)", () => {
    const paris = scoreGeographic(multiHop, { lat: 48.85, lng: 2.35 }, ctx);
    expect(paris.credit).toBe("intermediate");
    expect(paris.score).toBe(70); // 100 * INTERMEDIATE_WEIGHT
    const lyon = scoreGeographic(multiHop, { lat: 45.76, lng: 4.84 }, ctx);
    expect(lyon.credit).toBe("intermediate");
    expect(lyon.score).toBeGreaterThanOrEqual(65);
    expect(lyon.score).toBeLessThan(70);
  });

  it("REQUIREMENT: Saudi Arabia > France > wrong > zero for Arabic->French->English", () => {
    const saudia = scoreGeographic(multiHop, { lat: 24.71, lng: 46.68 }, ctx).score;
    const france = scoreGeographic(multiHop, { lat: 48.85, lng: 2.35 }, ctx).score;
    const berlin = scoreGeographic(multiHop, { lat: 52.52, lng: 13.4 }, ctx).score;
    const tokyo = scoreGeographic(multiHop, { lat: 35.68, lng: 139.69 }, ctx).score;
    expect(saudia).toBeGreaterThan(france);
    expect(france).toBeGreaterThan(berlin);
    expect(berlin).toBeGreaterThan(0);
    expect(tokyo).toBe(0); // beyond the 5000 km outer limit
  });
});
