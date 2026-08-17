import { describe, it, expect } from "vitest";
import {
  evaluateScheduledSend,
  buildAutomationDraftCampaign,
  ScheduledSendInput,
} from "./scheduledSend";

const base: ScheduledSendInput = {
  approved: true,
  contentReady: true,
  scheduledAt: 1000,
  now: 2000,
  productionEnabled: true,
};

describe("scheduled-send eligibility", () => {
  it("is sendable only when everything is satisfied", () => {
    expect(evaluateScheduledSend(base)).toEqual({ sendable: true });
  });

  it("scheduled time alone cannot make an unapproved campaign sendable", () => {
    expect(evaluateScheduledSend({ ...base, approved: false })).toEqual({
      sendable: false,
      reason: "NOT_APPROVED",
    });
  });

  it("blocks when content is not ready", () => {
    expect(evaluateScheduledSend({ ...base, contentReady: false })).toEqual({
      sendable: false,
      reason: "CONTENT_NOT_READY",
    });
  });

  it("blocks before the scheduled time is reached", () => {
    expect(evaluateScheduledSend({ ...base, now: 500 })).toEqual({
      sendable: false,
      reason: "TIME_NOT_REACHED",
    });
  });

  it("blocks when production mode is disabled (TEST default)", () => {
    expect(evaluateScheduledSend({ ...base, productionEnabled: false })).toEqual({
      sendable: false,
      reason: "PRODUCTION_DISABLED",
    });
  });
});

describe("automation prepares a DRAFT — never bypasses approval or TEST safety", () => {
  const draft = buildAutomationDraftCampaign(
    { id: "auto1", name: "Weekly HE", language: "HE", segmentId: "seg1" },
    "2026-09-07T06:00:00.000Z",
  );

  it("creates a DRAFT that still requires approval", () => {
    expect(draft.status).toBe("DRAFT");
    expect(draft.approved).toBe(false);
  });

  it("defaults to TEST send mode (no production, no send)", () => {
    expect(draft.sendMode).toBe("TEST");
  });

  it("carries the automation + occurrence linkage for idempotency", () => {
    expect(draft.automationId).toBe("auto1");
    expect(draft.scheduledForIso).toBe("2026-09-07T06:00:00.000Z");
    expect(draft.segmentId).toBe("seg1");
  });
});
