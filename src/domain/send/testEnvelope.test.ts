import { describe, it, expect } from "vitest";

import {
  AUTHORIZED_TEST_RECIPIENT,
  AUTHORIZED_TEST_SENDER,
  UnauthorizedTestSenderError,
  UnsafeTestEnvelopeError,
  assertAuthorizedTestSender,
  assertSafeTestEnvelope,
} from "./testSendPolicy";

/**
 * The envelope guard is the last line between the application and a real mailbox.
 * These cases are deliberately hostile.
 */

describe("envelope: recipient", () => {
  it("accepts the single authorized recipient", () => {
    expect(assertSafeTestEnvelope({ to: AUTHORIZED_TEST_RECIPIENT })).toBe(AUTHORIZED_TEST_RECIPIENT);
  });

  it("accepts a one-element array", () => {
    expect(assertSafeTestEnvelope({ to: [AUTHORIZED_TEST_RECIPIENT] })).toBe(
      AUTHORIZED_TEST_RECIPIENT,
    );
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(assertSafeTestEnvelope({ to: "  KHALED-S@AXIS-GPS.COM  " })).toBe(
      AUTHORIZED_TEST_RECIPIENT,
    );
  });

  it.each([
    "someone@axis-gps.com",
    "khaled-s@evil.com",
    "khaled-s@axis-gps.com.evil.com",
    "evil.com/khaled-s@axis-gps.com",
    "khaled-s@axis-gps.com.",
    "khaled-s+injected@axis-gps.com",
    "real.customer@bigco.com",
    "",
    "   ",
  ])("rejects the unauthorized recipient %j", (address) => {
    expect(() => assertSafeTestEnvelope({ to: address })).toThrow(UnsafeTestEnvelopeError);
  });

  it("rejects a display-name form that hides another address", () => {
    expect(() =>
      assertSafeTestEnvelope({ to: '"khaled-s@axis-gps.com" <attacker@evil.com>' }),
    ).toThrow(UnsafeTestEnvelopeError);
  });
});

describe("envelope: audience cannot widen", () => {
  it("rejects more than one recipient", () => {
    expect(() =>
      assertSafeTestEnvelope({ to: [AUTHORIZED_TEST_RECIPIENT, "someone@axis-gps.com"] }),
    ).toThrow(UnsafeTestEnvelopeError);
  });

  it("rejects an empty recipient list", () => {
    expect(() => assertSafeTestEnvelope({ to: [] })).toThrow(UnsafeTestEnvelopeError);
  });

  it("rejects two copies of even the authorized address", () => {
    // Otherwise a caller could cause two deliveries in one submission.
    expect(() =>
      assertSafeTestEnvelope({ to: [AUTHORIZED_TEST_RECIPIENT, AUTHORIZED_TEST_RECIPIENT] }),
    ).toThrow(UnsafeTestEnvelopeError);
  });

  it("rejects CC in any form", () => {
    for (const cc of ["x@evil.com", ["x@evil.com"], [AUTHORIZED_TEST_RECIPIENT]]) {
      expect(() => assertSafeTestEnvelope({ to: AUTHORIZED_TEST_RECIPIENT, cc })).toThrow(
        UnsafeTestEnvelopeError,
      );
    }
  });

  it("rejects BCC in any form", () => {
    for (const bcc of ["x@evil.com", ["x@evil.com"]]) {
      expect(() => assertSafeTestEnvelope({ to: AUTHORIZED_TEST_RECIPIENT, bcc })).toThrow(
        UnsafeTestEnvelopeError,
      );
    }
  });

  it("rejects a reply-to override", () => {
    expect(() =>
      assertSafeTestEnvelope({ to: AUTHORIZED_TEST_RECIPIENT, replyTo: "x@evil.com" }),
    ).toThrow(UnsafeTestEnvelopeError);
  });

  it("ignores empty/absent cc and bcc rather than failing", () => {
    expect(
      assertSafeTestEnvelope({ to: AUTHORIZED_TEST_RECIPIENT, cc: [], bcc: undefined, replyTo: "" }),
    ).toBe(AUTHORIZED_TEST_RECIPIENT);
  });

  it("names the reason it refused", () => {
    try {
      assertSafeTestEnvelope({ to: AUTHORIZED_TEST_RECIPIENT, bcc: "x@evil.com" });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as UnsafeTestEnvelopeError).reason).toBe("BCC_NOT_ALLOWED");
    }
  });
});

describe("envelope: sender", () => {
  it("accepts the authorized sender", () => {
    expect(assertAuthorizedTestSender(AUTHORIZED_TEST_SENDER)).toBe(AUTHORIZED_TEST_SENDER);
    expect(assertAuthorizedTestSender("  FAHED@AXIS-GPS.COM ")).toBe(AUTHORIZED_TEST_SENDER);
  });

  it.each([
    "someone@axis-gps.com",
    "fahed@evil.com",
    "fahed@axis-gps.com.evil.com",
    "khaled-s@axis-gps.com",
    "",
  ])("rejects the unauthorized sender %j", (address) => {
    expect(() => assertAuthorizedTestSender(address)).toThrow(UnauthorizedTestSenderError);
  });

  it("rejects a null or undefined sender", () => {
    expect(() => assertAuthorizedTestSender(null)).toThrow(UnauthorizedTestSenderError);
    expect(() => assertAuthorizedTestSender(undefined)).toThrow(UnauthorizedTestSenderError);
  });
});
