import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unknownDomainAuth } from "../../../domain/delivery/domainAuth";
import { ProviderEventType } from "../../../domain/delivery/providerEvent";
import {
  ResendProductionEmailProvider,
  normalizeResendEvent,
  productionSendingDomain,
  providerPilotEnabled,
} from "./resendProductionEmailProvider";

/**
 * The Resend adapter (ADR-0025).
 *
 * NO TEST HERE MAKES A NETWORK CALL. Every case exercises the guards that run before
 * one would happen, or the pure translation of a webhook payload. A test that could
 * reach a real provider would be a way for CI to email somebody.
 */

const ENV_KEYS = [
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "PROVIDER_PILOT_ENABLED",
  "PRODUCTION_DELIVERY_ENABLED",
  "NEWSLETTER_REPLY_TO",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("configuration reporting", () => {
  it("reports itself unconfigured when no API key is present", () => {
    const status = new ResendProductionEmailProvider().checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.problems.join(" ")).toMatch(/RESEND_API_KEY is not set/);
  });

  it("refuses a placeholder key on SHAPE, not merely on presence", () => {
    process.env.RESEND_API_KEY = "your-key-here";
    const status = new ResendProductionEmailProvider().checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.problems.join(" ")).toMatch(/should begin with/i);
  });

  it("never echoes the key, or any part of it, in its problems", () => {
    process.env.RESEND_API_KEY = "re_abcdefghijklmnopqrstuvwxyz";
    const status = new ResendProductionEmailProvider().checkConfiguration();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("abcdefghij");
    expect(serialized).not.toContain("re_");
  });

  it("keeps `configured` and `enabled` separate — a key is not permission", () => {
    process.env.RESEND_API_KEY = "re_abcdefghijklmnopqrstuvwxyz";
    const status = new ResendProductionEmailProvider().checkConfiguration();
    expect(status.configured).toBe(true);
    expect(status.enabled).toBe(false);
  });

  it("reports the domain as unverified until the provider has said otherwise", () => {
    process.env.RESEND_API_KEY = "re_abcdefghijklmnopqrstuvwxyz";
    const status = new ResendProductionEmailProvider(
      unknownDomainAuth("axis-gps.com"),
    ).checkConfiguration();
    expect(status.domain.spf).toBe("UNKNOWN");
    expect(status.domain.dkim).toBe("UNKNOWN");
    expect(status.domain.dmarc).toBe("UNKNOWN");
    expect(status.problems.join(" ")).toMatch(/has not been checked/i);
  });

  it("sends as the AXIS production address, and derives the domain from it", () => {
    const status = new ResendProductionEmailProvider().checkConfiguration();
    expect(status.senderEmail).toBe("newsletter@axis-gps.com");
    expect(productionSendingDomain()).toBe("axis-gps.com");
  });

  it("treats the pilot switch as off unless it is exactly true", () => {
    expect(providerPilotEnabled()).toBe(false);
    process.env.PROVIDER_PILOT_ENABLED = "TRUE";
    expect(providerPilotEnabled()).toBe(false);
    process.env.PROVIDER_PILOT_ENABLED = "1";
    expect(providerPilotEnabled()).toBe(false);
    process.env.PROVIDER_PILOT_ENABLED = "true";
    expect(providerPilotEnabled()).toBe(true);
  });
});

describe("sending guards (no network reached)", () => {
  const message = {
    subject: "Hello",
    html: "<p>hi</p>",
    text: "hi",
    idempotencyKey: "key-1",
  };

  it("throws instead of returning a benign result when unconfigured", async () => {
    await expect(
      new ResendProductionEmailProvider().send({
        ...message,
        to: "khaled-s@axis-gps.com",
      }),
    ).rejects.toThrow(/not configured/i);
  });

  it("refuses a non-allowlisted recipient BEFORE any provider call", async () => {
    process.env.RESEND_API_KEY = "re_abcdefghijklmnopqrstuvwxyz";
    process.env.NEWSLETTER_REPLY_TO = "noreply@axis-gps.com";
    await expect(
      new ResendProductionEmailProvider().send({
        ...message,
        to: "customer@example.com",
      }),
    ).rejects.toThrow(/khaled-s@axis-gps.com/);
  });

  it("refuses a subject carrying a newline (SMTP header smuggling)", async () => {
    process.env.RESEND_API_KEY = "re_abcdefghijklmnopqrstuvwxyz";
    process.env.NEWSLETTER_REPLY_TO = "noreply@axis-gps.com";
    await expect(
      new ResendProductionEmailProvider().send({
        ...message,
        subject: "Hello\r\nBcc: everyone@example.com",
        to: "khaled-s@axis-gps.com",
      }),
    ).rejects.toThrow(/not allowed/i);
  });

  it("refuses a malformed reply address rather than repairing it", async () => {
    process.env.RESEND_API_KEY = "re_abcdefghijklmnopqrstuvwxyz";
    process.env.NEWSLETTER_REPLY_TO = "one@axis-gps.com, two@axis-gps.com";
    await expect(
      new ResendProductionEmailProvider().send({
        ...message,
        to: "khaled-s@axis-gps.com",
      }),
    ).rejects.toThrow();
  });
});

