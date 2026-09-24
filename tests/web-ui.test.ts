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
const reveal = readFileSync("web/src/reveal.ts", "utf8");
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

/**
 * String literals in a source file, with comments stripped first. Lets the copy
 * rules ("no em dashes in the game's text") be checked without tripping over prose
 * in comments, which is where most em dashes in this repo legitimately live.
 */
function literals(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*/gm, " ")
    .replace(/[ \t]+\/\/[^\n]*$/gm, " ");
  return [...code.matchAll(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
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
    // The wording is device-appropriate (see tests/copy.test.ts); here it only has to
    // be the copied line, not the drag hint the round started with.
    expect(functionBody(main, "lockRound")).toContain("hints.locked");
    expect(functionBody(main, "lockRound")).not.toContain("hints.timeline");
    expect(css).toMatch(/\.tl-slider:disabled/);
  });
});

describe("the answer marker on the timeline", () => {
  it("is only drawn by the reveal, never during the round", () => {
    // It marks the answer: calling it while the player is still guessing would give
    // the round away, so the round-building code must never call it.
    expect(functionBody(main, "renderRound")).not.toContain("markAnswer(");
    expect(functionBody(main, "renderRound")).not.toContain("tl-answer");
    expect(functionBody(main, "markAnswer")).toContain('"tl-answer"');
    expect(functionBody(main, "renderReveal")).toContain("markAnswer(entry)");
  });

  it("is positioned with the same mapping the thumb uses", () => {
    const marker = functionBody(main, "markAnswer");
    expect(marker).toContain("yearPositionPct(span.from, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)");
    // Percentage of the track, so it survives a resize without recomputation.
    expect(marker).toMatch(/style\.left = `\$\{yearPositionPct\([^)]*\)\}%`/);
    // And it is appended to the track that wraps the slider — the same box the
    // tablet's geometry is measured against.
    expect(marker).toContain("timelineNodes.track.append(marker)");
    expect(functionBody(main, "renderRound")).toContain("track.append(slider)");
  });

  it("draws a coarse answer as a band across its span, not a false point", () => {
    // "in use by 1150" leaves 450 years open, so the marker is a band from the
    // record's floor to the bound, using the same geometry as the dot.
    const marker = functionBody(main, "markAnswer");
    expect(marker).toContain("spanBandPct(span, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)");
    expect(marker).toMatch(/style\.width = `\$\{band\.widthPct\}%`/);
    expect(marker).toContain('"tl-answer-band"');
    const band = /\.tl-answer-band\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(band).toContain("z-index: 2"); // in front of the thumb, as for the dot
    expect(band).toContain("var(--good)");
    expect(band).toContain("pointer-events: none");
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
    // Two shipped bugs live here. `[...originChain].reverse()` printed the route
    // backwards ("English ← Latin ← Old French ← Middle English"), and the arrow
    // must match the order: oldest-first pairs with `→`. The formatting module owns
    // both, so main.ts must not reorder or re-point anything itself.
    expect(main).not.toMatch(/originChain\]?\s*\.reverse\(\)/);
    expect(main).toContain("routeLine(entry.originChain, entry.originLanguage)");
    expect(main).toContain("beyondNote(entry.originLanguage, line.beyond)");
    expect(main).toContain('el("span", "route-arrow", ROUTE_ARROW)');
  });

  it("marks which hop was asked about", () => {
    // The chain can continue older than the answer, so the route picks the answer hop out
    // rather than leaving whatever happens to be first, and the headline names it as the
    // solution. Both read from the formatting module, not from a reordered array.
    expect(main).toContain('el("b", "hop-answer", hop)');
    expect(main).toContain('el("div", "solution-answer", entry.originLanguage)');
    expect(css).toMatch(/\.hop-answer\s*\{[^}]*var\(--accent\)/);
  });
});

