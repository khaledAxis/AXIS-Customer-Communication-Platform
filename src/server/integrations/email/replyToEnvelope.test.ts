import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * What the SMTP adapter actually hands to Nodemailer (ADR-0019).
 *
 * Nodemailer is mocked, so no socket is opened and no email can leave this machine.
 * The assertions are about the envelope: exactly one Reply-To, the From unchanged,
 * the recipient unchanged, no CC/BCC, and — deliberately — no List-Unsubscribe.
 */

const sent = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (payload: Record<string, unknown>) => {
        sent.calls.push(payload);
        return { accepted: [payload.to], rejected: [], messageId: "<mocked>" };
      },
      verify: async () => true,
    }),
  },
}));

const { GmailSmtpEmailProvider } = await import("./gmailSmtpEmailProvider");

const VALID: Record<string, string> = {
  EMAIL_PROVIDER: "gmail_smtp",
  GMAIL_SMTP_USER: "axisgpscana@gmail.com",
  GMAIL_APP_PASSWORD: "abcdefghijklmnop", // shape only — not a real secret
  SAFE_TEST_SENDER: "axisgpscana@gmail.com",
  SAFE_TEST_RECIPIENT: "khaled-s@axis-gps.com",
  NEWSLETTER_REPLY_TO: "noreply@axis-gps.com",
};

const KEYS = [...Object.keys(VALID)];
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  sent.calls = [];
  for (const key of KEYS) original[key] = process.env[key];
  for (const [key, value] of Object.entries(VALID)) process.env[key] = value;
});

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

const message = {
  to: "khaled-s@axis-gps.com",
  subject: "[AXIS TEST] hello",
  html: "<p>hello</p>",
  text: "hello",
  idempotencyKey: "key-1",
};

async function send(overrides: Partial<typeof message> = {}) {
  const provider = new GmailSmtpEmailProvider();
  const result = await provider.sendTestEmail({ ...message, ...overrides });
  return { result, payload: sent.calls[0] };
}

describe("the envelope handed to the mail transport", () => {
  it("sets exactly one Reply-To, as a single string", async () => {
    const { result, payload } = await send();
    expect(result.outcome).toBe("ACCEPTED");
    expect(payload.replyTo).toBe("noreply@axis-gps.com");
    expect(typeof payload.replyTo).toBe("string");
    expect(Array.isArray(payload.replyTo)).toBe(false);
  });

  it("keeps the authenticated sender and adds the AXIS display name", async () => {
    const { payload } = await send();
    expect(payload.from).toEqual({
      name: "AXIS Advanced Mapping Solutions",
      address: "axisgpscana@gmail.com",
    });
  });

  it("keeps the single authorised recipient", async () => {
    const { payload } = await send();
    expect(payload.to).toBe("khaled-s@axis-gps.com");
  });

  it("sets no CC and no BCC", async () => {
    const { payload } = await send();
    expect(payload.cc).toBeUndefined();
    expect(payload.bcc).toBeUndefined();
  });

  it("generates NO List-Unsubscribe header", async () => {
    const { payload } = await send();
    expect(payload.headers).toBeUndefined();
    expect(payload.list).toBeUndefined();
    expect(JSON.stringify(payload)).not.toMatch(/list-unsubscribe/i);
  });

  it("generates NO List-Unsubscribe-Post header", async () => {
    const { payload } = await send();
    expect(JSON.stringify(payload)).not.toMatch(/list-unsubscribe-post/i);
    expect(JSON.stringify(payload)).not.toMatch(/One-Click/i);
  });

  it("follows the configured reply address when it changes", async () => {
    process.env.NEWSLETTER_REPLY_TO = "no-reply@axis-gps.com";
    const { payload } = await send();
    expect(payload.replyTo).toBe("no-reply@axis-gps.com");
  });

  it("cannot be redirected by a caller: the message type carries no reply field", async () => {
    // A hostile caller passing extra fields must not influence the envelope.
    const provider = new GmailSmtpEmailProvider();
    await provider.sendTestEmail({
      ...message,
      // @ts-expect-error — proving these are not part of the contract
      replyTo: "attacker@example.com",
      cc: "attacker@example.com",
      bcc: "attacker@example.com",
      from: "attacker@example.com",
    });
    const payload = sent.calls[0];
    expect(payload.replyTo).toBe("noreply@axis-gps.com");
    expect(payload.cc).toBeUndefined();
    expect(payload.bcc).toBeUndefined();
    expect(payload.from).toEqual({
      name: "AXIS Advanced Mapping Solutions",
      address: "axisgpscana@gmail.com",
    });
  });

  it("refuses to send at all when the configured reply address is malformed", async () => {
    process.env.NEWSLETTER_REPLY_TO = "noreply@axis-gps.com, attacker@example.com";
    const provider = new GmailSmtpEmailProvider();

    // The capability check reports it first...
    const status = provider.checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.problems.join(" ")).toMatch(/NEWSLETTER_REPLY_TO/);

    // ...and the send path refuses rather than falling back to a default.
    const result = await provider.sendTestEmail(message);
    expect(result.outcome).toBe("FAILED");
    expect(sent.calls).toHaveLength(0);
  });

  it("refuses a reply address carrying a smuggled header", async () => {
    process.env.NEWSLETTER_REPLY_TO = "noreply@axis-gps.com\nBcc: victim@example.com";
    const provider = new GmailSmtpEmailProvider();
    const result = await provider.sendTestEmail(message);
    expect(result.outcome).toBe("FAILED");
    expect(sent.calls).toHaveLength(0);
  });

  it("still refuses an unauthorised recipient", async () => {
    const provider = new GmailSmtpEmailProvider();
    await expect(
      provider.sendTestEmail({ ...message, to: "someone@customer.example" }),
    ).rejects.toThrow();
    expect(sent.calls).toHaveLength(0);
  });
});
