import "server-only";

import {
  buildUnsubscribeUrl,
  validatePublicAppUrl,
  type PublicUrlResult,
} from "../../domain/unsubscribe/publicUrl";

/**
 * The configured public origin (ADR-0024).
 *
 * Read from `PUBLIC_APP_URL` and nowhere else. In particular it is NEVER derived from
 * the incoming request's `Host` header: a recipient opens their email on a different
 * network, days later, and a link built from whatever hostname the sending machine
 * happened to answer on would simply be dead — or, worse, point wherever an attacker
 * set the header.
 */

/** Development origins (http://localhost) are tolerated only outside production. */
function allowDevelopmentOrigins(): boolean {
  const appEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "").toLowerCase();
  return appEnv !== "production";
}

export function getPublicAppUrl(): PublicUrlResult {
  return validatePublicAppUrl(process.env.PUBLIC_APP_URL, {
    allowDevelopmentOrigins: allowDevelopmentOrigins(),
  });
}

export interface PublicUnsubscribeReadiness {
  /** A usable origin exists — enough to walk the flow. */
  configured: boolean;
  /**
   * Ready for REAL customer newsletters: an HTTPS origin on a publicly reachable host.
   * A localhost origin is fine for development and is never fine for a recipient.
   */
  productionReady: boolean;
  origin: string | null;
  problems: string[];
}

export function checkPublicUnsubscribeReadiness(): PublicUnsubscribeReadiness {
  const result = getPublicAppUrl();

  if (!result.ok) {
    return {
      configured: false,
      productionReady: false,
      origin: null,
      problems: [result.message],
    };
  }

  if (result.isDevelopmentOnly) {
    return {
      configured: true,
      productionReady: false,
      origin: result.origin,
      problems: [
        "PUBLIC_APP_URL points at a development address. A real recipient cannot open " +
          "a link to this machine, so production unsubscribe is not ready.",
      ],
    };
  }

  return {
    configured: true,
    productionReady: true,
    origin: result.origin,
    problems: [],
  };
}

/**
 * Builds a recipient-facing unsubscribe URL.
 *
 * Returns null rather than a broken link when no origin is configured. A newsletter
 * with no unsubscribe link is a problem readiness reports; a newsletter with a link
 * that goes nowhere is a problem the recipient discovers.
 */
export function unsubscribeUrlFor(token: string): string | null {
  const result = getPublicAppUrl();
  if (!result.ok) return null;
  return buildUnsubscribeUrl(result.origin, token);
}
