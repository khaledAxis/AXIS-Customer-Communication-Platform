import "server-only";

import type { Prisma } from "@prisma/client";

import { validateSourceUrl } from "../../domain/content/sourceUrl";
import { MAX_IMAGE_BYTES, sniffImageMime } from "../../domain/media/imagePolicy";
import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";
import { getMediaStore } from "../media";

/**
 * The content review inbox and the AXIS editorial layer (ADR-0026).
 *
 * The central rule: **nothing collected from outside becomes newsletter content
 * without a person saying so.** Ingestion creates `PENDING_REVIEW`; only the two
 * functions here move an item to `APPROVED` or `REJECTED`, both require a signed-in
 * actor, and both write an audit row naming them.
 *
 * The second rule is about ownership of fields. Source metadata (title, summary,
 * author, link, published date) is MIRRORED and belongs to the publisher; AXIS
 * editorial copy (`axisHeadline`, `axisSummary`, `ctaLabel`, `ctaUrl`,
 * `internalNote`) is LOCAL. Editing one never touches the other, so a later
 * re-ingestion can refresh the source's own fields without destroying the words a
 * colleague wrote — the same separation the CRM projection uses for communication
 * state, and for the same reason.
 */

export type ReviewFilter = "NEW" | "APPROVED" | "REJECTED" | "ALL";

export interface InboxQuery {
  filter?: ReviewFilter;
  sourceId?: string | null;
  category?: string | null;
  search?: string | null;
  /** ISO date; items published on or after it. */
  since?: string | null;
  limit?: number;
}

export interface FieldError {
  field: string;
  message: string;
}

export type ReviewResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldError[] };

function stateFilter(filter: ReviewFilter | undefined): Prisma.ContentItemWhereInput {
  switch (filter) {
    case "APPROVED":
      return { reviewState: "APPROVED" as const };
    case "REJECTED":
      return { reviewState: "REJECTED" as const };
    case "ALL":
      return {};
    default:
      // "New" means anything waiting for a person, whichever of the two waiting
      // states it happens to be in.
      return { reviewState: { in: ["NEW", "PENDING_REVIEW"] } };
  }
}

