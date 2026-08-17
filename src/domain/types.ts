/**
 * Pure domain enums/types. No I/O, no Prisma import (keeps `domain/` testable and
 * vendor-independent per CLAUDE.md). These string-literal unions mirror the Prisma
 * enums by name; the database is the source of the enum values, this is the domain view.
 */

export const Language = { HE: "HE", AR: "AR", UNKNOWN: "UNKNOWN" } as const;
export type Language = (typeof Language)[keyof typeof Language];

export const ConsentStatus = {
  UNKNOWN: "UNKNOWN",
  GRANTED: "GRANTED",
  DENIED: "DENIED",
} as const;
export type ConsentStatus = (typeof ConsentStatus)[keyof typeof ConsentStatus];

export const EmailStatus = {
  UNKNOWN: "UNKNOWN",
  VALID: "VALID",
  INVALID: "INVALID",
} as const;
export type EmailStatus = (typeof EmailStatus)[keyof typeof EmailStatus];

export const CrmBoardKind = {
  CUSTOMERS: "CUSTOMERS",
  CONTACTS: "CONTACTS",
  PRODUCTS: "PRODUCTS",
  CUSTOMER_PRODUCTS: "CUSTOMER_PRODUCTS",
} as const;
export type CrmBoardKind = (typeof CrmBoardKind)[keyof typeof CrmBoardKind];

export const EmailSourceType = {
  COMPANY_EMAIL: "COMPANY_EMAIL",
  CONTACT_EMAIL: "CONTACT_EMAIL",
} as const;
export type EmailSourceType = (typeof EmailSourceType)[keyof typeof EmailSourceType];

export const ExclusionReason = {
  NO_EMAIL: "NO_EMAIL",
  INVALID_EMAIL: "INVALID_EMAIL",
  UNSUBSCRIBED: "UNSUBSCRIBED",
  SUPPRESSED: "SUPPRESSED",
  CONSENT_DENIED: "CONSENT_DENIED",
  COMPANY_INACTIVE: "COMPANY_INACTIVE",
  ARCHIVED: "ARCHIVED",
  LANGUAGE_UNKNOWN: "LANGUAGE_UNKNOWN",
} as const;
export type ExclusionReason = (typeof ExclusionReason)[keyof typeof ExclusionReason];
