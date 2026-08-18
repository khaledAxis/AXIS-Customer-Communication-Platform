import type { Prisma } from "@prisma/client";

import { getPrisma } from "../prisma";

/**
 * Data access for content items and sources.
 *
 * The ONLY place Prisma is used for content. Services orchestrate; UI never imports
 * this module (CLAUDE.md layer rule: ui/app -> services -> db).
 */

export type ContentFilter =
  | "ALL"
  | "NEW"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "INTERNAL"
  | "INGESTED"
  | "HE"
  | "AR"
  | "UNKNOWN";

function whereFor(filter: ContentFilter): Prisma.ContentItemWhereInput {
  switch (filter) {
    case "NEW":
    case "PENDING_REVIEW":
    case "APPROVED":
    case "REJECTED":
      return { reviewState: filter };
    case "INTERNAL":
    case "INGESTED":
      return { origin: filter };
    case "HE":
    case "AR":
    case "UNKNOWN":
      return { language: filter };
    default:
      return {};
  }
}

export async function listContentItems(filter: ContentFilter = "ALL") {
  return getPrisma().contentItem.findMany({
    where: whereFor(filter),
    orderBy: [{ updatedAt: "desc" }],
    include: { source: { select: { id: true, name: true, kind: true } } },
  });
}

export async function countContentByState() {
  const grouped = await getPrisma().contentItem.groupBy({
    by: ["reviewState"],
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const row of grouped) counts[row.reviewState] = row._count._all;
  return counts;
}

export async function getContentItem(id: string) {
  return getPrisma().contentItem.findUnique({
    where: { id },
    include: { source: { select: { id: true, name: true, kind: true } } },
  });
}

/**
 * Approved content is the only content offered to a newsletter (ADR-0010).
 * A localized newsletter also accepts items whose language is not set yet, so a
 * half-filled article is still reachable rather than silently invisible.
 */
export async function listApprovedContent(language?: string) {
  const languageFilter: Prisma.ContentItemWhereInput =
    language === "HE" || language === "AR" ? { language: { in: [language, "UNKNOWN"] } } : {};

  return getPrisma().contentItem.findMany({
    where: {
      reviewState: "APPROVED",
      ...languageFilter,
    },
    orderBy: [{ updatedAt: "desc" }],
    include: { source: { select: { id: true, name: true } } },
  });
}

export async function createContentItem(data: Prisma.ContentItemCreateInput) {
  return getPrisma().contentItem.create({ data });
}

export async function updateContentItem(id: string, data: Prisma.ContentItemUpdateInput) {
  return getPrisma().contentItem.update({ where: { id }, data });
}

/**
 * Content referenced by a newsletter must never be destroyed (the FK is RESTRICT).
 * Callers check this first so the user sees a clear message, not a database error.
 */
export async function countCampaignUsages(contentItemId: string) {
  return getPrisma().campaignContentItem.count({ where: { contentItemId } });
}

export async function deleteContentItem(id: string) {
  return getPrisma().contentItem.delete({ where: { id } });
}

export async function listContentSources() {
  return getPrisma().contentSource.findMany({ orderBy: [{ name: "asc" }] });
}

export async function findOrCreateManualSource(name: string) {
  const prisma = getPrisma();
  const existing = await prisma.contentSource.findFirst({
    where: { name, kind: "MANUAL_EXTERNAL" },
  });
  if (existing) return existing;
  return prisma.contentSource.create({ data: { name, kind: "MANUAL_EXTERNAL" } });
}