describe("the reveal heading", () => {
  it("leads with the word, then the solution in much larger type", () => {
    expect(main).toContain('"reveal-word"');
    expect(main).toContain('"solution-answer"');
    // The word comes first in the DOM, the answer second.
    expect(main.indexOf('"reveal-word"')).toBeLessThan(main.indexOf('"solution-answer"'));
    const word = /\.reveal-word\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    const answer = /\.solution-answer\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(word).toMatch(/font-size: 19px/);
    expect(answer).toMatch(/font-size: clamp\(44px/);
    // The answer must actually be the larger of the two.
    expect(Number(/font-size: clamp\((\d+)/.exec(answer)![1])).toBeGreaterThan(
      Number(/font-size: (\d+)/.exec(word)![1]),
    );
  });

  it("drops the 'Answer:' prefix", () => {
    expect(main).not.toContain("Answer: ");
    // The wording lives in reveal.ts so the coarse/precise distinction is testable.
    expect(main).toContain("answerYearLabel(entry.year, entry.yearTo, period)");
    expect(literals(reveal).some((s) => s.includes("first used around"))).toBe(true);
  });

  it("says which kind of date the answer has, and why it was graded that way", () => {
    // A full score for an early window on an undated word reads as the game being
    // generous unless the reveal says the record is vague.
    expect(main).toContain("coarseSpanNote(entry.year, entry.yearTo, period)");
    expect(main).toContain("outsideSpanYears(answer, guessed.start, guessed.end)");
    expect(main).toContain("The answer's recorded span overlaps it");
  });
});

describe("the solution footer", () => {
  const reveal = functionBody(main, "renderReveal");

  it("stacks the answer, its date, the blurb and then the scores", () => {
    const at = (needle: string): number => reveal.indexOf(needle);
    for (const part of ['"solution-answer"', '"solution-date"', '"solution-blurb"']) {
      expect(at(part), part).toBeGreaterThan(-1);
    }
    expect(at('"solution-answer"')).toBeLessThan(at('"solution-date"'));
    expect(at('"solution-date"')).toBeLessThan(at('"solution-blurb"'));
    expect(at('"solution-blurb"')).toBeLessThan(at('const podium'));
  });

  it("puts the round score above the two scores it is made of", () => {
    // Reading order is round, year, map; the GRID is what makes it a podium, with the
    // round card in the middle column and the other two low in the outer ones.
    expect(reveal).toContain('card("Round Score", stored.total, "podium-card podium-main")');
    const podium = reveal.slice(
      reveal.indexOf('const podium = el("div", "podium")'),
      reveal.indexOf("solution.append(podium)"),
    );
    expect(podium.length, "the podium is built in one place").toBeGreaterThan(0);
    // The round card is placed in the grid's middle column, the two sides beside it ...
    expect(podium).toContain('card("Round Score", stored.total, "podium-card podium-main")');
    expect(podium).toContain("yearSide, mapSide");
    // ... and the sides are built year first, which is the reading order.
    expect(reveal.indexOf('card("Year Score"')).toBeLessThan(reveal.indexOf('card("Map Score"'));
    expect(css).toMatch(/\.podium-main\s*\{[^}]*grid-column: 2/);
    expect(css).toMatch(/\.podium-year\s*\{[^}]*grid-column: 1/);
    expect(css).toMatch(/\.podium-map\s*\{[^}]*grid-column: 3/);
    // The sides sit low, beside the round score rather than under it.
    expect(css).toMatch(/\.podium-side\s*\{[^}]*margin-top/);
  });

  it("keeps each note under the score it explains", () => {
    // The window note belongs to the year score and the credit line to the map score.
    // They used to be one centred line under the whole row, which read as if they
    // explained both.
    const yearSide = reveal.slice(
      reveal.indexOf('"podium-side podium-year"'),
      reveal.indexOf('"podium-side podium-map"'),
    );
    expect(yearSide).toContain("Your window: ");
    expect(reveal.slice(reveal.indexOf('"podium-side podium-map"'))).toContain(
      "creditLabel(stored.credit)",
    );
    // Both notes are the mock's italics, on the ink colour rather than grey.
    expect(css).toMatch(/\.podium-note\s*\{[^}]*font-style: italic/);
  });

  it("ends with the route, and stops being three columns on a phone", () => {
    expect(reveal.indexOf('el("div", "solution-route")')).toBeLessThan(
      reveal.indexOf('el("div", "actions")'),
    );
    expect(css).toMatch(/\.solution-route\s*\{[^}]*font-style: italic/);
    expect(css).toMatch(/\.route-arrow\s*\{[^}]*var\(--muted\)/);
    const mobile = css.slice(css.indexOf("@media (max-width: 640px)"));
    expect(mobile).toMatch(/\.podium \{[^}]*grid-template-columns/);
  });
});

describe("the game's copy", () => {
  it("uses no em dashes in user-visible strings", () => {
    // Requested: the reveal and round text should not lean on em dashes. Comments
    // may (this repo's prose is full of them), string literals may not.
    for (const [file, source] of [
      ["web/src/main.ts", main],
      ["web/src/reveal.ts", reveal],
    ] as const) {
      const offenders = literals(source).filter((literal) => literal.includes("—"));
      expect(offenders, `${file} strings containing an em dash`).toEqual([]);
    }
  });

  it("keeps the attributions line centred and subdued", () => {
    const footer = /\.about\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(footer).toContain("text-align: center");
    expect(footer).toMatch(/font-size: 12px/);
    expect(footer).toMatch(/opacity: 0\.6/);
    expect(css).toMatch(/\.about a\s*\{[^}]*color: inherit/);
  });
});

describe("touch and small screens", () => {
  it("pins the map with two fingers, and never mistakes a pinch for a pin drop", () => {
    // One pointer pans, two pinch: the gesture is read from the spread of the
    // pointers and applied through the shared view maths.
    expect(map).toContain("const pointers = new Map<number,");
    expect(map).toContain("pointers.size >= 2");
    expect(map).toContain("view = pinch(view, pinchSpan, span, WIDTH, HEIGHT)");
    expect(map).toContain("pinchSpan = spanOf()");
    // Lifting two fingers must not place a pin at the last touch.
    expect(map).toContain("A pinch must never be read as a pin drop");
    // The browser must not scroll or zoom the page instead of pinching the map.
    expect(map).toContain('svg.style.touchAction = "none"');
  });

  it("drops the era ruler on a phone, keeping the period names above the slider", () => {
    const start = css.indexOf("@media (max-width: 640px)");
    const mobile = start < 0 ? "" : css.slice(start, css.indexOf("\n}", start));
    expect(mobile).toContain(".timeline-scale { display: none; }");
    // `.tl-era` (the "Middle English · Early Modern" line) is NOT hidden: it is the
    // same information in words, and it stays on every screen size.
    expect(mobile).not.toContain(".tl-era");
  });

  it("never hard-codes mouse-only copy in the client", () => {
    // The client asks the copy module, so the device-specific wording lives in one
    // place and cannot be left behind on the desktop phrasing.
    expect(main).toContain("hintsFor(isTouchFirst())");
    for (const literal of ["scroll to zoom", "click to pin", "Zoom in (or scroll", "← → for 25-year steps"]) {
      expect(main, literal).not.toContain(literal);
    }
    for (const key of ["hints.map", "hints.zoomIn", "hints.timeline", "hints.locked"]) {
      expect(main, key).toContain(key);
    }
  });

  it("lifts the tablet thumb only in the touch layout", () => {
    // Desktop centres a custom thumb on the track; touching it up pushes it too high
    // (reported). The touch layout needs the nudge, so the default has to stay 0 and
    // the lift has to live behind the touch media query.
    const liftDefault = css.slice(css.indexOf(".tl-slider { --thumb-lift"), css.indexOf("}", css.indexOf(".tl-slider { --thumb-lift")));
    expect(liftDefault).toContain("--thumb-lift: 0");

    const touchStart = css.indexOf("(hover: none) and (pointer: coarse)");
    expect(touchStart).toBeGreaterThan(-1);
    const touchBlock = css.slice(touchStart, css.indexOf("\n}", touchStart));
    expect(touchBlock).toContain("--thumb-lift: -50%");

    const ruleFor = (selector: string): string => {
      const at = css.indexOf(selector);
      return at < 0 ? "" : css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
    };
    for (const selector of [".tl-slider::-webkit-slider-thumb", ".tl-slider::-moz-range-thumb"]) {
      expect(ruleFor(selector), selector).toContain("transform: translateY(var(--thumb-lift, 0))");
    }
  });

  it("leaves no bare component labels behind", () => {
    expect(main).not.toMatch(/\["Year",/);
    expect(main).not.toMatch(/\["Map",/);
    expect(main).not.toMatch(/\["Round",/);
  });
});

describe("the end-of-day summary", () => {
  it("breaks the day down round by round", () => {
    const summary = functionBody(main, "renderSummary");
    // Everything asked for: the word, its origin, its earliest attestation, both scores
    // and how far off the guess was.
    for (const header of ["Word", "Came from", "First use", "Time", "Map", "Missed by"]) {
      expect(summary).toContain(`"${header}"`);
    }
    expect(summary).toContain("dayRounds(bank, session)");
    expect(summary).toContain("entry.originLanguage");
    expect(summary).toContain("periodOfSpan(answer)?.label");
    expect(summary).toContain("score.yearsMissed ?? spanGapYears(" );
    expect(summary).toContain('el("td", "num", String(score.temporal))');
    expect(summary).toContain('el("td", "num", String(score.geographic))');
    // The two miss phrasings, so a perfect round and a far miss read differently.
    expect(summary).toContain('missed.push("in window")');
    expect(summary).toContain('missed.push("in country")');
    expect(summary).toContain('missed.push("no pin")');
    expect(summary).toContain("km off");
    expect(summary).toContain("y ${guess.end < answer.from ? \"early\" : \"late\"}");
  });

  it("shows the share as text AND copies it", () => {
    const summary = functionBody(main, "renderSummary");
    expect(summary).toContain("shareText({");
    expect(summary).toContain('el("pre", "share-text", text)');
    expect(summary).toContain("copyResult(text, pre)");
    // The clipboard write and its fallback live in the helper: a blocked clipboard must
    // still leave the text copyable by hand, which is the common case.
    const helper = functionBody(main, "copyResult");
    expect(helper).toContain("navigator.clipboard.writeText(text)");
    expect(helper).toContain("selectNodeContents(pre)");
    expect(helper).toContain("addRange(range)");
    // The button must be BELOW the text, which takes both an order and a layout: the
    // pre used to be inline-block, so the button rendered beside it instead.
    expect(summary.indexOf('el("pre", "share-text", text)')).toBeLessThan(
      summary.indexOf('"Copy result"'),
    );
    expect(summary.indexOf('"Copy result"')).toBeLessThan(summary.indexOf('shareBlock.append'));
    expect(css).toMatch(/\.share\s*\{[^}]*flex-direction: column/);
    expect(css).toMatch(/\.share-text\s*\{[^}]*display: block/);
  });

  it("colours each round by the band its score falls in", () => {
    const summary = functionBody(main, "renderSummary");
    expect(summary).toContain("scoreBand(score.total)");
    expect(summary).toContain("scoreEmoji(score.total)");
    // The band is on the element, so the square can be styled and read out.
    expect(summary).toContain("`squares ${band}`");
    expect(css).toMatch(/\.summary-table/);
    expect(css).toMatch(/\.share-text\s*\{[^}]*white-space: pre/);

  });
});
