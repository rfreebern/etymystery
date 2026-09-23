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
