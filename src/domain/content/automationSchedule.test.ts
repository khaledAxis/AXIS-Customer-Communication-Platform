import { describe, expect, it } from "vitest";

import {
  Cadence,
  describeSchedule,
  isDue,
  nextOccurrence,
  validateSchedule,
} from "./automationSchedule";

/**
 * Occurrence arithmetic (ADR-0026).
 *
 * The database enforces one run per `(automation, scheduledFor)`, which only helps if
 * two callers compute the SAME instant for the same occurrence. That determinism is
 * what these tests protect.
 */

// A Monday.
const MONDAY = new Date("2026-08-03T06:00:00.000Z");

describe("validation", () => {
  it("accepts a sensible weekly schedule", () => {
    const result = validateSchedule({
      cadence: Cadence.WEEKLY,
      interval: 1,
      dayOfWeek: 1,
      hour: 8,
    });
    expect(result.ok).toBe(true);
  });

  it("caps the day of the month at 28", () => {
    // "The 30th" silently means "never" in February — a newsletter that skips a month
    // once a year is a bug nobody reports for a year.
    const result = validateSchedule({
      cadence: Cadence.MONTHLY,
      interval: 1,
      dayOfMonth: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toContain("DAY_OF_MONTH_OUT_OF_RANGE");
  });

  it("refuses nonsense rather than clamping it", () => {
    expect(validateSchedule({ cadence: "YEARLY" as never, interval: 1 }).ok).toBe(false);
    expect(validateSchedule({ cadence: Cadence.WEEKLY, interval: 0 }).ok).toBe(false);
    expect(validateSchedule({ cadence: Cadence.WEEKLY, interval: 99 }).ok).toBe(false);
    expect(
      validateSchedule({ cadence: Cadence.WEEKLY, interval: 1, dayOfWeek: 9 }).ok,
    ).toBe(false);
    expect(
      validateSchedule({ cadence: Cadence.WEEKLY, interval: 1, hour: 25 }).ok,
    ).toBe(false);
  });
});

describe("weekly occurrences", () => {
  const weekly = { cadence: Cadence.WEEKLY, interval: 1, dayOfWeek: 1, hour: 8 };

  it("finds this Monday when the hour has not yet passed", () => {
    const next = nextOccurrence(weekly, MONDAY);
    expect(next?.toISOString()).toBe("2026-08-03T08:00:00.000Z");
  });

  it("moves to next Monday once the hour has passed", () => {
    const afterSlot = new Date("2026-08-03T09:00:00.000Z");
    expect(nextOccurrence(weekly, afterSlot)?.toISOString()).toBe(
      "2026-08-10T08:00:00.000Z",
    );
  });

  it("is STRICTLY after the reference instant, so a run cannot re-trigger itself", () => {
    const exact = new Date("2026-08-03T08:00:00.000Z");
    const next = nextOccurrence(weekly, exact);
    expect(next!.getTime()).toBeGreaterThan(exact.getTime());
  });

  it("is deterministic — the same inputs give the same instant", () => {
    expect(nextOccurrence(weekly, MONDAY)?.toISOString()).toBe(
      nextOccurrence(weekly, MONDAY)?.toISOString(),
    );
  });

  it("finds the right weekday from any starting day", () => {
    const thursday = new Date("2026-08-06T12:00:00.000Z");
    const next = nextOccurrence(weekly, thursday);
    expect(next?.getUTCDay()).toBe(1);
    expect(next?.toISOString()).toBe("2026-08-10T08:00:00.000Z");
  });
});

describe("monthly occurrences", () => {
  const monthly = { cadence: Cadence.MONTHLY, interval: 1, dayOfMonth: 1, hour: 9 };

  it("finds the first of next month once this month's has passed", () => {
    const next = nextOccurrence(monthly, new Date("2026-08-03T00:00:00.000Z"));
    expect(next?.toISOString()).toBe("2026-09-01T09:00:00.000Z");
  });

  it("finds this month's day when it is still ahead", () => {
    const next = nextOccurrence(monthly, new Date("2026-08-01T06:00:00.000Z"));
    expect(next?.toISOString()).toBe("2026-08-01T09:00:00.000Z");
  });

  it("does not skip February", () => {
    const next = nextOccurrence(
      { cadence: Cadence.MONTHLY, interval: 1, dayOfMonth: 28, hour: 9 },
      new Date("2027-01-29T00:00:00.000Z"),
    );
    expect(next?.toISOString()).toBe("2027-02-28T09:00:00.000Z");
  });
});

describe("due-ness", () => {
  it("treats a missed occurrence as still due", () => {
    // A draft nobody has read loses nothing by being a day late. Sending has the
    // opposite rule (ADR-0010) and that difference is deliberate.
    const missed = new Date("2026-08-03T08:00:00.000Z");
    expect(isDue(missed, new Date("2026-08-04T10:00:00.000Z"))).toBe(true);
  });

  it("is not due before its instant", () => {
    expect(
      isDue(new Date("2026-08-10T08:00:00.000Z"), new Date("2026-08-09T23:59:00.000Z")),
    ).toBe(false);
  });
});

describe("plain-language description", () => {
  it("describes a schedule without cron or RRULE", () => {
    expect(describeSchedule({ cadence: Cadence.WEEKLY, interval: 1, dayOfWeek: 1, hour: 8 }))
      .toBe("Every Monday at 08:00");
    expect(
      describeSchedule({ cadence: Cadence.MONTHLY, interval: 1, dayOfMonth: 1, hour: 9 }),
    ).toBe("On the 1st of every month at 09:00");
    expect(
      describeSchedule({ cadence: Cadence.WEEKLY, interval: 2, dayOfWeek: 3, hour: 7 }),
    ).toBe("Every 2 weeks on Wednesday at 07:00");
  });
});
