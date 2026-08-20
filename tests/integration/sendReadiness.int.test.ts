import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Operator } from "../../src/domain/segment/segmentFields";
import {
  AUTHORIZED_TEST_RECIPIENT,
  AUTHORIZED_TEST_SENDER,
} from "../../src/domain/send/testSendPolicy";
import {
  ConsentSource,
  ConsentStatus,
  ExclusionReason,
  Language,
} from "../../src/domain/types";
import { getPrisma } from "../../src/server/db/prisma";
import { setConsent } from "../../src/server/services/communicationService";
import {
  addContent,
  createNewsletter,
  updateNewsletterDetails,
} from "../../src/server/services/newsletterService";
import { setCampaignSegment } from "../../src/server/services/campaignAudienceService";
import { createSegment, updateSegment } from "../../src/server/services/segmentService";
import {
  approveForProduction,
  getSendReadiness,
  inspectFinalAudience,
  prepareFinalAudience,
  revokeProductionApproval,
} from "../../src/server/services/sendReadinessService";
import {
  approveTestSend,
  getTestSendStatus,
} from "../../src/server/services/testSendService";
import {
  actAs,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * Send readiness against real PostgreSQL (ADR-0022).
 *
 * Run-scoped synthetic CRM only: the dev database also holds the real mirrored CRM,
 * and nothing here reads, writes, or counts a real customer record.
 *
 * NOTHING IN THIS SUITE SENDS EMAIL. The safe-test assertions stop at approving a
 * test message — the Gmail submission itself is never invoked, because a test that
 * really sends mail is a test that can really annoy someone.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const BOARD_COMPANY = `rdy-co-${RUN}`;
const BOARD_CONTACT = `rdy-ct-${RUN}`;

const email = (local: string) => `${RUN}-${local}@example.test`;

const EMAILS = {
  alpha: email("alpha"),
  beta: email("beta"),
  unsub: email("unsub"),
  supp: email("supp"),
  denied: email("denied"),
  nolang: email("nolang"),
};
const ALL_EMAILS = Object.values(EMAILS);

const IMAGE_A = "https://cdn.example.test/a.jpg";
const IMAGE_B = "https://cdn.example.test/b.jpg";

const ids = {
  companies: [] as string[],
  contacts: [] as string[],
  contentItems: [] as string[],
  campaigns: [] as string[],
  segments: [] as string[],
  /** Communication addresses this run created, so their audit rows can be removed. */
  addresses: [] as string[],
};

function definition(prefix: string = RUN) {
  return {
    version: 1,
    conditions: [
      { field: "company.name", operator: Operator.STARTS_WITH, value: prefix },
    ],
    groups: [],
    include: { companyEmails: true, contactEmails: true },
  };
}

d("send readiness", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let campaignId = "";
  let segmentId = "";
  let contentId = "";

  /**
   * Two real people (ADR-0023). `creator` prepares everything; `approver` is the
   * second pair of eyes. They are separate `User` rows because four-eyes is only
   * meaningful between identities that actually exist.
   */
  let creator: TestUser;
  let approver: TestUser;
  let adminCreator: TestUser;

  beforeAll(async () => {
    prisma = getPrisma();
    creator = await createTestUser({ prefix: "rdy-creator", role: "MANAGER" });
    approver = await createTestUser({ prefix: "rdy-approver", role: "MANAGER" });
    adminCreator = await createTestUser({ prefix: "rdy-admin", role: "ADMIN" });
    actAs(creator);

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

    const alpha = await company("alphaco", {
      companyEmail: EMAILS.alpha,
      companyEmailNorm: EMAILS.alpha,
    });
    for (const [key, address] of [
      ["betaco", EMAILS.beta],
      ["unsubco", EMAILS.unsub],
      ["suppco", EMAILS.supp],
      ["deniedco", EMAILS.denied],
      ["nolangco", EMAILS.nolang],
    ] as const) {
      await company(key, { companyEmail: address, companyEmailNorm: address });
    }

    // A contact sharing the alpha company's address — one destination, two sources.
    const contact = await prisma.contact.create({
      data: {
        mondayBoardId: BOARD_CONTACT,
        mondayItemId: `${RUN}-john`,
        fullName: `${RUN} john`,
        email: EMAILS.alpha,
        emailNorm: EMAILS.alpha,
      },
    });
    ids.contacts.push(contact.id);
    await prisma.companyContact.create({
      data: { companyId: alpha, contactId: contact.id, assertedBy: "CONTACTS" },
    });

    for (const normalizedEmail of ALL_EMAILS) {
      const row = await prisma.communicationAddress.create({
        data: { normalizedEmail, language: Language.HE },
      });
      ids.addresses.push(row.id);
    }
    // One address is deliberately left without a language, so a localized campaign
    // has a language exclusion to report.
    await prisma.communicationAddress.update({
      where: { normalizedEmail: EMAILS.nolang },
      data: { language: Language.UNKNOWN },
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

    // ---- content + campaign + segment -----------------------------------
    const content = await prisma.contentItem.create({
      data: {
        title: `${RUN} article`,
        summary: "Summary",
        bodyHtml: "<p>Body</p>",
        language: Language.HE,
        origin: "INTERNAL",
        reviewState: "APPROVED",
        imageUrl: IMAGE_A,
        imageAlt: "A picture",
      },
    });
    ids.contentItems.push(content.id);
    contentId = content.id;

    segmentId = await createSegment({
      name: `${RUN} audience`,
      definition: definition(),
    });
    ids.segments.push(segmentId);

    const created = await createNewsletter({
      name: `${RUN} newsletter`,
      subject: "עדכון לקוחות",
      preheader: "מה חדש",
      language: Language.HE,
    });
    if (!created.ok) throw new Error("fixture campaign could not be created");
    campaignId = created.data.id;
    ids.campaigns.push(campaignId);

    await addContent(campaignId, contentId);
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
    await prisma.campaignTestApproval.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaignAudienceExclusion.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaignAudienceSnapshot.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    // Both entity kinds: a consent change during the staleness tests audits the
    // ADDRESS, not the campaign, and orphan audit rows would outlive their fixture.
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...ids.campaigns, ...ids.addresses] } },
    });
    await prisma.campaignContentItem.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaign.deleteMany({ where: { id: { in: ids.campaigns } } });
    await prisma.contentItem.deleteMany({ where: { id: { in: ids.contentItems } } });
    await prisma.segment.deleteMany({ where: { id: { in: ids.segments } } });
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
    await prisma.user.deleteMany({
      where: { id: { in: [creator.id, approver.id, adminCreator.id] } },
    });
  });

  const statusOf = async (key: string, id = campaignId) => {
    const readiness = await getSendReadiness(id);
    return readiness?.readiness.checks.find((c) => c.key === key)?.status;
  };

  /**
   * Approving as the second pair of eyes.
   *
   * The suite prepares everything as `creator`, so approving switches to `approver`
   * and switches back — mirroring two people using the app, which is exactly what
   * four-eyes requires.
   */
  const approveAsSecondPerson = async (id = campaignId) => {
    actAs(approver);
    try {
      return await approveForProduction(id);
    } finally {
      actAs(creator);
    }
  };

  /** Restores the fixture campaign to its known-good, freshly frozen state. */
  const reset = async () => {
    await updateNewsletterDetails(campaignId, {
      name: `${RUN} newsletter`,
      subject: "עדכון לקוחות",
      preheader: "מה חדש",
      language: Language.HE,
    });
    await prisma.contentItem.update({
      where: { id: contentId },
      data: { imageUrl: IMAGE_A },
    });
    await updateSegment(segmentId, {
      name: `${RUN} audience`,
      definition: definition(),
    });
    await setCampaignSegment(campaignId, segmentId);
    return prepareFinalAudience(campaignId);
  };

  // ---- 14..16 the blocking cases -----------------------------------------

  it("blocks a newsletter with no audience", async () => {
    const created = await createNewsletter({
      name: `${RUN} no-audience`,
      subject: "Subject",
      language: Language.HE,
    });
    if (!created.ok) throw new Error("fixture failed");
    ids.campaigns.push(created.data.id);
    await addContent(created.data.id, contentId);

    expect(await statusOf("segment", created.data.id)).toBe("BLOCKED");
    expect(await statusOf("final-audience", created.data.id)).toBe("BLOCKED");
    await expect(prepareFinalAudience(created.data.id)).rejects.toThrowError();
  });

  it("blocks a newsletter with no content", async () => {
    const created = await createNewsletter({
      name: `${RUN} no-content`,
      subject: "Subject",
      language: Language.HE,
    });
    if (!created.ok) throw new Error("fixture failed");
    ids.campaigns.push(created.data.id);
    await setCampaignSegment(created.data.id, segmentId);

    expect(await statusOf("content", created.data.id)).toBe("BLOCKED");

    // Approving is refused too: an approval that can never be valid is worse than none.
    await prepareFinalAudience(created.data.id);
    const result = await approveAsSecondPerson(created.data.id);
    expect(result.ok).toBe(false);
  });

  it("blocks when nobody in the audience can be emailed", async () => {
    const emptySegmentId = await createSegment({
      name: `${RUN} nobody`,
      definition: definition(`${RUN}-matches-nothing`),
    });
    ids.segments.push(emptySegmentId);

    const created = await createNewsletter({
      name: `${RUN} nobody`,
      subject: "Subject",
      language: Language.HE,
    });
    if (!created.ok) throw new Error("fixture failed");
    ids.campaigns.push(created.data.id);
    await addContent(created.data.id, contentId);
    await setCampaignSegment(created.data.id, emptySegmentId);
    await prepareFinalAudience(created.data.id);

    expect(await statusOf("eligible", created.data.id)).toBe("BLOCKED");
    const result = await approveAsSecondPerson(created.data.id);
    expect(result.ok).toBe(false);
  });

  // ---- 17..18 freezing ----------------------------------------------------

  it("creates a final snapshot with the full funnel recorded", async () => {
    const result = await reset();
    const readiness = await getSendReadiness(campaignId);
    const frozen = readiness?.finalAudience;

    expect(frozen).not.toBeNull();
    expect(frozen?.id).toBe(result.finalAudienceId);
    // alpha (company + contact collapse into one) and beta are eligible.
    expect(frozen?.uniqueDestinations).toBe(2);
    expect(frozen?.duplicateSourcesCollapsed).toBe(1);
    // unsubscribed, suppressed, refused and language-unknown are excluded.
    expect(frozen?.excluded).toBe(4);
    expect(frozen?.breakdown[ExclusionReason.UNSUBSCRIBED]).toBe(1);
    expect(frozen?.breakdown[ExclusionReason.SUPPRESSED]).toBe(1);
    expect(frozen?.breakdown[ExclusionReason.CONSENT_DENIED]).toBe(1);
    expect(frozen?.breakdown[ExclusionReason.LANGUAGE_UNKNOWN]).toBe(1);
    expect(await statusOf("final-audience")).toBe("READY");
  });

  it("never edits a snapshot — preparing again writes a new one", async () => {
    const first = await reset();
    const before = await prisma.campaignFinalAudience.findUniqueOrThrow({
      where: { id: first.finalAudienceId },
    });

    const second = await prepareFinalAudience(campaignId);
    expect(second.finalAudienceId).not.toBe(first.finalAudienceId);

    const after = await prisma.campaignFinalAudience.findUniqueOrThrow({
      where: { id: first.finalAudienceId },
    });
    // Byte-for-byte identical: the old snapshot is history, not a working copy.
    expect(after).toEqual(before);

    const both = await prisma.campaignFinalAudience.count({ where: { campaignId } });
    expect(both).toBeGreaterThanOrEqual(2);
  });

  // ---- 19..24 staleness ---------------------------------------------------

  it("goes stale when the CRM changes", async () => {
    await reset();
    expect(await statusOf("final-audience")).toBe("READY");

    const extra = await prisma.company.create({
      data: {
        mondayBoardId: BOARD_COMPANY,
        mondayItemId: `${RUN}-late`,
        name: `${RUN} late arrival`,
        customerStatus: "ACTIVE",
        companyEmail: email("late"),
        companyEmailNorm: email("late"),
      },
    });
    ids.companies.push(extra.id);
    await prisma.communicationAddress.create({
      data: { normalizedEmail: email("late"), language: Language.HE },
    });

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.stalenessMessage).toContain("Prepare the final audience again");
    expect(await statusOf("final-audience")).toBe("BLOCKED");

    await prisma.company.delete({ where: { id: extra.id } });
    await prisma.communicationAddress.delete({
      where: { normalizedEmail: email("late") },
    });
  });

  it("goes stale when an address language changes", async () => {
    await reset();
    await prisma.communicationAddress.update({
      where: { normalizedEmail: EMAILS.beta },
      data: { language: Language.AR },
    });

    expect(await statusOf("final-audience")).toBe("BLOCKED");

    await prisma.communicationAddress.update({
      where: { normalizedEmail: EMAILS.beta },
      data: { language: Language.HE },
    });
  });

  it("goes stale when consent changes", async () => {
    await reset();
    await setConsent({
      status: ConsentStatus.GRANTED,
      addressIds: [
        (
          await prisma.communicationAddress.findUniqueOrThrow({
            where: { normalizedEmail: EMAILS.beta },
          })
        ).id,
      ],
      source: ConsentSource.EXISTING_CUSTOMER_RELATIONSHIP,
      effectiveAt: "2026-01-10",
      confirmed: "on",
    });

    // The people did not change, but their recorded state did — the frozen snapshot
    // no longer describes reality, so it must not stay production-ready.
    expect(await statusOf("final-audience")).toBe("BLOCKED");

    await prisma.communicationAddress.update({
      where: { normalizedEmail: EMAILS.beta },
      data: {
        consentStatus: ConsentStatus.UNKNOWN,
        consentSource: null,
        consentEffectiveAt: null,
      },
    });
  });

  it("goes stale when someone unsubscribes", async () => {
    await reset();
    await prisma.unsubscribe.create({
      data: { normalizedEmail: EMAILS.beta, source: "RECIPIENT_LINK" },
    });

    expect(await statusOf("final-audience")).toBe("BLOCKED");
    const readiness = await getSendReadiness(campaignId);
    // And the live figures show them gone, while the frozen snapshot still lists them.
    expect(readiness?.live?.uniqueDestinations).toBe(1);
    expect(readiness?.finalAudience?.uniqueDestinations).toBe(2);

    await prisma.unsubscribe.deleteMany({ where: { normalizedEmail: EMAILS.beta } });
  });

  it("goes stale when an address is suppressed", async () => {
    await reset();
    await prisma.suppression.create({
      data: { normalizedEmail: EMAILS.beta, reason: "COMPLAINT" },
    });

    expect(await statusOf("final-audience")).toBe("BLOCKED");

    await prisma.suppression.deleteMany({ where: { normalizedEmail: EMAILS.beta } });
  });

  it("goes stale when the segment rules change", async () => {
    await reset();
    await updateSegment(segmentId, {
      name: `${RUN} audience`,
      definition: {
        ...definition(),
        include: { companyEmails: true, contactEmails: false },
      },
    });

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.stalenessMessage).toContain("audience rules changed");

    await updateSegment(segmentId, {
      name: `${RUN} audience`,
      definition: definition(),
    });
  });

  it("goes stale when the newsletter language changes", async () => {
    await reset();
    await updateNewsletterDetails(campaignId, {
      name: `${RUN} newsletter`,
      subject: "עדכון לקוחות",
      preheader: "מה חדש",
      language: Language.AR,
    });

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.stalenessMessage).toContain("newsletter language changed");
    expect(await statusOf("final-audience")).toBe("BLOCKED");
  });

  // ---- 25..28 approval invalidation ---------------------------------------

  it("accepts an approval of the current newsletter and audience", async () => {
    await reset();
    const result = await approveAsSecondPerson();
    expect(result.ok).toBe(true);

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.approval?.valid).toBe(true);
    expect(await statusOf("approval")).toBe("READY");
    // Approving is not sending: production stays blocked regardless.
    expect(await statusOf("production")).toBe("BLOCKED");
  });

  it("invalidates the approval when the content changes", async () => {
    await reset();
    await approveAsSecondPerson();

    await prisma.contentItem.update({
      where: { id: contentId },
      data: { bodyHtml: "<p>Rewritten body</p>" },
    });

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.approval?.valid).toBe(false);
    expect(readiness?.approval?.problem).toContain("changed after approval");

    await prisma.contentItem.update({
      where: { id: contentId },
      data: { bodyHtml: "<p>Body</p>" },
    });
  });

  it("invalidates the approval when a picture changes", async () => {
    await reset();
    await approveAsSecondPerson();

    await prisma.contentItem.update({
      where: { id: contentId },
      data: { imageUrl: IMAGE_B },
    });

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.approval?.valid).toBe(false);
  });

  it("invalidates the approval when the subject changes", async () => {
    await reset();
    await approveAsSecondPerson();

    await updateNewsletterDetails(campaignId, {
      name: `${RUN} newsletter`,
      subject: "כותרת אחרת",
      preheader: "מה חדש",
      language: Language.HE,
    });

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.approval?.valid).toBe(false);
  });

  it("invalidates the approval when the audience is frozen again", async () => {
    await reset();
    await approveAsSecondPerson();
    expect((await getSendReadiness(campaignId))?.approval?.valid).toBe(true);

    await prepareFinalAudience(campaignId);

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.approval?.valid).toBe(false);
    expect(await statusOf("approval")).toBe("BLOCKED");
  });

  it("can be withdrawn by a person", async () => {
    await reset();
    await approveAsSecondPerson();
    await revokeProductionApproval(campaignId);

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.approval?.valid).toBe(false);
  });

  // ---- 29..31 nothing disappears ------------------------------------------

  it("preserves every exclusion with its reason and CRM record", async () => {
    await reset();
    const excluded = await inspectFinalAudience(campaignId, { view: "EXCLUDED" });

    expect(excluded?.total).toBe(4);
    const reasons = excluded?.exclusions.map((e) => e.reason).sort();
    expect(reasons).toEqual(
      [
        ExclusionReason.CONSENT_DENIED,
        ExclusionReason.LANGUAGE_UNKNOWN,
        ExclusionReason.SUPPRESSED,
        ExclusionReason.UNSUBSCRIBED,
      ].sort(),
    );
    for (const row of excluded?.exclusions ?? []) {
      expect(row.label).toContain(RUN);
      expect(row.address).not.toBeNull();
    }
  });

  it("preserves the duplicate-collapse count", async () => {
    await reset();
    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.finalAudience?.duplicateSourcesCollapsed).toBe(1);
    // The collapsed record is retained as a source, never counted as an exclusion.
    expect(readiness?.finalAudience?.excluded).toBe(4);
  });

  it("preserves the CRM provenance of every eligible address", async () => {
    await reset();
    const eligible = await inspectFinalAudience(campaignId, { view: "ELIGIBLE" });

    expect(eligible?.total).toBe(2);
    const alpha = eligible?.destinations.find(
      (row) => row.normalizedEmail === EMAILS.alpha,
    );
    expect(alpha?.language).toBe(Language.HE);
    expect(alpha?.consentStatus).toBe(ConsentStatus.UNKNOWN);
    // Both the company record and the contact record are kept.
    expect(alpha?.sources).toHaveLength(2);
    expect(alpha?.sources.map((s) => s.emailSourceType).sort()).toEqual([
      "COMPANY_EMAIL",
      "CONTACT_EMAIL",
    ]);
    for (const source of alpha?.sources ?? []) {
      expect(source.sourceBoardId).toBeTruthy();
      expect(source.sourceItemId).toBeTruthy();
      expect(source.label).toContain(RUN);
    }
  });

  it("never exposes an accounting address", async () => {
    await reset();
    const eligible = await inspectFinalAudience(campaignId, { view: "ELIGIBLE" });
    const excluded = await inspectFinalAudience(campaignId, { view: "EXCLUDED" });

    const kinds = [
      ...(eligible?.destinations.flatMap((d) => d.sources.map((s) => s.emailSourceType)) ??
        []),
      ...(excluded?.exclusions.map((e) => e.kind) ?? []),
    ];
    // The accounting address has no code path at all; only these two kinds exist.
    for (const kind of kinds) {
      expect(["COMPANY_EMAIL", "CONTACT_EMAIL"]).toContain(kind);
    }
  });

  // ---- 32..34 nothing was sent, and nothing can be --------------------------

  it("creates no delivery record for any campaign in this run", async () => {
    await reset();
    await approveAsSecondPerson();

    expect(
      await prisma.campaignRecipient.count({
        where: { campaignId: { in: ids.campaigns } },
      }),
    ).toBe(0);
    expect(
      await prisma.campaignEvent.count({
        where: { campaignId: { in: ids.campaigns } },
      }),
    ).toBe(0);
    expect(
      await prisma.campaignTestSend.count({
        where: { campaignId: { in: ids.campaigns } },
      }),
    ).toBe(0);
    // Scoped to this run, like everything above it. Preparing a delivery LEDGER became
    // possible in ADR-0024, and the delivery suite writes submitted-looking states BY
    // HAND to exercise the state machine — so a global count would assert something
    // this suite does not control. That nothing is ever really submitted is proven
    // where it belongs: the production provider throws, and the dry run is asserted to
    // make zero calls (tests/integration/delivery.int.test.ts).
    expect(
      await prisma.campaignRecipient.count({
        where: {
          campaignId: { in: ids.campaigns },
          state: {
            in: ["SENDING", "ACCEPTED", "DELIVERED", "SENT", "UNCERTAIN"],
          },
        },
      }),
    ).toBe(0);
  });

  it("has no mail transport in the readiness code path", async () => {
    // Structural, not behavioural: readiness must not be able to reach a provider.
    for (const file of [
      "src/server/services/sendReadinessService.ts",
      "src/domain/campaign/sendReadiness.ts",
      "src/domain/audience/finalAudience.ts",
      "src/app/newsletters/[id]/readinessActions.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of [
        "nodemailer",
        "getEmailProvider",
        "sendTestEmail",
        "createTransport",
        "smtp",
      ]) {
        expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it("reports production sending as blocked no matter what is approved", async () => {
    await reset();
    await approveAsSecondPerson();

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.productionEnabled).toBe(false);
    expect(readiness?.readiness.ready).toBe(false);
    const production = readiness?.readiness.checks.find((c) => c.key === "production");
    expect(production?.status).toBe("BLOCKED");
    expect(production?.detail).toBe(
      "Production customer sending has not been enabled.",
    );
  });

  it("satisfies four-eyes when a second real person approves", async () => {
    await reset();
    await approveAsSecondPerson();

    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.fourEyes.satisfied).toBe(true);
    expect(readiness?.approval?.authenticatedActor).toBe(true);
    expect(readiness?.approval?.approvedByEmail).toBe(approver.email);

    // The campaign really was created by the other person.
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { createdById: true },
    });
    expect(campaign.createdById).toBe(creator.id);
    expect(campaign.createdById).not.toBe(approver.id);
  });

  // ---- 35 the safe test path is untouched ----------------------------------

  it("leaves the safe test workflow working and separate", async () => {
    await reset();
    await approveAsSecondPerson();

    const status = await getTestSendStatus(campaignId);
    expect(status?.fromEmail).toBe(AUTHORIZED_TEST_SENDER);
    expect(status?.toEmail).toBe(AUTHORIZED_TEST_RECIPIENT);
    expect(status?.sendMode).toBe("TEST");
    expect(status?.canApprove).toBe(true);

    // Approving a test email is a separate decision with its own hash and its own
    // ledger — no email is submitted here.
    const approved = await approveTestSend(campaignId);
    expect(approved.ok).toBe(true);

    const testApprovals = await prisma.campaignTestApproval.count({
      where: { campaignId },
    });
    expect(testApprovals).toBeGreaterThan(0);

    // The production approval is untouched by the test approval, and vice versa.
    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.approval?.valid).toBe(true);
    expect(await prisma.campaignTestSend.count({ where: { campaignId } })).toBe(0);
  });
});
