/**
 * Curation admin client: vanilla JS, no build step.
 *
 * Left: the word, its proposed chain, and the three curated fields.
 * Right: every reference source for that word — embedded where the site allows
 * it (see admin/sources.ts), linked where it does not.
 */

const el = (id) => document.getElementById(id);
// The timeline window is whatever the server reports (src/timeline.ts), so the
// app can never disagree with what the game can score.
let yearFloor = 0;
let yearCeiling = 0;

// Source frames are rendered at `zoom` (their viewport is made 1/zoom larger and
// then scaled down), so 80% fits noticeably more of a page on screen.
const FRAME_HEIGHT = 460;
const ZOOM_STEPS = [0.6, 0.7, 0.8, 0.9, 1];
const ZOOM_KEY = "etymystery-admin-zoom";
let zoom = Number(localStorage.getItem(ZOOM_KEY)) || 0.8;

let state = null;
let sources = [];
let dirty = false;
let stacked = true;
let activeSource = 0;

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
  return payload;
}

function status(message, isError = false) {
  el("status").textContent = message;
  el("status").className = isError ? "status error" : "status";
  if (message) {
    setTimeout(() => {
      if (el("status").textContent === message) el("status").textContent = "";
    }, 4000);
  }
}

/** Same decay envelope as scoreTemporal, for instant feedback on a year. */
function bestPossibleTemporal(year) {
  const nearest = year < yearFloor ? yearFloor : year > yearCeiling ? yearCeiling : year;
  const over = Math.max(0, Math.abs(year - nearest) - 50);
  return Math.round(100 * Math.exp(-over / 100));
}

function current() {
  return state && state.queue[state.index];
}

function issuesFor(word) {
  return (state.issues || []).filter((issue) => issue.word === word).map((issue) => issue.problem);
}

/**
 * The recorded route for an origin, as the server computed it (with the span it
 * implies). The client holds no era table of its own: `src/timeline.ts` owns that,
 * and a second copy here would drift from it.
 */
function routeFor(origin) {
  return (current()?.routes || []).find((route) => route.origin === origin);
}

async function load(index = 0) {
  state = await api(`/api/state?index=${index}`);
  yearFloor = state.yearFloor;
  yearCeiling = state.yearCeiling;
  render();
  await loadSources();
}

async function loadSources() {
  const item = current();
  if (!item) return;
  sources = await api(`/api/sources?word=${encodeURIComponent(item.word)}`);
  renderSources();
}

function readForm() {
  const item = current();
  const chosen = document.querySelector('input[name="origin"]:checked');
  return {
    sense: item.sense,
    word: item.word,
    year: Number(el("year").value),
    // Blank means "precisely dated": the answer is the year above on its own.
    yearTo: el("year-to").value === "" ? undefined : Number(el("year-to").value),
    tier: Number(document.querySelector(".tiers button.active")?.dataset.tier || item.tier),
    blurb: el("blurb").value,
    pos: el("pos")?.value ?? "",
    // Several routes and no pick: send nothing and let save() insist.
    origin: chosen ? chosen.value : item.origins.length > 1 ? "" : item.origin,
    unverified: !el("verified").checked,
    index: state.index,
  };
}

async function save({ advance = false } = {}) {
  const form = readForm();
  if (!Number.isFinite(form.year) || form.year <= 0) {
    status("enter a year first", true);
    el("year").focus();
    return;
  }
  if (current().origins.length > 1 && !form.origin) {
    status(`pick which origin ${form.word} came from first`, true);
    document.querySelector('input[name="origin"]')?.focus();
    return;
  }
  try {
    state = await api("/api/entry", form);
    dirty = false;
    const target = advance ? Math.min(state.index + 1, state.queue.length - 1) : state.index;
    state = await api(`/api/state?index=${target}`);
    render();
    await loadSources();
    status(`saved ${form.word} (${form.year})`);
  } catch (err) {
    status(err.message, true);
  }
}

