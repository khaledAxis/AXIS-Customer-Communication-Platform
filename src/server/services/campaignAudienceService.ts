import { assertCampaignEditable } from "../../domain/content/contentValidation";
import { Language } from "../../domain/types";

import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";
import { AudiencePreview, previewSegment } from "./segmentService";

/**
 * The bridge between a newsletter and its audience.
 *
 * What this milestone deliberately does NOT do: create `CampaignRecipient` rows,
 * write `CampaignEvent` rows, or send anything. Choosing a segment and taking a
 * planning snapshot are analysis steps. Production delivery records are created
 * by the send workflow, from a live re-resolution at send time (CLAUDE.md) —
 * never from a saved audience.
 */

export interface CampaignAudienceView {
  campaignId: string;
  campaignName: string;
  language: Language;
  status: string;
  segment: { id: string; name: string; description: string | null } | null;
  preview: AudiencePreview | null;
  /** The most recent planning snapshot, if one was taken. */
  lastSnapshot: {
    resolvedAt: Date;
    matchedRecords: number;
    uniqueDestinations: number;
    eligible: number;
    excluded: number;
    duplicateSourcesCollapsed: number;
  } | null;
}

/** A localized campaign requires a matching address language; UNKNOWN does not. */
function requiredLanguage(language: string): Language | null {
  return language === Language.HE || language === Language.AR
    ? (language as Language)
    : null;
}

export async function setCampaignSegment(
  campaignId: string,
  segmentId: string | null,
): Promise<void> {
  await requireCapability(Capability.MANAGE_NEWSLETTERS);
  const prisma = getPrisma();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  });
  if (!campaign) throw new Error("That newsletter no longer exists.");

  // Audience selection is content: it is locked once the campaign leaves DRAFT.
  assertCampaignEditable(campaign.status);

  if (segmentId) {
    const exists = await prisma.segment.count({ where: { id: segmentId } });
    if (exists === 0) throw new Error("That segment no longer exists.");
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { segmentId },
  });
}

export async function getCampaignAudience(
  campaignId: string,
  options: { withPreview?: boolean } = {},
): Promise<CampaignAudienceView | null> {
  const prisma = getPrisma();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      language: true,
      status: true,
      segment: { select: { id: true, name: true, description: true } },
      snapshots: {
        orderBy: [{ resolvedAt: "desc" }],
        take: 1,
        select: {
          resolvedAt: true,
          matchedRecords: true,
          uniqueDestinations: true,
          eligible: true,
          excluded: true,
          duplicateSourcesCollapsed: true,
        },
      },
    },
  });
  if (!campaign) return null;

  let preview: AudiencePreview | null = null;
  if (options.withPreview && campaign.segment) {
    preview = await previewSegment(campaign.segment.id, {
      requireLanguage: requiredLanguage(campaign.language),
    });
  }

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    language: campaign.language as Language,
    status: campaign.status,
    segment: campaign.segment,
    preview,
    lastSnapshot: campaign.snapshots[0] ?? null,
  };
}

export class NoSegmentError extends Error {
  constructor() {
    super("Choose an audience segment first.");
    this.name = "NoSegmentError";
  }
}

/** Bounds how many exclusion rows one snapshot writes. Never silent — see result. */
export const MAX_STORED_EXCLUSIONS = 20_000;

export interface SnapshotResult {
  resolvedAt: Date;
  uniqueDestinations: number;
  eligible: number;
  excluded: number;
  exclusionsRecorded: number;
  exclusionsTruncated: boolean;
}

/**
 * Records a planning snapshot of the campaign's audience.
 *
 * This is the DRAFT-time record of "who would receive this today". It is
 * recomputed, not accumulated: taking a new snapshot replaces the previous one
 * for the same campaign, because a stale audience must never look current. The
 * authoritative, immutable send-time snapshot is a separate step in the send
 * workflow and is not created here.
 *
 * Writes exactly two tables: `CampaignAudienceSnapshot` and
 * `CampaignAudienceExclusion`. No recipient, event, or send row is touched.
 */
export async function snapshotCampaignAudience(
  campaignId: string,
): Promise<SnapshotResult> {
  await requireCapability(Capability.MANAGE_NEWSLETTERS);
  const prisma = getPrisma();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, language: true, status: true, segmentId: true },
  });
  if (!campaign) throw new Error("That newsletter no longer exists.");
  assertCampaignEditable(campaign.status);
  if (!campaign.segmentId) throw new NoSegmentError();

  const preview = await previewSegment(campaign.segmentId, {
    requireLanguage: requiredLanguage(campaign.language),
    includeAllExclusions: true,
  });
  if (!preview) throw new NoSegmentError();

  const rows = (preview.allExclusions ?? []).slice(0, MAX_STORED_EXCLUSIONS);

  await prisma.$transaction(async (tx) => {
    await tx.campaignAudienceExclusion.deleteMany({ where: { campaignId } });
    await tx.campaignAudienceSnapshot.deleteMany({ where: { campaignId } });

    await tx.campaignAudienceSnapshot.create({
      data: {
        campaignId,
        resolvedAt: preview.resolvedAt,
        matchedRecords: preview.snapshot.matchedRecords,
        withCandidateEmail: preview.snapshot.withCandidateEmail,
        eligible: preview.snapshot.eligible,
        uniqueDestinations: preview.snapshot.uniqueDestinations,
        excluded: preview.snapshot.excluded,
        duplicateSourcesCollapsed: preview.snapshot.duplicateSourcesCollapsed,
        breakdown: preview.snapshot.breakdown,
      },
    });

    if (rows.length > 0) {
      await tx.campaignAudienceExclusion.createMany({
        data: rows.map((exclusion) => ({
          campaignId,
          sourceBoardId: exclusion.sourceBoardId,
          sourceItemId: exclusion.sourceItemId,
          sourceEntityType: exclusion.sourceEntityType,
          emailSourceType: exclusion.emailSourceType,
          sourceEmailRaw: exclusion.sourceEmailRaw,
          normalizedEmail: exclusion.normalizedEmail ?? null,
          reason: exclusion.reason,
        })),
      });
    }
  });

  return {
    resolvedAt: preview.resolvedAt,
    uniqueDestinations: preview.snapshot.uniqueDestinations,
    eligible: preview.snapshot.eligible,
    excluded: preview.snapshot.excluded,
    exclusionsRecorded: rows.length,
    exclusionsTruncated: preview.snapshot.excluded > rows.length,
  };
}
