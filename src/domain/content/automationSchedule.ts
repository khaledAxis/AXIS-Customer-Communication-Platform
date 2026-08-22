/**
 * When an assisted automation next prepares a DRAFT (ADR-0026, refining ADR-0010).
 *
 * The word "occurrence" carries the whole design. An automation does not fire "now and
 * then" — it fires at a specific, computable instant, and `NewsletterAutomationRun` is
 * UNIQUE on `(automationId, scheduledFor)`. Two workers, a retried request, or a server
 * restarted mid-run therefore produce ONE run for that occurrence, because the second
 * write loses at the database rather than at a lock somebody remembered to take.
 *
 * That only holds if the occurrence is derived deterministically from the automation's
 * configuration, which is what this module is for.
 *
 * Pure: no I/O, no `Date.now()` — every function takes the reference instant.
 */

export const Cadence = {
  WEEKLY: "WEEKLY",
  MONTHLY: "MONTHLY",
} as const;
export type Cadence = (typeof Cadence)[keyof typeof Cadence];

export interface ScheduleDefinition {
  cadence: Cadence;
  /** Every N weeks / months. At least 1. */
  interval: number;
  /** 0 = Sunday … 6 = Saturday. WEEKLY only. */
  dayOfWeek?: number | null;
  /** 1–31, clamped to the length of the month. MONTHLY only. */
  dayOfMonth?: number | null;
  /** Hour of day (0–23) the draft is prepared. */
  hour?: number | null;
}

export type ScheduleProblem =
  | "UNKNOWN_CADENCE"
  | "INTERVAL_OUT_OF_RANGE"
  | "DAY_OF_WEEK_OUT_OF_RANGE"
  | "DAY_OF_MONTH_OUT_OF_RANGE"
  | "HOUR_OUT_OF_RANGE";

export const SCHEDULE_PROBLEM_MESSAGE: Record<ScheduleProblem, string> = {
  UNKNOWN_CADENCE: "Choose whether this runs weekly or monthly.",
  INTERVAL_OUT_OF_RANGE: "Choose how often between 1 and 12.",
  DAY_OF_WEEK_OUT_OF_RANGE: "Choose a day of the week.",
  DAY_OF_MONTH_OUT_OF_RANGE: "Choose a day of the month between 1 and 28.",
  HOUR_OUT_OF_RANGE: "Choose an hour between 0 and 23.",
};

export type ScheduleValidation =
  | { ok: true; definition: Required<Omit<ScheduleDefinition, "dayOfWeek" | "dayOfMonth">> & ScheduleDefinition }
  | { ok: false; problems: ScheduleProblem[] };

export function validateSchedule(input: ScheduleDefinition): ScheduleValidation {
  const problems: ScheduleProblem[] = [];

  if (input.cadence !== Cadence.WEEKLY && input.cadence !== Cadence.MONTHLY) {
    problems.push("UNKNOWN_CADENCE");
  }
  if (!Number.isInteger(input.interval) || input.interval < 1 || input.interval > 12) {
    problems.push("INTERVAL_OUT_OF_RANGE");
  }

  const hour = input.hour ?? 8;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) problems.push("HOUR_OUT_OF_RANGE");

  if (input.cadence === Cadence.WEEKLY) {
    const day = input.dayOfWeek ?? 1;
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      problems.push("DAY_OF_WEEK_OUT_OF_RANGE");
    }
  }

  if (input.cadence === Cadence.MONTHLY) {
    const day = input.dayOfMonth ?? 1;
    // Capped at 28 on purpose: "the 30th" silently means "never" in February, and a
    // newsletter that skips a month once a year is a bug nobody reports for a year.
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      problems.push("DAY_OF_MONTH_OUT_OF_RANGE");
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    definition: {
      cadence: input.cadence,
      interval: input.interval,
      hour,
      dayOfWeek: input.cadence === Cadence.WEEKLY ? (input.dayOfWeek ?? 1) : null,
      dayOfMonth: input.cadence === Cadence.MONTHLY ? (input.dayOfMonth ?? 1) : null,
    },
  };
}

