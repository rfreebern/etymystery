/**
 * Map view transform: the zoom/pan state and the maths that keeps it sane.
 * Pure (no DOM), so the invariants that make the map feel right — the point under
 * the cursor stays put, the map cannot be dragged off screen, screen->map is the
 * exact inverse of the transform — are unit-testable.
 *
 * The transform is `translate(tx, ty) scale(k)` applied to an SVG `<g>`, in the
 * SVG's own user units (viewBox coordinates), with y down.
 */

export interface View {
  /** Scale factor, 1 = fitted to the viewBox. */
  k: number;
  tx: number;
  ty: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
/** Multiplier per wheel notch / button press. */
export const ZOOM_STEP = 1.4;

export const IDENTITY: View = { k: 1, tx: 0, ty: 0 };

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

export function clampZoom(k: number): number {
  return clamp(Number.isFinite(k) ? k : 1, MIN_ZOOM, MAX_ZOOM);
}

/**
 * Keep the scaled map overlapping the viewBox: at k=1 it must be exactly in
 * place, and when zoomed the translation may only reveal up to the map's own
 * edges (a standard map clamp — no panning into empty space).
 */
export function clampView(view: View, width: number, height: number): View {
  const k = clampZoom(view.k);
  return {
    k,
    tx: clamp(view.tx, width * (1 - k), 0),
    ty: clamp(view.ty, height * (1 - k), 0),
  };
}

/** Zoom by `factor`, keeping the map point under (cx, cy) fixed. */
export function zoomAt(
  view: View,
  factor: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
): View {
  const k = clampZoom(view.k * factor);
  const ratio = k / view.k;
  return clampView(
    { k, tx: cx - (cx - view.tx) * ratio, ty: cy - (cy - view.ty) * ratio },
    width,
    height,
  );
}

/** Drag the map by a screen delta. */
export function panBy(view: View, dx: number, dy: number, width: number, height: number): View {
  return clampView({ ...view, tx: view.tx + dx, ty: view.ty + dy }, width, height);
}

/** Screen (viewBox) point -> map coordinates, undoing the zoom and pan. */
export function toMapPoint(view: View, x: number, y: number): { x: number; y: number } {
  const k = view.k || 1;
  return { x: (x - view.tx) / k, y: (y - view.ty) / k };
}

/** Breathing room left around fitted points, in viewBox units. */
export const FIT_PADDING = 44;

/** Map coordinates of a point (the projection's output units, before the view). */
export interface MapPoint {
  x: number;
  y: number;
}

/** Screen position of a map point at this view. */
export function toScreen(view: View, point: MapPoint): { x: number; y: number } {
  return { x: point.x * view.k + view.tx, y: point.y * view.k + view.ty };
}

/**
 * Whether a map point is on screen, with `margin` viewBox units to spare.
 *
 * The margin matters for pins: a marker whose centre sits exactly on the edge is drawn
 * half off the map, which reads as "not there". Markers are counter-scaled, so the
 * caller passes their radius at the current zoom.
 */
export function visibleAt(
  view: View,
  point: MapPoint,
  width: number,
  height: number,
  margin = 0,
): boolean {
  const { x, y } = toScreen(view, point);
  return x >= margin && x <= width - margin && y >= margin && y <= height - margin;
}

/**
 * A view showing every point, with padding around the edges where the map allows it.
 *
 * Used when the round is revealed: the guess and the answer can be an ocean apart, and
 * being told the answer is somewhere you cannot see is the worst moment of the game. It
 * only ever zooms OUT (`k` never rises above the view it was given), because the zoom was
 * the player's choice; panning is clamped as everywhere else, so the desired padding is
 * given up before a point is allowed off screen. A single point, or several on one spot,
 * keep the current zoom and are simply centred.
 */
export function fitPoints(
  view: View,
  points: MapPoint[],
  width: number,
  height: number,
  padding = FIT_PADDING,
): View {
  if (points.length === 0) return view;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);
  // A zero span (one point) divides to Infinity, which `min` then ignores: the point
  // keeps the zoom it had and only moves to the middle.
  const k = clampZoom(
    Math.min(
      view.k,
      usableWidth / Math.max(maxX - minX, 1e-6),
      usableHeight / Math.max(maxY - minY, 1e-6),
    ),
  );
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  return clampView(
    { k, tx: width / 2 - centreX * k, ty: height / 2 - centreY * k },
    width,
    height,
  );
}

/** The SVG transform string for the given view. */
export function viewTransform(view: View): string {
  return `translate(${view.tx} ${view.ty}) scale(${view.k})`;
}

/** A two-finger gesture: where the fingers were, and how far apart. */
export interface PinchSpan {
  midX: number;
  midY: number;
  distance: number;
}

/**
 * Apply a pinch step: scale by how much the fingers spread, and follow their
 * midpoint. The map point under the midpoint stays under it, which is what makes
 * the gesture feel attached to the fingers rather than to the screen.
 *
 * The map has no rotate or tilt, so the gesture is expressed entirely through the
 * existing zoom/pan state — same clamping as wheel zoom, so a pinch cannot drag the
 * world off screen either.
 */
export function pinch(
  view: View,
  from: PinchSpan,
  to: PinchSpan,
  width: number,
  height: number,
): View {
  const factor = from.distance > 0 && to.distance > 0 ? to.distance / from.distance : 1;
  const zoomed = zoomAt(view, factor, from.midX, from.midY, width, height);
  return panBy(zoomed, to.midX - from.midX, to.midY - from.midY, width, height);
}
