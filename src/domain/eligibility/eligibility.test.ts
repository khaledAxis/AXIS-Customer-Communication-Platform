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

  // -------------------------------------------------------------------------
  // Consent (ADR-0021)
  //
  // These tests pin the EXACT v1 behaviour so a future change has to be
  // deliberate. UNKNOWN consent does not block a send by default — but it is never
  // silently treated as GRANTED either, and readiness reports the count.
  // -------------------------------------------------------------------------

  it("does not block an address whose consent was never recorded", () => {
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: profile({ consentStatus: ConsentStatus.UNKNOWN }),
      }),
    ).toEqual({ eligible: true, normalizedEmail: "a@b.co" });
  });

  it("excludes unrecorded consent when explicit consent is required", () => {
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: profile({ consentStatus: ConsentStatus.UNKNOWN }),
        requireExplicitConsent: true,
      }),
    ).toEqual({ eligible: false, reason: "CONSENT_NOT_CONFIRMED" });
  });

  it("distinguishes refused consent from unconfirmed consent", () => {
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: profile({ consentStatus: ConsentStatus.DENIED }),
        requireExplicitConsent: true,
      }),
    ).toEqual({ eligible: false, reason: "CONSENT_DENIED" });
  });

  it("admits granted consent under either rule", () => {
    for (const requireExplicitConsent of [false, true]) {
      expect(
        evaluateEligibility({
          rawEmail: "a@b.co",
          address: profile({ consentStatus: ConsentStatus.GRANTED }),
          requireExplicitConsent,
        }),
      ).toEqual({ eligible: true, normalizedEmail: "a@b.co" });
    }
  });

  it("keeps unsubscribe stronger than granted consent", () => {
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: profile({
          consentStatus: ConsentStatus.GRANTED,
          isUnsubscribed: true,
        }),
      }),
    ).toEqual({ eligible: false, reason: "UNSUBSCRIBED" });
  });

  it("keeps suppression stronger than granted consent", () => {
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: profile({
          consentStatus: ConsentStatus.GRANTED,
          isSuppressed: true,
        }),
      }),
    ).toEqual({ eligible: false, reason: "SUPPRESSED" });
  });

  it("keeps an invalid address stronger than granted consent", () => {
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: profile({
          consentStatus: ConsentStatus.GRANTED,
          emailStatus: EmailStatus.INVALID,
        }),
      }),
    ).toEqual({ eligible: false, reason: "INVALID_EMAIL" });
  });

  it("keeps archived and inactive rules stronger than granted consent", () => {
    const granted = profile({ consentStatus: ConsentStatus.GRANTED });
    expect(
      evaluateEligibility({ rawEmail: "a@b.co", address: granted, sourceArchived: true }),
    ).toEqual({ eligible: false, reason: "ARCHIVED" });
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: granted,
        companyInactive: true,
      }),
    ).toEqual({ eligible: false, reason: "COMPANY_INACTIVE" });
  });

  it("keeps the language rule stronger than granted consent", () => {
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: profile({
          consentStatus: ConsentStatus.GRANTED,
          language: Language.UNKNOWN,
        }),
        requireLanguage: Language.HE,
      }),
    ).toEqual({ eligible: false, reason: "LANGUAGE_UNKNOWN" });
  });

  it("never infers consent from a language", () => {
    // Setting Hebrew changes nothing about permission: with explicit consent
    // required, a Hebrew address with no recorded consent is still excluded.
    expect(
      evaluateEligibility({
        rawEmail: "a@b.co",
        address: profile({
          language: Language.HE,
          consentStatus: ConsentStatus.UNKNOWN,
        }),
        requireLanguage: Language.HE,
        requireExplicitConsent: true,
      }),
    ).toEqual({ eligible: false, reason: "CONSENT_NOT_CONFIRMED" });
  });
});
