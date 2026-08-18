/**
 * SAFE TEST send policy (ADR-0008 / ADR-0012).
 *
 * The test-send surface is deliberately NOT configurable from the UI: exactly one
 * sender and exactly one recipient are authorized, both hard-coded here and covered
 * by tests. A request carrying any other recipient is rejected server-side — hiding
 * the field in the UI is not a control.
 *
 * NOTHING in this module sends email. No provider exists yet; `testSendAvailability`
 * reports why sending is unavailable so the UI can explain it honestly.
 *
 * Pure: no I/O, no framework imports.
 */

import type { SafeSendConfig } from "./safeSend";

/** The ONLY address permitted to appear as the sender of a test email. */
export const AUTHORIZED_TEST_SENDER = "fahed@axis-gps.com" as const;

/** The ONLY address permitted to receive a test email. */
export const AUTHORIZED_TEST_RECIPIENT = "khaled-s@axis-gps.com" as const;

/** Canonical TEST-mode configuration for the safe-send resolver. */
export function testSendConfig(): SafeSendConfig {
  return {
    mode: "TEST",
    safeFrom: AUTHORIZED_TEST_SENDER,
    safeRedirectTo: AUTHORIZED_TEST_RECIPIENT,
  };
}

export class UnauthorizedTestRecipientError extends Error {
  constructor(attempted: string) {
    super(
      `Test email may only be addressed to ${AUTHORIZED_TEST_RECIPIENT}. Rejected: ${attempted}`,
    );
    this.name = "UnauthorizedTestRecipientError";
  }
}

function normalize(address: string): string {
  return address.trim().toLowerCase();
}

export function isAuthorizedTestRecipient(address: string | null | undefined): boolean {
  return !!address && normalize(address) === AUTHORIZED_TEST_RECIPIENT;
}

export function isAuthorizedTestSender(address: string | null | undefined): boolean {
  return !!address && normalize(address) === AUTHORIZED_TEST_SENDER;
}

/**
 * Server-side guard. Any recipient other than the single authorized address throws,
 * regardless of what the client submitted.
 */
export function assertAuthorizedTestRecipient(address: string | null | undefined): string {
  if (!isAuthorizedTestRecipient(address)) {
    throw new UnauthorizedTestRecipientError(address ?? "(empty)");
  }
  return AUTHORIZED_TEST_RECIPIENT;
}

export class UnauthorizedTestSenderError extends Error {
  constructor(attempted: string) {
    super(`Test email may only be sent from ${AUTHORIZED_TEST_SENDER}. Rejected: ${attempted}`);
    this.name = "UnauthorizedTestSenderError";
  }
}

export function assertAuthorizedTestSender(address: string | null | undefined): string {
  if (!isAuthorizedTestSender(address)) {
    throw new UnauthorizedTestSenderError(address ?? "(empty)");
  }
  return AUTHORIZED_TEST_SENDER;
}

/**
 * Envelope submitted for a test send. Kept deliberately narrow: a caller cannot widen
 * the audience, because there is no CC/BCC/reply-to field to widen it with.
 */
export interface TestEnvelopeCandidate {
  to: string | string[];
  cc?: unknown;
  bcc?: unknown;
  replyTo?: unknown;
}

export type EnvelopeRejection =
  | "MULTIPLE_RECIPIENTS"
  | "UNAUTHORIZED_RECIPIENT"
  | "CC_NOT_ALLOWED"
  | "BCC_NOT_ALLOWED"
  | "REPLY_TO_NOT_ALLOWED";

export class UnsafeTestEnvelopeError extends Error {
  readonly reason: EnvelopeRejection;
  constructor(reason: EnvelopeRejection) {
    super(`Rejected test envelope: ${reason}`);
    this.name = "UnsafeTestEnvelopeError";
    this.reason = reason;
  }
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

/**
 * Collapse a submitted envelope to the single authorized recipient, or throw.
 *
 * Any attempt to widen the audience — a second recipient, CC, BCC, or a reply-to that
 * could redirect responses — is refused outright rather than silently trimmed, so a
 * hostile or buggy caller fails loudly instead of quietly mailing someone else.
 */
export function assertSafeTestEnvelope(candidate: TestEnvelopeCandidate): string {
  if (isPresent(candidate.cc)) throw new UnsafeTestEnvelopeError("CC_NOT_ALLOWED");
  if (isPresent(candidate.bcc)) throw new UnsafeTestEnvelopeError("BCC_NOT_ALLOWED");
  if (isPresent(candidate.replyTo)) throw new UnsafeTestEnvelopeError("REPLY_TO_NOT_ALLOWED");

  const recipients = Array.isArray(candidate.to) ? candidate.to : [candidate.to];
  if (recipients.length !== 1) throw new UnsafeTestEnvelopeError("MULTIPLE_RECIPIENTS");

  if (!isAuthorizedTestRecipient(recipients[0])) {
    throw new UnsafeTestEnvelopeError("UNAUTHORIZED_RECIPIENT");
  }
  return AUTHORIZED_TEST_RECIPIENT;
}

export type TestSendBlockedReason =
  | "EMAIL_PROVIDER_NOT_CONFIGURED"
  | "CAMPAIGN_NOT_READY";

export interface TestSendAvailability {
  canSend: boolean;
  reason: TestSendBlockedReason;
  /** Friendly, non-technical explanation for the UI. */
  message: string;
}

/**
 * Whether a test email can currently be sent.
 *
 * Always false in this milestone: no email provider is implemented or configured.
 * When the provider arrives this becomes a real capability check — the UI already
 * renders whatever this returns, so no UI rework is needed.
 */
export function testSendAvailability(): TestSendAvailability {
  return {
    canSend: false,
    reason: "EMAIL_PROVIDER_NOT_CONFIGURED",
    message: "Email provider not configured yet — no email can be sent from this screen.",
  };
}
