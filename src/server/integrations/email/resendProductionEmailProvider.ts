import "server-only";

import { Resend } from "resend";

import {
  interpretDomainReport,
  unknownDomainAuth,
  type DomainAuthStatus,
  type RequiredDnsRecord,
} from "../../../domain/delivery/domainAuth";
import {
  AUTHORIZED_PILOT_RECIPIENT,
  PRODUCTION_SENDER_EMAIL,
  PRODUCTION_SENDER_NAME,
  assertSafePilotEnvelope,
} from "../../../domain/delivery/pilotPolicy";
import {
  ProviderEventType,
  type NormalizedProviderEvent,
} from "../../../domain/delivery/providerEvent";
import { assertValidReplyTo } from "../../../domain/send/replyTo";
import { hasHeaderInjection } from "../../../domain/send/testSendPolicy";
import type { ProviderSendResult } from "./emailProvider";
import type {
  ProductionEmailMessage,
  ProductionEmailProvider,
  ProductionProviderStatus,
  WebhookVerification,
} from "./productionEmailProvider";

/**
 * The Resend adapter (ADR-0025).
 *
 * The ONLY file in this repository that knows Resend exists. Domain code, services and
 * UI depend on `ProductionEmailProvider`; swapping vendors means writing a sibling of
 * this file and changing one line in the registry (ADR-0004).
 *
 * Two things this adapter is very careful about:
 *
 *  1. **Accepted is not delivered.** `emails.send` returning an id means Resend took
 *     responsibility. It is mapped to `ACCEPTED` and never to `DELIVERED`; only an
 *     `email.delivered` webhook may claim the second.
 *  2. **The audience is not negotiable.** While the pilot is the only permitted use,
 *     every submission is re-checked against the hard-coded pilot recipient inside
 *     this adapter — after the service has already checked it. The last gate before
 *     the network is here, where a mistake would otherwise become an email.
 *
 * The API key is read from the environment, used to construct the client, and never
 * logged, returned, persisted or included in any error surfaced to a caller.
 */

/** Resend's SPF include. Published by AXIS in DNS; not a secret. */
export const RESEND_SPF_INCLUDE = "include:amazonses.com" as const;

function apiKey(): string | null {
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  return key === "" ? null : key;
}

/** Shape check only — a placeholder must not read as configured. */
function apiKeyLooksReal(key: string): boolean {
  return key.startsWith("re_") && key.length >= 20;
}

function webhookSecret(): string | null {
  const secret = (process.env.RESEND_WEBHOOK_SECRET ?? "").trim();
  return secret === "" ? null : secret;
}

/** The domain AXIS sends as. Derived from the sender, never configured separately. */
export function productionSendingDomain(): string {
  return PRODUCTION_SENDER_EMAIL.split("@")[1] ?? "axis-gps.com";
}

export function providerPilotEnabled(): boolean {
  return (process.env.PROVIDER_PILOT_ENABLED ?? "").trim() === "true";
}

export class ResendProductionEmailProvider implements ProductionEmailProvider {
  readonly name = "RESEND" as const;

  /**
   * The last domain state read FROM RESEND, injected by the service that fetched it.
   *
   * `checkConfiguration()` must stay cheap and network-free (the port says so, and
   * readiness renders on every page load), but it must also never claim a domain is
   * verified because local configuration looks complete. Passing the stored snapshot
   * in keeps both true.
   */
  constructor(private readonly knownDomain: DomainAuthStatus = unknownDomainAuth()) {}

  checkConfiguration(): ProductionProviderStatus {
    const key = apiKey();
    const problems: string[] = [];

    if (!key) {
      problems.push(
        "RESEND_API_KEY is not set. Add it to .env.local (never to a committed file) and restart the server.",
      );
    } else if (!apiKeyLooksReal(key)) {
      problems.push(
        "RESEND_API_KEY does not look like a Resend key (it should begin with `re_`).",
      );
    }

    if (!webhookSecret()) {
      problems.push(
        "RESEND_WEBHOOK_SECRET is not set, so delivery, bounce and complaint events cannot be verified or accepted.",
      );
    }

    if (!this.knownDomain.verified) {
      problems.push(
        this.knownDomain.providerStatus
          ? `Resend reports the sending domain as "${this.knownDomain.providerStatus}", not verified.`
          : "The sending domain has not been checked with Resend yet.",
      );
    }

    const configured = Boolean(key && apiKeyLooksReal(key));

    return {
      configured,
      // Deliberately separate from `configured`: a usable API key is not permission to
      // send. General customer delivery stays off until it is explicitly switched on,
      // and that switch is not in the database.
      enabled: (process.env.PRODUCTION_DELIVERY_ENABLED ?? "").trim() === "true",
      name: this.name,
      problems,
      senderEmail: PRODUCTION_SENDER_EMAIL,
      domain: {
        domain: this.knownDomain.domain ?? productionSendingDomain(),
        spf: this.knownDomain.spf,
        dkim: this.knownDomain.dkim,
        dmarc: this.knownDomain.dmarc,
        requiredDnsRecords: this.knownDomain.records.map(
          (record) => `${record.type} ${record.name} ${record.value}`,
        ),
      },
    };
  }

