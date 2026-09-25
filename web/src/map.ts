/**
 * SVG world map: renders country features via d3-geo, accepts pin drops,
 * highlights the answer on reveal, and supports zoom/pan (wheel, drag, buttons).
 * Fixed 960x500 viewBox, responsive via CSS width: 100%.
 *
 * Zoom and pan are a transform on a wrapper <g>; the maths lives in view.ts. Pin
 * markers are counter-scaled so they stay a readable size at any zoom.
 */

import { geoNaturalEarth1, geoPath } from "d3-geo";
import type { CountryFeature } from "./geo-context";
import type { BankEntry, LatLng } from "../../src/types";
import {
  IDENTITY,
  ZOOM_STEP,
  fitPoints,
  panBy,
  pinch,
  toMapPoint,
  viewTransform,
  visibleAt,
  zoomAt,
  type View,
} from "./view";

const WIDTH = 960;
const HEIGHT = 500;
/** Pointer travel (viewBox units) beyond which a gesture is a drag, not a click. */
const DRAG_SLOP = 4;
/** Pin radius in viewBox units at zoom 1. */
const PIN_RADIUS = 7;

export interface WorldMap {
  svg: SVGSVGElement;
  /** Register a callback receiving the picked [lng, lat]. */
  onPick(handler: (lngLat: [number, number]) => void): void;
  setGuessPin(point: LatLng | null): void;
  revealAnswer(entry: BankEntry, guess: LatLng | null): void;
  clearReveal(): void;
  /**
   * Whether clicking the map drops a pin. Turning it off must NOT affect zoom and
   * pan: a scored round is frozen for pinning, but still explorable.
   */
  allowPicking(enabled: boolean): void;
  /** Multiply the zoom by `factor`, keeping the map centre fixed. */
  zoomBy(factor: number): void;
  resetView(): void;
  /** Current zoom factor (1 = fitted to the viewBox). */
  zoom(): number;
}

