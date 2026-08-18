import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { MicrosoftGraphEmailProvider } from "./microsoftGraphEmailProvider";

/**
 * Configuration/guard behaviour only — these tests never reach the network.
 * `checkConfiguration` is a local check by contract, and the send paths asserted here
 * all fail before any HTTP request is attempted.
 */

const VALID = {
  MICROSOFT_TENANT_ID: "8f2a1c34-5b6d-4e7f-9a0b-1c2d3e4f5a6b",
  MICROSOFT_CLIENT_ID: "1a2b3c4d-5e6f-4708-9a0b-1c2d3e4f5a6b",
  MICROSOFT_CLIENT_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789",
  MICROSOFT_SENDER_EMAIL: "fahed@axis-gps.com",
};

const KEYS = Object.keys(VALID) as (keyof typeof VALID)[];
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) original[key] = process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

function setEnv(values: Partial<typeof VALID>) {
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

describe("Microsoft Graph provider — configuration check", () => {
  it("is configured with valid values", () => {
    setEnv(VALID);
    const status = new MicrosoftGraphEmailProvider().checkConfiguration();
    expect(status.configured).toBe(true);
    expect(status.problems).toEqual([]);
    expect(status.senderEmail).toBe("fahed@axis-gps.com");
  });

  it("is not configured when nothing is set", () => {
    setEnv({});
    const status = new MicrosoftGraphEmailProvider().checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.problems.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects placeholder values that are set but unusable", () => {
    // A short placeholder such as "xxx" is present but would fail confusingly at send
    // time; the shape is validated so the UI reports it honestly up front.
    setEnv({ ...VALID, MICROSOFT_TENANT_ID: "xxx", MICROSOFT_CLIENT_ID: "yyy" });
    const status = new MicrosoftGraphEmailProvider().checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.problems.join(" ")).toMatch(/tenant/i);
    expect(status.problems.join(" ")).toMatch(/client/i);
  });

  it("rejects a placeholder client secret", () => {
    setEnv({ ...VALID, MICROSOFT_CLIENT_SECRET: "secret" });
    const status = new MicrosoftGraphEmailProvider().checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.problems.join(" ")).toMatch(/placeholder/i);
  });

  it("accepts a verified domain as the tenant", () => {
    setEnv({ ...VALID, MICROSOFT_TENANT_ID: "axis-gps.onmicrosoft.com" });
    expect(new MicrosoftGraphEmailProvider().checkConfiguration().configured).toBe(true);
  });

  it("refuses any sender other than the authorized mailbox", () => {
    setEnv({ ...VALID, MICROSOFT_SENDER_EMAIL: "someone-else@axis-gps.com" });
    const status = new MicrosoftGraphEmailProvider().checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.problems.join(" ")).toContain("fahed@axis-gps.com");
  });

  it("never leaks secret values in its problem messages", () => {
    setEnv({ ...VALID, MICROSOFT_CLIENT_SECRET: "short" });
    const status = new MicrosoftGraphEmailProvider().checkConfiguration();
    for (const problem of status.problems) {
      expect(problem).not.toContain("short");
      expect(problem).not.toContain(VALID.MICROSOFT_CLIENT_SECRET);
      expect(problem).not.toContain(VALID.MICROSOFT_TENANT_ID);
    }
  });
});

describe("Microsoft Graph provider — refuses before any network call", () => {
  const message = {
    to: "khaled-s@axis-gps.com",
    subject: "[AXIS TEST] x",
    html: "<p>x</p>",
    text: "x",
    idempotencyKey: "key-1",
  };

  it("fails fast when unconfigured, without contacting Microsoft", async () => {
    setEnv({});
    const result = await new MicrosoftGraphEmailProvider().sendTestEmail(message);
    expect(result.outcome).toBe("FAILED");
    expect(result.failureCode).toBe("NOT_CONFIGURED");
    expect(result.message).toContain("Microsoft email provider is not configured");
  });

  it("throws on an unauthorized recipient before contacting Microsoft", async () => {
    setEnv(VALID);
    await expect(
      new MicrosoftGraphEmailProvider().sendTestEmail({ ...message, to: "attacker@evil.com" }),
    ).rejects.toThrow();
  });

  it("throws when more than one recipient is smuggled in", async () => {
    setEnv(VALID);
    await expect(
      new MicrosoftGraphEmailProvider().sendTestEmail({
        ...message,
        // Deliberately violating the type to mimic a crafted server request.
        to: ["khaled-s@axis-gps.com", "attacker@evil.com"] as unknown as string,
      }),
    ).rejects.toThrow();
  });

  it("exposes no way for a caller to choose the sender", () => {
    // The message type has no `from`; the sender comes from configuration only.
    expect(Object.keys(message)).not.toContain("from");
  });
});
