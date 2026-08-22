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
let testTransport: EmailProvider | undefined;

/**
 * What the SAFE TEST port resolves to under the test runner when nothing was injected.
 *
 * It reports itself unconfigured and THROWS if asked to send, so a test that reaches
 * this fails loudly rather than quietly mailing khaled-s@axis-gps.com.
 */
class RefusingTestTransport implements EmailProvider {
  readonly name = "FAKE" as const;

  checkConfiguration() {
    return {
      configured: false,
      name: this.name,
      problems: [
        "No email provider was injected for this test, so nothing can be sent.",
      ],
      senderEmail: undefined,
    };
  }

  async sendTestEmail(): Promise<never> {
    throw new Error(
      "A test attempted to send a real email. Inject a fake provider with " +
        "setEmailProviderForTesting instead.",
    );
  }
}

/** The SAFE TEST transport (Gmail SMTP). Never used for customer delivery. */
export function getEmailProvider(): EmailProvider {
  if (override) return override;
  if (inTestRunner()) {
    // The same rule as the production port below: a machine with real Gmail
    // credentials in `.env.local` must not be able to send from a test. A suite that
    // needs this port injects a fake; one that forgot gets a provider that refuses.
    testTransport ??= new RefusingTestTransport();
    return testTransport;
  }
  if (!singleton) singleton = new GmailSmtpEmailProvider();
  return singleton;
}

/**
 * Whether a live vendor adapter may be constructed at all.
 *
 * Exported so a test can assert the guarantee rather than trusting it.
 */
export function liveProvidersPermitted(): boolean {
  return !inTestRunner();
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
 * Under the test runner, a NETWORK-CAPABLE vendor adapter is never handed out.
 *
 * A developer machine legitimately holds real credentials in `.env.local`, and the
 * test suite reads the same environment. Without this, running the tests on a
 * configured machine would resolve to the live adapter — and one mis-scoped test
 * would be a real API call, possibly a real email. The suite must be incapable of
 * that, not merely careful about it.
 *
 * Tests that need a provider inject a fake through `setProductionEmailProviderForTesting`,
 * which still works: the override is checked first.
 */
function inTestRunner(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST !== undefined;
}

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

  if (kind === "resend" && hasKey && !inTestRunner()) {
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
