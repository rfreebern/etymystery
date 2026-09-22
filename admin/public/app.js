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
  return {
    word: item.word,
    year: Number(el("year").value),
    tier: Number(document.querySelector(".tiers button.active")?.dataset.tier || item.tier),
    blurb: el("blurb").value,
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
  const tierButtons = Array.from({ length: 10 }, (_, i) => i + 1)
    .map((t) => `<button data-tier="${t}" class="${t === item.tier ? "active" : ""}">${t}</button>`)
    .join("");

  el("left").innerHTML = `
    <div class="progress-bar"><div style="width:${pct}%"></div></div>
    <h1 class="word">${item.word}</h1>
    <div class="chain">${chainHtml}</div>
    <div class="answer">answer: <b>${item.deepestLanguage || "?"}</b>${
      item.frequencyRank ? ` · frequency rank ${item.frequencyRank}` : " · unranked (rare)"
    }${item.chainDepth ? ` · ${item.chainDepth} hop${item.chainDepth === 1 ? "" : "s"}` : ""}</div>
    ${problems.length ? `<div class="issue">⚠ ${problems.join("; ")}</div>` : ""}
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
      <label>Tier (difficulty)</label>
      <div class="tiers">${tierButtons}</div>
    </div>
    <div class="field">
      <label for="blurb">Reveal blurb (optional)</label>
      <textarea id="blurb" placeholder="From Arabic qahwah, likely via Turkish kahve and Dutch koffie.">${item.blurb}</textarea>
    </div>
    <div class="row">
      <button id="save-next" class="primary">Save &amp; next</button>
      <button id="save">Save</button>
      <button id="skip">Skip word</button>
    </div>
    <div class="meta">
      chain source: ${item.inWorklist ? "work list" : "not in the work list (no mappable chain)"}<br />
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
      void save({ advance: true });
    }
  });
  el("blurb").addEventListener("input", () => (dirty = true));
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
        <div class="frame-wrap"><iframe src="${source.href}" loading="lazy" referrerpolicy="no-referrer"></iframe></div>
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
    state = await api("/api/skip", { word: item.word, index: state.index });
    dirty = false;
    render();
    await loadSources();
    status(`skipped ${item.word} (added to the skip list)`);
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

document.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "TEXTAREA"].includes(event.target.tagName);
  if (event.key === "Enter" && typing) return; // the field handles its own Enter
  if (event.key === "ArrowRight") return void move(1);
  if (event.key === "ArrowLeft") return void move(-1);
  if (typing) return;
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
