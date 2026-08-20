import { ConsentStatus, EmailStatus, ExclusionReason, Language } from "../types";

/**
 * The last gate before a production message is submitted (ADR-0024).
 *
 * WHY THIS EXISTS SEPARATELY from the audience resolution: an approved final audience
 * is a statement about a moment in the past. Somebody can unsubscribe between the
 * approval and the dispatch, and they must not receive the message. So the high-
 * authority vetoes — unsubscribe, suppression, invalid address — are re-read LIVE
 * immediately before submission and applied here.
 *
 * This is NOT a second eligibility engine. It re-checks only the facts that can veto a
 * send after approval, using the same `ExclusionReason` vocabulary, and it can only
 * ever REMOVE a recipient. Nothing here can add one: an address that the approved
 * audience did not contain has no row in the ledger to be checked in the first place.
 *
 * Pure: no I/O, no clock, no framework imports.
 */

/** Facts read live, at dispatch time, for one destination. */
export interface DispatchVetoFacts {
  isUnsubscribed: boolean;
  isSuppressed: boolean;
  emailStatus: EmailStatus;
  /** Present so a language change is visible; see `requireLanguage` below. */
  language: Language;
  consentStatus: ConsentStatus;
}

export interface DispatchCheckInput {
  facts: DispatchVetoFacts;
  /** The localized campaign's language, or null when it is not language-specific. */
  requireLanguage: Language | null;
  /** Tighten consent to an explicit GRANTED (ADR-0021). Off by default, as elsewhere. */
  requireExplicitConsent?: boolean;
}

export type DispatchDecision =
  | { send: true }
  | { send: false; reason: ExclusionReason };

/**
 * Order matters, and it is the same order the eligibility engine uses: the strongest,
 * least overridable facts first. An unsubscribe beats everything, including a
 * recorded consent — that ordering is the whole point of the rule.
 */
export function decideDispatch(input: DispatchCheckInput): DispatchDecision {
  const { facts } = input;

  if (facts.isUnsubscribed) {
    return { send: false, reason: ExclusionReason.UNSUBSCRIBED };
  }
  if (facts.isSuppressed) {
    return { send: false, reason: ExclusionReason.SUPPRESSED };
  }
  if (facts.emailStatus === EmailStatus.INVALID) {
    return { send: false, reason: ExclusionReason.INVALID_EMAIL };
  }
  if (facts.consentStatus === ConsentStatus.DENIED) {
    return { send: false, reason: ExclusionReason.CONSENT_DENIED };
  }
  if (
    input.requireExplicitConsent === true &&
    facts.consentStatus !== ConsentStatus.GRANTED
  ) {
    return { send: false, reason: ExclusionReason.CONSENT_NOT_CONFIRMED };
  }
  if (input.requireLanguage !== null && facts.language !== input.requireLanguage) {
    return { send: false, reason: ExclusionReason.LANGUAGE_UNKNOWN };
  }

  return { send: true };
}

// ---------------------------------------------------------------------------
// Delivery state machine
// ---------------------------------------------------------------------------

export const DeliveryState = {
  PENDING: "PENDING",
  READY: "READY",
  SENDING: "SENDING",
  ACCEPTED: "ACCEPTED",
  DELIVERED: "DELIVERED",
  BOUNCED: "BOUNCED",
  COMPLAINED: "COMPLAINED",
  FAILED: "FAILED",
  UNCERTAIN: "UNCERTAIN",
  SUPPRESSED: "SUPPRESSED",
  /** Legacy aggregate; never produced by new code. */
  SENT: "SENT",
} as const;
export type DeliveryState = (typeof DeliveryState)[keyof typeof DeliveryState];

/**
 * Allowed transitions.
 *
 * Two properties matter more than completeness:
 *
 *  1. **`ACCEPTED` is not `DELIVERED`.** A provider taking responsibility is a
 *     different fact from a recipient's mail server accepting the message, and only a
 *     provider event may make the second claim.
 *  2. **`UNCERTAIN` is terminal for the automation.** It has no outgoing transition to
 *     `READY` or `SENDING`, so no retry loop can be written that resends it. Only a
 *     provider event (or a human reconciling by hand) moves it on.
 */
const ALLOWED: Record<DeliveryState, readonly DeliveryState[]> = {
  PENDING: [DeliveryState.READY, DeliveryState.SUPPRESSED],
  READY: [DeliveryState.SENDING, DeliveryState.SUPPRESSED],
  SENDING: [
    DeliveryState.ACCEPTED,
    DeliveryState.FAILED,
    DeliveryState.UNCERTAIN,
  ],
  ACCEPTED: [
    DeliveryState.DELIVERED,
    DeliveryState.BOUNCED,
    DeliveryState.COMPLAINED,
    DeliveryState.FAILED,
  ],
  DELIVERED: [DeliveryState.COMPLAINED],
  // A message that was accepted but whose outcome we never learned. Reconciliation
  // may resolve it; automation may not.
  UNCERTAIN: [
    DeliveryState.DELIVERED,
    DeliveryState.BOUNCED,
    DeliveryState.COMPLAINED,
    DeliveryState.FAILED,
  ],
  FAILED: [DeliveryState.READY], // safe to retry once the cause is fixed
  BOUNCED: [],
  COMPLAINED: [],
  SUPPRESSED: [],
  SENT: [DeliveryState.DELIVERED, DeliveryState.BOUNCED, DeliveryState.COMPLAINED],
};

export function canTransition(from: DeliveryState, to: DeliveryState): boolean {
  return ALLOWED[from].includes(to);
}

export class IllegalDeliveryTransitionError extends Error {
  constructor(
    readonly from: DeliveryState,
    readonly to: DeliveryState,
  ) {
    super(`A delivery cannot move from ${from} to ${to}.`);
    this.name = "IllegalDeliveryTransitionError";
  }
}

export function assertTransition(from: DeliveryState, to: DeliveryState): void {
  if (!canTransition(from, to)) {
    throw new IllegalDeliveryTransitionError(from, to);
  }
}

/**
 * Whether the automation may submit this destination to a provider.
 *
 * `UNCERTAIN` is deliberately absent: re-submitting a message the provider may
 * already have accepted is how a customer receives the same newsletter twice.
 */
export function isSubmittable(state: DeliveryState): boolean {
  return state === DeliveryState.READY;
}

/** Terminal for the automation — nothing further will happen without a human. */
export function isTerminal(state: DeliveryState): boolean {
  return (
    state === DeliveryState.BOUNCED ||
    state === DeliveryState.COMPLAINED ||
    state === DeliveryState.SUPPRESSED
  );
}
