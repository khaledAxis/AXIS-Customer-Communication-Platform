import { describe, it, expect } from "vitest";

import {
  CONSENT_SOURCES,
  ConsentAssignmentError,
  MAX_BULK_ADDRESSES,
  MAX_NOTE_LENGTH,
  isAssignableConsent,
  isConsentSource,
  parseConsentAssignment,
  projectConsentCounts,
} from "./consentAssignment";
import { ConsentSource, ConsentStatus } from "../types";

const NOW = new Date("2026-08-20T10:00:00.000Z");

/** A valid GRANTED submission, so each test can vary exactly one thing. */
function grant(overrides: Record<string, unknown> = {}) {
  return {
    status: ConsentStatus.GRANTED,
    addressIds: ["a1"],
    source: ConsentSource.EXISTING_CUSTOMER_RELATIONSHIP,
    effectiveAt: "2026-01-15",
    confirmed: "on",
    now: NOW,
    ...overrides,
  };
}

describe("consent assignment parsing", () => {
  it("accepts a documented GRANTED", () => {
    const result = parseConsentAssignment(grant());
    expect(result.status).toBe(ConsentStatus.GRANTED);
    expect(result.source).toBe(ConsentSource.EXISTING_CUSTOMER_RELATIONSHIP);
    expect(result.effectiveAt?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(result.addressIds).toEqual(["a1"]);
  });

  it("accepts DENIED without any documented basis", () => {
    const result = parseConsentAssignment({
      status: ConsentStatus.DENIED,
      addressIds: ["a1"],
      confirmed: true,
      now: NOW,
    });
    expect(result.status).toBe(ConsentStatus.DENIED);
    // Refusing to send never needs paperwork.
    expect(result.source).toBeNull();
    expect(result.effectiveAt).toBeNull();
  });

  it("accepts clearing consent back to not-confirmed", () => {
    const result = parseConsentAssignment({
      status: ConsentStatus.UNKNOWN,
      addressIds: ["a1"],
      confirmed: true,
      now: NOW,
    });
    expect(result.status).toBe(ConsentStatus.UNKNOWN);
    expect(result.source).toBeNull();
  });

  it("refuses GRANTED without a basis", () => {
    expect(() => parseConsentAssignment(grant({ source: "" }))).toThrowError(
      ConsentAssignmentError,
    );
    try {
      parseConsentAssignment(grant({ source: undefined }));
      expect.unreachable();
    } catch (error) {
      expect((error as ConsentAssignmentError).reason).toBe("SOURCE_REQUIRED");
    }
  });

  it("refuses an unrecognised basis instead of mapping it to Other", () => {
    try {
      parseConsentAssignment(grant({ source: "BECAUSE_I_SAID_SO" }));
      expect.unreachable();
    } catch (error) {
      expect((error as ConsentAssignmentError).reason).toBe("UNSUPPORTED_SOURCE");
    }
  });

  it("requires a note when the basis is Other, because Other documents nothing", () => {
    try {
      parseConsentAssignment(grant({ source: ConsentSource.OTHER_DOCUMENTED_BASIS }));
      expect.unreachable();
    } catch (error) {
      expect((error as ConsentAssignmentError).reason).toBe("NOTE_REQUIRED");
    }

    const ok = parseConsentAssignment(
      grant({
        source: ConsentSource.OTHER_DOCUMENTED_BASIS,
        note: "Signed at the 2025 trade show, scan in the shared drive.",
      }),
    );
    expect(ok.note).toContain("trade show");
  });

  it("refuses GRANTED without an effective date", () => {
    try {
      parseConsentAssignment(grant({ effectiveAt: "" }));
      expect.unreachable();
    } catch (error) {
      expect((error as ConsentAssignmentError).reason).toBe(
        "EFFECTIVE_DATE_REQUIRED",
      );
    }
  });

  it("refuses an effective date in the future", () => {
    try {
      parseConsentAssignment(grant({ effectiveAt: "2027-01-01" }));
      expect.unreachable();
    } catch (error) {
      expect((error as ConsentAssignmentError).reason).toBe(
        "EFFECTIVE_DATE_IN_FUTURE",
      );
    }
  });

  it("reads a bare date as UTC midnight so the stored instant does not shift", () => {
    const result = parseConsentAssignment(grant({ effectiveAt: "2026-02-03" }));
    expect(result.effectiveAt?.toISOString()).toBe("2026-02-03T00:00:00.000Z");
  });

  it("refuses every status without an explicit confirmation", () => {
    for (const status of [
      ConsentStatus.GRANTED,
      ConsentStatus.DENIED,
      ConsentStatus.UNKNOWN,
    ]) {
      try {
        parseConsentAssignment(grant({ status, confirmed: undefined }));
        expect.unreachable();
      } catch (error) {
        expect((error as ConsentAssignmentError).reason).toBe("NOT_CONFIRMED");
      }
    }
  });

  it("treats a missing checkbox as not ticked, never as true", () => {
    for (const value of [undefined, null, "", "off", "false", 0]) {
      expect(() =>
        parseConsentAssignment(grant({ confirmed: value })),
      ).toThrowError(ConsentAssignmentError);
    }
  });

  it("refuses an unsupported status", () => {
    try {
      parseConsentAssignment(grant({ status: "MAYBE" }));
      expect.unreachable();
    } catch (error) {
      expect((error as ConsentAssignmentError).reason).toBe("UNSUPPORTED_STATUS");
    }
  });

  it("refuses a malformed selection rather than filtering it", () => {
    for (const ids of [null, "a1", [1], ["a1", ""], [{}]]) {
      expect(() => parseConsentAssignment(grant({ addressIds: ids }))).toThrowError(
        ConsentAssignmentError,
      );
    }
  });

  it("refuses an empty selection", () => {
    try {
      parseConsentAssignment(grant({ addressIds: [] }));
      expect.unreachable();
    } catch (error) {
      expect((error as ConsentAssignmentError).reason).toBe("NO_ADDRESSES_SELECTED");
    }
  });

  it("collapses duplicate ids but keeps submission order", () => {
    const result = parseConsentAssignment(
      grant({ addressIds: ["b", "a", "b", "c"] }),
    );
    expect(result.addressIds).toEqual(["b", "a", "c"]);
  });

  it("bounds one bulk operation", () => {
    const ids = Array.from({ length: MAX_BULK_ADDRESSES + 1 }, (_, i) => `a${i}`);
    try {
      parseConsentAssignment(grant({ addressIds: ids }));
      expect.unreachable();
    } catch (error) {
      expect((error as ConsentAssignmentError).reason).toBe("TOO_MANY_ADDRESSES");
    }
  });

  it("bounds the note length", () => {
    try {
      parseConsentAssignment(grant({ note: "x".repeat(MAX_NOTE_LENGTH + 1) }));
      expect.unreachable();
    } catch (error) {
      expect((error as ConsentAssignmentError).reason).toBe("NOTE_TOO_LONG");
    }
  });

  it("carries no field for language, email status, unsubscribe or suppression", () => {
    const result = parseConsentAssignment(grant());
    // The parsed shape is the ONLY thing the service writes from. If a field is not
    // here it cannot be written, which is what keeps language and consent independent.
    expect(Object.keys(result).sort()).toEqual([
      "addressIds",
      "effectiveAt",
      "note",
      "source",
      "status",
    ]);
  });

  it("cannot express consent for a language value", () => {
    // Nothing in the input shape accepts a language, so assigning Hebrew can never
    // travel through this path and imply permission to email someone.
    const result = parseConsentAssignment(
      grant({ language: "HE" } as Record<string, unknown>),
    );
    expect("language" in result).toBe(false);
  });
});

describe("consent type guards", () => {
  it("recognises only the three assignable statuses", () => {
    expect(isAssignableConsent("GRANTED")).toBe(true);
    expect(isAssignableConsent("DENIED")).toBe(true);
    expect(isAssignableConsent("UNKNOWN")).toBe(true);
    expect(isAssignableConsent("PENDING")).toBe(false);
    expect(isAssignableConsent(null)).toBe(false);
  });

  it("recognises only the listed bases", () => {
    for (const source of CONSENT_SOURCES) expect(isConsentSource(source)).toBe(true);
    expect(isConsentSource("LEGITIMATE_INTEREST")).toBe(false);
  });
});

describe("projected counts", () => {
  it("moves only the addresses that change", () => {
    const before = { UNKNOWN: 100, GRANTED: 5, DENIED: 2 };
    const after = projectConsentCounts(
      before,
      [ConsentStatus.UNKNOWN, ConsentStatus.UNKNOWN, ConsentStatus.GRANTED],
      ConsentStatus.GRANTED,
    );
    expect(after).toEqual({ UNKNOWN: 98, GRANTED: 7, DENIED: 2 });
  });

  it("never goes below zero", () => {
    const after = projectConsentCounts(
      { UNKNOWN: 1, GRANTED: 0, DENIED: 0 },
      [ConsentStatus.UNKNOWN, ConsentStatus.UNKNOWN],
      ConsentStatus.DENIED,
    );
    expect(after.UNKNOWN).toBe(0);
  });
});
