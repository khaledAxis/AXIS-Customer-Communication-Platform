import { normalizeEmail } from "../email/normalizeEmail";
import {
  CUSTOMER_COLUMNS,
  CUSTOMER_PRODUCT_COLUMNS,
  CONTACT_COLUMNS,
  PRODUCT_COLUMNS,
  normalizeCustomerStatus,
  parseMondayDate,
  parseMondayInt,
  parseYesNo,
} from "./mondayColumns";

/**
 * Pure mappers: raw Monday items -> Monday-owned projections (ADR-0017).
 *
 * These encode the ownership boundary (ADR-0009): a projection contains ONLY
 * Monday-owned and system fields. It structurally CANNOT carry `emailStatus`,
 * `language` or `consentStatus` — those live on `CommunicationAddress` and are never
 * written by a sync. Tests assert that separation.
 *
 * Pure: no I/O, no Prisma, no network.
 */

/** A Monday item exactly as the adapter hands it over. */
export interface RawMondayItem {
  boardId: string;
  itemId: string;
  name: string | null;
  updatedAt?: string | null;
  /** columnId -> display text (Monday's `text` field). */
  columns: Record<string, string | null>;
  /** columnId -> linked Monday item ids, for board_relation columns. */
  relations: Record<string, string[]>;
  /** Untouched snapshot kept for troubleshooting/audit. */
  raw?: unknown;
}