/**
 * The first occurrence strictly AFTER `after`.
 *
 * "Strictly after" matters: computing the next occurrence from the moment a run
 * finished must not return that same moment, or the automation would fire in a loop.
 *
 * Times are computed in UTC. The stored `timezone` is display metadata in v1 — a
 * proper zone-aware calculation needs a tz database, which is not a dependency this
 * milestone justifies, and an hour's drift in when a DRAFT appears harms nobody.
 */
export function nextOccurrence(
  definition: ScheduleDefinition,
  after: Date,
): Date | null {
  const validated = validateSchedule(definition);
  if (!validated.ok) return null;
  const { cadence, interval, dayOfWeek, dayOfMonth, hour } = validated.definition;

  if (cadence === Cadence.WEEKLY) {
    const target = dayOfWeek ?? 1;
    const candidate = new Date(
      Date.UTC(
        after.getUTCFullYear(),
        after.getUTCMonth(),
        after.getUTCDate(),
        hour ?? 8,
        0,
        0,
        0,
      ),
    );

    // Walk forward to the target weekday...
    const dayGap = (target - candidate.getUTCDay() + 7) % 7;
    candidate.setUTCDate(candidate.getUTCDate() + dayGap);
    // ...and past `after` if today's slot has already gone.
    if (candidate.getTime() <= after.getTime()) {
      candidate.setUTCDate(candidate.getUTCDate() + 7);
    }
    // Every-N-weeks: step whole weeks, never partial ones.
    while ((candidate.getTime() - after.getTime()) < 0) {
      candidate.setUTCDate(candidate.getUTCDate() + 7 * interval);
    }
    return candidate;
  }

  const targetDay = dayOfMonth ?? 1;
  const candidate = new Date(
    Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), targetDay, hour ?? 8, 0, 0, 0),
  );
  if (candidate.getTime() <= after.getTime()) {
    candidate.setUTCMonth(candidate.getUTCMonth() + interval);
    // setUTCMonth can overflow the day (31 Jan + 1 month → 2 Mar); the ≤28 cap above
    // makes that impossible, and this re-assert keeps it true if the cap ever moves.
    candidate.setUTCDate(targetDay);
  }
  return candidate;
}

/**
 * Whether an occurrence is due.
 *
 * A missed occurrence stays due — a server that was off on Monday morning still
 * prepares Monday's draft when it comes back, because a draft nobody has looked at
 * yet loses nothing by being a day late. Sending has the opposite rule (ADR-0010:
 * a scheduled send that missed its time does NOT go out late), and the difference is
 * the point: this produces a draft, and a draft harms nobody.
 */
export function isDue(scheduledFor: Date, now: Date): boolean {
  return scheduledFor.getTime() <= now.getTime();
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Plain-language description for staff. No cron strings, no RRULE. */
export function describeSchedule(definition: ScheduleDefinition): string {
  const validated = validateSchedule(definition);
  if (!validated.ok) return "Not scheduled yet";
  const { cadence, interval, dayOfWeek, dayOfMonth, hour } = validated.definition;

  const at = `at ${String(hour ?? 8).padStart(2, "0")}:00`;

  if (cadence === Cadence.WEEKLY) {
    const day = DAY_NAMES[dayOfWeek ?? 1];
    return interval === 1
      ? `Every ${day} ${at}`
      : `Every ${interval} weeks on ${day} ${at}`;
  }

  const ordinal = ordinalDay(dayOfMonth ?? 1);
  return interval === 1
    ? `On the ${ordinal} of every month ${at}`
    : `On the ${ordinal}, every ${interval} months ${at}`;
}

function ordinalDay(day: number): string {
  if (day % 10 === 1 && day !== 11) return `${day}st`;
  if (day % 10 === 2 && day !== 12) return `${day}nd`;
  if (day % 10 === 3 && day !== 13) return `${day}rd`;
  return `${day}th`;
}
