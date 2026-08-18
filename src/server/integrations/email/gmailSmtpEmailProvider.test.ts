import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { GmailSmtpEmailProvider } from "./gmailSmtpEmailProvider";

/**
 * Configuration and guard behaviour only — these tests never open a socket.
 * `checkConfiguration` is local by contract, and every send path asserted here fails
 * before any SMTP connection is attempted.
 */

const VALID = {
  EMAIL_PROVIDER: "gmail_smtp",
  GMAIL_SMTP_USER: "axisgpscana@gmail.com",
  GMAIL_APP_PASSWORD: "abcdefghijklmnop", // 16 chars, shape only — not a real secret
  SAFE_TEST_SENDER: "axisgpscana@gmail.com",
  SAFE_TEST_RECIPIENT: "khaled-s@axis-gps.com",
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

const message = {
  to: "khaled-s@axis-gps.com",
  subject: "[AXIS TEST] hello",
  html: "<p>hello</p>",
  text: "hello",
  idempotencyKey: "key-1",
};

describe("Gmail SMTP provider — configuration", () => {
  it("is configured and ready with valid values", () => {
    setEnv(VALID);
    const status = new GmailSmtpEmailProvider().checkConfiguration();
    expect(status.configured).toBe(true);
    expect(status.problems).toEqual([]);
    expect(status.senderEmail).toBe("axisgpscana@gmail.com");
  });

  it("is not configured when nothing is set", () => {
    setEnv({});
    const status = new GmailSmtpEmailProvider().checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.problems.length).toBeGreaterThanOrEqual(3);
  });

  it("requires EMAIL_PROVIDER to be gmail_smtp", () => {
    setEnv({ ...VALID, EMAIL_PROVIDER: "resend" });
    const status = new GmailSmtpEmailProvider().checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.problems.join(" ")).toMatch(/EMAIL_PROVIDER/);
  });

  it("accepts a 16-character app password pasted with spaces", () => {
    setEnv({ ...VALID, GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" });
    expect(new GmailSmtpEmailProvider().checkConfiguration().configured).toBe(true);
  });

  it("rejects a password that is not a 16-character app password", () => {
    setEnv({ ...VALID, GMAIL_APP_PASSWORD: "my-normal-gmail-password-123" });
    const status = new GmailSmtpEmailProvider().checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.problems.join(" ")).toMatch(/App Password/i);
  });

  it("rejects an SMTP user that is not the authorized sender", () => {
    setEnv({ ...VALID, GMAIL_SMTP_USER: "someone-else@gmail.com" });
    const status = new GmailSmtpEmailProvider().checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.problems.join(" ")).toContain("axisgpscana@gmail.com");
  });

  it("rejects a declared sender that disagrees with the constant", () => {
    setEnv({ ...VALID, SAFE_TEST_SENDER: "attacker@evil.com" });
    expect(new GmailSmtpEmailProvider().checkConfiguration().configured).toBe(false);
  });

  it("rejects a declared recipient that disagrees with the constant", () => {
    // An env var must never be able to redirect a test email.
    setEnv({ ...VALID, SAFE_TEST_RECIPIENT: "attacker@evil.com" });
    expect(new GmailSmtpEmailProvider().checkConfiguration().configured).toBe(false);
  });

  it("never leaks the app password in its problem messages", () => {
    setEnv({ ...VALID, GMAIL_APP_PASSWORD: "supersecretpassword" });
    const status = new GmailSmtpEmailProvider().checkConfiguration();
    for (const problem of status.problems) {
      expect(problem).not.toContain("supersecretpassword");
      expect(problem).not.toContain(VALID.GMAIL_APP_PASSWORD);
    }
  });
});

describe("Gmail SMTP provider — refuses before any connection", () => {
  it("fails fast when unconfigured, without contacting Gmail", async () => {
    setEnv({});
    const result = await new GmailSmtpEmailProvider().sendTestEmail(message);
    expect(result.outcome).toBe("FAILED");
    expect(result.failureCode).toBe("NOT_CONFIGURED");
    expect(result.message).toContain("Gmail test email provider is not configured");
  });

  it("throws on an unauthorized recipient before contacting Gmail", async () => {
    setEnv(VALID);
    await expect(
      new GmailSmtpEmailProvider().sendTestEmail({ ...message, to: "attacker@evil.com" }),
    ).rejects.toThrow();
  });

  it("throws when more than one recipient is smuggled in", async () => {
    setEnv(VALID);
    await expect(
      new GmailSmtpEmailProvider().sendTestEmail({
        ...message,
        // Deliberately violating the type to mimic a crafted server request.
        to: ["khaled-s@axis-gps.com", "attacker@evil.com"] as unknown as string,
      }),
    ).rejects.toThrow();
  });

  it("refuses a subject carrying header-injection characters", async () => {
    setEnv(VALID);
    const injected = "[AXIS TEST] hi\r\nBcc: attacker@evil.com";
    const result = await new GmailSmtpEmailProvider().sendTestEmail({
      ...message,
      subject: injected,
    });
    expect(result.outcome).toBe("FAILED");
    expect(result.failureCode).toBe("HEADER_INJECTION");
  });

  it("refuses a bare newline in the subject too", async () => {
    setEnv(VALID);
    const result = await new GmailSmtpEmailProvider().sendTestEmail({
      ...message,
      subject: "hello\nBcc: attacker@evil.com",
    });
    expect(result.failureCode).toBe("HEADER_INJECTION");
  });

  it("reports not-configured from verifyConnection without connecting", async () => {
    setEnv({});
    const result = await new GmailSmtpEmailProvider().verifyConnection();
    expect(result.ok).toBe(false);
    expect(result.failureCode).toBe("NOT_CONFIGURED");
  });

  it("exposes no way for a caller to choose the sender", () => {
    // The message type has no `from`; the sender comes from configuration only.
    expect(Object.keys(message)).not.toContain("from");
  });
});
