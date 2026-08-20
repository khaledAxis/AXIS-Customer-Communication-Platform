import { describe, expect, it } from "vitest";

import {
  AUTHORIZED_PILOT_RECIPIENT,
  PILOT_SUBJECT_PREFIX,
  PRODUCTION_SENDER_EMAIL,
  UnsafePilotEnvelopeError,
  applyPilotSubjectPrefix,
  assertSafePilotEnvelope,
  evaluatePilotAvailability,
  isAuthorizedPilotRecipient,
} from "./pilotPolicy";

/**
 * The pilot audience must be impossible to widen (ADR-0025).
 *
 * These tests are the reason the constants are constants. Every case below is a way
 * someone could accidentally turn a one-address internal test into mail sent to
 * somebody else, and each must be REFUSED — never trimmed into something that looks
 * safe and is not.
 */

describe("pilot recipient allowlist", () => {
  it("accepts only the single authorized internal address", () => {
    expect(AUTHORIZED_PILOT_RECIPIENT).toBe("khaled-s@axis-gps.com");
    expect(isAuthorizedPilotRecipient("khaled-s@axis-gps.com")).toBe(true);
    // Case and surrounding space are normalized; identity is not.
    expect(isAuthorizedPilotRecipient("  KHALED-S@AXIS-GPS.COM ")).toBe(true);
  });

  it("rejects every other address, including near-misses", () => {
    for (const address of [
      "customer@example.com",
      "khaled-s@axis-gps.com.evil.test",
      "khaled-s@axis-gps.co",
      "someone+khaled-s@axis-gps.com",
      "khaled-s@sub.axis-gps.com",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(isAuthorizedPilotRecipient(address)).toBe(false);
    }
  });

  it("refuses a customer address at the envelope gate", () => {
    expect(() => assertSafePilotEnvelope({ to: "customer@example.com" })).toThrow(
      UnsafePilotEnvelopeError,
    );
  });

  it("refuses a second recipient smuggled into one string", () => {
    for (const to of [
      "khaled-s@axis-gps.com,customer@example.com",
      "khaled-s@axis-gps.com; customer@example.com",
    ]) {
      expect(() => assertSafePilotEnvelope({ to })).toThrow(/exactly one recipient/i);
    }
  });

  it("refuses an array of recipients even when every entry is authorized", () => {
    expect(() =>
      assertSafePilotEnvelope({
        to: [AUTHORIZED_PILOT_RECIPIENT, AUTHORIZED_PILOT_RECIPIENT],
      }),
    ).toThrow(/exactly one recipient/i);
  });

  it("REFUSES cc and bcc rather than dropping them", () => {
    // Trimming would be the dangerous choice: a caller that supplied a cc has
    // misunderstood something, and continuing hides the misunderstanding.
    expect(() =>
      assertSafePilotEnvelope({ to: AUTHORIZED_PILOT_RECIPIENT, cc: "x@example.com" }),
    ).toThrow(/CC or BCC/i);
    expect(() =>
      assertSafePilotEnvelope({ to: AUTHORIZED_PILOT_RECIPIENT, bcc: "" }),
    ).toThrow(/CC or BCC/i);
  });

  it("refuses header injection in the recipient", () => {
    expect(() =>
      assertSafePilotEnvelope({
        to: "khaled-s@axis-gps.com\r\nBcc: everyone@example.com",
      }),
    ).toThrow(UnsafePilotEnvelopeError);
  });

  it("refuses any sender other than the production address", () => {
    expect(() =>
      assertSafePilotEnvelope({
        to: AUTHORIZED_PILOT_RECIPIENT,
        from: "axisgpscana@gmail.com",
      }),
    ).toThrow(/newsletter@axis-gps.com/);

    expect(
      assertSafePilotEnvelope({
        to: AUTHORIZED_PILOT_RECIPIENT,
        from: PRODUCTION_SENDER_EMAIL,
      }),
    ).toBe(AUTHORIZED_PILOT_RECIPIENT);
  });

  it("returns the constant, not the caller's string", () => {
    // Even a valid caller value is discarded in favour of the constant, so a subtle
    // homoglyph or trailing character can never survive the gate.
    expect(assertSafePilotEnvelope({ to: " Khaled-S@Axis-GPS.com " })).toBe(
      AUTHORIZED_PILOT_RECIPIENT,
    );
  });
});

describe("pilot subject marker", () => {
  it("marks the subject so it cannot be mistaken for a customer newsletter", () => {
    expect(applyPilotSubjectPrefix("March update")).toBe(
      `${PILOT_SUBJECT_PREFIX} March update`,
    );
  });

  it("is idempotent across re-render, re-approval and re-send", () => {
    const once = applyPilotSubjectPrefix("March update");
    expect(applyPilotSubjectPrefix(once)).toBe(once);
    expect(applyPilotSubjectPrefix(applyPilotSubjectPrefix(once))).toBe(once);
  });
});

describe("pilot availability", () => {
  const ready = {
    providerConfigured: true,
    pilotModeEnabled: true,
    domainVerified: true,
    hasContent: true,
  };

  it("is available only when every precondition holds", () => {
    expect(evaluatePilotAvailability(ready).available).toBe(true);
    expect(evaluatePilotAvailability(ready).blockers).toEqual([]);
  });

  it("blocks when the pilot switch is off, however complete everything else is", () => {
    const result = evaluatePilotAvailability({ ...ready, pilotModeEnabled: false });
    expect(result.available).toBe(false);
    expect(result.blockers).toContain("PILOT_MODE_OFF");
  });

  it("blocks on an unverified domain — a pilot from one proves nothing", () => {
    const result = evaluatePilotAvailability({ ...ready, domainVerified: false });
    expect(result.available).toBe(false);
    expect(result.blockers).toContain("DOMAIN_NOT_VERIFIED");
  });

  it("reports every blocker at once, so a user is not led through them one by one", () => {
    const result = evaluatePilotAvailability({
      providerConfigured: false,
      pilotModeEnabled: false,
      domainVerified: false,
      hasContent: false,
    });
    expect(result.blockers).toHaveLength(4);
    expect(result.messages.every((message) => message.length > 0)).toBe(true);
  });
});
