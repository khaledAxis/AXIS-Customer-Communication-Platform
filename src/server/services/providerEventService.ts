import "server-only";

import { DeliveryState, canTransition } from "../../domain/delivery/dispatchPolicy";
import {
  ProviderEventType,
  consequenceOf,
  type NormalizedProviderEvent,
} from "../../domain/delivery/providerEvent";
import { EmailStatus } from "../../domain/types";
import { getPrisma } from "../db/prisma";

/**
 * Ingesting provider delivery events (ADR-0024).
 *
 * This is the handler contract a vendor adapter will feed once one is chosen. It takes
 * ALREADY-VERIFIED, already-normalized events: signature checking belongs to the
 * adapter, which is the only code that knows the vendor's scheme. There is deliberately
 * no public webhook route yet — an endpoint that accepted unsigned events would be a
 * way for anyone on the internet to suppress AXIS customers.
 *
 * Two rules this file enforces, both of which outrank anything AXIS recorded:
 *
 *  - a **hard bounce** blocks the address and marks it invalid — the mailbox does not
 *    exist, and staff need to see that as a data-quality problem;
 *  - a **spam complaint** blocks the address and does NOT mark it invalid — the person
 *    has a working mailbox and does not want AXIS in it.
 *
 * Both survive `consentStatus = GRANTED`. Consent says AXIS may write; a complaint
 * says this person does not want to be written to, and the second wins. Nothing here
 * ever clears a suppression.
 */

export type IngestOutcome =
  | { ok: true; duplicate: boolean; effects: string[] }
  | { ok: false; reason: "MALFORMED"; message: string };

function isValidEvent(event: NormalizedProviderEvent): boolean {
  return (
    typeof event.providerEventId === "string" &&
    event.providerEventId.trim() !== "" &&
    typeof event.normalizedEmail === "string" &&
    event.normalizedEmail.includes("@") &&
    event.occurredAt instanceof Date &&
    !Number.isNaN(event.occurredAt.getTime())
  );
}

/**
 * Applies one normalized provider event.
 *
 * IDEMPOTENT by `providerEventId`, which every provider re-delivers. The unique index
 * on `CampaignEvent.providerEventId` is the guard: a repeat collides at the database
 * and is reported as a duplicate rather than suppressing an address twice or
 * double-counting a bounce.
 */
