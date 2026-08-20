import { describe, it, expect, beforeEach } from "vitest";

import {
  MAX_ATTEMPTS,
  WINDOW_MS,
  consumeSignInAttempt,
  releaseSignInAttempt,
  resetSignInThrottle,
} from "./rateLimit";

const EMAIL = "person@axis-gps.com";

describe("sign-in throttle", () => {
  beforeEach(() => resetSignInThrottle());

  it("allows attempts up to the limit", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(consumeSignInAttempt(EMAIL), `attempt ${i + 1}`).toBe(true);
    }
  });

  it("refuses the attempt after the limit", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) consumeSignInAttempt(EMAIL);
    expect(consumeSignInAttempt(EMAIL)).toBe(false);
    expect(consumeSignInAttempt(EMAIL)).toBe(false);
  });

  it("counts one identity, not all of them", () => {
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) consumeSignInAttempt(EMAIL);
    // Someone else's sign-in must not be collateral damage.
    expect(consumeSignInAttempt("other@axis-gps.com")).toBe(true);
  });

  it("is case-insensitive, like the addresses it protects", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) consumeSignInAttempt(EMAIL);
    expect(consumeSignInAttempt(EMAIL.toUpperCase())).toBe(false);
  });

  it("opens a fresh window once the old one has passed", () => {
    const start = 1_000_000;
    for (let i = 0; i < MAX_ATTEMPTS; i++) consumeSignInAttempt(EMAIL, start);
    expect(consumeSignInAttempt(EMAIL, start)).toBe(false);
    expect(consumeSignInAttempt(EMAIL, start + WINDOW_MS + 1)).toBe(true);
  });

  it("clears the counter after a successful sign-in", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) consumeSignInAttempt(EMAIL);
    expect(consumeSignInAttempt(EMAIL)).toBe(false);

    releaseSignInAttempt(EMAIL);
    expect(consumeSignInAttempt(EMAIL)).toBe(true);
  });

  it("does not grow without bound under a spray of invented addresses", () => {
    for (let i = 0; i < 12_000; i++) {
      consumeSignInAttempt(`nobody-${i}@example.invalid`, 1_000_000 + i * 100);
    }
    // The real assertion is that this completes and stays responsive; a real
    // account is still tracked correctly afterwards.
    for (let i = 0; i < MAX_ATTEMPTS; i++) consumeSignInAttempt(EMAIL, 2_000_000);
    expect(consumeSignInAttempt(EMAIL, 2_000_000)).toBe(false);
  });
});
