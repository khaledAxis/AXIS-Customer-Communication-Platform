import {
  unknownDomainAuth,
  type DomainAuthStatus,
} from "../../../domain/delivery/domainAuth";
import { DisabledProductionEmailProvider } from "./disabledProductionEmailProvider";
import type { EmailProvider } from "./emailProvider";
import { GmailSmtpEmailProvider } from "./gmailSmtpEmailProvider";
import type { ProductionEmailProvider } from "./productionEmailProvider";
import { ResendProductionEmailProvider } from "./resendProductionEmailProvider";

/**
 * The single place that decides which provider implementation is used.
 * Swapping vendors means changing one line here and nothing else (ADR-0004).
 *
 * TWO REGISTRIES, deliberately (ADR-0024):
 *
 *   `getEmailProvider()`            → the SAFE TEST transport. Reaches exactly one
 *                                     hard-coded address and nothing else.
 *   `getProductionEmailProvider()`  → the customer transport. Resend (ADR-0025) when it
 *                                     is configured, otherwise the disabled adapter,
 *                                     which throws rather than sending.
 *
 * They return different TYPES, so a mis-wiring that handed a production adapter to the
 * test path — or a test adapter to the customer path — is a compile error rather than
 * an incident.
 */

let override: EmailProvider | undefined;
let singleton: EmailProvider | undefined;

/** The SAFE TEST transport (Gmail SMTP). Never used for customer delivery. */
export function getEmailProvider(): EmailProvider {
  if (override) return override;
  if (!singleton) singleton = new GmailSmtpEmailProvider();
  return singleton;
}

/**
 * Test seam. Injecting a fake keeps the suite entirely offline — no test can reach
 * Gmail SMTP even by accident.
 */
export function setEmailProviderForTesting(provider: EmailProvider | undefined): void {
  override = provider;
}

let productionOverride: ProductionEmailProvider | undefined;
let productionSingleton: ProductionEmailProvider | undefined;

/**
 * The PRODUCTION customer transport.
 *
 * Resolves to Resend ONLY when `PRODUCTION_EMAIL_PROVIDER=resend` and an API key is
 * present; anything else — an unset variable, a blank key, a typo — falls back to the
 * disabled adapter, which throws. Falling back is deliberate: a half-configured vendor
 * must degrade to "cannot send", never to "sends somewhere unexpected".
 *
 * `knownDomain` is the last domain report read from the provider. It is passed in
 * rather than fetched because this function must stay synchronous and network-free;
 * without it, the adapter honestly reports the domain as unchecked.
 */
export function getProductionEmailProvider(
  knownDomain?: DomainAuthStatus,
): ProductionEmailProvider {
  if (productionOverride) return productionOverride;

  const kind = (process.env.PRODUCTION_EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const hasKey = (process.env.RESEND_API_KEY ?? "").trim() !== "";

  if (kind === "resend" && hasKey) {
    // Not cached when a domain report is supplied — the snapshot changes as DNS
    // propagates, and a stale "verified" is exactly the wrong thing to cache.
    if (knownDomain) return new ResendProductionEmailProvider(knownDomain);
    if (!productionSingleton || productionSingleton.name !== "RESEND") {
      productionSingleton = new ResendProductionEmailProvider(unknownDomainAuth());
    }
    return productionSingleton;
  }

  if (!productionSingleton || productionSingleton.name !== "DISABLED") {
    productionSingleton = new DisabledProductionEmailProvider();
  }
  return productionSingleton;
}

/**
 * Test seam for the production port.
 *
 * Used only to prove the dispatch pipeline never calls it. No test may inject an
 * adapter that actually transmits.
 */
export function setProductionEmailProviderForTesting(
  provider: ProductionEmailProvider | undefined,
): void {
  productionOverride = provider;
}

export * from "./emailProvider";
export * from "./productionEmailProvider";
export {
  ResendProductionEmailProvider,
  RESEND_SPF_INCLUDE,
  productionSendingDomain,
  providerPilotEnabled,
  normalizeResendEvent,
} from "./resendProductionEmailProvider";
export {
  DisabledProductionEmailProvider,
  ProductionSendingDisabledError,
  productionDeliveryEnabled,
} from "./disabledProductionEmailProvider";