export async function ingestProviderEvent(
  event: NormalizedProviderEvent,
): Promise<IngestOutcome> {
  if (!isValidEvent(event)) {
    return {
      ok: false,
      reason: "MALFORMED",
      message: "That provider event could not be read.",
    };
  }

  const prisma = getPrisma();
  const normalizedEmail = event.normalizedEmail.trim().toLowerCase();
  const consequence = consequenceOf(event.type);
  const effects: string[] = [];

  // Already seen? Providers retry, so this is the normal path, not an error.
  //
  // BOTH tables are checked. An event about an address with no ledger row — a bounce
  // for a pilot, or for a delivery this platform did not record — writes only a
  // suppression, so checking `CampaignEvent` alone would miss it and the retry would
  // crash on the suppression's unique index instead of being recognised as a repeat.
  const [seenEvent, seenSuppression] = await Promise.all([
    prisma.campaignEvent.findFirst({
      where: { providerEventId: event.providerEventId },
      select: { id: true },
    }),
    prisma.suppressionEvent.findFirst({
      where: { providerEventId: event.providerEventId },
      select: { id: true },
    }),
  ]);
  if (seenEvent || seenSuppression) return { ok: true, duplicate: true, effects: [] };

  const recipient = await prisma.campaignRecipient.findFirst({
    where: {
      normalizedEmail,
      ...(event.providerMessageId
        ? { providerMessageId: event.providerMessageId }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, campaignId: true, state: true },
  });

  await prisma.$transaction(async (tx) => {
    if (recipient) {
      await tx.campaignEvent.create({
        data: {
          campaignId: recipient.campaignId,
          recipientId: recipient.id,
          normalizedEmail,
          type: toCampaignEventType(event.type),
          providerEventId: event.providerEventId,
          providerMessageId: event.providerMessageId ?? null,
          occurredAt: event.occurredAt,
          // Sanitized reason only — never a raw payload that could carry a credential.
          payload: event.reason ? { reason: event.reason } : undefined,
        },
      });
      effects.push("event recorded");

      // The state machine decides, not the event: an out-of-order webhook cannot walk
      // a delivery backwards.
      if (
        consequence.deliveryState &&
        canTransition(recipient.state as DeliveryState, consequence.deliveryState)
      ) {
        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            state: consequence.deliveryState,
            deliveredAt:
              consequence.deliveryState === DeliveryState.DELIVERED
                ? event.occurredAt
                : undefined,
            bouncedAt:
              consequence.deliveryState === DeliveryState.BOUNCED
                ? event.occurredAt
                : undefined,
            complainedAt:
              consequence.deliveryState === DeliveryState.COMPLAINED
                ? event.occurredAt
                : undefined,
            failureReason: event.reason ?? undefined,
          },
        });
        effects.push(`delivery ${consequence.deliveryState.toLowerCase()}`);
      }
    }

    if (consequence.suppression) {
      // Append-only history of the fact...
      await tx.suppressionEvent.create({
        data: {
          normalizedEmail,
          reason: consequence.suppression,
          source: "PROVIDER_WEBHOOK",
          providerEventId: event.providerEventId,
          occurredAt: event.occurredAt,
          payload: event.reason ? { reason: event.reason } : undefined,
        },
      });

      // ...and the effective state, which is what eligibility reads. Unique on
      // (normalizedEmail, reason), so a repeated bounce does not accumulate rows.
      await tx.suppression.upsert({
        where: {
          normalizedEmail_reason: {
            normalizedEmail,
            reason: consequence.suppression,
          },
        },
        create: {
          normalizedEmail,
          reason: consequence.suppression,
          occurredAt: event.occurredAt,
        },
        update: {},
      });
      effects.push(`suppressed (${consequence.suppression.toLowerCase()})`);
    }

    if (consequence.markEmailInvalid) {
      // Only a hard bounce reaches here. A complaint must NOT corrupt the address's
      // validity — the mailbox works, the person simply does not want the mail.
      await tx.communicationAddress.updateMany({
        where: { normalizedEmail },
        data: { emailStatus: EmailStatus.INVALID },
      });
      effects.push("address marked invalid");
    }

    if (consequence.unsubscribe) {
      const existing = await tx.unsubscribe.findUnique({
        where: { normalizedEmail_scope: { normalizedEmail, scope: "GLOBAL" } },
        select: { id: true },
      });
      if (!existing) {
        await tx.unsubscribe.create({
          data: {
            normalizedEmail,
            scope: "GLOBAL",
            source: "PROVIDER_WEBHOOK",
            reason: event.reason ?? "Unsubscribe reported by the email provider.",
            occurredAt: event.occurredAt,
          },
        });
        effects.push("unsubscribed");
      }
    }

    await tx.auditLog.create({
      data: {
        action: "PROVIDER_EVENT_INGESTED",
        // No actor: a provider is not an AXIS employee, exactly as a recipient is not.
        actorUserId: null,
        entityType: "CampaignRecipient",
        entityId: recipient?.id ?? null,
        toState: consequence.deliveryState ?? event.type,
        metadata: {
          normalizedEmail,
          providerEventId: event.providerEventId,
          type: event.type,
          effects,
          actor: "PROVIDER_WEBHOOK",
        },
      },
    });
  });

  return { ok: true, duplicate: false, effects };
}

function toCampaignEventType(
  type: ProviderEventType,
): "DELIVERED" | "BOUNCE" | "COMPLAINT" | "UNSUBSCRIBE" | "FAILED" | "DEFERRED" {
  switch (type) {
    case ProviderEventType.ACCEPTED:
      // No dedicated CampaignEventType exists for acceptance; DELIVERED is the closest
      // provider-event bucket, and the authoritative fact lives on the recipient's
      // state (ACCEPTED), which is what eligibility and reporting read.
      return "DELIVERED";
    case ProviderEventType.DELIVERED:
      return "DELIVERED";
    case ProviderEventType.HARD_BOUNCE:
      return "BOUNCE";
    case ProviderEventType.SOFT_BOUNCE:
      return "DEFERRED";
    case ProviderEventType.COMPLAINT:
      return "COMPLAINT";
    case ProviderEventType.UNSUBSCRIBE:
      return "UNSUBSCRIBE";
    case ProviderEventType.FAILED:
      return "FAILED";
  }
}
