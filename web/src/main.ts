/**
 * Etymystery client: fetches the static bank + map, then drives the daily
 * round flow (guess year + drop pin -> reveal -> next -> summary).
 */

import { ROUNDS_PER_DAY, validateBank } from "../../src/bank";
import { dayIndexFor, getDailyPuzzle } from "../../src/daily";
import { feature } from "topojson-client";
import type { BankEntry, WordBank } from "../../src/types";
import { createGeocodeContext, toCountryFeatures } from "./geo-context";
import { createWorldMap, type WorldMap } from "./map";
import {
  currentRoundIndex,
  isComplete,
  loadSession,
  storageKey,
  submitGuess,
  summarize,
  type Session,
  type StoredGuess,
} from "./game";

const YEAR_MIN = 1500;
const YEAR_MAX = 2025;

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
    fetch("/word-bank.json").then((r) => r.json()),
    fetch("/countries-110m.json").then((r) => r.json()),
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
  let guess: StoredGuess = { year: 1800, point: null };

  function renderDayLabel(): void {
    document.getElementById("day-label")!.textContent =
      `Puzzle ${dayIndex + 1} of bank v${bank.version} — ${dateLabel(utcMs)} UTC`;
  }

  function renderRound(): void {
    const index = currentRoundIndex(session);
    worldMap.clearReveal();
    guess = { year: 1800, point: null };
    if (index === null) {
      renderSummary();
      return;
    }
    const entry = rounds[index]!;
    app.replaceChildren();

    const meta = el("div", "round-meta");
    meta.append(
      el("span", undefined, `Round ${index + 1} of ${ROUNDS_PER_DAY}`),
      el("span", undefined, `Difficulty ${entry.tier}/10`),
    );

    const wordPanel = el("div", "panel");
    wordPanel.append(
      meta,
      el("div", "word", entry.word.toUpperCase()),
      el("p", "prompt", "Where did this word originally come from — and when did English first use it?"),
    );

    const mapPanel = el("div", "panel");
    mapPanel.append(worldMap.svg);
    worldMap.onPick((lngLat) => {
      guess = { ...guess, point: { lat: lngLat[1], lng: lngLat[0] } };
      worldMap.setGuessPin(guess.point);
      submitButton.disabled = false;
    });

    const timeline = el("div", "panel timeline");
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(YEAR_MIN);
    slider.max = String(YEAR_MAX);
    slider.value = String(guess.year);
    const yearLabel = el("span", "year", String(guess.year));
    slider.addEventListener("input", () => {
      guess = { ...guess, year: Number(slider.value) };
      yearLabel.textContent = slider.value;
    });
    timeline.append(el("label", undefined, "First used in"), slider, yearLabel);

    const actions = el("div", "actions");
    const submitButton = el("button", undefined, "Lock it in") as HTMLButtonElement;
    submitButton.disabled = true; // requires a pin
    submitButton.addEventListener("click", () => {
      const stored = submitGuess(bank, session, index, guess, ctx, window.localStorage);
      renderReveal(entry, stored);
    });
    actions.append(submitButton);

    app.append(wordPanel, mapPanel, timeline, actions);
  }

  function renderReveal(entry: BankEntry, stored: NonNullable<Session["rounds"][number]>): void {
    worldMap.revealAnswer(entry, stored.guess.point);

    const panel = el("div", "panel");
    panel.append(el("div", "word", entry.word.toUpperCase()));

    const scores = el("div", "scores");
    const chips: Array<[string, number]> = [["Year", stored.temporal], ["Map", stored.geographic], ["Round", stored.total]];
    for (const [label, value] of chips) {
      const chip = el("div", "score-chip");
      chip.append(el("div", "value", String(value)), el("div", "label", label));
      scores.append(chip);
    }
    panel.append(scores, el("div", "credit-line", creditLabel(stored.credit)));
    panel.append(el("div", "route", `Route: English ← ${[...entry.originChain].reverse().join(" ← ")}`));
    panel.append(el("div", "route", `Answer: ${entry.originLanguage} · first used around ${entry.year}`));
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
