/**
 * Etymystery client: fetches the static bank + map, then drives the daily
 * round flow (guess year + drop pin -> reveal -> next -> summary).
 */

import { ROUNDS_PER_DAY, validateBank } from "../../src/bank";
import { dayIndexFor, getDailyPuzzle } from "../../src/daily";
import { ANSWER_YEAR_MAX, ANSWER_YEAR_MIN, sliderStartBounds } from "../../src/timeline";
import { feature } from "topojson-client";
import type { BankEntry, WordBank } from "../../src/types";
import { createGeocodeContext, toCountryFeatures } from "./geo-context";
import { createWorldMap, type WorldMap } from "./map";
import {
  eraSegments,
  outsideYears,
  rangeEraLabel,
  rangeLabel,
  tabletWidthPx,
} from "./slider";
import { ZOOM_STEP } from "./view";
import {
  currentRoundIndex,
  guessRange,
  isComplete,
  loadSession,
  storageKey,
  submitGuess,
  summarize,
  type Session,
  type StoredGuess,
} from "./game";

const app = document.getElementById("app")!;

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function creditLabel(credit: string): string {
  switch (credit) {
    case "country": return "Direct hit — right country!";
    case "intermediate": return "On the route — an intermediate stop!";
    case "subregion": return "Right subregion!";
    case "continent": return "Right continent!";
    case "proximity": return "Warm — but not the origin.";
    default: return "Cold — nowhere near the origin.";
  }
}

