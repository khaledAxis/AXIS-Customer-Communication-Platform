import { describe, it, expect } from "vitest";
import { normalizeEmail } from "./normalizeEmail";

describe("normalizeEmail", () => {
  it("lowercases (case normalization)", () => {
    const r = normalizeEmail("Foo.Bar@Example.COM");
    expect(r).toEqual({
      kind: "valid",
      raw: "Foo.Bar@Example.COM",
      normalized: "foo.bar@example.com",
    });
  });

  it("trims surrounding whitespace", () => {
    const r = normalizeEmail("   a@b.co   ");
    expect(r.kind).toBe("valid");
    if (r.kind === "valid") expect(r.normalized).toBe("a@b.co");
  });

  it("preserves +tag except for lowercasing", () => {
    const r = normalizeEmail("User+News@Gmail.com");
    expect(r.kind).toBe("valid");
    if (r.kind === "valid") expect(r.normalized).toBe("user+news@gmail.com");
  });

  it("preserves dots (no Gmail dot stripping)", () => {
    const r = normalizeEmail("first.last@gmail.com");
    if (r.kind === "valid") expect(r.normalized).toBe("first.last@gmail.com");
  });

  it("flags invalid syntax", () => {
    expect(normalizeEmail("not-an-email").kind).toBe("invalid");
    expect(normalizeEmail("a@b").kind).toBe("invalid"); // no dotted domain
    expect(normalizeEmail("a b@c.com").kind).toBe("invalid"); // whitespace inside
    expect(normalizeEmail("a@@b.com").kind).toBe("invalid");
  });

  it("reports missing email as none (null/undefined/blank)", () => {
    expect(normalizeEmail(null).kind).toBe("none");
    expect(normalizeEmail(undefined).kind).toBe("none");
    expect(normalizeEmail("").kind).toBe("none");
    expect(normalizeEmail("    ").kind).toBe("none");
  });
});