  /**
   * Reads the domain's authentication state from Resend. READ ONLY — it lists domains
   * and reads one; it creates nothing, changes no DNS, and sends nothing.
   */
  async fetchDomainStatus(domain: string): Promise<DomainAuthStatus | null> {
    const key = apiKey();
    if (!key || !apiKeyLooksReal(key)) return null;

    const client = new Resend(key);
    const list = await client.domains.list();
    const match = list.data?.data.find(
      (candidate) => candidate.name.toLowerCase() === domain.toLowerCase(),
    );
    if (!match) return null;

    const detail = await client.domains.get(match.id);
    const records: RequiredDnsRecord[] = (detail.data?.records ?? []).map((record) => ({
      purpose:
        record.record === "SPF"
          ? "SPF"
          : record.record === "DKIM"
            ? "DKIM"
            : record.record === "Tracking" || record.record === "TrackingCAA"
              ? "TRACKING"
              : "OTHER",
      type: record.type,
      name: record.name,
      value: record.value,
      ttl: record.ttl ?? null,
      priority: "priority" in record ? (record.priority ?? null) : null,
      status: record.status ?? null,
    }));

    return interpretDomainReport({
      domain: match.name,
      status: detail.data?.status ?? match.status,
      records,
    });
  }

  async send(message: ProductionEmailMessage): Promise<ProviderSendResult> {
    const key = apiKey();
    if (!key || !apiKeyLooksReal(key)) {
      throw new Error(
        "Resend is not configured, so no message was submitted. Set RESEND_API_KEY in .env.local.",
      );
    }

    // THE LAST GATE. The service has already checked the recipient; this checks again,
    // here, because the next line is a network call and a mistake past this point is a
    // real email in a real inbox. Refuses CC/BCC/arrays/multiple addresses outright.
    const to = assertSafePilotEnvelope({ to: message.to });

    if (hasHeaderInjection(message.subject)) {
      throw new Error("That subject contains characters that are not allowed.");
    }
    const replyTo = assertValidReplyTo(process.env.NEWSLETTER_REPLY_TO);

    const client = new Resend(key);

    try {
      const response = await client.emails.send(
        {
          // The sender is adapter configuration, exactly as in the SAFE TEST port.
          // No caller can choose it, because `ProductionEmailMessage` has no `from`.
          from: `${PRODUCTION_SENDER_NAME} <${PRODUCTION_SENDER_EMAIL}>`,
          to,
          replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
        },
        // Derived from (campaignId, normalizedEmail), so a retry of the SAME logical
        // delivery is a no-op at Resend rather than a second copy in the inbox.
        { idempotencyKey: message.idempotencyKey },
      );

      if (response.error) {
        return {
          outcome: "FAILED",
          // Resend's own code, which is a classification and never a credential.
          failureCode: response.error.name,
          message: "Resend refused the message.",
        };
      }

      const id = response.data?.id;
      if (!id) {
        // A 2xx with no id is unreadable: it may or may not have been accepted, and
        // re-sending could duplicate a real email. That is exactly UNCERTAIN.
        return {
          outcome: "UNCERTAIN",
          message:
            "Resend answered without a message id, so acceptance could not be confirmed. Check the Resend dashboard before trying again.",
        };
      }

      return {
        outcome: "ACCEPTED",
        providerMessageId: id,
        statusCode: 200,
        // Wording matters: accepted for delivery, NOT delivered.
        message: "Resend accepted the email for delivery.",
      };
    } catch {
      // The error is deliberately not inspected or logged: it can carry the request,
      // and the request carries the API key in a header.
      // A broken connection or a timeout means the request may have arrived. Never
      // report FAILED here — a FAILED is safe to retry, and this is not.
      return {
        outcome: "UNCERTAIN",
        failureCode: "TRANSPORT_ERROR",
        message:
          "The connection to Resend broke before an answer arrived. It may or may not have accepted the email — check the Resend dashboard before trying again.",
      };
    }
  }

