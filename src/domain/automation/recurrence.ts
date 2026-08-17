/**
 * Pure recurring-automation rules (ADR-0010).
 *
 * Recurrence is expressed with simple, UI-friendly fields (no RRULE exposed to
 * users). Automation is ASSISTED: it prepares drafts on schedule but never
 * auto-selects external articles nor auto-sends. Occurrence identity powers
 * idempotency so one (automation, occurrence) yields at most one campaign.
 */

export type Cadence = "WEEKLY" | "MONTHLY";

export interface RecurrenceConfig {
  cadence: Cadence;
  interval: number; // every N weeks/months (>= 1)
  dayOfWeek?: number | null; // 0-6 (WEEKLY)
  dayOfMonth?: number | null; // 1-31 (MONTHLY)
  weekOfMonth?: number | null; // optional 1-5 (MONTHLY, nth week + dayOfWeek)
  enabled: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateRecurrence(c: RecurrenceConfig): ValidationResult {
  const errors: string[] = [];

  if (!Number.isInteger(c.interval) || c.interval < 1) {
    errors.push("interval must be an integer >= 1");
  }

  if (c.cadence === "WEEKLY") {
    if (c.dayOfWeek == null || c.dayOfWeek < 0 || c.dayOfWeek > 6) {
      errors.push("weekly cadence requires dayOfWeek in 0..6");
    }
  } else {
    // MONTHLY: either a day-of-month, or an nth-week + day-of-week.
    const hasDayOfMonth = c.dayOfMonth != null;
    const hasNthWeek = c.weekOfMonth != null && c.dayOfWeek != null;
    if (!hasDayOfMonth && !hasNthWeek) {
      errors.push("monthly cadence requires dayOfMonth, or weekOfMonth + dayOfWeek");
    }
    if (hasDayOfMonth && (c.dayOfMonth! < 1 || c.dayOfMonth! > 31)) {
      errors.push("dayOfMonth must be in 1..31");
    }
    if (c.weekOfMonth != null && (c.weekOfMonth < 1 || c.weekOfMonth > 5)) {
      errors.push("weekOfMonth must be in 1..5");
    }
  }

  return { valid: errors.length === 0, errors };
}

/** An automation only produces occurrences while enabled (not paused). */
export function isAutomationActive(c: Pick<RecurrenceConfig, "enabled">): boolean {
  return c.enabled === true;
}

/**
 * Deterministic identity for one scheduled occurrence — mirrors the DB unique
 * constraint `NewsletterAutomationRun(automationId, scheduledFor)`.
 * `scheduledForIso` must be a stable ISO timestamp for the occurrence.
 */
export function occurrenceKey(automationId: string, scheduledForIso: string): string {
  return `${automationId}::${scheduledForIso}`;
}

/** Idempotency guard: whether a run should be created for this occurrence. */
export function shouldCreateRun(
  existingKeys: ReadonlySet<string>,
  automationId: string,
  scheduledForIso: string,
): boolean {
  return !existingKeys.has(occurrenceKey(automationId, scheduledForIso));
}
