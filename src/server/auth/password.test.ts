import { describe, it, expect } from "vitest";

import {
  UNUSABLE_PASSWORD_HASH,
  hashPassword,
  isUnusableHash,
  verifyPassword,
} from "./password";

/**
 * Real Argon2id, not a stub. Hashing is the one place where "it looked right" is not
 * good enough — these run the actual binding the application uses.
 */
const PASSWORD = "Axis-Mapping-2026";

describe("password hashing", () => {
  it("produces an Argon2id PHC string", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("never stores the password itself", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toContain(PASSWORD);
    expect(hash.toLowerCase()).not.toContain("axis-mapping");
  });

  it("is salted: the same password hashes differently every time", async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).not.toBe(b);
    // …and both still verify, which is what a per-hash salt buys.
    expect(await verifyPassword(a, PASSWORD)).toBe(true);
    expect(await verifyPassword(b, PASSWORD)).toBe(true);
  });

  it("is one-way: there is no inverse to call", async () => {
    const passwordModule = await import("./password");
    for (const name of Object.keys(passwordModule)) {
      expect(name.toLowerCase()).not.toContain("decrypt");
      expect(name.toLowerCase()).not.toContain("reveal");
    }
  });

  it("verifies the right password and refuses a wrong one", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, "Axis-Mapping-2027")).toBe(false);
    expect(await verifyPassword(hash, "")).toBe(false);
  });

  it("is case- and whitespace-sensitive", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD.toLowerCase())).toBe(false);
    expect(await verifyPassword(hash, ` ${PASSWORD}`)).toBe(false);
  });

  it("refuses an unreadable stored value instead of throwing", async () => {
    // A corrupted or legacy value is a failed login, not a 500 that tells an
    // attacker something interesting.
    for (const stored of [
      null,
      undefined,
      "",
      "not-a-hash",
      "$2b$10$abcdefghijklmnopqrstuv", // a bcrypt hash from some other system
      "$argon2id$v=19$m=1,t=1,p=1$truncated",
    ]) {
      expect(await verifyPassword(stored, PASSWORD), String(stored)).toBe(false);
    }
  });

  it("treats the deliberately-unusable value as never matching", async () => {
    expect(await verifyPassword(UNUSABLE_PASSWORD_HASH, PASSWORD)).toBe(false);
    expect(await verifyPassword(UNUSABLE_PASSWORD_HASH, "")).toBe(false);
    expect(await verifyPassword(UNUSABLE_PASSWORD_HASH, UNUSABLE_PASSWORD_HASH)).toBe(
      false,
    );
  });

  it("recognises which stored values could never authenticate", async () => {
    expect(isUnusableHash(UNUSABLE_PASSWORD_HASH)).toBe(true);
    expect(isUnusableHash(null)).toBe(true);
    expect(isUnusableHash("not-a-real-credential-auth-arrives-later")).toBe(true);
    expect(isUnusableHash(await hashPassword(PASSWORD))).toBe(false);
  });

  it("handles a long passphrase without truncating it", async () => {
    // bcrypt silently ignores everything past 72 bytes; Argon2 does not, so two long
    // passphrases sharing a prefix must not be interchangeable.
    const long = `${"correct horse battery staple ".repeat(3)}A1`;
    const hash = await hashPassword(long);
    expect(await verifyPassword(hash, long)).toBe(true);
    expect(await verifyPassword(hash, `${long}x`)).toBe(false);
  });
});
