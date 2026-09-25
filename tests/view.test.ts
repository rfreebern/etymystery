/**
 * Map view maths: the invariants that make zoom/pan feel right, tested without a
 * DOM (map.ts just applies the results as an SVG transform).
 */

import { describe, expect, it } from "vitest";
import {
  FIT_PADDING,
  IDENTITY,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  clampView,
  fitPoints,
  panBy,
  pinch,
  toMapPoint,
  toScreen,
  viewTransform,
  visibleAt,
  zoomAt,
} from "../web/src/view";

const W = 960;
const H = 500;

describe("view", () => {
  it("starts fitted: no transform", () => {
    expect(viewTransform(IDENTITY)).toBe("translate(0 0) scale(1)");
    expect(IDENTITY).toMatchObject({ k: 1 });
  });

  it("keeps the point under the cursor fixed while zooming", () => {
    const cursor = { x: 300, y: 120 };
    const before = toMapPoint(IDENTITY, cursor.x, cursor.y);
    const zoomed = zoomAt(IDENTITY, 2, cursor.x, cursor.y, W, H);
    const afterProjected = {
      x: before.x * zoomed.k + zoomed.tx,
      y: before.y * zoomed.k + zoomed.ty,
    };
    expect(afterProjected.x).toBeCloseTo(cursor.x, 6);
    expect(afterProjected.y).toBeCloseTo(cursor.y, 6);
  });

  it("clamps the zoom to a usable range", () => {
    expect(zoomAt(IDENTITY, 1 / ZOOM_STEP, 100, 100, W, H).k).toBe(MIN_ZOOM);
    let view = IDENTITY;
    for (let i = 0; i < 20; i++) view = zoomAt(view, ZOOM_STEP, 100, 100, W, H);
    expect(view.k).toBe(MAX_ZOOM);
  });

  it("never reveals empty space: at zoom 1 panning does nothing", () => {
    expect(panBy(IDENTITY, 120, -80, W, H)).toEqual(IDENTITY);
  });

  it("allows panning only within the scaled map", () => {
    const zoomed = zoomAt(IDENTITY, 2, W / 2, H / 2, W, H);
    // Dragging far right/down cannot push the map's top-left edge past the origin.
    expect(panBy(zoomed, 5000, 5000, W, H)).toMatchObject({ tx: 0, ty: 0 });
    const shoved = panBy(zoomed, -5000, -5000, W, H);
    expect(shoved.tx).toBeCloseTo(W * (1 - 2), 6);
    expect(shoved.ty).toBeCloseTo(H * (1 - 2), 6);
  });

  it("maps screen points through the transform, invertibly", () => {
    const view = clampView({ k: 2.5, tx: -300, ty: -120 }, W, H);
    const map = toMapPoint(view, 480, 250);
    expect(map.x * view.k + view.tx).toBeCloseTo(480, 6);
    expect(map.y * view.k + view.ty).toBeCloseTo(250, 6);
    // Centre of the viewport is not the centre of the map once panned/zoomed.
    expect(map).not.toEqual({ x: 480 / view.k, y: 250 / view.k });
  });

  it("survives a degenerate zoom of zero", () => {
    expect(toMapPoint({ k: 0, tx: 10, ty: 10 }, 110, 110)).toEqual({ x: 100, y: 100 });
  });
});

