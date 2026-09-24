/**
 * The EEBO-TCP layer: a dated corpus that can contradict a curated year.
 *
 * It matters because borrowed words have no English stage in their etymology, so their
 * first use is a real reference lookup — the bottleneck `--mode derive` could not
 * clear. A hit in a dated text is a citation; a miss is silence, which the tests below
 * pin down so the tool can never treat absence as evidence.
 */

import { describe, expect, it } from "vitest";
import { bodyText, headerYear, parseTcpCsv, sampleTexts, wordsPresent } from "../scripts/lib/eebo";

const CSV = [
  '"TCP","EEBO","VID","STC","Status","Author","Date","Title","Terms","Pages"',
  '"A00002","99850634","15849","STC 1000.5","Free","Aylett, Robert","1625","The brides ornaments, viz. fiue meditations","",134',
  '"A00003","1","2","STC 1","Free","Anon","n.d.","A title","",10',
  'not-a-record,"1","2","STC 2","Free","Anon","1600","Ignored: the id is not a TCP id","",10',
  '"B00001","9","3","STC 3","Free","Anon","1","A junk date, kept out of the frame","",10',
].join("\n");

const XML = `<TEI><teiHeader><fileDesc><editionStmt><edition><date>1598</date></edition></editionStmt></fileDesc></teiHeader>
<text><body><p>The coffee berry, and the sugar thereof, to-day.</p></body></text></TEI>`;

describe("the corpus index", () => {
  it("reads TCP.csv with its quotes and commas intact", () => {
    const records = parseTcpCsv(CSV);
    // The n.d. row and the non-TCP id both drop out: they have no usable date or id.
    expect(records).toEqual([
      { id: "A00002", year: 1625, title: "The brides ornaments, viz. fiue meditations" },
      { id: "B00001", year: 1, title: "A junk date, kept out of the frame" },
    ]);
  });

  it("samples an even spread inside the corpus's own period", () => {
    const records = Array.from({ length: 100 }, (_, i) => ({
      id: `A${String(i).padStart(5, "0")}`,
      year: 1450 + i * 3,
      title: "t",
    }));
    const sample = sampleTexts([...records, { id: "B00001", year: 1, title: "junk" }], 10);
    expect(sample).toHaveLength(10);
    // Ascending by year, spread across the whole period, and never out of frame.
    expect(sample.map((record) => record.year)).toEqual([...sample.map((r) => r.year)].sort((a, b) => a - b));
    expect(sample[0]!.year).toBe(1450);
    expect(Math.max(...sample.map((record) => record.year))).toBeGreaterThan(1700);
    expect(sample.some((record) => record.year < 1450)).toBe(false);
  });

  it("returns the whole frame when asked for more texts than exist", () => {
    const records = [{ id: "A00001", year: 1600, title: "t" }];
    expect(sampleTexts(records, 50)).toEqual(records);
  });
});

describe("reading a transcript", () => {
  it("takes the date from the text's own header", () => {
    expect(headerYear(XML)).toBe(1598);
    expect(headerYear("<TEI><date>1655</date></TEI>")).toBe(1655);
    expect(headerYear("<TEI>no date</TEI>")).toBeNull();
  });

  it("strips markup and finds whole words only", () => {
    const body = bodyText(XML);
    expect(body).toContain("coffee berry");
    const words = new Set(["coffee", "sugar", "cof", "day", "to"]);
    // "to-day" legitimately hits both "to" and "day": older spelling hyphenates.
    expect(wordsPresent(body, words).sort()).toEqual(["coffee", "day", "sugar", "to"]);
    // `cof` is not a word, and "sugary" must not count as "sugar".
    expect(wordsPresent("sugary and backward", new Set(["sugar", "back"]))).toEqual([]);
  });

  it("sees through hyphens and apostrophes", () => {
    expect(wordsPresent("to-day would'st", new Set(["day", "would"])).sort()).toEqual(["day", "would"]);
  });
});
