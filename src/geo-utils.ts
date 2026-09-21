/**
 * Spherical geometry utilities for country-border distance queries.
 * Positions in map data are GeoJSON [lng, lat]; points here use LatLng.
 */

import type { LatLng } from "./types";

export const EARTH_RADIUS_KM = 6371.0088;

const toRad = Math.PI / 180;

type Vec3 = [number, number, number];

function toVec(p: LatLng): Vec3 {
  const lat = p.lat * toRad;
  const lng = p.lng * toRad;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lng), cosLat * Math.sin(lng), Math.sin(lat)];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v);
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Great-circle distance in km between two points. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Distance in km from `p` to the shorter great-circle arc from `a` to `b`.
 * Pins projected beyond an endpoint use the endpoint distance.
 */
export function distanceToSegmentKm(p: LatLng, a: LatLng, b: LatLng): number {
  const pv = toVec(p);
  const av = toVec(a);
  const bv = toVec(b);
  if (dot(av, bv) > 1 - 1e-12) return haversineKm(p, a); // degenerate segment
  const n = normalize(cross(av, bv));
  const dxt = Math.asin(Math.max(-1, Math.min(1, dot(pv, n))));
  const along = Math.atan2(dot(pv, cross(n, av)), dot(pv, av));
  const segLen = Math.atan2(length(cross(av, bv)), dot(av, bv));
  if (along < 0) return haversineKm(p, a);
  if (along > segLen) return haversineKm(p, b);
  return Math.abs(dxt) * EARTH_RADIUS_KM;
}

/** Minimal GeoJSON geometry we score against. */
export type MapGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

/**
 * Distance in km from a point to the nearest border of a (Multi)Polygon.
 * Returns 0 for points inside any ring (holes included — a point inside a
 * hole is on the country's boundary, which is the right behaviour for
 * enclaves). Every ring is treated as a border.
 */
export function distanceToGeometryKm(p: LatLng, geometry: MapGeometry): number {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best = Number.POSITIVE_INFINITY;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const d = distanceToSegmentKm(p, { lat: a[1]!, lng: a[0]! }, { lat: b[1]!, lng: b[0]! });
        if (d < best) best = d;
        if (best === 0) return 0;
      }
      // inside check: point-in-ring via ray casting on the (planar) ring
      if (ringContains(ring, p)) return 0;
    }
  }
  return best;
}

/** Planar ray-casting point-in-ring test on [lng, lat] positions. */
function ringContains(ring: number[][], p: LatLng): boolean {
  let inside = false;
  const x = p.lng;
  const y = p.lat;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
