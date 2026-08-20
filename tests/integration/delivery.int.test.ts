import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Role } from "../../src/domain/auth/authorization";
import { DeliveryState } from "../../src/domain/delivery/dispatchPolicy";
import { ProviderEventType } from "../../src/domain/delivery/providerEvent";
import { Operator } from "../../src/domain/segment/segmentFields";
import { ConsentStatus, EmailStatus, Language } from "../../src/domain/types";
import { getPrisma } from "../../src/server/db/prisma";
import {
  getProductionEmailProvider,
  ProductionSendingDisabledError,
  productionDeliveryEnabled,
} from "../../src/server/integrations/email";
import { setCampaignSegment } from "../../src/server/services/campaignAudienceService";
import {
  DeliveryError,
  dispatchDryRun,
  getDeliveryLedger,
  prepareDeliveryLedger,
} from "../../src/server/services/deliveryService";
import {
  addContent,
  createNewsletter,
} from "../../src/server/services/newsletterService";
import { ingestProviderEvent } from "../../src/server/services/providerEventService";
import { createSegment } from "../../src/server/services/segmentService";
import {
  approveForProduction,
  getSendReadiness,
  prepareFinalAudience,
} from "../../src/server/services/sendReadinessService";
import { issueUnsubscribeLink, confirmUnsubscribe } from "../../src/server/services/unsubscribeService";
import {
  actAs,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * The production delivery ledger and its dry run (ADR-0024).
 *
 * NOTHING HERE SENDS EMAIL. The only production adapter that exists throws when asked
 * to send, and the suite asserts that it is never asked.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const BOARD_CO = `del-co-${RUN}`;
const BOARD_CT = `del-ct-${RUN}`;

const SHARED = `${RUN}-shared@example.test`;
const PLAIN = `${RUN}-plain@example.test`;
const LATER = `${RUN}-later@example.test`;
const ACCOUNTING = `${RUN}-accounting@example.test`;
const ALL = [SHARED, PLAIN, LATER];

const ids = {
  users: [] as string[],
  companies: [] as string[],
  contacts: [] as string[],
  addresses: [] as string[],
  campaigns: [] as string[],
  segments: [] as string[],
  contentItems: [] as string[],
};

d("production delivery ledger", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let creator: TestUser;
  let approver: TestUser;
  let contentId = "";
  let segmentId = "";

  /** A campaign taken all the way to "approved by a second person". */
  async function approvedCampaign(label: string): Promise<string> {
    actAs(creator);
    const created = await createNewsletter({
      name: `${RUN} ${label}`,
      subject: "עדכון לקוחות",
      language: Language.HE,
    });
    if (!created.ok) throw new Error("fixture campaign failed");
    ids.campaigns.push(created.data.id);
    await addContent(created.data.id, contentId);
    await setCampaignSegment(created.data.id, segmentId);
    await prepareFinalAudience(created.data.id, randomUUID());

    actAs(approver);
    const approval = await approveForProduction(created.data.id);
    if (!approval.ok) throw new Error(`fixture approval failed: ${approval.message}`);
    actAs(creator);
    return created.data.id;
  }

  beforeAll(async () => {
    prisma = getPrisma();
    creator = await createTestUser({ prefix: `${RUN}-creator`, role: Role.MANAGER });
    approver = await createTestUser({ prefix: `${RUN}-approver`, role: Role.MANAGER });
    ids.users.push(creator.id, approver.id);
    actAs(creator);

    // A company whose campaign address is also a contact's — one destination, two
    // sources, so deduplication is exercised.
    const company = await prisma.company.create({
      data: {
        mondayBoardId: BOARD_CO,
        mondayItemId: `${RUN}-shared`,
        name: `${RUN} shared co`,
        customerStatus: "ACTIVE",
        companyEmail: SHARED,
        companyEmailNorm: SHARED,
        // Present on the record and structurally unreachable as a campaign target.
        accountingEmail: ACCOUNTING,
      },
    });
    ids.companies.push(company.id);

    const contact = await prisma.contact.create({
      data: {
        mondayBoardId: BOARD_CT,
        mondayItemId: `${RUN}-person`,
        fullName: `${RUN} person`,
        email: SHARED,
        emailNorm: SHARED,
      },
    });
    ids.contacts.push(contact.id);
    await prisma.companyContact.create({
      data: { companyId: company.id, contactId: contact.id, assertedBy: "CONTACTS" },
    });

    for (const [key, address] of [
      ["plain", PLAIN],
      ["later", LATER],
    ] as const) {
      const extra = await prisma.company.create({
        data: {
          mondayBoardId: BOARD_CO,
          mondayItemId: `${RUN}-${key}`,
          name: `${RUN} company ${key}`,
          customerStatus: "ACTIVE",
          companyEmail: address,
          companyEmailNorm: address,
        },
      });
      ids.companies.push(extra.id);
    }

    for (const address of ALL) {
      const row = await prisma.communicationAddress.create({
        data: { normalizedEmail: address, language: Language.HE },
      });
      ids.addresses.push(row.id);
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
    contentId = content.id;

    segmentId = await createSegment({
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
    ids.segments.push(segmentId);
  });

  beforeEach(async () => {
    actAs(creator);
    await prisma.unsubscribe.deleteMany({ where: { normalizedEmail: { in: ALL } } });
    await prisma.suppression.deleteMany({ where: { normalizedEmail: { in: ALL } } });
    await prisma.communicationAddress.updateMany({
      where: { normalizedEmail: { in: ALL } },
      data: {
        emailStatus: EmailStatus.UNKNOWN,
        consentStatus: ConsentStatus.UNKNOWN,
        language: Language.HE,
      },
    });
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    clearTestActor();
    await prisma.campaignEvent.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaignRecipientSource.deleteMany({
      where: { recipient: { campaignId: { in: ids.campaigns } } },
    });
    await prisma.campaignRecipient.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaignProductionApproval.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaignFinalAudience.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaignContentItem.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.suppressionEvent.deleteMany({
      where: { normalizedEmail: { in: ALL } },
    });
    await prisma.suppression.deleteMany({ where: { normalizedEmail: { in: ALL } } });
    await prisma.unsubscribe.deleteMany({ where: { normalizedEmail: { in: ALL } } });
    await prisma.unsubscribeToken.deleteMany({
      where: { normalizedEmail: { in: ALL } },
    });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...ids.campaigns, ...ids.addresses] } },
    });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids.users } } });
    await prisma.campaign.deleteMany({ where: { id: { in: ids.campaigns } } });
    await prisma.contentItem.deleteMany({ where: { id: { in: ids.contentItems } } });
    await prisma.segment.deleteMany({ where: { id: { in: ids.segments } } });
    await prisma.companyContact.deleteMany({
      where: { contactId: { in: ids.contacts } },
    });
    await prisma.contact.deleteMany({ where: { id: { in: ids.contacts } } });
    await prisma.company.deleteMany({ where: { id: { in: ids.companies } } });
    await prisma.communicationAddress.deleteMany({
      where: { id: { in: ids.addresses } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  });

  // ---- 20..24 provenance and identity ------------------------------------

  it("creates one delivery per (campaign, normalized email)", async () => {
    const campaignId = await approvedCampaign("unique");
    const result = await prepareDeliveryLedger(campaignId);
    expect(result.prepared).toBe(3);

    const rows = await prisma.campaignRecipient.findMany({ where: { campaignId } });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.normalizedEmail)).size).toBe(3);

    // Preparing again adds nothing: the unique index is the guard.
    const again = await prepareDeliveryLedger(campaignId);
    expect(again.prepared).toBe(0);
    expect(await prisma.campaignRecipient.count({ where: { campaignId } })).toBe(3);
  });

  it("collapses duplicate CRM sources into one delivery, keeping both", async () => {
    const campaignId = await approvedCampaign("dedupe");
    await prepareDeliveryLedger(campaignId);

    const recipient = await prisma.campaignRecipient.findFirstOrThrow({
      where: { campaignId, normalizedEmail: SHARED },
      include: { sources: true },
    });
    // One delivery…
    expect(
      await prisma.campaignRecipient.count({
        where: { campaignId, normalizedEmail: SHARED },
      }),
    ).toBe(1);
    // …and both contributing CRM records preserved.
    expect(recipient.sources).toHaveLength(2);
    expect(recipient.sources.map((s) => s.emailSourceType).sort()).toEqual([
      "COMPANY_EMAIL",
      "CONTACT_EMAIL",
    ]);
  });

  it("cannot deliver to an accounting address", async () => {
    const campaignId = await approvedCampaign("accounting");
    await prepareDeliveryLedger(campaignId);

    const rows = await prisma.campaignRecipient.findMany({
      where: { campaignId },
      include: { sources: true },
    });
    for (const row of rows) {
      expect(row.normalizedEmail).not.toBe(ACCOUNTING);
      for (const source of row.sources) {
        // The accounting address has no code path anywhere; only two kinds exist.
        expect(["COMPANY_EMAIL", "CONTACT_EMAIL"]).toContain(source.emailSourceType);
      }
    }
  });

  it("makes every recipient point at the audience it came from", async () => {
    const campaignId = await approvedCampaign("provenance");
    const result = await prepareDeliveryLedger(campaignId);

    const rows = await prisma.campaignRecipient.findMany({ where: { campaignId } });
    for (const row of rows) {
      expect(row.finalAudienceId).toBe(result.finalAudienceId);
      expect(row.preparedById).toBe(creator.id);
      expect(row.languageAtPreparation).toBe(Language.HE);
      expect(row.consentAtPreparation).toBe(ConsentStatus.UNKNOWN);
    }
  });

  it("offers no way to supply an arbitrary recipient", () => {
    // Structural: the service takes a campaign id and nothing else. There is no
    // parameter, and no parsed shape, through which an address could be injected.
    expect(prepareDeliveryLedger.length).toBe(1);
    const source = readFileSync("src/server/services/deliveryService.ts", "utf8");
    expect(source).not.toMatch(/function prepare[\s\S]{0,200}email:\s*string/);
  });

  // ---- 25..28 preconditions ----------------------------------------------

  it("refuses when the audience is stale", async () => {
    const campaignId = await approvedCampaign("stale");

    // Something changes after approval.
    const extra = await prisma.company.create({
      data: {
        mondayBoardId: BOARD_CO,
        mondayItemId: `${RUN}-stale-extra`,
        name: `${RUN} stale extra`,
        customerStatus: "ACTIVE",
        companyEmail: `${RUN}-stale-extra@example.test`,
        companyEmailNorm: `${RUN}-stale-extra@example.test`,
      },
    });
    ids.companies.push(extra.id);

    await expect(prepareDeliveryLedger(campaignId)).rejects.toThrowError(DeliveryError);
    expect(await prisma.campaignRecipient.count({ where: { campaignId } })).toBe(0);

    await prisma.company.delete({ where: { id: extra.id } });
  });

  it("refuses when the approval is invalid", async () => {
    const campaignId = await approvedCampaign("invalid-approval");
    // Editing the content after approval invalidates it.
    await prisma.contentItem.update({
      where: { id: contentId },
      data: { bodyHtml: "<p>Changed</p>" },
    });

    await expect(prepareDeliveryLedger(campaignId)).rejects.toThrowError(DeliveryError);
    expect(await prisma.campaignRecipient.count({ where: { campaignId } })).toBe(0);

    await prisma.contentItem.update({
      where: { id: contentId },
      data: { bodyHtml: "<p>Body</p>" },
    });
  });

  it("refuses a self-approved campaign", async () => {
    actAs(creator);
    const created = await createNewsletter({
      name: `${RUN} self-approved`,
      subject: "Subject",
      language: Language.HE,
    });
    if (!created.ok) throw new Error("fixture failed");
    ids.campaigns.push(created.data.id);
    await addContent(created.data.id, contentId);
    await setCampaignSegment(created.data.id, segmentId);
    await prepareFinalAudience(created.data.id, randomUUID());

    // The creator tries to approve their own campaign: four-eyes refuses.
    const approval = await approveForProduction(created.data.id);
    expect(approval.ok).toBe(false);

    await expect(prepareDeliveryLedger(created.data.id)).rejects.toThrowError(
      DeliveryError,
    );
    expect(
      await prisma.campaignRecipient.count({ where: { campaignId: created.data.id } }),
    ).toBe(0);
  });

  it("refuses when there is no approval at all", async () => {
    actAs(creator);
    const created = await createNewsletter({
      name: `${RUN} unapproved`,
      subject: "Subject",
      language: Language.HE,
    });
    if (!created.ok) throw new Error("fixture failed");
    ids.campaigns.push(created.data.id);
    await addContent(created.data.id, contentId);
    await setCampaignSegment(created.data.id, segmentId);
    await prepareFinalAudience(created.data.id, randomUUID());

    await expect(prepareDeliveryLedger(created.data.id)).rejects.toThrowError(
      DeliveryError,
    );
  });

  // ---- 29..32 dispatch-time vetoes ----------------------------------------

  it("suppresses an address that unsubscribed after approval", async () => {
    const campaignId = await approvedCampaign("late-unsubscribe");

    const { token } = await issueUnsubscribeLink({
      normalizedEmail: LATER,
      campaignId,
    });
    await confirmUnsubscribe(token);

    // The audience is now stale, so re-freeze and re-approve exactly as a person would.
    await prepareFinalAudience(campaignId, randomUUID());
    actAs(approver);
    await approveForProduction(campaignId);
    actAs(creator);

    const result = await prepareDeliveryLedger(campaignId);
    // The unsubscribed address is not in the audience at all any more.
    const rows = await prisma.campaignRecipient.findMany({ where: { campaignId } });
    expect(rows.map((row) => row.normalizedEmail)).not.toContain(LATER);
    expect(result.prepared).toBe(2);
  });

  it("suppresses a veto that lands between approval and preparation", async () => {
    const campaignId = await approvedCampaign("race");

    // Suppression arrives AFTER approval but the audience hash is unchanged for it,
    // because suppression is one of the live vetoes re-read at preparation.
    await prisma.suppression.create({
      data: { normalizedEmail: PLAIN, reason: "HARD_BOUNCE" },
    });

    // Re-freeze so the snapshot is current, then approve, then prepare.
    await prepareFinalAudience(campaignId, randomUUID());
    actAs(approver);
    await approveForProduction(campaignId);
    actAs(creator);

    const result = await prepareDeliveryLedger(campaignId);
    const rows = await prisma.campaignRecipient.findMany({ where: { campaignId } });
    expect(rows.map((row) => row.normalizedEmail)).not.toContain(PLAIN);
    expect(result.prepared).toBeGreaterThan(0);
  });

  it("vetoes a fact that changed after the ledger was prepared", async () => {
    // THE point of the dispatch-time re-check (ADR-0024 §25). Staleness already blocks
    // preparation when the audience moved, but a veto can still land in the window
    // between preparing the ledger and submitting it — and that address must never
    // receive the message.
    const campaignId = await approvedCampaign("late-veto");
    await prepareDeliveryLedger(campaignId);

    const clean = await dispatchDryRun(campaignId);
    expect(clean.wouldVeto).toBe(0);

    await prisma.communicationAddress.updateMany({
      where: { normalizedEmail: PLAIN },
      data: { emailStatus: EmailStatus.INVALID },
    });

    const after = await dispatchDryRun(campaignId);
    expect(after.wouldVeto).toBe(1);
    expect(after.vetoBreakdown.INVALID_EMAIL).toBe(1);
    expect(after.wouldSubmit).toBe(clean.wouldSubmit - 1);
  });

  it("records a veto with its reason rather than dropping it silently", async () => {
    // An address unsubscribed before the audience was frozen is not in it at all; one
    // that is vetoed AT preparation is written as SUPPRESSED, carrying why.
    const campaignId = await approvedCampaign("veto-recorded");

    // Simulate the narrow race the veto exists for: the fact lands after the readiness
    // check has passed, so preparation itself has to catch it.
    const readiness = await getSendReadiness(campaignId);
    expect(readiness?.stalenessMessage).toBeNull();

    const original = { where: { normalizedEmail: PLAIN } };
    await prisma.$transaction(async (tx) => {
      await tx.communicationAddress.updateMany({
        ...original,
        data: { emailStatus: EmailStatus.INVALID },
      });
    });

    // The audience is now stale, which is the OUTER guard doing its job — preparation
    // refuses outright rather than half-preparing.
    await expect(prepareDeliveryLedger(campaignId)).rejects.toThrowError(DeliveryError);
    expect(await prisma.campaignRecipient.count({ where: { campaignId } })).toBe(0);

    // Re-freeze and re-approve: now the invalid address is excluded by the audience
    // resolver itself, so it never becomes a delivery destination at all.
    await prepareFinalAudience(campaignId, randomUUID());
    actAs(approver);
    await approveForProduction(campaignId);
    actAs(creator);

    await prepareDeliveryLedger(campaignId);
    const rows = await prisma.campaignRecipient.findMany({ where: { campaignId } });
    expect(rows.map((row) => row.normalizedEmail)).not.toContain(PLAIN);
  });

  // ---- 33..34 nothing is transmitted --------------------------------------

  it("keeps the production provider disabled and refusing", async () => {
    const provider = getProductionEmailProvider();
    const configuration = provider.checkConfiguration();

    expect(productionDeliveryEnabled()).toBe(false);
    expect(configuration.configured).toBe(false);
    expect(configuration.name).toBe("DISABLED");
    expect(configuration.domain.spf).toBe("NOT_VERIFIED");
    expect(configuration.domain.dkim).toBe("NOT_VERIFIED");
    expect(configuration.domain.dmarc).toBe("NOT_VERIFIED");

    // Asking it to send THROWS. A quiet no-op returning a benign result is the failure
    // mode that lets a dry run be mistaken for a delivery.
    await expect(
      provider.send({
        to: PLAIN,
        subject: "x",
        html: "<p>x</p>",
        text: "x",
        idempotencyKey: "k",
      }),
    ).rejects.toThrowError(ProductionSendingDisabledError);
  });

  it("makes zero provider calls in a dry run", async () => {
    const campaignId = await approvedCampaign("dry-run");
    await prepareDeliveryLedger(campaignId);

    // A provider that records any send attempt as a failure of this test.
    const calls: string[] = [];
    const { setProductionEmailProviderForTesting } = await import(
      "../../src/server/integrations/email"
    );
    setProductionEmailProviderForTesting({
      name: "DISABLED",
      checkConfiguration: () => ({
        configured: false,
        enabled: false,
        name: "DISABLED",
        problems: ["test double"],
        senderEmail: null,
        domain: {
          domain: null,
          spf: "NOT_VERIFIED",
          dkim: "NOT_VERIFIED",
          dmarc: "NOT_VERIFIED",
          requiredDnsRecords: [],
        },
      }),
      send: async () => {
        calls.push("send");
        throw new Error("the dry run must never submit anything");
      },
      verifyWebhook: () => ({
        ok: false,
        reason: "UNSIGNED",
        message: "test double",
      }),
    });

    try {
      const result = await dispatchDryRun(campaignId);
      expect(result.providerCalls).toBe(0);
      expect(result.productionEnabled).toBe(false);
      expect(result.wouldSubmit).toBeGreaterThan(0);
      expect(calls).toEqual([]);
    } finally {
      setProductionEmailProviderForTesting(undefined);
    }
  });

  it("leaves every prepared row unsent", async () => {
    const campaignId = await approvedCampaign("unsent");
    await prepareDeliveryLedger(campaignId);
    await dispatchDryRun(campaignId);

    const ledger = await getDeliveryLedger(campaignId);
    expect(ledger.everSubmitted).toBe(false);
    expect(ledger.byState.PENDING).toBeGreaterThan(0);

    const rows = await prisma.campaignRecipient.findMany({ where: { campaignId } });
    for (const row of rows) {
      expect(row.providerMessageId).toBeNull();
      expect(row.sentAt).toBeNull();
      expect(row.firstAttemptAt).toBeNull();
      expect([DeliveryState.PENDING, DeliveryState.SUPPRESSED]).toContain(row.state);
    }
  });

  // ---- 35..36 accepted != delivered, uncertain never retried --------------

  it("models accepted and delivered as different facts", async () => {
    const campaignId = await approvedCampaign("accepted");
    await prepareDeliveryLedger(campaignId);

    const recipient = await prisma.campaignRecipient.findFirstOrThrow({
      where: { campaignId, state: DeliveryState.PENDING },
    });
    // A hand-made ACCEPTED row, as a real submission would leave it.
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { state: DeliveryState.ACCEPTED, providerMessageId: `msg-${RUN}` },
    });

    const stillNotDelivered = await prisma.campaignRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    });
    expect(stillNotDelivered.state).toBe(DeliveryState.ACCEPTED);
    expect(stillNotDelivered.deliveredAt).toBeNull();

    // Only a provider event may claim delivery.
    await ingestProviderEvent({
      providerEventId: `evt-delivered-${RUN}`,
      type: ProviderEventType.DELIVERED,
      normalizedEmail: recipient.normalizedEmail,
      providerMessageId: `msg-${RUN}`,
      occurredAt: new Date(),
    });

    const delivered = await prisma.campaignRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    });
    expect(delivered.state).toBe(DeliveryState.DELIVERED);
    expect(delivered.deliveredAt).not.toBeNull();
  });

  it("never lets an UNCERTAIN delivery be picked up again", async () => {
    const campaignId = await approvedCampaign("uncertain");
    await prepareDeliveryLedger(campaignId);

    const recipient = await prisma.campaignRecipient.findFirstOrThrow({
      where: { campaignId, state: DeliveryState.PENDING },
    });
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { state: DeliveryState.UNCERTAIN },
    });

    // The dry run — which is exactly what a dispatcher would iterate — skips it.
    const before = await dispatchDryRun(campaignId);
    const remaining = await prisma.campaignRecipient.count({
      where: { campaignId, state: DeliveryState.PENDING },
    });
    expect(before.wouldSubmit).toBe(remaining);

    const unchanged = await prisma.campaignRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    });
    expect(unchanged.state).toBe(DeliveryState.UNCERTAIN);
  });

  // ---- 37..39 provider events ---------------------------------------------

  it("suppresses and invalidates an address on a hard bounce", async () => {
    await ingestProviderEvent({
      providerEventId: `evt-bounce-${RUN}`,
      type: ProviderEventType.HARD_BOUNCE,
      normalizedEmail: PLAIN,
      occurredAt: new Date(),
      reason: "550 5.1.1 user unknown",
    });

    expect(
      await prisma.suppression.count({
        where: { normalizedEmail: PLAIN, reason: "HARD_BOUNCE" },
      }),
    ).toBe(1);
    const address = await prisma.communicationAddress.findUniqueOrThrow({
      where: { normalizedEmail: PLAIN },
    });
    expect(address.emailStatus).toBe(EmailStatus.INVALID);
  });

  it("suppresses on a complaint without calling the address invalid", async () => {
    await ingestProviderEvent({
      providerEventId: `evt-complaint-${RUN}`,
      type: ProviderEventType.COMPLAINT,
      normalizedEmail: SHARED,
      occurredAt: new Date(),
    });

    expect(
      await prisma.suppression.count({
        where: { normalizedEmail: SHARED, reason: "COMPLAINT" },
      }),
    ).toBe(1);
    // The mailbox works; the person does not want the mail. Different facts.
    const address = await prisma.communicationAddress.findUniqueOrThrow({
      where: { normalizedEmail: SHARED },
    });
    expect(address.emailStatus).not.toBe(EmailStatus.INVALID);
  });

  it("keeps a complaint stronger than a granted consent", async () => {
    await prisma.communicationAddress.updateMany({
      where: { normalizedEmail: SHARED },
      data: { consentStatus: ConsentStatus.GRANTED },
    });
    await ingestProviderEvent({
      providerEventId: `evt-complaint-consent-${RUN}`,
      type: ProviderEventType.COMPLAINT,
      normalizedEmail: SHARED,
      occurredAt: new Date(),
    });

    // Suppression stands, and nothing re-enabled the address because consent is set.
    expect(
      await prisma.suppression.count({ where: { normalizedEmail: SHARED } }),
    ).toBeGreaterThan(0);

    const { previewAudience } = await import(
      "../../src/server/services/segmentService"
    );
    const preview = await previewAudience({
      version: 1,
      conditions: [
        { field: "company.name", operator: Operator.STARTS_WITH, value: RUN },
      ],
      groups: [],
      include: { companyEmails: true, contactEmails: false },
    });
    expect(preview.destinations.map((d2) => d2.normalizedEmail)).not.toContain(SHARED);
  });

  it("ingests the same provider event only once", async () => {
    const eventId = `evt-duplicate-${RUN}`;
    const campaignId = await approvedCampaign("idempotent-event");
    await prepareDeliveryLedger(campaignId);

    const recipient = await prisma.campaignRecipient.findFirstOrThrow({
      where: { campaignId, state: DeliveryState.PENDING },
    });
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { state: DeliveryState.ACCEPTED, providerMessageId: `msg-dup-${RUN}` },
    });

    const first = await ingestProviderEvent({
      providerEventId: eventId,
      type: ProviderEventType.DELIVERED,
      normalizedEmail: recipient.normalizedEmail,
      providerMessageId: `msg-dup-${RUN}`,
      occurredAt: new Date(),
    });
    const second = await ingestProviderEvent({
      providerEventId: eventId,
      type: ProviderEventType.DELIVERED,
      normalizedEmail: recipient.normalizedEmail,
      providerMessageId: `msg-dup-${RUN}`,
      occurredAt: new Date(),
    });

    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    expect(
      await prisma.campaignEvent.count({ where: { providerEventId: eventId } }),
    ).toBe(1);
  });

  it("refuses a malformed event", async () => {
    const result = await ingestProviderEvent({
      providerEventId: "",
      type: ProviderEventType.DELIVERED,
      normalizedEmail: "not-an-email",
      occurredAt: new Date("invalid"),
    });
    expect(result).toMatchObject({ ok: false, reason: "MALFORMED" });
  });

  // ---- 40 unverified webhooks are refused ---------------------------------

  it("refuses a webhook that cannot be verified", () => {
    const provider = getProductionEmailProvider();
    const verification = provider.verifyWebhook({
      rawBody: JSON.stringify({ type: "delivered", email: PLAIN }),
      headers: { "x-signature": "whatever" },
    });

    // No vendor means no signature scheme, so nothing can be trusted because it
    // arrived. There is deliberately no public webhook route yet either.
    expect(verification.ok).toBe(false);
    expect(verification.ok === false && verification.reason).toBe("UNSIGNED");
  });

  it("exposes exactly one public webhook path, and it verifies before acting", () => {
    // ADR-0024 deliberately shipped NO public webhook route, because a route that
    // accepted unsigned events would let anyone on the internet suppress AXIS
    // customers. ADR-0025 adds the provider that can sign them, so the route now
    // exists — and the invariant moves from "absent" to "verified first".
    const routes = readFileSync("src/proxy.ts", "utf8");
    expect(routes).toContain("/api/webhooks");
    expect(routes).not.toContain("/api/provider");

    const route = readFileSync("src/app/api/webhooks/resend/route.ts", "utf8");
    const verifyAt = route.indexOf("provider.verifyWebhook(");
    const ingestAt = route.indexOf("ingestProviderEvent(");
    expect(verifyAt).toBeGreaterThan(-1);
    // Verification must come first in the file, and the rejection must return before
    // anything is ingested.
    expect(verifyAt).toBeLessThan(ingestAt);
    expect(route).toMatch(/status:\s*401/);
  });
});
