/**
 * Client wiring contract. `web/src/main.ts` and `map.ts` build DOM directly, and
 * there is no jsdom in this project, so — like `admin/public/app.js` — they are
 * checked as source. These assertions cover behaviour that is easy to break by
 * accident and impossible to notice in a typecheck: freezing a scored round.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync("web/src/main.ts", "utf8");
const map = readFileSync("web/src/map.ts", "utf8");
const css = readFileSync("web/src/style.css", "utf8");

/** The body of a function declaration or object-method shorthand, by brace matching. */
function functionBody(source: string, name: string): string {
  // `function name(...) {` and `name(...) {` both match; an interface declaration
  // (`name(enabled: boolean): void;`) does not, because of the `;`.
  const match = new RegExp(`(?:function\\s+)?${name}\\([^)]*\\)[^{;]*\\{`).exec(source);
  if (!match) return "";
  const open = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

describe("scored rounds are frozen", () => {
  it("gates pin drops on an explicit flag, separately from zoom/pan", () => {
    // The click handler is the only place a pin can be dropped.
    expect(map).toMatch(/if \(!pickHandler \|\| !picking\) return;/);
    const allow = functionBody(map, "allowPicking");
    expect(allow).toContain("picking = enabled");
    // Turning picking off must not touch the view: zoom and pan are what the
    // player uses to inspect the answer after locking in.
    expect(allow).not.toMatch(/view\s*=/);
    expect(allow).not.toMatch(/zoomAt|panBy|clampView/);
  });

  it("freezes the slider, the pin and the button once the round is scored", () => {
    const lock = functionBody(main, "lockRound");
    expect(lock).toContain("locked = true");
    expect(lock).toContain("slider.disabled = true");
    expect(lock).toContain("worldMap.allowPicking(false)");
    expect(lock).toContain("submitButton.disabled = true");
    // Zoom and pan are deliberately NOT frozen — the reveal is for inspecting.
    expect(lock).not.toMatch(/zoomBy|resetView|view/);
  });

  it("locks the round before rendering the reveal, and cannot double-submit", () => {
    const submit = main.slice(main.indexOf("submitButton.addEventListener"));
    expect(submit.indexOf("submitGuess(")).toBeLessThan(submit.indexOf("lockRound()"));
    expect(submit.indexOf("if (locked) return;")).toBeGreaterThan(-1);
    expect(submit.indexOf("if (locked) return;")).toBeLessThan(submit.indexOf("submitGuess("));
  });

  it("re-enables picking for the next round, so the lock does not leak", () => {
    const round = functionBody(main, "renderRound");
    expect(round).toContain("worldMap.allowPicking(true)");
  });

  it("refuses a pin that arrives after the lock (belt and braces)", () => {
    const pick = main.slice(main.indexOf("worldMap.onPick("));
    expect(pick.slice(0, pick.indexOf("});"))).toContain("if (locked) return;");
  });

  it("tells the player what is still possible once frozen", () => {
    expect(functionBody(main, "lockRound")).toMatch(/zoom and pan/);
    expect(css).toMatch(/\.tl-slider:disabled/);
  });
});

describe("score labels", () => {
  it("names the three components in full", () => {
    expect(main).toContain('["Year Score", stored.temporal]');
    expect(main).toContain('["Map Score", stored.geographic]');
    expect(main).toContain('["Round Score", stored.total]');
  });

  it("leaves no bare component labels behind", () => {
    expect(main).not.toMatch(/\["Year",/);
    expect(main).not.toMatch(/\["Map",/);
    expect(main).not.toMatch(/\["Round",/);
  });
});
