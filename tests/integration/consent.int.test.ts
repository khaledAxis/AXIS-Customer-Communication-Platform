import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

import type { RawMondayItem } from "../../src/domain/crm/crmProjection";
import { ConsentAssignmentError } from "../../src/domain/communication/consentAssignment";
import {
  CONTACT_COLUMNS,
  CUSTOMER_COLUMNS,
  MONDAY_BOARDS,
} from "../../src/domain/crm/mondayColumns";
import { Operator } from "../../src/domain/segment/segmentFields";
import {
  ConsentSource,
  ConsentStatus,
  EmailStatus,
  ExclusionReason,
  Language,
} from "../../src/domain/types";
import { getPrisma } from "../../src/server/db/prisma";
import { FakeCrmSource } from "../../src/server/integrations/crm/fakeCrmSource";
import { setCrmSourceForTesting } from "../../src/server/integrations/crm";
import {
  getConsentCounts,
  listCommunicationAddresses,
  previewConsentImpact,
  setConsent,
  setLanguage,
} from "../../src/server/services/communicationService";
import { previewAudience } from "../../src/server/services/segmentService";
import {
  actAs,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * Staff-recorded consent against real PostgreSQL (ADR-0021).
 *
 * Run-scoped fixtures only: the dev database also holds the real mirrored CRM, and
 * nothing here reads, writes, or counts a real customer record. No email is sent and
 * Monday is never contacted — the CRM source is replaced by a fake for the resync
 * test and restored afterwards.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const BOARD_COMPANY = `cons-co-${RUN}`;
const BOARD_CONTACT = `cons-ct-${RUN}`;

const email = (local: string) => `${RUN}-${local}@example.test`;

const EMAILS = {
  plain: email("plain"),
  second: email("second"),
  third: email("third"),
  shared: email("shared"),
  unsub: email("unsub"),
  supp: email("supp"),
  invalid: email("invalid"),
  hebrew: email("hebrew"),
  untouched: email("untouched"),
};
const ALL_EMAILS = Object.values(EMAILS);

const ids = {
  companies: [] as string[],
  contacts: [] as string[],
  addresses: new Map<string, string>(),
};

/** A complete, valid GRANTED submission for this run's fixtures. */
function grant(addressIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    status: ConsentStatus.GRANTED,
    addressIds,
    source: ConsentSource.EXISTING_CUSTOMER_RELATIONSHIP,
    effectiveAt: "2026-01-10",
    confirmed: "on",
    ...overrides,
  };
}

function deny(addressIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    status: ConsentStatus.DENIED,
    addressIds,
    confirmed: "on",
    ...overrides,
  };
}

