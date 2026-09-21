import { describe, expect, it } from "vitest";
import { distanceToGeometryKm, distanceToSegmentKm, haversineKm } from "../src/geo-utils";
import type { LatLng } from "../src/types";

const P = (lat: number, lng: number): LatLng => ({ lat, lng });
const rect = (lonMin: number, lonMax: number, latMin: number, latMax: number) =>
  ({
    type: "Polygon" as const,
    coordinates: [
      [
        [lonMin, latMin],
        [lonMax, latMin],
        [lonMax, latMax],
        [lonMin, latMax],
        [lonMin, latMin],
      ],
    ],
  });

describe("haversineKm", () => {
  it("computes known distances", () => {
    const d = haversineKm(P(51.5074, -0.1278), P(48.8566, 2.3522));
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(360);
    expect(haversineKm(P(0, 0), P(0, 1))).toBeCloseTo(111.19, 1);
  });
});

describe("distanceToSegmentKm", () => {
  it("measures cross-track distance for a point beside the segment", () => {
    // Segment along the equator 0..10 deg E; point 5 deg N above its midpoint.
    const d = distanceToSegmentKm(P(5, 5), P(0, 0), P(0, 10));
    expect(d).toBeGreaterThan(540);
    expect(d).toBeLessThan(570);
  });

  it("clamps to the endpoint when the pin is beyond the segment", () => {
    const d = distanceToSegmentKm(P(0, 20), P(0, 0), P(0, 10));
    expect(d).toBeGreaterThan(1090); // ~1112 km (10 deg at the equator)
    expect(d).toBeLessThan(1130);
  });

  it("clamps to the start endpoint when before the segment", () => {
    const d = distanceToSegmentKm(P(0, -5), P(0, 0), P(0, 10));
    expect(d).toBeGreaterThan(540);
    expect(d).toBeLessThan(570);
  });

  it("returns 0 for a pin on the segment", () => {
    expect(distanceToSegmentKm(P(0, 5), P(0, 0), P(0, 10))).toBeCloseTo(0, 6);
  });

  it("handles meridian segments with latitude-scaled distances", () => {
    // Segment 50N..60N at 0E; pin 5 deg east at 55N -> ~318 km.
    const d = distanceToSegmentKm(P(55, 5), P(50, 0), P(60, 0));
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(335);
  });

  it("falls back to endpoint distance for degenerate segments", () => {
    const d = distanceToSegmentKm(P(10, 10), P(5, 5), P(5, 5));
    expect(d).toBeCloseTo(haversineKm(P(10, 10), P(5, 5)), 6);
  });
});

describe("distanceToGeometryKm", () => {
  const norway = rect(4, 14, 58, 66);

  it("returns 0 inside the polygon", () => {
    expect(distanceToGeometryKm(P(61, 9), norway)).toBe(0);
  });

  it("measures distance to the nearest border arc outside", () => {
    // 1 deg south of the 58N edge — but great-circle arcs between equal
    // latitudes bulge poleward, so the arc's closest point is ~1.10 deg away.
    const d = distanceToGeometryKm(P(57, 9), norway);
    expect(d).toBeGreaterThan(115);
    expect(d).toBeLessThan(128);
  });

  it("treats holes as borders (enclaves behave as boundary hits)", () => {
    const withHole = {
      type: "Polygon" as const,
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
          [4, 4],
        ],
      ],
    };
    // Pin inside the hole: the hole is part of the country's border system,
    // so an enclave pin counts as a boundary hit (distance 0).
    expect(distanceToGeometryKm(P(5, 5), withHole)).toBe(0);
  });

  it("handles MultiPolygon geometries", () => {
    const multi = {
      type: "MultiPolygon" as const,
      coordinates: [rect(0, 1, 0, 1).coordinates, rect(10, 11, 10, 11).coordinates],
    };
    // Pin between the two polygons, ~0.5 deg from the first one's edge.
    const d = distanceToGeometryKm(P(0.5, 1.5), multi);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(80);
  });
});