describe("webhook verification", () => {
  const provider = new ResendProductionEmailProvider();

  it("refuses everything when no signing secret is configured", () => {
    const result = provider.verifyWebhook({ rawBody: "{}", headers: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("UNSIGNED");
  });

  it("refuses a request with no signature headers", () => {
    process.env.RESEND_WEBHOOK_SECRET = "whsec_abcdefghijklmnop";
    const result = provider.verifyWebhook({
      rawBody: JSON.stringify({ type: "email.bounced" }),
      headers: { "content-type": "application/json" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toMatch(/@/); // no address is echoed
  });

  it("refuses a forged signature", () => {
    process.env.RESEND_WEBHOOK_SECRET = "whsec_YWJjZGVmZ2hpamtsbW5vcA==";
    const result = provider.verifyWebhook({
      rawBody: JSON.stringify({
        type: "email.bounced",
        data: { to: ["customer@example.com"] },
      }),
      headers: {
        "svix-id": "msg_1",
        "svix-timestamp": "1700000000",
        "svix-signature": "v1,not-a-real-signature",
      },
    });
    expect(result.ok).toBe(false);
  });
});

describe("normalizing Resend events", () => {
  const base = { email_id: "re_msg_1", to: ["khaled-s@axis-gps.com"] };

  it("maps email.sent to ACCEPTED — never to DELIVERED", () => {
    const event = normalizeResendEvent(
      { type: "email.sent", created_at: "2026-08-20T10:00:00Z", data: base },
      "msg_1",
    );
    expect(event?.type).toBe(ProviderEventType.ACCEPTED);
  });

  it("maps email.delivered to DELIVERED", () => {
    const event = normalizeResendEvent({ type: "email.delivered", data: base }, "m");
    expect(event?.type).toBe(ProviderEventType.DELIVERED);
  });

  it("distinguishes a permanent bounce from a transient one", () => {
    const hard = normalizeResendEvent(
      {
        type: "email.bounced",
        data: { ...base, bounce: { type: "Permanent", subType: "NoEmail" } },
      },
      "m1",
    );
    const soft = normalizeResendEvent(
      {
        type: "email.bounced",
        data: { ...base, bounce: { type: "Transient", subType: "MailboxFull" } },
      },
      "m2",
    );
    expect(hard?.type).toBe(ProviderEventType.HARD_BOUNCE);
    // A full mailbox must never permanently block a working address.
    expect(soft?.type).toBe(ProviderEventType.SOFT_BOUNCE);
  });

  it("maps a complaint, and carries a short sanitized reason only", () => {
    const event = normalizeResendEvent(
      {
        type: "email.complained",
        data: { ...base, bounce: { type: "Permanent", subType: "Suppressed" } },
      },
      "m3",
    );
    expect(event?.type).toBe(ProviderEventType.COMPLAINT);
    expect(event?.reason).toBe("Permanent / Suppressed");
    expect((event?.reason ?? "").length).toBeLessThanOrEqual(120);
  });

  it("ignores signed events the platform does not act on", () => {
    for (const type of ["email.opened", "email.clicked", "contact.created", "wat"]) {
      expect(normalizeResendEvent({ type, data: base }, "m")).toBeNull();
    }
  });

  it("uses the delivery id as the idempotency key, so a retry is recorded once", () => {
    const first = normalizeResendEvent({ type: "email.delivered", data: base }, "msg_7");
    const retry = normalizeResendEvent({ type: "email.delivered", data: base }, "msg_7");
    expect(first?.providerEventId).toBe("msg_7");
    expect(retry?.providerEventId).toBe(first?.providerEventId);
  });

  it("lower-cases the recipient so it matches a stored normalized address", () => {
    const event = normalizeResendEvent(
      { type: "email.delivered", data: { ...base, to: ["Khaled-S@AXIS-GPS.com"] } },
      "m",
    );
    expect(event?.normalizedEmail).toBe("khaled-s@axis-gps.com");
  });

  it("returns null for a payload with no recipient rather than inventing one", () => {
    expect(normalizeResendEvent({ type: "email.delivered", data: {} }, "m")).toBeNull();
    expect(normalizeResendEvent(null, "m")).toBeNull();
    expect(normalizeResendEvent("nonsense", "m")).toBeNull();
  });
});

describe("channel separation, asserted against the source", () => {
  it("the Resend adapter contains no Gmail or SMTP transport reference", () => {
    const source = readFileSync(
      new URL("./resendProductionEmailProvider.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/nodemailer/);
    expect(source).not.toMatch(/smtp\.gmail\.com/);
    expect(source).not.toMatch(/axisgpscana@gmail\.com/);
  });

  it("the SAFE TEST Gmail adapter contains no Resend reference", () => {
    const source = readFileSync(
      new URL("./gmailSmtpEmailProvider.ts", import.meta.url),
      "utf8",
    );
    expect(source.toLowerCase()).not.toContain("resend");
  });
});
