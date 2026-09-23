/**
 * Map view maths: the invariants that make zoom/pan feel right, tested without a
 * DOM (map.ts just applies the results as an SVG transform).
 */

import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  clampView,
  panBy,
  toMapPoint,
  viewTransform,
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
