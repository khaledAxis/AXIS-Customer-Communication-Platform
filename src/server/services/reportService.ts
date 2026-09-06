import "server-only";
import { Prisma } from "@prisma/client";
import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";
import { csvCell, DELIVERY_LABELS, reportRange } from "../../domain/delivery/reporting";

export interface DeliveryMetrics {
  prepared: number; attempted: number; accepted: number; delivered: number; opened: number;
  clicked: number; bounced: number; complained: number; uncertain: number; failed: number; suppressed: number;
}
const measures = Prisma.sql`
  count(r.id)::int AS prepared,
  count(r.id) FILTER (WHERE r."attemptCount">0)::int AS attempted,
  count(r.id) FILTER (WHERE r."sentAt" IS NOT NULL)::int AS accepted,
  count(r.id) FILTER (WHERE r."deliveredAt" IS NOT NULL)::int AS delivered,
  count(r.id) FILTER (WHERE r."firstOpenedAt" IS NOT NULL)::int AS opened,
  count(r.id) FILTER (WHERE r."firstClickedAt" IS NOT NULL)::int AS clicked,
  count(r.id) FILTER (WHERE r."bouncedAt" IS NOT NULL)::int AS bounced,
  count(r.id) FILTER (WHERE r."complainedAt" IS NOT NULL)::int AS complained,
  count(r.id) FILTER (WHERE r.state='UNCERTAIN')::int AS uncertain,
  count(r.id) FILTER (WHERE r.state='FAILED')::int AS failed,
  count(r.id) FILTER (WHERE r.state='SUPPRESSED')::int AS suppressed`;

export async function getDeliveryReport(input: { from?: string; to?: string; page?: number } = {}) {
  await requireCapability(Capability.VIEW_CRM);
  const range = reportRange(input.from, input.to);
  const prisma = getPrisma();
  const where = { createdAt: { gte: range.from, lt: range.until } };
  const total = await prisma.campaign.count({ where });
  const pages = Math.max(1, Math.ceil(total / 20));
  const page = Math.max(1, Math.min(pages, Math.floor(Number(input.page) || 1)));
  const [campaigns, totals, unsubs, unmatched] = await Promise.all([
    prisma.campaign.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * 20, take: 20,
      select: { id: true, name: true, status: true, language: true, createdAt: true, scheduledAt: true } }),
    prisma.$queryRaw<DeliveryMetrics[]>(Prisma.sql`SELECT ${measures} FROM "Campaign" c LEFT JOIN "CampaignRecipient" r ON r."campaignId"=c.id
      WHERE c."createdAt">=${range.from} AND c."createdAt"<${range.until}`),
    prisma.$queryRaw<{ count: number }[]>`SELECT count(u.id)::int AS count FROM "Unsubscribe" u
      JOIN "Campaign" c ON c.id=u."campaignId" WHERE c."createdAt">=${range.from} AND c."createdAt"<${range.until}`,
    prisma.providerWebhookReceipt.count({ where: { processedAt: null } }),
  ]);
  const grouped = campaigns.length ? await prisma.$queryRaw<(DeliveryMetrics & { campaignId: string })[]>(Prisma.sql`
    SELECT r."campaignId", ${measures} FROM "CampaignRecipient" r WHERE r."campaignId" IN (${Prisma.join(campaigns.map(row => row.id))}) GROUP BY r."campaignId"`) : [];
  return { range, page, pages, total, campaigns: campaigns.map(row => ({ ...row, metrics: grouped.find(m => m.campaignId === row.id) ?? null })),
    metrics: totals[0], unsubscribed: unsubs[0].count, unmatched };
}

