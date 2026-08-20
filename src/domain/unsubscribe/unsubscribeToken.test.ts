import { describe, it, expect } from "vitest";

import {
  TEST_UNSUBSCRIBE_TOKEN,
  TOKEN_LENGTH,
  hashUnsubscribeToken,
  hashesMatch,
  isTestUnsubscribeToken,
  looksLikeUnsubscribeToken,
  mintUnsubscribeToken,
} from "./unsubscribeToken";

describe("unsubscribe tokens", () => {
  it("mints a URL-safe token of the expected length", () => {
    const { token } = mintUnsubscribeToken();
    expect(token).toHaveLength(TOKEN_LENGTH);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // No padding, no slashes, no plus signs — safe in a path segment unescaped.
    expect(token).not.toContain("=");
    expect(token).not.toContain("/");
    expect(token).not.toContain("+");
  });

  it("is unguessable: every mint differs", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(mintUnsubscribeToken().token);
    expect(seen.size).toBe(500);
  });

  it("carries no data at all", () => {
    // The whole security argument rests on this: there is no payload to tamper with,
    // no identifier to read, and nothing to decode.
    const { token } = mintUnsubscribeToken();
    const decoded = Buffer.from(
      token.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    );
    expect(decoded).toHaveLength(32);
    // Not JSON, not a JWT, not anything with structure.
    expect(token.includes(".")).toBe(false);
    expect(() => JSON.parse(decoded.toString("utf8"))).toThrow();
  });

  it("stores a hash, never the token", () => {
    const { token, tokenHash } = mintUnsubscribeToken();
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
    expect(hashUnsubscribeToken(token)).toBe(tokenHash);
  });

  it("hashes deterministically, so a lookup can find the row", () => {
    const { token } = mintUnsubscribeToken();
    expect(hashUnsubscribeToken(token)).toBe(hashUnsubscribeToken(token));
  });

  it("gives a completely different hash for a one-character change", () => {
    const { token, tokenHash } = mintUnsubscribeToken();
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(hashUnsubscribeToken(tampered)).not.toBe(tokenHash);
  });

  it("recognises a well-formed token and rejects everything else", () => {
    expect(looksLikeUnsubscribeToken(mintUnsubscribeToken().token)).toBe(true);

    for (const bad of [
      "",
      "short",
      "a".repeat(TOKEN_LENGTH - 1),
      "a".repeat(TOKEN_LENGTH + 1),
      `${"a".repeat(TOKEN_LENGTH - 1)}/`,
      `${"a".repeat(TOKEN_LENGTH - 2)}..`,
      "../".repeat(15),
      null,
      undefined,
      12345,
      { token: "x" },
    ]) {
      expect(looksLikeUnsubscribeToken(bad), String(bad)).toBe(false);
    }
  });

  it("compares hashes in constant time and by value", () => {
    const a = hashUnsubscribeToken("one");
    const b = hashUnsubscribeToken("two");
    expect(hashesMatch(a, a)).toBe(true);
    expect(hashesMatch(a, b)).toBe(false);
    expect(hashesMatch(a, "short")).toBe(false);
  });

  it("recognises the inert preview token", () => {
    expect(isTestUnsubscribeToken(TEST_UNSUBSCRIBE_TOKEN)).toBe(true);
    expect(isTestUnsubscribeToken(mintUnsubscribeToken().token)).toBe(false);
  });

  it("keeps the preview token constant across renders", () => {
    // If this ever varied, the SAFE TEST approval hash (ADR-0013) could never match
    // what was submitted, because the rendered HTML would change every time.
    expect(TEST_UNSUBSCRIBE_TOKEN).toBe("safe-test-preview-link");
    expect(looksLikeUnsubscribeToken(TEST_UNSUBSCRIBE_TOKEN)).toBe(false);
  });
});
