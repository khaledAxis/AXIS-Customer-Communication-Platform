import type { Prisma } from "@prisma/client";

import {
  AUDIENCE_STALENESS_MESSAGE,
  computeAudienceHash,
  evaluateStaleness,
  stableJson,
  type FinalDestination,
  type FinalDestinationSource,
  type FinalExclusion,
} from "../../domain/audience/finalAudience";
import {
  FOUR_EYES_MESSAGE,
  PRODUCTION_APPROVAL_MESSAGE,
  checkProductionApproval,
  computeProductionApprovalHash,
  evaluateFourEyes,
  type ProductionApprovalRejection,
} from "../../domain/campaign/productionApproval";
import {
  evaluateSendReadiness,
  preparationComplete,
  type ReadinessResult,
} from "../../domain/campaign/sendReadiness";
import {
  renderNewsletterHtml,
  renderNewsletterText,
} from "../../domain/email/newsletterTemplate";
import { deliverableImageUrl } from "../../domain/email/newsletterTemplate";
import {
  ConsentStatus,
  EmailStatus,
  ExclusionReason,
  Language,
} from "../../domain/types";
import { AUTHORIZED_TEST_SENDER } from "../../domain/send/testSendPolicy";
import { Role } from "../../domain/auth/authorization";

import { Capability, getCurrentActor, requireCapability } from "../auth/session";
import {
  getProductionEmailProvider,
  productionDeliveryEnabled,
  productionSendingDomain,
} from "../integrations/email";
import {
  RESEND_WEBHOOK_PATH,
  readStoredDomainStatus,
} from "./emailInfrastructureService";
import { checkPublicUnsubscribeReadiness } from "./publicUrlConfig";
import { computeAudienceWatermark } from "../db/repositories/audienceWatermark";
import { getPrisma } from "../db/prisma";
import { getSenderIdentity } from "../integrations/email/senderIdentity";
import { buildNewsletterDocument, getNewsletter } from "./newsletterService";
import { resolveAudienceForDefinition } from "./segmentService";

/**
 * Send readiness: freezing a final audience, binding an approval to it, and
 * answering "is everything ready for production?" (ADR-0022).
 *
 * THIS SERVICE SENDS NOTHING. It has no email provider import, creates no
 * `CampaignRecipient` and no `CampaignEvent`, and the readiness checklist it produces
 * is hard-wired to report production sending as BLOCKED. Preparing an audience and
 * approving a newsletter are preparation steps; the delivery engine they are
 * preparing for does not exist yet, and nothing here can bring it into existence.
 *
 * It also does not implement a second eligibility engine: the audience comes from
 * `resolveAudienceForDefinition`, the same path the preview panel uses, which in turn
 * uses `domain/audience/resolveAudience` + `domain/eligibility` (CLAUDE.md).
 *
 * Since ADR-0023 every mutating function here derives its actor from the signed-in
 * session and re-checks a capability. No function takes an actor, approver or user id
 * as a parameter, so a forged form field has nothing to attach to.
 */

/**
 * Bounds on one frozen audience. Truncation is REPORTED (see `destinationsTruncated`
 * / `exclusionsTruncated`), surfaced as a readiness WARNING, and never silent — a
 * snapshot that quietly dropped half its audience would read as complete.
 */
export const MAX_FINAL_DESTINATIONS = 20_000;
export const MAX_FINAL_EXCLUSIONS = 20_000;

/** How old the CRM projection may be before readiness warns (v1 warns, never blocks). */
export const CRM_STALE_AFTER_HOURS = 24;

/** Page size for the audience inspector. */
export const AUDIENCE_INSPECT_PAGE_SIZE = 100;

export class ReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadinessError";
  }
}

/** A localized campaign requires a matching address language; UNKNOWN does not. */
function requiredLanguage(language: string): Language | null {
  return language === Language.HE || language === Language.AR
    ? (language as Language)
    : null;
}

// ---------------------------------------------------------------------------
// Resolving + hashing the current state
// ---------------------------------------------------------------------------

interface CurrentAudience {
  segmentId: string;
  segmentName: string;
  segmentCriteria: unknown;
  campaignLanguage: Language;
  requireLanguage: Language | null;
  destinations: FinalDestination[];
  exclusions: FinalExclusion[];
  audienceHash: string;
  matchedCompanies: number;
  matchedContacts: number;
  matchedRecords: number;
  withCandidateEmail: number;
  eligible: number;
  uniqueDestinations: number;
  excluded: number;
  duplicateSourcesCollapsed: number;
  breakdown: Record<ExclusionReason, number>;
  consentGranted: number;
  consentNotConfirmed: number;
  resolvedAt: Date;
}

type CampaignRow = {
  id: string;
  language: string;
  segmentId: string | null;
  segment: { id: string; name: string; criteria: Prisma.JsonValue } | null;
};

/**
 * Resolves the campaign's audience NOW and shapes it into the frozen form.
 *
 * Used both to create a final audience and, later, to decide whether the frozen one
 * is still true: freezing and staleness-checking must build the identical structure
 * or the comparison would be meaningless.
 */
