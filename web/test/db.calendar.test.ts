// Timezone-aware calendar-day math.
//
// This code exists to fix a specific bug: the Day-N counter and the streak used
// to bucket days in two different zones, so they disagreed for anyone not at
// UTC+0. The regression tests at the bottom of this file assert the invariant
// that fix establishes — one zone in, one set of day buckets out.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TZ,
  computeStreak,
  dayNumber,
  isValidTimezone,
  ymdInTz,
  ymdToEpochDay,
  type Goal,
} from "~/lib/db.server";

// Only the goal fields dayNumber reads matter; the rest is filler.
function goalCreatedAt(createdAt: string): Goal {
  return {
    id: 1,
    title: "t",
    desire: "d",
    end_scene: null,
    status: "active",
    created_at: createdAt,
    realised_at: null,
  };
}

function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ymdInTz", () => {
  it("defaults to UTC", () => {
    expect(ymdInTz(new Date("2026-07-26T23:59:59Z"))).toBe("2026-07-26");
    expect(DEFAULT_TZ).toBe("UTC");
  });

  it("returns a zero-padded YYYY-MM-DD", () => {
    expect(ymdInTz(new Date("2026-01-02T12:00:00Z"), "UTC")).toBe("2026-01-02");
  });

  it("gives two different calendar days for the same instant at the extremes", () => {
    // Pacific/Kiritimati is UTC+14, Pacific/Midway is UTC-11 — 25 hours apart,
    // so one instant can legitimately land on three different dates worldwide.
    const instant = new Date("2026-07-26T10:30:00Z");
    expect(ymdInTz(instant, "Pacific/Kiritimati")).toBe("2026-07-27");
    expect(ymdInTz(instant, "UTC")).toBe("2026-07-26");
    expect(ymdInTz(instant, "Pacific/Midway")).toBe("2026-07-25");
  });

  it("respects half-hour and 45-minute offsets", () => {
    expect(ymdInTz(new Date("2026-07-26T14:00:00Z"), "Australia/Lord_Howe")).toBe("2026-07-27");
    expect(ymdInTz(new Date("2026-07-26T18:20:00Z"), "Asia/Kathmandu")).toBe("2026-07-27");
  });

  it("rolls over at local midnight, not at UTC midnight", () => {
    // 23:30 then 00:30 local in New York, both on the same UTC date.
    expect(ymdInTz(new Date("2026-07-27T03:30:00Z"), "America/New_York")).toBe("2026-07-26");
    expect(ymdInTz(new Date("2026-07-27T04:30:00Z"), "America/New_York")).toBe("2026-07-27");
  });

  it("tracks the spring-forward DST transition", () => {
    // US DST starts 2026-03-08 02:00 local. 04:30Z is 23:30 EST on the 7th;
    // 07:30Z is 03:30 EDT on the 8th.
    expect(ymdInTz(new Date("2026-03-08T04:30:00Z"), "America/New_York")).toBe("2026-03-07");
    expect(ymdInTz(new Date("2026-03-08T07:30:00Z"), "America/New_York")).toBe("2026-03-08");
  });

  it("tracks the fall-back DST transition", () => {
    // 03:30Z is 23:30 EDT on Oct 31; 05:30Z is 01:30 EDT on Nov 1 (the repeated
    // hour) — still Nov 1 either way, which is the point: the date must not slip.
    expect(ymdInTz(new Date("2026-11-01T03:30:00Z"), "America/New_York")).toBe("2026-10-31");
    expect(ymdInTz(new Date("2026-11-01T05:30:00Z"), "America/New_York")).toBe("2026-11-01");
    expect(ymdInTz(new Date("2026-11-01T06:30:00Z"), "America/New_York")).toBe("2026-11-01");
  });

  it("falls back to UTC on an invalid zone instead of throwing", () => {
    const instant = new Date("2026-07-26T23:30:00Z");
    const utc = ymdInTz(instant, "UTC");
    expect(ymdInTz(instant, "Mars/Olympus_Mons")).toBe(utc);
    expect(ymdInTz(instant, "")).toBe(utc);
    expect(ymdInTz(instant, "'; DROP TABLE neville_goals; --")).toBe(utc);
    expect(ymdInTz(instant, null as unknown as string)).toBe(utc);
    expect(ymdInTz(instant, undefined as unknown as string)).toBe(utc);
  });
});

