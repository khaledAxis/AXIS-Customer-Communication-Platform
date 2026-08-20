import { DeliveryState } from "./dispatchPolicy";

/**
 * Normalized provider events, and what each one obliges AXIS to do (ADR-0024).
 *
 * A vendor adapter's job is to turn its own webhook payload into one of these; nothing
 * downstream ever sees a vendor's field names. That is what keeps ADR-0004's promise
 * that switching providers means writing one adapter.
 *
 * The consequences below are the interesting part. A hard bounce and a spam complaint
 * are not merely status updates — they are instructions that AXIS must never mail this
 * address again, and they must outrank a recorded consent. Encoding that here, once,
 * means no adapter can forget it.
 *
 * Pure: no I/O, no framework imports.
 */

export const ProviderEventType = {
  /**
   * The provider accepted the message and handed it to the receiving server. NOT
   * delivery — Resend calls this `email.sent`, and calling it "sent" in our own
   * vocabulary is exactly the confusion ADR-0024 exists to prevent.
   */
  ACCEPTED: "ACCEPTED",
  DELIVERED: "DELIVERED",
  HARD_BOUNCE: "HARD_BOUNCE",
  SOFT_BOUNCE: "SOFT_BOUNCE",
  COMPLAINT: "COMPLAINT",
  FAILED: "FAILED",
  /** The provider itself recorded an unsubscribe (a list-level opt-out it hosts). */
  UNSUBSCRIBE: "UNSUBSCRIBE",
} as const;
export type ProviderEventType =
  (typeof ProviderEventType)[keyof typeof ProviderEventType];

export interface NormalizedProviderEvent {
  /**
   * The provider's own event id. UNIQUE in the database, so the same webhook
   * delivered twice — which every provider does — is recorded once.
   */
  providerEventId: string;
  type: ProviderEventType;
  /** Lower-cased recipient address the event concerns. */
  normalizedEmail: string;
  /** Ties the event to a submission when the provider returns one. */
  providerMessageId?: string | null;
  occurredAt: Date;
  /** Sanitized provider reason. Never a credential, never a raw header dump. */
  reason?: string | null;
}

/** What the platform must do as a result. */
export interface EventConsequence {
  /** The delivery state this event proves, if any. */
  deliveryState: DeliveryState | null;
  /**
   * A hard, address-level block. `HARD_BOUNCE` and `COMPLAINT` produce one; a soft
   * bounce does not, because a full mailbox is temporary.
   */
  suppression: "HARD_BOUNCE" | "COMPLAINT" | null;
  /**
   * Whether the address itself should be marked unusable. Only a hard bounce means
   * "this mailbox does not exist" — a complaint means "this person does not want it",
   * which is a different fact and must not corrupt the address's validity.
   */
  markEmailInvalid: boolean;
  /** Whether the address should be globally unsubscribed. */
  unsubscribe: boolean;
}

/**
 * The single mapping from an event to its consequences.
 *
 * Note what a COMPLAINT does and does not do: it suppresses (so no future campaign can
 * reach the address) but does NOT mark the address invalid. Somebody who reports spam
 * has a working mailbox; pretending otherwise would corrupt the data-quality signal
 * that `emailStatus` exists to carry.
 */
export function consequenceOf(type: ProviderEventType): EventConsequence {
  switch (type) {
    case ProviderEventType.ACCEPTED:
      // Acceptance is a real fact worth recording, and it is not delivery. The state
      // machine refuses ACCEPTED once a delivery has already been confirmed, so an
      // out-of-order webhook cannot walk a delivery backwards.
      return {
        deliveryState: DeliveryState.ACCEPTED,
        suppression: null,
        markEmailInvalid: false,
        unsubscribe: false,
      };

    case ProviderEventType.DELIVERED:
      return {
        deliveryState: DeliveryState.DELIVERED,
        suppression: null,
        markEmailInvalid: false,
        unsubscribe: false,
      };

    case ProviderEventType.HARD_BOUNCE:
      // The mailbox does not exist. Block it, and record the address as invalid so
      // staff can see the data-quality problem and fix it in Monday.
      return {
        deliveryState: DeliveryState.BOUNCED,
        suppression: "HARD_BOUNCE",
        markEmailInvalid: true,
        unsubscribe: false,
      };

    case ProviderEventType.SOFT_BOUNCE:
      // Temporary — a full mailbox, a greylisting server. Not a reason to block anyone
      // forever, and deliberately not a state change either.
      return {
        deliveryState: null,
        suppression: null,
        markEmailInvalid: false,
        unsubscribe: false,
      };

    case ProviderEventType.COMPLAINT:
      // Reported as spam. The strongest signal a recipient can send, and it must
      // outrank a recorded consent — see `mustSurviveConsent` below.
      return {
        deliveryState: DeliveryState.COMPLAINED,
        suppression: "COMPLAINT",
        markEmailInvalid: false,
        unsubscribe: false,
      };

    case ProviderEventType.UNSUBSCRIBE:
      return {
        deliveryState: null,
        suppression: null,
        markEmailInvalid: false,
        unsubscribe: true,
      };

    case ProviderEventType.FAILED:
      return {
        deliveryState: DeliveryState.FAILED,
        suppression: null,
        markEmailInvalid: false,
        unsubscribe: false,
      };
  }
}

/**
 * States this file asserts explicitly, because they are the ones a future change is
 * most likely to get wrong: a suppression created by a bounce or a complaint must
 * survive a GRANTED consent. Consent says AXIS may write; a complaint says this person
 * does not want to be written to. The second wins.
 */
export function mustSurviveConsent(consequence: EventConsequence): boolean {
  return consequence.suppression !== null;
}

export type ProviderEventRejection =
  | "MALFORMED"
  | "UNSIGNED"
  | "UNKNOWN_PROVIDER"
  | "DUPLICATE";
