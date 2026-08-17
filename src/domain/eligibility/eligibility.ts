import {
  ConsentStatus,
  EmailStatus,
  ExclusionReason,
  Language,
} from "../types";
import { normalizeEmail } from "../email/normalizeEmail";

/**
 * Derived email eligibility (ADR-0009 §11). Eligibility is NEVER stored as a
 * boolean column — it is computed from the communication profile plus CRM state.
 *
 * Communication state (`emailStatus`, `language`, `consentStatus`, unsubscribe,
 * suppression) is read from the email-centric `CommunicationAddress`, not from the
 * CRM entity — so a company email and a contact email that normalize to the same
 * address share one eligibility outcome.
 */

/** The email-centric communication profile (a `CommunicationAddress` snapshot). */
export interface AddressProfile {
  emailStatus: EmailStatus;
  language: Language;
  consentStatus: ConsentStatus;
  isUnsubscribed: boolean;
  isSuppressed: boolean;
}

export interface EligibilityInput {
  /** Raw candidate email (company or contact). */
  rawEmail: string | null | undefined;
  /** Communication profile for the normalized email, if one exists yet. */
  address?: AddressProfile;
  /** The contributing CRM source is archived / Monday-deleted. */
  sourceArchived?: boolean;
  /** Company-email candidate whose company is INACTIVE. */
  companyInactive?: boolean;
  /** For a localized campaign: the required language. Omit for non-localized. */
  requireLanguage?: Language;
}

export type EligibilityOutcome =
  | { eligible: true; normalizedEmail: string }
  | { eligible: false; reason: ExclusionReason };

const DEFAULT_PROFILE: AddressProfile = {
  emailStatus: EmailStatus.UNKNOWN,
  language: Language.UNKNOWN,
  consentStatus: ConsentStatus.UNKNOWN,
  isUnsubscribed: false,
  isSuppressed: false,
};

export function evaluateEligibility(input: EligibilityInput): EligibilityOutcome {
  const email = normalizeEmail(input.rawEmail);
  if (email.kind === "none") {
    return { eligible: false, reason: ExclusionReason.NO_EMAIL };
  }
  if (email.kind === "invalid") {
    return { eligible: false, reason: ExclusionReason.INVALID_EMAIL };
  }

  if (input.sourceArchived) {
    return { eligible: false, reason: ExclusionReason.ARCHIVED };
  }
  if (input.companyInactive) {
    return { eligible: false, reason: ExclusionReason.COMPANY_INACTIVE };
  }

  const profile = input.address ?? DEFAULT_PROFILE;

  if (profile.emailStatus === EmailStatus.INVALID) {
    return { eligible: false, reason: ExclusionReason.INVALID_EMAIL };
  }
  if (profile.isUnsubscribed) {
    return { eligible: false, reason: ExclusionReason.UNSUBSCRIBED };
  }
  if (profile.isSuppressed) {
    return { eligible: false, reason: ExclusionReason.SUPPRESSED };
  }
  if (profile.consentStatus === ConsentStatus.DENIED) {
    return { eligible: false, reason: ExclusionReason.CONSENT_DENIED };
  }
  if (
    input.requireLanguage !== undefined &&
    profile.language !== input.requireLanguage
  ) {
    // Localized campaign: exclude unknown or mismatched language.
    return { eligible: false, reason: ExclusionReason.LANGUAGE_UNKNOWN };
  }

  return { eligible: true, normalizedEmail: email.normalized };
}