describe("pinch", () => {
  it("scales by how far the fingers spread", () => {
    const from = { midX: 400, midY: 250, distance: 100 };
    const to = { midX: 400, midY: 250, distance: 200 };
    expect(pinch(IDENTITY, from, to, W, H).k).toBeCloseTo(2, 6);
    // Fingers closing pinch out again.
    expect(pinch(zoomAt(IDENTITY, 2, 400, 250, W, H), to, from, W, H).k).toBeCloseTo(1, 6);
  });

  it("keeps the map point under the fingers, and follows their midpoint", () => {
    const from = { midX: 300, midY: 200, distance: 120 };
    const to = { midX: 360, midY: 230, distance: 240 }; // spread 2x and moved 60,30
    const view = pinch(IDENTITY, from, to, W, H);
    // The map point that was under the old midpoint is under the new one.
    const mapPoint = toMapPoint(IDENTITY, from.midX, from.midY);
    const projected = { x: mapPoint.x * view.k + view.tx, y: mapPoint.y * view.k + view.ty };
    expect(projected.x).toBeCloseTo(to.midX, 6);
    expect(projected.y).toBeCloseTo(to.midY, 6);
  });

  it("cannot zoom past the limits or drag the world off screen", () => {
    const far = { midX: 100, midY: 100, distance: 10 };
    const veryFar = { midX: 100, midY: 100, distance: 100000 };
    expect(pinch(IDENTITY, far, veryFar, W, H).k).toBe(MAX_ZOOM);
    const squeezed = pinch(IDENTITY, veryFar, far, W, H);
    expect(squeezed.k).toBe(MIN_ZOOM);
    expect(squeezed).toMatchObject({ tx: 0, ty: 0 });
  });

  it("ignores a degenerate span instead of producing NaN", () => {
    const view = pinch(IDENTITY, { midX: 10, midY: 10, distance: 0 }, { midX: 10, midY: 10, distance: 0 }, W, H);
    expect(view).toEqual(IDENTITY);
  });
});

describe("framing two points on the map", () => {
  const W = 960;
  const H = 500;
  /** Zoomed in on (480, 250), the guess: the answer at (700, 300) is well off screen. */
  const zoomed = { k: 6, tx: -2400, ty: -1000 };
  const guess = { x: 480, y: 250 };
  const answer = { x: 700, y: 300 };

  it("sees what is off screen, with a margin for the pin's own radius", () => {
    expect(visibleAt(zoomed, guess, W, H)).toBe(true);
    expect(visibleAt(zoomed, answer, W, H)).toBe(false);
    // A point a hair inside the edge is only half a pin, so a margin rejects it.
    const edge = { x: 479, y: 250 };
    expect(visibleAt(zoomed, edge, W, H, 0)).toBe(true);
    expect(visibleAt(zoomed, edge, W, H, 20)).toBe(false);
  });

  it("zooms out until both fit, with padding at the edges", () => {
    const fitted = fitPoints(zoomed, [guess, answer], W, H);
    expect(fitted.k).toBeLessThan(zoomed.k);
    for (const point of [guess, answer]) {
      expect(visibleAt(fitted, point, W, H, 7)).toBe(true);
      const screen = toScreen(fitted, point);
      // The span is what set the zoom, so the padding is used on that axis.
      expect(screen.x).toBeGreaterThanOrEqual(FIT_PADDING - 1e-6);
      expect(screen.x).toBeLessThanOrEqual(W - FIT_PADDING + 1e-6);
      expect(screen.y).toBeGreaterThanOrEqual(FIT_PADDING - 1e-6);
      expect(screen.y).toBeLessThanOrEqual(H - FIT_PADDING + 1e-6);
    }
  });

  it("never zooms in past the view it was given", () => {
    // Two pins in the same city, on a player who had zoomed all the way out.
    const near = fitPoints(IDENTITY, [{ x: 480, y: 250 }, { x: 484, y: 252 }], W, H);
    expect(near.k).toBe(IDENTITY.k);
    // And it centres them, so a pin near the edge of a hard zoom comes into view.
    const panned = { k: 8, tx: -7000, ty: -3700 };
    const centred = fitPoints(panned, [guess], W, H);
    expect(centred.k).toBe(8);
    expect(toScreen(centred, guess).x).toBeCloseTo(W / 2, 6);
    expect(toScreen(centred, guess).y).toBeCloseTo(H / 2, 6);
  });

  it("stays within the pan limits, giving up padding rather than a point", () => {
    // A corner of the map: the clamp is what decides, and both points still land.
    const corner = fitPoints({ k: 5, tx: -4000, ty: -2000 }, [{ x: 4, y: 3 }, { x: 40, y: 30 }], W, H);
    expect(corner).toEqual(clampView(corner, W, H));
    for (const point of [{ x: 4, y: 3 }, { x: 40, y: 30 }]) {
      expect(visibleAt(corner, point, W, H)).toBe(true);
    }
  });

  it("leaves a view with nothing to fit exactly as it was", () => {
    expect(fitPoints(zoomed, [], W, H)).toEqual(zoomed);
  });
});