export async function getCampaignReport(id: string, pageInput = 1, stateInput?: string) {
  await requireCapability(Capability.VIEW_CRM);
  const prisma = getPrisma();
  const campaign = await prisma.campaign.findUnique({ where: { id }, select: {
    id: true, name: true, subject: true, status: true, scheduledAt: true, sentAt: true, deliveryConfirmedCount: true,
  } });
  if (!campaign) return null;
  const state = stateInput && Object.hasOwn(DELIVERY_LABELS, stateInput) ? stateInput as Prisma.EnumCampaignRecipientStateFilter["equals"] : undefined;
  const where = { campaignId: id, ...(state ? { state } : {}) };
  const total = await prisma.campaignRecipient.count({ where });
  const pages = Math.max(1, Math.ceil(total / 100));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(pageInput) || 1)));
  const [metrics, recipients, events, unsubscribed, daily] = await Promise.all([
    prisma.$queryRaw<DeliveryMetrics[]>(Prisma.sql`SELECT ${measures} FROM "CampaignRecipient" r WHERE r."campaignId"=${id}`),
    prisma.campaignRecipient.findMany({ where, orderBy: { normalizedEmail: "asc" }, skip: (page - 1) * 100, take: 100, select: {
      id: true, normalizedEmail: true, state: true, sentAt: true, deliveredAt: true, firstOpenedAt: true, firstClickedAt: true, vetoReason: true,
    } }),
    prisma.campaignEvent.findMany({ where: { campaignId: id }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 50,
      select: { id: true, type: true, occurredAt: true, normalizedEmail: true, recipient: { select: { deliveredAt: true } } } }),
    prisma.unsubscribe.count({ where: { campaignId: id } }),
    prisma.$queryRaw<{ day: string; delivered: number; opened: number; clicked: number }[]>`
      SELECT to_char(e."occurredAt", 'YYYY-MM-DD') AS day,
        count(DISTINCT e."recipientId") FILTER (WHERE e.type='DELIVERED' AND e."occurredAt"=r."deliveredAt")::int AS delivered,
        count(DISTINCT e."recipientId") FILTER (WHERE e.type='OPENED')::int AS opened,
        count(DISTINCT e."recipientId") FILTER (WHERE e.type='CLICKED')::int AS clicked
      FROM "CampaignEvent" e LEFT JOIN "CampaignRecipient" r ON r.id=e."recipientId" WHERE e."campaignId"=${id}
      GROUP BY day ORDER BY day DESC LIMIT 90`,
  ]);
  // Older releases put ACCEPTED events in the DELIVERED bucket. Only the recorded
  // delivery timestamp proves delivery; preserve history without repeating that claim.
  const classifiedEvents = events.map(({ recipient, ...event }) => ({ ...event,
    type: event.type === "DELIVERED" && recipient?.deliveredAt?.getTime() !== event.occurredAt.getTime() ? "PROVIDER_UPDATE" : event.type }));
  return { campaign, metrics: metrics[0], recipients, events: classifiedEvents, unsubscribed, daily, total, page, pages, state: stateInput ?? "" };
}

export async function exportCampaignReport(id: string) {
  const actor = await requireCapability(Capability.VIEW_CRM);
  const prisma = getPrisma();
  const exists = await prisma.campaign.count({ where: { id } });
  if (!exists) return null;
  const rows = await prisma.campaignRecipient.findMany({ where: { campaignId: id }, take: 20001, orderBy: { normalizedEmail: "asc" },
    select: { normalizedEmail: true, state: true, attemptCount: true, sentAt: true, deliveredAt: true, firstOpenedAt: true, firstClickedAt: true,
      bouncedAt: true, complainedAt: true, vetoReason: true, finalAudienceId: true } });
  if (rows.length > 20000) throw new Error("EXPORT_TOO_LARGE");
  await prisma.auditLog.create({ data: { action: "REPORT_EXPORTED", actorUserId: actor.id, entityType: "Campaign", entityId: id, metadata: { rows: rows.length } } });
  const header = ["Email", "Status", "Attempts", "Accepted UTC", "Delivered UTC", "First open UTC", "First click UTC", "Bounced UTC", "Complaint UTC", "Exclusion reason", "Approved audience"];
  return [header.map(csvCell).join(","), ...rows.map(row => [row.normalizedEmail, DELIVERY_LABELS[row.state], row.attemptCount,
    row.sentAt, row.deliveredAt, row.firstOpenedAt, row.firstClickedAt, row.bouncedAt, row.complainedAt, row.vetoReason, row.finalAudienceId].map(csvCell).join(","))].join("\r\n");
}
