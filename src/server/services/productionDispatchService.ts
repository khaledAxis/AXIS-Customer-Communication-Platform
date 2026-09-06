import "server-only";
import { createHash } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import type { Prisma } from "@prisma/client";
import { Capability, requireCapability } from "../auth/session";
import { can } from "../../domain/auth/authorization";
import { assertCampaignTransition, type CampaignState } from "../../domain/campaign/lifecycle";
import { computeProductionApprovalHash } from "../../domain/campaign/productionApproval";
import { decideDispatch, assertTransition, DeliveryState } from "../../domain/delivery/dispatchPolicy";
import { PRODUCTION_SENDER_EMAIL } from "../../domain/delivery/pilotPolicy";
import { ConsentStatus, EmailStatus, Language } from "../../domain/types";
import { deliveryConfirmation } from "../../domain/jobs/policy";
import { renderNewsletterHtml, renderNewsletterText, type NewsletterDocument } from "../../domain/email/newsletterTemplate";
import { getPrisma } from "../db/prisma";
import { loadAddressFacts } from "../db/repositories/audienceRepository";
import { computeAudienceWatermark } from "../db/repositories/audienceWatermark";
import { getProductionEmailProvider, productionDeliveryEnabled, productionSendingDomain } from "../integrations/email";
import { getSenderIdentity } from "../integrations/email/senderIdentity";
import { currentJob } from "../jobs/context";
import { getSendReadiness, renderProduction } from "./sendReadinessService";
import { buildNewsletterDocument, getNewsletter } from "./newsletterService";
import { prepareDeliveryLedger, DeliveryError, type DispatchRunResult } from "./deliveryService";
import { checkPublicUnsubscribeReadiness } from "./publicUrlConfig";
import { readStoredDomainStatus } from "./emailInfrastructureService";
import { resolveAudienceForDefinition } from "./segmentService";
import { issueUnsubscribeLink } from "./unsubscribeService";

interface FrozenDelivery {
  version: 1;
  document: NewsletterDocument;
  contentItemIds: string[];
  imageUrls: string[];
}

export async function getCustomerReleaseStatus() {
  const snapshot = await readStoredDomainStatus(productionSendingDomain());
  const provider = getProductionEmailProvider(snapshot.status);
  const configuration = provider.checkConfiguration();
  const blockers: string[] = [];
  if (process.env.SCHEDULER_ENABLED !== "true") {
    blockers.push("The scheduler must be enabled and actively checking for work.");
  } else {
    // A long-running dev process may retain a client generated before this model
    // existed. Missing migrations and unavailable storage also block release; they
    // must never become an undefined-delegate crash or a successful readiness check.
    const heartbeatStore = getPrisma().schedulerHeartbeat;
    if (typeof heartbeatStore?.findUnique !== "function") {
      blockers.push("The server database client is outdated. Ask the administrator to regenerate Prisma and restart the application.");
    } else {
      try {
        const heartbeat = await heartbeatStore.findUnique({ where: { id: "scheduler" } });
        if (!heartbeat || Date.now() - heartbeat.lastTickAt.getTime() > 120000)
          blockers.push("The scheduler must be enabled and actively checking for work.");
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        blockers.push(code === "P2021" || code === "P2022"
          ? "The scheduler database upgrade is pending. Ask the administrator to apply the release migrations and restart the application."
          : "The scheduler status could not be checked. Customer delivery remains blocked until database access recovers.");
      }
    }
  }
  if (!productionDeliveryEnabled() || process.env.SEND_MODE !== "PRODUCTION" || process.env.AXIS_DELIVERY_RELEASE_APPROVED !== "true")
    blockers.push("Customer delivery is disabled in the server configuration.");
  if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test")
    blockers.push("Customer delivery is unavailable in a development process.");
  if (!configuration.configured || !configuration.enabled || !provider.sendCustomer)
    blockers.push("The customer email provider is not configured.");
  if (snapshot.status.spf !== "VERIFIED" || snapshot.status.dkim !== "VERIFIED" ||
    !snapshot.checkedAt || Date.now() - snapshot.checkedAt.getTime() > 86400000)
    blockers.push("Refresh and verify the sending domain's SPF and DKIM status.");
  // This is an operator attestation, never a claim that the provider verified DMARC.
  if (process.env.PRODUCTION_DOMAIN_REVIEW_CONFIRMED !== "true")
    blockers.push("An infrastructure operator must confirm the domain and DMARC review.");
  if (!checkPublicUnsubscribeReadiness().productionReady || !(process.env.RESEND_WEBHOOK_SECRET ?? "").startsWith("whsec_"))
    blockers.push("Public unsubscribe and verified provider webhooks must be configured.");
  return { enabled: blockers.length === 0, blockers };
}