function render() {
  const item = current();
  const done = state.queue.filter((q) => q.year > 0).length;
  el("progress").textContent =
    `word ${state.index + 1}/${state.queue.length} · ${done} researched · ` +
    `${state.curatedCount} of ${state.worklistCount} candidates curated`;

  if (!item) {
    el("left").innerHTML = "<p>Batch is empty — use “Pull next batch”.</p>";
    el("right").innerHTML = "";
    return;
  }

  const problems = issuesFor(item.word);
  const pct = Math.round((done / Math.max(1, state.queue.length)) * 100);
  const chainHtml = item.chain.length
    ? item.chain.map((hop) => `<span class="hop">${hop}</span>`).join('<span class="arrow">←</span>')
    : '<span class="muted">no chain in the work list</span>';
  const tierButtons = Array.from({ length: state.tierCount }, (_, i) => i + 1)
    .map((t) => `<button data-tier="${t}" class="${t === item.tier ? "active" : ""}">${t}</button>`)
    .join("");

  el("left").innerHTML = `
    <div class="progress-bar"><div style="width:${pct}%"></div></div>
    <h1 class="word">${item.word}</h1>
    <div class="chain">${chainHtml}</div>
    <div class="answer">this sense: <b>${item.origin || "?"}</b>${
      item.frequencyRank ? ` · frequency rank ${item.frequencyRank}` : " · unranked (rare)"
    }${item.chainDepth ? ` · ${item.chainDepth} hop${item.chainDepth === 1 ? "" : "s"}` : ""}</div>
    ${problems.length ? `<div class="issue">⚠ ${problems.join("; ")}</div>` : ""}
    ${
      item.origins.length > 1
        ? `<div class="field">
      <label>Origin — the routes disagree, pick the one this sense came from</label>
      <div class="origins">
        ${item.origins
          .map(
            (origin) =>
              `<label class="origin-option"><input type="radio" name="origin" value="${origin}"${
                origin === item.origin ? " checked" : ""
              } /> ${origin}${
                routeFor(origin)?.period ? ` <span class="muted">· ${routeFor(origin).period}</span>` : ""
              }</label>`,
          )
          .join("")}
      </div>
      <div class="muted">${item.origins.length} recorded origins for ${item.word}. Leaving this unpicked
        makes the build fall back to a tie-break guess, so it has to be chosen.${
          item.routes.some((route) => route.period)
            ? " If a route names an English period, picking it fills the span in for you."
            : ""
        }</div>
    </div>`
        : ""
    }
    ${
      item.senses.length
        ? `<div class="field">
      <label>Senses (Wiktionary) — click one to take its part of speech and route</label>
      <div class="senses">
        ${item.senses
          .map((sense, i) => {
            // A sense whose donor matches a recorded route is a free answer: the click
            // picks the origin too, which is the decision that was blocking homographs.
            const route = item.routes.find((r) => sense.donors.includes(r.origin));
            return `<button type="button" class="sense" data-sense="${i}">
              <span class="sense-pos">${sense.pos}</span>
              <span class="sense-gloss">${sense.gloss}</span>
              <span class="sense-meta">${sense.etymology}${route ? ` · ${route.origin}` : ""}${
                sense.donors.length ? ` · ${sense.donors.slice(0, 3).join(", ")}` : ""
              }</span>
            </button>`;
          })
          .join("")}
      </div>
      <div class="muted">${item.senses.length} senses on Wiktionary. Two senses of one part of
        speech differ by etymology and gloss, which is how you tell them apart.</div>
    </div>`
        : ""
    }
    <div class="field">
      <label for="year">Year English first used it</label>
      <div class="row">
        <input id="year" type="number" min="0" max="2200" step="1"
          value="${item.year > 0 ? item.year : ""}" placeholder="e.g. 1590" />
        <span class="muted">${item.year > 0 ? "" : "not saved until a year is entered"}</span>
      </div>
      <div id="year-warn" class="warn" hidden></div>
    </div>
    <div class="field">
      <label for="year-to">Only dated as “in use by” a year? Put that year here</label>
      <div class="row">
        <input id="year-to" type="number" min="0" max="2200" step="1"
          value="${item.yearTo > 0 ? item.yearTo : ""}" placeholder="e.g. 1150" />
        <span class="muted">${
          item.yearTo > 0
            ? `a span: any window touching ${item.year} – ${item.yearTo} scores full marks`
            : "leave blank for a precise date"
        }</span>
      </div>
      <div class="muted">For words the references only date by period (“recorded in Old English”,
        “before 1150”): put the earliest year the record allows above and the bound here. Never
        invent a point: a guessed year would make the player's score depend on our coin flip.</div>
    </div>
    <div class="field">
      <label for="pos">Part of speech</label>
      <div class="row">
        <input id="pos" list="pos-options" value="${item.pos}" placeholder="noun · verb · adjective · adverb" />
        <span class="muted">files as <code id="key-preview">${item.pos ? `${item.word}:${item.pos}` : item.word}</code></span>
        <datalist id="pos-options">
          ${["noun", "verb", "adjective", "adverb", "pronoun", "preposition", "conjunction", "interjection", "numeral", "determiner", "phrase", "idiom"]
            .map((option) => `<option value="${option}"></option>`)
            .join("")}
        </datalist>
      </div>
    </div>
    <div class="field">
      <label>Tier (difficulty)</label>
      <div class="tiers">${tierButtons}</div>
    </div>
    <div class="field">
      <label for="verified">Provenance</label>
      <div class="row">
        ${
          item.yearSource === "chain-period"
            ? `<label class="verify"><input id="verified" type="checkbox" ${
                item.unverified ? "" : "checked"
              } /> I checked the chain this span comes from</label>
        <span class="muted">span taken from the period the chain records: no reference can
          narrow it, so there is no date to look up</span>`
            : `<label class="verify"><input id="verified" type="checkbox" ${
                item.unverified ? "" : "checked"
              } /> I checked this date against a reference</label>
        <span class="muted">${
          item.unverified ? "currently marked unverified: a drafted date" : "recorded as verified"
        }</span>`
        }
      </div>
    </div>
    <div class="field">
      <label for="blurb">Reveal blurb (optional)</label>
      <textarea id="blurb" placeholder="From Arabic qahwah, likely via Turkish kahve and Dutch koffie.">${item.blurb}</textarea>
    </div>
    <div class="row">
      <button id="save-next" class="primary">Save &amp; next<span class="kbd-hint">Enter</span></button>
      <button id="save">Save<span class="kbd-hint">⇧Enter</span></button>
      <button id="skip">Skip sense<span class="kbd-hint">s</span></button>
    </div>
    <div class="meta">
      sense id: <code>${item.sense}</code><br />
      files: <code>${state.paths.batch}</code> → <code>${state.paths.curation}</code><br />
      skipped so far: ${state.skipWords.length}
    </div>`;

  el("year").addEventListener("input", () => {
    dirty = true;
    const value = Number(el("year").value);
    const warn = el("year-warn");
    if (Number.isFinite(value) && value > 0 && (value < yearFloor || value > yearCeiling)) {
      warn.hidden = false;
      warn.textContent =
        `⚠ outside the slider window (${yearFloor}–${yearCeiling}): ` +
        `best possible temporal score ~${bestPossibleTemporal(value)}/100`;
    } else {
      warn.hidden = true;
    }
  });
  el("year").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void save({ advance: !event.shiftKey }); // Shift+Enter saves without moving on
    }
  });
  // Picking the sense fills the span its route implies: for a word no source dates,
  // the period IS the answer, and typing two years by hand is where mistakes creep in.
  document.querySelectorAll('input[name="origin"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      dirty = true;
      const route = routeFor(radio.value);
      if (!route?.period || Number(el("year").value) > 0) return;
      el("year").value = route.year;
      el("year-to").value = route.yearTo;
      status(`span from the chain: ${route.period} (${route.year} – ${route.yearTo})`);
    });
  });
  // One click per sense: the part of speech, and its route when the sense's own donor
  // is one of the recorded origins. That is the decision that held up the homographs —
  // 11,214 words with several recorded origins — and it is made from evidence rather
  // than guessed, so it is safe to take in one click.
  document.querySelectorAll("button.sense").forEach((button) => {
    button.addEventListener("click", () => {
      const sense = item.senses[Number(button.dataset.sense)];
      if (!sense) return;
      dirty = true;
      el("pos").value = sense.pos;
      el("key-preview").textContent = `${item.word}:${sense.pos}`;
      const radio = [...document.querySelectorAll('input[name="origin"]')].find(
        (candidate) => routeFor(candidate.value)?.origin === (item.routes.find((r) => sense.donors.includes(r.origin))?.origin ?? ""),
      );
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change"));
      }
      status(`sense: ${sense.pos} ${sense.etymology ? `(${sense.etymology})` : ""}`.trim());
    });
  });
  el("blurb").addEventListener("input", () => (dirty = true));
  el("pos").addEventListener("input", () => {
    dirty = true;
    // Show the sense key this will be filed under.
    const pos = el("pos").value.trim().toLowerCase();
    el("key-preview").textContent = pos ? `${item.word}:${pos}` : item.word;
  });
  document.querySelectorAll(".tiers button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tiers button").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      dirty = true;
    });
  });
  el("save-next").addEventListener("click", () => void save({ advance: true }));
  el("save").addEventListener("click", () => void save());
  el("skip").addEventListener("click", () => void skipCurrent());

  el("year").focus();
}

