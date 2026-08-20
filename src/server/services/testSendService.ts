import { randomUUID } from "node:crypto";

import {
  APPROVAL_REJECTION_MESSAGE,
  checkApproval,
  computeApprovalHash,
  type ApprovalRejection,
} from "../../domain/send/testEmailApproval";
import {
  AUTHORIZED_TEST_RECIPIENT,
  AUTHORIZED_TEST_SENDER,
  assertAuthorizedTestSender,
  assertSafeTestEnvelope,
} from "../../domain/send/testSendPolicy";
import {
  deliverableImageUrl,
  renderNewsletterHtml,
  renderNewsletterText,
} from "../../domain/email/newsletterTemplate";
import { getPrisma } from "../db/prisma";
import { getEmailProvider } from "../integrations/email";
import { getSenderIdentity } from "../integrations/email/senderIdentity";
import { getAuthoringUserId, getNewsletter, previewDocument } from "./newsletterService";

/**
 * SAFE TEST send use-cases (ADR-0013, provider switched to Gmail SMTP by ADR-0014).
 *
 * Two separate human actions: approve, then send. The approval is bound to a hash of
 * the exact rendered message and is single-use. At send time the newsletter is
 * re-rendered and re-hashed — a client-supplied "approved" flag is never trusted.
 *
 * Nothing here can reach a customer: sender and recipient are constants, the envelope
 * has no CC/BCC, and the audience never fans out.
 */

// ---------------------------------------------------------------------------
// Rendering the exact message
// ---------------------------------------------------------------------------

export interface RenderedTestEmail {
  campaignId: string;
  /** Final subject including the one-time [AXIS TEST] marker. */
  subject: string;
  preheader: string | null;
  html: string;
  text: string;
  contentItemIds: string[];
  fromEmail: string;
  /** Friendly name shown in the inbox, part of the From header. */
  senderName: string;
  /** Where a recipient's reply is directed (ADR-0019). Never per-newsletter. */
  replyToEmail: string;
  toEmail: string;
  sendMode: string;
  contentHash: string;
  /** Count of pictures OMITTED because their URL is not reachable outside this machine. */
  omittedImageCount: number;
}

type CampaignWithContent = NonNullable<Awaited<ReturnType<typeof getNewsletter>>>;

function renderFor(campaign: CampaignWithContent): RenderedTestEmail {
  // Same function the preview page uses, so the reviewed message and the hashed/
  // submitted message are byte-identical by construction rather than by convention.
  const document = previewDocument(campaign);
  const subject = document.subject;

  const html = renderNewsletterHtml(document);
  const text = renderNewsletterText(document);

  const contentItemIds = campaign.contentLinks
    .filter((link) => link.isIncluded)
    .map((link) => link.contentItemId);

  // Resolved from central configuration — the same call the SMTP adapter makes, so
  // the approved message and the submitted message cannot disagree.
  const identity = getSenderIdentity();

  const base = {
    campaignId: campaign.id,
    subject,
    preheader: document.preheader ?? null,
    html,
    text,
    contentItemIds,
    fromEmail: AUTHORIZED_TEST_SENDER,
    senderName: identity.senderName,
    replyToEmail: identity.replyToEmail,
    toEmail: AUTHORIZED_TEST_RECIPIENT,
    sendMode: campaign.sendMode,
  };

  // Images that cannot resolve outside this machine are omitted by the renderer, so
  // count them from the source items rather than from the (already stripped) HTML.
  const omittedImageCount = campaign.contentLinks.filter(
    (link) =>
      link.isIncluded &&
      link.contentItem.imageUrl != null &&
      link.contentItem.imageUrl.trim() !== "" &&
      deliverableImageUrl(link.contentItem.imageUrl, document.brand.baseUrl) === null,
  ).length;

  return {
    ...base,
    contentHash: computeApprovalHash(base),
    omittedImageCount,
  };
}

export async function renderTestEmail(campaignId: string): Promise<RenderedTestEmail | null> {
  const campaign = await getNewsletter(campaignId);
  if (!campaign) return null;
  return renderFor(campaign);
}

// ---------------------------------------------------------------------------
// Capability check — never calls the provider
// ---------------------------------------------------------------------------

