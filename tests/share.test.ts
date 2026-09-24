/**
 * The share block: the only thing a player takes away from the day, so its thresholds
 * and text are pinned rather than eyeballed.
 */

import { describe, expect, it } from "vitest";
import { SCORE_EMOJI, scoreBand, scoreEmoji, shareText } from "../web/src/share";

describe("the score bands", () => {
  it("colours a score by the band it falls in", () => {
    // blue 90-100, green 60-90, yellow 30-60, red 0-30
    expect(scoreEmoji(100)).toBe(SCORE_EMOJI.blue);
    expect(scoreEmoji(90)).toBe(SCORE_EMOJI.blue);
    expect(scoreEmoji(89)).toBe(SCORE_EMOJI.green);
    expect(scoreEmoji(60)).toBe(SCORE_EMOJI.green);
    expect(scoreEmoji(59)).toBe(SCORE_EMOJI.yellow);
    expect(scoreEmoji(30)).toBe(SCORE_EMOJI.yellow);
    expect(scoreEmoji(29)).toBe(SCORE_EMOJI.red);
    expect(scoreEmoji(0)).toBe(SCORE_EMOJI.red);
  });

  it("gives a boundary to the band it opens", () => {
    // A player reading "60" reads it as two thirds, not a third: the boundary belongs
    // to the higher band, and the name matches the square.
    for (const boundary of [30, 60, 90]) {
      expect(scoreBand(boundary)).toBe(scoreBand(boundary + 1));
      expect(scoreEmoji(boundary)).toBe(scoreEmoji(boundary + 1));
    }
    expect(scoreBand(29)).toBe("red");
    expect(scoreBand(100)).toBe("blue");
  });
});

describe("the share text", () => {
  const base = {
    date: "2026-09-24",
    totals: [100, 92, 75, 61, 45, 30, 12, 0, 88, 55],
    average: 56,
    played: 10,
    rounds: 10,
    url: "https://rfreebern.github.io/etymystery/",
  };

  it("has one square per round, in the order played", () => {
    const text = shareText(base);
    const squares = text.split("\n")[1]!;
    expect(squares).toBe("🟦🟦🟩🟩🟨🟨🟥🟥🟩🟨");
    expect([...squares]).toHaveLength(base.totals.length);
    expect(text).toContain("Etymystery 2026-09-24");
    expect(text).toContain("Average 56/100");
    expect(text).toContain(base.url);
  });

  it("says how far a part-finished day got", () => {
    const text = shareText({ ...base, totals: [100, 92], played: 2 });
    expect(text).toContain("2/10 rounds, average 56/100");
    expect([...text.split("\n")[1]!]).toHaveLength(2);
  });

  it("is plain text with no em dashes", () => {
    // The project's copy rule, and a shared result that arrives with fancy punctuation
    // can be mangled by whatever it is pasted into.
    expect(shareText(base)).not.toContain("—");
    expect(shareText(base)).not.toMatch(/[<>]/);
  });
});
