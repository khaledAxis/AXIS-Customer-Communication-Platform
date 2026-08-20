import { hasHeaderInjection } from "../send/testSendPolicy";

/**
 * The internal PROVIDER PILOT (ADR-0025).
 *
 * A pilot proves that the *production* transport — Resend, sending as an AXIS domain
 * — actually reaches an inbox. It is NOT production delivery: it can reach exactly one
 * address, and that address is a constant in this file.
 *
 * The safety shape is copied deliberately from the Gmail SAFE TEST policy (ADR-0013),
 * because it worked: the audience is UNREPRESENTABLE rather than merely validated.
 * `PilotMessage` has no `from`, `cc`, `bcc` or `replyTo`, and `to` is a single string.
 * There is no field with which a caller could widen the audience, and no campaign,
 * segment or browser value feeds it.
 *
 * Pure: no I/O, no framework imports.
 */

/**
 * The ONLY address a provider pilot may reach. Hard-coded, cross-checked against
 * configuration, and never read from a campaign, a form, or an environment variable
 * that could redirect it.
 */
export const AUTHORIZED_PILOT_RECIPIENT = "khaled-s@axis-gps.com" as const;

/** The production sender identity a pilot proves. Never the Gmail SAFE TEST address. */
export const PRODUCTION_SENDER_EMAIL = "newsletter@axis-gps.com" as const;
export const PRODUCTION_SENDER_NAME = "AXIS Advanced Mapping Solutions" as const;

/** Marks every pilot message so it can never be mistaken for a customer newsletter. */
export const PILOT_SUBJECT_PREFIX = "[AXIS PROVIDER PILOT]" as const;

/**
 * Apply the marker exactly once. Rendering repeatedly, re-approving or re-sending must
 * never produce "[AXIS PROVIDER PILOT] [AXIS PROVIDER PILOT] …".
 */
export function applyPilotSubjectPrefix(subject: string): string {
  const trimmed = subject.trim();
  if (trimmed.startsWith(PILOT_SUBJECT_PREFIX)) return trimmed;
  return `${PILOT_SUBJECT_PREFIX} ${trimmed}`;
}

export type PilotEnvelopeRejection =
  | "NOT_AUTHORIZED_RECIPIENT"
  | "MULTIPLE_RECIPIENTS"
  | "COPY_RECIPIENTS_FORBIDDEN"
  | "HEADER_INJECTION"
  | "SENDER_NOT_AUTHORIZED";

export const PILOT_ENVELOPE_MESSAGE: Record<PilotEnvelopeRejection, string> = {
  NOT_AUTHORIZED_RECIPIENT: `A provider pilot can only be sent to ${AUTHORIZED_PILOT_RECIPIENT}.`,
  MULTIPLE_RECIPIENTS: "A provider pilot has exactly one recipient.",
  COPY_RECIPIENTS_FORBIDDEN: "A provider pilot cannot carry CC or BCC recipients.",
  HEADER_INJECTION: "That address contains characters that are not allowed.",
  SENDER_NOT_AUTHORIZED: `A provider pilot must be sent as ${PRODUCTION_SENDER_EMAIL}.`,
};

export class UnsafePilotEnvelopeError extends Error {
  readonly reason: PilotEnvelopeRejection;

  constructor(reason: PilotEnvelopeRejection) {
    super(PILOT_ENVELOPE_MESSAGE[reason]);
    this.name = "UnsafePilotEnvelopeError";
    this.reason = reason;
  }
}

export function isAuthorizedPilotRecipient(address: unknown): boolean {
  return (
    typeof address === "string" &&
    address.trim().toLowerCase() === AUTHORIZED_PILOT_RECIPIENT
  );
}

/**
 * Anything that could widen a pilot's audience.
 *
 * Accepts `unknown` on purpose: this is the last gate before the network, so it has to
 * be able to refuse a shape the type system was told could not exist.
 */
export interface PilotEnvelopeCandidate {
  to: unknown;
  cc?: unknown;
  bcc?: unknown;
  from?: unknown;
}

/**
 * The last gate before a pilot reaches the provider.
 *
 * REFUSES rather than trims. A caller-supplied `cc` is not quietly dropped — the whole
 * submission is rejected, because a caller that supplied one has misunderstood
 * something and the safe response is to stop.
 */