export interface TestSendStatus {
  canApprove: boolean;
  canSend: boolean;
  /** Non-technical explanation of the current blocker, if any. */
  message: string;
  providerConfigured: boolean;
  providerProblems: string[];
  fromEmail: string;
  senderName: string;
  replyToEmail: string;
  toEmail: string;
  subject: string;
  sendMode: string;
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
    message: string | null;
    failureCode: string | null;
  } | null;
}

/** Most recent approval for a campaign (used or not). */
async function latestApproval(campaignId: string) {
  return getPrisma().campaignTestApproval.findFirst({
    where: { campaignId },
    orderBy: [{ approvedAt: "desc" }],
    include: { approvedBy: { select: { email: true } }, testSend: true },
  });
}

export async function getTestSendStatus(campaignId: string): Promise<TestSendStatus | null> {
  const campaign = await getNewsletter(campaignId);
  if (!campaign) return null;

  const rendered = renderFor(campaign);
  const provider = getEmailProvider();
  const configuration = provider.checkConfiguration();

  const approval = await latestApproval(campaignId);
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
    where: { campaignId },
    orderBy: [{ createdAt: "desc" }],
  });

  const isTestMode = campaign.sendMode === "TEST";
  const hasContent = rendered.contentItemIds.length > 0;

  // Approving is allowed whenever there is something real to approve.
  const canApprove = isTestMode && hasContent;
  const canSend = canApprove && configuration.configured && check.valid;

  let message: string;
  if (!isTestMode) {
    message = "Test sending is only available in test mode.";
  } else if (!hasContent) {
    message = "Add at least one article before sending a test email.";
  } else if (!configuration.configured) {
    message = "Gmail test email provider is not configured";
  } else if (!check.valid) {
    message = APPROVAL_REJECTION_MESSAGE[check.reason ?? "NO_APPROVAL"];
  } else {
    message = "Ready to send one test email.";
  }

  return {
    canApprove,
    canSend,
    message,
    providerConfigured: configuration.configured,
    providerProblems: configuration.problems,
    fromEmail: rendered.fromEmail,
    senderName: rendered.senderName,
    replyToEmail: rendered.replyToEmail,
    toEmail: rendered.toEmail,
    subject: rendered.subject,
    sendMode: campaign.sendMode,
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
          message: lastSend.failureReason,
          failureCode: lastSend.failureCode,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

export type TestSendResult =
  | { ok: true; message: string; state?: string }
  | { ok: false; message: string; reason: string };

export async function approveTestSend(campaignId: string): Promise<TestSendResult> {
  const campaign = await getNewsletter(campaignId);
  if (!campaign) return { ok: false, reason: "NOT_FOUND", message: "That newsletter no longer exists." };

  if (campaign.sendMode !== "TEST") {
    return { ok: false, reason: "NOT_TEST_MODE", message: "Test sending is only available in test mode." };
  }

  const rendered = renderFor(campaign);
  if (rendered.contentItemIds.length === 0) {
    return {
      ok: false,
      reason: "NO_CONTENT",
      message: "Add at least one article before approving a test email.",
    };
  }

  const approvedById = await getAuthoringUserId();
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    // Superseded: an older unused approval must not stay usable alongside a new one.
    await tx.campaignTestApproval.updateMany({
      where: { campaignId, consumedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const approval = await tx.campaignTestApproval.create({
      data: {
        campaignId,
        contentHash: rendered.contentHash,
        subjectSnapshot: rendered.subject,
        preheaderSnapshot: rendered.preheader,
        fromEmail: rendered.fromEmail,
        senderName: rendered.senderName,
        replyToEmail: rendered.replyToEmail,
        toEmail: rendered.toEmail,
        sendMode: "TEST",
        approvedById,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "TEST_SEND_APPROVED",
        actorUserId: approvedById,
        entityType: "Campaign",
        entityId: campaignId,
        toState: "APPROVED_FOR_TEST",
        // No secrets; the hash identifies the exact approved message.
        metadata: {
          approvalId: approval.id,
          contentHash: rendered.contentHash,
          fromEmail: rendered.fromEmail,
          replyToEmail: rendered.replyToEmail,
          toEmail: rendered.toEmail,
        },
      },
    });
  });

  return { ok: true, message: "Approved for one test send." };
}

/** Explicit withdrawal of an approval (used by the UI's cancel action). */
export async function revokeTestApprovals(campaignId: string): Promise<TestSendResult> {
  await getPrisma().campaignTestApproval.updateMany({
    where: { campaignId, consumedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { ok: true, message: "Approval withdrawn." };
}

// ---------------------------------------------------------------------------
// Send — one approval authorizes at most one provider submission
// ---------------------------------------------------------------------------

export async function sendApprovedTestEmail(campaignId: string): Promise<TestSendResult> {
  const prisma = getPrisma();

  const campaign = await getNewsletter(campaignId);
  if (!campaign) return { ok: false, reason: "NOT_FOUND", message: "That newsletter no longer exists." };

  if (campaign.sendMode !== "TEST") {
    return { ok: false, reason: "NOT_TEST_MODE", message: "Test sending is only available in test mode." };
  }

  // Re-render and re-hash NOW. The approval is checked against current content, never
  // against what the client claims.
  const rendered = renderFor(campaign);

  const approval = await latestApproval(campaignId);
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

  const provider = getEmailProvider();
  const configuration = provider.checkConfiguration();
  if (!configuration.configured) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      message: "Gmail test email provider is not configured",
    };
  }

  // Final server-side address guards, independent of the UI.
  const fromEmail = assertAuthorizedTestSender(rendered.fromEmail);
  const toEmail = assertSafeTestEnvelope({ to: rendered.toEmail });

  const idempotencyKey = randomUUID();
  const requestedById = await getAuthoringUserId();

  // ---- Claim the approval and write the durable attempt BEFORE calling the provider.
  // `CampaignTestSend.approvalId` is UNIQUE, so a concurrent or double-clicked request
  // loses this race at the database and never reaches Gmail.
  let testSendId: string;
  try {
    testSendId = await prisma.$transaction(async (tx) => {
      const claimed = await tx.campaignTestApproval.updateMany({
        where: { id: approval.id, consumedAt: null, revokedAt: null },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new Error("APPROVAL_ALREADY_CONSUMED");
      }

      const attempt = await tx.campaignTestSend.create({
        data: {
          campaignId,
          requestedById,
          approvalId: approval.id,
          idempotencyKey,
          fromEmail,
          senderName: rendered.senderName,
          replyToEmail: rendered.replyToEmail,
          toEmail,
          subjectSnapshot: rendered.subject,
          contentHash: rendered.contentHash,
          provider: "GMAIL_SMTP",
          state: "SENDING",
          attemptedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          action: "TEST_SEND_ATTEMPTED",
          actorUserId: requestedById,
          entityType: "Campaign",
          entityId: campaignId,
          toState: "SENDING",
          metadata: {
            testSendId: attempt.id,
            approvalId: approval.id,
            contentHash: rendered.contentHash,
            fromEmail,
            replyToEmail: rendered.replyToEmail,
            toEmail,
          },
        },
      });

      return attempt.id;
    });
  } catch {
    // Lost the race (unique approvalId) or the approval was consumed meanwhile.
    return {
      ok: false,
      reason: "ALREADY_USED",
      message: APPROVAL_REJECTION_MESSAGE.ALREADY_USED,
    };
  }

  // ---- Submit exactly once.
  const result = await provider.sendTestEmail({
    to: toEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey,
  });

  const state =
    result.outcome === "ACCEPTED" ? "ACCEPTED" : result.outcome === "UNCERTAIN" ? "UNCERTAIN" : "FAILED";

  await prisma.campaignTestSend.update({
    where: { id: testSendId },
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
      message: result.message ?? "Gmail accepted the test email for delivery.",
    };
  }

  if (result.outcome === "UNCERTAIN") {
    // Deliberately NOT retried and the approval stays consumed: re-submitting could
    // duplicate a message Gmail may already have accepted.
    return {
      ok: false,
      reason: "UNCERTAIN",
      message:
        result.message ??
        "We could not confirm whether Gmail accepted the email. Check the Sent folder before approving another test.",
    };
  }

  return {
    ok: false,
    reason: result.failureCode ?? "PROVIDER_FAILED",
    message: result.message ?? "Gmail could not accept the email.",
  };
}
