import {
  classifyItem,
  communicationCandidates,
  toCompanyProjection,
  toContactCrmProjection,
  toCustomerProductProjection,
  toProductProjection,
} from "../../domain/crm/crmProjection";
import { CUSTOMER_COLUMNS, MONDAY_BOARDS } from "../../domain/crm/mondayColumns";
import { Capability, requireCapability } from "../auth/session";
import * as crm from "../db/repositories/crmRepository";
import { getPrisma } from "../db/prisma";
import { getCrmSource } from "../integrations/crm";

/**
 * Read-only CRM synchronization (ADR-0007 / ADR-0017).
 *
 * Monday is the source of truth; this pulls a projection into PostgreSQL and never
 * writes back. Every board read goes through the `CrmSource` port, which has no write
 * method at all — a mutation is unrepresentable, not merely disallowed.
 *
 * Guarantees:
 *  - idempotent: upsert keyed on (mondayBoardId, mondayItemId); re-running changes nothing
 *  - non-destructive: missing items are ARCHIVED, never deleted
 *  - local communication state (language / consent / unsubscribe / suppression) untouched
 *  - one malformed item is logged and skipped; it never aborts the run
 */

export interface BoardSyncSummary {
  boardId: string;
  boardName: string | null;
  itemsRead: number;
  created: number;
  updated: number;
  unchanged: number;
  archived: number;
  failed: number;
  /** Set when the anti-mass-archival guard refused to archive (see repository). */
  archiveSkippedReason?: string;
}

export interface CrmSyncSummary {
  ok: boolean;
  message: string;
  startedAt: Date;
  finishedAt: Date;
  boards: BoardSyncSummary[];
  companies: number;
  contacts: number;
  products: number;
  customerProducts: number;
  companyContactLinks: number;
  communicationAddressesCreated: number;
}

/** One SyncRun row per board, so a partial failure is visible per board. */
async function openRun(boardId: string, kind: "CUSTOMERS" | "CONTACTS" | "PRODUCTS" | "CUSTOMER_PRODUCTS") {
  const prisma = getPrisma();
  await prisma.mondayBoard.upsert({
    where: { mondayBoardId: boardId },
    create: { mondayBoardId: boardId, kind, isActive: true },
    update: { kind },
  });
  return prisma.syncRun.create({
    data: { mondayBoardId: boardId, trigger: "MANUAL", status: "RUNNING" },
  });
}

async function closeRun(
  runId: string,
  summary: BoardSyncSummary,
  status: "SUCCESS" | "PARTIAL" | "FAILED",
  errorMessage?: string,
) {
  await getPrisma().syncRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: new Date(),
      createdCount: summary.created,
      updatedCount: summary.updated,
      archivedCount: summary.archived,
      skippedCount: summary.unchanged,
      errorCount: summary.failed,
      errorMessage: errorMessage ?? null,
    },
  });
}

/** Per-item log. Never stores secrets; the raw item is kept for troubleshooting. */
async function logItem(
  runId: string,
  mondayItemId: string,
  action: "UPSERT" | "ARCHIVE" | "SKIP" | "ERROR",
  classification?: "SENDABLE" | "INCOMPLETE" | "NO_EMAIL" | "INVALID_EMAIL" | "CONFLICT" | "ERROR",
  message?: string,
) {
  await getPrisma().syncItemLog.create({
    data: { syncRunId: runId, mondayItemId, action, classification, message: message ?? null },
  });
}

function emptySummary(boardId: string, boardName: string | null): BoardSyncSummary {
  return {
    boardId,
    boardName,
    itemsRead: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    archived: 0,
    failed: 0,
  };
}

/**
 * Pull all four boards.
 *
 * Order matters: companies and contacts first (so relations can resolve to local ids),
 * then the catalogue, then owned products which reference all three.
 */
