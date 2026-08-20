/**
 * Friendly labels for internal enum values.
 *
 * AXIS staff never see raw enum names, database ids, or Prisma terminology
 * (CLAUDE.md UI rules). This is the single place those translations live.
 */

export const LANGUAGE_LABEL: Record<string, string> = {
  HE: "Hebrew",
  AR: "Arabic",
  UNKNOWN: "Not set",
};

export const LANGUAGE_NATIVE: Record<string, string> = {
  HE: "עברית",
  AR: "العربية",
  UNKNOWN: "—",
};

export const REVIEW_STATE_LABEL: Record<string, string> = {
  NEW: "Draft",
  PENDING_REVIEW: "Needs review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const ORIGIN_LABEL: Record<string, string> = {
  INTERNAL: "Written by AXIS",
  INGESTED: "From an external source",
};

export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Changes requested",
  SCHEDULED: "Scheduled",
  SENDING: "Sending",
  SENT: "Sent",
  CANCELED: "Canceled",
  FAILED: "Failed",
};

export const SEND_MODE_LABEL: Record<string, string> = {
  TEST: "Test mode",
  PRODUCTION: "Live sending",
};

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const REVIEW_STATE_TONE: Record<string, Tone> = {
  NEW: "neutral",
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

export const CAMPAIGN_STATUS_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  SCHEDULED: "info",
  SENDING: "info",
  SENT: "success",
  CANCELED: "neutral",
  FAILED: "danger",
};

/** Dates shown to staff — stable, unambiguous, no locale surprises. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Why an address will not receive this campaign, in words staff can act on.
 * Never show the raw reason code.
 */
export const EXCLUSION_REASON_LABEL: Record<string, string> = {
  NO_EMAIL: "No email address on the record",
  INVALID_EMAIL: "Email address is not usable",
  UNSUBSCRIBED: "Unsubscribed from our emails",
  SUPPRESSED: "Blocked after a bounce or complaint",
  CONSENT_DENIED: "Marked do not send",
  CONSENT_NOT_CONFIRMED: "Consent has not been confirmed",
  COMPANY_INACTIVE: "Company is marked inactive",
  ARCHIVED: "Record was archived in Monday",
  LANGUAGE_UNKNOWN: "Language does not match this newsletter",
};

/** What staff should do about each exclusion, where there is something to do. */
export const EXCLUSION_REASON_HINT: Record<string, string> = {
  NO_EMAIL: "Add an address in Monday, then sync.",
  INVALID_EMAIL: "Correct the address in Monday, then sync.",
  UNSUBSCRIBED: "This cannot be overridden here.",
  SUPPRESSED: "This cannot be overridden here.",
  CONSENT_DENIED: "This cannot be overridden here.",
  CONSENT_NOT_CONFIRMED:
    "Record a documented basis on the Communication page if this address may be emailed.",
  COMPANY_INACTIVE: "Change the status in Monday if the customer is active again.",
  ARCHIVED: "Restore the item in Monday if it was archived by mistake.",
  LANGUAGE_UNKNOWN: "Set the language for this address, or send a non-localized newsletter.",
};

export const EMAIL_SOURCE_LABEL: Record<string, string> = {
  COMPANY_EMAIL: "Company address",
  CONTACT_EMAIL: "Contact address",
};

/**
 * Consent in plain words (ADR-0021). These are the ONLY forms staff see; the raw enum
 * names never reach a screen. "Not confirmed" is deliberately neutral — nobody
 * refused, and nobody confirmed either.
 */
export const CONSENT_STATUS_LABEL: Record<string, string> = {
  UNKNOWN: "Not confirmed",
  GRANTED: "Approved for communication",
  DENIED: "Do not send",
};

export const CONSENT_STATUS_TONE: Record<string, Tone> = {
  UNKNOWN: "neutral",
  GRANTED: "success",
  DENIED: "danger",
};

/**
 * The documented bases a person can select when approving an address.
 *
 * These record what a HUMAN asserted. The software makes no legal determination and
 * must never be worded as though it does — choosing an adequate basis is the
 * operator's responsibility.
 */
export const CONSENT_SOURCE_LABEL: Record<string, string> = {
  EXISTING_CUSTOMER_RELATIONSHIP: "Existing customer relationship",
  EXPLICIT_CUSTOMER_PERMISSION: "Explicit customer permission",
  IMPORTED_DOCUMENTED_PERMISSION: "Imported documented permission",
  OTHER_DOCUMENTED_BASIS: "Other documented basis",
};

/** Send-readiness outcomes (ADR-0022). */
export const READINESS_STATUS_LABEL: Record<string, string> = {
  READY: "Ready",
  WARNING: "Check this",
  BLOCKED: "Blocked",
};

export const READINESS_STATUS_TONE: Record<string, Tone> = {
  READY: "success",
  WARNING: "warning",
  BLOCKED: "danger",
};

export const READINESS_STATUS_ICON: Record<string, string> = {
  READY: "✓",
  WARNING: "⚠",
  BLOCKED: "✕",
};

export const EMAIL_STATUS_LABEL: Record<string, string> = {
  UNKNOWN: "Not checked",
  VALID: "Checked and valid",
  INVALID: "Known invalid",
};