export function createWorldMap(container: HTMLElement, features: CountryFeature[]): WorldMap {
  void container;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("class", "world-map");
  // Required for pointer-drag panning on touch devices, which would otherwise
  // scroll the page instead.
  svg.style.touchAction = "none";

  const projection = geoNaturalEarth1().fitExtent([[8, 8], [WIDTH - 8, HEIGHT - 8]], {
    type: "FeatureCollection",
    features: features.map((f) => ({ type: "Feature" as const, geometry: f.geometry, properties: {} })),
  });
  const path = geoPath(projection);

  const viewport = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const layerCountries = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const layerHighlight = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const layerMarkers = document.createElementNS("http://www.w3.org/2000/svg", "g");
  viewport.append(layerCountries, layerHighlight, layerMarkers);
  svg.append(viewport);

  for (const feature of features) {
    const country = document.createElementNS("http://www.w3.org/2000/svg", "path");
    country.setAttribute("d", path(feature.geometry) ?? "");
    country.setAttribute("data-iso", feature.iso);
    country.setAttribute("class", "country");
    layerCountries.append(country);
  }

  let view: View = { ...IDENTITY };
  let pickHandler: ((lngLat: [number, number]) => void) | null = null;
  let picking = true;
  let draggedRecently = false;
  // What is currently drawn, so markers can be redrawn (counter-scaled) whenever
  // the zoom changes.
  let guessPoint: LatLng | null = null;
  let answer: { entry: BankEntry; guess: LatLng | null } | null = null;

  function drawMarkers(): void {
    layerMarkers.replaceChildren();
    const radius = PIN_RADIUS / view.k;
    const add = (point: LatLng, cssClass: string): void => {
      const projected = projection([point.lng, point.lat]);
      if (!projected) return;
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(projected[0]));
      circle.setAttribute("cy", String(projected[1]));
      circle.setAttribute("r", String(radius));
      circle.setAttribute("stroke-width", String(1.2 / view.k));
      circle.setAttribute("class", cssClass);
      layerMarkers.append(circle);
    };
    if (answer) {
      if (answer.guess) add(answer.guess, "pin-guess");
      add(answer.entry.point, "pin-answer");
      return;
    }
    if (guessPoint) add(guessPoint, "pin-guess");
  }

  function applyView(): void {
    viewport.setAttribute("transform", viewTransform(view));
    svg.classList.toggle("zoomed", view.k > 1.001);
    drawMarkers();
  }

  /** Pointer position in viewBox coordinates. */
  function toViewBox(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }
  // ---- zoom -----------------------------------------------------------------
  svg.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      event.preventDefault();
      const { x, y } = toViewBox(event);
      view = zoomAt(view, Math.pow(ZOOM_STEP, event.deltaY > 0 ? -1 : 1), x, y, WIDTH, HEIGHT);
      applyView();
    },
    { passive: false },
  );
  svg.addEventListener("dblclick", (event: MouseEvent) => {
    event.preventDefault();
    const { x, y } = toViewBox(event);
    view = zoomAt(view, ZOOM_STEP, x, y, WIDTH, HEIGHT);
    applyView();
  });

  // ---- pan and pinch --------------------------------------------------------
  // Every active pointer, in viewBox coordinates, so two of them can be read as a
  // pinch. One pointer pans; two pinch (scale by their spread, follow their midpoint).
  const pointers = new Map<number, { x: number; y: number }>();
  let dragging: { pointerId: number; x: number; y: number; moved: number } | null = null;
  let pinchSpan: { midX: number; midY: number; distance: number } | null = null;

  const spanOf = (): { midX: number; midY: number; distance: number } | null => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return null;
    return {
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };

  svg.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const { x, y } = toViewBox(event);
    pointers.set(event.pointerId, { x, y });
    svg.setPointerCapture(event.pointerId);
    draggedRecently = false;
    if (pointers.size === 1) {
      dragging = { pointerId: event.pointerId, x, y, moved: 0 };
      svg.classList.add("dragging");
    } else if (pointers.size === 2) {
      dragging = null; // two fingers is a pinch, not a pan
      pinchSpan = spanOf();
      svg.classList.remove("dragging");
    }
  });

  svg.addEventListener("pointermove", (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    const { x, y } = toViewBox(event);
    pointers.set(event.pointerId, { x, y });

    if (pointers.size >= 2) {
      const span = spanOf();
      if (span && pinchSpan) {
        view = pinch(view, pinchSpan, span, WIDTH, HEIGHT);
        applyView();
        // A pinch must never be read as a pin drop when the fingers lift.
        draggedRecently = true;
      }
      pinchSpan = span;
      return;
    }

    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const dx = x - dragging.x;
    const dy = y - dragging.y;
    dragging.x = x;
    dragging.y = y;
    dragging.moved += Math.abs(dx) + Math.abs(dy);
    if (dragging.moved < DRAG_SLOP) return;
    draggedRecently = true;
    view = panBy(view, dx, dy, WIDTH, HEIGHT);
    applyView();
  });

  const endPointer = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (pointers.size < 2) pinchSpan = null;
    if (dragging && dragging.pointerId === event.pointerId) {
      dragging = null;
      svg.classList.remove("dragging");
    } else if (pointers.size === 1) {
      // One finger left after a pinch: keep panning from where it is.
      const [id, point] = [...pointers.entries()][0]!;
      dragging = { pointerId: id, x: point.x, y: point.y, moved: 0 };
    }
  };
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);

  // ---- pin drop -------------------------------------------------------------
  svg.addEventListener("click", (event: MouseEvent) => {
    if (!pickHandler || !picking) return;
    // A drag ends with a click event too; that gesture was a pan, not a pin.
    if (draggedRecently) return;
    const { x, y } = toViewBox(event);
    const map = toMapPoint(view, x, y);
    const inverted = projection.invert?.([map.x, map.y]);
    if (!inverted) return;
    let [lng, lat] = inverted;
    lng = ((lng + 540) % 360) - 180; // wrap antimeridian overshoot
    pickHandler([lng, lat]);
  });

  applyView();



  return {
    svg,
    onPick(handler) {
      pickHandler = handler;
    },
    setGuessPin(point) {
      guessPoint = point;
      answer = null;
      layerHighlight.replaceChildren();
      drawMarkers();
    },
    revealAnswer(entry, guess) {
      answer = { entry, guess };
      guessPoint = null;
      layerHighlight.replaceChildren();
      for (const iso of entry.countries) {
        const target = layerCountries.querySelector(`[data-iso="${iso}"]`);
        if (target) layerHighlight.append(target.cloneNode(true));
      }
      for (const pathEl of Array.from(layerHighlight.children)) {
        (pathEl as Element).setAttribute("class", "country-answer");
      }
      // The answer can be an ocean away from the guess, and from wherever the player had
      // zoomed in to drop the guess. If either pin would land off screen (or half off it),
      // pull the view back until both are on it with a little room around them; otherwise
      // leave the view exactly where the player left it, because the zoom was their choice.
      const points = [guess, entry.point]
        .map((point) => (point ? projection([point.lng, point.lat]) : null))
        .filter((projected): projected is [number, number] => projected !== null)
        .map(([x, y]) => ({ x, y }));
      const margin = PIN_RADIUS / view.k;
      if (points.some((point) => !visibleAt(view, point, WIDTH, HEIGHT, margin))) {
        view = fitPoints(view, points, WIDTH, HEIGHT);
        applyView();
      } else {
        drawMarkers();
      }
    },
    clearReveal() {
      answer = null;
      guessPoint = null;
      layerHighlight.replaceChildren();
      layerMarkers.replaceChildren();
    },
    allowPicking(enabled) {
      picking = enabled;
    },
    zoomBy(factor) {
      view = zoomAt(view, factor, WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT);
      applyView();
    },
    resetView() {
      view = { ...IDENTITY };
      applyView();
    },
    zoom() {
      return view.k;
    },
  };
}
