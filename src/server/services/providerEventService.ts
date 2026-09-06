import "server-only";
import type { Prisma } from "@prisma/client";
import { canTransition } from "../../domain/delivery/dispatchPolicy";
import { ProviderEventType, consequenceOf, type NormalizedProviderEvent } from "../../domain/delivery/providerEvent";
import { getPrisma } from "../db/prisma";

export type IngestOutcome =
  | { ok: true; duplicate: boolean; effects: string[] }
  | { ok: false; reason: "MALFORMED"; message: string };

const EVENT_TYPES = {
  ACCEPTED: "ACCEPTED", DELIVERED: "DELIVERED", OPENED: "OPENED", CLICKED: "CLICKED",
  HARD_BOUNCE: "BOUNCE", SOFT_BOUNCE: "DEFERRED", COMPLAINT: "COMPLAINT",
  UNSUBSCRIBE: "UNSUBSCRIBE", FAILED: "FAILED",
} as const;

/** Store verified normalized facts first: webhooks can beat the send response. */
export async function ingestProviderEvent(event: NormalizedProviderEvent): Promise<IngestOutcome> {
  if (!event || typeof event.providerEventId !== "string" || !event.providerEventId.trim() ||
    event.providerEventId.length > 256 || !Object.values(ProviderEventType).includes(event.type) ||
    typeof event.normalizedEmail !== "string" || !event.normalizedEmail.includes("@") ||
    !(event.occurredAt instanceof Date) || !Number.isFinite(event.occurredAt.getTime()))
    return { ok: false, reason: "MALFORMED", message: "That provider event could not be read." };
  const inserted = await getPrisma().providerWebhookReceipt.createMany({ skipDuplicates: true, data: [{
    providerEventId: event.providerEventId,
    normalizedEvent: { ...event, normalizedEmail: event.normalizedEmail.trim().toLowerCase(),
      occurredAt: event.occurredAt.toISOString() } as Prisma.InputJsonObject,
  }] });
  const effects = await applyReceipt(event.providerEventId);
  return { ok: true, duplicate: inserted.count === 0, effects };
}

