// computeStreak is the pure core of getStreak: distinct calendar-day strings,
// ascending, plus today's day string. Everything here is calendar arithmetic, so
// the interesting cases are boundaries (month, year, leap day) and the "grace
// day" rule that lets a run ending yesterday still count as current.
import { describe, expect, it } from "vitest";
import { computeStreak } from "~/lib/db.server";

describe("computeStreak", () => {
  it("returns a zeroed result with no last date for no entries", () => {
    expect(computeStreak([], "2026-07-26")).toEqual({
      current: 0,
      longest: 0,
      lastEntryDate: null,
    });
  });

  it("counts a single entry today as a streak of one", () => {
    expect(computeStreak(["2026-07-26"], "2026-07-26")).toEqual({
      current: 1,
      longest: 1,
      lastEntryDate: "2026-07-26",
    });
  });

  it("keeps a single entry from yesterday current — the grace day", () => {
    // The user has not logged yet today; the streak is not broken until they
    // miss a whole day.
    expect(computeStreak(["2026-07-25"], "2026-07-26")).toEqual({
      current: 1,
      longest: 1,
      lastEntryDate: "2026-07-25",
    });
  });

  it("drops current to zero once the last entry is two days old", () => {
    expect(computeStreak(["2026-07-24"], "2026-07-26")).toEqual({
      current: 0,
      longest: 1,
      lastEntryDate: "2026-07-24",
    });
  });

  it("counts only the trailing run, not every day logged", () => {
    const days = ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"];
    expect(computeStreak(days, "2026-01-07")).toEqual({
      current: 3,
      longest: 3,
      lastEntryDate: "2026-01-07",
    });
  });

  it("diverges current from longest when the best run is in the past", () => {
    const days = [
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-10",
      "2026-03-11",
    ];
    expect(computeStreak(days, "2026-03-11")).toEqual({
      current: 2,
      longest: 5,
      lastEntryDate: "2026-03-11",
    });
  });

  it("keeps longest after the current run has lapsed entirely", () => {
    const days = ["2026-04-01", "2026-04-02", "2026-04-03"];
    expect(computeStreak(days, "2026-04-06")).toEqual({
      current: 0,
      longest: 3,
      lastEntryDate: "2026-04-03",
    });
  });

  it("crosses a month boundary as consecutive", () => {
    const days = ["2026-01-30", "2026-01-31", "2026-02-01"];
    expect(computeStreak(days, "2026-02-01")).toMatchObject({ current: 3, longest: 3 });
  });

  it("crosses a 30-day month boundary as consecutive", () => {
    const days = ["2026-04-29", "2026-04-30", "2026-05-01"];
    expect(computeStreak(days, "2026-05-01")).toMatchObject({ current: 3, longest: 3 });
  });

  it("crosses a year boundary as consecutive", () => {
    const days = ["2025-12-30", "2025-12-31", "2026-01-01"];
    expect(computeStreak(days, "2026-01-01")).toMatchObject({ current: 3, longest: 3 });
  });

  it("treats a leap day as a real day in the run", () => {
    const days = ["2024-02-28", "2024-02-29", "2024-03-01"];
    expect(computeStreak(days, "2024-03-01")).toMatchObject({ current: 3, longest: 3 });
  });

  it("does not invent a Feb 29 in a non-leap year", () => {
    // 2026-02-28 → 2026-03-01 must read as consecutive, not a one-day gap.
    const days = ["2026-02-28", "2026-03-01"];
    expect(computeStreak(days, "2026-03-01")).toMatchObject({ current: 2, longest: 2 });
  });

  it("does not merge Feb 28 and Mar 1 in a leap year", () => {
    // Same two dates, leap year: Feb 29 is missing, so the run IS broken.
    const days = ["2024-02-28", "2024-03-01"];
    expect(computeStreak(days, "2024-03-01")).toMatchObject({ current: 1, longest: 1 });
  });

  it("handles a long unbroken run spanning several months", () => {
    const days: string[] = [];
    for (let i = 0; i < 100; i++) {
      const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000);
      days.push(d.toISOString().slice(0, 10));
    }
    const last = days[days.length - 1];
    expect(computeStreak(days, last)).toEqual({ current: 100, longest: 100, lastEntryDate: last });
  });

  it("reports the most recent day as lastEntryDate even when the streak is dead", () => {
    const days = ["2020-01-01", "2020-06-15"];
    expect(computeStreak(days, "2026-07-26")).toEqual({
      current: 0,
      longest: 1,
      lastEntryDate: "2020-06-15",
    });
  });

  it("ignores a future-dated last entry rather than crediting it", () => {
    // Documents intent: with both sides bucketed in the same zone this cannot
    // happen, so a day ahead of `today` means clock skew, and skew must not be
    // able to inflate a streak.
    expect(computeStreak(["2026-07-27"], "2026-07-26")).toMatchObject({ current: 0, longest: 1 });
  });
});