async function transition(tx: Prisma.TransactionClient, campaignId: string, from: CampaignState,
  to: CampaignState, actorUserId: string, action: "CAMPAIGN_SUBMITTED" | "CAMPAIGN_APPROVED" | "CAMPAIGN_SCHEDULED" | "CAMPAIGN_DISPATCHED" | "CAMPAIGN_SENT" | "CAMPAIGN_FAILED" | "CAMPAIGN_CANCELED") {
  assertCampaignTransition(from, to);
  const changed = await tx.campaign.updateMany({ where: { id: campaignId, status: from }, data: { status: to } });
  if (changed.count !== 1) throw new DeliveryError("The newsletter state changed. Reload before continuing.");
  await tx.auditLog.create({ data: { action, actorUserId, entityType: "Campaign", entityId: campaignId, fromState: from, toState: to } });
}

function hashFrozen(campaignId: string, frozen: FrozenDelivery, finalAudienceId: string, audienceHash: string) {
  const identity = getSenderIdentity();
  return computeProductionApprovalHash({ campaignId, subject: frozen.document.subject,
    preheader: frozen.document.preheader ?? null, html: renderNewsletterHtml(frozen.document), text: renderNewsletterText(frozen.document),
    contentItemIds: frozen.contentItemIds, imageUrls: frozen.imageUrls, campaignLanguage: frozen.document.language,
    senderEmail: PRODUCTION_SENDER_EMAIL, senderName: identity.senderName, replyToEmail: identity.replyToEmail, finalAudienceId, audienceHash });
}