async function applyReceipt(id: string): Promise<string[]> {
  return getPrisma().$transaction(async tx => {
    await tx.$queryRaw`SELECT "providerEventId" FROM "ProviderWebhookReceipt" WHERE "providerEventId"=${id} FOR UPDATE`;
    const receipt = await tx.providerWebhookReceipt.findUniqueOrThrow({ where: { providerEventId: id } });
    if (receipt.processedAt) return [];
    const stored = receipt.normalizedEvent as unknown as Omit<NormalizedProviderEvent, "occurredAt"> & { occurredAt: string };
    const event = { ...stored, occurredAt: new Date(stored.occurredAt) };
    const normalizedEmail = event.normalizedEmail;
    const consequence = consequenceOf(event.type);
    const effects: string[] = [];
    // An email alone cannot identify a campaign. Never guess the newest send.
    let recipient = event.providerMessageId ? await tx.campaignRecipient.findFirst({
      where: { normalizedEmail, providerMessageId: event.providerMessageId },
    }) : null;
    // Pilot receipts are retained, but never create customer ledger/events.
    const pilot = !recipient && event.providerMessageId ? await tx.campaignTestSend.findFirst({
      where: { toEmail: normalizedEmail, providerMessageId: event.providerMessageId, channel: "PROVIDER_PILOT" },
      select: { id: true },
    }) : null;
    if (recipient) {
      await tx.$queryRaw`SELECT id FROM "CampaignRecipient" WHERE id=${recipient.id} FOR UPDATE`;
      recipient = await tx.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
      const recorded = await tx.campaignEvent.createMany({ skipDuplicates: true, data: [{
        campaignId: recipient.campaignId, recipientId: recipient.id, normalizedEmail,
        type: EVENT_TYPES[event.type], providerEventId: id, providerMessageId: event.providerMessageId,
        occurredAt: event.occurredAt, payload: event.reason ? { reason: event.reason } : undefined,
      }] });
      if (recorded.count) {
        const earlier = (old: Date | null) => !old || event.occurredAt < old ? event.occurredAt : old;
        const data: Prisma.CampaignRecipientUpdateInput = {};
        if (consequence.deliveryState && canTransition(recipient.state, consequence.deliveryState)) {
          data.state = consequence.deliveryState;
          effects.push(`delivery ${consequence.deliveryState.toLowerCase()}`);
        }
        // Signed facts remain valid after an out-of-order complaint. Opens never prove delivery.
        if (event.type === "ACCEPTED") data.sentAt = earlier(recipient.sentAt);
        if (event.type === "DELIVERED") data.deliveredAt = earlier(recipient.deliveredAt);
        if (event.type === "OPENED") data.firstOpenedAt = earlier(recipient.firstOpenedAt);
        if (event.type === "CLICKED") data.firstClickedAt = earlier(recipient.firstClickedAt);
        if (event.type === "HARD_BOUNCE") data.bouncedAt = earlier(recipient.bouncedAt);
        if (event.type === "COMPLAINT") data.complainedAt = earlier(recipient.complainedAt);
        await tx.campaignRecipient.update({ where: { id: recipient.id }, data });
        effects.push("event recorded");
      }
    }
    if (!receipt.effectsAppliedAt) {
      if (consequence.suppression) {
        await tx.suppressionEvent.createMany({ skipDuplicates: true, data: [{ normalizedEmail,
          reason: consequence.suppression, source: "PROVIDER_WEBHOOK", providerEventId: id,
          occurredAt: event.occurredAt, payload: event.reason ? { reason: event.reason } : undefined,
        }] });
        await tx.suppression.upsert({ where: { normalizedEmail_reason: { normalizedEmail, reason: consequence.suppression } },
          create: { normalizedEmail, reason: consequence.suppression, occurredAt: event.occurredAt }, update: {} });
        effects.push(`suppressed (${consequence.suppression.toLowerCase()})`);
      }
      if (consequence.markEmailInvalid) {
        await tx.communicationAddress.updateMany({ where: { normalizedEmail }, data: { emailStatus: "INVALID" } });
        effects.push("address marked invalid");
      }
      if (consequence.unsubscribe) {
        await tx.unsubscribe.upsert({ where: { normalizedEmail_scope: { normalizedEmail, scope: "GLOBAL" } },
          create: { normalizedEmail, scope: "GLOBAL", source: "PROVIDER_WEBHOOK", campaignId: recipient?.campaignId,
            reason: event.reason ?? "Unsubscribe reported by the email provider.", occurredAt: event.occurredAt }, update: {} });
        effects.push("unsubscribed");
      }
      await tx.auditLog.create({ data: { action: "PROVIDER_EVENT_INGESTED", actorUserId: null,
        entityType: "CampaignRecipient", entityId: recipient?.id, toState: consequence.deliveryState ?? event.type,
        metadata: { normalizedEmail, providerEventId: id, type: event.type, effects, actor: "PROVIDER_WEBHOOK" } } });
    }
    await tx.providerWebhookReceipt.update({ where: { providerEventId: id }, data: {
      effectsAppliedAt: receipt.effectsAppliedAt ?? new Date(),
      processedAt: recipient || pilot || !event.providerMessageId ? new Date() : null,
    } });
    return effects;
  });
}

/** Skip unmatched orphans so old receipts cannot starve new correlations. */
export async function reconcileProviderReceipts() {
  const pending = await getPrisma().$queryRaw<{ providerEventId: string }[]>`
    SELECT r."providerEventId" FROM "ProviderWebhookReceipt" r
    WHERE r."processedAt" IS NULL AND (EXISTS (
      SELECT 1 FROM "CampaignRecipient" c
      WHERE c."providerMessageId" = r."normalizedEvent"->>'providerMessageId'
      AND c."normalizedEmail" = r."normalizedEvent"->>'normalizedEmail') OR EXISTS (
      SELECT 1 FROM "CampaignTestSend" t
      WHERE t."channel" = 'PROVIDER_PILOT'
      AND t."providerMessageId" = r."normalizedEvent"->>'providerMessageId'
      AND t."toEmail" = r."normalizedEvent"->>'normalizedEmail'))
    ORDER BY r."receivedAt" LIMIT 100`;
  for (const row of pending) await applyReceipt(row.providerEventId);
  return pending.length;
}
