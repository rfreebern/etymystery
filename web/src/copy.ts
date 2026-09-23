/**
 * The copy that depends on how the device is driven.
 *
 * One build ships to every device, so the hints have to name the gesture the player
 * actually has: "scroll to zoom" and "click to pin" mean nothing on a phone, and
 * "use ← → for 25-year steps" assumes arrow keys. Everything else the game says is
 * device-neutral and stays inline where it is used.
 */

/** The query that separates a touch-first device from a mouse-driven one. */
export const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";

export interface InputHints {
  /** The line under the map's zoom controls. */
  map: string;
  /** Tooltip for the zoom-in button. */
  zoomIn: string;
  /** Tooltip for the zoom-out button. */
  zoomOut: string;
  /** Tooltip for the reset button. */
  reset: string;
  /** The line under the timeline. */
  timeline: string;
  /** Shown once a round is scored and the inputs freeze. */
  locked: string;
}

export const DESKTOP_HINTS: InputHints = {
  map: "scroll to zoom · drag to pan · click to pin",
  zoomIn: "Zoom in (or scroll or double-click the map)",
  zoomOut: "Zoom out",
  reset: "Fit the whole world again",
  timeline: "drag, or use ← → for 25-year steps · any answer inside the window scores full marks",
  locked: "Locked in. Zoom and pan the map to inspect the answer.",
};

export const TOUCH_HINTS: InputHints = {
  map: "pinch to zoom · drag to pan · tap to pin",
  zoomIn: "Zoom in (or pinch the map)",
  zoomOut: "Zoom out",
  reset: "Fit the whole world again",
  timeline: "drag the handle: 25-year steps · any answer inside the window scores full marks",
  locked: "Locked in. Pinch and drag the map to inspect the answer.",
};

export function hintsFor(touchFirst: boolean): InputHints {
  return touchFirst ? TOUCH_HINTS : DESKTOP_HINTS;
}

export interface InputEnvironment {
  /** `window.matchMedia`, which is absent in tests and in ancient browsers. */
  matchMedia?: (query: string) => { matches: boolean };
  /** `navigator.maxTouchPoints`. */
  maxTouchPoints?: number;
}

function platform(): InputEnvironment {
  return {
    matchMedia:
      typeof globalThis.matchMedia === "function"
        ? globalThis.matchMedia.bind(globalThis)
        : undefined,
    maxTouchPoints: typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
  };
}

/**
 * Whether the primary input is touch. Read once per load: a device does not change
 * class mid-round, and re-rendering hints on a media-query flip would be machinery
 * for a case that only happens when someone plugs a mouse into a tablet.
 */
export function isTouchFirst(env: InputEnvironment = platform()): boolean {
  if (typeof env.matchMedia === "function") {
    return env.matchMedia(TOUCH_QUERY).matches;
  }
  return (env.maxTouchPoints ?? 0) > 0;
}
