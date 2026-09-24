/**
 * Etymystery client: fetches the static bank + map, then drives the daily
 * round flow (guess year + drop pin -> reveal -> next -> summary).
 */

import { ROUNDS_PER_DAY, validateBank } from "../../src/bank";
import { dayIndexFor, getDailyPuzzle } from "../../src/daily";
import { answerSpan } from "../../src/scoring";
import {
  ANSWER_YEAR_MAX,
  ANSWER_YEAR_MIN,
  periodOfSpan,
  sliderStartBounds,
} from "../../src/timeline";
import { feature } from "topojson-client";
import type { BankEntry, WordBank } from "../../src/types";
import { createGeocodeContext, toCountryFeatures } from "./geo-context";
import { createWorldMap, type WorldMap } from "./map";
import {
  eraSegments,
  outsideSpanYears,
  rangeEraLabel,
  rangeLabel,
  spanBandPct,
  tabletWidthPx,
  yearPositionPct,
} from "./slider";
import { ROUTE_ARROW, answerYearLabel, beyondNote, coarseSpanNote, routeLine } from "./reveal";
import { ZOOM_STEP } from "./view";
import { hintsFor, isTouchFirst } from "./copy";
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

/** Hints phrased for how this device is driven: mouse-and-keyboard, or touch. */
const hints = hintsFor(isTouchFirst());

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function creditLabel(credit: string): string {
  switch (credit) {
    case "country": return "Direct hit: right country!";
    case "intermediate": return "On the route: an intermediate stop!";
    case "subregion": return "Right subregion, but not the origin.";
    case "continent": return "Right continent, but not the origin.";
    case "proximity": return "Warm, but not the origin.";
    default: return "Cold. Nowhere near the origin.";
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
    fetch("countries-50m.json").then((r) => r.json()),
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
    app.replaceChildren(el("div", "panel", "This word bank is exhausted. A new curation batch is needed. Come back soon!"));
    return;
  }

  const session = loadSession(bank, utcMs, window.localStorage);
  const worldMap = createWorldMap(app, features);
  // The player picks a 100-year window; 1800–1900 is an arbitrary, neutral start.
  let guess: StoredGuess = { yearStart: 1800, yearEnd: 1900, point: null };

  function renderDayLabel(): void {
    document.getElementById("day-label")!.textContent =
      `Puzzle ${dayIndex + 1} of bank v${bank.version} · ${dateLabel(utcMs)} UTC`;
  }

  /** Timeline nodes for the round on screen, so the reveal can mark the answer. */
  let timelineNodes: { track: HTMLElement } | null = null;

  /**
   * Mark the answer on the timeline: a dot on the year for a precisely dated word,
   * a band across the span for a coarse one ("in use by 1150" covers 700..1150).
   * Called from the reveal ONLY: the marker is the answer, so showing it any
   * earlier would give the round away.
   */
  function markAnswer(entry: BankEntry): void {
    if (!timelineNodes) return;
    const span = answerSpan(entry);
    if (span.to > span.from) {
      const band = spanBandPct(span, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX);
      const marker = el("div", "tl-answer-band");
      marker.style.left = `${band.leftPct}%`;
      marker.style.width = `${band.widthPct}%`;
      marker.title = `recorded somewhere between ${span.from} and ${span.to}`;
      timelineNodes.track.append(marker);
      return;
    }
    const marker = el("div", "tl-answer");
    marker.style.left = `${yearPositionPct(span.from, ANSWER_YEAR_MIN, ANSWER_YEAR_MAX)}%`;
    marker.title = `${span.from}: the year English first used it`;
    timelineNodes.track.append(marker);
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
        `Where did this ${entry.pos ?? "word"} originally come from, and when did English first use it?`,
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
      tool("+", hints.zoomIn, () => worldMap.zoomBy(ZOOM_STEP)),
      tool("−", hints.zoomOut, () => worldMap.zoomBy(1 / ZOOM_STEP)),
      tool("Reset", hints.reset, () => worldMap.resetView()),
      el("span", "map-hint", hints.map),
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

    const track = el("div", "tl-track");
    track.append(slider);

    const hint = el("div", "tl-hint", hints.timeline);
    timeline.append(
      el("label", undefined, `First used in this ${bounds.span}-year window`),
      head,
      track,
      scale,
      hint,
    );
    // The reveal needs to reach the track to mark the answer year on it.
    timelineNodes = { track };

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
      hint.textContent = hints.locked;
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
    // Heading: the word in medium type, then the answer in larger type, because the
    // answer is what the round was actually about.
    panel.append(
      el(
        "div",
        "reveal-word",
        entry.pos ? `${entry.word.toUpperCase()} (${entry.pos})` : entry.word.toUpperCase(),
      ),
    );
    const answerLine = el("div", "reveal-answer");
    answerLine.append(el("b", "hop-answer", entry.originLanguage));
    // A span that covers a whole period exactly is named as that period: it is what
    // the record actually says, and better reading than two bare years.
    const period = periodOfSpan(answerSpan(entry))?.label;
    answerLine.append(
      document.createTextNode(` · ${answerYearLabel(entry.year, entry.yearTo, period)}`),
    );
    panel.append(answerLine);

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

    // The route reads oldest-first and ends at English (`English reads left to
    // right`), with the hop the player was asked about picked out — the chain can
    // extend older than it.
    const line = routeLine(entry.originChain, entry.originLanguage);
    const routeEl = el("div", "route");
    routeEl.append(document.createTextNode("Route: "));
    line.hops.forEach((hop, i) => {
      if (i > 0) routeEl.append(document.createTextNode(ROUTE_ARROW));
      routeEl.append(
        hop === entry.originLanguage ? el("b", "hop-answer", hop) : document.createTextNode(hop),
      );
    });
    panel.append(routeEl);
    const older = beyondNote(entry.originLanguage, line.beyond);
    if (older) panel.append(el("div", "route beyond-note", older));

    // Say plainly whether the window caught the answer: it is the whole temporal
    // mechanic, and the only feedback that teaches where to place it. A coarse
    // answer is a span, so any overlap is a hit.
    const guessed = guessRange(stored.guess);
    const answer = answerSpan(entry);
    const missed = outsideSpanYears(answer, guessed.start, guessed.end);
    const coarse = answer.to > answer.from;
    panel.append(
      el(
        "div",
        "route",
        `Your window: ${rangeLabel(guessed.start, guessed.end)}. ${
          missed === 0
            ? coarse
              ? "The answer's recorded span overlaps it ✓"
              : "The answer is inside it ✓"
            : `The answer fell ${missed} year${missed === 1 ? "" : "s"} outside it.`
        }`,
      ),
    );
    // Explain the grading for an undated word, or a full score for an early window
    // reads as the game being generous rather than the record being vague.
    const spanNote = coarseSpanNote(entry.year, entry.yearTo, period);
    if (spanNote) panel.append(el("div", "beyond-note", spanNote));
    panel.append(el("p", "prompt", entry.blurb));
    // The answer's own span, on the timeline the player just used, is the clearest
    // possible statement of how close the window was.
    markAnswer(entry);

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
    panel.append(scores, el("p", "prompt", `${dateLabel(utcMs)} · solved ${summary.played} of ${ROUNDS_PER_DAY}.`));

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
