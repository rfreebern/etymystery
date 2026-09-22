import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REFERENCE_SOURCES, sourcesFor } from "../admin/sources";
import {
  DEFAULT_PATHS,
  buildQueue,
  formatCuration,
  mergeBatch,
  pullNextBatch,
  saveEntry,
  skipWord,
  type AdminPaths,
} from "../admin/store";
import { createAdminServer } from "../admin/server";

/** A throwaway data dir plus the work list the app reads. */
function makeWorkspace(): AdminPaths {
  const dir = mkdtempSync(path.join(tmpdir(), "etymystery-admin-"));
  const paths: AdminPaths = {
    worklist: path.join(dir, "worklist.tsv"),
    curation: path.join(dir, "curation.json"),
    batch: path.join(dir, "batch.json"),
    skip: path.join(dir, "skip-words.txt"),
    bank: path.join(dir, "bank.json"),
  };
  const rows = [
    "word\tfreq_rank\ttier\tchain_depth\tdeepest_language\tchain",
    "just\t39\t2\t2\tOld French\tMiddle English <- Old French",
    "money\t186\t2\t2\tOld French\tMiddle English <- Old French",
    "must\t156\t2\t2\tMiddle Persian\tPersian <- Middle Persian",
    "tea\t\t7\t3\tMin Nan\tDutch <- Malay <- Min Nan",
  ];
  writeFileSync(paths.worklist, `${rows.join("\n")}\n`);
  writeFileSync(paths.curation, formatCuration({ coffee: { year: 1590, tier: 1, blurb: "From Arabic." } }));
  return paths;
}

describe("reference sources", () => {
  it("builds an encoded URL per word", () => {
    const wiktionary = REFERENCE_SOURCES.find((source) => source.id === "wiktionary")!;
    expect(wiktionary.url("money")).toBe("https://en.wiktionary.org/wiki/money");
    expect(wiktionary.url("kick the bucket")).toBe("https://en.wiktionary.org/wiki/kick_the_bucket");
    const ngram = REFERENCE_SOURCES.find((source) => source.id === "ngram")!;
    expect(ngram.url("money")).toContain("content=money");
  });

  it("records framing support honestly (measured, not assumed)", () => {
    const blocked = REFERENCE_SOURCES.filter((source) => !source.framable);
    expect(blocked.map((source) => source.id).sort()).toEqual(["hathitrust", "merriam-webster", "oed"]);
    for (const source of blocked) expect(source.blockedReason).toBeTruthy();
    for (const source of REFERENCE_SOURCES.filter((s) => s.framable)) expect(source.blockedReason).toBeUndefined();
  });

  it("gives every source a purpose line and an href for the word", () => {
    for (const source of sourcesFor("money")) {
      expect(source.purpose.length).toBeGreaterThan(5);
      expect(source.href).toContain("money");
    }
  });
});

