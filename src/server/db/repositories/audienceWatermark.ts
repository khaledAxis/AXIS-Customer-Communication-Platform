import "server-only";

import type { PrismaClient } from "@prisma/client";

/**
 * Accepts either the client or an interactive transaction client, so a caller that
 * needs two consistent readings can take them inside one snapshot.
 */
type WatermarkClient = PrismaClient | Omit<PrismaClient, "$transaction" | "$connect" | "$disconnect" | "$on" | "$extends">;

/**
 * A cheap fingerprint of everything that can move a person in or out of an audience
 * (ADR-0023 §readiness cost).
 *
 * WHY THIS EXISTS: resolving an audience reads ~1,130 CRM records plus their
 * communication profiles. The readiness screen was doing that on every page load, and
 * a handful of rapid loads was enough to saturate a development server. But readiness
 * cannot simply cache — a stale "everything is fine" is precisely the dangerous
 * answer.
 *
 * WHY IT IS SAFE: the watermark covers EVERY table the resolution reads. It is used
 * in one direction only — when the stored watermark still matches, nothing relevant
 * has been written since the snapshot was frozen, so the frozen result is provably
 * still current and the expensive work is skipped. Any mismatch, any unknown value,
 * any pre-existing row with an empty watermark: full re-resolution. The optimisation
 * can only ever fail towards doing MORE work.
 *
 * Each table contributes a row count and its newest timestamp:
 *
 *  - `@updatedAt` columns move on every write, so an edit is caught even when the
 *    count is unchanged;
 *  - the count catches inserts and deletes;
 *  - append-only tables (`Unsubscribe`, `Suppression`) have no `updatedAt`, and do
 *    not need one — a row is never edited, only added.
 *
 * The one case a (count, max-timestamp) pair cannot distinguish is a delete and an
 * insert landing in the same millisecond while leaving the count identical AND the
 * newest timestamp unchanged. That cannot arise here: this platform never hard-deletes
 * a mirrored CRM record (archive-on-delete, ADR-0009), and any insert sets a
 * timestamp at least as new as the one it replaced.
 */

export interface WatermarkSource {
  /** Table name, for a readable fingerprint and easier debugging. */
  table: string;
  count: number;
  newest: Date | null;
}

/**
 * Runs one table's pair of aggregates.
 *
 * The `_max` result is read through a permissive shape rather than each model's
 * generated type: this helper is called for eleven different models, and threading a
 * distinct generic through every call would add noise without adding safety — the
 * field name is a literal at each call site.
 */
async function aggregate(
  table: string,
  count: Promise<number>,
  newest: Promise<unknown>,
  field: string,
): Promise<WatermarkSource> {
  const [c, n] = await Promise.all([count, newest]);
  const max = (n as { _max?: Record<string, unknown> })._max ?? {};
  const value = max[field];
  return { table, count: c, newest: value instanceof Date ? value : null };
}

/**
 * Computes the watermark for one campaign's audience.
 *
 * The campaign and its segment are included because their own fields (language,
 * chosen segment, segment rules) are inputs to the resolution just as much as the CRM
 * rows are.
 */
export async function computeAudienceWatermark(
  prisma: WatermarkClient,
  campaignId: string,
): Promise<string> {
  const sources = await Promise.all([
    aggregate(
      "Company",
      prisma.company.count(),
      prisma.company.aggregate({ _max: { updatedAt: true } }),
      "updatedAt",
    ),
    aggregate(
      "Contact",
      prisma.contact.count(),
      prisma.contact.aggregate({ _max: { updatedAt: true } }),
      "updatedAt",
    ),
    aggregate(
      "CompanyContact",
      prisma.companyContact.count(),
      prisma.companyContact.aggregate({ _max: { updatedAt: true } }),
      "updatedAt",
    ),
    aggregate(
      "Product",
      prisma.product.count(),
      prisma.product.aggregate({ _max: { updatedAt: true } }),
      "updatedAt",
    ),
    aggregate(
      "CustomerProduct",
      prisma.customerProduct.count(),
      prisma.customerProduct.aggregate({ _max: { updatedAt: true } }),
      "updatedAt",
    ),
    aggregate(
      "CompanyProduct",
      prisma.companyProduct.count(),
      prisma.companyProduct.aggregate({ _max: { updatedAt: true } }),
      "updatedAt",
    ),
    aggregate(
      "Industry",
      prisma.industry.count(),
      prisma.industry.aggregate({ _max: { updatedAt: true } }),
      "updatedAt",
    ),
    aggregate(
      "CustomerClassification",
      prisma.customerClassification.count(),
      prisma.customerClassification.aggregate({ _max: { updatedAt: true } }),
      "updatedAt",
    ),
    aggregate(
      "CommunicationAddress",
      prisma.communicationAddress.count(),
      prisma.communicationAddress.aggregate({ _max: { updatedAt: true } }),
      "updatedAt",
    ),
    // Append-only: a row is created and never edited, so `createdAt` is enough.
    aggregate(
      "Unsubscribe",
      prisma.unsubscribe.count(),
      prisma.unsubscribe.aggregate({ _max: { createdAt: true } }),
      "createdAt",
    ),
    aggregate(
      "Suppression",
      prisma.suppression.count(),
      prisma.suppression.aggregate({ _max: { createdAt: true } }),
      "createdAt",
    ),
  ]);

  // The campaign's own audience inputs. Read directly rather than aggregated, because
  // a change to either must invalidate this campaign's watermark specifically.
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      language: true,
      segmentId: true,
      updatedAt: true,
      segment: { select: { updatedAt: true, isActive: true } },
    },
  });

  const parts = sources.map(
    (source) => `${source.table}:${source.count}:${source.newest?.toISOString() ?? "-"}`,
  );
  parts.push(
    `Campaign:${campaign?.language ?? "-"}:${campaign?.segmentId ?? "-"}:${campaign?.updatedAt.toISOString() ?? "-"}`,
    `Segment:${campaign?.segment?.updatedAt.toISOString() ?? "-"}:${campaign?.segment?.isActive ?? "-"}`,
  );

  return parts.join("|");
}