function renderSources() {
  const item = current();
  if (!item) return;

  const tabs = stacked
    ? ""
    : `<div class="tabs">${sources
        .map(
          (source, index) =>
            `<button data-source="${index}" class="${index === activeSource ? "active" : ""}">${source.label}</button>`,
        )
        .join("")}</div>`;

  const body = sources
    .map((source, index) => {
      if (!stacked && index !== activeSource) return "";
      const head = `<header>
          <strong>${index + 1}. ${source.label}</strong>
          <span class="purpose">${source.purpose}</span>
          <span class="grow"></span>
          <a href="${source.href}" target="_blank" rel="noopener">open ↗</a>
        </header>`;
      if (!source.framable) {
        return `<div class="source blocked" data-index="${index}">${head}
          <div class="blocked-body">
            Cannot be embedded (${source.blockedReason}).
            <a href="${source.href}" target="_blank" rel="noopener">Open ${source.label} in a tab ↗</a>
          </div></div>`;
      }
      return `<div class="source" data-index="${index}">${head}
        <div class="frame-wrap" style="height:${FRAME_HEIGHT}px">
          <iframe src="${source.href}" loading="lazy" referrerpolicy="no-referrer"
            style="width:${(100 / zoom).toFixed(2)}%;height:${Math.round(FRAME_HEIGHT / zoom)}px;transform:scale(${zoom})"
          ></iframe>
        </div>
      </div>`;
    })
    .join("");

  el("right").innerHTML = tabs + body;
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      activeSource = Number(button.dataset.source);
      renderSources();
    });
  });
}

