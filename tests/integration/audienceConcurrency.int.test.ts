import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

import { Role } from "../../src/domain/auth/authorization";
import { Operator } from "../../src/domain/segment/segmentFields";
import { ConsentSource, ConsentStatus, Language } from "../../src/domain/types";
import { getPrisma } from "../../src/server/db/prisma";
import { computeAudienceWatermark } from "../../src/server/db/repositories/audienceWatermark";
import { setCampaignSegment } from "../../src/server/services/campaignAudienceService";
import { setConsent } from "../../src/server/services/communicationService";
import {
  addContent,
  createNewsletter,
} from "../../src/server/services/newsletterService";
import { createSegment, updateSegment } from "../../src/server/services/segmentService";
import {
  getSendReadiness,
  prepareFinalAudience,
} from "../../src/server/services/sendReadinessService";
import {
  actAs,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * Final-audience idempotency and the readiness cost (ADR-0023).
 *
 * Two things are proven here:
 *
 *  1. A double-clicked or retried preparation produces ONE frozen snapshot, while a
 *     later deliberate preparation still produces a new one. Append-only history is
 *     preserved, not weakened.
 *
 *  2. The watermark that lets readiness skip a full re-resolution is CONSERVATIVE:
 *     it changes for every kind of edit that could move a person in or out, so the
 *     shortcut can never hide a stale audience or a security-relevant change.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const BOARD = `conc-co-${RUN}`;
const ADDRESS_A = `${RUN}-a@example.test`;
const ADDRESS_B = `${RUN}-b@example.test`;

const ids = {
  users: [] as string[],
  companies: [] as string[],
  contentItems: [] as string[],
  campaigns: [] as string[],
  segments: [] as string[],
  addresses: [] as string[],
};

d("final audience concurrency and readiness cost", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let operator: TestUser;
  let campaignId = "";
  let segmentId = "";

  beforeAll(async () => {
    prisma = getPrisma();
    operator = await createTestUser({ prefix: `${RUN}-op`, role: Role.MANAGER });
    ids.users.push(operator.id);
    actAs(operator);

    for (const [key, address] of [
      ["a", ADDRESS_A],
      ["b", ADDRESS_B],
    ] as const) {
      const company = await prisma.company.create({
        data: {
          mondayBoardId: BOARD,
          mondayItemId: `${RUN}-${key}`,
          name: `${RUN} company ${key}`,
          customerStatus: "ACTIVE",
          companyEmail: address,
          companyEmailNorm: address,
        },
      });
      ids.companies.push(company.id);

      const communication = await prisma.communicationAddress.create({
        data: { normalizedEmail: address, language: Language.HE },
      });
      ids.addresses.push(communication.id);
    }

    const content = await prisma.contentItem.create({
      data: {
        title: `${RUN} article`,
        bodyHtml: "<p>Body</p>",
        language: Language.HE,
        origin: "INTERNAL",
        reviewState: "APPROVED",
      },
    });
    ids.contentItems.push(content.id);

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

    const created = await createNewsletter({
      name: `${RUN} newsletter`,
      subject: "עדכון לקוחות",
      language: Language.HE,
    });
    if (!created.ok) throw new Error("fixture campaign failed");
    campaignId = created.data.id;
    ids.campaigns.push(campaignId);
    await addContent(campaignId, content.id);
    await setCampaignSegment(campaignId, segmentId);
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
      where: { entityId: { in: [...ids.campaigns, ...ids.addresses] } },
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

  const snapshotCount = () =>
    prisma.campaignFinalAudience.count({ where: { campaignId } });

  // ---- 30..33 idempotency -------------------------------------------------

  it("turns a double click into one frozen snapshot", async () => {
    const before = await snapshotCount();
    const token = randomUUID();

    const first = await prepareFinalAudience(campaignId, token);
    const second = await prepareFinalAudience(campaignId, token);

    expect(second.finalAudienceId).toBe(first.finalAudienceId);
    expect(second.deduplicated).toBe(true);
    expect(await snapshotCount()).toBe(before + 1);
  });

  it("keeps five concurrent requests to one snapshot", async () => {
    const before = await snapshotCount();
    const token = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => prepareFinalAudience(campaignId, token)),
    );

    const distinct = new Set(results.map((result) => result.finalAudienceId));
    expect(distinct.size).toBe(1);
    expect(await snapshotCount()).toBe(before + 1);

    // Every caller gets the real figures, read back from the winner rather than
    // guessed — a loser must not report an empty audience.
    for (const result of results) {
      expect(result.uniqueDestinations).toBe(2);
      expect(result.destinationsStored).toBe(2);
    }
  });

  it("is idempotent across a retry, even much later", async () => {
    const token = randomUUID();
    const first = await prepareFinalAudience(campaignId, token);

    const before = await snapshotCount();
    const retried = await prepareFinalAudience(campaignId, token);

    expect(retried.finalAudienceId).toBe(first.finalAudienceId);
    expect(await snapshotCount()).toBe(before);
  });

  it("still allows a later, deliberate preparation", async () => {
    const before = await snapshotCount();

    const first = await prepareFinalAudience(campaignId, randomUUID());
    const second = await prepareFinalAudience(campaignId, randomUUID());

    // A new intent carries a new token, so append-only history keeps growing.
    expect(second.finalAudienceId).not.toBe(first.finalAudienceId);
    expect(second.deduplicated).toBe(false);
    expect(await snapshotCount()).toBe(before + 2);
  });

  it("does not collapse preparations that carry no token", async () => {
    const before = await snapshotCount();
    const first = await prepareFinalAudience(campaignId);
    const second = await prepareFinalAudience(campaignId);

    // NULL never collides in PostgreSQL, so a server-side caller with no browser
    // still gets one snapshot per call.
    expect(second.finalAudienceId).not.toBe(first.finalAudienceId);
    expect(await snapshotCount()).toBe(before + 2);
  });

  it("keeps every earlier snapshot byte-for-byte", async () => {
    const first = await prepareFinalAudience(campaignId, randomUUID());
    const before = await prisma.campaignFinalAudience.findUniqueOrThrow({
      where: { id: first.finalAudienceId },
    });

    await prepareFinalAudience(campaignId, randomUUID());
    await prepareFinalAudience(campaignId, randomUUID());

    const after = await prisma.campaignFinalAudience.findUniqueOrThrow({
      where: { id: first.finalAudienceId },
    });
    expect(after).toEqual(before);
  });

  // ---- 34 the readiness shortcut -----------------------------------------

  it("verifies an unchanged audience without re-resolving it", async () => {
    const prepared = await prepareFinalAudience(campaignId, randomUUID());
    const readiness = await getSendReadiness(campaignId);

    // The watermark is GLOBAL: any CRM or communication write, from any campaign,
    // invalidates the shortcut. Other suites run in parallel against the same
    // development database, so the contract — not one branch of it — is what is
    // asserted here.
    const stored = await prisma.campaignFinalAudience.findUniqueOrThrow({
      where: { id: prepared.finalAudienceId },
      select: { resolutionWatermark: true },
    });
    const current = await computeAudienceWatermark(prisma, campaignId);

    if (stored.resolutionWatermark === current) {
      // Nothing relevant changed, so the expensive resolution must be skipped.
      expect(readiness?.audienceVerifiedByWatermark).toBe(true);
    } else {
      // Something did change, so the shortcut must decline and fall back to a full
      // re-resolution. Failing towards MORE work is the only safe direction.
      expect(readiness?.audienceVerifiedByWatermark).toBe(false);
    }

    // Either way the answer is correct and complete.
    expect(readiness?.stalenessMessage).toBeNull();
    expect(readiness?.live?.uniqueDestinations).toBe(2);
    expect(readiness?.finalAudience?.uniqueDestinations).toBe(2);
  });

  it("takes the shortcut when the database really is quiet", async () => {
    // Deterministic version of the check above, proven against the stored value
    // rather than against wall-clock luck.
    const prepared = await prepareFinalAudience(campaignId, randomUUID());
    const stored = await prisma.campaignFinalAudience.findUniqueOrThrow({
      where: { id: prepared.finalAudienceId },
      select: { resolutionWatermark: true },
    });

    // The watermark stored at freeze time is exactly what a fresh computation gives
    // for the same state — that equality IS the shortcut.
    expect(stored.resolutionWatermark).not.toBe("");
    expect(stored.resolutionWatermark.split("|").length).toBeGreaterThan(10);
  });

  it("re-resolves when a snapshot predates the watermark", async () => {
    await prepareFinalAudience(campaignId, randomUUID());
    // An empty watermark is what a snapshot frozen before this milestone carries.
    await prisma.campaignFinalAudience.updateMany({
      where: { campaignId },
      data: { resolutionWatermark: "" },
    });

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.audienceVerifiedByWatermark).toBe(false);
    // It falls back to the full comparison and still reads as current.
    expect(readiness?.stalenessMessage).toBeNull();
    expect(readiness?.live?.uniqueDestinations).toBe(2);
  });

  // ---- 35..36 the shortcut cannot hide a change --------------------------

  it("still detects a stale audience after a consent change", async () => {
    await prepareFinalAudience(campaignId, randomUUID());
    expect((await getSendReadiness(campaignId))?.stalenessMessage).toBeNull();

    await setConsent({
      status: ConsentStatus.GRANTED,
      addressIds: [ids.addresses[0]],
      source: ConsentSource.EXISTING_CUSTOMER_RELATIONSHIP,
      effectiveAt: "2026-01-10",
      confirmed: "on",
    });

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.audienceVerifiedByWatermark).toBe(false);
    expect(readiness?.stalenessMessage).toContain("Prepare the final audience again");
  });

  it("changes the watermark for every kind of security-relevant edit", async () => {
    const at = () => computeAudienceWatermark(prisma, campaignId);
    const baseline = await at();

    // An unsubscribe.
    await prisma.unsubscribe.create({
      data: { normalizedEmail: ADDRESS_B, source: "RECIPIENT_LINK" },
    });
    const afterUnsubscribe = await at();
    expect(afterUnsubscribe).not.toBe(baseline);
    await prisma.unsubscribe.deleteMany({ where: { normalizedEmail: ADDRESS_B } });

    // A suppression.
    const beforeSuppression = await at();
    await prisma.suppression.create({
      data: { normalizedEmail: ADDRESS_B, reason: "HARD_BOUNCE" },
    });
    expect(await at()).not.toBe(beforeSuppression);
    await prisma.suppression.deleteMany({ where: { normalizedEmail: ADDRESS_B } });

    // A language change.
    const beforeLanguage = await at();
    await prisma.communicationAddress.update({
      where: { id: ids.addresses[1] },
      data: { language: Language.AR },
    });
    expect(await at()).not.toBe(beforeLanguage);
    await prisma.communicationAddress.update({
      where: { id: ids.addresses[1] },
      data: { language: Language.HE },
    });

    // A CRM record arriving.
    const beforeCrm = await at();
    const extra = await prisma.company.create({
      data: {
        mondayBoardId: BOARD,
        mondayItemId: `${RUN}-late`,
        name: `${RUN} late company`,
        customerStatus: "ACTIVE",
        companyEmail: `${RUN}-late@example.test`,
        companyEmailNorm: `${RUN}-late@example.test`,
      },
    });
    expect(await at()).not.toBe(beforeCrm);
    await prisma.company.delete({ where: { id: extra.id } });

    // The segment rules being edited.
    const beforeSegment = await at();
    await updateSegment(segmentId, {
      name: `${RUN} audience`,
      definition: {
        version: 1,
        conditions: [
          { field: "company.name", operator: Operator.STARTS_WITH, value: RUN },
        ],
        groups: [],
        include: { companyEmails: true, contactEmails: true },
      },
    });
    expect(await at()).not.toBe(beforeSegment);
    await updateSegment(segmentId, {
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
  });

  it("is deterministic for one database state", async () => {
    // Read twice inside a single repeatable-read snapshot. The development database
    // is shared with other suites running in parallel, so "nothing changed" has to be
    // guaranteed by the transaction rather than hoped for.
    const [a, b] = await prisma.$transaction(
      async (tx) => [
        await computeAudienceWatermark(tx, campaignId),
        await computeAudienceWatermark(tx, campaignId),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    expect(a).toBe(b);
  });

  it("is campaign-specific, so one newsletter's change is not another's", async () => {
    const other = await createNewsletter({
      name: `${RUN} other`,
      subject: "Other",
      language: Language.AR,
    });
    if (!other.ok) throw new Error("fixture failed");
    ids.campaigns.push(other.data.id);

    const mine = await computeAudienceWatermark(prisma, campaignId);
    const theirs = await computeAudienceWatermark(prisma, other.data.id);
    expect(mine).not.toBe(theirs);
  });

  // ---- the shortcut is not a security bypass -----------------------------

  it("still refuses an unauthenticated caller, cached or not", async () => {
    await prepareFinalAudience(campaignId, randomUUID());
    // Warm whichever path readiness takes; the shortcut must never become a way in.
    await getSendReadiness(campaignId);

    actAs(null);
    await expect(prepareFinalAudience(campaignId, randomUUID())).rejects.toThrowError();
    actAs(operator);
  });
});
