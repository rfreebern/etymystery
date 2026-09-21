/**
 * SVG world map: renders country features via d3-geo, accepts pin drops,
 * and highlights the answer on reveal. Fixed 960x500 viewBox, responsive
 * via CSS width: 100%.
 */

import { geoNaturalEarth1, geoPath } from "d3-geo";
import type { CountryFeature } from "./geo-context";
import type { BankEntry, LatLng } from "../../src/types";

const WIDTH = 960;
const HEIGHT = 500;

export interface WorldMap {
  svg: SVGSVGElement;
  /** Register a callback receiving the picked [lng, lat]. */
  onPick(handler: (lngLat: [number, number]) => void): void;
  setGuessPin(point: LatLng | null): void;
  revealAnswer(entry: BankEntry, guess: LatLng | null): void;
  clearReveal(): void;
}

export function createWorldMap(container: HTMLElement, features: CountryFeature[]): WorldMap {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("class", "world-map");

  const projection = geoNaturalEarth1().fitExtent([[8, 8], [WIDTH - 8, HEIGHT - 8]], {
    type: "FeatureCollection",
    features: features.map((f) => ({ type: "Feature" as const, geometry: f.geometry, properties: {} })),
  });
  const path = geoPath(projection);

  const layerCountries = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const layerHighlight = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const layerMarkers = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.append(layerCountries, layerHighlight, layerMarkers);

  for (const feature of features) {
    const country = document.createElementNS("http://www.w3.org/2000/svg", "path");
    country.setAttribute("d", path(feature.geometry) ?? "");
    country.setAttribute("data-iso", feature.iso);
    country.setAttribute("class", "country");
    layerCountries.append(country);
  }

  let pickHandler: ((lngLat: [number, number]) => void) | null = null;
  svg.addEventListener("click", (event: MouseEvent) => {
    if (!pickHandler) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    const inverted = projection.invert?.([x, y]);
    if (!inverted) return;
    let [lng, lat] = inverted;
    lng = ((lng + 540) % 360) - 180; // wrap antimeridian overshoot
    pickHandler([lng, lat]);
  });

  function marker(point: LatLng, cssClass: string): void {
    const projected = projection([point.lng, point.lat]);
    if (!projected) return;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(projected[0]));
    circle.setAttribute("cy", String(projected[1]));
    circle.setAttribute("r", "7");
    circle.setAttribute("class", cssClass);
    layerMarkers.append(circle);
  }

  return {
    svg,
    onPick(handler) {
      pickHandler = handler;
    },
    setGuessPin(point) {
      layerMarkers.replaceChildren();
      if (point) marker(point, "pin-guess");
    },
    revealAnswer(entry, guess) {
      layerHighlight.replaceChildren();
      for (const iso of entry.countries) {
        const target = layerCountries.querySelector(`[data-iso="${iso}"]`);
        if (target) layerHighlight.append(target.cloneNode(true));
      }
      for (const pathEl of Array.from(layerHighlight.children)) (pathEl as Element).setAttribute("class", "country-answer");
      layerMarkers.replaceChildren();
      if (guess) marker(guess, "pin-guess");
      marker(entry.point, "pin-answer");
    },
    clearReveal() {
      layerHighlight.replaceChildren();
      layerMarkers.replaceChildren();
    },
  };
}