async function resolveCurrentAudience(
  campaign: CampaignRow,
): Promise<CurrentAudience | null> {
  if (!campaign.segment) return null;

  const requireLanguage = requiredLanguage(campaign.language);
  const resolved = await resolveAudienceForDefinition(campaign.segment.criteria, {
    requireLanguage,
  });

  const { result, candidates, labelFor, companyNameFor } = resolved;

  // Communication facts per candidate are already attached by the audience
  // repository; an address with no profile row yet is UNKNOWN on every axis.
  const profileByIdentity = new Map(
    candidates.map((c) => [
      `${c.sourceBoardId}|${c.sourceItemId}|${c.emailSourceType}`,
      c,
    ]),
  );

  const destinations: FinalDestination[] = result.recipients.map((recipient) => {
    const sources: FinalDestinationSource[] = recipient.sources.map((source) => ({
      sourceBoardId: source.sourceBoardId,
      sourceItemId: source.sourceItemId,
      sourceEntityType: source.sourceEntityType,
      emailSourceType: source.emailSourceType,
      sourceEmailRaw: source.sourceEmailRaw,
      label: labelFor(source),
      companyName: companyNameFor(source.companyId),
    }));

    // Every source of one destination shares the same normalized address and
    // therefore the same communication profile — that is the whole point of
    // `CommunicationAddress`. Reading the first is reading all of them.
    const first = recipient.sources[0];
    const candidate = first
      ? profileByIdentity.get(
          `${first.sourceBoardId}|${first.sourceItemId}|${first.emailSourceType}`,
        )
      : undefined;

    return {
      normalizedEmail: recipient.normalizedEmail,
      intendedEmail: recipient.intendedEmail,
      language: candidate?.address?.language ?? Language.UNKNOWN,
      consentStatus: candidate?.address?.consentStatus ?? ConsentStatus.UNKNOWN,
      emailStatus: candidate?.address?.emailStatus ?? EmailStatus.UNKNOWN,
      sources,
    };
  });

  const exclusions: FinalExclusion[] = result.exclusions.map((exclusion) => {
    const candidate = profileByIdentity.get(
      `${exclusion.sourceBoardId}|${exclusion.sourceItemId}|${exclusion.emailSourceType}`,
    );
    return {
      sourceBoardId: exclusion.sourceBoardId,
      sourceItemId: exclusion.sourceItemId,
      sourceEntityType: exclusion.sourceEntityType,
      emailSourceType: exclusion.emailSourceType,
      sourceEmailRaw: exclusion.sourceEmailRaw,
      normalizedEmail: exclusion.normalizedEmail ?? null,
      reason: exclusion.reason,
      label: candidate ? labelFor(candidate) : "CRM record",
    };
  });

  const consentGranted = destinations.filter(
    (d) => d.consentStatus === ConsentStatus.GRANTED,
  ).length;

  const audienceHash = computeAudienceHash({
    campaignId: campaign.id,
    segmentId: campaign.segment.id,
    segmentCriteria: campaign.segment.criteria,
    campaignLanguage: campaign.language as Language,
    requireLanguage,
    requireExplicitConsent: false,
    destinations,
    exclusions,
  });

  return {
    segmentId: campaign.segment.id,
    segmentName: campaign.segment.name,
    segmentCriteria: campaign.segment.criteria,
    campaignLanguage: campaign.language as Language,
    requireLanguage,
    destinations,
    exclusions,
    audienceHash,
    matchedCompanies: resolved.matchedCompanies,
    matchedContacts: resolved.matchedContacts,
    matchedRecords: result.snapshot.matchedRecords,
    withCandidateEmail: result.snapshot.withCandidateEmail,
    eligible: result.snapshot.eligible,
    uniqueDestinations: result.snapshot.uniqueDestinations,
    excluded: result.snapshot.excluded,
    duplicateSourcesCollapsed: result.snapshot.duplicateSourcesCollapsed,
    breakdown: result.snapshot.breakdown,
    consentGranted,
    consentNotConfirmed: destinations.length - consentGranted,
    resolvedAt: resolved.resolvedAt,
  };
}

// ---------------------------------------------------------------------------
// Rendering + hashing the message
// ---------------------------------------------------------------------------

interface RenderedProduction {
  subject: string;
  preheader: string | null;
  html: string;
  text: string;
  contentItemIds: string[];
  imageUrls: string[];
  omittedImageCount: number;
  unapprovedExternalCount: number;
  senderEmail: string;
  senderName: string;
  replyToEmail: string;
}

type CampaignWithContent = NonNullable<Awaited<ReturnType<typeof getNewsletter>>>;

/**
 * Renders the production message.
 *
 * Deliberately NOT the SAFE TEST document: a production newsletter carries no
 * `[AXIS TEST]` marker. `buildNewsletterDocument` is still the one canonical
 * renderer, so what is hashed here is what the single email template would produce.
 */
function renderProduction(campaign: CampaignWithContent): RenderedProduction {
  const document = buildNewsletterDocument(campaign);
  const included = campaign.contentLinks.filter((link) => link.isIncluded);
  const identity = getSenderIdentity();

  const imageUrls = included
    .map((link) => link.contentItem.imageUrl)
    .filter((url): url is string => typeof url === "string" && url.trim() !== "");

  return {
    subject: document.subject,
    preheader: document.preheader ?? null,
    html: renderNewsletterHtml(document),
    text: renderNewsletterText(document),
    contentItemIds: included.map((link) => link.contentItemId),
    imageUrls,
    omittedImageCount: imageUrls.filter(
      (url) => deliverableImageUrl(url, document.brand.baseUrl) === null,
    ).length,
    unapprovedExternalCount: included.filter(
      (link) =>
        link.contentItem.origin === "INGESTED" &&
        link.contentItem.reviewState !== "APPROVED",
    ).length,
    senderEmail: AUTHORIZED_TEST_SENDER,
    senderName: identity.senderName,
    replyToEmail: identity.replyToEmail,
  };
}

// ---------------------------------------------------------------------------
// Preparing the final audience
// ---------------------------------------------------------------------------