function text(item: RawMondayItem, columnId: string): string | null {
  const value = item.columns[columnId];
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function related(item: RawMondayItem, columnId: string): string[] {
  return item.relations[columnId] ?? [];
}

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

export interface CompanyProjection {
  mondayBoardId: string;
  mondayItemId: string;
  name: string | null;
  companyNumber: string | null;
  hashavshevetId: string | null;
  /** Campaign candidate. */
  companyEmail: string | null;
  companyEmailNorm: string | null;
  /** Bookkeeping only — deliberately has NO normalized twin, so it can never be
   *  promoted into a CommunicationAddress by accident (ADR-0009). */
  accountingEmail: string | null;
  companyPhone: string | null;
  category: string | null;
  customerStatus: "POTENTIAL" | "ACTIVE" | "INACTIVE" | "UNKNOWN";
  customerStatusRaw: string | null;
  industryLabel: string | null;
  classificationLabel: string | null;
  /** Monday item ids of linked contacts. */
  contactItemIds: string[];
  mondayUpdatedAt: Date | null;
}

export function toCompanyProjection(item: RawMondayItem): CompanyProjection {
  const companyEmail = text(item, CUSTOMER_COLUMNS.companyEmail);
  const norm = normalizeEmail(companyEmail);
  const statusRaw = text(item, CUSTOMER_COLUMNS.customerStatus);

  return {
    mondayBoardId: item.boardId,
    mondayItemId: item.itemId,
    name: item.name?.trim() || null,
    companyNumber: text(item, CUSTOMER_COLUMNS.companyNumber),
    hashavshevetId: text(item, CUSTOMER_COLUMNS.hashavshevetId),
    companyEmail,
    companyEmailNorm: norm.kind === "valid" ? norm.normalized : null,
    accountingEmail: text(item, CUSTOMER_COLUMNS.accountingEmail),
    companyPhone: text(item, CUSTOMER_COLUMNS.companyPhone),
    category: text(item, CUSTOMER_COLUMNS.category),
    customerStatus: normalizeCustomerStatus(statusRaw),
    customerStatusRaw: statusRaw,
    industryLabel: text(item, CUSTOMER_COLUMNS.industry),
    classificationLabel: text(item, CUSTOMER_COLUMNS.classification),
    contactItemIds: related(item, CUSTOMER_COLUMNS.contactsRelation),
    mondayUpdatedAt: parseMondayDate(item.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export interface ContactCrmProjection {
  mondayBoardId: string;
  mondayItemId: string;
  /** Full Monday name, never split into first/last. */
  fullName: string | null;
  email: string | null;
  emailNorm: string | null;
  phone: string | null;
  jobTitle: string | null;
  address: string | null;
  /** Monday item ids of linked companies (a contact may belong to several). */
  companyItemIds: string[];
  mondayUpdatedAt: Date | null;
}

export function toContactCrmProjection(item: RawMondayItem): ContactCrmProjection {
  const email = text(item, CONTACT_COLUMNS.email);
  const norm = normalizeEmail(email);

  return {
    mondayBoardId: item.boardId,
    mondayItemId: item.itemId,
    fullName: item.name?.trim() || null,
    email,
    emailNorm: norm.kind === "valid" ? norm.normalized : null,
    phone: text(item, CONTACT_COLUMNS.phone),
    jobTitle: text(item, CONTACT_COLUMNS.jobTitle),
    address: text(item, CONTACT_COLUMNS.address),
    companyItemIds: related(item, CONTACT_COLUMNS.companyRelation),
    mondayUpdatedAt: parseMondayDate(item.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Product catalogue
// ---------------------------------------------------------------------------

export interface ProductProjection {
  mondayBoardId: string;
  mondayItemId: string;
  name: string | null;
  itemKey: string | null;
  sku: string | null;
  catalogLink: string | null;
  itemType: string | null;
}

export function toProductProjection(item: RawMondayItem): ProductProjection {
  return {
    mondayBoardId: item.boardId,
    mondayItemId: item.itemId,
    name: item.name?.trim() || null,
    itemKey: text(item, PRODUCT_COLUMNS.itemKey),
    sku: text(item, PRODUCT_COLUMNS.sku),
    catalogLink: text(item, PRODUCT_COLUMNS.catalogLink),
    itemType: text(item, PRODUCT_COLUMNS.itemType),
  };
}

// ---------------------------------------------------------------------------
// Customer-owned products / subscriptions
// ---------------------------------------------------------------------------

export interface CustomerProductProjection {
  mondayBoardId: string;
  mondayItemId: string;
  status: string | null;
  purchaseDate: Date | null;
  hardwareWarrantyUntil: Date | null;
  softwareWarrantyUntil: Date | null;
  subscriptionUntil: Date | null;
  subscriptionLoginId: string | null;
  billingType: string | null;
  includesCommsPackage: boolean | null;
  simCount: number | null;
  /** Monday item ids — resolved to local FKs by the sync service. */
  companyItemIds: string[];
  contactItemIds: string[];
  productItemIds: string[];
}

export function toCustomerProductProjection(item: RawMondayItem): CustomerProductProjection {
  return {
    mondayBoardId: item.boardId,
    mondayItemId: item.itemId,
    status: text(item, CUSTOMER_PRODUCT_COLUMNS.status),
    purchaseDate: parseMondayDate(text(item, CUSTOMER_PRODUCT_COLUMNS.purchaseDate)),
    hardwareWarrantyUntil: parseMondayDate(
      text(item, CUSTOMER_PRODUCT_COLUMNS.hardwareWarrantyUntil),
    ),
    softwareWarrantyUntil: parseMondayDate(
      text(item, CUSTOMER_PRODUCT_COLUMNS.softwareWarrantyUntil),
    ),
    subscriptionUntil: parseMondayDate(text(item, CUSTOMER_PRODUCT_COLUMNS.subscriptionUntil)),
    subscriptionLoginId: text(item, CUSTOMER_PRODUCT_COLUMNS.subscriptionLoginId),
    billingType: text(item, CUSTOMER_PRODUCT_COLUMNS.billingType),
    includesCommsPackage: parseYesNo(text(item, CUSTOMER_PRODUCT_COLUMNS.includesCommsPackage)),
    simCount: parseMondayInt(text(item, CUSTOMER_PRODUCT_COLUMNS.simCount)),
    companyItemIds: related(item, CUSTOMER_PRODUCT_COLUMNS.companyRelation),
    contactItemIds: related(item, CUSTOMER_PRODUCT_COLUMNS.contactRelation),
    productItemIds: related(item, CUSTOMER_PRODUCT_COLUMNS.productRelation),
  };
}

// ---------------------------------------------------------------------------
// Communication address candidates
// ---------------------------------------------------------------------------

export type EmailSource = "COMPANY_EMAIL" | "CONTACT_EMAIL";

export interface CommunicationCandidate {
  normalizedEmail: string;
  source: EmailSource;
}

/**
 * Normalized emails that may become a `CommunicationAddress`.
 *
 * `accountingEmail` is deliberately EXCLUDED: it is a bookkeeping address and must
 * never become a newsletter target without an explicit business decision (ADR-0009).
 */
export function communicationCandidates(
  projection: CompanyProjection | ContactCrmProjection,
): CommunicationCandidate[] {
  if ("companyEmailNorm" in projection) {
    return projection.companyEmailNorm
      ? [{ normalizedEmail: projection.companyEmailNorm, source: "COMPANY_EMAIL" }]
      : [];
  }
  return projection.emailNorm
    ? [{ normalizedEmail: projection.emailNorm, source: "CONTACT_EMAIL" }]
    : [];
}

/** Data-quality classification recorded per synced item (docs/requirements §8.4). */
export function classifyItem(
  projection: CompanyProjection | ContactCrmProjection,
): "SENDABLE" | "NO_EMAIL" | "INVALID_EMAIL" | "INCOMPLETE" {
  const rawEmail = "companyEmail" in projection ? projection.companyEmail : projection.email;
  const norm = "companyEmailNorm" in projection ? projection.companyEmailNorm : projection.emailNorm;
  const name = "name" in projection ? projection.name : projection.fullName;

  if (!rawEmail) return "NO_EMAIL";
  if (!norm) return "INVALID_EMAIL";
  if (!name) return "INCOMPLETE";
  return "SENDABLE";
}
