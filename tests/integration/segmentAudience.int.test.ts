import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  GroupMatch,
  SegmentCondition,
  SegmentDefinitionError,
  SegmentGroup,
} from "../../src/domain/segment/segmentDefinition";
import { Operator } from "../../src/domain/segment/segmentFields";
import {
  ConsentStatus,
  EmailStatus,
  ExclusionReason,
  Language,
} from "../../src/domain/types";
import { getPrisma } from "../../src/server/db/prisma";
import {
  createSegment,
  deleteSegment,
  duplicateSegment,
  previewAudience,
  previewSegment,
} from "../../src/server/services/segmentService";
import {
  getCampaignAudience,
  setCampaignSegment,
  snapshotCampaignAudience,
} from "../../src/server/services/campaignAudienceService";
import { getAuthoringUserId } from "../../src/server/services/newsletterService";

/**
 * Audience resolution against real PostgreSQL, over a run-scoped synthetic CRM.
 *
 * The dev database also holds the real mirrored CRM, so every fixture carries a
 * run-scoped name/email and every segment pins itself to this run. Nothing here
 * reads or writes a real customer record, and nothing sends anything.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const BOARD_COMPANY = `seg-co-${RUN}`;
const BOARD_CONTACT = `seg-ct-${RUN}`;
const BOARD_PRODUCT = `seg-pr-${RUN}`;
const BOARD_OWNED = `seg-op-${RUN}`;

const email = (local: string) => `${RUN}-${local}@example.test`;
const DAY = 86_400_000;

/** Every address this run owns — used for scoped assertions and cleanup. */
const EMAILS = {
  alpha: email("alpha"),
  beta: email("beta"),
  gamma: email("gamma"),
  delta: email("delta"),
  shared: email("shared"),
  accounting: email("accounting"),
  unsub: email("unsub"),
  supp: email("supp"),
  denied: email("denied"),
  hebrew: email("hebrew"),
  arabic: email("arabic"),
  nolang: email("nolang"),
  archived: email("archived"),
  orphan: email("orphan"),
};
const ALL_EMAILS = Object.values(EMAILS);

const CLASS_GPS = `gps-${RUN}`;
const CLASS_SCAN = `scan-${RUN}`;
const INDUSTRY = `surveyors-${RUN}`;
const PRODUCT_TRIMBLE = `${RUN} Trimble R12i`;
const PRODUCT_SCANNER = `${RUN} Scanner X9`;

/** Pins a segment to this run's companies. */
const scopeCompany: SegmentCondition = {
  field: "company.name",
  operator: Operator.STARTS_WITH,
  value: RUN,
};
/** Pins a segment to this run's contacts. */
const scopeContact: SegmentCondition = {
  field: "contact.name",
  operator: Operator.STARTS_WITH,
  value: RUN,
};

const ONLY_COMPANY = { companyEmails: true, contactEmails: false };
const ONLY_CONTACT = { companyEmails: false, contactEmails: true };
const BOTH = { companyEmails: true, contactEmails: true };

function definition(
  conditions: SegmentCondition[],
  groups: SegmentGroup[] = [],
  include = BOTH,
) {
  return { version: 1, conditions, groups, include };
}

const ids = {
  companies: [] as string[],
  contacts: [] as string[],
  products: [] as string[],
  owned: [] as string[],
  segments: [] as string[],
  campaigns: [] as string[],
  industryId: "",
  classGpsId: "",
  classScanId: "",
};