export async function listInbox(query: InboxQuery = {}) {
  await requireCapability(Capability.MANAGE_CONTENT);
  const prisma = getPrisma();

  const search = query.search?.trim();
  const since = query.since ? new Date(query.since) : null;

  return prisma.contentItem.findMany({
    where: {
      origin: "INGESTED",
      ...stateFilter(query.filter),
      ...(query.sourceId ? { sourceId: query.sourceId } : {}),
      ...(query.category
        ? { source: { categories: { has: query.category.toLowerCase() } } }
        : {}),
      ...(since && !Number.isNaN(since.getTime())
        ? { publishedAt: { gte: since } }
        : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" as const } },
              { summary: { contains: search, mode: "insensitive" as const } },
              { axisHeadline: { contains: search, mode: "insensitive" as const } },
              { sourceName: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ publishedAt: "desc" }, { ingestedAt: "desc" }],
    take: Math.min(query.limit ?? 100, 200),
    include: {
      source: { select: { id: true, name: true, categories: true } },
      reviewedBy: { select: { email: true, name: true } },
      _count: { select: { campaignLinks: true } },
    },
  });
}

export async function countInbox() {
  await requireCapability(Capability.MANAGE_CONTENT);
  const prisma = getPrisma();
  const [waiting, approved, rejected] = await Promise.all([
    prisma.contentItem.count({
      where: { origin: "INGESTED", reviewState: { in: ["NEW", "PENDING_REVIEW"] } },
    }),
    prisma.contentItem.count({ where: { origin: "INGESTED", reviewState: "APPROVED" } }),
    prisma.contentItem.count({ where: { origin: "INGESTED", reviewState: "REJECTED" } }),
  ]);
  return { waiting, approved, rejected };
}

export async function getReviewItem(id: string) {
  await requireCapability(Capability.MANAGE_CONTENT);
  return getPrisma().contentItem.findUnique({
    where: { id },
    include: {
      source: { select: { id: true, name: true, baseUrl: true, categories: true } },
      reviewedBy: { select: { email: true, name: true } },
      campaignLinks: {
        select: { campaign: { select: { id: true, name: true, status: true } } },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// AXIS editorial copy
// ---------------------------------------------------------------------------

export interface EditorialInput {
  axisHeadline?: string | null;
  axisSummary?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  internalNote?: string | null;
}

function normalize(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") return null;
  return trimmed.slice(0, max);
}

/**
 * Saves AXIS's own words about an article.
 *
 * The update payload holds ONLY editorial columns. There is no `title`, no `summary`,
 * no `reviewState` and no `sourceId` in it, so this function physically cannot alter
 * what the publisher said or decide that an article is approved — the same shape that
 * keeps the language and consent paths from reaching each other (ADR-0020/0021).
 */
export async function saveEditorial(
  id: string,
  input: EditorialInput,
): Promise<ReviewResult<{ id: string }>> {
  await requireCapability(Capability.MANAGE_CONTENT);
  const prisma = getPrisma();

  const existing = await prisma.contentItem.findUnique({ where: { id } });
  if (!existing) {
    return { ok: false, errors: [{ field: "id", message: "That article no longer exists." }] };
  }

  const errors: FieldError[] = [];
  const ctaUrl = normalize(input.ctaUrl, 2000);
  if (ctaUrl) {
    // A CTA lands in a customer's inbox, so it obeys the same public-URL rule as a
    // source: no javascript:, no mailto smuggling, no internal address.
    const validated = validateSourceUrl(ctaUrl);
    if (!validated.ok) errors.push({ field: "ctaUrl", message: validated.message });
  }

  const ctaLabel = normalize(input.ctaLabel, 60);
  if (ctaLabel && !ctaUrl) {
    errors.push({
      field: "ctaUrl",
      message: "Add the address the button should open, or clear the button text.",
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  await prisma.contentItem.update({
    where: { id },
    data: {
      axisHeadline: normalize(input.axisHeadline, 300),
      axisSummary: normalize(input.axisSummary, 1200),
      ctaLabel,
      ctaUrl,
      internalNote: normalize(input.internalNote, 2000),
    },
  });

  return { ok: true, data: { id } };
}

// ---------------------------------------------------------------------------
// Approve / reject
// ---------------------------------------------------------------------------

async function setState(
  id: string,
  reviewState: "APPROVED" | "REJECTED",
): Promise<ReviewResult<{ id: string; reviewState: string }>> {
  const actor = await requireCapability(Capability.MANAGE_CONTENT);
  const prisma = getPrisma();

  const existing = await prisma.contentItem.findUnique({
    where: { id },
    select: { id: true, reviewState: true, title: true, sourceName: true },
  });
  if (!existing) {
    return { ok: false, errors: [{ field: "id", message: "That article no longer exists." }] };
  }

  await prisma.$transaction(async (tx) => {
    await tx.contentItem.update({
      where: { id },
      data: { reviewState, reviewedAt: new Date(), reviewedById: actor.id },
    });

    await tx.auditLog.create({
      data: {
        action: reviewState === "APPROVED" ? "CONTENT_APPROVED" : "CONTENT_REJECTED",
        actorUserId: actor.id,
        entityType: "ContentItem",
        entityId: id,
        fromState: existing.reviewState,
        toState: reviewState,
        // The title identifies the decision; the article's text is deliberately not
        // copied into the audit trail.
        metadata: { title: existing.title, source: existing.sourceName },
      },
    });
  });

  return { ok: true, data: { id, reviewState } };
}

export const approveContent = (id: string) => setState(id, "APPROVED");
export const rejectContent = (id: string) => setState(id, "REJECTED");

/** Returns an item to the waiting queue — a decision is reversible. */
export async function returnToInbox(id: string): Promise<ReviewResult<{ id: string }>> {
  const actor = await requireCapability(Capability.MANAGE_CONTENT);
  const prisma = getPrisma();
  const existing = await prisma.contentItem.findUnique({ where: { id } });
  if (!existing) {
    return { ok: false, errors: [{ field: "id", message: "That article no longer exists." }] };
  }
  await prisma.contentItem.update({
    where: { id },
    data: { reviewState: "PENDING_REVIEW", reviewedAt: new Date(), reviewedById: actor.id },
  });
  return { ok: true, data: { id } };
}

// ---------------------------------------------------------------------------
// Importing an article image into the AXIS media store
// ---------------------------------------------------------------------------

/** Article images are small; anything larger is a page, not a thumbnail. */
const MAX_IMPORT_BYTES = MAX_IMAGE_BYTES;

/**
 * Copies ONE external image into the AXIS media store, on explicit human request.
 *
 * Never automatic. Hot-linking a publisher's image would break the newsletter the day
 * they reorganise their CDN, and importing every image every source ever publishes
 * would be both rude and expensive. So a reviewer decides, one article at a time.
 *
 * The same guards as an upload apply, in the same order: the URL must be public
 * http(s), the response is size-capped, and the BYTES are sniffed — a file claiming
 * `image/png` in its headers proves nothing, and SVG is refused outright because it
 * is a script container.
 */
export async function importArticleImage(
  id: string,
): Promise<ReviewResult<{ id: string; url: string }>> {
  await requireCapability(Capability.MANAGE_CONTENT);
  const prisma = getPrisma();

  const item = await prisma.contentItem.findUnique({
    where: { id },
    select: { id: true, imageUrl: true, externalUrl: true, canonicalUrl: true },
  });
  if (!item) {
    return { ok: false, errors: [{ field: "id", message: "That article no longer exists." }] };
  }

  const candidate = item.imageUrl;
  const validated = validateSourceUrl(candidate);
  if (!validated.ok) {
    return { ok: false, errors: [{ field: "imageUrl", message: validated.message }] };
  }

  let response: Response;
  try {
    response = await fetch(validated.url, {
      redirect: "error", // an image redirect is not worth re-validating a hop for
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return {
      ok: false,
      errors: [{ field: "imageUrl", message: "That picture could not be downloaded." }],
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      errors: [{ field: "imageUrl", message: "That picture could not be downloaded." }],
    };
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      errors: [{ field: "imageUrl", message: "That picture is too large to use." }],
    };
  }

  // The bytes decide, not the header. SVG has no magic number here and is rejected.
  const mimeType = sniffImageMime(buffer);
  if (!mimeType) {
    return {
      ok: false,
      errors: [
        { field: "imageUrl", message: "That file is not a picture this platform can use." },
      ],
    };
  }

  const stored = await getMediaStore().put({
    originalName: `article-${item.id}`,
    mimeType,
    bytes: buffer,
  });

  await prisma.contentItem.update({
    where: { id },
    data: { imageUrl: stored.url },
  });

  return { ok: true, data: { id, url: stored.url } };
}
