import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { getSenderIdentity } from "./senderIdentity";

/**
 * The single resolution point for the newsletter sender identity. Both the approval
 * hash and the SMTP envelope read from here, so a divergence between "what was
 * approved" and "what is sent" is impossible by construction.
 */

const KEY = "NEWSLETTER_REPLY_TO";
let original: string | undefined;

beforeEach(() => {
  original = process.env[KEY];
});

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("sender identity", () => {
  it("uses the configured reply address", () => {
    process.env[KEY] = "noreply@axis-gps.com";
    const identity = getSenderIdentity();
    expect(identity.replyToEmail).toBe("noreply@axis-gps.com");
    expect(identity.problems).toEqual([]);
  });

  it("falls back to the documented no-reply address when unset", () => {
    delete process.env[KEY];
    const identity = getSenderIdentity();
    expect(identity.replyToEmail).toBe("noreply@axis-gps.com");
    expect(identity.problems).toEqual([]);
  });

  it("reports a problem instead of silently accepting a malformed value", () => {
    process.env[KEY] = "one@axis-gps.com, two@axis-gps.com";
    const identity = getSenderIdentity();
    expect(identity.problems.length).toBe(1);
    expect(identity.problems[0]).toMatch(/NEWSLETTER_REPLY_TO/);
    // Never surfaces the rejected value as if it were usable.
    expect(identity.replyToEmail).toBe("noreply@axis-gps.com");
  });

  it("reports a problem for a smuggled header", () => {
    process.env[KEY] = "noreply@axis-gps.com\nBcc: victim@example.com";
    expect(getSenderIdentity().problems.length).toBe(1);
  });

  it("never lets configuration change the authenticated sender", () => {
    process.env[KEY] = "noreply@axis-gps.com";
    expect(getSenderIdentity().fromEmail).toBe("axisgpscana@gmail.com");
    expect(getSenderIdentity().senderName).toBe("AXIS Advanced Mapping Solutions");
  });
});
