import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import type { RawMondayItem } from "../../src/domain/crm/crmProjection";
import {
  CUSTOMER_COLUMNS,
  CUSTOMER_PRODUCT_COLUMNS,
  CONTACT_COLUMNS,
  PRODUCT_COLUMNS,
  MONDAY_BOARDS,
} from "../../src/domain/crm/mondayColumns";
import { getPrisma } from "../../src/server/db/prisma";
import { FakeCrmSource } from "../../src/server/integrations/crm/fakeCrmSource";
import { setCrmSourceForTesting } from "../../src/server/integrations/crm";
import * as crmRepo from "../../src/server/db/repositories/crmRepository";
import { syncCrmFromMonday } from "../../src/server/services/crmSyncService";
import {
  actAs,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * Read-only CRM sync against real PostgreSQL, with a FAKE Monday source.
 *
 * No test contacts Monday: the source is replaced for the whole suite and restored
 * afterwards. Repeatable — run-scoped Monday item ids, scoped cleanup, no truncation.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 12);
let seq = 0;
/** Run-scoped Monday item id so parallel/repeat runs never collide. */
const mid = (): string => `${RUN}${(seq++).toString(36)}`;

const created = {
  companyItemIds: [] as string[],
  contactItemIds: [] as string[],
  productItemIds: [] as string[],
  customerProductItemIds: [] as string[],
  emails: [] as string[],
};

function item(
  boardId: string,
  itemId: string,
  columns: Record<string, string | null>,
  relations: Record<string, string[]> = {},
  name: string | null = "Item",
): RawMondayItem {
  return { boardId, itemId, name, columns, relations, raw: { id: itemId } };
}

