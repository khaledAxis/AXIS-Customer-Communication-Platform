import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

import { Role } from "../../src/domain/auth/authorization";
import { Operator } from "../../src/domain/segment/segmentFields";
import { Language } from "../../src/domain/types";
import { getPrisma } from "../../src/server/db/prisma";
import { UNUSABLE_PASSWORD_HASH } from "../../src/server/auth/password";
import { setCampaignSegment } from "../../src/server/services/campaignAudienceService";
import {
  addContent,
  createNewsletter,
  updateNewsletterDetails,
} from "../../src/server/services/newsletterService";
import { createSegment } from "../../src/server/services/segmentService";
import {
  approveForProduction,
  getSendReadiness,
  prepareFinalAudience,
} from "../../src/server/services/sendReadinessService";
import { setStaffActive } from "../../src/server/services/userService";
import {
  actAs,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * Four-eyes production approval with REAL identities (ADR-0023).
 *
 * The rule was built in ADR-0022 and reported BLOCKED because nobody could be
 * identified. This suite is what turns that into an enforced control: two distinct
 * `User` rows, an approval that must come from the second of them, and a refusal that
 * comes from the service rather than from a hidden button.
 *
 * Nothing here sends email or creates a delivery record.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const BOARD = `4eyes-co-${RUN}`;
const ADDRESS = `${RUN}-recipient@example.test`;

const ids = {
  users: [] as string[],
  companies: [] as string[],
  contentItems: [] as string[],
  campaigns: [] as string[],
  segments: [] as string[],
  addresses: [] as string[],
};

d("four-eyes production approval", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let managerA: TestUser; // creator
  let managerB: TestUser; // second pair of eyes
  let adminA: TestUser; // an administrator who creates their own campaign
  let adminB: TestUser; // a second administrator
  let standIn: TestUser; // the retired development actor
  let segmentId = "";
  let contentId = "";

  /** A fresh DRAFT campaign created BY a specific person, ready to approve. */
  async function newCampaign(creator: TestUser, label: string): Promise<string> {
    actAs(creator);
    const created = await createNewsletter({
      name: `${RUN} ${label}`,
      subject: "עדכון לקוחות",
      preheader: "מה חדש",
      language: Language.HE,
    });
    if (!created.ok) throw new Error("fixture campaign failed");
    ids.campaigns.push(created.data.id);
    await addContent(created.data.id, contentId);
    await setCampaignSegment(created.data.id, segmentId);
    await prepareFinalAudience(created.data.id);
    return created.data.id;
  }

  beforeAll(async () => {
    prisma = getPrisma();

    managerA = await createTestUser({ prefix: `${RUN}-a`, role: Role.MANAGER });
    managerB = await createTestUser({ prefix: `${RUN}-b`, role: Role.MANAGER });
    adminA = await createTestUser({ prefix: `${RUN}-adma`, role: Role.ADMIN });
    adminB = await createTestUser({ prefix: `${RUN}-admb`, role: Role.ADMIN });
    ids.users.push(managerA.id, managerB.id, adminA.id, adminB.id);

    const standInRow = await prisma.user.create({
      data: {
        email: `${RUN}-standin@axis-gps.invalid`,
        name: "Historical development stand-in",
        role: Role.ADMIN,
        passwordHash: UNUSABLE_PASSWORD_HASH,
        isActive: false,
        isSystemAccount: true,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    ids.users.push(standInRow.id);
    standIn = {
      id: standInRow.id,
      email: standInRow.email,
      name: standInRow.name,
      role: Role.ADMIN,
      isActive: false,
      isSystemAccount: true,
    };

    // A one-address audience, so every campaign has someone to approve for.
    const company = await prisma.company.create({
      data: {
        mondayBoardId: BOARD,
        mondayItemId: `${RUN}-co`,
        name: `${RUN} recipient co`,
        customerStatus: "ACTIVE",
        companyEmail: ADDRESS,
        companyEmailNorm: ADDRESS,
      },
    });
    ids.companies.push(company.id);

    const address = await prisma.communicationAddress.create({
      data: { normalizedEmail: ADDRESS, language: Language.HE },
    });
    ids.addresses.push(address.id);

    const content = await prisma.contentItem.create({
      data: {
        title: `${RUN} article`,
        summary: "Summary",
        bodyHtml: "<p>Body</p>",
        language: Language.HE,
        origin: "INTERNAL",
        reviewState: "APPROVED",
        imageUrl: "https://cdn.example.test/a.jpg",
        imageAlt: "A picture",
      },
    });
    ids.contentItems.push(content.id);
    contentId = content.id;

    actAs(managerA);
    segmentId = await createSegment({
      name: `${RUN} audience`,
      definition: {
        version: 1,
        conditions: [
          { field: "company.name", operator: Operator.STARTS_WITH, value: RUN },
        ],
        groups: [],
        include: { companyEmails: true, contactEmails: false },
      },
    });
    ids.segments.push(segmentId);
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    clearTestActor();
    await prisma.campaignProductionApproval.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaignFinalAudience.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaignContentItem.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...ids.campaigns, ...ids.users, ...ids.addresses] } },
    });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids.users } } });
    await prisma.campaign.deleteMany({ where: { id: { in: ids.campaigns } } });
    await prisma.contentItem.deleteMany({ where: { id: { in: ids.contentItems } } });
    await prisma.segment.deleteMany({ where: { id: { in: ids.segments } } });
    await prisma.company.deleteMany({ where: { id: { in: ids.companies } } });
    await prisma.communicationAddress.deleteMany({
      where: { id: { in: ids.addresses } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  });

  // ---- 18..21 the rule ----------------------------------------------------

  it("refuses to let the creator approve their own campaign", async () => {
    const campaignId = await newCampaign(managerA, "self-approve");

    actAs(managerA);
    const result = await approveForProduction(campaignId);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBe(
      "A different authorized AXIS user must approve this campaign.",
    );
    expect(
      await prisma.campaignProductionApproval.count({ where: { campaignId } }),
    ).toBe(0);
  });

  it("refuses an ADMINISTRATOR approving their own campaign", async () => {
    const campaignId = await newCampaign(adminA, "admin-self-approve");

    actAs(adminA);
    const result = await approveForProduction(campaignId);

    // Administrators are not exempt. Unblocking a stuck workflow is one thing;
    // authorising a real customer send to yourself is another.
    expect(result.ok).toBe(false);
    expect(
      await prisma.campaignProductionApproval.count({ where: { campaignId } }),
    ).toBe(0);
  });

  it("accepts a different MANAGER", async () => {
    const campaignId = await newCampaign(managerA, "manager-approves");

    actAs(managerB);
    const result = await approveForProduction(campaignId);
    expect(result.ok).toBe(true);

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.fourEyes.satisfied).toBe(true);
    expect(readiness?.approval?.valid).toBe(true);
  });

  it("accepts a different ADMINISTRATOR", async () => {
    const campaignId = await newCampaign(adminA, "admin-approves");

    actAs(adminB);
    const result = await approveForProduction(campaignId);
    expect(result.ok).toBe(true);

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.fourEyes.satisfied).toBe(true);
  });

  // ---- 22..24 the approver is the session --------------------------------

  it("takes the approver from the session, with no parameter to override it", async () => {
    const campaignId = await newCampaign(managerA, "session-approver");

    actAs(managerB);
    await approveForProduction(campaignId);

    const approval = await prisma.campaignProductionApproval.findFirstOrThrow({
      where: { campaignId },
    });
    expect(approval.approvedById).toBe(managerB.id);
    expect(approval.authenticatedActor).toBe(true);

    // The service signature carries a campaign id and nothing else.
    expect(approveForProduction.length).toBe(1);
  });

  it("cannot be told who the approver is by the browser", async () => {
    const campaignId = await newCampaign(managerA, "spoofed-approver");

    actAs(managerB);
    // Extra arguments are simply not part of the contract; JavaScript drops them.
    await (approveForProduction as (...args: unknown[]) => Promise<unknown>)(
      campaignId,
      { approverId: managerA.id },
      managerA.id,
    );

    const approval = await prisma.campaignProductionApproval.findFirstOrThrow({
      where: { campaignId },
    });
    expect(approval.approvedById).toBe(managerB.id);
    expect(approval.approvedById).not.toBe(managerA.id);
  });

  it("records the real actor in the audit trail", async () => {
    const campaignId = await newCampaign(managerA, "audited-approval");

    actAs(managerB);
    await approveForProduction(campaignId);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: "PRODUCTION_APPROVAL_RECORDED", entityId: campaignId },
    });
    expect(entry.actorUserId).toBe(managerB.id);
    expect((entry.metadata as { approverEmail?: string }).approverEmail).toBe(
      managerB.email,
    );
    // Approval is not delivery.
    expect((entry.metadata as { sent?: boolean }).sent).toBe(false);
  });

  // ---- 25..26 invalidation still applies ---------------------------------

  it("invalidates the approval when the content changes", async () => {
    const campaignId = await newCampaign(managerA, "content-change");
    actAs(managerB);
    await approveForProduction(campaignId);
    expect((await getSendReadiness(campaignId))?.approval?.valid).toBe(true);

    await prisma.contentItem.update({
      where: { id: contentId },
      data: { bodyHtml: "<p>Rewritten by someone else</p>" },
    });

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.approval?.valid).toBe(false);

    await prisma.contentItem.update({
      where: { id: contentId },
      data: { bodyHtml: "<p>Body</p>" },
    });
  });

  it("invalidates the approval when the audience changes", async () => {
    const campaignId = await newCampaign(managerA, "audience-change");
    actAs(managerB);
    await approveForProduction(campaignId);
    expect((await getSendReadiness(campaignId))?.approval?.valid).toBe(true);

    await prisma.unsubscribe.create({
      data: { normalizedEmail: ADDRESS, source: "RECIPIENT_LINK" },
    });

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.approval?.valid).toBe(false);

    await prisma.unsubscribe.deleteMany({ where: { normalizedEmail: ADDRESS } });
  });

  it("invalidates the approval when the subject changes", async () => {
    const campaignId = await newCampaign(managerA, "subject-change");
    actAs(managerB);
    await approveForProduction(campaignId);

    actAs(managerA);
    await updateNewsletterDetails(campaignId, {
      name: `${RUN} subject-change`,
      subject: "כותרת אחרת",
      preheader: "מה חדש",
      language: Language.HE,
    });

    expect((await getSendReadiness(campaignId))?.approval?.valid).toBe(false);
  });

  // ---- 27 a deactivated approver keeps their history ---------------------

  it("keeps an approval readable after the approver is deactivated", async () => {
    const campaignId = await newCampaign(managerA, "departing-approver");

    const departing = await createTestUser({
      prefix: `${RUN}-departing`,
      role: Role.MANAGER,
      name: "Departing Approver",
    });
    ids.users.push(departing.id);

    actAs(departing);
    await approveForProduction(campaignId);

    actAs(adminA);
    await setStaffActive(departing.id, false);

    // The approval row, and the person's name on it, survive.
    const approval = await prisma.campaignProductionApproval.findFirstOrThrow({
      where: { campaignId },
      include: { approvedBy: { select: { email: true, name: true, isActive: true } } },
    });
    expect(approval.approvedById).toBe(departing.id);
    expect(approval.approvedBy.name).toBe("Departing Approver");
    expect(approval.approvedBy.isActive).toBe(false);

    actAs(managerA);
    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.approval?.approvedByEmail).toBe(departing.email);
  });

  // ---- 28 the retired stand-in ------------------------------------------

  it("does not let the old development stand-in satisfy the rule", async () => {
    const campaignId = await newCampaign(managerA, "standin-approval");

    // Even if a stale session somehow named it, a system account holds no capability.
    actAs(standIn);
    await expect(approveForProduction(campaignId)).rejects.toThrowError();
    expect(
      await prisma.campaignProductionApproval.count({ where: { campaignId } }),
    ).toBe(0);

    actAs(managerA);
  });

  it("treats an approval recorded before sign-in existed as never valid", async () => {
    const campaignId = await newCampaign(managerA, "legacy-approval");
    actAs(managerB);
    await approveForProduction(campaignId);

    // Simulate a row written by the pre-authentication milestone.
    await prisma.campaignProductionApproval.updateMany({
      where: { campaignId },
      data: { authenticatedActor: false },
    });

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.fourEyes.satisfied).toBe(false);
    expect(readiness?.fourEyes.problem).toContain("signed in");
  });

  // ---- 29 the creator is the authenticated user --------------------------

  it("records the authenticated creator on a new campaign", async () => {
    actAs(managerB);
    const created = await createNewsletter({
      name: `${RUN} authored-by-b`,
      subject: "Subject",
      language: Language.HE,
    });
    if (!created.ok) throw new Error("fixture failed");
    ids.campaigns.push(created.data.id);

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: created.data.id },
      select: { createdById: true },
    });
    expect(campaign.createdById).toBe(managerB.id);
    expect(campaign.createdById).not.toBe(managerA.id);
  });

  it("records who froze the audience", async () => {
    const campaignId = await newCampaign(managerA, "prepared-by");

    const frozen = await prisma.campaignFinalAudience.findFirstOrThrow({
      where: { campaignId },
      include: { preparedBy: { select: { email: true } } },
    });
    expect(frozen.createdById).toBe(managerA.id);
    expect(frozen.preparedBy.email).toBe(managerA.email);
  });

  // ---- production is still locked ----------------------------------------

  it("keeps production sending blocked even with four-eyes satisfied", async () => {
    const campaignId = await newCampaign(managerA, "still-locked");
    actAs(managerB);
    await approveForProduction(campaignId);

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.fourEyes.satisfied).toBe(true);
    expect(readiness?.approval?.valid).toBe(true);
    // Everything a person controls is done, and it still cannot send.
    expect(readiness?.preparationComplete).toBe(true);
    expect(readiness?.readiness.ready).toBe(false);
    expect(
      readiness?.readiness.checks.find((c) => c.key === "production")?.status,
    ).toBe("BLOCKED");
    expect(readiness?.productionEnabled).toBe(false);

    expect(
      await prisma.campaignRecipient.count({
        where: { campaignId: { in: ids.campaigns } },
      }),
    ).toBe(0);
  });
});