export interface PrepareResult {
  finalAudienceId: string;
  uniqueDestinations: number;
  excluded: number;
  destinationsStored: number;
  exclusionsStored: number;
  destinationsTruncated: boolean;
  exclusionsTruncated: boolean;
  /** True when an identical request had already been recorded (double click, retry). */
  deduplicated: boolean;
}

/**
 * Freezes exactly who would receive this newsletter, right now.
 *
 * The row is written once and never updated: preparing again creates a NEW final
 * audience, and the newest one is the current one. That is what makes an approval
 * bound to a specific audience meaningful — the audience it points at cannot be
 * edited underneath it.
 *
 * Writes three tables and nothing else. No recipient, no event, no send row.
 */
export async function prepareFinalAudience(
  campaignId: string,
  /**
   * Idempotency token for ONE logical preparation (ADR-0023 §concurrency).
   *
   * The browser generates it once per intent and resends it on a double click or a
   * retried POST. It collides on `@@unique([campaignId, preparationKey])`, so the
   * duplicate returns the snapshot that already exists instead of freezing a second
   * one. A later, deliberate preparation carries a fresh token and is allowed —
   * append-only history is preserved, not weakened.
   *
   * Omitting it is still supported (a server-side caller with no browser), and then
   * the column is NULL, which never collides.
   */
  preparationKey?: string | null,
): Promise<PrepareResult> {
  await requireCapability(Capability.PREPARE_FINAL_AUDIENCE);

  const prisma = getPrisma();

  // Fast path: this exact request was already recorded. Returning the existing
  // snapshot BEFORE resolving the audience is what makes a double click cheap as
  // well as safe.
  if (preparationKey) {
    const already = await prisma.campaignFinalAudience.findUnique({
      where: { campaignId_preparationKey: { campaignId, preparationKey } },
      select: {
        id: true,
        uniqueDestinations: true,
        excluded: true,
        destinationsTruncated: true,
        exclusionsTruncated: true,
        _count: { select: { destinations: true, exclusions: true } },
      },
    });
    if (already) return existingPreparation(already);
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      language: true,
      status: true,
      segmentId: true,
      segment: { select: { id: true, name: true, criteria: true } },
    },
  });
  if (!campaign) throw new ReadinessError("That newsletter no longer exists.");
  if (!campaign.segment) {
    throw new ReadinessError("Choose an audience segment first.");
  }

  const current = await resolveCurrentAudience(campaign);
  if (!current) throw new ReadinessError("Choose an audience segment first.");

  const actor = await requireCapability(Capability.PREPARE_FINAL_AUDIENCE);
  const createdById = actor.id;
  const [freshness, watermark] = await Promise.all([
    crmFreshness(),
    computeAudienceWatermark(prisma, campaignId),
  ]);

  const destinations = current.destinations.slice(0, MAX_FINAL_DESTINATIONS);
  const exclusions = current.exclusions.slice(0, MAX_FINAL_EXCLUSIONS);
  const destinationsTruncated = current.destinations.length > destinations.length;
  const exclusionsTruncated = current.exclusions.length > exclusions.length;

  const finalAudienceId = await prisma.$transaction(async (tx) => {
    const audience = await tx.campaignFinalAudience.create({
      data: {
        campaignId,
        segmentId: current.segmentId,
        segmentName: current.segmentName,
        segmentCriteria: current.segmentCriteria as Prisma.InputJsonValue,
        campaignLanguage: current.campaignLanguage,
        requireLanguage: current.requireLanguage,
        requireExplicitConsent: false,
        matchedCompanies: current.matchedCompanies,
        matchedContacts: current.matchedContacts,
        matchedRecords: current.matchedRecords,
        withCandidateEmail: current.withCandidateEmail,
        eligible: current.eligible,
        uniqueDestinations: current.uniqueDestinations,
        excluded: current.excluded,
        duplicateSourcesCollapsed: current.duplicateSourcesCollapsed,
        consentGranted: current.consentGranted,
        consentNotConfirmed: current.consentNotConfirmed,
        breakdown: current.breakdown as unknown as Prisma.InputJsonValue,
        audienceHash: current.audienceHash,
        crmLastSyncedAt: freshness.lastSyncedAt,
        crmSyncRunId: freshness.syncRunId,
        destinationsTruncated,
        exclusionsTruncated,
        resolutionWatermark: watermark,
        preparationKey: preparationKey ?? null,
        createdById,
      },
      select: { id: true },
    });

    if (destinations.length > 0) {
      await tx.campaignFinalAudienceDestination.createMany({
        data: destinations.map((destination) => ({
          finalAudienceId: audience.id,
          normalizedEmail: destination.normalizedEmail,
          intendedEmail: destination.intendedEmail,
          language: destination.language,
          consentStatus: destination.consentStatus,
          emailStatus: destination.emailStatus,
          sources: destination.sources as unknown as Prisma.InputJsonValue,
          sourceCount: destination.sources.length,
        })),
      });
    }

    if (exclusions.length > 0) {
      await tx.campaignFinalAudienceExclusion.createMany({
        data: exclusions.map((exclusion) => ({
          finalAudienceId: audience.id,
          sourceBoardId: exclusion.sourceBoardId,
          sourceItemId: exclusion.sourceItemId,
          sourceEntityType: exclusion.sourceEntityType as "CUSTOMERS" | "CONTACTS",
          emailSourceType: exclusion.emailSourceType as
            | "COMPANY_EMAIL"
            | "CONTACT_EMAIL",
          sourceEmailRaw: exclusion.sourceEmailRaw,
          normalizedEmail: exclusion.normalizedEmail,
          reason: exclusion.reason,
          label: exclusion.label,
        })),
      });
    }

    // A newly frozen audience invalidates any approval bound to the previous one.
    // The approval check would refuse it anyway (AUDIENCE_REPLACED); revoking makes
    // the reason visible rather than leaving a stale row looking current.
    await tx.campaignProductionApproval.updateMany({
      where: { campaignId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        action: "FINAL_AUDIENCE_PREPARED",
        actorUserId: createdById,
        entityType: "Campaign",
        entityId: campaignId,
        toState: "AUDIENCE_FROZEN",
        metadata: {
          finalAudienceId: audience.id,
          audienceHash: current.audienceHash,
          uniqueDestinations: current.uniqueDestinations,
          excluded: current.excluded,
          // Not a delivery record: no email was sent and no recipient was created.
          sent: false,
        },
      },
    });

    return audience.id;
  }).catch(async (error) => {
    // Lost a race on the idempotency key: five concurrent requests carrying the same
    // token produce ONE snapshot, and the four that lose return the winner's.
    if (preparationKey && isUniqueViolation(error)) {
      const winner = await prisma.campaignFinalAudience.findUnique({
        where: { campaignId_preparationKey: { campaignId, preparationKey } },
        select: { id: true },
      });
      if (winner) return winner.id;
    }
    throw error;
  });

  // A concurrent loser returns the winner's figures, read back rather than assumed.
  const stored = await prisma.campaignFinalAudience.findUniqueOrThrow({
    where: { id: finalAudienceId },
    select: {
      id: true,
      uniqueDestinations: true,
      excluded: true,
      destinationsTruncated: true,
      exclusionsTruncated: true,
      _count: { select: { destinations: true, exclusions: true } },
    },
  });

  return { ...existingPreparation(stored), deduplicated: false };
}

