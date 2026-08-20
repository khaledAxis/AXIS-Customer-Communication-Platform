import type {
  CompanyProjection,
  ContactCrmProjection,
  CustomerProductProjection,
  ProductProjection,
} from "../../../domain/crm/crmProjection";
import { getPrisma } from "../prisma";

/**
 * CRM persistence (ADR-0017). The only place Prisma is used for CRM projections.
 *
 * Two rules run through every function here:
 *  1. Identity is the composite `(mondayBoardId, mondayItemId)` — never email.
 *  2. Monday-owned fields are overwritten on every sync; locally-owned communication
 *     state (`CommunicationAddress.language/consentStatus/emailStatus`, unsubscribe,
 *     suppression) is NEVER written by a sync.
 */

export interface UpsertOutcome {
  id: string;
  created: boolean;
  /** True when the row already existed and no Monday-owned field changed. */
  unchanged: boolean;
}

/**
 * Stable positive integer for a Monday status label.
 *
 * The schema keys lookup rows on `(mondayColumnId, mondayLabelIndex)`, but the text
 * API returns labels, not indexes. Deriving the index from the label keeps the upsert
 * idempotent across syncs; renaming a label in Monday simply creates a new row rather
 * than corrupting the history attached to the old one.
 */
export function labelIndex(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export async function ensureIndustry(columnId: string, label: string | null): Promise<string | null> {
  if (!label) return null;
  const prisma = getPrisma();
  const index = labelIndex(label);
  const row = await prisma.industry.upsert({
    where: { mondayColumnId_mondayLabelIndex: { mondayColumnId: columnId, mondayLabelIndex: index } },
    create: { mondayColumnId: columnId, mondayLabelIndex: index, label },
    update: { label, isActive: true },
  });
  return row.id;
}

export async function ensureClassification(
  columnId: string,
  label: string | null,
): Promise<string | null> {
  if (!label) return null;
  const prisma = getPrisma();
  const index = labelIndex(label);
  const row = await prisma.customerClassification.upsert({
    where: { mondayColumnId_mondayLabelIndex: { mondayColumnId: columnId, mondayLabelIndex: index } },
    create: { mondayColumnId: columnId, mondayLabelIndex: index, label },
    update: { label, isActive: true },
  });
  return row.id;
}

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

export async function upsertCompany(
  projection: CompanyProjection,
  refs: { industryId: string | null; classificationId: string | null },
  raw: unknown,
): Promise<UpsertOutcome> {
  const prisma = getPrisma();
  const key = {
    mondayBoardId: projection.mondayBoardId,
    mondayItemId: projection.mondayItemId,
  };

  const existing = await prisma.company.findUnique({
    where: { mondayBoardId_mondayItemId: key },
  });

  // ONLY Monday-owned + system fields. No communication state appears here.
  const owned = {
    name: projection.name,
    companyNumber: projection.companyNumber,
    hashavshevetId: projection.hashavshevetId,
    companyEmail: projection.companyEmail,
    companyEmailNorm: projection.companyEmailNorm,
    accountingEmail: projection.accountingEmail,
    companyPhone: projection.companyPhone,
    category: projection.category,
    customerStatus: projection.customerStatus,
    customerStatusRaw: projection.customerStatusRaw,
    industryId: refs.industryId,
    classificationId: refs.classificationId,
    mondayUpdatedAt: projection.mondayUpdatedAt,
  };

  const unchanged =
    existing !== null &&
    (Object.keys(owned) as (keyof typeof owned)[]).every((field) => {
      const before = existing[field as keyof typeof existing];
      const after = owned[field];
      if (before instanceof Date && after instanceof Date) return before.getTime() === after.getTime();
      return before === after;
    });

  const row = await prisma.company.upsert({
    where: { mondayBoardId_mondayItemId: key },
    create: {
      ...key,
      ...owned,
      source: "MONDAY",
      rawItem: raw as never,
      syncedAt: new Date(),
    },
    update: {
      ...owned,
      rawItem: raw as never,
      syncedAt: new Date(),
      // A record that reappears in Monday is un-archived.
      archivedAt: null,
      mondayDeletedAt: null,
    },
  });

  return { id: row.id, created: existing === null, unchanged };
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export async function upsertContact(
  projection: ContactCrmProjection,
  raw: unknown,
): Promise<UpsertOutcome> {
  const prisma = getPrisma();
  const key = {
    mondayBoardId: projection.mondayBoardId,
    mondayItemId: projection.mondayItemId,
  };

  const existing = await prisma.contact.findUnique({
    where: { mondayBoardId_mondayItemId: key },
  });

  const owned = {
    fullName: projection.fullName,
    email: projection.email,
    emailNorm: projection.emailNorm,
    phone: projection.phone,
    jobTitle: projection.jobTitle,
    address: projection.address,
    mondayUpdatedAt: projection.mondayUpdatedAt,
  };

  const unchanged =
    existing !== null &&
    (Object.keys(owned) as (keyof typeof owned)[]).every((field) => {
      const before = existing[field as keyof typeof existing];
      const after = owned[field];
      if (before instanceof Date && after instanceof Date) return before.getTime() === after.getTime();
      return before === after;
    });

  const row = await prisma.contact.upsert({
    where: { mondayBoardId_mondayItemId: key },
    create: { ...key, ...owned, source: "MONDAY", rawItem: raw as never, syncedAt: new Date() },
    update: {
      ...owned,
      rawItem: raw as never,
      syncedAt: new Date(),
      archivedAt: null,
      mondayDeletedAt: null,
    },
  });

  return { id: row.id, created: existing === null, unchanged };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function upsertProduct(
  projection: ProductProjection,
  raw: unknown,
): Promise<UpsertOutcome> {
  const prisma = getPrisma();
  const key = {
    mondayBoardId: projection.mondayBoardId,
    mondayItemId: projection.mondayItemId,
  };
  const existing = await prisma.product.findUnique({ where: { mondayBoardId_mondayItemId: key } });

  const owned = {
    name: projection.name,
    itemKey: projection.itemKey,
    sku: projection.sku,
    catalogLink: projection.catalogLink,
    itemType: projection.itemType,
  };

  const unchanged =
    existing !== null &&
    (Object.keys(owned) as (keyof typeof owned)[]).every(
      (field) => existing[field as keyof typeof existing] === owned[field],
    );

  const row = await prisma.product.upsert({
    where: { mondayBoardId_mondayItemId: key },
    create: { ...key, ...owned, rawItem: raw as never, syncedAt: new Date() },
    update: { ...owned, rawItem: raw as never, syncedAt: new Date(), archivedAt: null },
  });

  return { id: row.id, created: existing === null, unchanged };
}

export async function upsertCustomerProduct(
  projection: CustomerProductProjection,
  refs: { companyId: string | null; contactId: string | null; productId: string | null },
  raw: unknown,
): Promise<UpsertOutcome> {
  const prisma = getPrisma();
  const key = {
    mondayBoardId: projection.mondayBoardId,
    mondayItemId: projection.mondayItemId,
  };
  const existing = await prisma.customerProduct.findUnique({
    where: { mondayBoardId_mondayItemId: key },
  });

  const owned = {
    companyId: refs.companyId,
    contactId: refs.contactId,
    productId: refs.productId,
    status: projection.status,
    purchaseDate: projection.purchaseDate,
    hardwareWarrantyUntil: projection.hardwareWarrantyUntil,
    softwareWarrantyUntil: projection.softwareWarrantyUntil,
    subscriptionUntil: projection.subscriptionUntil,
    subscriptionLoginId: projection.subscriptionLoginId,
    billingType: projection.billingType,
    includesCommsPackage: projection.includesCommsPackage,
    simCount: projection.simCount,
  };

  const unchanged =
    existing !== null &&
    (Object.keys(owned) as (keyof typeof owned)[]).every((field) => {
      const before = existing[field as keyof typeof existing];
      const after = owned[field];
      if (before instanceof Date && after instanceof Date) return before.getTime() === after.getTime();
      return before === after;
    });

  const row = await prisma.customerProduct.upsert({
    where: { mondayBoardId_mondayItemId: key },
    create: { ...key, ...owned, rawItem: raw as never, syncedAt: new Date() },
    update: { ...owned, rawItem: raw as never, syncedAt: new Date(), archivedAt: null },
  });

  return { id: row.id, created: existing === null, unchanged };
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

/** Idempotent many-to-many link. Re-running a sync never duplicates a link. */
export async function linkCompanyContact(
  companyId: string,
  contactId: string,
  assertedBy: "CUSTOMERS" | "CONTACTS",
): Promise<boolean> {
  const prisma = getPrisma();
  const existing = await prisma.companyContact.findUnique({
    where: { companyId_contactId: { companyId, contactId } },
  });
  if (existing) {
    await prisma.companyContact.update({
      where: { id: existing.id },
      data: { syncedAt: new Date() },
    });
    return false;
  }
  await prisma.companyContact.create({
    data: { companyId, contactId, assertedBy, syncedAt: new Date() },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Communication addresses — created, never overwritten
// ---------------------------------------------------------------------------

/**
 * Ensure a `CommunicationAddress` row exists for a normalized email.
 *
 * CREATE-ONLY BY DESIGN. If the row already exists this touches nothing: `language`,
 * `consentStatus` and `emailStatus` are locally owned, and unsubscribe/suppression
 * hang off this row. A CRM sync must never reset them (ADR-0009).
 *
 * Returns true when a new address was created.
 */
export async function ensureCommunicationAddress(normalizedEmail: string): Promise<boolean> {
  const prisma = getPrisma();
  const existing = await prisma.communicationAddress.findUnique({ where: { normalizedEmail } });
  if (existing) return false;

  try {
    await prisma.communicationAddress.create({ data: { normalizedEmail } });
    return true;
  } catch {
    // Lost a race with a concurrent sync — the row exists, which is all we needed.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Archival — never a hard delete
// ---------------------------------------------------------------------------

/**
 * Mark records that no longer appear in Monday as archived.
 *
 * Deliberately NOT a delete: campaign history, recipient sources and communication
 * state must survive a CRM record disappearing (ADR-0009 / CLAUDE.md).
 *
 * ANTI-MASS-ARCHIVAL GUARD: a partial or filtered API response is indistinguishable
 * from "everything was deleted", so archiving a large share of a board is treated as
 * suspicious and SKIPPED. Real bulk deletions are rare and deserve a deliberate act;
 * silently archiving a whole customer base because of one bad response is not
 * acceptable. The run records that it was skipped so nothing is hidden.
 */
export const MAX_ARCHIVE_FRACTION = 0.2;
/** Boards smaller than this may legitimately change wholesale. */
const SMALL_BOARD_THRESHOLD = 10;

export interface ArchiveOutcome {
  archived: number;
  skipped: boolean;
  reason?: string;
}

/** `stored` is the count of ACTIVE records — already-archived rows are not at risk. */
function guard(stored: number, wouldArchive: number): ArchiveOutcome | null {
  if (wouldArchive === 0) return { archived: 0, skipped: false };
  if (stored < SMALL_BOARD_THRESHOLD) return null; // allow
  if (wouldArchive / stored > MAX_ARCHIVE_FRACTION) {
    return {
      archived: 0,
      skipped: true,
      reason:
        `Refused to archive ${wouldArchive} of ${stored} records (over ` +
        `${Math.round(MAX_ARCHIVE_FRACTION * 100)}%). This usually means an incomplete ` +
        `response rather than a real deletion. Nothing was changed.`,
    };
  }
  return null; // allow
}
export async function archiveMissingCompanies(
  boardId: string,
  seenItemIds: string[],
): Promise<ArchiveOutcome> {
  const prisma = getPrisma();
  const where = {
    mondayBoardId: boardId,
    mondayItemId: { notIn: seenItemIds },
    archivedAt: null,
  } as const;

  const [stored, wouldArchive] = await Promise.all([
    prisma.company.count({ where: { mondayBoardId: boardId, archivedAt: null } }),
    prisma.company.count({ where }),
  ]);

  const blocked = guard(stored, wouldArchive);
  if (blocked) return blocked;

  const result = await prisma.company.updateMany({
    where,
    data: { archivedAt: new Date(), mondayDeletedAt: new Date() },
  });
  return { archived: result.count, skipped: false };
}

export async function archiveMissingContacts(
  boardId: string,
  seenItemIds: string[],
): Promise<ArchiveOutcome> {
  const prisma = getPrisma();
  const where = {
    mondayBoardId: boardId,
    mondayItemId: { notIn: seenItemIds },
    archivedAt: null,
  } as const;

  const [stored, wouldArchive] = await Promise.all([
    prisma.contact.count({ where: { mondayBoardId: boardId, archivedAt: null } }),
    prisma.contact.count({ where }),
  ]);

  const blocked = guard(stored, wouldArchive);
  if (blocked) return blocked;

  const result = await prisma.contact.updateMany({
    where,
    data: { archivedAt: new Date(), mondayDeletedAt: new Date() },
  });
  return { archived: result.count, skipped: false };
}

export async function archiveMissingProducts(
  boardId: string,
  seenItemIds: string[],
): Promise<ArchiveOutcome> {
  const prisma = getPrisma();
  const where = {
    mondayBoardId: boardId,
    mondayItemId: { notIn: seenItemIds },
    archivedAt: null,
  } as const;

  const [stored, wouldArchive] = await Promise.all([
    prisma.product.count({ where: { mondayBoardId: boardId, archivedAt: null } }),
    prisma.product.count({ where }),
  ]);

  const blocked = guard(stored, wouldArchive);
  if (blocked) return blocked;

  const result = await prisma.product.updateMany({
    where,
    data: { archivedAt: new Date() },
  });
  return { archived: result.count, skipped: false };
}

export async function archiveMissingCustomerProducts(
  boardId: string,
  seenItemIds: string[],
): Promise<ArchiveOutcome> {
  const prisma = getPrisma();
  const where = {
    mondayBoardId: boardId,
    mondayItemId: { notIn: seenItemIds },
    archivedAt: null,
  } as const;

  const [stored, wouldArchive] = await Promise.all([
    prisma.customerProduct.count({ where: { mondayBoardId: boardId, archivedAt: null } }),
    prisma.customerProduct.count({ where }),
  ]);

  const blocked = guard(stored, wouldArchive);
  if (blocked) return blocked;

  const result = await prisma.customerProduct.updateMany({
    where,
    data: { archivedAt: new Date() },
  });
  return { archived: result.count, skipped: false };
}

// ---------------------------------------------------------------------------
// Lookups used while resolving relations
// ---------------------------------------------------------------------------

export async function mapCompanyItemIdsToLocalIds(boardId: string): Promise<Map<string, string>> {
  const rows = await getPrisma().company.findMany({
    where: { mondayBoardId: boardId },
    select: { id: true, mondayItemId: true },
  });
  return new Map(rows.map((row) => [row.mondayItemId, row.id]));
}

export async function mapContactItemIdsToLocalIds(boardId: string): Promise<Map<string, string>> {
  const rows = await getPrisma().contact.findMany({
    where: { mondayBoardId: boardId },
    select: { id: true, mondayItemId: true },
  });
  return new Map(rows.map((row) => [row.mondayItemId, row.id]));
}

export async function mapProductItemIdsToLocalIds(boardId: string): Promise<Map<string, string>> {
  const rows = await getPrisma().product.findMany({
    where: { mondayBoardId: boardId },
    select: { id: true, mondayItemId: true },
  });
  return new Map(rows.map((row) => [row.mondayItemId, row.id]));
}
