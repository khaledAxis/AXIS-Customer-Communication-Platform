import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

import type { RawMondayItem } from "../../src/domain/crm/crmProjection";
import { LanguageAssignmentError } from "../../src/domain/communication/languageAssignment";
import {
  CONTACT_COLUMNS,
  CUSTOMER_COLUMNS,
  MONDAY_BOARDS,
} from "../../src/domain/crm/mondayColumns";
import { Operator } from "../../src/domain/segment/segmentFields";
import { ConsentStatus, EmailStatus, Language } from "../../src/domain/types";
import { getPrisma } from "../../src/server/db/prisma";
import { FakeCrmSource } from "../../src/server/integrations/crm/fakeCrmSource";
import { setCrmSourceForTesting } from "../../src/server/integrations/crm";
import {
  listCommunicationAddresses,
  previewLanguageImpact,
  setLanguage,
} from "../../src/server/services/communicationService";
import { previewAudience } from "../../src/server/services/segmentService";
import { syncCrmFromMonday } from "../../src/server/services/crmSyncService";
import {
  actAs,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * Staff-assigned communication language against real PostgreSQL.
 *
 * Run-scoped fixtures only: the dev database also holds the real mirrored CRM, and
 * nothing here reads, writes, or counts a real customer record. No email is sent and
 * Monday is never contacted — the CRM source is replaced by a fake for the resync
 * test and restored afterwards.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const BOARD_COMPANY = `lang-co-${RUN}`;
const BOARD_CONTACT = `lang-ct-${RUN}`;

const email = (local: string) => `${RUN}-${local}@example.test`;

const EMAILS = {
  shared: email("shared"),
  hebrew: email("hebrew"),
  arabic: email("arabic"),
  unsub: email("unsub"),
  supp: email("supp"),
  consented: email("consented"),
  checked: email("checked"),
  untouched: email("untouched"),
};
const ALL_EMAILS = Object.values(EMAILS);

const scope = {
  field: "company.name",
  operator: Operator.STARTS_WITH,
  value: RUN,
} as const;

const ids = {
  companies: [] as string[],
  contacts: [] as string[],
  addresses: new Map<string, string>(),
};

function definition(requireLanguage: boolean) {
  void requireLanguage;
  return {
    version: 1,
    conditions: [scope],
    groups: [],
    include: { companyEmails: true, contactEmails: true },
  };
}

d("communication language assignment", () => {
  let prisma: ReturnType<typeof getPrisma>;

  /** Every service call in this suite runs as a real, signed-in manager. */

  let operator: TestUser;


  beforeAll(async () => {

    operator = await createTestUser({ prefix: "lang", role: "MANAGER" });

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
    await company("hebrewco", {
      companyEmail: EMAILS.hebrew,
      companyEmailNorm: EMAILS.hebrew,
    });
    await company("arabicco", {
      companyEmail: EMAILS.arabic,
      companyEmailNorm: EMAILS.arabic,
    });
    await company("unsubco", {
      companyEmail: EMAILS.unsub,
      companyEmailNorm: EMAILS.unsub,
    });
    await company("suppco", { companyEmail: EMAILS.supp, companyEmailNorm: EMAILS.supp });
    await company("consentco", {
      companyEmail: EMAILS.consented,
      companyEmailNorm: EMAILS.consented,
    });
    await company("checkedco", {
      companyEmail: EMAILS.checked,
      companyEmailNorm: EMAILS.checked,
    });
    await company("untouchedco", {
      companyEmail: EMAILS.untouched,
      companyEmailNorm: EMAILS.untouched,
    });

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

    // Local state that must survive every language change.
    await prisma.communicationAddress.update({
      where: { normalizedEmail: EMAILS.consented },
      data: { consentStatus: ConsentStatus.GRANTED },
    });
    await prisma.communicationAddress.update({
      where: { normalizedEmail: EMAILS.checked },
      data: { emailStatus: EmailStatus.VALID },
    });
    await prisma.unsubscribe.create({
      data: { normalizedEmail: EMAILS.unsub, source: "RECIPIENT_LINK" },
    });
    await prisma.suppression.create({
      data: { normalizedEmail: EMAILS.supp, reason: "HARD_BOUNCE" },
    });
  });

  beforeEach(async () => {
    // Every test starts from "language not set", so ordering cannot matter.
    await prisma.communicationAddress.updateMany({
      where: { normalizedEmail: { in: ALL_EMAILS } },
      data: { language: Language.UNKNOWN },
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

  // ---- 1..4 individual assignment ----------------------------------------

  it("sets an address from not-set to Hebrew", async () => {
    const result = await setLanguage({
      language: Language.HE,
      addressIds: [idOf(EMAILS.hebrew)],
    });
    expect(result.changed).toBe(1);
    expect((await read(EMAILS.hebrew)).language).toBe(Language.HE);
  });

  it("sets an address from not-set to Arabic", async () => {
    await setLanguage({ language: Language.AR, addressIds: [idOf(EMAILS.arabic)] });
    expect((await read(EMAILS.arabic)).language).toBe(Language.AR);
  });

  it("changes an address from Hebrew to Arabic", async () => {
    await setLanguage({ language: Language.HE, addressIds: [idOf(EMAILS.hebrew)] });
    await setLanguage({ language: Language.AR, addressIds: [idOf(EMAILS.hebrew)] });
    expect((await read(EMAILS.hebrew)).language).toBe(Language.AR);
  });

  it("persists the change across a fresh read", async () => {
    await setLanguage({ language: Language.HE, addressIds: [idOf(EMAILS.hebrew)] });
    const page = await listCommunicationAddresses({ search: EMAILS.hebrew });
    expect(page.rows[0].language).toBe(Language.HE);
  });

  it("reports nothing to change when the language already matches", async () => {
    await setLanguage({ language: Language.HE, addressIds: [idOf(EMAILS.hebrew)] });
    const again = await setLanguage({
      language: Language.HE,
      addressIds: [idOf(EMAILS.hebrew)],
    });
    expect(again.changed).toBe(0);
    expect(again.unchanged).toBe(1);
  });

  // ---- 5 a Monday resync must never overwrite it --------------------------

  it("survives a Monday resync", async () => {
    await setLanguage({ language: Language.HE, addressIds: [idOf(EMAILS.shared)] });

    // A fake CRM returning the same records — the sync path a scheduled run takes.
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
      await syncCrmFromMonday();
    } finally {
      setCrmSourceForTesting(undefined);
    }

    // The sync re-saw this address and must NOT have reset it.
    expect((await read(EMAILS.shared)).language).toBe(Language.HE);

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

  // ---- 6..9 nothing else may change --------------------------------------

  it("leaves unsubscribe untouched", async () => {
    await setLanguage({ language: Language.HE, addressIds: [idOf(EMAILS.unsub)] });
    const rows = await prisma.unsubscribe.count({
      where: { normalizedEmail: EMAILS.unsub },
    });
    expect(rows).toBe(1);
    const page = await listCommunicationAddresses({ search: EMAILS.unsub });
    expect(page.rows[0].isUnsubscribed).toBe(true);
    expect(page.rows[0].language).toBe(Language.HE);
  });

  it("leaves suppression untouched", async () => {
    await setLanguage({ language: Language.AR, addressIds: [idOf(EMAILS.supp)] });
    expect(
      await prisma.suppression.count({ where: { normalizedEmail: EMAILS.supp } }),
    ).toBe(1);
    const page = await listCommunicationAddresses({ search: EMAILS.supp });
    expect(page.rows[0].isSuppressed).toBe(true);
  });

  it("leaves consent untouched — assigning a language never grants consent", async () => {
    const before = await read(EMAILS.consented);
    await setLanguage({ language: Language.HE, addressIds: [idOf(EMAILS.consented)] });
    const after = await read(EMAILS.consented);
    expect(after.consentStatus).toBe(before.consentStatus);
    expect(after.consentStatus).toBe(ConsentStatus.GRANTED);

    // ...and an address with no consent recorded does not gain one.
    await setLanguage({ language: Language.HE, addressIds: [idOf(EMAILS.hebrew)] });
    expect((await read(EMAILS.hebrew)).consentStatus).toBe(ConsentStatus.UNKNOWN);
  });

  it("leaves the email address check untouched", async () => {
    await setLanguage({ language: Language.HE, addressIds: [idOf(EMAILS.checked)] });
    expect((await read(EMAILS.checked)).emailStatus).toBe(EmailStatus.VALID);
    await setLanguage({ language: Language.HE, addressIds: [idOf(EMAILS.hebrew)] });
    expect((await read(EMAILS.hebrew)).emailStatus).toBe(EmailStatus.UNKNOWN);
  });

  // ---- 10 duplicates share one editable profile ---------------------------

  it("shows one editable row for an address shared by several CRM records", async () => {
    const page = await listCommunicationAddresses({ search: EMAILS.shared });
    const matching = page.rows.filter((row) => row.normalizedEmail === EMAILS.shared);
    expect(matching).toHaveLength(1);
    expect(matching[0].sourceCount).toBe(3); // one company + two contacts
    expect(matching[0].sources.map((s) => s.kind).sort()).toEqual([
      "COMPANY_EMAIL",
      "CONTACT_EMAIL",
      "CONTACT_EMAIL",
    ]);

    // Changing it once applies to the single shared profile.
    const result = await setLanguage({
      language: Language.HE,
      addressIds: [matching[0].id],
    });
    expect(result.changed).toBe(1);
    expect((await read(EMAILS.shared)).language).toBe(Language.HE);
  });

  // ---- 11..15 bulk ---------------------------------------------------------

  it("assigns Hebrew in bulk", async () => {
    const targets = [EMAILS.hebrew, EMAILS.shared, EMAILS.checked].map(idOf);
    const result = await setLanguage({ language: Language.HE, addressIds: targets });
    expect(result.changed).toBe(3);
    for (const address of [EMAILS.hebrew, EMAILS.shared, EMAILS.checked]) {
      expect((await read(address)).language).toBe(Language.HE);
    }
  });

  it("assigns Arabic in bulk", async () => {
    const targets = [EMAILS.arabic, EMAILS.consented].map(idOf);
    const result = await setLanguage({ language: Language.AR, addressIds: targets });
    expect(result.changed).toBe(2);
    expect((await read(EMAILS.arabic)).language).toBe(Language.AR);
    expect((await read(EMAILS.consented)).language).toBe(Language.AR);
  });

  it("changes only the selected addresses", async () => {
    await setLanguage({
      language: Language.HE,
      addressIds: [idOf(EMAILS.hebrew), idOf(EMAILS.arabic)],
    });
    expect((await read(EMAILS.untouched)).language).toBe(Language.UNKNOWN);
    expect((await read(EMAILS.supp)).language).toBe(Language.UNKNOWN);
  });

  it("rejects a malformed bulk request", async () => {
    await expect(
      setLanguage({ language: Language.HE, addressIds: "not-an-array" }),
    ).rejects.toBeInstanceOf(LanguageAssignmentError);
    await expect(
      setLanguage({ language: Language.HE, addressIds: [] }),
    ).rejects.toBeInstanceOf(LanguageAssignmentError);
    expect((await read(EMAILS.untouched)).language).toBe(Language.UNKNOWN);
  });

  it("rejects an unsupported language", async () => {
    await expect(
      setLanguage({ language: "EN", addressIds: [idOf(EMAILS.untouched)] }),
    ).rejects.toBeInstanceOf(LanguageAssignmentError);
    expect((await read(EMAILS.untouched)).language).toBe(Language.UNKNOWN);
  });

  // ---- 16 audit -----------------------------------------------------------

  it("writes an audit record for every change, with the old and new value", async () => {
    const addressId = idOf(EMAILS.hebrew);
    await prisma.auditLog.deleteMany({ where: { entityId: addressId } });

    await setLanguage({ language: Language.HE, addressIds: [addressId] });

    const entries = await prisma.auditLog.findMany({ where: { entityId: addressId } });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("COMMUNICATION_LANGUAGE_CHANGED");
    expect(entries[0].entityType).toBe("CommunicationAddress");
    expect(entries[0].fromState).toBe(Language.UNKNOWN);
    expect(entries[0].toState).toBe(Language.HE);
    expect(entries[0].actorUserId).toBeTruthy();
    expect(JSON.stringify(entries[0].metadata)).not.toMatch(/password|token|secret/i);
  });

  it("tags a bulk change with one batch identifier", async () => {
    const targets = [EMAILS.hebrew, EMAILS.arabic].map(idOf);
    for (const id of targets) await prisma.auditLog.deleteMany({ where: { entityId: id } });

    const result = await setLanguage({ language: Language.AR, addressIds: targets });
    expect(result.batchId).toBeTruthy();

    const entries = await prisma.auditLog.findMany({
      where: { entityId: { in: targets } },
    });
    expect(entries).toHaveLength(2);
    const batches = new Set(
      entries.map((e) => (e.metadata as { batchId?: string })?.batchId),
    );
    expect(batches.size).toBe(1);
  });

  it("writes no audit record when nothing actually changed", async () => {
    const addressId = idOf(EMAILS.hebrew);
    await setLanguage({ language: Language.HE, addressIds: [addressId] });
    await prisma.auditLog.deleteMany({ where: { entityId: addressId } });

    await setLanguage({ language: Language.HE, addressIds: [addressId] });
    expect(await prisma.auditLog.count({ where: { entityId: addressId } })).toBe(0);
  });

  // ---- 17..20 audience impact ---------------------------------------------

  it("makes a Hebrew audience reachable after assigning Hebrew", async () => {
    const before = await previewAudience(definition(true), {
      requireLanguage: Language.HE,
    });
    expect(before.snapshot.uniqueDestinations).toBe(0);

    await setLanguage({
      language: Language.HE,
      addressIds: [idOf(EMAILS.hebrew), idOf(EMAILS.shared)],
    });

    const after = await previewAudience(definition(true), {
      requireLanguage: Language.HE,
    });
    expect(after.destinations.map((d2) => d2.normalizedEmail).sort()).toEqual(
      [EMAILS.hebrew, EMAILS.shared].sort(),
    );
  });

  it("makes an Arabic audience reachable after assigning Arabic", async () => {
    await setLanguage({ language: Language.AR, addressIds: [idOf(EMAILS.arabic)] });
    const preview = await previewAudience(definition(true), {
      requireLanguage: Language.AR,
    });
    expect(preview.destinations.map((d2) => d2.normalizedEmail)).toEqual([
      EMAILS.arabic,
    ]);
  });

  it("still excludes not-set addresses from a localized send", async () => {
    await setLanguage({ language: Language.HE, addressIds: [idOf(EMAILS.hebrew)] });
    const preview = await previewAudience(definition(true), {
      requireLanguage: Language.HE,
    });
    const excluded = preview.exclusions.filter(
      (e) => e.normalizedEmail === EMAILS.untouched || e.rawEmail === EMAILS.untouched,
    );
    expect(excluded[0]?.reason).toBe("LANGUAGE_UNKNOWN");
  });

  it("still excludes a mismatched language", async () => {
    await setLanguage({ language: Language.AR, addressIds: [idOf(EMAILS.arabic)] });
    const preview = await previewAudience(definition(true), {
      requireLanguage: Language.HE,
    });
    expect(preview.destinations.map((d2) => d2.normalizedEmail)).not.toContain(
      EMAILS.arabic,
    );
  });

  it("does not let a language assignment bypass unsubscribe or suppression", async () => {
    await setLanguage({
      language: Language.HE,
      addressIds: [idOf(EMAILS.unsub), idOf(EMAILS.supp)],
    });
    const preview = await previewAudience(definition(true), {
      requireLanguage: Language.HE,
    });
    const emails = preview.destinations.map((d2) => d2.normalizedEmail);
    expect(emails).not.toContain(EMAILS.unsub);
    expect(emails).not.toContain(EMAILS.supp);
  });

  // ---- impact preview ------------------------------------------------------

  it("projects the impact without writing anything", async () => {
    const impact = await previewLanguageImpact(
      [idOf(EMAILS.hebrew), idOf(EMAILS.arabic)],
      Language.HE,
    );
    expect(impact.selected).toBe(2);
    expect(impact.after.HE).toBe(impact.before.HE + 2);

    // Scoped to this run's own addresses. The global figures are shared with every
    // other suite running in parallel, so comparing them would assert something this
    // test does not control.
    const rows = await prisma.communicationAddress.findMany({
      where: { normalizedEmail: { in: ALL_EMAILS } },
      select: { language: true },
    });
    expect(rows.every((row) => row.language === Language.UNKNOWN)).toBe(true);
    expect((await read(EMAILS.hebrew)).language).toBe(Language.UNKNOWN);
  });

  // ---- 21..23 safety --------------------------------------------------------

  it("creates no delivery records and sends no email", async () => {
    await setLanguage({
      language: Language.HE,
      addressIds: [idOf(EMAILS.hebrew), idOf(EMAILS.arabic)],
    });

    expect(
      await prisma.campaignRecipient.count({
        where: { normalizedEmail: { in: ALL_EMAILS } },
      }),
    ).toBe(0);
    expect(
      await prisma.campaignTestSend.count({
        where: { simulatedNormalizedEmail: { in: ALL_EMAILS } },
      }),
    ).toBe(0);
  });

  it("has no Monday write path in the communication code", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of [
      "src/server/services/communicationService.ts",
      "src/domain/communication/languageAssignment.ts",
      "src/app/communication/actions.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      // A GraphQL mutation document, not the English word — the service comments
      // legitimately describe "the only mutation in this service".
      expect(source).not.toMatch(/mutation\s*[({]/i);
      expect(source).not.toMatch(/monday\.com\/v2|change_column_value|change_simple/i);
      expect(source).not.toMatch(/nodemailer|sendMail|EmailProvider/i);
    }
  });
});
