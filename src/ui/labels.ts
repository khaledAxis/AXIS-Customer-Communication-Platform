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
