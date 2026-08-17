import { describe, it, expect } from "vitest";
import {
  toContactProjection,
  MONDAY_OWNED_CONTACT_KEYS,
} from "./contactProjection";

describe("contact projection — sync ownership separation", () => {
  it("maps only Monday-owned + system fields, deriving emailNorm", () => {
    const p = toContactProjection({
      boardId: "1903020916",
      itemId: "42",
      fullName: "Some One",
      email: "Some.One@Example.com",
      phone: "050",
      jobTitle: "Engineer",
    });
    expect(p.mondayItemId).toBe("42");
    expect(p.emailNorm).toBe("some.one@example.com");
    expect(p.address).toBeNull();
  });

  it("never carries communication state (language/consent/emailStatus)", () => {
    const p = toContactProjection({ boardId: "b", itemId: "1", email: "a@b.co" });
    expect(p).not.toHaveProperty("language");
    expect(p).not.toHaveProperty("consentStatus");
    expect(p).not.toHaveProperty("emailStatus");
    // The declared writable key set also excludes communication fields:
    for (const forbidden of ["language", "consentStatus", "emailStatus"]) {
      expect(MONDAY_OWNED_CONTACT_KEYS as readonly string[]).not.toContain(forbidden);
    }
  });

  it("leaves emailNorm null for a missing or invalid email", () => {
    expect(toContactProjection({ boardId: "b", itemId: "1", email: null }).emailNorm).toBeNull();
    expect(toContactProjection({ boardId: "b", itemId: "2", email: "bad" }).emailNorm).toBeNull();
  });
});