d("read-only CRM synchronization", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let source: FakeCrmSource;

  /** Install a fake CRM containing only this run's items. */
  const install = (boards: Partial<Record<string, RawMondayItem[]>> = {}) => {
    source = new FakeCrmSource({
      [MONDAY_BOARDS.CUSTOMERS]: boards[MONDAY_BOARDS.CUSTOMERS] ?? [],
      [MONDAY_BOARDS.CONTACTS]: boards[MONDAY_BOARDS.CONTACTS] ?? [],
      [MONDAY_BOARDS.PRODUCTS]: boards[MONDAY_BOARDS.PRODUCTS] ?? [],
      [MONDAY_BOARDS.CUSTOMER_PRODUCTS]: boards[MONDAY_BOARDS.CUSTOMER_PRODUCTS] ?? [],
    });
    setCrmSourceForTesting(source);
    return source;
  };

  const company = (itemId: string, columns: Record<string, string | null>, relations = {}, name = "Co") => {
    created.companyItemIds.push(itemId);
    const email = columns[CUSTOMER_COLUMNS.companyEmail];
    if (email) created.emails.push(email.toLowerCase());
    return item(MONDAY_BOARDS.CUSTOMERS, itemId, columns, relations, name);
  };

  const contact = (itemId: string, columns: Record<string, string | null>, relations = {}, name = "Person") => {
    created.contactItemIds.push(itemId);
    const email = columns[CONTACT_COLUMNS.email];
    if (email) created.emails.push(email.toLowerCase());
    return item(MONDAY_BOARDS.CONTACTS, itemId, columns, relations, name);
  };

  const localCompany = (mondayItemId: string) =>
    prisma.company.findUnique({
      where: {
        mondayBoardId_mondayItemId: { mondayBoardId: MONDAY_BOARDS.CUSTOMERS, mondayItemId },
      },
    });

  const localContact = (mondayItemId: string) =>
    prisma.contact.findUnique({
      where: {
        mondayBoardId_mondayItemId: { mondayBoardId: MONDAY_BOARDS.CONTACTS, mondayItemId },
      },
    });

  /** Every service call in this suite runs as a real, signed-in manager. */

  let operator: TestUser;


  beforeAll(async () => {

    operator = await createTestUser({ prefix: "crmsync", role: "MANAGER" });

    actAs(operator);
    prisma = getPrisma();
    await prisma.$connect();
  });

  beforeEach(() => install());

  afterAll(async () => {

    clearTestActor();
    setCrmSourceForTesting(undefined);
    try {
      // Only rows this run created, in FK-safe order.
      await prisma.customerProduct.deleteMany({
        where: { mondayItemId: { in: created.customerProductItemIds } },
      });
      await prisma.companyContact.deleteMany({
        where: {
          OR: [
            { company: { mondayItemId: { in: created.companyItemIds } } },
            { contact: { mondayItemId: { in: created.contactItemIds } } },
          ],
        },
      });
      await prisma.product.deleteMany({ where: { mondayItemId: { in: created.productItemIds } } });
      await prisma.contact.deleteMany({ where: { mondayItemId: { in: created.contactItemIds } } });
      await prisma.company.deleteMany({ where: { mondayItemId: { in: created.companyItemIds } } });
      await prisma.unsubscribe.deleteMany({ where: { normalizedEmail: { in: created.emails } } });
      await prisma.suppression.deleteMany({ where: { normalizedEmail: { in: created.emails } } });
      await prisma.communicationAddress.deleteMany({
        where: { normalizedEmail: { in: created.emails } },
      });
      // Lookup rows created from this run's synthetic labels.
      await prisma.industry.deleteMany({ where: { label: { startsWith: `Industry-${RUN}` } } });
    } finally {
      await prisma.$disconnect();
    }
  
    await getPrisma().user.deleteMany({ where: { id: operator.id } });
});

  // ------------------------------------------------------------- companies

  it("creates companies on the first sync", async () => {
    const id = mid();
    install({
      [MONDAY_BOARDS.CUSTOMERS]: [
        company(id, {
          [CUSTOMER_COLUMNS.companyEmail]: `sales-${id}@bigco.test`,
          [CUSTOMER_COLUMNS.customerStatus]: "פעיל",
          [CUSTOMER_COLUMNS.industry]: `Industry-${id}`,
          [CUSTOMER_COLUMNS.companyPhone]: "03-1234567",
        }, {}, `BigCo ${id}`),
      ],
    });

    const summary = await syncCrmFromMonday();
    expect(summary.ok).toBe(true);

    const stored = await localCompany(id);
    expect(stored?.name).toBe(`BigCo ${id}`);
    expect(stored?.customerStatus).toBe("ACTIVE");
    expect(stored?.companyEmailNorm).toBe(`sales-${id}@bigco.test`);
    expect(stored?.industryId).not.toBeNull();
    expect(stored?.syncedAt).not.toBeNull();
  });

  it("is idempotent — a second unchanged sync creates no duplicates", async () => {
    const id = mid();
    const items = [company(id, { [CUSTOMER_COLUMNS.companyEmail]: `a-${id}@x.test` }, {}, "Stable")];
    install({ [MONDAY_BOARDS.CUSTOMERS]: items });

    await syncCrmFromMonday();
    const first = await prisma.company.count({ where: { mondayItemId: id } });
    const firstAddresses = await prisma.communicationAddress.count({
      where: { normalizedEmail: `a-${id}@x.test` },
    });

    const second = await syncCrmFromMonday();

    expect(await prisma.company.count({ where: { mondayItemId: id } })).toBe(first);
    expect(
      await prisma.communicationAddress.count({ where: { normalizedEmail: `a-${id}@x.test` } }),
    ).toBe(firstAddresses);
    // Nothing changed, so the board reports it as unchanged rather than updated.
    const board = second.boards.find((b) => b.boardId === MONDAY_BOARDS.CUSTOMERS);
    expect(board?.unchanged).toBeGreaterThanOrEqual(1);
    expect(board?.created).toBe(0);
  });

  it("applies a field update from Monday", async () => {
    const id = mid();
    install({ [MONDAY_BOARDS.CUSTOMERS]: [company(id, {}, {}, "Before")] });
    await syncCrmFromMonday();

    source.setBoard(MONDAY_BOARDS.CUSTOMERS, [
      item(MONDAY_BOARDS.CUSTOMERS, id, { [CUSTOMER_COLUMNS.companyPhone]: "09-9999999" }, {}, "After"),
    ]);
    const summary = await syncCrmFromMonday();

    const stored = await localCompany(id);
    expect(stored?.name).toBe("After");
    expect(stored?.companyPhone).toBe("09-9999999");
    expect(summary.boards.find((b) => b.boardId === MONDAY_BOARDS.CUSTOMERS)?.updated).toBe(1);
  });

  // -------------------------------------------------------------- contacts

  it("creates contacts and preserves the full Monday name", async () => {
    const id = mid();
    install({
      [MONDAY_BOARDS.CONTACTS]: [
        contact(id, { [CONTACT_COLUMNS.jobTitle]: "מנהל" }, {}, "דנה כהן לוי"),
      ],
    });
    await syncCrmFromMonday();

    const stored = await localContact(id);
    expect(stored?.fullName).toBe("דנה כהן לוי");
    expect(stored?.jobTitle).toBe("מנהל");
  });

  it("supports an orphan contact with no company", async () => {
    const id = mid();
    install({ [MONDAY_BOARDS.CONTACTS]: [contact(id, {}, {}, "Orphan")] });
    await syncCrmFromMonday();

    const stored = await localContact(id);
    expect(stored).not.toBeNull();
    expect(await prisma.companyContact.count({ where: { contactId: stored!.id } })).toBe(0);
  });

  it("links a contact to one company", async () => {
    const companyId = mid();
    const contactId = mid();
    install({
      [MONDAY_BOARDS.CUSTOMERS]: [
        company(companyId, {}, { [CUSTOMER_COLUMNS.contactsRelation]: [contactId] }),
      ],
      [MONDAY_BOARDS.CONTACTS]: [contact(contactId, {})],
    });
    await syncCrmFromMonday();

    const localC = await localCompany(companyId);
    const localP = await localContact(contactId);
    expect(
      await prisma.companyContact.count({ where: { companyId: localC!.id, contactId: localP!.id } }),
    ).toBe(1);
  });

  it("links a contact to MULTIPLE companies", async () => {
    const c1 = mid();
    const c2 = mid();
    const person = mid();
    install({
      [MONDAY_BOARDS.CUSTOMERS]: [company(c1, {}, {}, "One"), company(c2, {}, {}, "Two")],
      [MONDAY_BOARDS.CONTACTS]: [
        contact(person, {}, { [CONTACT_COLUMNS.companyRelation]: [c1, c2] }),
      ],
    });
    await syncCrmFromMonday();

    const localP = await localContact(person);
    expect(await prisma.companyContact.count({ where: { contactId: localP!.id } })).toBe(2);
  });

  it("keeps company-contact links idempotent across syncs", async () => {
    const companyId = mid();
    const contactId = mid();
    // Asserted from BOTH boards — must still yield exactly one link.
    install({
      [MONDAY_BOARDS.CUSTOMERS]: [
        company(companyId, {}, { [CUSTOMER_COLUMNS.contactsRelation]: [contactId] }),
      ],
      [MONDAY_BOARDS.CONTACTS]: [
        contact(contactId, {}, { [CONTACT_COLUMNS.companyRelation]: [companyId] }),
      ],
    });

    await syncCrmFromMonday();
    await syncCrmFromMonday();

    const localC = await localCompany(companyId);
    expect(await prisma.companyContact.count({ where: { companyId: localC!.id } })).toBe(1);
  });

  // -------------------------------------------------------------- products

  it("syncs the product catalogue and customer-owned products with relations", async () => {
    const companyId = mid();
    const contactId = mid();
    const productId = mid();
    const ownedId = mid();
    created.productItemIds.push(productId);
    created.customerProductItemIds.push(ownedId);

    install({
      [MONDAY_BOARDS.CUSTOMERS]: [company(companyId, {}, {}, "Owner")],
      [MONDAY_BOARDS.CONTACTS]: [contact(contactId, {}, {}, "User")],
      [MONDAY_BOARDS.PRODUCTS]: [
        item(
          MONDAY_BOARDS.PRODUCTS,
          productId,
          { [PRODUCT_COLUMNS.sku]: "SKU-1", [PRODUCT_COLUMNS.itemType]: "GPS" },
          {},
          "R980",
        ),
      ],
      [MONDAY_BOARDS.CUSTOMER_PRODUCTS]: [
        item(
          MONDAY_BOARDS.CUSTOMER_PRODUCTS,
          ownedId,
          {
            [CUSTOMER_PRODUCT_COLUMNS.status]: "פעיל",
            [CUSTOMER_PRODUCT_COLUMNS.subscriptionUntil]: "2027-08-06",
            [CUSTOMER_PRODUCT_COLUMNS.simCount]: "2",
          },
          {
            [CUSTOMER_PRODUCT_COLUMNS.companyRelation]: [companyId],
            [CUSTOMER_PRODUCT_COLUMNS.contactRelation]: [contactId],
            [CUSTOMER_PRODUCT_COLUMNS.productRelation]: [productId],
          },
        ),
      ],
    });

    await syncCrmFromMonday();

    const owned = await prisma.customerProduct.findUnique({
      where: {
        mondayBoardId_mondayItemId: {
          mondayBoardId: MONDAY_BOARDS.CUSTOMER_PRODUCTS,
          mondayItemId: ownedId,
        },
      },
      include: { company: true, contact: true, product: true },
    });

    expect(owned?.product?.name).toBe("R980");
    expect(owned?.company?.mondayItemId).toBe(companyId);
    expect(owned?.contact?.mondayItemId).toBe(contactId);
    expect(owned?.simCount).toBe(2);
    expect(owned?.subscriptionUntil?.toISOString().slice(0, 10)).toBe("2027-08-06");
  });

  // ------------------------------------------------------- duplicate emails

  it("keeps duplicate-email CRM records separate but shares ONE communication address", async () => {
    const a = mid();
    const b = mid();
    const shared = `shared-${a}@dup.test`;

    install({
      [MONDAY_BOARDS.CONTACTS]: [
        contact(a, { [CONTACT_COLUMNS.email]: shared }, {}, "Person A"),
        contact(b, { [CONTACT_COLUMNS.email]: shared }, {}, "Person B"),
      ],
    });
    await syncCrmFromMonday();

    // Both CRM records survive independently...
    expect(await localContact(a)).not.toBeNull();
    expect(await localContact(b)).not.toBeNull();
    // ...but the communication identity is unique per normalized email.
    expect(await prisma.communicationAddress.count({ where: { normalizedEmail: shared } })).toBe(1);
  });

  it("does NOT create a communication address from the accounting email", async () => {
    const id = mid();
    const accounting = `books-${id}@dup.test`;
    created.emails.push(accounting);

    install({
      [MONDAY_BOARDS.CUSTOMERS]: [
        company(id, { [CUSTOMER_COLUMNS.accountingEmail]: accounting }, {}, "Books Only"),
      ],
    });
    await syncCrmFromMonday();

    expect(await localCompany(id)).not.toBeNull();
    expect(
      await prisma.communicationAddress.count({ where: { normalizedEmail: accounting } }),
    ).toBe(0);
  });

  // --------------------------------------------- local state is never clobbered

  it("preserves locally-owned language and consent across a resync", async () => {
    const id = mid();
    const email = `local-${id}@state.test`;
    install({ [MONDAY_BOARDS.CONTACTS]: [contact(id, { [CONTACT_COLUMNS.email]: email })] });
    await syncCrmFromMonday();

    await prisma.communicationAddress.update({
      where: { normalizedEmail: email },
      data: { language: "HE", consentStatus: "DENIED", emailStatus: "VALID" },
    });

    await syncCrmFromMonday();

    const address = await prisma.communicationAddress.findUnique({
      where: { normalizedEmail: email },
    });
    expect(address?.language).toBe("HE");
    expect(address?.consentStatus).toBe("DENIED");
    expect(address?.emailStatus).toBe("VALID");
  });

  it("preserves an unsubscribe across a resync", async () => {
    const id = mid();
    const email = `unsub-${id}@state.test`;
    install({ [MONDAY_BOARDS.CONTACTS]: [contact(id, { [CONTACT_COLUMNS.email]: email })] });
    await syncCrmFromMonday();

    const address = await prisma.communicationAddress.findUnique({
      where: { normalizedEmail: email },
    });
    await prisma.unsubscribe.create({
      data: {
        normalizedEmail: email,
        communicationAddressId: address!.id,
        scope: "GLOBAL",
        source: "RECIPIENT_LINK",
      },
    });

    await syncCrmFromMonday();

    expect(await prisma.unsubscribe.count({ where: { normalizedEmail: email } })).toBe(1);
  });

  it("preserves a suppression across a resync", async () => {
    const id = mid();
    const email = `supp-${id}@state.test`;
    install({ [MONDAY_BOARDS.CONTACTS]: [contact(id, { [CONTACT_COLUMNS.email]: email })] });
    await syncCrmFromMonday();

    const address = await prisma.communicationAddress.findUnique({
      where: { normalizedEmail: email },
    });
    await prisma.suppression.create({
      data: {
        normalizedEmail: email,
        communicationAddressId: address!.id,
        reason: "HARD_BOUNCE",
      },
    });

    await syncCrmFromMonday();

    expect(await prisma.suppression.count({ where: { normalizedEmail: email } })).toBe(1);
  });

  it("keeps the old address and its history when a CRM email changes", async () => {
    const id = mid();
    const oldEmail = `old-${id}@change.test`;
    const newEmail = `new-${id}@change.test`;
    created.emails.push(oldEmail, newEmail);

    install({ [MONDAY_BOARDS.CONTACTS]: [contact(id, { [CONTACT_COLUMNS.email]: oldEmail })] });
    await syncCrmFromMonday();

    const oldAddress = await prisma.communicationAddress.findUnique({
      where: { normalizedEmail: oldEmail },
    });
    await prisma.unsubscribe.create({
      data: {
        normalizedEmail: oldEmail,
        communicationAddressId: oldAddress!.id,
        scope: "GLOBAL",
        source: "RECIPIENT_LINK",
      },
    });

    // Monday now reports a different email for the same CRM item.
    source.setBoard(MONDAY_BOARDS.CONTACTS, [
      item(MONDAY_BOARDS.CONTACTS, id, { [CONTACT_COLUMNS.email]: newEmail }),
    ]);
    await syncCrmFromMonday();

    // The contact points at the new address...
    expect((await localContact(id))?.emailNorm).toBe(newEmail);
    // ...the new address exists...
    expect(
      await prisma.communicationAddress.count({ where: { normalizedEmail: newEmail } }),
    ).toBe(1);
    // ...and the OLD address plus its unsubscribe history survive untouched.
    expect(
      await prisma.communicationAddress.count({ where: { normalizedEmail: oldEmail } }),
    ).toBe(1);
    expect(await prisma.unsubscribe.count({ where: { normalizedEmail: oldEmail } })).toBe(1);
  });

  // -------------------------------------------------------------- archival

  it("ARCHIVES a record that disappears instead of deleting it, and keeps local state", async () => {
    // An ISOLATED synthetic board: the shared dev database holds real synced CRM data,
    // and archival is deliberately guarded against mass-archiving an active board.
    const board = `test-board-${RUN}-a`;
    const id = mid();
    const email = `gone-${id}@arch.test`;
    created.emails.push(email);

    await prisma.company.create({
      data: { mondayBoardId: board, mondayItemId: id, name: "Doomed", companyEmailNorm: email },
    });
    await prisma.communicationAddress.create({ data: { normalizedEmail: email } });

    // Monday no longer reports it.
    const outcome = await crmRepo.archiveMissingCompanies(board, []);
    expect(outcome.skipped).toBe(false);
    expect(outcome.archived).toBe(1);

    const after = await prisma.company.findUnique({
      where: { mondayBoardId_mondayItemId: { mondayBoardId: board, mondayItemId: id } },
    });
    expect(after).not.toBeNull(); // never hard-deleted
    expect(after?.archivedAt).not.toBeNull();
    // Local communication state survives the archival.
    expect(await prisma.communicationAddress.count({ where: { normalizedEmail: email } })).toBe(1);

    await prisma.company.deleteMany({ where: { mondayBoardId: board } });
  });

  it("un-archives a record that reappears", async () => {
    const board = `test-board-${RUN}-b`;
    const id = mid();

    await prisma.company.create({
      data: {
        mondayBoardId: board,
        mondayItemId: id,
        name: "Returning",
        archivedAt: new Date(),
        mondayDeletedAt: new Date(),
      },
    });

    // The upsert path clears the archive markers when Monday reports it again.
    await crmRepo.upsertCompany(
      {
        mondayBoardId: board,
        mondayItemId: id,
        name: "Returning",
        companyNumber: null,
        hashavshevetId: null,
        companyEmail: null,
        companyEmailNorm: null,
        accountingEmail: null,
        companyPhone: null,
        category: null,
        customerStatus: "UNKNOWN",
        customerStatusRaw: null,
        industryLabel: null,
        classificationLabel: null,
        contactItemIds: [],
        mondayUpdatedAt: null,
      },
      { industryId: null, classificationId: null },
      { id },
    );

    const after = await prisma.company.findUnique({
      where: { mondayBoardId_mondayItemId: { mondayBoardId: board, mondayItemId: id } },
    });
    expect(after?.archivedAt).toBeNull();
    expect(after?.mondayDeletedAt).toBeNull();

    await prisma.company.deleteMany({ where: { mondayBoardId: board } });
  });

  // ------------------------------------------------------- run bookkeeping

  it("records a SyncRun per board with a correct summary", async () => {
    const id = mid();
    install({ [MONDAY_BOARDS.CUSTOMERS]: [company(id, {}, {}, "Counted")] });

    const before = await prisma.syncRun.count();
    const summary = await syncCrmFromMonday();
    const after = await prisma.syncRun.count();

    expect(after - before).toBe(4); // one run per board
    expect(summary.boards).toHaveLength(4);

    const run = await prisma.syncRun.findFirst({
      where: { mondayBoardId: MONDAY_BOARDS.CUSTOMERS },
      orderBy: [{ startedAt: "desc" }],
    });
    // PARTIAL is legitimate here: the shared dev database contains real synced CRM
    // records that the fake source does not report, so the anti-mass-archival guard
    // refuses to archive them and says so. Either outcome must show zero errors.
    expect(["SUCCESS", "PARTIAL"]).toContain(run?.status);
    if (run?.status === "PARTIAL") expect(run.errorMessage).toMatch(/Refused to archive/);
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.createdCount).toBe(1);
    expect(run?.errorCount).toBe(0);
  });

  it("writes a per-item log entry with a data-quality classification", async () => {
    const id = mid();
    install({
      [MONDAY_BOARDS.CUSTOMERS]: [
        company(id, { [CUSTOMER_COLUMNS.companyEmail]: `ok-${id}@log.test` }, {}, "Logged"),
      ],
    });
    await syncCrmFromMonday();

    const log = await prisma.syncItemLog.findFirst({ where: { mondayItemId: id } });
    expect(log?.action).toBe("UPSERT");
    expect(log?.classification).toBe("SENDABLE");
  });

  it("isolates a malformed item without aborting the board", async () => {
    const good = mid();
    const bad = mid();
    created.companyItemIds.push(bad);

    install({
      [MONDAY_BOARDS.CUSTOMERS]: [
        company(good, {}, {}, "Good"),
        // A relation array of the wrong shape — the projection reads it defensively,
        // so this still syncs; the point is that the whole board is not lost.
        item(MONDAY_BOARDS.CUSTOMERS, bad, {}, {}, null),
      ],
    });

    const summary = await syncCrmFromMonday();
    expect(summary.ok).toBe(true);
    // The healthy record is definitely stored.
    expect(await localCompany(good)).not.toBeNull();

    const log = await prisma.syncItemLog.findFirst({ where: { mondayItemId: bad } });
    expect(log).not.toBeNull();
  });

  it("reports a board read failure without destroying existing data", async () => {
    const id = mid();
    install({ [MONDAY_BOARDS.CUSTOMERS]: [company(id, {}, {}, "Survivor")] });
    await syncCrmFromMonday();

    const failing = new FakeCrmSource({}, { failBoard: MONDAY_BOARDS.CUSTOMERS });
    setCrmSourceForTesting(failing);
    await syncCrmFromMonday();

    // Still present, still not archived — a failed READ must not look like a deletion.
    const stored = await localCompany(id);
    expect(stored).not.toBeNull();
    expect(stored?.archivedAt).toBeNull();

    const run = await prisma.syncRun.findFirst({
      where: { mondayBoardId: MONDAY_BOARDS.CUSTOMERS },
      orderBy: [{ startedAt: "desc" }],
    });
    expect(run?.status).toBe("FAILED");
  });

  it("reports not-connected without touching the database", async () => {
    setCrmSourceForTesting(new FakeCrmSource({}, { configured: false }));
    const summary = await syncCrmFromMonday();
    expect(summary.ok).toBe(false);
    expect(summary.message).toBe("Monday CRM is not connected");
    expect(summary.boards).toHaveLength(0);
  });

  // ------------------------------------------------------------- safety

  it("never creates campaign recipients for synced CRM data", async () => {
    const id = mid();
    const email = `safe-${id}@x.test`;
    install({
      [MONDAY_BOARDS.CUSTOMERS]: [company(id, { [CUSTOMER_COLUMNS.companyEmail]: email })],
    });

    await syncCrmFromMonday();

    // Scoped to THIS run's data: global counts are a moving target because vitest runs
    // test files in parallel and other suites create their own campaign rows.
    expect(await prisma.campaignRecipient.count({ where: { normalizedEmail: email } })).toBe(0);
    expect(await prisma.campaignTestSend.count({ where: { toEmail: email } })).toBe(0);
    // No CRM record is ever promoted into a delivery source.
    expect(
      await prisma.campaignRecipientSource.count({
        where: { OR: [{ sourceItemId: id }, { company: { mondayItemId: id } }] },
      }),
    ).toBe(0);
    // And the address exists only as a communication identity, never as a recipient.
    expect(await prisma.communicationAddress.count({ where: { normalizedEmail: email } })).toBe(1);
  });

  it("contains no Monday mutation operation anywhere in the sync implementation", () => {
    const files = [
      "src/server/integrations/crm/mondayCrmSource.ts",
      "src/server/integrations/crm/crmSource.ts",
      "src/server/integrations/crm/index.ts",
      "src/server/services/crmSyncService.ts",
      "src/server/db/repositories/crmRepository.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const codeLines = source
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"));
      const code = codeLines.join("\n");
      expect(code).not.toMatch(/\bmutation\s*[({]/);
      expect(code).not.toMatch(/create_item|change_column_value|delete_item|duplicate_item/);
    }
  });

  it("exposes no write method on the CRM port", () => {
    const port = new FakeCrmSource();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(port));
    expect(methods).toContain("fetchBoard");
    for (const forbidden of ["create", "update", "delete", "write", "mutate", "upsert"]) {
      expect(methods.some((m) => m.toLowerCase().includes(forbidden))).toBe(false);
    }
  });
});