/** Explicit staff confirmation authorizes only the latest approved final audience. No address parameter. */
export async function scheduleCustomerDelivery(campaignId: string, confirmation: string, scheduledAt: Date) {
  const actor = await requireCapability(Capability.APPROVE_PRODUCTION);
  if (currentJob()) throw new DeliveryError("Scheduling requires a signed-in staff confirmation.");
  const release = await getCustomerReleaseStatus();
  if (!release.enabled) throw new DeliveryError(release.blockers[0]);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() - 60000 || scheduledAt.getTime() > Date.now() + 90 * 86400000)
    throw new DeliveryError("Choose a delivery time within the next 90 days.");
  const readiness = await getSendReadiness(campaignId);
  if (!readiness?.finalAudience || !readiness.approval?.valid || !readiness.fourEyes.satisfied || !readiness.preparationComplete)
    throw new DeliveryError("Prepare and approve the current newsletter and final audience before scheduling.");
  if (readiness.finalAudience.destinationsTruncated) throw new DeliveryError("A truncated audience cannot be sent.");
  // UNKNOWN remains a planning warning, but does not authorize actual customer delivery.
  if (readiness.finalAudience.consentNotConfirmed > 0)
    throw new DeliveryError("Confirm consent for every intended recipient before a real customer send.");
  const count = readiness.finalAudience.uniqueDestinations;
  if (count < 1) throw new DeliveryError("A customer delivery needs at least one eligible recipient.");
  if (confirmation !== deliveryConfirmation(count)) throw new DeliveryError(`Type ${deliveryConfirmation(count)} to confirm this audience.`);
  await prepareDeliveryLedger(campaignId);
  const prisma = getPrisma();
  const campaign = await getNewsletter(campaignId);
  if (!campaign || campaign.status !== "DRAFT") throw new DeliveryError("Only an approved draft can be scheduled. Duplicate a completed newsletter to send again.");
  const document = { ...buildNewsletterDocument(campaign), isTestMode: false };
  const rendered = renderProduction(campaign);
  const frozen: FrozenDelivery = { version: 1, document, contentItemIds: rendered.contentItemIds, imageUrls: rendered.imageUrls };
  const watermark = await computeAudienceWatermark(prisma, campaignId);
  const approvalId = readiness.approval.id;
  const audienceId = readiness.finalAudience.id;
  const job = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${campaignId} FOR UPDATE`;
    const approval = await tx.campaignProductionApproval.findUnique({ where: { id: approvalId }, include: { approvedBy: true } });
    const latestAudience = await tx.campaignFinalAudience.findFirst({ where: { campaignId }, orderBy: { createdAt: "desc" } });
    const latest = await tx.campaign.findUnique({ where: { id: campaignId }, include: {
      contentLinks: { orderBy: { position: "asc" }, include: { contentItem: { include: { source: { select: { name: true } } } } } },
      creator: { select: { id: true, email: true, name: true, isSystemAccount: true } },
      _count: { select: { recipients: true, events: true, testSends: true } },
    } });
    if (!approval || approval.revokedAt || !latest || latest.status !== "DRAFT" || latestAudience?.id !== audienceId ||
      !can(approval.approvedBy, Capability.APPROVE_PRODUCTION) || approval.approvedById === latest.createdById ||
      hashFrozen(campaignId, frozen, audienceId, latestAudience.audienceHash) !== approval.contentHash ||
      renderProduction(latest).html !== rendered.html || renderProduction(latest).text !== rendered.text ||
      await computeAudienceWatermark(tx, campaignId) !== watermark)
      throw new DeliveryError("Newsletter, approval or audience changed. Review again before scheduling.");
    const wrongLedger = await tx.campaignRecipient.count({ where: { campaignId, OR: [
      { finalAudienceId: { not: audienceId } }, { attemptCount: { gt: 0 } },
    ] } });
    if (wrongLedger) throw new DeliveryError("Existing delivery records belong to another audience or submission. Duplicate this newsletter for a new send.");
    await transition(tx, campaignId, "DRAFT", "PENDING_APPROVAL", actor.id, "CAMPAIGN_SUBMITTED");
    await transition(tx, campaignId, "PENDING_APPROVAL", "APPROVED", approval.approvedById, "CAMPAIGN_APPROVED");
    await transition(tx, campaignId, "APPROVED", "SCHEDULED", actor.id, "CAMPAIGN_SCHEDULED");
    await tx.campaign.update({ where: { id: campaignId }, data: {
      dispatchDocument: frozen as unknown as Prisma.InputJsonValue, dispatchApprovalId: approvalId,
      deliveryConfirmedCount: count, scheduledAt, approvedAt: approval.approvedAt, approvedById: approval.approvedById,
      sendMode: "PRODUCTION", snapshotSubject: document.subject, snapshotPreheader: document.preheader,
      snapshotBodyHtml: rendered.html, snapshotBodyText: rendered.text, snapshotAt: new Date(),
    } });
    await tx.auditLog.create({ data: { action: "SEND_MODE_CHANGED", actorUserId: actor.id, entityType: "Campaign", entityId: campaignId,
      fromState: campaign.sendMode, toState: "PRODUCTION", metadata: { confirmedCount: count, approvalId, finalAudienceId: audienceId } } });
    return tx.backgroundJob.create({ data: { uniqueKey: `dispatch:${campaignId}`, kind: "DISPATCH", resourceId: campaignId,
      actorUserId: actor.id, scheduledFor: scheduledAt, availableAt: scheduledAt } });
  }, { isolationLevel: "Serializable", timeout: 15000 });
  return { jobId: job.id, count, scheduledAt };
}

async function providerSlot(): Promise<boolean> {
  const rows = await getPrisma().$queryRaw<{ key: string }[]>`
    INSERT INTO "ProviderRateLimit" (key, "nextAvailableAt", "createdAt", "updatedAt")
    VALUES ('resend-customer', NOW() + INTERVAL '550 milliseconds', NOW(), NOW())
    ON CONFLICT (key) DO UPDATE SET "nextAvailableAt"=NOW()+INTERVAL '550 milliseconds', "updatedAt"=NOW()
    WHERE "ProviderRateLimit"."nextAvailableAt" <= NOW() RETURNING key`;
  return rows.length === 1;
}

/** Bounded worker batch. Every recipient is claimed before I/O and is attempted at most once. */
export async function executeCustomerDispatch(campaignId: string): Promise<DispatchRunResult> {
  const actor = await requireCapability(Capability.APPROVE_PRODUCTION);
  const blocked = (message: string): DispatchRunResult => ({ ok: false, reason: "NOT_APPROVED", message, submitted: 0, providerCalls: 0 });
  const release = await getCustomerReleaseStatus();
  if (!release.enabled) return blocked(release.blockers[0]);
  const prisma = getPrisma();
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { segment: true } });
  if (!campaign?.dispatchDocument || !campaign.dispatchApprovalId || !["SCHEDULED", "SENDING"].includes(campaign.status))
    return blocked("No confirmed, scheduled delivery exists for this newsletter.");
  if (!campaign.scheduledAt || campaign.scheduledAt.getTime() > Date.now()) return blocked("The delivery time has not arrived.");
  if (campaign.status === "SCHEDULED" && Date.now() - campaign.scheduledAt.getTime() > 300000)
    return blocked("The delivery window was missed. Review and explicitly reschedule; late sends are not automatic.");
  const frozen = campaign.dispatchDocument as unknown as FrozenDelivery;
  const approval = await prisma.campaignProductionApproval.findUnique({ where: { id: campaign.dispatchApprovalId }, include: { approvedBy: true, finalAudience: true } });
  if (!approval || approval.revokedAt || !approval.authenticatedActor || !can(approval.approvedBy, Capability.APPROVE_PRODUCTION) ||
      approval.approvedById === campaign.createdById || frozen.version !== 1 || frozen.document.isTestMode ||
      hashFrozen(campaignId, frozen, approval.finalAudienceId, approval.audienceHash) !== approval.contentHash || !campaign.segment)
    return blocked("Approval or sender identity is no longer valid.");
  if (await prisma.contentItem.count({ where: { id: { in: frozen.contentItemIds }, origin: "INGESTED", reviewState: { not: "APPROVED" } } }))
    return blocked("An included external article is no longer approved for use.");
  if (campaign.status === "SCHEDULED") await prisma.$transaction(tx => transition(tx, campaignId, "SCHEDULED", "SENDING", actor.id, "CAMPAIGN_DISPATCHED"));
  const rows = await prisma.campaignRecipient.findMany({ where: { campaignId, finalAudienceId: approval.finalAudienceId,
    state: { in: ["PENDING", "READY"] }, attemptCount: 0 }, orderBy: { normalizedEmail: "asc" }, take: 20 });
  let submitted = 0; let vetoed = 0; let providerCalls = 0;
  const provider = getProductionEmailProvider();
  for (const recipient of rows) {
    if (!await providerSlot()) { await pause(550); if (!await providerSlot()) break; }
    const unsubscribe = await issueUnsubscribeLink({ normalizedEmail: recipient.normalizedEmail, campaignId,
      communicationAddressId: recipient.communicationAddressId });
    if (!unsubscribe.url) throw new DeliveryError("Public unsubscribe unavailable.");
    await requireCapability(Capability.APPROVE_PRODUCTION); // includes fresh job lease and actor status
    if (!productionDeliveryEnabled() || process.env.SEND_MODE !== "PRODUCTION" || process.env.AXIS_DELIVERY_RELEASE_APPROVED !== "true") break;
    const activeApproval = await prisma.campaignProductionApproval.findUnique({ where: { id: approval.id }, include: { approvedBy: true } });
    if (!activeApproval || activeApproval.revokedAt || !can(activeApproval.approvedBy, Capability.APPROVE_PRODUCTION)) break;
    const currentSegment = await prisma.segment.findUnique({ where: { id: campaign.segmentId! }, select: { criteria: true, isActive: true } });
    if (!currentSegment?.isActive) break;
    // Reuse the canonical CRM matching + eligibility path, narrowed by an indexed
    // address lookup. Changes during a batch (archive, industry, linked company,
    // segment rules) are seen without loading the whole CRM for every recipient.
    const eligibleNow = await resolveAudienceForDefinition(currentSegment.criteria, {
      requireLanguage: campaign.language as Language, requireExplicitConsent: true,
    }, [recipient.normalizedEmail]);
    const live = (await loadAddressFacts(prisma, [recipient.normalizedEmail])).get(recipient.normalizedEmail);
    const decision = decideDispatch({ facts: {
      isUnsubscribed: live?.isUnsubscribed ?? false, isSuppressed: live?.isSuppressed ?? false,
      emailStatus: (live?.emailStatus as EmailStatus) ?? EmailStatus.UNKNOWN,
      language: (live?.language as Language) ?? Language.UNKNOWN,
      consentStatus: (live?.consentStatus as ConsentStatus) ?? ConsentStatus.UNKNOWN,
    }, requireLanguage: campaign.language as Language, requireExplicitConsent: true });
    if (!decision.send || !eligibleNow.result.recipients.some(row => row.normalizedEmail === recipient.normalizedEmail)) {
      assertTransition(recipient.state as DeliveryState, DeliveryState.SUPPRESSED);
      const changed = await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, state: recipient.state, attemptCount: 0 },
        data: { state: "SUPPRESSED", vetoReason: decision.send ? eligibleNow.result.exclusions[0]?.reason ?? null : decision.reason,
          failureReason: decision.send ? "No eligible CRM source matches this approved destination." : null } });
      vetoed += changed.count; continue;
    }
    const claimed = await prisma.$transaction(async tx => {
      if (recipient.state === "PENDING") {
        assertTransition("PENDING", "READY");
        const changed = await tx.campaignRecipient.updateMany({ where: { id: recipient.id, state: "PENDING", attemptCount: 0 }, data: { state: "READY" } });
        if (!changed.count) return false;
      }
      assertTransition("READY", "SENDING");
      return (await tx.campaignRecipient.updateMany({ where: { id: recipient.id, state: "READY", attemptCount: 0 },
        data: { state: "SENDING", attemptCount: 1, firstAttemptAt: new Date(), lastAttemptAt: new Date(), claimedAt: new Date() } })).count === 1;
    });
    if (!claimed) continue;
    try {
      const document = { ...frozen.document, unsubscribeUrl: unsubscribe.url };
      providerCalls++;
      const result = await provider.sendCustomer!({ to: recipient.normalizedEmail, subject: document.subject,
        html: renderNewsletterHtml(document), text: renderNewsletterText(document),
        idempotencyKey: "axis-customer-" + createHash("sha256").update(`${campaignId}:${recipient.normalizedEmail}`).digest("hex") });
      const state = result.outcome === "ACCEPTED" && result.providerMessageId ? "ACCEPTED" : result.outcome === "FAILED" ? "FAILED" : "UNCERTAIN";
      assertTransition("SENDING", state);
      await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, state: "SENDING" }, data: {
        state, providerMessageId: result.providerMessageId ?? null, sentAt: state === "ACCEPTED" ? new Date() : null,
        failureReason: state === "FAILED" ? "Provider refused this submission." : state === "UNCERTAIN" ? "Provider acceptance is uncertain; automatic retry is disabled." : null,
      } });
      if (state === "ACCEPTED") submitted++;
    } catch {
      // Includes a crash/error persisting the response: never turn it into a retryable failure.
      await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, state: "SENDING" },
        data: { state: "UNCERTAIN", failureReason: "Submission outcome requires provider reconciliation." } });
    }
  }
  const { reconcileProviderReceipts } = await import("./providerEventService");
  await reconcileProviderReceipts();
  const remaining = await prisma.campaignRecipient.count({ where: { campaignId, state: { in: ["PENDING", "READY", "SENDING"] } } });
  if (!remaining) {
    const failures = await prisma.campaignRecipient.count({ where: { campaignId, state: { in: ["FAILED", "UNCERTAIN"] } } });
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${campaignId} FOR UPDATE`;
      const current = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { status: true } });
      if (current.status !== "SENDING") return;
      await transition(tx, campaignId, "SENDING", failures ? "FAILED" : "SENT", actor.id, failures ? "CAMPAIGN_FAILED" : "CAMPAIGN_SENT");
      if (!failures) await tx.campaign.update({ where: { id: campaignId }, data: { sentAt: new Date() } });
    });
  }
  return { ok: true, submitted, vetoed, providerCalls, remaining };
}

