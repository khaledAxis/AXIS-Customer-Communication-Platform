import type { Prisma } from "@prisma/client";

import { getPrisma } from "../prisma";

/**
 * Data access for newsletters (Campaign + CampaignContentItem).
 *
 * Ordering lives in `CampaignContentItem.position` — there is no single-content
 * assumption anywhere (ADR-0010: a newsletter composes MANY ordered items).
 */

const listInclude = {
  _count: { select: { contentLinks: true, recipients: true, events: true, testSends: true } },
} satisfies Prisma.CampaignInclude;

export async function listCampaigns() {
  return getPrisma().campaign.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: listInclude,
  });
}

export async function getCampaign(id: string) {
  return getPrisma().campaign.findUnique({
    where: { id },
    include: {
      contentLinks: {
        orderBy: [{ position: "asc" }],
        include: { contentItem: { include: { source: { select: { name: true } } } } },
      },
      // Who prepared this newsletter, for the approval history. Never the password
      // hash — only the fields a person is shown.
      creator: { select: { id: true, email: true, name: true, isSystemAccount: true } },
      _count: { select: { recipients: true, events: true, testSends: true } },
    },
  });
}

export async function createCampaign(data: Prisma.CampaignCreateInput) {
  return getPrisma().campaign.create({ data });
}

export async function updateCampaign(id: string, data: Prisma.CampaignUpdateInput) {
  return getPrisma().campaign.update({ where: { id }, data });
}

/** History that must never be destroyed by a delete (mirrors the RESTRICT FKs). */
export async function campaignHistoryCount(id: string) {
  const prisma = getPrisma();
  const [recipients, events, testSends] = await Promise.all([
    prisma.campaignRecipient.count({ where: { campaignId: id } }),
    prisma.campaignEvent.count({ where: { campaignId: id } }),
    prisma.campaignTestSend.count({ where: { campaignId: id } }),
  ]);
  return recipients + events + testSends;
}

export async function deleteCampaign(id: string) {
  return getPrisma().campaign.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Content composition
// ---------------------------------------------------------------------------

/** Append an item at the end. The unique (campaignId, contentItemId) prevents duplicates. */
export async function addContentToCampaign(campaignId: string, contentItemId: string) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const last = await tx.campaignContentItem.findFirst({
      where: { campaignId },
      orderBy: [{ position: "desc" }],
      select: { position: true },
    });
    return tx.campaignContentItem.create({
      data: { campaignId, contentItemId, position: (last?.position ?? 0) + 1 },
    });
  });
}

export async function removeContentFromCampaign(campaignId: string, contentItemId: string) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.campaignContentItem.delete({
      where: { campaignId_contentItemId: { campaignId, contentItemId } },
    });
    // Close the gap so positions stay 1..n and reordering stays predictable.
    const remaining = await tx.campaignContentItem.findMany({
      where: { campaignId },
      orderBy: [{ position: "asc" }],
      select: { id: true },
    });
    await Promise.all(
      remaining.map((row, index) =>
        tx.campaignContentItem.update({ where: { id: row.id }, data: { position: index + 1 } }),
      ),
    );
  });
}

/**
 * Persist an explicit order. Written in one transaction so the newsletter is never
 * left half-reordered.
 *
 * Positions are first pushed into a high, non-colliding band. Without that, swapping
 * two rows would transiently place two items at the same position — harmless today
 * but a trap if a uniqueness constraint is ever added to (campaignId, position).
 */
export async function reorderCampaignContent(campaignId: string, orderedContentItemIds: string[]) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.campaignContentItem.findMany({
      where: { campaignId },
      select: { id: true, contentItemId: true },
    });
    const byContentId = new Map(existing.map((row) => [row.contentItemId, row.id]));

    const offset = existing.length + 1000;
    for (const [index, contentItemId] of orderedContentItemIds.entries()) {
      const rowId = byContentId.get(contentItemId);
      if (rowId) {
        await tx.campaignContentItem.update({
          where: { id: rowId },
          data: { position: offset + index },
        });
      }
    }
    for (const [index, contentItemId] of orderedContentItemIds.entries()) {
      const rowId = byContentId.get(contentItemId);
      if (rowId) {
        await tx.campaignContentItem.update({ where: { id: rowId }, data: { position: index + 1 } });
      }
    }
  });
}

export async function setCampaignItemInclusion(
  campaignId: string,
  contentItemId: string,
  isIncluded: boolean,
) {
  return getPrisma().campaignContentItem.update({
    where: { campaignId_contentItemId: { campaignId, contentItemId } },
    data: { isIncluded },
  });
}

export async function countCampaignsByStatus() {
  const grouped = await getPrisma().campaign.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const row of grouped) counts[row.status] = row._count._all;
  return counts;
}