d("anti-mass-archival guard", () => {
  let prisma: ReturnType<typeof getPrisma>;
  const guardIds: string[] = [];
  /** Syncing is a staff action now, so this block signs in too (ADR-0023). */
  let guardOperator: TestUser;

  beforeAll(async () => {
    prisma = getPrisma();
    await prisma.$connect();
    guardOperator = await createTestUser({ prefix: "crmguard", role: "MANAGER" });
    actAs(guardOperator);
  });

  afterAll(async () => {
    clearTestActor();
    setCrmSourceForTesting(undefined);
    await prisma.company.deleteMany({ where: { mondayItemId: { in: guardIds } } });
    await prisma.user.deleteMany({ where: { id: guardOperator.id } });
    await prisma.$disconnect();
  });

  it("REFUSES to archive a large share of a board and says so", async () => {
    // 20 companies, then a source that reports only one — an incomplete response is
    // indistinguishable from "everything was deleted", so archival must be refused.
    const items = Array.from({ length: 20 }, () => {
      const id = mid();
      guardIds.push(id);
      created.companyItemIds.push(id);
      return item(MONDAY_BOARDS.CUSTOMERS, id, {}, {}, `Guarded ${id}`);
    });

    const source = new FakeCrmSource({ [MONDAY_BOARDS.CUSTOMERS]: items });
    setCrmSourceForTesting(source);
    await syncCrmFromMonday();

    const storedBefore = await prisma.company.count({ where: { archivedAt: null } });
    expect(storedBefore).toBeGreaterThanOrEqual(20);

    source.setBoard(MONDAY_BOARDS.CUSTOMERS, [items[0]]);
    const summary = await syncCrmFromMonday();

    const board = summary.boards.find((b) => b.boardId === MONDAY_BOARDS.CUSTOMERS);
    expect(board?.archived).toBe(0);
    expect(board?.archiveSkippedReason).toMatch(/Refused to archive/);

    // Nothing was archived — the projection survives the bad response intact.
    expect(await prisma.company.count({ where: { archivedAt: null } })).toBe(storedBefore);

    const run = await prisma.syncRun.findFirst({
      where: { mondayBoardId: MONDAY_BOARDS.CUSTOMERS },
      orderBy: [{ startedAt: "desc" }],
    });
    expect(run?.status).toBe("PARTIAL");
    expect(run?.errorMessage).toMatch(/Refused to archive/);
  });
});
