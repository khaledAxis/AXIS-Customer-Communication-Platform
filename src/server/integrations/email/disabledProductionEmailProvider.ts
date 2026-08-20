import type { ProviderSendResult } from "./emailProvider";
import type {
  ProductionEmailMessage,
  ProductionEmailProvider,
  ProductionProviderStatus,
  WebhookVerification,
} from "./productionEmailProvider";

/**
 * The only production adapter that exists (ADR-0024).
 *
 * It exists to be honest about a gap rather than to fill it. No vendor has been chosen
 * (ADR-0004 deferred that), no domain has been authenticated, and no customer email may
 * be sent — so this adapter reports itself unconfigured, reports the domain
 * unverified, and **throws** if anyone calls `send`.
 *
 * Throwing rather than returning a quiet failure is the important part. A
 * `ProviderSendResult` is treated everywhere as evidence that a real submission
 * happened; a no-op that returned one would let a dry run be mistaken for a delivery,
 * and that is the exact mistake this whole milestone is built to prevent.
 */

export class ProductionSendingDisabledError extends Error {
  constructor() {
    super(
      "Production customer sending is not enabled. No email provider is configured, " +
        "and no message was submitted.",
    );
    this.name = "ProductionSendingDisabledError";
  }
}

/**
 * The master switch, read from the environment.
 *
 * Even when a vendor adapter eventually exists, sending stays off until this is
 * explicitly `true`. There is no UI control that writes it, no admin action that flips
 * it, and no role — including ADMIN — that can bypass it: it is not in the database,
 * so nothing a browser can reach is able to change it.
 */
export function productionDeliveryEnabled(): boolean {
  return (process.env.PRODUCTION_DELIVERY_ENABLED ?? "").trim() === "true";
}

export class DisabledProductionEmailProvider implements ProductionEmailProvider {
  readonly name = "DISABLED" as const;

  checkConfiguration(): ProductionProviderStatus {
    const problems = [
      "No production email provider has been selected (ADR-0004 defers the vendor choice).",
      "No production sender domain has been authenticated (SPF, DKIM and DMARC are unverified).",
    ];
    if (!productionDeliveryEnabled()) {
      problems.push("PRODUCTION_DELIVERY_ENABLED is not set to true.");
    }

    return {
      configured: false,
      // Reported separately from `configured` so the readiness screen can say which
      // of the two is missing. Both are required, and both are false today.
      enabled: productionDeliveryEnabled(),
      name: this.name,
      problems,
      senderEmail: null,
      domain: {
        domain: null,
        spf: "NOT_VERIFIED",
        dkim: "NOT_VERIFIED",
        dmarc: "NOT_VERIFIED",
        requiredDnsRecords: [],
      },
    };
  }

  async send(message: ProductionEmailMessage): Promise<ProviderSendResult> {
    // The message is deliberately not logged: it is a real customer's address and a
    // real newsletter body, and this path is reached only by a programming error.
    void message;
    throw new ProductionSendingDisabledError();
  }

  verifyWebhook(): WebhookVerification {
    // With no vendor there is no signature scheme, so nothing can be verified — and
    // an unverifiable webhook is refused, never trusted because it arrived.
    return {
      ok: false,
      reason: "UNSIGNED",
      message:
        "No production email provider is configured, so no webhook signature can be verified.",
    };
  }
}
