import { describe, it, expect } from "vitest";
import { evaluateEligibility, AddressProfile } from "./eligibility";
import { ConsentStatus, EmailStatus, Language } from "../types";

const profile = (over: Partial<AddressProfile> = {}): AddressProfile => ({
  emailStatus: EmailStatus.VALID,
  language: Language.UNKNOWN,
  consentStatus: ConsentStatus.UNKNOWN,
  isUnsubscribed: false,
  isSuppressed: false,
  ...over,
});

describe("evaluateEligibility", () => {
  it("excludes when there is no email", () => {
    expect(evaluateEligibility({ rawEmail: null })).toEqual({
      eligible: false,
      reason: "NO_EMAIL",
    });
  });

  it("excludes an invalid email", () => {
    expect(evaluateEligibility({ rawEmail: "nope" })).toEqual({
      eligible: false,
      reason: "INVALID_EMAIL",
    });
  });

  it("is eligible for a valid email with a default (UNKNOWN) profile", () => {
    expect(evaluateEligibility({ rawEmail: "A@B.CO" })).toEqual({
      eligible: true,
      normalizedEmail: "a@b.co",
    });
  });

  it("excludes unsubscribed", () => {
    expect(
      evaluateEligibility({ rawEmail: "a@b.co", address: profile({ isUnsubscribed: true }) }),
    ).toEqual({ eligible: false, reason: "UNSUBSCRIBED" });
  });

  it("excludes suppressed", () => {
    expect(
      evaluateEligibility({ rawEmail: "a@b.co", address: profile({ isSuppressed: true }) }),
    ).toEqual({ eligible: false, reason: "SUPPRESSED" });
  });

  it("excludes denied consent", () => {
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: profile({ consentStatus: ConsentStatus.DENIED }),
      }),
    ).toEqual({ eligible: false, reason: "CONSENT_DENIED" });
  });

  it("excludes archived CRM source", () => {
    expect(evaluateEligibility({ rawEmail: "a@b.co", sourceArchived: true })).toEqual({
      eligible: false,
      reason: "ARCHIVED",
    });
  });

  it("excludes inactive company (company-email candidate)", () => {
    expect(evaluateEligibility({ rawEmail: "a@b.co", companyInactive: true })).toEqual({
      eligible: false,
      reason: "COMPANY_INACTIVE",
    });
  });

  it("excludes unknown language when a language is required", () => {
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: profile({ language: Language.UNKNOWN }),
        requireLanguage: Language.HE,
      }),
    ).toEqual({ eligible: false, reason: "LANGUAGE_UNKNOWN" });
  });

  it("is eligible when required language matches", () => {
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: profile({ language: Language.HE }),
        requireLanguage: Language.HE,
      }),
    ).toEqual({ eligible: true, normalizedEmail: "a@b.co" });
  });

  it("excludes when the stored emailStatus is INVALID", () => {
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: profile({ emailStatus: EmailStatus.INVALID }),
      }),
    ).toEqual({ eligible: false, reason: "INVALID_EMAIL" });
  });
});