export function assertSafePilotEnvelope(candidate: PilotEnvelopeCandidate): string {
  if (candidate.cc !== undefined || candidate.bcc !== undefined) {
    throw new UnsafePilotEnvelopeError("COPY_RECIPIENTS_FORBIDDEN");
  }
  if (Array.isArray(candidate.to)) {
    throw new UnsafePilotEnvelopeError("MULTIPLE_RECIPIENTS");
  }
  if (typeof candidate.to !== "string") {
    throw new UnsafePilotEnvelopeError("NOT_AUTHORIZED_RECIPIENT");
  }
  if (hasHeaderInjection(candidate.to)) {
    throw new UnsafePilotEnvelopeError("HEADER_INJECTION");
  }
  // A comma or semicolon would be a second recipient smuggled into one string.
  if (candidate.to.includes(",") || candidate.to.includes(";")) {
    throw new UnsafePilotEnvelopeError("MULTIPLE_RECIPIENTS");
  }
  if (!isAuthorizedPilotRecipient(candidate.to)) {
    throw new UnsafePilotEnvelopeError("NOT_AUTHORIZED_RECIPIENT");
  }
  if (
    candidate.from !== undefined &&
    (typeof candidate.from !== "string" ||
      candidate.from.trim().toLowerCase() !== PRODUCTION_SENDER_EMAIL)
  ) {
    throw new UnsafePilotEnvelopeError("SENDER_NOT_AUTHORIZED");
  }

  return AUTHORIZED_PILOT_RECIPIENT;
}

// ---------------------------------------------------------------------------
// Which channel a submission belongs to
// ---------------------------------------------------------------------------

/**
 * The three ways a message can leave this platform. They are separate channels, not
 * settings on one channel, and nothing may cross between them.
 */
export const SendChannel = {
  /** Gmail SMTP → khaled-s@axis-gps.com. Unchanged since ADR-0014. */
  SAFE_TEST_GMAIL: "SAFE_TEST_GMAIL",
  /** Resend → khaled-s@axis-gps.com, as newsletter@axis-gps.com. Internal only. */
  PROVIDER_PILOT: "PROVIDER_PILOT",
} as const;
export type SendChannel = (typeof SendChannel)[keyof typeof SendChannel];

export type PilotBlocker =
  | "PROVIDER_NOT_CONFIGURED"
  | "PILOT_MODE_OFF"
  | "DOMAIN_NOT_VERIFIED"
  | "NO_CONTENT"
  | "NOT_APPROVED";

export const PILOT_BLOCKER_MESSAGE: Record<PilotBlocker, string> = {
  PROVIDER_NOT_CONFIGURED:
    "Resend is not configured. Add RESEND_API_KEY to .env.local and restart the server.",
  PILOT_MODE_OFF:
    "The provider pilot is switched off. Set PROVIDER_PILOT_ENABLED=true in .env.local to allow one internal test send.",
  DOMAIN_NOT_VERIFIED:
    "The AXIS sending domain is not verified with Resend yet, so a pilot would be rejected or land in spam.",
  NO_CONTENT: "Add at least one article before running a provider pilot.",
  NOT_APPROVED:
    "Preview and approve this exact message before sending the provider pilot.",
};

export interface PilotAvailabilityInput {
  providerConfigured: boolean;
  pilotModeEnabled: boolean;
  domainVerified: boolean;
  hasContent: boolean;
}

export interface PilotAvailability {
  available: boolean;
  blockers: PilotBlocker[];
  messages: string[];
}

/**
 * Whether an internal pilot may run at all.
 *
 * Deliberately strict about the domain: an unverified sending domain does not merely
 * risk the spam folder, it teaches the wrong lesson — a pilot that "worked" from an
 * unauthenticated domain proves nothing about what a customer send would do.
 */
export function evaluatePilotAvailability(
  input: PilotAvailabilityInput,
): PilotAvailability {
  const blockers: PilotBlocker[] = [];
  if (!input.providerConfigured) blockers.push("PROVIDER_NOT_CONFIGURED");
  if (!input.pilotModeEnabled) blockers.push("PILOT_MODE_OFF");
  if (!input.domainVerified) blockers.push("DOMAIN_NOT_VERIFIED");
  if (!input.hasContent) blockers.push("NO_CONTENT");

  return {
    available: blockers.length === 0,
    blockers,
    messages: blockers.map((blocker) => PILOT_BLOCKER_MESSAGE[blocker]),
  };
}
