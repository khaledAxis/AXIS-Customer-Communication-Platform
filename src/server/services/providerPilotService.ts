import "server-only";

import { randomUUID } from "node:crypto";

import {
  deliverableImageUrl,
  renderNewsletterHtml,
  renderNewsletterText,
} from "../../domain/email/newsletterTemplate";
import {
  AUTHORIZED_PILOT_RECIPIENT,
  PILOT_BLOCKER_MESSAGE,
  PRODUCTION_SENDER_EMAIL,
  PRODUCTION_SENDER_NAME,
  applyPilotSubjectPrefix,
  assertSafePilotEnvelope,
  evaluatePilotAvailability,
  type PilotBlocker,
} from "../../domain/delivery/pilotPolicy";
import {
  APPROVAL_REJECTION_MESSAGE,
  checkApproval,
  computeApprovalHash,
  type ApprovalRejection,
} from "../../domain/send/testEmailApproval";
import { assertValidReplyTo } from "../../domain/send/replyTo";
import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";
import {
  getProductionEmailProvider,
  productionSendingDomain,
  providerPilotEnabled,
} from "../integrations/email";
import { readStoredDomainStatus } from "./emailInfrastructureService";
import { getNewsletter, previewDocument } from "./newsletterService";

/**
 * The internal PROVIDER PILOT (ADR-0025).
 *
 * One email, through the PRODUCTION transport (Resend, as newsletter@axis-gps.com), to
 * ONE hard-coded internal address. Its entire purpose is to answer a question that no
 * amount of configuration can: does an authenticated AXIS domain actually land in an
 * inbox, and does the unsubscribe link work when a real recipient clicks it?
 *
 * It is NOT production sending and cannot become it:
 *
 *  - the recipient is a constant, re-checked in the service AND again in the adapter;
 *  - no audience is resolved, no segment is read, no `CampaignRecipient` is written;
 *  - `PROVIDER_PILOT_ENABLED` gates it, and it is a separate switch from
 *    `PRODUCTION_DELIVERY_ENABLED` — turning the pilot on grants nothing else;
 *  - the approval is bound to a hash of the exact message and is single-use.
 *
 * Channel separation is absolute: this service NEVER calls `getEmailProvider()` (Gmail),
 * and `testSendService` never calls `getProductionEmailProvider()`. The two channels
 * share the approval tables and nothing else.
 */

// ---------------------------------------------------------------------------
// Rendering the exact pilot message
// ---------------------------------------------------------------------------

export interface RenderedPilotEmail {
  campaignId: string;
  /** Includes the one-time [AXIS PROVIDER PILOT] marker. */
  subject: string;
  preheader: string | null;
  html: string;
  text: string;
  contentItemIds: string[];
  fromEmail: string;
  senderName: string;
  replyToEmail: string;
  toEmail: string;
  sendMode: string;
  contentHash: string;
  omittedImageCount: number;
}

type CampaignWithContent = NonNullable<Awaited<ReturnType<typeof getNewsletter>>>;

function renderFor(campaign: CampaignWithContent): RenderedPilotEmail {
  // The SAME renderer and the SAME document the preview page uses. A pilot that
  // rendered differently would prove something about a message nobody reviewed.
  const document = previewDocument(campaign);

  const base = {
    campaignId: campaign.id,
    // Marked so it can never be mistaken for a customer newsletter, in the inbox or
    // in the audit trail.
    subject: applyPilotSubjectPrefix(document.subject),
    preheader: document.preheader ?? null,
    html: renderNewsletterHtml(document),
    text: renderNewsletterText(document),
    contentItemIds: campaign.contentLinks
      .filter((link) => link.isIncluded)
      .map((link) => link.contentItemId),
    // Sender and reply address are configuration, never message fields. Nothing a
    // caller supplies reaches them.
    fromEmail: PRODUCTION_SENDER_EMAIL,
    senderName: PRODUCTION_SENDER_NAME,
    replyToEmail: assertValidReplyTo(process.env.NEWSLETTER_REPLY_TO),
    toEmail: AUTHORIZED_PILOT_RECIPIENT,
    sendMode: campaign.sendMode,
  };

  const omittedImageCount = campaign.contentLinks.filter(
    (link) =>
      link.isIncluded &&
      link.contentItem.imageUrl != null &&
      link.contentItem.imageUrl.trim() !== "" &&
      deliverableImageUrl(link.contentItem.imageUrl, document.brand.baseUrl) === null,
  ).length;

  return {
    ...base,
    // Same hash function as the SAFE TEST channel, over a payload that includes the
    // production sender — so a Gmail approval's hash can never match a pilot message.
    contentHash: computeApprovalHash(base),
    omittedImageCount,
  };
}