function dateLabel(utcMs: number): string {
  return new Date(utcMs).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

async function boot(): Promise<void> {
  const [bankRaw, topoRaw] = await Promise.all([
    // Document-relative, not "/word-bank.json": the built site is served from a
    // subdirectory on GitHub Pages, where a root-anchored path would 404.
    fetch("word-bank.json").then((r) => r.json()),
    fetch("countries-110m.json").then((r) => r.json()),
  ]);
  const bank = bankRaw as WordBank;
  validateBank(bank);

  const collection = feature(
    topoRaw as never,
    (topoRaw as unknown as { objects: Record<string, never> }).objects.countries as never,
  ) as unknown as {
    features: Array<{ id?: string | number; properties?: { name?: string }; geometry: never }>;
  };
  const features = toCountryFeatures(collection.features);
  const ctx = createGeocodeContext({ features, languages: bank.languages });

  const utcMs = Date.now();
  const dayIndex = Math.max(0, dayIndexFor(bank, utcMs));
  let rounds: BankEntry[];
  try {
    rounds = getDailyPuzzle(bank, dayIndex);
  } catch {
    app.replaceChildren(el("div", "panel", "This word bank is exhausted — a new curation batch is needed. Come back soon!"));
    return;
  }

  const session = loadSession(bank, utcMs, window.localStorage);
  const worldMap = createWorldMap(app, features);
  // The player picks a 100-year window; 1800–1900 is an arbitrary, neutral start.
  let guess: StoredGuess = { yearStart: 1800, yearEnd: 1900, point: null };

  function renderDayLabel(): void {
    document.getElementById("day-label")!.textContent =
      `Puzzle ${dayIndex + 1} of bank v${bank.version} — ${dateLabel(utcMs)} UTC`;
  }

  function renderRound(): void {
    const index = currentRoundIndex(session);
    worldMap.clearReveal();
    // The previous round's lock must not leak into this one.
    worldMap.allowPicking(true);
    // A fresh window each round: keeping the previous round's placement would
    // carry an accidental hint (or a wrong idea) into the next word.
    guess = { yearStart: 1800, yearEnd: 1900, point: null };
    if (index === null) {
      renderSummary();
      return;
    }
    const entry = rounds[index]!;
    /** Set once this round is scored: its inputs stop responding (zoom/pan do not). */
    let locked = false;
    app.replaceChildren();

    const meta = el("div", "round-meta");
    meta.append(
      el("span", undefined, `Round ${index + 1} of ${ROUNDS_PER_DAY}`),
      el("span", undefined, `Difficulty ${entry.tier}/10`),
    );

    const wordPanel = el("div", "panel");
    // A homograph's senses have different origins, so the sense has to be on
    // screen: the answer is about this part of speech, not the word in general.
    const wordLabel = entry.pos ? `${entry.word.toUpperCase()} (${entry.pos})` : entry.word.toUpperCase();
    wordPanel.append(
      meta,
      el("div", "word", wordLabel),
      el(
        "p",
        "prompt",
        `Where did this ${entry.pos ?? "word"} originally come from — and when did English first use it?`,
      ),
    );

    const mapPanel = el("div", "panel map-panel");
    const mapTools = el("div", "map-tools");
    const tool = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
      const button = el("button", "map-tool", label) as HTMLButtonElement;
      button.title = title;
      button.type = "button";
      button.addEventListener("click", onClick);
      return button;
    };
    mapTools.append(
      tool("+", "Zoom in (or scroll / double-click the map)", () => worldMap.zoomBy(ZOOM_STEP)),
      tool("−", "Zoom out", () => worldMap.zoomBy(1 / ZOOM_STEP)),
      tool("Reset", "Fit the whole world again", () => worldMap.resetView()),
      el("span", "map-hint", "scroll to zoom · drag to pan · click to pin"),
    );
    mapPanel.append(worldMap.svg, mapTools);
    worldMap.onPick((lngLat) => {
      // Once the round is scored, moving the pin would misrepresent the score it
      // already earned — and the score is the thing being shown.
      if (locked) return;
      guess = { ...guess, point: { lat: lngLat[1], lng: lngLat[0] } };
      worldMap.setGuessPin(guess.point);
      submitButton.disabled = false;
    });

    const timeline = el("div", "panel timeline");
    const bounds = sliderStartBounds();
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "tl-slider";
    slider.min = String(bounds.min);
    slider.max = String(bounds.max);
    slider.step = String(bounds.step);
    slider.value = String(guess.yearStart);
    // Roving keyboard movement is native (arrows = one 25-year step).

    // Three rows, deliberately: the label gets its own full-width row, so growing
    // or shrinking text can never resize the slider mid-drag.
    const head = el("div", "tl-head");
    const rangeText = el("div", "tl-range", rangeLabel(guess.yearStart, guess.yearEnd));
    const eraText = el("div", "tl-era", rangeEraLabel(guess.yearStart, guess.yearEnd));
    head.append(rangeText, eraText);

    // The era scale is drawn from the same fractions the slider's thumb uses
    // (year / full window), absolutely positioned so it lines up exactly rather
    // than approximately.
    const scale = el("div", "timeline-scale");
    for (const segment of eraSegments(ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)) {
      const span = el("span", "era", segment.label);
      span.title = `${segment.label}: ${segment.from}–${segment.to}`;
      span.style.left = `${segment.leftPct}%`;
      span.style.width = `${segment.widthPct}%`;
      scale.append(span);
    }

    function setWindow(start: number): void {
      guess = { ...guess, yearStart: start, yearEnd: start + bounds.span };
      rangeText.textContent = rangeLabel(guess.yearStart, guess.yearEnd);
      eraText.textContent = rangeEraLabel(guess.yearStart, guess.yearEnd);
    }
    slider.addEventListener("input", () => setWindow(Number(slider.value)));

    // The tablet has to be as wide as the years it spans, so its width follows the
    // track: `trackWidth * span / windowYears` (see slider.ts for why that is the
    // value that keeps the thumb aligned with the scale).
    function sizeTablet(): void {
      const track = slider.clientWidth;
      if (track > 0) {
        slider.style.setProperty(
          "--tablet-w",
          `${tabletWidthPx(track, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)}px`,
        );
      }
    }
    window.addEventListener("resize", sizeTablet);

    const hint = el(
      "div",
      "tl-hint",
      "drag, or use ← → for 25-year steps · any answer inside the window scores full marks",
    );
    timeline.append(
      el("label", undefined, `First used in this ${bounds.span}-year window`),
      head,
      slider,
      scale,
      hint,
    );

    const actions = el("div", "actions");
    const submitButton = el("button", undefined, "Lock it in") as HTMLButtonElement;
    submitButton.disabled = true; // requires a pin

    /**
     * Freeze the round's inputs once it is scored. The score is already persisted,
     * so letting the pin or the window move afterwards would misrepresent it.
     * Zoom and pan stay live: inspecting the answer is the point of the reveal.
     */
    function lockRound(): void {
      locked = true;
      slider.disabled = true;
      worldMap.allowPicking(false);
      submitButton.disabled = true;
      submitButton.textContent = "Locked in";
      hint.textContent = "Locked in — zoom and pan the map to inspect the answer.";
    }

    submitButton.addEventListener("click", () => {
      if (locked) return;
      const stored = submitGuess(bank, session, index, guess, ctx, window.localStorage);
      lockRound();
      renderReveal(entry, stored);
    });
    actions.append(submitButton);

    app.append(wordPanel, mapPanel, timeline, actions);
    sizeTablet();
  }

  function renderReveal(entry: BankEntry, stored: NonNullable<Session["rounds"][number]>): void {
    worldMap.revealAnswer(entry, stored.guess.point);

    const panel = el("div", "panel");
    panel.append(el("div", "word", entry.pos ? `${entry.word.toUpperCase()} (${entry.pos})` : entry.word.toUpperCase()));

    const scores = el("div", "scores");
    const chips: Array<[string, number]> = [
      ["Year Score", stored.temporal],
      ["Map Score", stored.geographic],
      ["Round Score", stored.total],
    ];
    for (const [label, value] of chips) {
      const chip = el("div", "score-chip");
      chip.append(el("div", "value", String(value)), el("div", "label", label));
      scores.append(chip);
    }
    panel.append(scores, el("div", "credit-line", creditLabel(stored.credit)));
    panel.append(el("div", "route", `Route: English ← ${[...entry.originChain].reverse().join(" ← ")}`));
    panel.append(el("div", "route", `Answer: ${entry.originLanguage} · first used around ${entry.year}`));
    // Say plainly whether the window caught the year — it is the whole temporal
    // mechanic, and the only feedback that teaches where to place it.
    const guessed = guessRange(stored.guess);
    const missed = outsideYears(entry.year, guessed.start, guessed.end);
    panel.append(
      el(
        "div",
        "route",
        `Your window: ${rangeLabel(guessed.start, guessed.end)} — ${
          missed === 0
            ? "the answer is inside it ✓"
            : `the answer fell ${missed} year${missed === 1 ? "" : "s"} outside it`
        }`,
      ),
    );
    panel.append(el("p", "prompt", entry.blurb));

    const actions = el("div", "actions");
    const next = el("button", undefined, isComplete(session) ? "See results" : "Next word");
    next.addEventListener("click", renderRound);
    actions.append(next);
    panel.append(actions);
    app.append(panel);
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderSummary(): void {
    const summary = summarize(session);
    app.replaceChildren();

    const panel = el("div", "panel");
    panel.append(el("div", "total-line", `${summary.total} / 100`));
    const scores = el("div", "scores");
    for (const [label, value] of [["Year avg", summary.temporal], ["Map avg", summary.geographic]] as const) {
      const chip = el("div", "score-chip");
      chip.append(el("div", "value", String(value)), el("div", "label", label));
      scores.append(chip);
    }
    panel.append(scores, el("p", "prompt", `${dateLabel(utcMs)} — solved ${summary.played} of ${ROUNDS_PER_DAY}.`));

    const grid = el("div", "rounds-grid");
    rounds.forEach((entry, i) => {
      const stored = session.rounds[i]!;
      const cell = el("div", "round-cell");
      cell.append(el("span", undefined, `${i + 1}. ${entry.word}`), el("span", undefined, String(stored.total)));
      grid.append(cell);
    });
    panel.append(grid);

    const actions = el("div", "actions");
    const reset = el("button", "secondary", "Clear today's session") as HTMLButtonElement;
    reset.addEventListener("click", () => {
      window.localStorage.removeItem(storageKey(bank.version, session.dayIndex));
      window.location.reload();
    });
    actions.append(reset);
    panel.append(actions);
    app.append(panel);
  }

  renderDayLabel();
  renderRound();
}

boot().catch((err: unknown) => {
  console.error(err);
  app.replaceChildren(el("div", "panel", `Failed to load: ${err instanceof Error ? err.message : String(err)}`));
});