describe("ymdToEpochDay", () => {
  it("anchors on the Unix epoch", () => {
    expect(ymdToEpochDay("1970-01-01")).toBe(0);
    expect(ymdToEpochDay("1970-01-02")).toBe(1);
    expect(ymdToEpochDay("1969-12-31")).toBe(-1);
    expect(ymdToEpochDay("2026-07-26")).toBe(20660);
  });

  it("makes adjacent calendar days differ by exactly one across boundaries", () => {
    const pairs: [string, string][] = [
      ["2026-01-31", "2026-02-01"], // 31-day month
      ["2026-04-30", "2026-05-01"], // 30-day month
      ["2025-12-31", "2026-01-01"], // year
      ["2024-02-28", "2024-02-29"], // into a leap day
      ["2024-02-29", "2024-03-01"], // out of a leap day
      ["2026-02-28", "2026-03-01"], // non-leap February
    ];
    for (const [a, b] of pairs) {
      expect(ymdToEpochDay(b) - ymdToEpochDay(a), `${a} → ${b}`).toBe(1);
    }
  });

  it("counts a 23-hour and a 25-hour DST day as one day each", () => {
    // The whole reason day math goes through Date.UTC rather than local Date:
    // a DST day is not 86400 seconds long, but it is still one calendar day.
    expect(ymdToEpochDay("2026-03-08") - ymdToEpochDay("2026-03-07")).toBe(1);
    expect(ymdToEpochDay("2026-11-02") - ymdToEpochDay("2026-11-01")).toBe(1);
  });

  it("round-trips against ymdInTz in UTC", () => {
    for (const ymd of ["1970-01-01", "1999-12-31", "2024-02-29", "2026-07-26", "2038-01-19"]) {
      const day = ymdToEpochDay(ymd);
      expect(ymdInTz(new Date(day * 86400000), "UTC")).toBe(ymd);
    }
  });

  it("is monotonically increasing over a long span", () => {
    let prev = -Infinity;
    for (let i = 0; i < 400; i++) {
      const ymd = ymdInTz(new Date(Date.UTC(2025, 10, 1) + i * 86400000), "UTC");
      const day = ymdToEpochDay(ymd);
      expect(day).toBeGreaterThan(prev);
      prev = day;
    }
  });
});

describe("dayNumber", () => {
  it("is 1 on the day the goal is created", () => {
    at("2026-07-26T12:00:00Z");
    expect(dayNumber(goalCreatedAt("2026-07-26T09:00:00Z"), "UTC")).toBe(1);
  });

  it("advances at local midnight, not 24 hours after creation", () => {
    // Goal created 23:00 local in Kiritimati (UTC+14); 90 minutes later it is
    // the next local day, so it is Day 2 — not Day 1 for another 22.5 hours.
    at("2026-07-26T10:30:00Z");
    expect(dayNumber(goalCreatedAt("2026-07-26T09:00:00Z"), "Pacific/Kiritimati")).toBe(2);
    // The very same pair of instants is still Day 1 in UTC. If the two sides of
    // the app disagreed about the zone, this is exactly where they would split.
    expect(dayNumber(goalCreatedAt("2026-07-26T09:00:00Z"), "UTC")).toBe(1);
  });

  it("does not advance early for a western zone that has not rolled over", () => {
    // 19:30 → 20:30 the same evening in New York, but two different UTC dates.
    at("2026-07-26T00:30:00Z");
    const goal = goalCreatedAt("2026-07-25T23:30:00Z");
    expect(dayNumber(goal, "America/New_York")).toBe(1);
    expect(dayNumber(goal, "UTC")).toBe(2);
  });

  it("advances by one across the spring-forward transition", () => {
    // 23:30 EST on the 7th → 00:00 EST on the 8th: half an hour, one day later.
    at("2026-03-08T05:00:00Z");
    expect(dayNumber(goalCreatedAt("2026-03-08T04:30:00Z"), "America/New_York")).toBe(2);
  });

  it("advances by one across the fall-back transition despite the 25-hour day", () => {
    // 23:00 EDT Oct 31 → 22:00 EST Nov 1. Exactly 24h of wall clock, but the
    // local day advanced once, so Day 2 — not Day 1 and not Day 3.
    at("2026-11-02T03:00:00Z");
    expect(dayNumber(goalCreatedAt("2026-11-01T03:00:00Z"), "America/New_York")).toBe(2);
  });

  it("counts calendar days across a month boundary", () => {
    at("2026-03-02T08:00:00Z");
    expect(dayNumber(goalCreatedAt("2026-02-26T08:00:00Z"), "UTC")).toBe(5);
  });

  it("never returns less than 1 for a future-dated goal", () => {
    at("2026-07-26T12:00:00Z");
    expect(dayNumber(goalCreatedAt("2026-08-30T12:00:00Z"), "UTC")).toBe(1);
    expect(dayNumber(goalCreatedAt("2026-07-27T12:00:00Z"), "Pacific/Midway")).toBe(1);
  });

  it("falls back to UTC for an invalid zone", () => {
    at("2026-07-26T10:30:00Z");
    const goal = goalCreatedAt("2026-07-26T09:00:00Z");
    expect(dayNumber(goal, "Nowhere/AtAll")).toBe(dayNumber(goal, "UTC"));
  });

  it("defaults to UTC when no zone is supplied", () => {
    at("2026-07-26T10:30:00Z");
    const goal = goalCreatedAt("2026-07-26T09:00:00Z");
    expect(dayNumber(goal)).toBe(dayNumber(goal, "UTC"));
  });
});

