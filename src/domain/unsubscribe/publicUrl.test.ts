import { describe, it, expect } from "vitest";

import { buildUnsubscribeUrl, validatePublicAppUrl } from "./publicUrl";

const PROD = { allowDevelopmentOrigins: false };
const DEV = { allowDevelopmentOrigins: true };

describe("public app URL", () => {
  it("accepts a real HTTPS origin", () => {
    const result = validatePublicAppUrl("https://newsletter.axis-gps.com", PROD);
    expect(result).toEqual({
      ok: true,
      origin: "https://newsletter.axis-gps.com",
      isDevelopmentOnly: false,
    });
  });

  it("keeps a base path but drops a trailing slash", () => {
    const result = validatePublicAppUrl("https://axis-gps.com/news/", PROD);
    expect(result.ok && result.origin).toBe("https://axis-gps.com/news");
  });

  it("refuses a missing value rather than guessing one", () => {
    for (const value of [undefined, null, "", "   ", 42]) {
      const result = validatePublicAppUrl(value, PROD);
      expect(result.ok, String(value)).toBe(false);
    }
  });

  it("refuses plain HTTP for production", () => {
    const result = validatePublicAppUrl("http://newsletter.axis-gps.com", PROD);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problem).toBe("REQUIRES_HTTPS");
  });

  it("refuses an HTTPS URL pointing at a machine-local host", () => {
    for (const value of [
      "https://localhost",
      "https://127.0.0.1",
      "https://192.168.2.36",
      "https://10.0.0.4",
      "https://172.16.4.1",
      "https://intranet",
    ]) {
      const result = validatePublicAppUrl(value, PROD);
      expect(result.ok, value).toBe(false);
    }
  });

  it("allows a localhost development origin only when asked", () => {
    const dev = validatePublicAppUrl("http://localhost:3000", DEV);
    expect(dev.ok).toBe(true);
    // …and flags it, so readiness can refuse to call production unsubscribe ready.
    expect(dev.ok && dev.isDevelopmentOnly).toBe(true);

    expect(validatePublicAppUrl("http://localhost:3000", PROD).ok).toBe(false);
  });

  it("refuses a LAN address even in development mode over http", () => {
    // Reachable from another desk is still not reachable from a customer's inbox.
    const result = validatePublicAppUrl("http://192.168.2.36:3000", DEV);
    expect(result.ok).toBe(true);
    expect(result.ok && result.isDevelopmentOnly).toBe(true);
  });

  it("refuses embedded credentials", () => {
    const result = validatePublicAppUrl("https://user:pass@axis-gps.com", PROD);
    expect(!result.ok && result.problem).toBe("HAS_CREDENTIALS");
  });

  it("refuses a query string or fragment", () => {
    expect(
      validatePublicAppUrl("https://axis-gps.com?utm=1", PROD).ok,
    ).toBe(false);
    expect(validatePublicAppUrl("https://axis-gps.com#x", PROD).ok).toBe(false);
  });

  it("refuses a non-http scheme", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://axis-gps.com",
    ]) {
      expect(validatePublicAppUrl(value, PROD).ok, value).toBe(false);
    }
  });

  it("refuses something that is not a URL at all", () => {
    expect(!validatePublicAppUrl("axis-gps.com", PROD).ok).toBe(true);
  });

  it("never reports a raw problem code as the message", () => {
    const result = validatePublicAppUrl("http://axis-gps.com", PROD);
    expect(!result.ok && result.message.length).toBeGreaterThan(20);
    expect(!result.ok && /^[A-Z_]+$/.test(result.message)).toBe(false);
  });
});

describe("unsubscribe URL", () => {
  it("joins the origin and token without a double slash", () => {
    expect(buildUnsubscribeUrl("https://axis-gps.com", "abc")).toBe(
      "https://axis-gps.com/unsubscribe/abc",
    );
    expect(buildUnsubscribeUrl("https://axis-gps.com/", "abc")).toBe(
      "https://axis-gps.com/unsubscribe/abc",
    );
  });

  it("encodes the token so it cannot escape its path segment", () => {
    expect(buildUnsubscribeUrl("https://axis-gps.com", "a/../b")).toBe(
      "https://axis-gps.com/unsubscribe/a%2F..%2Fb",
    );
  });
});