/** Continue only never-attempted destinations; uncertain rows are permanently excluded. */
export async function resumeCustomerDelivery(campaignId: string, confirmation: string) {
  const actor = await requireCapability(Capability.APPROVE_PRODUCTION);
  if (currentJob()) throw new DeliveryError("A staff confirmation is required.");
  await getPrisma().$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${campaignId} FOR UPDATE`;
    const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    if (campaign.status !== "SENDING" || confirmation !== deliveryConfirmation(campaign.deliveryConfirmedCount ?? 0))
      throw new DeliveryError("Confirm the original audience before continuing the remaining unattempted destinations.");
    const changed = await tx.backgroundJob.updateMany({ where: { uniqueKey: `dispatch:${campaignId}`, state: "ATTENTION" },
      data: { state: "PENDING", actorUserId: actor.id, availableAt: new Date(), errorCode: null } });
    if (!changed.count) throw new DeliveryError("This delivery is not waiting for attention.");
    await tx.auditLog.create({ data: { action: "JOB_CHANGED", actorUserId: actor.id, entityType: "Campaign", entityId: campaignId,
      metadata: { operation: "CONTINUE_UNATTEMPTED_ONLY", confirmedCount: campaign.deliveryConfirmedCount } } });
  });
}

export async function cancelCustomerDelivery(campaignId: string) {
  const actor = await requireCapability(Capability.APPROVE_PRODUCTION);
  if (currentJob()) throw new DeliveryError("Cancellation requires a signed-in staff action.");
  await getPrisma().$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${campaignId} FOR UPDATE`;
    await transition(tx, campaignId, "SCHEDULED", "CANCELED", actor.id, "CAMPAIGN_CANCELED");
    await tx.backgroundJob.updateMany({ where: { uniqueKey: `dispatch:${campaignId}`, state: { in: ["PENDING", "ATTENTION"] } },
      data: { state: "CANCELED" } });
  });
}