/** Shapes an already-stored snapshot as a preparation result. */
function existingPreparation(row: {
  id: string;
  uniqueDestinations: number;
  excluded: number;
  destinationsTruncated: boolean;
  exclusionsTruncated: boolean;
  _count: { destinations: number; exclusions: number };
}): PrepareResult {
  return {
    finalAudienceId: row.id,
    uniqueDestinations: row.uniqueDestinations,
    excluded: row.excluded,
    destinationsStored: row._count.destinations,
    exclusionsStored: row._count.exclusions,
    destinationsTruncated: row.destinationsTruncated,
    exclusionsTruncated: row.exclusionsTruncated,
    deduplicated: true,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Newest CRM sync considered, for the freshness warning and snapshot provenance. */
async function crmFreshness(): Promise<{
  lastSyncedAt: Date | null;
  syncRunId: string | null;
  hours: number | null;
}> {
  const prisma = getPrisma();
  const run = await prisma.syncRun.findFirst({
    where: { status: { in: ["SUCCESS", "PARTIAL"] } },
    orderBy: [{ startedAt: "desc" }],
    select: { id: true, finishedAt: true, startedAt: true },
  });
  const at = run?.finishedAt ?? run?.startedAt ?? null;
  return {
    lastSyncedAt: at,
    syncRunId: run?.id ?? null,
    hours: at ? (Date.now() - at.getTime()) / 3_600_000 : null,
  };
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export interface SendReadinessView {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  campaignLanguage: Language;
  subject: string | null;
  segment: { id: string; name: string } | null;
  readiness: ReadinessResult;
  preparationComplete: boolean;
  /** The frozen audience currently in force, if any. */
  finalAudience: {
    id: string;
    createdAt: Date;
    segmentName: string;
    matchedCompanies: number;
    matchedContacts: number;
    matchedRecords: number;
    uniqueDestinations: number;
    eligible: number;
    excluded: number;
    duplicateSourcesCollapsed: number;
    consentGranted: number;
    consentNotConfirmed: number;
    breakdown: Record<string, number>;
    destinationsTruncated: boolean;
    exclusionsTruncated: boolean;
    exclusionsRecorded: number;
    crmLastSyncedAt: Date | null;
    audienceHash: string;
  } | null;
  stalenessMessage: string | null;
  /** Live figures for comparison, always recomputed. */
  live: {
    matchedCompanies: number;
    matchedContacts: number;
    matchedRecords: number;
    uniqueDestinations: number;
    excluded: number;
    duplicateSourcesCollapsed: number;
    breakdown: Record<string, number>;
  } | null;
  approval: {
    id: string;
    approvedAt: Date;
    approvedByEmail: string | null;
    approvedByName: string | null;
    authenticatedActor: boolean;
    valid: boolean;
    problem: string | null;
  } | null;
  /** Who prepared the newsletter and who froze the audience — shown as history. */
  preparedBy: { email: string; name: string | null } | null;
  audiencePreparedBy: { email: string; name: string | null } | null;
  /** The signed-in person, so the UI can explain a four-eyes block precisely. */
  viewer: { id: string; email: string; role: string } | null;
  /** True when the viewer is the creator and therefore cannot approve. */
  viewerIsCreator: boolean;
  fourEyes: { satisfied: boolean; problem: string | null };
  /**
   * True when the frozen audience was accepted without a full re-resolution because
   * the cheap watermark still matched. Reported so the saving is visible rather than
   * silent — see ADR-0023.
   */
  audienceVerifiedByWatermark: boolean;
  /** Always false in this milestone; the UI states why. */
  productionEnabled: boolean;
  /**
   * What still has to exist before a single customer message can go out (ADR-0024).
   * Reported as facts, never as assumptions — an unverified domain reads as
   * unverified.
   */
  deliveryInfrastructure: {
    productionSender: string | null;
    providerName: string;
    providerConfigured: boolean;
    deliveryEnabled: boolean;
    domain: {
      domain: string | null;
      spf: string;
      dkim: string;
      dmarc: string;
    };
    publicUnsubscribe: {
      configured: boolean;
      productionReady: boolean;
      origin: string | null;
      problems: string[];
    };
    /** Whether provider delivery events can be verified and received (ADR-0025). */
    webhook: {
      secretConfigured: boolean;
      /** Null until a public origin exists; a localhost URL is never reachable. */
      url: string | null;
      reachable: boolean;
    };
    /** When the domain state above was last read FROM the provider. Never inferred. */
    domainCheckedAt: Date | null;
    blockers: string[];
  };
  sender: { fromEmail: string; senderName: string; replyToEmail: string };
  crmLastSyncedAt: Date | null;
}

export async function getSendReadiness(
  campaignId: string,
): Promise<SendReadinessView | null> {
  const prisma = getPrisma();
  const campaign = await getNewsletter(campaignId);
  if (!campaign) return null;

  const [segment, frozen, approvalRow, freshness, watermark, viewer] =
    await Promise.all([
      campaign.segmentId
        ? prisma.segment.findUnique({
            where: { id: campaign.segmentId },
            select: { id: true, name: true, criteria: true },
          })
        : Promise.resolve(null),
      prisma.campaignFinalAudience.findFirst({
        where: { campaignId },
        orderBy: [{ createdAt: "desc" }],
        include: {
          _count: { select: { exclusions: true } },
          preparedBy: { select: { email: true, name: true } },
        },
      }),
      prisma.campaignProductionApproval.findFirst({
        where: { campaignId },
        orderBy: [{ approvedAt: "desc" }],
        include: { approvedBy: { select: { email: true, name: true, role: true } } },
      }),
      crmFreshness(),
      computeAudienceWatermark(prisma, campaignId),
      getCurrentActor(),
    ]);

  const rendered = renderProduction(campaign);

  // Delivery infrastructure. Read from the provider port and the public-URL config —
  // never assumed, and never reported as ready because it "should" be.
  // The domain snapshot is what the provider last reported; without it the adapter
  // honestly says "not checked" rather than inferring verification from local config.
  const domainSnapshot = await readStoredDomainStatus(productionSendingDomain());
  const productionProvider =
    getProductionEmailProvider(domainSnapshot.status).checkConfiguration();

  const webhookSecretConfigured =
    (process.env.RESEND_WEBHOOK_SECRET ?? "").trim() !== "";
  const publicUnsubscribe = checkPublicUnsubscribeReadiness();
  const webhookUrl = publicUnsubscribe.origin
    ? `${publicUnsubscribe.origin}${RESEND_WEBHOOK_PATH}`
    : null;

  // ---- audience: skip the expensive resolution only when it is provably safe ---
  //
  // The watermark covers every table the resolution reads. When it still matches the
  // value stored with the snapshot, nothing that could move a person in or out has
  // been written since — so the frozen result IS the current one. Any mismatch, and
  // any snapshot predating the watermark column (empty string), re-resolves in full.
  const watermarkMatches =
    frozen !== null &&
    frozen.resolutionWatermark !== "" &&
    frozen.resolutionWatermark === watermark;

  const current =
    segment && !watermarkMatches
      ? await resolveCurrentAudience({
          id: campaign.id,
          language: campaign.language,
          segmentId: campaign.segmentId,
          segment,
        })
      : null;

  let stalenessMessage: string | null = null;
  if (frozen && watermarkMatches) {
    // Provably current: nothing relevant changed since it was frozen.
    stalenessMessage = null;
  } else if (frozen && current) {
    const verdict = evaluateStaleness({
      frozen: {
        audienceHash: frozen.audienceHash,
        segmentId: frozen.segmentId,
        segmentCriteria: stableJson(frozen.segmentCriteria),
        campaignLanguage: frozen.campaignLanguage as Language,
      },
      current: {
        audienceHash: current.audienceHash,
        segmentId: current.segmentId,
        segmentCriteria: stableJson(current.segmentCriteria),
        campaignLanguage: current.campaignLanguage,
      },
    });
    if (verdict.stale) stalenessMessage = AUDIENCE_STALENESS_MESSAGE[verdict.reason];
  } else if (frozen && !current) {
    stalenessMessage = AUDIENCE_STALENESS_MESSAGE.SEGMENT_REMOVED;
  }

  // ---- approval, re-derived against what would actually be sent -------------
  const contentHash = frozen
    ? computeProductionApprovalHash({
        campaignId: campaign.id,
        subject: rendered.subject,
        preheader: rendered.preheader,
        html: rendered.html,
        text: rendered.text,
        contentItemIds: rendered.contentItemIds,
        imageUrls: rendered.imageUrls,
        campaignLanguage: campaign.language,
        senderEmail: rendered.senderEmail,
        senderName: rendered.senderName,
        replyToEmail: rendered.replyToEmail,
        finalAudienceId: frozen.id,
        audienceHash: frozen.audienceHash,
      })
    : "";

  const check = checkProductionApproval(
    approvalRow
      ? {
          id: approvalRow.id,
          contentHash: approvalRow.contentHash,
          finalAudienceId: approvalRow.finalAudienceId,
          audienceHash: approvalRow.audienceHash,
          senderEmail: approvalRow.senderEmail,
          replyToEmail: approvalRow.replyToEmail,
          revokedAt: approvalRow.revokedAt,
        }
      : null,
    {
      contentHash,
      finalAudienceId: frozen?.id ?? null,
      audienceHash: frozen?.audienceHash ?? null,
      senderEmail: rendered.senderEmail,
      replyToEmail: rendered.replyToEmail,
    },
  );

  // An approval that is otherwise valid is still not valid when the audience it
  // points at has gone stale — the people changed, even though the row did not.
  const approvalValid = check.valid && stalenessMessage === null;
  const approvalProblem = check.valid
    ? stalenessMessage
    : PRODUCTION_APPROVAL_MESSAGE[
        (check.reason ?? "NO_APPROVAL") as ProductionApprovalRejection
      ];

  // Four-eyes against REAL identities (ADR-0023). `authenticated` is the flag the
  // approval recorded at the time: an approval made before sign-in existed stays
  // false forever, so historical rows can never retroactively satisfy the rule.
  const fourEyes = evaluateFourEyes({
    creatorId: campaign.createdById,
    approverId: approvalRow?.approvedById ?? null,
    approverRole:
      approvalRow?.approvedBy?.role === Role.ADMIN ||
      approvalRow?.approvedBy?.role === Role.MANAGER
        ? approvalRow.approvedBy.role
        : null,
    authenticated: approvalRow?.authenticatedActor ?? false,
  });

  const crmStaleMessage =
    freshness.hours !== null && freshness.hours > CRM_STALE_AFTER_HOURS
      ? `Customer data was last synced from Monday ${Math.floor(freshness.hours)} hours ago. Sync again so the audience reflects the CRM.`
      : freshness.lastSyncedAt === null
        ? "Customer data has never been synced from Monday in this environment."
        : null;

  const readiness = evaluateSendReadiness({
    campaign: {
      status: campaign.status,
      subject: campaign.subject,
      language: campaign.language,
      includedContentCount: rendered.contentItemIds.length,
      unapprovedExternalCount: rendered.unapprovedExternalCount,
      omittedImageCount: rendered.omittedImageCount,
    },
    audience: {
      segmentSelected: segment !== null,
      finalAudiencePrepared: frozen !== null,
      stalenessMessage,
      eligibleCount: frozen?.uniqueDestinations ?? 0,
      excludedCount: frozen?.excluded ?? 0,
      exclusionsRecorded: frozen?._count.exclusions ?? 0,
      exclusionsTruncated: frozen?.exclusionsTruncated ?? false,
      destinationsTruncated: frozen?.destinationsTruncated ?? false,
      consentNotConfirmedCount: frozen?.consentNotConfirmed ?? 0,
      consentGrantedCount: frozen?.consentGranted ?? 0,
      crmStaleMessage,
    },
    approval: {
      approved: approvalValid,
      problem: approvalProblem,
      fourEyesSatisfied: fourEyes.satisfied,
      fourEyesProblem: fourEyes.satisfied ? null : FOUR_EYES_MESSAGE[fourEyes.reason],
    },
    production: { enabled: false },
  });

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    campaignStatus: campaign.status,
    campaignLanguage: campaign.language as Language,
    subject: campaign.subject,
    segment: segment ? { id: segment.id, name: segment.name } : null,
    readiness,
    preparationComplete: preparationComplete(readiness),
    finalAudience: frozen
      ? {
          id: frozen.id,
          createdAt: frozen.createdAt,
          segmentName: frozen.segmentName,
          matchedCompanies: frozen.matchedCompanies,
          matchedContacts: frozen.matchedContacts,
          matchedRecords: frozen.matchedRecords,
          uniqueDestinations: frozen.uniqueDestinations,
          eligible: frozen.eligible,
          excluded: frozen.excluded,
          duplicateSourcesCollapsed: frozen.duplicateSourcesCollapsed,
          consentGranted: frozen.consentGranted,
          consentNotConfirmed: frozen.consentNotConfirmed,
          breakdown: (frozen.breakdown ?? {}) as Record<string, number>,
          destinationsTruncated: frozen.destinationsTruncated,
          exclusionsTruncated: frozen.exclusionsTruncated,
          exclusionsRecorded: frozen._count.exclusions,
          crmLastSyncedAt: frozen.crmLastSyncedAt,
          audienceHash: frozen.audienceHash,
        }
      : null,
    stalenessMessage,
    live: current
      ? {
          matchedCompanies: current.matchedCompanies,
          matchedContacts: current.matchedContacts,
          matchedRecords: current.matchedRecords,
          uniqueDestinations: current.uniqueDestinations,
          excluded: current.excluded,
          duplicateSourcesCollapsed: current.duplicateSourcesCollapsed,
          breakdown: current.breakdown as unknown as Record<string, number>,
        }
      : frozen && watermarkMatches
        ? {
            // Not a guess: the watermark proved no relevant row changed, so the
            // frozen figures ARE the live ones.
            matchedCompanies: frozen.matchedCompanies,
            matchedContacts: frozen.matchedContacts,
            matchedRecords: frozen.matchedRecords,
            uniqueDestinations: frozen.uniqueDestinations,
            excluded: frozen.excluded,
            duplicateSourcesCollapsed: frozen.duplicateSourcesCollapsed,
            breakdown: (frozen.breakdown ?? {}) as Record<string, number>,
          }
        : null,
    approval: approvalRow
      ? {
          id: approvalRow.id,
          approvedAt: approvalRow.approvedAt,
          approvedByEmail: approvalRow.approvedBy?.email ?? null,
          approvedByName: approvalRow.approvedBy?.name ?? null,
          authenticatedActor: approvalRow.authenticatedActor,
          valid: approvalValid,
          problem: approvalValid ? null : approvalProblem,
        }
      : null,
    preparedBy: campaign.creator
      ? { email: campaign.creator.email, name: campaign.creator.name }
      : null,
    audiencePreparedBy: frozen?.preparedBy
      ? { email: frozen.preparedBy.email, name: frozen.preparedBy.name }
      : null,
    viewer: viewer ? { id: viewer.id, email: viewer.email, role: viewer.role } : null,
    viewerIsCreator: viewer !== null && viewer.id === campaign.createdById,
    fourEyes: {
      satisfied: fourEyes.satisfied,
      problem: fourEyes.satisfied ? null : FOUR_EYES_MESSAGE[fourEyes.reason],
    },
    audienceVerifiedByWatermark: watermarkMatches,
    productionEnabled: productionDeliveryEnabled() && productionProvider.configured,
    deliveryInfrastructure: {
      productionSender: productionProvider.senderEmail,
      providerName: productionProvider.name,
      providerConfigured: productionProvider.configured,
      deliveryEnabled: productionProvider.enabled,
      domain: {
        domain: productionProvider.domain.domain,
        spf: productionProvider.domain.spf,
        dkim: productionProvider.domain.dkim,
        dmarc: productionProvider.domain.dmarc,
      },
      publicUnsubscribe,
      webhook: {
        secretConfigured: webhookSecretConfigured,
        url: webhookUrl,
        // A localhost URL is configured, not reachable. Resend cannot post to it, so
        // bounces and complaints would never arrive — reported, not glossed over.
        reachable: Boolean(webhookUrl && !webhookUrl.startsWith("http://localhost")),
      },
      domainCheckedAt: domainSnapshot.checkedAt,
      blockers: [
        ...productionProvider.problems,
        ...publicUnsubscribe.problems,
        ...(webhookSecretConfigured
          ? []
          : [
              "No provider webhook secret is configured, so bounces and spam complaints cannot be received or verified.",
            ]),
      ],
    },
    sender: {
      fromEmail: rendered.senderEmail,
      senderName: rendered.senderName,
      replyToEmail: rendered.replyToEmail,
    },
    crmLastSyncedAt: freshness.lastSyncedAt,
  };
}

// ---------------------------------------------------------------------------
// Approving
// ---------------------------------------------------------------------------

export type ApprovalActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; reason: string };

/**
 * Records an approval of this exact newsletter to this exact frozen audience.
 *
 * The hash is computed here, on the server, from freshly rendered content and the
 * frozen audience — a client-supplied "approved" flag is never trusted, and there is
 * no parameter through which one could be supplied.
 *
 * Recording this does NOT enable sending. Production delivery does not exist, and the
 * readiness checklist reports it as BLOCKED regardless of this row.
 */
export async function approveForProduction(
  campaignId: string,
): Promise<ApprovalActionResult> {
  // Identity and permission come from the session. There is no approver parameter,
  // so a browser cannot nominate one (ADR-0023).
  const approver = await requireCapability(Capability.APPROVE_PRODUCTION);

  const prisma = getPrisma();
  const campaign = await getNewsletter(campaignId);
  if (!campaign) {
    return { ok: false, reason: "NOT_FOUND", message: "That newsletter no longer exists." };
  }

  // FOUR-EYES, enforced here and not merely displayed. Administrators are NOT
  // exempt: an administrator unblocking a stuck workflow is one thing, authorising a
  // real customer send to themselves is another.
  const fourEyes = evaluateFourEyes({
    creatorId: campaign.createdById,
    approverId: approver.id,
    approverRole: approver.role,
    authenticated: true,
  });
  if (!fourEyes.satisfied) {
    return {
      ok: false,
      reason: fourEyes.reason,
      message:
        fourEyes.reason === "SAME_PERSON"
          ? "A different authorized AXIS user must approve this campaign."
          : FOUR_EYES_MESSAGE[fourEyes.reason],
    };
  }

  const readiness = await getSendReadiness(campaignId);
  if (!readiness) {
    return { ok: false, reason: "NOT_FOUND", message: "That newsletter no longer exists." };
  }
  if (!readiness.finalAudience) {
    return {
      ok: false,
      reason: "NO_FINAL_AUDIENCE",
      message: "Prepare the final audience before approving.",
    };
  }
  if (readiness.stalenessMessage) {
    return {
      ok: false,
      reason: "STALE_AUDIENCE",
      message: readiness.stalenessMessage,
    };
  }

  // Everything except the approval itself and the deliberate production block must
  // already be satisfied — approving a newsletter with no content or no recipients
  // would produce an approval that can never become valid.
  const unresolved = readiness.readiness.checks.filter(
    (c) =>
      c.status === "BLOCKED" &&
      c.group !== "INFRASTRUCTURE" &&
      c.key !== "approval" &&
      c.key !== "four-eyes",
  );
  if (unresolved.length > 0) {
    return {
      ok: false,
      reason: "NOT_READY",
      message: unresolved[0].detail,
    };
  }

  const rendered = renderProduction(campaign);
  const contentHash = computeProductionApprovalHash({
    campaignId: campaign.id,
    subject: rendered.subject,
    preheader: rendered.preheader,
    html: rendered.html,
    text: rendered.text,
    contentItemIds: rendered.contentItemIds,
    imageUrls: rendered.imageUrls,
    campaignLanguage: campaign.language,
    senderEmail: rendered.senderEmail,
    senderName: rendered.senderName,
    replyToEmail: rendered.replyToEmail,
    finalAudienceId: readiness.finalAudience.id,
    audienceHash: readiness.finalAudience.audienceHash,
  });

  const approvedById = approver.id;

  await prisma.$transaction(async (tx) => {
    // Superseded: an older approval must not stay valid alongside a new one.
    await tx.campaignProductionApproval.updateMany({
      where: { campaignId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const approval = await tx.campaignProductionApproval.create({
      data: {
        campaignId,
        finalAudienceId: readiness.finalAudience!.id,
        contentHash,
        audienceHash: readiness.finalAudience!.audienceHash,
        subjectSnapshot: rendered.subject,
        preheaderSnapshot: rendered.preheader,
        campaignLanguage: campaign.language,
        senderEmail: rendered.senderEmail,
        senderName: rendered.senderName,
        replyToEmail: rendered.replyToEmail,
        approvedById,
        // A real signed-in person approved this. Historical rows keep `false`, so an
        // approval made before authentication existed can never become valid.
        authenticatedActor: true,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        action: "PRODUCTION_APPROVAL_RECORDED",
        actorUserId: approvedById,
        entityType: "Campaign",
        entityId: campaignId,
        toState: "APPROVED_FOR_PRODUCTION",
        metadata: {
          approvalId: approval.id,
          contentHash,
          finalAudienceId: readiness.finalAudience!.id,
          audienceHash: readiness.finalAudience!.audienceHash,
          authenticatedActor: true,
          approverEmail: approver.email,
          // Approval is not delivery: nothing was sent and no recipient was created.
          sent: false,
        },
      },
    });
  });

  return {
    ok: true,
    message:
      "Approved. Production sending is still locked — this records the approval only.",
  };
}

export async function revokeProductionApproval(
  campaignId: string,
): Promise<ApprovalActionResult> {
  const actor = await requireCapability(Capability.APPROVE_PRODUCTION);
  const prisma = getPrisma();
  const actorUserId = actor.id;

  const revoked = await prisma.campaignProductionApproval.updateMany({
    where: { campaignId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (revoked.count > 0) {
    await prisma.auditLog.create({
      data: {
        action: "PRODUCTION_APPROVAL_REVOKED",
        actorUserId,
        entityType: "Campaign",
        entityId: campaignId,
        toState: "APPROVAL_WITHDRAWN",
        metadata: { revokedCount: revoked.count },
      },
    });
  }

  return { ok: true, message: "Approval withdrawn." };
}

// ---------------------------------------------------------------------------
// Inspecting a frozen audience
// ---------------------------------------------------------------------------

export interface FinalDestinationRow {
  normalizedEmail: string;
  language: Language;
  consentStatus: ConsentStatus;
  emailStatus: EmailStatus;
  sources: FinalDestinationSource[];
}

export interface FinalExclusionRow {
  label: string;
  address: string | null;
  kind: string;
  reason: ExclusionReason;
}

export interface AudienceInspection {
  finalAudienceId: string;
  createdAt: Date;
  total: number;
  page: number;
  pageCount: number;
  destinations: FinalDestinationRow[];
  exclusions: FinalExclusionRow[];
  exclusionTotal: number;
}

/**
 * Reads back a frozen audience for the "view eligible addresses" / "view exclusions"
 * screens. Read-only: it can neither change the snapshot nor send to anyone in it.
 */
export async function inspectFinalAudience(
  campaignId: string,
  options: { view: "ELIGIBLE" | "EXCLUDED"; page?: number },
): Promise<AudienceInspection | null> {
  // Reading who would receive a newsletter is customer data: it needs a session too.
  await requireCapability(Capability.VIEW_CRM);
  const prisma = getPrisma();
  const frozen = await prisma.campaignFinalAudience.findFirst({
    where: { campaignId },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, createdAt: true },
  });
  if (!frozen) return null;

  const page = Math.max(1, options.page ?? 1);
  const skip = (page - 1) * AUDIENCE_INSPECT_PAGE_SIZE;

  const [destinationTotal, exclusionTotal] = await Promise.all([
    prisma.campaignFinalAudienceDestination.count({
      where: { finalAudienceId: frozen.id },
    }),
    prisma.campaignFinalAudienceExclusion.count({
      where: { finalAudienceId: frozen.id },
    }),
  ]);

  const total = options.view === "ELIGIBLE" ? destinationTotal : exclusionTotal;

  const destinations =
    options.view === "ELIGIBLE"
      ? await prisma.campaignFinalAudienceDestination.findMany({
          where: { finalAudienceId: frozen.id },
          orderBy: [{ normalizedEmail: "asc" }],
          skip,
          take: AUDIENCE_INSPECT_PAGE_SIZE,
        })
      : [];

  const exclusions =
    options.view === "EXCLUDED"
      ? await prisma.campaignFinalAudienceExclusion.findMany({
          where: { finalAudienceId: frozen.id },
          orderBy: [{ reason: "asc" }, { sourceItemId: "asc" }],
          skip,
          take: AUDIENCE_INSPECT_PAGE_SIZE,
        })
      : [];

  return {
    finalAudienceId: frozen.id,
    createdAt: frozen.createdAt,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AUDIENCE_INSPECT_PAGE_SIZE)),
    destinations: destinations.map((row) => ({
      normalizedEmail: row.normalizedEmail,
      language: row.language as Language,
      consentStatus: row.consentStatus as ConsentStatus,
      emailStatus: row.emailStatus as EmailStatus,
      sources: (row.sources ?? []) as unknown as FinalDestinationSource[],
    })),
    exclusions: exclusions.map((row) => ({
      label: row.label ?? "CRM record",
      address: row.normalizedEmail ?? row.sourceEmailRaw,
      kind: row.emailSourceType,
      reason: row.reason as ExclusionReason,
    })),
    exclusionTotal,
  };
}