async function skipCurrent() {
  const item = current();
  if (!item) return;
  try {
    state = await api("/api/skip", { sense: item.sense, index: state.index });
    dirty = false;
    render();
    await loadSources();
    status(`skipped ${item.sense} (added to the skip list)`);
  } catch (err) {
    status(err.message, true);
  }
}

async function merge() {
  try {
    const result = await api("/api/merge", {});
    state = result.state;
    render();
    await loadSources();
    status(`merged ${result.added.length} words${result.backup ? ` (backup: ${result.backup})` : ""}`);
  } catch (err) {
    status(err.message, true);
  }
}

async function nextBatch() {
  try {
    state = await api("/api/next", { limit: 25 });
    activeSource = 0;
    render();
    await loadSources();
    status(`pulled ${state.queue.length} words`);
  } catch (err) {
    status(err.message, true);
  }
}

async function move(delta) {
  const target = state.index + delta;
  if (target < 0 || target >= state.queue.length) return;
  // Never lose research: an entered year is saved before navigating away.
  if (dirty && Number(el("year").value) > 0) await save();
  state = await api(`/api/state?index=${target}`);
  render();
  await loadSources();
}

el("stacked").addEventListener("change", () => {
  stacked = el("stacked").checked;
  renderSources();
});
el("merge").addEventListener("click", () => void merge());
el("next-batch").addEventListener("click", () => void nextBatch());

function applyZoom(next) {
  zoom = Math.min(1, Math.max(0.5, next));
  localStorage.setItem(ZOOM_KEY, String(zoom));
  el("zoom").value = String(zoom);
  renderSources();
}

el("zoom").value = String(zoom);
el("zoom").addEventListener("change", () => applyZoom(Number(el("zoom").value)));

let helpVisible = false;
function toggleHelp(force) {
  helpVisible = force === undefined ? !helpVisible : force;
  el("help-panel").hidden = !helpVisible;
}
el("help").addEventListener("click", () => toggleHelp());

document.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "TEXTAREA"].includes(event.target.tagName);
  if (event.key === "Enter" && typing) return; // the field handles its own Enter
  if (event.key === "ArrowRight") return void move(1);
  if (event.key === "ArrowLeft") return void move(-1);
  if (typing) return;
  if (event.key === "?") return toggleHelp();
  if (event.key === "Escape" && helpVisible) return toggleHelp(false);
  if (event.key === "z") {
    const next = (ZOOM_STEPS.indexOf(zoom) + 1) % ZOOM_STEPS.length;
    return applyZoom(ZOOM_STEPS[next] ?? zoom);
  }
  if (event.key === "m") return void merge();
  if (event.key === "s") return void skipCurrent();
  if (event.key === "r") {
    const frame = document.querySelector(".source iframe");
    if (frame) frame.src = frame.src;
    return;
  }
  const digit = Number.parseInt(event.key, 10);
  if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
    const source = document.querySelectorAll(".source")[digit - 1];
    if (source) source.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

load(0).catch((err) => status(err.message, true));
