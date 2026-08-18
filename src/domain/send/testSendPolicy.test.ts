import { describe, it, expect } from "vitest";

import { defaultSendMode, resolveDelivery } from "./safeSend";
import {
  AUTHORIZED_TEST_RECIPIENT,
  AUTHORIZED_TEST_SENDER,
  UnauthorizedTestRecipientError,
  assertAuthorizedTestRecipient,
  isAuthorizedTestRecipient,
  isAuthorizedTestSender,
  testSendAvailability,
  testSendConfig,
} from "./testSendPolicy";

describe("authorized test addresses", () => {
  it("has exactly one authorized recipient", () => {
    expect(AUTHORIZED_TEST_RECIPIENT).toBe("khaled-s@axis-gps.com");
  });

  it("has exactly one authorized sender", () => {
    expect(AUTHORIZED_TEST_SENDER).toBe("fahed@axis-gps.com");
  });

  it("accepts the authorized recipient regardless of case or padding", () => {
    expect(isAuthorizedTestRecipient("khaled-s@axis-gps.com")).toBe(true);
    expect(isAuthorizedTestRecipient("  KHALED-S@AXIS-GPS.COM  ")).toBe(true);
  });

  it("rejects every other recipient", () => {
    for (const attempted of [
      "someone-else@axis-gps.com",
      "real.customer@bigco.com",
      "khaled-s@evil.com",
      "khaled-s@axis-gps.com.evil.com",
      "attacker@example.com",
      "",
      null,
      undefined,
    ]) {
      expect(isAuthorizedTestRecipient(attempted)).toBe(false);
    }
  });

  it("throws when an arbitrary recipient is submitted", () => {
    expect(() => assertAuthorizedTestRecipient("customer@bigco.com")).toThrow(
      UnauthorizedTestRecipientError,
    );
    expect(() => assertAuthorizedTestRecipient(null)).toThrow(UnauthorizedTestRecipientError);
  });

  it("returns the canonical address when the recipient is authorized", () => {
    expect(assertAuthorizedTestRecipient("KHALED-S@axis-gps.com")).toBe(AUTHORIZED_TEST_RECIPIENT);
  });

  it("recognises only the authorized sender", () => {
    expect(isAuthorizedTestSender("fahed@axis-gps.com")).toBe(true);
    expect(isAuthorizedTestSender("someone@axis-gps.com")).toBe(false);
  });
});

describe("test send configuration", () => {
  it("is always TEST mode", () => {
    expect(testSendConfig().mode).toBe("TEST");
  });

  it("uses only the two authorized addresses", () => {
    const config = testSendConfig();
    expect(config.safeFrom).toBe(AUTHORIZED_TEST_SENDER);
    expect(config.safeRedirectTo).toBe(AUTHORIZED_TEST_RECIPIENT);
    expect(config.productionFrom).toBeUndefined();
  });

  it("redirects any intended customer address to the safe address", () => {
    const delivery = resolveDelivery("real.customer@bigco.com", testSendConfig());
    expect(delivery.toEmail).toBe(AUTHORIZED_TEST_RECIPIENT);
    expect(delivery.toEmail).not.toBe("real.customer@bigco.com");
    expect(delivery.fromEmail).toBe(AUTHORIZED_TEST_SENDER);
    expect(delivery.isRedirected).toBe(true);
  });

  it("keeps TEST as the system default", () => {
    expect(defaultSendMode()).toBe("TEST");
  });
});

describe("test send availability — nothing can be sent yet", () => {
  it("reports that sending is unavailable", () => {
    expect(testSendAvailability().canSend).toBe(false);
  });

  it("explains that no email provider is configured", () => {
    const availability = testSendAvailability();
    expect(availability.reason).toBe("EMAIL_PROVIDER_NOT_CONFIGURED");
    expect(availability.message).toMatch(/not configured/i);
  });

  it("never reports sendable, whatever it is called with", () => {
    for (let i = 0; i < 5; i += 1) {
      expect(testSendAvailability().canSend).toBe(false);
    }
  });

  it("exposes no send function — this module cannot deliver mail", () => {
    // Guards against a future refactor quietly adding a sender here.
    const api = { assertAuthorizedTestRecipient, testSendAvailability, testSendConfig };
    for (const value of Object.values(api)) {
      expect(String(value)).not.toMatch(/fetch\(|https?:\/\/[a-z]/i);
    }
  });
});
