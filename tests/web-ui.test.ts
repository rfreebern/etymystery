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

describe("the answer marker on the timeline", () => {
  it("is only drawn by the reveal, never during the round", () => {
    // It marks the answer: calling it while the player is still guessing would give
    // the round away, so the round-building code must never call it.
    expect(functionBody(main, "renderRound")).not.toContain("markAnswerYear(");
    expect(functionBody(main, "renderRound")).not.toContain("tl-answer");
    expect(functionBody(main, "markAnswerYear")).toContain('"tl-answer"');
    expect(functionBody(main, "renderReveal")).toContain("markAnswerYear(entry.year)");
  });

  it("is positioned with the same mapping the thumb uses", () => {
    const marker = functionBody(main, "markAnswerYear");
    expect(marker).toContain("yearPositionPct(year, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)");
    // Percentage of the track, so it survives a resize without recomputation.
    expect(marker).toMatch(/style\.left = `\$\{yearPositionPct\([^)]*\)\}%`/);
    // And it is appended to the track that wraps the slider — the same box the
    // tablet's geometry is measured against.
    expect(marker).toContain("timelineNodes.track.append(marker)");
    expect(functionBody(main, "renderRound")).toContain("track.append(slider)");
  });

  it("is layered in front of the thumb, which needs explicit stacking", () => {
    // A native range thumb paints with its input, so the marker must be a sibling
    // with a higher z-index; both get explicit z-indices so the order is not left
    // to paint order.
    expect(css).toMatch(/\.tl-track\s*\{[^}]*position: relative/);
    expect(css).toMatch(/\.tl-track \.tl-slider\s*\{[^}]*z-index: 1/);
    const marker = /\.tl-answer\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(marker).toContain("z-index: 2");
    expect(marker).toContain("position: absolute");
    expect(marker).toContain("var(--good)"); // green
    expect(marker).toContain("border-radius: 50%");
    // It sits over the thumb when the answer is inside the window, so it must not
    // intercept the drag.
    expect(marker).toContain("pointer-events: none");
  });
});

describe("the origin route line", () => {
  it("never reverses the chain for display", () => {
    // The bug this guards: `[...originChain].reverse()` printed the route backwards
    // ("English ← Latin ← Old French ← Middle English"), contradicting the blurb
    // and claiming the opposite derivation. The formatting module owns the order.
    expect(main).not.toMatch(/originChain\]?\s*\.reverse\(\)/);
    expect(main).toContain("routeParts(entry.originChain, entry.originLanguage)");
    expect(main).toContain("beyondNote(entry.originLanguage, route.beyond)");
  });

  it("marks which hop was asked about", () => {
    // The chain can continue past the answer, so the answer hop is picked out
    // rather than left as whatever happens to be last.
    expect(main).toContain('el("b", "hop-answer", hop)');
    expect(css).toMatch(/\.route \.hop-answer/);
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
