/**
 * The public origin a recipient's unsubscribe link points at (ADR-0024).
 *
 * A newsletter is read on someone else's machine, days or months later. The link in
 * it therefore cannot be derived from anything about the request that produced it —
 * not the `Host` header, not the LAN address the sender happened to use, not
 * `localhost`. It has to be a single, deliberately configured public origin, and if
 * one does not exist yet the honest answer is that production unsubscribe is not
 * ready.
 *
 * Pure: no I/O, no framework imports. The environment is read in `server/`.
 */

export type PublicUrlProblem =
  | "NOT_CONFIGURED"
  | "MALFORMED"
  | "NOT_HTTP"
  | "REQUIRES_HTTPS"
  | "NOT_PUBLIC_HOST"
  | "HAS_CREDENTIALS"
  | "HAS_QUERY_OR_FRAGMENT";

export const PUBLIC_URL_PROBLEM_MESSAGE: Record<PublicUrlProblem, string> = {
  NOT_CONFIGURED:
    "PUBLIC_APP_URL is not set. Unsubscribe links have no public address to point at.",
  MALFORMED: "PUBLIC_APP_URL is not a valid URL.",
  NOT_HTTP: "PUBLIC_APP_URL must be an http:// or https:// address.",
  REQUIRES_HTTPS:
    "PUBLIC_APP_URL must use HTTPS. A newsletter link is followed on someone else's network.",
  NOT_PUBLIC_HOST:
    "PUBLIC_APP_URL points at a machine-local or private address, which a recipient cannot reach.",
  HAS_CREDENTIALS: "PUBLIC_APP_URL must not contain a username or password.",
  HAS_QUERY_OR_FRAGMENT:
    "PUBLIC_APP_URL must be a bare origin — no query string and no fragment.",
};

/** Hosts that only ever resolve on the sending machine or inside a private network. */
function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::" || host === "::1") return true;
  if (host === "127.0.0.1" || host.startsWith("127.")) return true;
  // RFC1918 and link-local ranges.
  if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host.startsWith("169.254.")) return true;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80"))
    return true;
  // A bare hostname with no dot cannot resolve outside a local network.
  if (!host.includes(".")) return true;

  return false;
}

export type PublicUrlResult =
  | { ok: true; origin: string; isDevelopmentOnly: boolean }
  | { ok: false; problem: PublicUrlProblem; message: string };

export interface PublicUrlOptions {
  /**
   * When true, an `http://localhost` origin is accepted so the flow can be walked on
   * a development machine. It is NEVER accepted for production sending — the caller
   * reports `isDevelopmentOnly` and readiness treats it as not ready.
   */
  allowDevelopmentOrigins: boolean;
}

/**
 * Validates a configured public origin.
 *
 * Refuses rather than repairs: a trailing path, a query string, embedded credentials
 * or a private host are all rejected outright instead of being trimmed into something
 * that looks usable.
 */
export function validatePublicAppUrl(
  raw: unknown,
  options: PublicUrlOptions,
): PublicUrlResult {
  const fail = (problem: PublicUrlProblem): PublicUrlResult => ({
    ok: false,
    problem,
    message: PUBLIC_URL_PROBLEM_MESSAGE[problem],
  });

  if (typeof raw !== "string" || raw.trim() === "") return fail("NOT_CONFIGURED");

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return fail("MALFORMED");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return fail("NOT_HTTP");
  if (url.username !== "" || url.password !== "") return fail("HAS_CREDENTIALS");
  if (url.search !== "" || url.hash !== "") return fail("HAS_QUERY_OR_FRAGMENT");

  const local = isLocalOrPrivateHost(url.hostname);

  if (url.protocol === "http:") {
    // Plain HTTP is tolerated only for a local development origin, and only when the
    // caller explicitly asked for that. Anything else is a real recipient's link.
    if (!options.allowDevelopmentOrigins || !local) return fail("REQUIRES_HTTPS");
  } else if (local) {
    return fail("NOT_PUBLIC_HOST");
  }

  // Normalized to a bare origin plus any base path, without a trailing slash, so
  // joining a path later can never produce a double slash.
  const path = url.pathname.replace(/\/+$/, "");
  return {
    ok: true,
    origin: `${url.origin}${path}`,
    isDevelopmentOnly: local,
  };
}

/** Builds the recipient-facing unsubscribe link. */
export function buildUnsubscribeUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/unsubscribe/${encodeURIComponent(token)}`;
}