  /**
   * Verifies a webhook using Resend's own mechanism (Standard Webhooks, via the SDK).
   *
   * Deliberately not a hand-rolled scheme. Verification happens BEFORE anything is
   * read from the body, and a failure returns a reason with no customer detail in it.
   */
  verifyWebhook(input: {
    rawBody: string;
    headers: Record<string, string | undefined>;
  }): WebhookVerification {
    const secret = webhookSecret();
    if (!secret) {
      return {
        ok: false,
        reason: "UNSIGNED",
        message:
          "RESEND_WEBHOOK_SECRET is not configured, so no webhook signature can be verified.",
      };
    }

    // Standard Webhooks carries the signature in three headers. All three are
    // required: a request missing one cannot be verified, and "cannot be verified"
    // is refused rather than waved through.
    const header = (name: string): string =>
      input.headers[name] ?? input.headers[name.toLowerCase()] ?? "";
    const id = header("svix-id");
    const timestamp = header("svix-timestamp");
    const signature = header("svix-signature");

    if (id === "" || timestamp === "" || signature === "") {
      return {
        ok: false,
        reason: "UNSIGNED",
        message: "That webhook request carried no signature.",
      };
    }

    let payload: unknown;
    try {
      payload = new Resend(apiKey() ?? "re_unconfigured").webhooks.verify({
        payload: input.rawBody,
        headers: { id, timestamp, signature },
        webhookSecret: secret,
      });
    } catch {
      // Bad signature, replayed timestamp, tampered body — all indistinguishable to a
      // caller, deliberately. Nothing about the request is echoed back.
      return {
        ok: false,
        reason: "UNSIGNED",
        message: "The webhook signature could not be verified.",
      };
    }

    const normalized = normalizeResendEvent(payload, id);
    if (!normalized) {
      // A signed event we do not act on (opened, clicked, contact.*). Verified, but
      // nothing to record — and certainly not an error.
      return { ok: true, events: [] };
    }

    return { ok: true, events: [normalized] };
  }
}

/**
 * Resend's event vocabulary → the platform's.
 *
 * `email.sent` is Resend's word for "we accepted it and handed it on". Mapping it to
 * our `ACCEPTED` rather than anything called "sent" keeps the accepted/delivered
 * distinction intact end to end.
 */
export function normalizeResendEvent(
  payload: unknown,
  fallbackEventId?: string,
): NormalizedProviderEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const event = payload as {
    type?: unknown;
    created_at?: unknown;
    data?: {
      email_id?: unknown;
      to?: unknown;
      bounce?: { type?: unknown; subType?: unknown; message?: unknown };
    };
  };

  if (typeof event.type !== "string") return null;

  const type = ((): NormalizedProviderEvent["type"] | null => {
    switch (event.type) {
      case "email.sent":
        return ProviderEventType.ACCEPTED;
      case "email.delivered":
        return ProviderEventType.DELIVERED;
      case "email.bounced":
        // Resend reports the class on the payload. Only a PERMANENT bounce is a hard
        // one; treating a transient bounce as permanent would block a working mailbox.
        return isHardBounce(event.data?.bounce)
          ? ProviderEventType.HARD_BOUNCE
          : ProviderEventType.SOFT_BOUNCE;
      case "email.complained":
        return ProviderEventType.COMPLAINT;
      case "email.failed":
        return ProviderEventType.FAILED;
      case "email.delivery_delayed":
        return ProviderEventType.SOFT_BOUNCE;
      default:
        // opened / clicked / contact.* / domain.* — signed and genuine, but not facts
        // this platform acts on.
        return null;
    }
  })();
  if (!type) return null;

  const recipients = Array.isArray(event.data?.to) ? event.data?.to : [];
  const first = recipients.find((value): value is string => typeof value === "string");
  if (!first) return null;

  const emailId =
    typeof event.data?.email_id === "string" ? event.data.email_id : null;

  const occurredAt =
    typeof event.created_at === "string" ? new Date(event.created_at) : new Date();

  return {
    // Prefer the delivery's own id from the Standard Webhooks envelope, which is
    // unique per DELIVERY of the event; fall back to a composite so a provider that
    // omits it still cannot double-apply the same fact.
    providerEventId:
      fallbackEventId && fallbackEventId.trim() !== ""
        ? fallbackEventId
        : `${event.type}:${emailId ?? first}:${occurredAt.toISOString()}`,
    type,
    normalizedEmail: first.trim().toLowerCase(),
    providerMessageId: emailId,
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    reason: sanitizedBounceReason(event.data?.bounce),
  };
}

function isHardBounce(bounce: unknown): boolean {
  if (typeof bounce !== "object" || bounce === null) return false;
  const value = (bounce as { type?: unknown }).type;
  return typeof value === "string" && value.toLowerCase() === "permanent";
}

/** A short, human-readable classification. Never a raw payload dump. */
function sanitizedBounceReason(bounce: unknown): string | null {
  if (typeof bounce !== "object" || bounce === null) return null;
  const { type, subType } = bounce as { type?: unknown; subType?: unknown };
  const parts = [type, subType].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  return parts.length > 0 ? parts.join(" / ").slice(0, 120) : null;
}

/** The pilot's fixed destination, re-exported so callers never invent one. */
export { AUTHORIZED_PILOT_RECIPIENT };
