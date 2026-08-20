import type { DomainAuthStatus } from "../../../domain/delivery/domainAuth";
import type {
  NormalizedProviderEvent,
  ProviderEventRejection,
} from "../../../domain/delivery/providerEvent";
import type { ProviderSendResult } from "./emailProvider";

/**
 * The PRODUCTION bulk-email port (ADR-0004, shaped by ADR-0024).
 *
 * Deliberately a SEPARATE interface from the SAFE TEST port. They look similar and are
 * not the same thing: the test port can only ever reach one hard-coded address, while
 * this one reaches customers. Sharing an interface would mean a mis-wired registry
 * could hand a production adapter to the test path, or worse, the other way round.
 * Two types make that a compile error.
 *
 * The vendor is now Resend (ADR-0025), implemented in `resendProductionEmailProvider.ts`.
 * `DisabledProductionEmailProvider` remains the implementation whenever configuration is
 * incomplete, and it refuses to send. Nothing outside the adapter directory imports a
 * vendor SDK — that is what ADR-0004 bought.
 */

export type ProductionProviderName =
  | "DISABLED"
  | "RESEND"
  | "POSTMARK"
  | "AMAZON_SES";

/**
 * One production message to ONE recipient.
 *
 * As with the test port, the audience is unrepresentable rather than merely validated:
 * no `from`, no `cc`, no `bcc`, no `replyTo`, and `to` is a single string. Sender
 * identity is adapter configuration, so no caller can choose it.
 */
export interface ProductionEmailMessage {
  /** Single normalized recipient. */
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Stable across retries of the SAME logical delivery, derived from
   * (campaignId, normalizedEmail). A provider that honours it turns a retry into a
   * no-op instead of a second copy in someone's inbox.
   */
  idempotencyKey: string;
}

/** Domain authentication state, as the provider reports it. Never assumed. */
export interface SenderDomainStatus {
  domain: string | null;
  /** All three must be verified before a single customer message may go out. */
  spf: "VERIFIED" | "NOT_VERIFIED" | "UNKNOWN";
  dkim: "VERIFIED" | "NOT_VERIFIED" | "UNKNOWN";
  dmarc: "VERIFIED" | "NOT_VERIFIED" | "UNKNOWN";
  /** The DNS records AXIS must publish, when the provider tells us. */
  requiredDnsRecords: string[];
}

export interface ProductionProviderStatus {
  /** True only when a vendor adapter is wired AND its credentials are usable. */
  configured: boolean;
  /** True only when sending is deliberately switched on. Both are required. */
  enabled: boolean;
  name: ProductionProviderName;
  /** Sanitized reasons; never contains a credential. */
  problems: string[];
  senderEmail: string | null;
  domain: SenderDomainStatus;
}

export type WebhookVerification =
  | { ok: true; events: NormalizedProviderEvent[] }
  | { ok: false; reason: ProviderEventRejection; message: string };

export interface ProductionEmailProvider {
  readonly name: ProductionProviderName;

  /** Cheap, local check. Must never call the vendor's API. */
  checkConfiguration(): ProductionProviderStatus;

  /**
   * Submits ONE message.
   *
   * An adapter that cannot send must THROW, not return a benign-looking result. A
   * "successful" no-op is the failure mode that lets a dry run be mistaken for a
   * delivery, and every caller here treats a returned `ProviderSendResult` as
   * evidence that a real submission happened.
   */
  send(message: ProductionEmailMessage): Promise<ProviderSendResult>;

  /**
   * Reads the sending domain's authentication state FROM the provider.
   *
   * Separate from `checkConfiguration()` on purpose: this one talks to the network and
   * `checkConfiguration()` must not, because readiness renders on every page load.
   * READ ONLY — an adapter must never create a domain, change DNS, or send anything
   * here. Returns `null` when the provider does not know the domain.
   */
  fetchDomainStatus?(domain: string): Promise<DomainAuthStatus | null>;

  /**
   * Reconciles an UNCERTAIN submission, where the vendor supports it.
   *
   * This is the ONLY correct answer to "we do not know whether it was accepted".
   * Re-sending is not, which is why no automatic retry path exists for that state.
   */
  lookupByIdempotencyKey?(key: string): Promise<ProviderSendResult | null>;

  /**
   * Verifies a raw webhook request and normalizes it.
   *
   * Verification is the adapter's responsibility because only it knows the vendor's
   * signature scheme. An adapter with no scheme must return `UNSIGNED` — never
   * "trusted because it arrived".
   */
  verifyWebhook(input: {
    rawBody: string;
    headers: Record<string, string | undefined>;
  }): WebhookVerification;
}