d("communication consent", () => {
  let prisma: ReturnType<typeof getPrisma>;

  /** Every service call in this suite runs as a real, signed-in manager. */

  let operator: TestUser;


  beforeAll(async () => {

    operator = await createTestUser({ prefix: "consent", role: "MANAGER" });

    actAs(operator);
    prisma = getPrisma();

    const company = async (key: string, data: Record<string, unknown>) => {
      const row = await prisma.company.create({
        data: {
          mondayBoardId: BOARD_COMPANY,
          mondayItemId: `${RUN}-${key}`,
          name: `${RUN} ${key}`,
          customerStatus: "ACTIVE",
          ...data,
        },
      });
      ids.companies.push(row.id);
      return row.id;
    };

    const anchor = await company("anchor", {
      companyEmail: EMAILS.shared,
      companyEmailNorm: EMAILS.shared,
    });
    for (const [key, address] of [
      ["plainco", EMAILS.plain],
      ["secondco", EMAILS.second],
      ["thirdco", EMAILS.third],
      ["unsubco", EMAILS.unsub],
      ["suppco", EMAILS.supp],
      ["invalidco", EMAILS.invalid],
      ["hebrewco", EMAILS.hebrew],
      ["untouchedco", EMAILS.untouched],
    ] as const) {
      await company(key, { companyEmail: address, companyEmailNorm: address });
    }

    // Two contacts sharing the anchor company's address — one profile, three records.
    for (const key of ["john", "sarah"]) {
      const contact = await prisma.contact.create({
        data: {
          mondayBoardId: BOARD_CONTACT,
          mondayItemId: `${RUN}-${key}`,
          fullName: `${RUN} ${key}`,
          email: EMAILS.shared,
          emailNorm: EMAILS.shared,
        },
      });
      ids.contacts.push(contact.id);
      await prisma.companyContact.create({
        data: { companyId: anchor, contactId: contact.id, assertedBy: "CONTACTS" },
      });
    }

    for (const normalizedEmail of ALL_EMAILS) {
      const row = await prisma.communicationAddress.create({ data: { normalizedEmail } });
      ids.addresses.set(normalizedEmail, row.id);
    }

    // Local state that must survive, and win over, every consent decision.
    await prisma.unsubscribe.create({
      data: { normalizedEmail: EMAILS.unsub, source: "RECIPIENT_LINK" },
    });
    await prisma.suppression.create({
      data: { normalizedEmail: EMAILS.supp, reason: "HARD_BOUNCE" },
    });
    await prisma.communicationAddress.update({
      where: { normalizedEmail: EMAILS.invalid },
      data: { emailStatus: EmailStatus.INVALID },
    });
  });

  beforeEach(async () => {
    // Audit rows are append-only in production; here they are run-scoped fixtures, so
    // each test starts with an empty trail and can assert exactly what it wrote.
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...ids.addresses.values()] } },
    });
    // Every test starts from "not confirmed", so ordering cannot matter.
    await prisma.communicationAddress.updateMany({
      where: { normalizedEmail: { in: ALL_EMAILS } },
      data: {
        consentStatus: ConsentStatus.UNKNOWN,
        consentSource: null,
        consentNote: null,
        consentEffectiveAt: null,
        consentRecordedAt: null,
        consentRecordedById: null,
        consentBatchId: null,
      },
    });
  });

  afterAll(async () => {

    clearTestActor();
    if (!HAS_DB) return;
    setCrmSourceForTesting(undefined);
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...ids.addresses.values()] } },
    });
    await prisma.companyContact.deleteMany({
      where: { contactId: { in: ids.contacts } },
    });
    await prisma.contact.deleteMany({ where: { id: { in: ids.contacts } } });
    await prisma.company.deleteMany({ where: { id: { in: ids.companies } } });
    await prisma.unsubscribe.deleteMany({
      where: { normalizedEmail: { in: ALL_EMAILS } },
    });
    await prisma.suppression.deleteMany({
      where: { normalizedEmail: { in: ALL_EMAILS } },
    });
    await prisma.communicationAddress.deleteMany({
      where: { normalizedEmail: { in: ALL_EMAILS } },
    });
  
    await getPrisma().user.deleteMany({ where: { id: operator.id } });
});

  const idOf = (address: string) => ids.addresses.get(address) as string;
  const read = (address: string) =>
    prisma.communicationAddress.findUniqueOrThrow({
      where: { normalizedEmail: address },
    });

  const scoped = {
    version: 1,
    conditions: [
      { field: "company.name", operator: Operator.STARTS_WITH, value: RUN },
    ],
    groups: [],
    include: { companyEmails: true, contactEmails: false },
  };

  // ---- 1..3 the three transitions ----------------------------------------

  it("records not-confirmed → approved with its evidence", async () => {
    const result = await setConsent(grant([idOf(EMAILS.plain)]));
    expect(result.changed).toBe(1);

    const row = await read(EMAILS.plain);
    expect(row.consentStatus).toBe(ConsentStatus.GRANTED);
    expect(row.consentSource).toBe(ConsentSource.EXISTING_CUSTOMER_RELATIONSHIP);
    expect(row.consentEffectiveAt?.toISOString()).toBe("2026-01-10T00:00:00.000Z");
    expect(row.consentRecordedAt).not.toBeNull();
    expect(row.consentRecordedById).not.toBeNull();
  });

  it("records not-confirmed → do-not-send without any evidence", async () => {
    await setConsent(deny([idOf(EMAILS.plain)]));
    const row = await read(EMAILS.plain);
    expect(row.consentStatus).toBe(ConsentStatus.DENIED);
    // Refusing needs no documented basis, so none is invented.
    expect(row.consentSource).toBeNull();
    expect(row.consentEffectiveAt).toBeNull();
  });

  it("records approved → do-not-send and clears the stale basis", async () => {
    await setConsent(grant([idOf(EMAILS.plain)]));
    await setConsent(deny([idOf(EMAILS.plain)]));

    const row = await read(EMAILS.plain);
    expect(row.consentStatus).toBe(ConsentStatus.DENIED);
    // The old basis justified sending; leaving it attached to a refusal would misread.
    expect(row.consentSource).toBeNull();
  });

  // ---- 4 re-approving still demands evidence ------------------------------

  it("requires fresh evidence to move do-not-send back to approved", async () => {
    await setConsent(deny([idOf(EMAILS.plain)]));

    await expect(
      setConsent({
        status: ConsentStatus.GRANTED,
        addressIds: [idOf(EMAILS.plain)],
        confirmed: "on",
      }),
    ).rejects.toThrowError(ConsentAssignmentError);

    // Still refused: a rejected request changes nothing.
    expect((await read(EMAILS.plain)).consentStatus).toBe(ConsentStatus.DENIED);

    await setConsent(
      grant([idOf(EMAILS.plain)], {
        source: ConsentSource.EXPLICIT_CUSTOMER_PERMISSION,
        note: "Written permission on file.",
      }),
    );
    const row = await read(EMAILS.plain);
    expect(row.consentStatus).toBe(ConsentStatus.GRANTED);
    expect(row.consentSource).toBe(ConsentSource.EXPLICIT_CUSTOMER_PERMISSION);
  });

  // ---- 5 audit ------------------------------------------------------------

  it("writes an audit entry for every change, and never rewrites an old one", async () => {
    await setConsent(grant([idOf(EMAILS.plain)]));
    await setConsent(deny([idOf(EMAILS.plain)], { note: "Customer asked us to stop." }));

    const entries = await prisma.auditLog.findMany({
      where: {
        action: "COMMUNICATION_CONSENT_CHANGED",
        entityId: idOf(EMAILS.plain),
      },
      orderBy: [{ occurredAt: "asc" }],
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].fromState).toBe(ConsentStatus.UNKNOWN);
    expect(entries[0].toState).toBe(ConsentStatus.GRANTED);
    expect(
      (entries[0].metadata as { source?: string } | null)?.source,
    ).toBe(ConsentSource.EXISTING_CUSTOMER_RELATIONSHIP);
    expect(entries[1].fromState).toBe(ConsentStatus.GRANTED);
    expect(entries[1].toState).toBe(ConsentStatus.DENIED);
    expect(entries[1].reason).toBe("Customer asked us to stop.");
    expect(entries[0].actorUserId).not.toBeNull();
  });

  it("records the bulk batch id on every row of one operation", async () => {
    const result = await setConsent(
      grant([idOf(EMAILS.plain), idOf(EMAILS.second), idOf(EMAILS.third)]),
    );
    expect(result.batchId).not.toBeNull();

    const rows = await prisma.communicationAddress.findMany({
      where: { consentBatchId: result.batchId },
    });
    expect(rows).toHaveLength(3);

    const entries = await prisma.auditLog.findMany({
      where: {
        action: "COMMUNICATION_CONSENT_CHANGED",
        entityId: { in: [idOf(EMAILS.plain), idOf(EMAILS.second), idOf(EMAILS.third)] },
      },
    });
    for (const entry of entries) {
      expect((entry.metadata as { batchId?: string } | null)?.batchId).toBe(
        result.batchId,
      );
    }
  });

  // ---- 6 sync immunity ----------------------------------------------------

  it("survives a Monday resync", async () => {
    await setConsent(grant([idOf(EMAILS.shared)]));

    const item = (
      boardId: string,
      itemId: string,
      columns: Record<string, string | null>,
      name: string,
    ): RawMondayItem => ({ boardId, itemId, name, columns, relations: {}, raw: {} });

    setCrmSourceForTesting(
      new FakeCrmSource({
        [MONDAY_BOARDS.CUSTOMERS]: [
          item(
            MONDAY_BOARDS.CUSTOMERS,
            `${RUN}-resync`,
            { [CUSTOMER_COLUMNS.companyEmail]: EMAILS.shared },
            `${RUN} resync company`,
          ),
        ],
        [MONDAY_BOARDS.CONTACTS]: [
          item(
            MONDAY_BOARDS.CONTACTS,
            `${RUN}-resync-contact`,
            { [CONTACT_COLUMNS.email]: EMAILS.shared },
            `${RUN} resync contact`,
          ),
        ],
        [MONDAY_BOARDS.PRODUCTS]: [],
        [MONDAY_BOARDS.CUSTOMER_PRODUCTS]: [],
      }),
    );

    try {
      const { syncCrmFromMonday } = await import(
        "../../src/server/services/crmSyncService"
      );
      await syncCrmFromMonday();
    } finally {
      setCrmSourceForTesting(undefined);
    }

    const row = await read(EMAILS.shared);
    expect(row.consentStatus).toBe(ConsentStatus.GRANTED);
    expect(row.consentSource).toBe(ConsentSource.EXISTING_CUSTOMER_RELATIONSHIP);

    await prisma.company.deleteMany({
      where: { mondayBoardId: MONDAY_BOARDS.CUSTOMERS, mondayItemId: `${RUN}-resync` },
    });
    await prisma.contact.deleteMany({
      where: {
        mondayBoardId: MONDAY_BOARDS.CONTACTS,
        mondayItemId: `${RUN}-resync-contact`,
      },
    });
  });

  // ---- 7..9 unsubscribe / suppression stay stronger -----------------------

  it("approving does not override an unsubscribe", async () => {
    await setConsent(grant([idOf(EMAILS.unsub)]));

    expect(
      await prisma.unsubscribe.count({ where: { normalizedEmail: EMAILS.unsub } }),
    ).toBe(1);

    const preview = await previewAudience(scoped);
    expect(
      preview.destinations.some((d) => d.normalizedEmail === EMAILS.unsub),
    ).toBe(false);
    expect(
      preview.exclusions.find((e) => e.normalizedEmail === EMAILS.unsub)?.reason ??
        preview.exclusions.find((e) => e.rawEmail === EMAILS.unsub)?.reason,
    ).toBe(ExclusionReason.UNSUBSCRIBED);
  });

  it("approving does not override a suppression", async () => {
    await setConsent(grant([idOf(EMAILS.supp)]));

    expect(
      await prisma.suppression.count({ where: { normalizedEmail: EMAILS.supp } }),
    ).toBe(1);

    const preview = await previewAudience(scoped);
    expect(preview.destinations.some((d) => d.normalizedEmail === EMAILS.supp)).toBe(
      false,
    );
  });

  it("approving does not override a known-invalid address", async () => {
    await setConsent(grant([idOf(EMAILS.invalid)]));
    const preview = await previewAudience(scoped);
    expect(
      preview.destinations.some((d) => d.normalizedEmail === EMAILS.invalid),
    ).toBe(false);
  });

  it("refusing excludes the address immediately, without an unsubscribe", async () => {
    const before = await previewAudience(scoped);
    expect(before.destinations.some((d) => d.normalizedEmail === EMAILS.plain)).toBe(
      true,
    );

    await setConsent(deny([idOf(EMAILS.plain)]));

    const after = await previewAudience(scoped);
    expect(after.destinations.some((d) => d.normalizedEmail === EMAILS.plain)).toBe(
      false,
    );
    // No unsubscribe row was needed or created — the refusal alone is enough.
    expect(
      await prisma.unsubscribe.count({ where: { normalizedEmail: EMAILS.plain } }),
    ).toBe(0);
    // And the address itself is preserved, with its CRM links intact.
    const page = await listCommunicationAddresses({ search: EMAILS.plain });
    expect(page.rows[0].sources.length).toBeGreaterThan(0);
  });

  // ---- 10 malformed input -------------------------------------------------

  it("rejects a malformed consent update and writes nothing", async () => {
    const attempts = [
      { status: "MAYBE", addressIds: [idOf(EMAILS.plain)], confirmed: "on" },
      { status: ConsentStatus.GRANTED, addressIds: [idOf(EMAILS.plain)] },
      grant([idOf(EMAILS.plain)], { source: "LEGITIMATE_INTEREST" }),
      grant([idOf(EMAILS.plain)], { effectiveAt: "2099-01-01" }),
      grant([idOf(EMAILS.plain)], { source: ConsentSource.OTHER_DOCUMENTED_BASIS }),
      grant([], {}),
      grant("not-an-array" as unknown as string[]),
    ];

    for (const attempt of attempts) {
      await expect(
        setConsent(attempt as Parameters<typeof setConsent>[0]),
      ).rejects.toThrowError(ConsentAssignmentError);
    }

    expect((await read(EMAILS.plain)).consentStatus).toBe(ConsentStatus.UNKNOWN);
  });

  // ---- 11 bulk safety -----------------------------------------------------

  it("changes only the selected rows in a bulk operation", async () => {
    const before = await getConsentCounts();

    await setConsent(grant([idOf(EMAILS.plain), idOf(EMAILS.second)]));

    expect((await read(EMAILS.plain)).consentStatus).toBe(ConsentStatus.GRANTED);
    expect((await read(EMAILS.second)).consentStatus).toBe(ConsentStatus.GRANTED);
    expect((await read(EMAILS.third)).consentStatus).toBe(ConsentStatus.UNKNOWN);
    expect((await read(EMAILS.untouched)).consentStatus).toBe(ConsentStatus.UNKNOWN);

    const after = await getConsentCounts();
    // Exactly two moved — nothing else in the database was swept along.
    expect(after.GRANTED - before.GRANTED).toBe(2);
    expect(before.UNKNOWN - after.UNKNOWN).toBe(2);
  });

  it("previews the effect of a bulk change without writing anything", async () => {
    const preview = await previewConsentImpact(
      [idOf(EMAILS.plain), idOf(EMAILS.second)],
      ConsentStatus.GRANTED,
    );
    expect(preview.selected).toBe(2);
    expect(preview.after.GRANTED - preview.before.GRANTED).toBe(2);
    expect((await read(EMAILS.plain)).consentStatus).toBe(ConsentStatus.UNKNOWN);
  });

  // ---- 12..13 nothing is ever implied ------------------------------------

  it("never infers consent from an assigned language", async () => {
    await setLanguage({
      language: Language.HE,
      addressIds: [idOf(EMAILS.hebrew)],
    });
    const row = await read(EMAILS.hebrew);
    expect(row.language).toBe(Language.HE);
    expect(row.consentStatus).toBe(ConsentStatus.UNKNOWN);
    expect(row.consentSource).toBeNull();
  });

  it("never infers consent from the existence of a CRM record", async () => {
    // These addresses exist only because Monday has companies and contacts for them.
    const counts = await getConsentCounts();
    expect(counts).toBeDefined();
    for (const address of ALL_EMAILS) {
      expect((await read(address)).consentStatus).toBe(ConsentStatus.UNKNOWN);
    }
  });

  it("does not change the language when consent is recorded", async () => {
    await setLanguage({ language: Language.AR, addressIds: [idOf(EMAILS.hebrew)] });
    await setConsent(grant([idOf(EMAILS.hebrew)]));
    const row = await read(EMAILS.hebrew);
    expect(row.language).toBe(Language.AR);
    expect(row.emailStatus).toBe(EmailStatus.UNKNOWN);
  });
});