export async function renderPilotEmail(
  campaignId: string,
): Promise<RenderedPilotEmail | null> {
  const campaign = await getNewsletter(campaignId);
  if (!campaign) return null;
  return renderFor(campaign);
}

// ---------------------------------------------------------------------------
// Status — never opens a connection
// ---------------------------------------------------------------------------

export interface PilotStatus {
  canApprove: boolean;
  canSend: boolean;
  message: string;
  blockers: PilotBlocker[];
  providerName: string;
  providerConfigured: boolean;
  providerProblems: string[];
  pilotModeEnabled: boolean;
  domainVerified: boolean;
  domain: string;
  fromEmail: string;
  senderName: string;
  replyToEmail: string;
  toEmail: string;
  subject: string;
  omittedImageCount: number;
  approval: {
    id: string;
    approvedAt: Date;
    approvedByEmail: string | null;
    valid: boolean;
    reason?: ApprovalRejection;
  } | null;
  lastAttempt: {
    state: string;
    attemptedAt: Date | null;
    acceptedAt: Date | null;
    providerMessageId: string | null;
    message: string | null;
    failureCode: string | null;
  } | null;
}

/** Most recent PROVIDER PILOT approval. Scoped to the channel, never shared. */
async function latestPilotApproval(campaignId: string) {
  return getPrisma().campaignTestApproval.findFirst({
    where: { campaignId, channel: "PROVIDER_PILOT" },
    orderBy: [{ approvedAt: "desc" }],
    include: { approvedBy: { select: { email: true } } },
  });
}

