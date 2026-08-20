import { describe, it, expect } from "vitest";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkPassword,
  passwordStrength,
} from "./passwordPolicy";

const GOOD = "Axis-Mapping-2026";

describe("password policy", () => {
  it("accepts a long, mixed passphrase", () => {
    expect(checkPassword({ password: GOOD }).ok).toBe(true);
  });

  it("rejects anything shorter than the minimum", () => {
    const result = checkPassword({ password: "Ax1short" });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("TOO_SHORT");
  });

  it("rejects an unbounded input rather than hashing it", () => {
    const result = checkPassword({ password: `A1${"x".repeat(MAX_PASSWORD_LENGTH)}` });
    expect(result.problems).toContain("TOO_LONG");
  });

  it("requires a letter, a number and both cases", () => {
    expect(checkPassword({ password: "123456789012345" }).problems).toContain(
      "NEEDS_LETTER",
    );
    expect(checkPassword({ password: "AxisMappingSolut" }).problems).toContain(
      "NEEDS_NUMBER",
    );
    expect(checkPassword({ password: "axismapping2026" }).problems).toContain(
      "NEEDS_MIXED_CASE",
    );
  });

  it("rejects the passwords a hurried person actually types", () => {
    for (const weak of ["Password1234", "Changeme1234", "Axisgps12345"]) {
      const result = checkPassword({ password: weak });
      expect(result.problems, weak).toContain("TOO_COMMON");
    }
  });

  it("rejects a password that is just the email address", () => {
    const result = checkPassword({
      password: "Khaled-S2026",
      email: "khaled-s2026@axis-gps.com",
    });
    expect(result.problems).toContain("CONTAINS_EMAIL");
  });

  it("rejects a password that is just the local part of the email", () => {
    const result = checkPassword({
      password: "Khaled-Sabbah1",
      email: "khaledsabbah1@axis-gps.com",
    });
    expect(result.problems).toContain("CONTAINS_EMAIL");
  });

  it("reports every problem at once, not one at a time", () => {
    const result = checkPassword({ password: "abc" });
    expect(result.problems.length).toBeGreaterThan(2);
    expect(result.messages).toHaveLength(result.problems.length);
  });

  it("requires the confirmation to match exactly", () => {
    expect(
      checkPassword({ password: GOOD, confirmation: GOOD }).ok,
    ).toBe(true);
    expect(
      checkPassword({ password: GOOD, confirmation: `${GOOD} ` }).problems,
    ).toContain("CONFIRMATION_MISMATCH");
  });

  it("does not trim the confirmation — a trailing space is part of the password", () => {
    const withSpace = `${GOOD} `;
    // Typed identically twice, so it is accepted: silently trimming one side would
    // lock the person out at their next sign-in.
    expect(checkPassword({ password: withSpace, confirmation: withSpace }).ok).toBe(
      true,
    );
  });

  it("only checks the confirmation when one was supplied", () => {
    expect(checkPassword({ password: GOOD }).problems).not.toContain(
      "CONFIRMATION_MISMATCH",
    );
  });

  it("rejects a password made only of spaces", () => {
    const result = checkPassword({ password: "                " });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("WHITESPACE_ONLY_DIFFERENCE");
  });

  it("never reports a raw problem code as the user-facing message", () => {
    for (const message of checkPassword({ password: "abc" }).messages) {
      expect(message).not.toMatch(/^[A-Z_]+$/);
      expect(message.length).toBeGreaterThan(10);
    }
  });
});

describe("strength hint", () => {
  it("is advisory and rates a long mixed passphrase strongly", () => {
    expect(passwordStrength("Axis-Mapping-2026!")).toBe("strong");
  });

  it("rates a minimum-length password as merely acceptable", () => {
    expect(passwordStrength("Axis-Map2026")).toBe("fair");
  });

  it("rates a short password as weak", () => {
    expect(passwordStrength("axis")).toBe("weak");
  });

  it("never contradicts the gate: anything the policy refuses is at most fair", () => {
    // The meter is a hint. A "strong" reading must never appear for something
    // `checkPassword` would reject on length.
    const short = "Ab1!".repeat(2); // 8 characters
    expect(checkPassword({ password: short }).ok).toBe(false);
    expect(passwordStrength(short)).not.toBe("strong");
    expect(short.length).toBeLessThan(MIN_PASSWORD_LENGTH);
  });
});
