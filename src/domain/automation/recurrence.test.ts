import { describe, it, expect } from "vitest";
import {
  validateRecurrence,
  isAutomationActive,
  occurrenceKey,
  shouldCreateRun,
  RecurrenceConfig,
} from "./recurrence";

const cfg = (over: Partial<RecurrenceConfig>): RecurrenceConfig => ({
  cadence: "WEEKLY",
  interval: 1,
  dayOfWeek: 1,
  enabled: true,
  ...over,
});

describe("recurrence validation", () => {
  it("accepts a valid weekly config", () => {
    expect(validateRecurrence(cfg({ cadence: "WEEKLY", dayOfWeek: 1 })).valid).toBe(true);
  });

  it("accepts a valid monthly config (day of month)", () => {
    expect(
      validateRecurrence(cfg({ cadence: "MONTHLY", dayOfWeek: null, dayOfMonth: 1 })).valid,
    ).toBe(true);
  });

  it("accepts a valid monthly config (nth week + day of week)", () => {
    expect(
      validateRecurrence(cfg({ cadence: "MONTHLY", weekOfMonth: 1, dayOfWeek: 1 })).valid,
    ).toBe(true);
  });

  it("rejects weekly without dayOfWeek", () => {
    expect(validateRecurrence(cfg({ cadence: "WEEKLY", dayOfWeek: null })).valid).toBe(false);
  });

  it("rejects interval < 1", () => {
    expect(validateRecurrence(cfg({ interval: 0 })).valid).toBe(false);
  });

  it("rejects out-of-range day of month", () => {
    expect(
      validateRecurrence(cfg({ cadence: "MONTHLY", dayOfWeek: null, dayOfMonth: 40 })).valid,
    ).toBe(false);
  });
});

describe("automation active/paused", () => {
  it("is active when enabled and paused when disabled", () => {
    expect(isAutomationActive({ enabled: true })).toBe(true);
    expect(isAutomationActive({ enabled: false })).toBe(false);
  });
});

describe("occurrence idempotency", () => {
  it("produces a deterministic occurrence key", () => {
    expect(occurrenceKey("auto1", "2026-09-07T06:00:00.000Z")).toBe(
      occurrenceKey("auto1", "2026-09-07T06:00:00.000Z"),
    );
  });

  it("does not create a second run for the same occurrence", () => {
    const seen = new Set<string>();
    const key = occurrenceKey("auto1", "2026-09-07T06:00:00.000Z");
    expect(shouldCreateRun(seen, "auto1", "2026-09-07T06:00:00.000Z")).toBe(true);
    seen.add(key);
    expect(shouldCreateRun(seen, "auto1", "2026-09-07T06:00:00.000Z")).toBe(false);
  });
});