export async function syncCrmFromMonday(): Promise<CrmSyncSummary> {
  // Pulling the CRM is a staff action, not an anonymous one. Read-only towards
  // Monday, but it rewrites the local projection, so it is gated like a mutation.
  await requireCapability(Capability.RUN_CRM_SYNC);
  const startedAt = new Date();
  const source = getCrmSource();

  const configuration = source.checkConfiguration();
  if (!configuration.configured) {
    return {
      ok: false,
      message: configuration.message,
      startedAt,
      finishedAt: new Date(),
      boards: [],
      companies: 0,
      contacts: 0,
      products: 0,
      customerProducts: 0,
      companyContactLinks: 0,
      communicationAddressesCreated: 0,
    };
  }

  const boards: BoardSyncSummary[] = [];
  let addressesCreated = 0;
  let links = 0;

  // Monday item id -> linked contact item ids, collected while reading companies.
  const companyContactRelations = new Map<string, string[]>();

  // ---------------------------------------------------------------- companies
  {
    const run = await openRun(MONDAY_BOARDS.CUSTOMERS, "CUSTOMERS");
    const summary = emptySummary(MONDAY_BOARDS.CUSTOMERS, null);
    try {
      const snapshot = await source.fetchBoard(MONDAY_BOARDS.CUSTOMERS);
      summary.boardName = snapshot.boardName;
      summary.itemsRead = snapshot.items.length;
      const seen: string[] = [];

      for (const item of snapshot.items) {
        try {
          const projection = toCompanyProjection(item);
          seen.push(projection.mondayItemId);
          companyContactRelations.set(projection.mondayItemId, projection.contactItemIds);

          const industryId = await crm.ensureIndustry(
            CUSTOMER_COLUMNS.industry,
            projection.industryLabel,
          );
          const classificationId = await crm.ensureClassification(
            CUSTOMER_COLUMNS.classification,
            projection.classificationLabel,
          );

          const outcome = await crm.upsertCompany(
            projection,
            { industryId, classificationId },
            item.raw,
          );
          if (outcome.created) summary.created += 1;
          else if (outcome.unchanged) summary.unchanged += 1;
          else summary.updated += 1;

          // Campaign candidates only — accountingEmail is excluded by the projection.
          for (const candidate of communicationCandidates(projection)) {
            if (await crm.ensureCommunicationAddress(candidate.normalizedEmail)) {
              addressesCreated += 1;
            }
          }

          await logItem(run.id, projection.mondayItemId, "UPSERT", classifyItem(projection));
        } catch (error) {
          // One malformed item must not abort the board.
          summary.failed += 1;
          await logItem(
            run.id,
            item.itemId,
            "ERROR",
            "ERROR",
            error instanceof Error ? error.message.slice(0, 300) : "unknown error",
          );
        }
      }

      const archival = await crm.archiveMissingCompanies(MONDAY_BOARDS.CUSTOMERS, seen);
      summary.archived = archival.archived;
      if (archival.skipped) summary.archiveSkippedReason = archival.reason;
      await closeRun(
        run.id,
        summary,
        summary.failed > 0 || summary.archiveSkippedReason ? "PARTIAL" : "SUCCESS",
        summary.archiveSkippedReason,
      );
    } catch (error) {
      await closeRun(
        run.id,
        summary,
        "FAILED",
        error instanceof Error ? error.message.slice(0, 300) : "unknown error",
      );
    }
    boards.push(summary);
  }

  // ----------------------------------------------------------------- contacts
  const contactCompanyRelations = new Map<string, string[]>();
  {
    const run = await openRun(MONDAY_BOARDS.CONTACTS, "CONTACTS");
    const summary = emptySummary(MONDAY_BOARDS.CONTACTS, null);
    try {
      const snapshot = await source.fetchBoard(MONDAY_BOARDS.CONTACTS);
      summary.boardName = snapshot.boardName;
      summary.itemsRead = snapshot.items.length;
      const seen: string[] = [];

      for (const item of snapshot.items) {
        try {
          const projection = toContactCrmProjection(item);
          seen.push(projection.mondayItemId);
          contactCompanyRelations.set(projection.mondayItemId, projection.companyItemIds);

          const outcome = await crm.upsertContact(projection, item.raw);
          if (outcome.created) summary.created += 1;
          else if (outcome.unchanged) summary.unchanged += 1;
          else summary.updated += 1;

          for (const candidate of communicationCandidates(projection)) {
            if (await crm.ensureCommunicationAddress(candidate.normalizedEmail)) {
              addressesCreated += 1;
            }
          }

          await logItem(run.id, projection.mondayItemId, "UPSERT", classifyItem(projection));
        } catch (error) {
          summary.failed += 1;
          await logItem(
            run.id,
            item.itemId,
            "ERROR",
            "ERROR",
            error instanceof Error ? error.message.slice(0, 300) : "unknown error",
          );
        }
      }

      const archival = await crm.archiveMissingContacts(MONDAY_BOARDS.CONTACTS, seen);
      summary.archived = archival.archived;
      if (archival.skipped) summary.archiveSkippedReason = archival.reason;
      await closeRun(
        run.id,
        summary,
        summary.failed > 0 || summary.archiveSkippedReason ? "PARTIAL" : "SUCCESS",
        summary.archiveSkippedReason,
      );
    } catch (error) {
      await closeRun(
        run.id,
        summary,
        "FAILED",
        error instanceof Error ? error.message.slice(0, 300) : "unknown error",
      );
    }
    boards.push(summary);
  }

  // ------------------------------------------------- company <-> contact links
  {
    const companyIds = await crm.mapCompanyItemIdsToLocalIds(MONDAY_BOARDS.CUSTOMERS);
    const contactIds = await crm.mapContactItemIdsToLocalIds(MONDAY_BOARDS.CONTACTS);

    // Asserted from the customers board...
    for (const [companyItemId, contactItemIdList] of companyContactRelations) {
      const companyId = companyIds.get(companyItemId);
      if (!companyId) continue;
      for (const contactItemId of contactItemIdList) {
        const contactId = contactIds.get(contactItemId);
        if (!contactId) continue;
        if (await crm.linkCompanyContact(companyId, contactId, "CUSTOMERS")) links += 1;
      }
    }
    // ...and from the contacts board. A contact may legitimately link to several
    // companies, and a company may have none — both are real in this CRM.
    for (const [contactItemId, companyItemIdList] of contactCompanyRelations) {
      const contactId = contactIds.get(contactItemId);
      if (!contactId) continue;
      for (const companyItemId of companyItemIdList) {
        const companyId = companyIds.get(companyItemId);
        if (!companyId) continue;
        if (await crm.linkCompanyContact(companyId, contactId, "CONTACTS")) links += 1;
      }
    }
  }

  // ----------------------------------------------------------------- products
  {
    const run = await openRun(MONDAY_BOARDS.PRODUCTS, "PRODUCTS");
    const summary = emptySummary(MONDAY_BOARDS.PRODUCTS, null);
    try {
      const snapshot = await source.fetchBoard(MONDAY_BOARDS.PRODUCTS);
      summary.boardName = snapshot.boardName;
      summary.itemsRead = snapshot.items.length;
      const seen: string[] = [];

      for (const item of snapshot.items) {
        try {
          const projection = toProductProjection(item);
          seen.push(projection.mondayItemId);
          const outcome = await crm.upsertProduct(projection, item.raw);
          if (outcome.created) summary.created += 1;
          else if (outcome.unchanged) summary.unchanged += 1;
          else summary.updated += 1;
          await logItem(run.id, projection.mondayItemId, "UPSERT");
        } catch (error) {
          summary.failed += 1;
          await logItem(
            run.id,
            item.itemId,
            "ERROR",
            "ERROR",
            error instanceof Error ? error.message.slice(0, 300) : "unknown error",
          );
        }
      }

      const archival = await crm.archiveMissingProducts(MONDAY_BOARDS.PRODUCTS, seen);
      summary.archived = archival.archived;
      if (archival.skipped) summary.archiveSkippedReason = archival.reason;
      await closeRun(
        run.id,
        summary,
        summary.failed > 0 || summary.archiveSkippedReason ? "PARTIAL" : "SUCCESS",
        summary.archiveSkippedReason,
      );
    } catch (error) {
      await closeRun(
        run.id,
        summary,
        "FAILED",
        error instanceof Error ? error.message.slice(0, 300) : "unknown error",
      );
    }
    boards.push(summary);
  }

  // -------------------------------------------------------- customer products
  {
    const run = await openRun(MONDAY_BOARDS.CUSTOMER_PRODUCTS, "CUSTOMER_PRODUCTS");
    const summary = emptySummary(MONDAY_BOARDS.CUSTOMER_PRODUCTS, null);
    try {
      const snapshot = await source.fetchBoard(MONDAY_BOARDS.CUSTOMER_PRODUCTS);
      summary.boardName = snapshot.boardName;
      summary.itemsRead = snapshot.items.length;
      const seen: string[] = [];

      const companyIds = await crm.mapCompanyItemIdsToLocalIds(MONDAY_BOARDS.CUSTOMERS);
      const contactIds = await crm.mapContactItemIdsToLocalIds(MONDAY_BOARDS.CONTACTS);
      const productIds = await crm.mapProductItemIdsToLocalIds(MONDAY_BOARDS.PRODUCTS);

      for (const item of snapshot.items) {
        try {
          const projection = toCustomerProductProjection(item);
          seen.push(projection.mondayItemId);

          // An owned product references at most one of each; extra links are ignored
          // rather than guessed at.
          const outcome = await crm.upsertCustomerProduct(
            projection,
            {
              companyId: companyIds.get(projection.companyItemIds[0] ?? "") ?? null,
              contactId: contactIds.get(projection.contactItemIds[0] ?? "") ?? null,
              productId: productIds.get(projection.productItemIds[0] ?? "") ?? null,
            },
            item.raw,
          );
          if (outcome.created) summary.created += 1;
          else if (outcome.unchanged) summary.unchanged += 1;
          else summary.updated += 1;
          await logItem(run.id, projection.mondayItemId, "UPSERT");
        } catch (error) {
          summary.failed += 1;
          await logItem(
            run.id,
            item.itemId,
            "ERROR",
            "ERROR",
            error instanceof Error ? error.message.slice(0, 300) : "unknown error",
          );
        }
      }

      const archival = await crm.archiveMissingCustomerProducts(
        MONDAY_BOARDS.CUSTOMER_PRODUCTS,
        seen,
      );
      summary.archived = archival.archived;
      if (archival.skipped) summary.archiveSkippedReason = archival.reason;
      await closeRun(
        run.id,
        summary,
        summary.failed > 0 || summary.archiveSkippedReason ? "PARTIAL" : "SUCCESS",
        summary.archiveSkippedReason,
      );
    } catch (error) {
      await closeRun(
        run.id,
        summary,
        "FAILED",
        error instanceof Error ? error.message.slice(0, 300) : "unknown error",
      );
    }
    boards.push(summary);
  }

  const prisma = getPrisma();
  const [companies, contacts, products, customerProducts] = await Promise.all([
    prisma.company.count(),
    prisma.contact.count(),
    prisma.product.count(),
    prisma.customerProduct.count(),
  ]);

  const failed = boards.reduce((total, board) => total + board.failed, 0);
  return {
    ok: true,
    message:
      failed === 0
        ? "Customer information updated from Monday."
        : `Customer information updated, with ${failed} item(s) skipped.`,
    startedAt,
    finishedAt: new Date(),
    boards,
    companies,
    contacts,
    products,
    customerProducts,
    companyContactLinks: links,
    communicationAddressesCreated: addressesCreated,
  };
}

/** Provider readiness for the UI. Never contacts Monday, never reveals the token. */
export function checkCrmConfiguration() {
  const source = getCrmSource();
  return { ...source.checkConfiguration(), provider: source.name };
}
