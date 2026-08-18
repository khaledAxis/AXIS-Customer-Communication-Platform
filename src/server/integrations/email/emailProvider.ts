/**
 * EmailProvider port (ADR-0004, realised for the SAFE TEST milestone by ADR-0013).
 *
 * Services depend only on this interface; exactly one adapter knows about the transport
 * (Gmail SMTP). Note what the message type deliberately does NOT contain:
 *
 *   - no `from`  — the sender is adapter configuration, so no caller can choose it
 *   - no `cc` / `bcc` / `replyTo` — there is no field with which to widen the audience
 *   - `to` is a single string, not a list
 *
 * That makes "send to somebody else" unrepresentable at the type level, before any
 * runtime guard runs.
 */

export type EmailProviderName = "GMAIL_SMTP" | "FAKE";

export interface TestEmailMessage {
  /** Single recipient. Re-validated inside the adapter against the authorized address. */
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Ties the submission to one single-use approval; carried for provider-side tracing. */
  idempotencyKey: string;
}

/**
 * ACCEPTED  — provider took responsibility for delivery (SMTP 250). NOT delivery.
 * FAILED    — provider definitively refused; safe to retry after fixing the cause.
 * UNCERTAIN — we do not know whether it was accepted (timeout / unreadable response).
 *             MUST NOT be auto-retried: that could duplicate a real email.
 */
export type ProviderOutcome = "ACCEPTED" | "FAILED" | "UNCERTAIN";

export interface ProviderSendResult {
  outcome: ProviderOutcome;
  /** Protocol status when one was received (SMTP 250, 535, 550…). */
  statusCode?: number;
  providerMessageId?: string;
  /** Short sanitized classification — never a token, secret, or raw header. */
  failureCode?: string;
  /** Friendly, non-technical message for the UI. */
  message?: string;
}

export interface ProviderConfigStatus {
  configured: boolean;
  /** Sanitized reasons the provider cannot be used (never contains secret values). */
  problems: string[];
  senderEmail?: string;
}

export interface EmailProvider {
  readonly name: EmailProviderName;
  /** Cheap, local check — must never call the provider's API. */
  checkConfiguration(): ProviderConfigStatus;
  sendTestEmail(message: TestEmailMessage): Promise<ProviderSendResult>;
}
