import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_PREFIX,
  TURNOVER_LABEL,
  countdownLabel,
  formatCountdown,
  secondsLeftInUtcDay,
} from "../web/src/countdown";

const at = (iso: string): number => Date.parse(iso);

describe("the countdown to the next puzzle", () => {
  it("counts to midnight UTC, not to any local midnight", () => {
    // 17:24:56 before midnight, which is the example the line was specified with.
    expect(formatCountdown(secondsLeftInUtcDay(at("2026-09-24T06:35:04Z")))).toBe("17:24:56");
    expect(secondsLeftInUtcDay(at("2026-09-24T00:00:01Z"))).toBe(86_399);
    expect(secondsLeftInUtcDay(at("2026-09-24T12:00:00Z"))).toBe(43_200);
    expect(secondsLeftInUtcDay(at("2026-09-24T23:59:59Z"))).toBe(1);
  });

  it("prints the midnight second as 00:00:00 rather than 24:00:00", () => {
    // 86_400 is the one second where the day has already turned: the countdown has run
    // out, so it reads as the new day starting, and the page reloads into it.
    expect(secondsLeftInUtcDay(at("2026-09-24T00:00:00Z"))).toBe(86_400);
    expect(formatCountdown(86_400)).toBe("00:00:00");
    expect(formatCountdown(0)).toBe("00:00:00");
  });

  it("pads every field, so the line cannot jump about", () => {
    expect(formatCountdown(1)).toBe("00:00:01");
    expect(formatCountdown(59)).toBe("00:00:59");
    expect(formatCountdown(60)).toBe("00:01:00");
    expect(formatCountdown(3_599)).toBe("00:59:59");
    expect(formatCountdown(3_600)).toBe("01:00:00");
    expect(formatCountdown(86_399)).toBe("23:59:59");
  });

  it("never leaves the 0..23:59:59 range, whatever the clock says", () => {
    // A wrong system clock must not produce a nonsense line: the countdown is a modulo of
    // the UTC day, so a time before the epoch lands inside the same range.
    for (const iso of ["1969-07-20T20:17:00Z", "2026-09-24T06:35:04Z", "2030-01-01T00:00:00Z"]) {
      const seconds = secondsLeftInUtcDay(at(iso));
      expect(seconds).toBeGreaterThanOrEqual(1);
      expect(seconds).toBeLessThanOrEqual(86_400);
      expect(formatCountdown(seconds)).toMatch(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
    }
  });

  it("says when the next puzzle arrives, and what to do once it has", () => {
    expect(countdownLabel(at("2026-09-24T06:35:04Z"))).toBe(`${COUNTDOWN_PREFIX}17:24:56`);
    expect(COUNTDOWN_PREFIX).toContain("Check back for a new puzzle in");
    expect(TURNOVER_LABEL).toContain("new puzzle is ready");
  });
});