describe("store", () => {
  it("joins the batch with the work list into a queue", () => {
    const paths = makeWorkspace();
    writeFileSync(
      paths.batch,
      formatCuration({ just: { year: 1400, tier: 3, blurb: "" }, tea: { year: 0, tier: 7 } }),
    );
    const state = buildQueue(paths);
    expect(state.queue.map((item) => item.word)).toEqual(["just", "tea"]);
    expect(state.queue[0]).toMatchObject({
      word: "just",
      frequencyRank: 39,
      chain: ["Middle English", "Old French"],
      deepestLanguage: "Old French",
      inWorklist: true,
      year: 1400,
      tier: 3,
    });
    expect(state.queue[1]).toMatchObject({ word: "tea", year: 0, tier: 7, inWorklist: true });
    expect(state.curatedCount).toBe(1);
  });

  it("pulls the next uncurated words, skipping already-curated and skipped ones", () => {
    const paths = makeWorkspace();
    writeFileSync(paths.skip, "just\n");
    const state = pullNextBatch(paths, 2);
    // coffee is curated and just is skipped, so the next two are money and must
    expect(state.queue.map((item) => item.word)).toEqual(["money", "must"]);
    expect(JSON.parse(readFileSync(paths.batch, "utf8"))).toMatchObject({ money: { year: 0 } });
  });

  it("saves an entry into the batch and refuses nonsense", () => {
    const paths = makeWorkspace();
    pullNextBatch(paths, 3);
    const state = saveEntry(paths, { word: "money", year: 1300, tier: 2, blurb: "  From Old French. " }, 1);
    expect(state.queue.find((item) => item.word === "money")).toMatchObject({
      year: 1300,
      blurb: "From Old French.",
    });
    expect(() => saveEntry(paths, { word: "nope", year: 1500, tier: 2, blurb: "" }, 0)).toThrow(/not in the current batch/);
    expect(() => saveEntry(paths, { word: "money", year: 1500, tier: 11, blurb: "" }, 0)).toThrow(/tier/);
    expect(() => saveEntry(paths, { word: "money", year: 99_999, tier: 2, blurb: "" }, 0)).toThrow(/out of range/);
  });

  it("skips a word: it leaves the batch and lands on the skip list", () => {
    const paths = makeWorkspace();
    pullNextBatch(paths, 3);
    const state = skipWord(paths, "must", 0);
    expect(state.queue.map((item) => item.word)).not.toContain("must");
    expect(readFileSync(paths.skip, "utf8")).toContain("must");
  });

  it("merges researched entries, keeps a backup, and leaves year-0 words alone", () => {
    const paths = makeWorkspace();
    pullNextBatch(paths, 3);
    saveEntry(paths, { word: "money", year: 1300, tier: 2, blurb: "From Old French." }, 0);
    const result = mergeBatch(paths);
    expect(result.added).toEqual(["money"]);
    expect(result.skipped).toContain("just"); // still year 0
    expect(result.backup).toBe(`${paths.curation}.bak`);
    const curation = JSON.parse(readFileSync(paths.curation, "utf8"));
    expect(curation.money).toEqual({ year: 1300, tier: 2, blurb: "From Old French." });
    expect(curation.coffee).toBeDefined(); // existing entries survive
    expect(curation.just).toBeUndefined();
  });

  it("ships defaults that match the CLI's paths", () => {
    expect(DEFAULT_PATHS.batch).toBe("data/curation-batch.json");
    expect(DEFAULT_PATHS.curation).toBe("curated/curation.json");
  });
});

describe("http api", () => {
  const paths = makeWorkspace();
  let base = "";
  let server: ReturnType<typeof createAdminServer>;

  beforeAll(async () => {
    server = createAdminServer({ paths, defaultLimit: 2 });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves the page and the client assets, and nothing outside its public dir", async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Etymystery curation");
    expect((await fetch(`${base}/app.js`)).status).toBe(200);
    expect((await fetch(`${base}/style.css`)).status).toBe(200);
    expect((await fetch(`${base}/../etc/passwd`)).status).toBe(404);
  });

  it("returns state, sources for a word, and a pulled batch", async () => {
    const pulled = await (
      await fetch(`${base}/api/next`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 2 }),
      })
    ).json();
    expect(pulled.queue).toHaveLength(2);

    const word = pulled.queue[0].word;
    const state = await (await fetch(`${base}/api/state?index=1`)).json();
    expect(state.index).toBe(1);
    expect(state.queue).toHaveLength(2);

    const sources = (await (await fetch(`${base}/api/sources?word=${word}`)).json()) as Array<{
      href: string;
      framable: boolean;
    }>;
    expect(sources).toHaveLength(REFERENCE_SOURCES.length);
    expect(sources[0]!.href).toContain(word);
    expect(sources.some((source) => source.framable === false)).toBe(true);
  });

  it("saves an entry over HTTP and reports bad input as 400", async () => {
    const state = await (await fetch(`${base}/api/state`)).json();
    const word: string = state.queue[0].word;
    const saved = await (
      await fetch(`${base}/api/entry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ word, year: 1650, tier: 4, blurb: "tested" }),
      })
    ).json();
    expect(saved.queue.find((item: { word: string }) => item.word === word)).toMatchObject({ year: 1650, tier: 4 });
    expect(JSON.parse(readFileSync(paths.batch, "utf8"))[word].year).toBe(1650);

    const bad = await fetch(`${base}/api/entry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ word, year: 1650, tier: 44 }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/tier/);
  });

  it("merges over HTTP", async () => {
    const result = await (await fetch(`${base}/api/merge`, { method: "POST", body: "{}" })).json();
    expect(result.added.length).toBeGreaterThan(0);
    expect(result.state.curatedCount).toBeGreaterThan(1);
  });
});
