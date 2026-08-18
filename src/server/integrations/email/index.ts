import type { EmailProvider } from "./emailProvider";
import { MicrosoftGraphEmailProvider } from "./microsoftGraphEmailProvider";

/**
 * The single place that decides which EmailProvider implementation is used.
 * Swapping vendors means changing this line and nothing else (ADR-0004).
 */

let override: EmailProvider | undefined;
let singleton: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (override) return override;
  if (!singleton) singleton = new MicrosoftGraphEmailProvider();
  return singleton;
}

/**
 * Test seam. Injecting a fake keeps the suite entirely offline — no test can reach
 * Microsoft Graph even by accident.
 */
export function setEmailProviderForTesting(provider: EmailProvider | undefined): void {
  override = provider;
}

export * from "./emailProvider";