export async function getPilotStatus(campaignId: string): Promise<PilotStatus | null> {
  const campaign = await getNewsletter(campaignId);
  if (!campaign) return null;

  const rendered = renderFor(campaign);
  const domainName = productionSendingDomain();
  const stored = await readStoredDomainStatus(domainName);
  const provider = getProductionEmailProvider(stored.status);
  const configuration = provider.checkConfiguration();

  const availability = evaluatePilotAvailability({
    providerConfigured: configuration.configured,
    pilotModeEnabled: providerPilotEnabled(),
    domainVerified: stored.status.verified,
    hasContent: rendered.contentItemIds.length > 0,
  });

  const approval = await latestPilotApproval(campaignId);
  const check = checkApproval(
    approval
      ? {
          id: approval.id,
          contentHash: approval.contentHash,
          fromEmail: approval.fromEmail,
          toEmail: approval.toEmail,
          replyToEmail: approval.replyToEmail,
          sendMode: approval.sendMode,
          consumedAt: approval.consumedAt,
          revokedAt: approval.revokedAt,
        }
      : null,
    rendered.contentHash,
    {
      fromEmail: rendered.fromEmail,
      toEmail: rendered.toEmail,
      replyToEmail: rendered.replyToEmail,
    },
  );

  const lastSend = await getPrisma().campaignTestSend.findFirst({
    where: { campaignId, channel: "PROVIDER_PILOT" },
    orderBy: [{ createdAt: "desc" }],
  });

  // Approving is allowed as soon as there is a real message to approve, even while the
  // domain is still propagating — reviewing the message is not sending it.
  const canApprove = rendered.contentItemIds.length > 0;
  const canSend = availability.available && check.valid;

  const message = !canApprove
    ? PILOT_BLOCKER_MESSAGE.NO_CONTENT
    : !availability.available
      ? availability.messages[0]
      : !check.valid
        ? APPROVAL_REJECTION_MESSAGE[check.reason ?? "NO_APPROVAL"]
        : "Ready. One internal pilot email will be sent to " +
          `${AUTHORIZED_PILOT_RECIPIENT} — and to no one else.`;

  return {
    canApprove,
    canSend,
    message,
    blockers: availability.blockers,
    providerName: configuration.name,
    providerConfigured: configuration.configured,
    providerProblems: configuration.problems,
    pilotModeEnabled: providerPilotEnabled(),
    domainVerified: stored.status.verified,
    domain: domainName,
    fromEmail: rendered.fromEmail,
    senderName: rendered.senderName,
    replyToEmail: rendered.replyToEmail,
    toEmail: rendered.toEmail,
    subject: rendered.subject,
    omittedImageCount: rendered.omittedImageCount,
    approval: approval
      ? {
          id: approval.id,
          approvedAt: approval.approvedAt,
          approvedByEmail: approval.approvedBy?.email ?? null,
          valid: check.valid,
          reason: check.reason,
        }
      : null,
    lastAttempt: lastSend
      ? {
          state: lastSend.state,
          attemptedAt: lastSend.attemptedAt,
          acceptedAt: lastSend.acceptedAt,
          providerMessageId: lastSend.providerMessageId,
          message: lastSend.failureReason,
          failureCode: lastSend.failureCode,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

export type PilotResult =
  | { ok: true; message: string; state?: string }
  | { ok: false; message: string; reason: string };

export async function approvePilotSend(campaignId: string): Promise<PilotResult> {
  const campaign = await getNewsletter(campaignId);
  if (!campaign) {
    return { ok: false, reason: "NOT_FOUND", message: "That newsletter no longer exists." };
  }

  const rendered = renderFor(campaign);
  if (rendered.contentItemIds.length === 0) {
    return {
      ok: false,
      reason: "NO_CONTENT",
      message: PILOT_BLOCKER_MESSAGE.NO_CONTENT,
    };
  }

  const approvedById = (await requireCapability(Capability.SEND_TEST_EMAIL)).id;
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    // Only pilot approvals are superseded; a live Gmail SAFE TEST approval is a
    // different channel and is left alone.
    await tx.campaignTestApproval.updateMany({
      where: {
        campaignId,
        channel: "PROVIDER_PILOT",
        consumedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    const approval = await tx.campaignTestApproval.create({
      data: {
        campaignId,
        channel: "PROVIDER_PILOT",
        contentHash: rendered.contentHash,
        subjectSnapshot: rendered.subject,
        preheaderSnapshot: rendered.preheader,
        fromEmail: rendered.fromEmail,
        senderName: rendered.senderName,
        replyToEmail: rendered.replyToEmail,
        toEmail: rendered.toEmail,
        sendMode: campaign.sendMode,
        approvedById,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "PROVIDER_PILOT_APPROVED",
        actorUserId: approvedById,
        entityType: "Campaign",
        entityId: campaignId,
        toState: "APPROVED_FOR_PILOT",
        metadata: {
          approvalId: approval.id,
          contentHash: rendered.contentHash,
          channel: "PROVIDER_PILOT",
          fromEmail: rendered.fromEmail,
          replyToEmail: rendered.replyToEmail,
          toEmail: rendered.toEmail,
        },
      },
    });
  });

  return {
    ok: true,
    message: `Approved for ONE provider pilot to ${AUTHORIZED_PILOT_RECIPIENT}.`,
  };
}

export async function revokePilotApprovals(campaignId: string): Promise<PilotResult> {
  await getPrisma().campaignTestApproval.updateMany({
    where: {
      campaignId,
      channel: "PROVIDER_PILOT",
      consumedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return { ok: true, message: "Pilot approval withdrawn." };
}

// ---------------------------------------------------------------------------
// Send — one approval authorizes at most one provider submission
// ---------------------------------------------------------------------------

/**
 * Submits the approved pilot. Triggered by a human pressing a button; there is no
 * scheduler, no worker and no automated caller anywhere in the codebase.
 */
export async function sendApprovedPilotEmail(campaignId: string): Promise<PilotResult> {
  const prisma = getPrisma();

  const campaign = await getNewsletter(campaignId);
  if (!campaign) {
    return { ok: false, reason: "NOT_FOUND", message: "That newsletter no longer exists." };
  }

  // Re-render and re-hash NOW. Never trust a client-supplied "approved".
  const rendered = renderFor(campaign);

  const domainName = productionSendingDomain();
  const stored = await readStoredDomainStatus(domainName);
  const provider = getProductionEmailProvider(stored.status);
  const configuration = provider.checkConfiguration();

  const availability = evaluatePilotAvailability({
    providerConfigured: configuration.configured,
    pilotModeEnabled: providerPilotEnabled(),
    domainVerified: stored.status.verified,
    hasContent: rendered.contentItemIds.length > 0,
  });
  if (!availability.available) {
    return {
      ok: false,
      reason: availability.blockers[0],
      message: availability.messages[0],
    };
  }

  const approval = await latestPilotApproval(campaignId);
  const check = checkApproval(
    approval
      ? {
          id: approval.id,
          contentHash: approval.contentHash,
          fromEmail: approval.fromEmail,
          toEmail: approval.toEmail,
          replyToEmail: approval.replyToEmail,
          sendMode: approval.sendMode,
          consumedAt: approval.consumedAt,
          revokedAt: approval.revokedAt,
        }
      : null,
    rendered.contentHash,
    {
      fromEmail: rendered.fromEmail,
      toEmail: rendered.toEmail,
      replyToEmail: rendered.replyToEmail,
    },
  );
  if (!check.valid || !approval) {
    const reason = check.reason ?? "NO_APPROVAL";
    return { ok: false, reason, message: APPROVAL_REJECTION_MESSAGE[reason] };
  }

  // Server-side envelope guard, independent of the UI and of the adapter's own.
  const toEmail = assertSafePilotEnvelope({
    to: rendered.toEmail,
    from: rendered.fromEmail,
  });

  const idempotencyKey = randomUUID();
  const requestedById = (await requireCapability(Capability.SEND_TEST_EMAIL)).id;

  // ---- Claim the approval and write the attempt BEFORE the provider call. The UNIQUE
  // `approvalId` means a double-click loses at the database, not at Resend.
  let attemptId: string;
  try {
    attemptId = await prisma.$transaction(async (tx) => {
      const claimed = await tx.campaignTestApproval.updateMany({
        where: { id: approval.id, consumedAt: null, revokedAt: null },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("APPROVAL_ALREADY_CONSUMED");

      const attempt = await tx.campaignTestSend.create({
        data: {
          campaignId,
          channel: "PROVIDER_PILOT",
          requestedById,
          approvalId: approval.id,
          idempotencyKey,
          fromEmail: rendered.fromEmail,
          senderName: rendered.senderName,
          replyToEmail: rendered.replyToEmail,
          toEmail,
          subjectSnapshot: rendered.subject,
          contentHash: rendered.contentHash,
          provider: "RESEND",
          state: "SENDING",
          attemptedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          action: "PROVIDER_PILOT_ATTEMPTED",
          actorUserId: requestedById,
          entityType: "Campaign",
          entityId: campaignId,
          toState: "SENDING",
          metadata: {
            testSendId: attempt.id,
            approvalId: approval.id,
            channel: "PROVIDER_PILOT",
            provider: "RESEND",
            contentHash: rendered.contentHash,
            fromEmail: rendered.fromEmail,
            replyToEmail: rendered.replyToEmail,
            toEmail,
            domain: domainName,
          },
        },
      });

      return attempt.id;
    });
  } catch {
    return {
      ok: false,
      reason: "ALREADY_USED",
      message: APPROVAL_REJECTION_MESSAGE.ALREADY_USED,
    };
  }

  // ---- Submit exactly once, through the PRODUCTION port. Never Gmail.
  const result = await provider.send({
    to: toEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey,
  });

  const state =
    result.outcome === "ACCEPTED"
      ? "ACCEPTED"
      : result.outcome === "UNCERTAIN"
        ? "UNCERTAIN"
        : "FAILED";

  await prisma.campaignTestSend.update({
    where: { id: attemptId },
    data: {
      state,
      providerStatusCode: result.statusCode ?? null,
      providerMessageId: result.providerMessageId ?? null,
      failureCode: result.failureCode ?? null,
      failureReason: result.message ?? null,
      acceptedAt: result.outcome === "ACCEPTED" ? new Date() : null,
    },
  });

  if (result.outcome === "ACCEPTED") {
    return {
      ok: true,
      state,
      // Accepted, not delivered. The delivery webhook is what proves the second.
      message:
        result.message ?? "Resend accepted the pilot email for delivery.",
    };
  }

  if (result.outcome === "UNCERTAIN") {
    // Never auto-retried, and the approval stays consumed: re-submitting could
    // duplicate a message Resend may already have accepted.
    return {
      ok: false,
      reason: "UNCERTAIN",
      message:
        result.message ??
        "We could not confirm whether Resend accepted the email. Check the Resend dashboard before approving another pilot.",
    };
  }

  return {
    ok: false,
    reason: result.failureCode ?? "PROVIDER_FAILED",
    message: result.message ?? "Resend could not accept the email.",
  };
}