describe("day counter and streak agree in every zone (the bug this fixed)", () => {
  // A user who has logged an entry on every local day since creating the goal
  // must see Day N == streak N. This only holds if both sides bucket in the
  // user's zone; the second assertion in each case shows the old mixed-zone
  // behaviour producing a wrong answer.
  const cases: { tz: string; now: string; created: string; expected: number }[] = [
    { tz: "UTC", now: "2026-07-26T10:30:00Z", created: "2026-07-24T10:30:00Z", expected: 3 },
    {
      tz: "Pacific/Kiritimati", // UTC+14 — local date runs ahead of UTC
      now: "2026-07-26T10:30:00Z",
      created: "2026-07-24T10:30:00Z",
      expected: 3,
    },
    {
      tz: "Pacific/Midway", // UTC-11 — local date lags UTC
      now: "2026-07-26T10:30:00Z",
      created: "2026-07-24T10:30:00Z",
      expected: 3,
    },
    {
      tz: "America/New_York", // spans a DST transition
      now: "2026-03-09T15:00:00Z",
      created: "2026-03-06T15:00:00Z",
      expected: 4,
    },
  ];

  for (const c of cases) {
    it(`holds for ${c.tz}`, () => {
      at(c.now);
      const goal = goalCreatedAt(c.created);
      const n = dayNumber(goal, c.tz);
      expect(n).toBe(c.expected);

      // One entry per local day, from the goal's local start day to today.
      const startDay = ymdToEpochDay(ymdInTz(new Date(c.created), c.tz));
      const days: string[] = [];
      for (let i = 0; i < n; i++) {
        days.push(ymdInTz(new Date((startDay + i) * 86400000), "UTC"));
      }
      const todayLocal = ymdInTz(new Date(), c.tz);
      expect(computeStreak(days, todayLocal).current).toBe(n);
    });
  }

  it("shows the old mixed-zone bucketing producing a broken streak", () => {
    // Streak days bucketed in the user's zone but "today" taken in UTC: for a
    // UTC+14 user the last entry looks like it is in the future, so the streak
    // collapses to 0 while the day counter still says 3.
    at("2026-07-26T10:30:00Z");
    const tz = "Pacific/Kiritimati";
    const goal = goalCreatedAt("2026-07-24T10:30:00Z");
    const days = ["2026-07-25", "2026-07-26", "2026-07-27"];

    expect(dayNumber(goal, tz)).toBe(3);
    expect(computeStreak(days, ymdInTz(new Date(), tz)).current).toBe(3);
    expect(computeStreak(days, ymdInTz(new Date(), "UTC")).current).toBe(0);
  });
});

describe("isValidTimezone", () => {
  it("accepts real IANA zone names", () => {
    for (const tz of [
      "UTC",
      "America/New_York",
      "Pacific/Kiritimati",
      "Pacific/Midway",
      "Europe/London",
      "Africa/Accra",
      "Asia/Kathmandu",
      "Australia/Lord_Howe",
      "America/Argentina/Buenos_Aires",
      "Etc/GMT+5",
    ]) {
      expect(isValidTimezone(tz), tz).toBe(true);
    }
  });

  it("accepts a lowercase zone name — Intl is case-insensitive", () => {
    // Documents real behaviour: "utc" is accepted and formats correctly, so the
    // validator must not be assumed to canonicalise casing.
    expect(isValidTimezone("utc")).toBe(true);
    expect(ymdInTz(new Date("2026-07-26T23:30:00Z"), "utc")).toBe("2026-07-26");
  });

  it("rejects empty and whitespace-only input", () => {
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone(" ")).toBe(false);
    expect(isValidTimezone("\t\n")).toBe(false);
  });

  it("rejects plausible-looking nonsense", () => {
    for (const tz of [
      "Mars/Olympus_Mons",
      "America/Nowhere",
      "GMT+25",
      "America//New_York",
      " America/New_York", // a stray leading space must not silently pass
    ]) {
      expect(isValidTimezone(tz), tz).toBe(false);
    }
  });

  it("rejects adversarial strings rather than letting them reach SQL", () => {
    // getStreak interpolates the result of this check into `AT TIME ZONE $2`.
    // It is a bound parameter, but the validator is still the first line.
    for (const tz of [
      "UTC'; DROP TABLE neville_users; --",
      "UTC ",
      "../../../etc/passwd",
      "$(whoami)",
      "UTC\nUTC",
      "A".repeat(5000),
    ]) {
      expect(isValidTimezone(tz), JSON.stringify(tz.slice(0, 40))).toBe(false);
    }
  });

  it("rejects non-string values without throwing", () => {
    for (const bad of [null, undefined, 0, 123, true, [], {}, () => "UTC"]) {
      expect(isValidTimezone(bad as unknown as string)).toBe(false);
    }
    // An object that stringifies to a valid zone is still rejected — the typeof
    // guard runs before Intl gets a chance to coerce it.
    expect(isValidTimezone({ toString: () => "UTC" } as unknown as string)).toBe(false);
  });

  it("accepts an array containing one valid zone only if it is a string", () => {
    expect(isValidTimezone(["UTC"] as unknown as string)).toBe(false);
  });
});
