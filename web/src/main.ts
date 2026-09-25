/**
 * Etymystery client: fetches the static bank + map, then drives the daily
 * round flow (guess year + drop pin -> reveal -> next -> summary).
 */

import { ROUNDS_PER_DAY, TIER_COUNT, validateBank } from "../../src/bank";
import { dayIndexFor, getDailyPuzzle, totalPuzzles } from "../../src/daily";
import { answerSpan, spanGapYears } from "../../src/scoring";
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
import { TURNOVER_LABEL, countdownLabel } from "./countdown";
import { scoreBand, scoreEmoji, shareText } from "./share";
import { ZOOM_STEP } from "./view";
import { hintsFor, isTouchFirst } from "./copy";
import {
  currentDraft,
  currentRoundIndex,
  dayRounds,
  guessRange,
  isComplete,
  loadSession,
  saveDraft,
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
  /** Pending draft write; kept here so a new round can cancel the previous one's. */
  let draftTimer: number | undefined;
  /**
   * Persist the round in progress, at most once per pause: a slider drag fires dozens of
   * input events, and only the last one describes where the player stopped. `submitGuess`
   * retires the draft, so a pending write is cancelled whenever a round is locked in.
   */
  function saveDraftSoon(): void {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => saveDraft(session, guess, window.localStorage), 250);
  }


  /** The top bar: which puzzle this is, and the clock to the next one. */
  function renderDayLabel(): void {
    document.getElementById("puzzle-line")!.textContent =
      `Puzzle ${dayIndex + 1} of ${totalPuzzles(bank)} · ${dateLabel(utcMs)} UTC`;
  }

  /** Set once the day is finished, so a turnover has no round in progress to lose. */
  let dayFinished = false;
  /** Set once the page has noticed the day turn over while it was open. */
  let turnOverPending = false;

  /**
   * The top bar's clock, one second at a time.
   *
   * The countdown is not decoration: midnight UTC is the moment `dayIndexFor` advances, and
   * the page has to notice. Reloading the instant it turns would yank a half-played round
   * from under the player (the guess on screen is not stored until it is scored), so a
   * turnover during play waits instead: the line says a new puzzle is ready, and
   * `renderSummary` reloads once the day is finished. A player who is already done is
   * reloaded straight away, which is the case the countdown is really for.
   */
  function tickCountdown(): void {
    const now = Date.now();
    const label = document.getElementById("countdown");
    if (!label) return;
    if (Math.max(0, dayIndexFor(bank, now)) === dayIndex) {
      label.textContent = countdownLabel(now);
      return;
    }
    turnOverPending = true;
    if (dayFinished) {
      window.location.reload();
      return;
    }
    label.textContent = TURNOVER_LABEL;
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
    // carry an accidental hint (or a wrong idea) into the next word. A draft of THIS
    // round is the exception - it is what the player already chose here.
    window.clearTimeout(draftTimer);
    guess = currentDraft(session) ?? { yearStart: 1800, yearEnd: 1900, point: null };
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
      el("span", undefined, `Difficulty ${entry.tier}/${TIER_COUNT}`),
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
      saveDraftSoon();
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
    slider.addEventListener("input", () => {
      setWindow(Number(slider.value));
      saveDraftSoon();
    });

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
      window.clearTimeout(draftTimer);
      const stored = submitGuess(bank, session, index, guess, ctx, window.localStorage);
      lockRound();
      renderReveal(entry, stored);
    });
    actions.append(submitButton);

    // A restored draft: the pin the player had dropped before the reload, and the lock
    // button it had already earned. The window is already back (the slider starts from
    // `guess`), so this only has the map to catch up on.
    if (guess.point) {
      worldMap.setGuessPin(guess.point);
      submitButton.disabled = false;
    }

    app.append(wordPanel, mapPanel, timeline, actions);
    sizeTablet();
  }

  function renderReveal(entry: BankEntry, stored: NonNullable<Session["rounds"][number]>): void {
    worldMap.revealAnswer(entry, stored.guess.point);

    const panel = el("div", "panel");
    // Heading: the word in medium type, then the solution below it, because the answer
    // is what the round was actually about.
    panel.append(
      el(
        "div",
        "reveal-word",
        entry.pos ? `${entry.word.toUpperCase()} (${entry.pos})` : entry.word.toUpperCase(),
      ),
    );

    // The solution footer: the answer as the headline, then the scores as a podium (the
    // round score centred above the two it is made of), each score carrying the note that
    // explains it, and the route underneath.
    const solution = el("div", "solution");
    solution.append(el("div", "solution-answer", entry.originLanguage));
    // A span that covers a whole period exactly is named as that period: it is what
    // the record actually says, and better reading than two bare years.
    const period = periodOfSpan(answerSpan(entry))?.label;
    solution.append(el("div", "solution-date", answerYearLabel(entry.year, entry.yearTo, period)));
    solution.append(el("p", "solution-blurb", entry.blurb));
    // Explain the grading for an undated word, or a full score for an early window
    // reads as the game being generous rather than the record being vague.
    const spanNote = coarseSpanNote(entry.year, entry.yearTo, period);
    if (spanNote) solution.append(el("p", "solution-note", spanNote));

    const card = (label: string, value: number, className = "podium-card"): HTMLElement => {
      const node = el("div", className);
      node.append(el("div", "value", String(value)), el("div", "label", label));
      return node;
    };

    // Say plainly whether the window caught the answer: it is the whole temporal
    // mechanic, and the only feedback that teaches where to place it. A coarse
    // answer is a span, so any overlap is a hit.
    const guessed = guessRange(stored.guess);
    const answer = answerSpan(entry);
    const missed = outsideSpanYears(answer, guessed.start, guessed.end);
    const coarse = answer.to > answer.from;
    const yearSide = el("div", "podium-side podium-year");
    yearSide.append(card("Year Score", stored.temporal));
    yearSide.append(
      el(
        "p",
        "podium-note",
        `Your window: ${rangeLabel(guessed.start, guessed.end)}. ${
          missed === 0
            ? coarse
              ? "The answer's recorded span overlaps it ✓"
              : "The answer is inside it ✓"
            : `The answer fell ${missed} year${missed === 1 ? "" : "s"} outside it.`
        }`,
      ),
    );
    const mapSide = el("div", "podium-side podium-map");
    mapSide.append(card("Map Score", stored.geographic));
    mapSide.append(el("p", "podium-note", creditLabel(stored.credit)));

    const podium = el("div", "podium");
    podium.append(card("Round Score", stored.total, "podium-card podium-main"), yearSide, mapSide);
    solution.append(podium);

    // The route reads oldest-first and ends at English (`English reads left to
    // right`), with the hop the player was asked about picked out — the chain can
    // extend older than it.
    const line = routeLine(entry.originChain, entry.originLanguage);
    const routeEl = el("div", "solution-route");
    routeEl.append(document.createTextNode("Route: "));
    line.hops.forEach((hop, i) => {
      if (i > 0) routeEl.append(el("span", "route-arrow", ROUTE_ARROW));
      routeEl.append(
        hop === entry.originLanguage
          ? el("b", "hop-answer", hop)
          : el("span", "route-hop", hop),
      );
    });
    solution.append(routeEl);
    const older = beyondNote(entry.originLanguage, line.beyond);
    if (older) solution.append(el("div", "beyond-note", older));
    panel.append(solution);

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

  /**
   * Copy the share text, or leave it selected when the clipboard is unavailable (older
   * browsers, or a page without the permission). Returns what to tell the player.
   */
  async function copyResult(text: string, pre: HTMLElement): Promise<string> {
    try {
      await navigator.clipboard.writeText(text);
      return "copied to the clipboard";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return "selected: press Ctrl or Cmd and C to copy";
    }
  }

  function renderSummary(): void {
    const summary = summarize(session);
    app.replaceChildren();
    // No round is in progress from here, so a turnover may reload the page.
    dayFinished = true;

    const panel = el("div", "panel");
    panel.append(el("div", "total-line", `${summary.total} / 100`));
    const scores = el("div", "scores");
    for (const [label, value] of [["Year avg", summary.temporal], ["Map avg", summary.geographic]] as const) {
      const chip = el("div", "score-chip");
      chip.append(el("div", "value", String(value)), el("div", "label", label));
      scores.append(chip);
    }
    panel.append(scores, el("p", "prompt", `${dateLabel(utcMs)} · solved ${summary.played} of ${ROUNDS_PER_DAY}.`));

    // What each round was about, how it scored, and how far off it was. The miss is the
    // number a player can actually learn from: a score says how the game judged it, the
    // miss says how close it was.
    const table = el("table", "summary-table");
    const head = el("tr");
    for (const label of ["", "#", "Word", "Came from", "First use", "Time", "Map", "Missed by"]) {
      head.append(el("th", undefined, label));
    }
    table.append(head);
    for (const row of dayRounds(bank, session)) {
      const { entry, guess, score } = row;
      const answer = answerSpan(entry);
      const period = periodOfSpan(answer)?.label;
      const years = score.yearsMissed ?? spanGapYears(answer, guess.start, guess.end);
      const tr = el("tr");
      const band = scoreBand(score.total);
      const square = el("span", `squares ${band}`, scoreEmoji(score.total));
      square.title = `${band}: ${score.total}/100`;
      const emojiCell = el("td", "sum-emoji");
      emojiCell.append(square);
      tr.append(emojiCell);
      tr.append(el("td", "sum-index", String(row.index + 1)));
      tr.append(
        el("td", "sum-word", entry.pos ? `${entry.word} (${entry.pos})` : entry.word),
      );
      tr.append(el("td", "sum-answer", entry.originLanguage));
      tr.append(
        el(
          "td",
          "sum-date",
          period
            ? `${period} (${answer.from} – ${answer.to})`
            : answer.from === answer.to
              ? `around ${answer.from}`
              : `${answer.from} – ${answer.to}`,
        ),
      );
      tr.append(el("td", "num", String(score.temporal)));
      tr.append(el("td", "num", String(score.geographic)));
      const missed: string[] = [];
      if (years === 0) missed.push("in window");
      else missed.push(`${years} y ${guess.end < answer.from ? "early" : "late"}`);
      if (score.kmMissed == null) missed.push("no pin");
      else if (score.kmMissed === 0) missed.push("in country");
      else missed.push(`${score.kmMissed.toLocaleString()} km off`);
      tr.append(el("td", "sum-missed", missed.join(" · ")));
      table.append(tr);
    }
    const wrap = el("div", "summary-wrap");
    wrap.append(table);
    panel.append(wrap);

    // The share lives in the DOM as text as well as on the clipboard: a blocked clipboard
    // is common, and a selected <pre> can always be copied by hand.
    const rows = dayRounds(bank, session);
    const text = shareText({
      date: dateLabel(utcMs),
      totals: rows.map((row) => row.score.total),
      average: summary.total,
      played: summary.played,
      rounds: ROUNDS_PER_DAY,
      url: `${window.location.origin}${window.location.pathname}`,
    });
    const shareBlock = el("div", "share");
    const pre = el("pre", "share-text", text);
    const copy = el("button", "secondary", "Copy result") as HTMLButtonElement;
    const copied = el("span", "muted", "");
    copy.addEventListener("click", () => {
      void copyResult(text, pre).then((message) => {
        copied.textContent = message;
      });
    });
    shareBlock.append(el("div", "share-title", "Share today's result"), pre, copy, copied);
    panel.append(shareBlock);

    // One outbound line, below everything: it is a suggestion, not part of the result.
    const more = el("p", "more-puzzles");
    const moreLink = el("a", undefined, "WordLadder") as HTMLAnchorElement;
    moreLink.href = "https://wordladder.fun";
    more.append(document.createTextNode("Looking for more daily word puzzles? Try "), moreLink);
    panel.append(more);

    app.append(panel);

    // The day turned over while this page was open and a round was still being played;
    // now that the day is finished, go and fetch the new puzzle.
    if (turnOverPending) window.location.reload();
  }

  renderDayLabel();
  tickCountdown();
  window.setInterval(tickCountdown, 1_000);
  renderRound();
}

boot().catch((err: unknown) => {
  console.error(err);
  app.replaceChildren(el("div", "panel", `Failed to load: ${err instanceof Error ? err.message : String(err)}`));
});
