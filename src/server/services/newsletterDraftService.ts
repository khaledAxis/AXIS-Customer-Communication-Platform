import "server-only";

import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";

/**
 * Building a newsletter DRAFT from approved articles (ADR-0026).
 *
 * Read the list of things this deliberately does NOT do, because that list is the
 * feature:
 *
 *  - it does not choose a segment (`segmentId` stays null);
 *  - it does not prepare a final audience;
 *  - it does not create a `CampaignRecipient`;
 *  - it does not approve anything;
 *  - it does not call an email provider, of either kind.
 *
 * It creates a `Campaign` in `DRAFT` with some `CampaignContentItem` rows in an order,
 * which is precisely what a person would have done by hand — the saving is the typing,
 * not the judgement. Everything downstream (audience, approval, four-eyes, the send
 * gate) is untouched and still required.
 *
 * **Only APPROVED items may be attached.** An unreviewed article cannot enter a
 * newsletter through this path even if its id is supplied directly, because the query
 * that loads the items filters on `reviewState`. That is a server-side filter, not a
 * UI convenience.
 */

export interface DraftFromContentInput {
  /** Ordered: the FIRST id becomes the featured/hero article. */
  contentItemIds: string[];
  name?: string | null;
  subject?: string | null;
  preheader?: string | null;
  language?: string | null;
}

export type DraftResult =
  | { ok: true; campaignId: string; attached: number; message: string }
  | { ok: false; reason: string; message: string };

/** Upper bound on one newsletter. A 60-article email is nobody's intent. */
export const MAX_ITEMS_PER_DRAFT = 20;

/**
 * A starting subject, not a finished one.
 *
 * Derived mechanically from the featured article so the draft does not open blank;
 * a person edits it before anything is approved. Deliberately NOT generated text —
 * there is no AI integration in this platform, and this milestone does not add one.
 */
export function suggestSubject(
  featuredTitle: string | null,
  itemCount: number,
): string {
  const headline = featuredTitle?.trim();
  if (!headline) return "AXIS update";
  const trimmed = headline.length > 70 ? `${headline.slice(0, 69).trimEnd()}…` : headline;
  return itemCount > 1 ? `${trimmed} — and ${itemCount - 1} more` : trimmed;
}

export function suggestPreheader(itemCount: number): string {
  return itemCount === 1
    ? "This month's update from AXIS."
    : `${itemCount} updates from AXIS Advanced Mapping Solutions.`;
}

/**
 * Creates the draft.
 *
 * The whole thing is one transaction: a campaign with no articles, or articles
 * attached to a campaign that failed to save, would both be worse than no draft.
 */
export async function createDraftFromContent(
  input: DraftFromContentInput,
): Promise<DraftResult> {
  const actor = await requireCapability(Capability.MANAGE_NEWSLETTERS);
  const prisma = getPrisma();

  const requested = Array.from(new Set(input.contentItemIds ?? [])).slice(
    0,
    MAX_ITEMS_PER_DRAFT,
  );
  if (requested.length === 0) {
    return {
      ok: false,
      reason: "NO_SELECTION",
      message: "Choose at least one approved article to put in the newsletter.",
    };
  }

  // APPROVED only. The filter is here, in the query, so supplying the id of an
  // unreviewed or rejected article simply returns nothing for it.
  const items = await prisma.contentItem.findMany({
    where: { id: { in: requested }, reviewState: "APPROVED" },
    select: {
      id: true,
      title: true,
      axisHeadline: true,
      language: true,
    },
  });

  if (items.length === 0) {
    return {
      ok: false,
      reason: "NONE_APPROVED",
      message:
        "None of those articles have been approved yet. Approve them in the review inbox first.",
    };
  }

  // Preserve the order the person chose — the first is the hero (ADR-0015).
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = requested
    .map((id) => byId.get(id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);

  const featured = ordered[0];
  const language =
    input.language && ["HE", "AR", "UNKNOWN"].includes(input.language)
      ? input.language
      : // Fall back to the featured article's language rather than assuming Hebrew.
        featured.language;

  const headline = featured.axisHeadline ?? featured.title;
  const subject = input.subject?.trim() || suggestSubject(headline, ordered.length);
  const name = input.name?.trim() || subject;

  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.campaign.create({
      data: {
        name: name.slice(0, 200),
        subject: subject.slice(0, 300),
        preheader: input.preheader?.trim() || suggestPreheader(ordered.length),
        language: language as "HE" | "AR" | "UNKNOWN",
        // DRAFT, and no segment. Both are deliberate: choosing who receives a
        // newsletter is a separate human decision with its own screen and its own
        // audit trail (ADR-0018/0022).
        status: "DRAFT",
        createdById: actor.id,
      },
    });

    await tx.campaignContentItem.createMany({
      data: ordered.map((item, index) => ({
        campaignId: created.id,
        contentItemId: item.id,
        position: index,
        isIncluded: true,
      })),
    });

    await tx.auditLog.create({
      data: {
        action: "NEWSLETTER_DRAFT_CREATED_FROM_CONTENT",
        actorUserId: actor.id,
        entityType: "Campaign",
        entityId: created.id,
        toState: "DRAFT",
        metadata: {
          itemCount: ordered.length,
          contentItemIds: ordered.map((item) => item.id),
          featuredContentItemId: featured.id,
          // Recorded so it is provable afterwards that this path chose nobody.
          segmentId: null,
        },
      },
    });

    return created;
  });

  const dropped = requested.length - ordered.length;

  return {
    ok: true,
    campaignId: campaign.id,
    attached: ordered.length,
    message:
      dropped > 0
        ? `Draft created with ${ordered.length} article${ordered.length === 1 ? "" : "s"}. ${dropped} were skipped because they are not approved.`
        : `Draft created with ${ordered.length} article${ordered.length === 1 ? "" : "s"}. Nothing has been sent, and no recipients have been chosen.`,
  };
}

/** Approved, ingested articles not yet used by any newsletter — the picking list. */
export async function listApprovedForDraft(limit = 100) {
  await requireCapability(Capability.MANAGE_NEWSLETTERS);
  return getPrisma().contentItem.findMany({
    where: { reviewState: "APPROVED" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: Math.min(limit, 200),
    include: {
      source: { select: { name: true } },
      _count: { select: { campaignLinks: true } },
    },
  });
}