export async function rescheduleCustomerDelivery(campaignId: string, confirmation: string, scheduledAt: Date) {
  const actor = await requireCapability(Capability.APPROVE_PRODUCTION);
  if (currentJob()) throw new DeliveryError("Rescheduling requires a signed-in confirmation.");
  const campaign = await getPrisma().campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== "SCHEDULED" || confirmation !== deliveryConfirmation(campaign.deliveryConfirmedCount ?? 0) ||
    !Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() || scheduledAt.getTime() > Date.now() + 90 * 86400000)
    throw new DeliveryError("Only an unstarted delivery with an exact audience confirmation can be rescheduled.");
  await getPrisma().$transaction(async tx => {
    const changed = await tx.backgroundJob.updateMany({ where: { uniqueKey: `dispatch:${campaignId}`, state: "ATTENTION" },
      data: { state: "PENDING", actorUserId: actor.id, scheduledFor: scheduledAt, availableAt: scheduledAt, errorCode: null } });
    if (!changed.count) throw new DeliveryError("This delivery is not waiting for rescheduling.");
    await tx.campaign.update({ where: { id: campaignId, status: "SCHEDULED" }, data: { scheduledAt } });
    await tx.auditLog.create({ data: { action: "CAMPAIGN_SCHEDULED", actorUserId: actor.id, entityType: "Campaign", entityId: campaignId,
      metadata: { rescheduledAt: scheduledAt.toISOString(), confirmedCount: campaign.deliveryConfirmedCount } } });
  });
}