d("segment audience resolution", () => {
  let prisma: ReturnType<typeof getPrisma>;
  const now = new Date();

  beforeAll(async () => {
    prisma = getPrisma();

    const industry = await prisma.industry.create({
      data: { mondayColumnId: `col-${RUN}`, mondayLabelIndex: 1, label: INDUSTRY },
    });
    const gps = await prisma.customerClassification.create({
      data: { mondayColumnId: `cls-${RUN}`, mondayLabelIndex: 1, label: CLASS_GPS },
    });
    const scan = await prisma.customerClassification.create({
      data: { mondayColumnId: `cls-${RUN}`, mondayLabelIndex: 2, label: CLASS_SCAN },
    });
    ids.industryId = industry.id;
    ids.classGpsId = gps.id;
    ids.classScanId = scan.id;

    const company = async (
      key: string,
      data: Record<string, unknown>,
    ): Promise<string> => {
      const row = await prisma.company.create({
        data: {
          mondayBoardId: BOARD_COMPANY,
          mondayItemId: `${RUN}-${key}`,
          name: `${RUN} ${key}`,
          ...data,
        },
      });
      ids.companies.push(row.id);
      return row.id;
    };

    const alpha = await company("alpha", {
      companyEmail: EMAILS.alpha,
      companyEmailNorm: EMAILS.alpha,
      // Present on the record, and structurally unreachable as a campaign target.
      accountingEmail: EMAILS.accounting,
      customerStatus: "ACTIVE",
      category: `survey-${RUN}`,
      industryId: industry.id,
      classificationId: gps.id,
    });
    const beta = await company("beta", {
      companyEmail: EMAILS.beta,
      companyEmailNorm: EMAILS.beta,
      customerStatus: "POTENTIAL",
      category: `scan-${RUN}`,
      classificationId: scan.id,
    });
    await company("gamma", {
      companyEmail: EMAILS.gamma,
      companyEmailNorm: EMAILS.gamma,
      customerStatus: "INACTIVE",
      classificationId: gps.id,
    });
    await company("delta", {
      companyEmail: EMAILS.delta,
      companyEmailNorm: EMAILS.delta,
      customerStatus: "ACTIVE",
      classificationId: gps.id,
      archivedAt: new Date(),
    });
    await company("epsilon", {
      companyEmail: null,
      customerStatus: "ACTIVE",
      classificationId: gps.id,
    });
    const zeta = await company("zeta", {
      companyEmail: EMAILS.shared,
      companyEmailNorm: EMAILS.shared,
      customerStatus: "ACTIVE",
      classificationId: gps.id,
    });
    await company("eta", {
      companyEmail: "not-an-email",
      customerStatus: "ACTIVE",
      classificationId: gps.id,
    });

    // ---- products -------------------------------------------------------
    const trimble = await prisma.product.create({
      data: {
        mondayBoardId: BOARD_PRODUCT,
        mondayItemId: `${RUN}-trimble`,
        name: PRODUCT_TRIMBLE,
        itemType: `gpstype-${RUN}`,
      },
    });
    const scanner = await prisma.product.create({
      data: {
        mondayBoardId: BOARD_PRODUCT,
        mondayItemId: `${RUN}-scanner`,
        name: PRODUCT_SCANNER,
        itemType: `scantype-${RUN}`,
      },
    });
    ids.products.push(trimble.id, scanner.id);

    const owned = async (
      key: string,
      companyId: string,
      productId: string,
      subscriptionUntil: Date,
    ) => {
      const row = await prisma.customerProduct.create({
        data: {
          mondayBoardId: BOARD_OWNED,
          mondayItemId: `${RUN}-${key}`,
          companyId,
          productId,
          subscriptionUntil,
        },
      });
      ids.owned.push(row.id);
    };
    await owned("cp1", alpha, trimble.id, new Date(now.getTime() + 30 * DAY));
    await owned("cp2", beta, scanner.id, new Date(now.getTime() + 400 * DAY));
    await owned("cp3", zeta, trimble.id, new Date(now.getTime() - 10 * DAY));

    // ---- contacts -------------------------------------------------------
    const contact = async (
      key: string,
      data: Record<string, unknown>,
      companyId: string | null = alpha,
    ) => {
      const row = await prisma.contact.create({
        data: {
          mondayBoardId: BOARD_CONTACT,
          mondayItemId: `${RUN}-${key}`,
          fullName: `${RUN} ${key}`,
          ...data,
        },
      });
      ids.contacts.push(row.id);
      if (companyId) {
        await prisma.companyContact.create({
          data: { companyId, contactId: row.id, assertedBy: "CONTACTS" },
        });
      }
      return row.id;
    };

    await contact("john", {
      email: EMAILS.shared,
      emailNorm: EMAILS.shared,
      jobTitle: `manager-${RUN}`,
    });
    await contact("sarah", {
      email: EMAILS.shared,
      emailNorm: EMAILS.shared,
      jobTitle: `engineer-${RUN}`,
    });
    await contact("unsub", { email: EMAILS.unsub, emailNorm: EMAILS.unsub });
    await contact("supp", { email: EMAILS.supp, emailNorm: EMAILS.supp });
    await contact("denied", { email: EMAILS.denied, emailNorm: EMAILS.denied });
    await contact("hebrew", { email: EMAILS.hebrew, emailNorm: EMAILS.hebrew });
    await contact("arabic", { email: EMAILS.arabic, emailNorm: EMAILS.arabic });
    await contact("nolang", { email: EMAILS.nolang, emailNorm: EMAILS.nolang });
    await contact("archivedperson", {
      email: EMAILS.archived,
      emailNorm: EMAILS.archived,
      archivedAt: new Date(),
    });
    await contact("orphan", { email: EMAILS.orphan, emailNorm: EMAILS.orphan }, null);

    // ---- communication state (locally owned) ----------------------------
    for (const normalizedEmail of ALL_EMAILS) {
      await prisma.communicationAddress.create({ data: { normalizedEmail } });
    }
    await prisma.communicationAddress.update({
      where: { normalizedEmail: EMAILS.hebrew },
      data: { language: Language.HE, emailStatus: EmailStatus.VALID },
    });
    await prisma.communicationAddress.update({
      where: { normalizedEmail: EMAILS.arabic },
      data: { language: Language.AR },
    });
    await prisma.communicationAddress.update({
      where: { normalizedEmail: EMAILS.denied },
      data: { consentStatus: ConsentStatus.DENIED },
    });
    await prisma.unsubscribe.create({
      data: { normalizedEmail: EMAILS.unsub, source: "RECIPIENT_LINK" },
    });
    await prisma.suppression.create({
      data: { normalizedEmail: EMAILS.supp, reason: "HARD_BOUNCE" },
    });
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await prisma.campaignAudienceExclusion.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaignAudienceSnapshot.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaign.deleteMany({ where: { id: { in: ids.campaigns } } });
    await prisma.segment.deleteMany({ where: { id: { in: ids.segments } } });
    await prisma.companyContact.deleteMany({
      where: { contactId: { in: ids.contacts } },
    });
    await prisma.customerProduct.deleteMany({ where: { id: { in: ids.owned } } });
    await prisma.contact.deleteMany({ where: { id: { in: ids.contacts } } });
    await prisma.company.deleteMany({ where: { id: { in: ids.companies } } });
    await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
    await prisma.unsubscribe.deleteMany({
      where: { normalizedEmail: { in: ALL_EMAILS } },
    });
    await prisma.suppression.deleteMany({
      where: { normalizedEmail: { in: ALL_EMAILS } },
    });
    await prisma.communicationAddress.deleteMany({
      where: { normalizedEmail: { in: ALL_EMAILS } },
    });
    await prisma.customerClassification.deleteMany({
      where: { mondayColumnId: `cls-${RUN}` },
    });
    await prisma.industry.deleteMany({ where: { mondayColumnId: `col-${RUN}` } });
  });

  const destinationsOf = async (
    conditions: SegmentCondition[],
    groups: SegmentGroup[] = [],
    include = BOTH,
    requireLanguage: Language | null = null,
  ) => {
    const preview = await previewAudience(definition(conditions, groups, include), {
      requireLanguage,
      now,
    });
    return {
      preview,
      emails: preview.destinations.map((d2) => d2.normalizedEmail).sort(),
    };
  };

  // ---- 1..7 field filters -------------------------------------------------

  it("filters companies by customer status", async () => {
    const { emails } = await destinationsOf(
      [scopeCompany, { field: "company.status", operator: Operator.IS, value: "POTENTIAL" }],
      [],
      ONLY_COMPANY,
    );
    expect(emails).toEqual([EMAILS.beta]);
  });

  it("filters companies by classification", async () => {
    const { preview } = await destinationsOf(
      [
        scopeCompany,
        { field: "company.classification", operator: Operator.IS, value: CLASS_SCAN },
      ],
      [],
      ONLY_COMPANY,
    );
    expect(preview.matchedCompanies).toBe(1);
    expect(preview.destinations[0].normalizedEmail).toBe(EMAILS.beta);
  });

  it("filters companies by category", async () => {
    const { emails } = await destinationsOf(
      [
        scopeCompany,
        { field: "company.category", operator: Operator.EQUALS, value: `scan-${RUN}` },
      ],
      [],
      ONLY_COMPANY,
    );
    expect(emails).toEqual([EMAILS.beta]);
  });

  it("filters companies by industry", async () => {
    const { emails } = await destinationsOf(
      [scopeCompany, { field: "company.industry", operator: Operator.IS, value: INDUSTRY }],
      [],
      ONLY_COMPANY,
    );
    expect(emails).toEqual([EMAILS.alpha]);
  });

  it("filters contacts by job title", async () => {
    const { preview } = await destinationsOf(
      [
        scopeContact,
        { field: "contact.jobTitle", operator: Operator.CONTAINS, value: `manager-${RUN}` },
      ],
      [],
      ONLY_CONTACT,
    );
    expect(preview.matchedContacts).toBe(1);
    expect(preview.destinations[0].normalizedEmail).toBe(EMAILS.shared);
  });

  it("filters companies by product ownership", async () => {
    const { emails } = await destinationsOf(
      [
        scopeCompany,
        { field: "product.name", operator: Operator.OWNS, value: "Trimble R12i" },
      ],
      [],
      ONLY_COMPANY,
    );
    expect(emails).toEqual([EMAILS.alpha, EMAILS.shared].sort());
  });

  it("excludes companies that do not own a product", async () => {
    const { emails } = await destinationsOf(
      [
        scopeCompany,
        { field: "product.name", operator: Operator.DOES_NOT_OWN, value: "Trimble" },
      ],
      [],
      ONLY_COMPANY,
    );
    expect(emails).toContain(EMAILS.beta);
    expect(emails).not.toContain(EMAILS.alpha);
  });

  it("filters by subscription expiry window", async () => {
    const soon = await destinationsOf(
      [
        scopeCompany,
        {
          field: "customerProduct.subscriptionUntil",
          operator: Operator.WITHIN_NEXT_DAYS,
          days: 90,
        },
      ],
      [],
      ONLY_COMPANY,
    );
    expect(soon.emails).toEqual([EMAILS.alpha]);

    const expired = await destinationsOf(
      [
        scopeCompany,
        { field: "customerProduct.subscriptionUntil", operator: Operator.EXPIRED },
      ],
      [],
      ONLY_COMPANY,
    );
    expect(expired.emails).toEqual([EMAILS.shared]);
  });

  // ---- 8..9 boolean logic -------------------------------------------------

  it("combines conditions with AND", async () => {
    const { emails } = await destinationsOf(
      [
        scopeCompany,
        { field: "company.classification", operator: Operator.IS, value: CLASS_GPS },
        { field: "company.status", operator: Operator.IS, value: "ACTIVE" },
      ],
      [],
      ONLY_COMPANY,
    );
    expect(emails).not.toContain(EMAILS.beta); // wrong classification
    expect(emails).not.toContain(EMAILS.gamma); // inactive
    expect(emails).toContain(EMAILS.alpha);
  });

  it("combines a group with OR", async () => {
    const { emails } = await destinationsOf(
      [scopeCompany],
      [
        {
          match: GroupMatch.ANY,
          conditions: [
            { field: "company.classification", operator: Operator.IS, value: CLASS_GPS },
            { field: "company.classification", operator: Operator.IS, value: CLASS_SCAN },
          ],
        },
      ],
      ONLY_COMPANY,
    );
    expect(emails).toContain(EMAILS.alpha);
    expect(emails).toContain(EMAILS.beta);
  });

  // ---- 10..12 which addresses are used ------------------------------------

  it("matches the company campaign email", async () => {
    const { preview } = await destinationsOf([scopeCompany], [], ONLY_COMPANY);
    expect(preview.matchedContacts).toBe(0);
    expect(preview.destinations.map((d2) => d2.normalizedEmail)).toContain(
      EMAILS.alpha,
    );
  });

  it("matches the contact email", async () => {
    const { preview } = await destinationsOf([scopeContact], [], ONLY_CONTACT);
    expect(preview.matchedCompanies).toBe(0);
    expect(preview.destinations.map((d2) => d2.normalizedEmail)).toContain(
      EMAILS.hebrew,
    );
  });

  it("never uses the accounting address", async () => {
    const { preview } = await destinationsOf([scopeCompany], [], BOTH);
    const seen = [
      ...preview.destinations.map((d2) => d2.normalizedEmail),
      ...preview.destinations.flatMap((d2) => d2.sources.map((s) => s.rawEmail)),
      ...preview.exclusions.map((e) => e.normalizedEmail ?? ""),
      ...preview.exclusions.map((e) => e.rawEmail ?? ""),
    ];
    expect(seen).not.toContain(EMAILS.accounting);
  });

  // ---- 13..15 deduplication and provenance --------------------------------

  it("collapses one address shared by several CRM records into one delivery", async () => {
    const { preview } = await destinationsOf([scopeCompany], [], BOTH);
    const shared = preview.destinations.find(
      (d2) => d2.normalizedEmail === EMAILS.shared,
    );
    expect(shared).toBeDefined();
    // one company + two contacts, one delivery
    expect(shared?.sources).toHaveLength(3);
    expect(
      preview.destinations.filter((d2) => d2.normalizedEmail === EMAILS.shared),
    ).toHaveLength(1);
  });

  it("keeps every contributing CRM record as a named source", async () => {
    const { preview } = await destinationsOf([scopeCompany], [], BOTH);
    const shared = preview.destinations.find(
      (d2) => d2.normalizedEmail === EMAILS.shared,
    );
    const labels = shared?.sources.map((s) => s.label) ?? [];
    expect(labels).toContain(`${RUN} zeta`);
    expect(labels).toContain(`${RUN} john`);
    expect(labels).toContain(`${RUN} sarah`);
    expect(new Set(shared?.sources.map((s) => s.kind)).size).toBe(2);
  });

  it("counts collapsed duplicate sources without calling them exclusions", async () => {
    const { preview } = await destinationsOf([scopeCompany], [], BOTH);
    expect(preview.snapshot.duplicateSourcesCollapsed).toBe(2);
    const reasons = preview.exclusions.map((e) => e.normalizedEmail);
    expect(reasons).not.toContain(EMAILS.shared);
  });

  // ---- 16..22 eligibility exclusions --------------------------------------

  const reasonFor = async (target: string, requireLanguage: Language | null = null) => {
    const preview = await previewAudience(definition([scopeCompany], [], BOTH), {
      requireLanguage,
      now,
    });
    return preview.exclusions.find(
      (e) => e.normalizedEmail === target || e.rawEmail === target,
    )?.reason;
  };

  it("excludes an unsubscribed address", async () => {
    expect(await reasonFor(EMAILS.unsub)).toBe(ExclusionReason.UNSUBSCRIBED);
  });

  it("excludes a suppressed address", async () => {
    expect(await reasonFor(EMAILS.supp)).toBe(ExclusionReason.SUPPRESSED);
  });

  it("excludes an address whose consent was refused", async () => {
    expect(await reasonFor(EMAILS.denied)).toBe(ExclusionReason.CONSENT_DENIED);
  });

  it("excludes an address in the wrong language for a localized send", async () => {
    expect(await reasonFor(EMAILS.arabic, Language.HE)).toBe(
      ExclusionReason.LANGUAGE_UNKNOWN,
    );
  });

  it("excludes an address with no language set from a localized send", async () => {
    expect(await reasonFor(EMAILS.nolang, Language.HE)).toBe(
      ExclusionReason.LANGUAGE_UNKNOWN,
    );
    // ...and keeps it when the campaign is not localized.
    expect(await reasonFor(EMAILS.nolang, null)).toBeUndefined();
  });

  it("keeps the matching language for a localized send", async () => {
    const preview = await previewAudience(definition([scopeCompany], [], BOTH), {
      requireLanguage: Language.HE,
      now,
    });
    expect(preview.destinations.map((d2) => d2.normalizedEmail)).toEqual([
      EMAILS.hebrew,
    ]);
  });

  it("excludes an unusable email address", async () => {
    expect(await reasonFor("not-an-email")).toBe(ExclusionReason.INVALID_EMAIL);
  });

  it("reports a company with no address at all", async () => {
    const preview = await previewAudience(definition([scopeCompany], [], ONLY_COMPANY), {
      now,
    });
    expect(preview.snapshot.breakdown.NO_EMAIL).toBeGreaterThan(0);
  });

  it("excludes archived CRM records", async () => {
    expect(await reasonFor(EMAILS.delta)).toBe(ExclusionReason.ARCHIVED);
    expect(await reasonFor(EMAILS.archived)).toBe(ExclusionReason.ARCHIVED);
  });

  it("excludes the address of an inactive company", async () => {
    expect(await reasonFor(EMAILS.gamma)).toBe(ExclusionReason.COMPANY_INACTIVE);
  });

  // ---- 23..24 counts ------------------------------------------------------

  it("reports exclusion counts that add up", async () => {
    const preview = await previewAudience(definition([scopeCompany], [], BOTH), {
      now,
    });
    const summed = Object.values(preview.snapshot.breakdown).reduce(
      (a, b) => a + b,
      0,
    );
    expect(summed).toBe(preview.snapshot.excluded);
    expect(preview.snapshot.matchedRecords).toBe(
      preview.matchedCompanies + preview.matchedContacts,
    );
    expect(preview.snapshot.uniqueDestinations).toBe(preview.destinations.length);
    expect(preview.snapshot.eligible).toBe(
      preview.snapshot.uniqueDestinations + preview.snapshot.duplicateSourcesCollapsed,
    );
  });

  // ---- 25..26 a preview is analysis only ----------------------------------

  it("creates no delivery recipient and no event", async () => {
    const before = await prisma.campaignRecipient.count({
      where: { normalizedEmail: { in: ALL_EMAILS } },
    });
    await previewAudience(definition([scopeCompany], [], BOTH), { now });
    const after = await prisma.campaignRecipient.count({
      where: { normalizedEmail: { in: ALL_EMAILS } },
    });
    expect(before).toBe(0);
    expect(after).toBe(0);
  });

  it("sends nothing: no test-send row, and no mail transport in the code path", async () => {
    await previewAudience(definition([scopeCompany], [], BOTH), { now });
    const sends = await prisma.campaignTestSend.count({
      where: { simulatedNormalizedEmail: { in: ALL_EMAILS } },
    });
    expect(sends).toBe(0);

    // Structural: the audience code cannot reach a transport even by mistake.
    for (const file of [
      "src/server/services/segmentService.ts",
      "src/server/services/campaignAudienceService.ts",
      "src/server/db/repositories/audienceRepository.ts",
      "src/server/db/repositories/segmentQuery.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/nodemailer|sendMail|EmailProvider|smtp/i);
    }
  });

  // ---- 27 dynamic membership ---------------------------------------------

  it("re-evaluates membership after the CRM data changes", async () => {
    const rules = definition(
      [
        scopeCompany,
        { field: "company.classification", operator: Operator.IS, value: CLASS_SCAN },
      ],
      [],
      ONLY_COMPANY,
    );
    const segmentId = await createSegment({
      name: `${RUN} dynamic`,
      definition: rules,
    });
    ids.segments.push(segmentId);

    const before = await previewSegment(segmentId, { now });
    expect(before?.destinations.map((d2) => d2.normalizedEmail)).toEqual([
      EMAILS.beta,
    ]);

    // A later Monday sync reclassifies alpha; the saved segment must pick it up.
    await prisma.company.updateMany({
      where: { mondayBoardId: BOARD_COMPANY, mondayItemId: `${RUN}-alpha` },
      data: { classificationId: ids.classScanId },
    });

    const after = await previewSegment(segmentId, { now });
    expect(after?.destinations.map((d2) => d2.normalizedEmail).sort()).toEqual(
      [EMAILS.alpha, EMAILS.beta].sort(),
    );

    await prisma.company.updateMany({
      where: { mondayBoardId: BOARD_COMPANY, mondayItemId: `${RUN}-alpha` },
      data: { classificationId: ids.classGpsId },
    });
  });

  // ---- 28 stored rules are validated on write -----------------------------

  it("refuses to store rules it could not run", async () => {
    await expect(
      createSegment({
        name: `${RUN} bad`,
        definition: {
          version: 1,
          conditions: [{ field: "company.name", operator: "EXEC_SQL", value: "x" }],
          groups: [],
          include: BOTH,
        },
      }),
    ).rejects.toBeInstanceOf(SegmentDefinitionError);

    const stored = await prisma.segment.count({ where: { name: `${RUN} bad` } });
    expect(stored).toBe(0);
  });

  it("duplicates and deletes a segment safely", async () => {
    const segmentId = await createSegment({
      name: `${RUN} original`,
      definition: definition([scopeCompany], [], ONLY_COMPANY),
    });
    ids.segments.push(segmentId);

    const copyId = await duplicateSegment(segmentId);
    ids.segments.push(copyId);
    const copy = await prisma.segment.findUnique({ where: { id: copyId } });
    expect(copy?.name).toBe(`${RUN} original (copy)`);

    await deleteSegment(copyId);
    expect(await prisma.segment.count({ where: { id: copyId } })).toBe(0);
  });

  // ---- campaign integration ----------------------------------------------

  it("attaches a segment to a newsletter and snapshots the audience", async () => {
    const createdById = await getAuthoringUserId();
    const campaign = await prisma.campaign.create({
      data: {
        name: `${RUN} audience campaign`,
        language: Language.HE,
        subject: "Test",
        createdById,
      },
    });
    ids.campaigns.push(campaign.id);

    const segmentId = await createSegment({
      name: `${RUN} campaign segment`,
      definition: definition([scopeCompany], [], BOTH),
    });
    ids.segments.push(segmentId);

    await setCampaignSegment(campaign.id, segmentId);

    const view = await getCampaignAudience(campaign.id, { withPreview: true });
    expect(view?.segment?.id).toBe(segmentId);
    // The campaign is Hebrew, so only the Hebrew address survives.
    expect(view?.preview?.destinations.map((d2) => d2.normalizedEmail)).toEqual([
      EMAILS.hebrew,
    ]);

    const result = await snapshotCampaignAudience(campaign.id);
    expect(result.uniqueDestinations).toBe(1);

    const snapshot = await prisma.campaignAudienceSnapshot.findFirst({
      where: { campaignId: campaign.id },
    });
    expect(snapshot?.uniqueDestinations).toBe(1);
    expect(snapshot?.duplicateSourcesCollapsed).toBe(0);

    const exclusions = await prisma.campaignAudienceExclusion.findMany({
      where: { campaignId: campaign.id },
    });
    expect(exclusions.length).toBe(result.excluded);
    // Provenance is kept on every exclusion.
    for (const exclusion of exclusions) {
      expect(exclusion.sourceBoardId).toBeTruthy();
      expect(exclusion.sourceItemId).toBeTruthy();
    }

    // The critical guarantee: planning never creates delivery records.
    expect(
      await prisma.campaignRecipient.count({ where: { campaignId: campaign.id } }),
    ).toBe(0);
    expect(
      await prisma.campaignEvent.count({ where: { campaignId: campaign.id } }),
    ).toBe(0);

    // Taking it again replaces rather than accumulates.
    await snapshotCampaignAudience(campaign.id);
    expect(
      await prisma.campaignAudienceSnapshot.count({
        where: { campaignId: campaign.id },
      }),
    ).toBe(1);
  });
});
