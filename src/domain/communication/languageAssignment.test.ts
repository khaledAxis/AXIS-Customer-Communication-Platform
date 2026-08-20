import { describe, it, expect } from "vitest";

import {
  ASSIGNABLE_LANGUAGES,
  LanguageAssignmentError,
  MAX_BULK_ADDRESSES,
  isAssignableLanguage,
  parseLanguageAssignment,
  projectLanguageCounts,
} from "./languageAssignment";
import { Language } from "../types";

/**
 * Language is the ONLY thing a staff assignment can express. These tests are mostly
 * about what the parser refuses — an invented language value, or a request shaped so
 * it could reach more addresses than intended.
 */

describe("assignable languages", () => {
  it("allows exactly Hebrew, Arabic and Not set", () => {
    expect([...ASSIGNABLE_LANGUAGES].sort()).toEqual(["AR", "HE", "UNKNOWN"]);
  });

  it("rejects any other value", () => {
    for (const value of ["EN", "RU", "he", "", null, undefined, 1, {}]) {
      expect(isAssignableLanguage(value)).toBe(false);
    }
  });
});

describe("parsing an assignment", () => {
  it("accepts a single address", () => {
    expect(
      parseLanguageAssignment({ language: "HE", addressIds: ["addr_1"] }),
    ).toEqual({ language: "HE", addressIds: ["addr_1"] });
  });

  it("accepts a bulk selection", () => {
    const parsed = parseLanguageAssignment({
      language: "AR",
      addressIds: ["a", "b", "c"],
    });
    expect(parsed.addressIds).toEqual(["a", "b", "c"]);
    expect(parsed.language).toBe("AR");
  });

  it("collapses duplicate ids instead of failing", () => {
    const parsed = parseLanguageAssignment({
      language: "HE",
      addressIds: ["a", "a", "b", "a"],
    });
    expect(parsed.addressIds).toEqual(["a", "b"]);
  });

  it("rejects an unsupported language", () => {
    expect(() =>
      parseLanguageAssignment({ language: "EN", addressIds: ["a"] }),
    ).toThrow(LanguageAssignmentError);
    expect(() =>
      parseLanguageAssignment({ language: "ENGLISH", addressIds: ["a"] }),
    ).toThrow(/Hebrew, Arabic, or Not set/i);
  });

  it("rejects an empty selection", () => {
    expect(() => parseLanguageAssignment({ language: "HE", addressIds: [] })).toThrow(
      /at least one email address/i,
    );
  });

  it("rejects a malformed selection", () => {
    for (const ids of ["addr_1", null, undefined, { id: "a" }, [1, 2], ["a", null], [""]]) {
      expect(() => parseLanguageAssignment({ language: "HE", addressIds: ids })).toThrow(
        LanguageAssignmentError,
      );
    }
  });

  it("rejects a selection larger than the cap", () => {
    const ids = Array.from({ length: MAX_BULK_ADDRESSES + 1 }, (_, i) => `a${i}`);
    expect(() => parseLanguageAssignment({ language: "HE", addressIds: ids })).toThrow(
      /at most/i,
    );
  });

  it("carries no field for consent, email status, or unsubscribe", () => {
    const parsed = parseLanguageAssignment({
      language: "HE",
      addressIds: ["a"],
      // Extra keys are simply not part of the parsed result.
      consentStatus: "GRANTED",
      emailStatus: "VALID",
      isUnsubscribed: false,
    } as never);
    expect(Object.keys(parsed).sort()).toEqual(["addressIds", "language"]);
  });
});

describe("projected counts", () => {
  const current = { UNKNOWN: 1319, HE: 0, AR: 0 };

  it("moves addresses from their current language to the target", () => {
    const next = projectLanguageCounts(
      current,
      Array.from({ length: 120 }, () => Language.UNKNOWN),
      Language.HE,
    );
    expect(next).toEqual({ UNKNOWN: 1199, HE: 120, AR: 0 });
  });

  it("ignores addresses that already have the target language", () => {
    const next = projectLanguageCounts(
      { UNKNOWN: 10, HE: 5, AR: 0 },
      [Language.HE, Language.HE, Language.UNKNOWN],
      Language.HE,
    );
    expect(next).toEqual({ UNKNOWN: 9, HE: 6, AR: 0 });
  });

  it("handles a move between two known languages", () => {
    const next = projectLanguageCounts(
      { UNKNOWN: 0, HE: 3, AR: 1 },
      [Language.HE, Language.HE],
      Language.AR,
    );
    expect(next).toEqual({ UNKNOWN: 0, HE: 1, AR: 3 });
  });

  it("never produces a negative count", () => {
    const next = projectLanguageCounts({ UNKNOWN: 1, HE: 0, AR: 0 }, [
      Language.UNKNOWN,
      Language.UNKNOWN,
    ], Language.HE);
    expect(next.UNKNOWN).toBe(0);
  });
});
