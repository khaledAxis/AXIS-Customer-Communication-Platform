import { describe, it, expect } from "vitest";

import { Role } from "./authorization";
import {
  SignInInputError,
  UserInputError,
  parseNewUser,
  parsePasswordChange,
  parseSignIn,
} from "./credentials";

describe("sign-in input", () => {
  it("normalizes the email for lookup", () => {
    const parsed = parseSignIn({ email: "  Person@AXIS-GPS.com ", password: "x" });
    expect(parsed.email).toBe("person@axis-gps.com");
  });

  it("passes the password through byte-for-byte", () => {
    // Not trimmed and not normalized: it is compared to a stored hash exactly as
    // typed, and "helpfully" trimming would lock out anyone whose password ends in
    // a space.
    const password = "  Axis Mapping 2026  ";
    expect(parseSignIn({ email: "a@b.co", password }).password).toBe(password);
  });

  it("refuses a missing field", () => {
    for (const input of [
      { email: "", password: "x" },
      { email: "a@b.co", password: "" },
      { email: null, password: "x" },
      { email: "a@b.co", password: 12345 },
    ]) {
      expect(() => parseSignIn(input)).toThrowError(SignInInputError);
    }
  });

  it("refuses a malformed address", () => {
    try {
      parseSignIn({ email: "not-an-email", password: "x" });
      expect.unreachable();
    } catch (error) {
      expect((error as SignInInputError).reason).toBe("MALFORMED");
    }
  });

  it("cannot carry a role or an actor id", () => {
    const parsed = parseSignIn({
      email: "a@b.co",
      password: "x",
      // Hostile extras. There is nowhere for them to land.
      role: "ADMIN",
      userId: "someone-else",
    } as { email: unknown; password: unknown });
    // Signing in states who you claim to be, never what you are allowed to do.
    expect(Object.keys(parsed).sort()).toEqual(["email", "password"]);
  });

  it("does not apply the creation policy to an existing password", () => {
    // A short legacy password must still be able to attempt a sign-in; whether it
    // matches is the hash's business, not the policy's.
    expect(() => parseSignIn({ email: "a@b.co", password: "old" })).not.toThrow();
  });
});

describe("new user input", () => {
  const VALID = {
    name: "Khaled S",
    email: "khaled@axis-gps.com",
    role: Role.MANAGER,
    password: "Axis-Mapping-2026",
    confirmPassword: "Axis-Mapping-2026",
  };

  it("accepts a complete submission", () => {
    const parsed = parseNewUser(VALID);
    expect(parsed).toEqual({
      name: "Khaled S",
      email: "khaled@axis-gps.com",
      role: Role.MANAGER,
      password: "Axis-Mapping-2026",
    });
  });

  it("normalizes the email", () => {
    expect(parseNewUser({ ...VALID, email: " Khaled@AXIS-GPS.com " }).email).toBe(
      "khaled@axis-gps.com",
    );
  });

  it("collects every problem so the form is fixed once", () => {
    try {
      parseNewUser({ name: "", email: "nope", role: "SUPERUSER", password: "abc" });
      expect.unreachable();
    } catch (error) {
      const issues = (error as UserInputError).issues;
      const fields = new Set(issues.map((issue) => issue.field));
      expect(fields).toContain("name");
      expect(fields).toContain("email");
      expect(fields).toContain("role");
      expect(fields).toContain("password");
    }
  });

  it("refuses an invented role rather than defaulting to one", () => {
    expect(() => parseNewUser({ ...VALID, role: "SUPERUSER" })).toThrowError(
      UserInputError,
    );
    expect(() => parseNewUser({ ...VALID, role: undefined })).toThrowError(
      UserInputError,
    );
  });

  it("requires the confirmation to match", () => {
    expect(() =>
      parseNewUser({ ...VALID, confirmPassword: "Axis-Mapping-2027" }),
    ).toThrowError(UserInputError);
  });

  it("returns no field that could name an actor", () => {
    const parsed = parseNewUser(VALID);
    expect("id" in parsed).toBe(false);
    expect("createdById" in parsed).toBe(false);
  });
});

describe("password change input", () => {
  it("accepts a matching strong pair", () => {
    expect(
      parsePasswordChange({
        password: "Axis-Mapping-2026",
        confirmPassword: "Axis-Mapping-2026",
      }).password,
    ).toBe("Axis-Mapping-2026");
  });

  it("applies the full policy", () => {
    expect(() =>
      parsePasswordChange({ password: "short1A", confirmPassword: "short1A" }),
    ).toThrowError(UserInputError);
  });

  it("refuses a password that repeats the account's own address", () => {
    expect(() =>
      parsePasswordChange({
        password: "Khaledaxis2026",
        confirmPassword: "Khaledaxis2026",
        email: "khaledaxis2026@axis-gps.com",
      }),
    ).toThrowError(UserInputError);
  });

  it("refuses a mismatched confirmation", () => {
    expect(() =>
      parsePasswordChange({
        password: "Axis-Mapping-2026",
        confirmPassword: "Axis-Mapping-2027",
      }),
    ).toThrowError(UserInputError);
  });
});
