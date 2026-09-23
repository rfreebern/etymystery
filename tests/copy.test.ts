/**
 * Device-dependent copy. Two audiences, one build: the hints must name the gesture
 * the player actually has, and the CSS that switches the layout must agree with the
 * query this module uses to pick the words.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESKTOP_HINTS, TOUCH_HINTS, TOUCH_QUERY, hintsFor, isTouchFirst } from "../web/src/copy";

/** Words that only make sense with a mouse or a keyboard. */
const DESKTOP_ONLY = ["scroll", "click", "double-click", "←", "→", "cursor"];

describe("hintsFor", () => {
  it("names mouse and keyboard gestures on a desktop", () => {
    const text = Object.values(DESKTOP_HINTS).join(" ");
    expect(text).toContain("scroll to zoom");
    expect(text).toContain("click to pin");
    expect(text).toContain("← →");
  });

  it("names touch gestures on a touch-first device, with none of the desktop words", () => {
    const text = Object.values(TOUCH_HINTS).join(" ");
    expect(text).toContain("pinch to zoom");
    expect(text).toContain("tap to pin");
    expect(text).toContain("drag the handle");
    for (const word of DESKTOP_ONLY) {
      expect(text.toLowerCase(), word).not.toContain(word);
    }
  });

  it("keeps the device-neutral hints identical in both", () => {
    expect(TOUCH_HINTS.zoomOut).toBe(DESKTOP_HINTS.zoomOut);
    expect(TOUCH_HINTS.reset).toBe(DESKTOP_HINTS.reset);
  });

  it("says how to keep exploring once the round is frozen, in each vocabulary", () => {
    expect(DESKTOP_HINTS.locked).toContain("Zoom and pan");
    expect(TOUCH_HINTS.locked).toContain("Pinch and drag");
  });

  it("picks the set by device class", () => {
    expect(hintsFor(true)).toBe(TOUCH_HINTS);
    expect(hintsFor(false)).toBe(DESKTOP_HINTS);
  });
});

describe("isTouchFirst", () => {
  const env = (matches: boolean) => ({ matchMedia: () => ({ matches }) });

  it("follows the hover/pointer query when matchMedia exists", () => {
    expect(isTouchFirst(env(true))).toBe(true);
    expect(isTouchFirst(env(false))).toBe(false);
  });

  it("falls back to maxTouchPoints when matchMedia does not", () => {
    expect(isTouchFirst({ maxTouchPoints: 5 })).toBe(true);
    expect(isTouchFirst({ maxTouchPoints: 0 })).toBe(false);
    expect(isTouchFirst({})).toBe(false);
  });

  it("uses the same query the stylesheet does", () => {
    // Two languages cannot share a constant, so guard the drift: the CSS switches its
    // layout on the very query this module picks its words with.
    const css = readFileSync("web/src/style.css", "utf8");
    expect(css).toContain(TOUCH_QUERY);
  });
});
