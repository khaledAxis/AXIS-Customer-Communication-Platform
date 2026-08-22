import "server-only";

import { lookup } from "node:dns/promises";

import {
  isPermittedAddress,
  validateSourceUrl,
} from "../../../domain/content/sourceUrl";

/**
 * The ONLY place this platform fetches an external content source (ADR-0026).
 *
 * Everything about this file is a restriction. It exists so that "the server makes an
 * HTTP request to a URL a person typed" — the definition of SSRF — is confined to one
 * reviewable place with every guard in it, instead of being a `fetch()` call somewhere
 * in a service.
 *
 * The guards, and why each one is not optional:
 *
 *  - **Shape check** (`validateSourceUrl`): public http(s), no credentials, standard
 *    port, not a private or internal host.
 *  - **DNS check**: the hostname is resolved and the RESOLVED ADDRESS is checked
 *    again. A perfectly public name can resolve to `10.0.0.5`, by accident in a
 *    split-horizon network or on purpose in a rebinding attack.
 *  - **Redirects are followed manually, one hop at a time, and EVERY hop is
 *    re-validated.** `redirect: "follow"` would hand the decision to undici: a public
 *    URL answering `302 Location: http://169.254.169.254/` is the standard way past a
 *    front-door-only check.
 *  - **Size cap while streaming.** A `Content-Length` header is a claim, not a fact,
 *    so the body is read in chunks and abandoned the moment it exceeds the cap.
 *  - **Timeout** on the whole operation, so one slow source cannot hold a run open.
 *  - **Content-type check**, so an HTML error page is reported as "not a feed"
 *    rather than parsed hopefully.
 *  - **No credentials of any kind are sent** — no cookies, no Authorization header,
 *    no AXIS identity. This platform is an anonymous reader of public feeds.
 */

/** Feeds are text. 5 MB is generous for the largest real-world feed. */
export const MAX_FEED_BYTES = 5 * 1024 * 1024;
/** One source may not hold a run open longer than this. */
export const FEED_TIMEOUT_MS = 15_000;
/** Redirect hops. Enough for http→https→canonical; not enough for a redirect loop. */
export const MAX_REDIRECTS = 3;

export type FetchFailureCode =
  | "URL_NOT_ALLOWED"
  | "DNS_FAILED"
  | "ADDRESS_NOT_ALLOWED"
  | "REDIRECT_NOT_ALLOWED"
  | "TOO_MANY_REDIRECTS"
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "TOO_LARGE"
  | "NOT_A_FEED"
  | "NETWORK_ERROR";

export type FeedFetchResult =
  | {
      ok: true;
      body: string;
      /** The URL actually read, after redirects. */
      finalUrl: string;
      contentType: string | null;
      byteLength: number;
    }
  | {
      ok: false;
      code: FetchFailureCode;
      /** Plain language for staff. Never a stack trace, never an internal address. */
      message: string;
    };

/** Content types a feed may legitimately arrive as. */
const FEED_CONTENT_TYPES = [
  "application/rss+xml",
  "application/atom+xml",
  "application/xml",
  "text/xml",
  "application/rdf+xml",
  "application/json", // JSON Feed — recognised so the message can be honest
  "text/plain", // some servers mislabel; the parser decides
];

function looksLikeFeedType(contentType: string | null): boolean {
  if (!contentType) return true; // absent header — let the parser judge
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return FEED_CONTENT_TYPES.some((allowed) => type === allowed || type.endsWith("+xml"));
}

/**
 * Resolves a hostname and refuses if it lands anywhere private.
 *
 * ALL resolved addresses are checked, not just the first: a name answering both a
 * public and a private address must not be usable by picking the lucky one.
 */
async function resolvesPublicly(
  hostname: string,
): Promise<{ ok: true } | { ok: false; code: FetchFailureCode; message: string }> {
  // A literal IP is already judged by the shape check; no lookup needed.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) {
    return isPermittedAddress(hostname)
      ? { ok: true }
      : {
          ok: false,
          code: "ADDRESS_NOT_ALLOWED",
          message: "That address is not a public internet address.",
        };
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return {
      ok: false,
      code: "DNS_FAILED",
      message: "That website could not be found. Check the address.",
    };
  }

  if (addresses.length === 0) {
    return {
      ok: false,
      code: "DNS_FAILED",
      message: "That website could not be found. Check the address.",
    };
  }

  for (const entry of addresses) {
    if (!isPermittedAddress(entry.address)) {
      // The offending address is deliberately NOT echoed: it is a fact about AXIS's
      // internal network, and this message is shown to staff and written to a run log.
      return {
        ok: false,
        code: "ADDRESS_NOT_ALLOWED",
        message:
          "That website resolves to an address inside a private network, so it cannot be used as a content source.",
      };
    }
  }

  return { ok: true };
}

/** Reads a response body with a hard byte cap, abandoning it the moment it is exceeded. */
async function readCapped(
  response: Response,
): Promise<{ ok: true; text: string; byteLength: number } | { ok: false }> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    const byteLength = Buffer.byteLength(text, "utf8");
    return byteLength > MAX_FEED_BYTES ? { ok: false } : { ok: true, text, byteLength };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_FEED_BYTES) {
        // Stop pulling immediately — the point of the cap is not to buffer the rest.
        await reader.cancel().catch(() => undefined);
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false };
  }

  return {
    ok: true,
    text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    byteLength: total,
  };
}

/**
 * Fetches one approved feed URL.
 *
 * Never throws: a failing source must be reportable as one line in a run summary, not
 * an exception that takes the whole ingestion down with it.
 */
export async function fetchFeed(rawUrl: string): Promise<FeedFetchResult> {
  let current = rawUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      // Re-validated on EVERY hop, not just the first. This is the check a redirect
      // to a metadata endpoint has to get past, and it does not.
      const validated = validateSourceUrl(current);
      if (!validated.ok) {
        return {
          ok: false,
          code: hop === 0 ? "URL_NOT_ALLOWED" : "REDIRECT_NOT_ALLOWED",
          message:
            hop === 0
              ? validated.message
              : "That website redirected somewhere this platform is not allowed to read.",
        };
      }

      const dns = await resolvesPublicly(validated.hostname);
      if (!dns.ok) {
        return {
          ok: false,
          code: hop === 0 ? dns.code : "REDIRECT_NOT_ALLOWED",
          message:
            hop === 0
              ? dns.message
              : "That website redirected to an address inside a private network.",
        };
      }

      let response: Response;
      try {
        response = await fetch(validated.url, {
          method: "GET",
          // Manual: undici must not follow a redirect past the checks above.
          redirect: "manual",
          signal: controller.signal,
          headers: {
            // Identifies AXIS honestly to publishers; carries no credential.
            "user-agent": "AXIS-Newsletter/1.0 (+content source reader)",
            accept:
              "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5",
          },
          // No cookies, no cached credentials, no AXIS identity of any kind.
          credentials: "omit",
          cache: "no-store",
        });
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        return aborted
          ? { ok: false, code: "TIMEOUT", message: "That website took too long to answer." }
          : {
              ok: false,
              code: "NETWORK_ERROR",
              message: "That website could not be reached.",
            };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return {
            ok: false,
            code: "HTTP_ERROR",
            message: "That website redirected without saying where.",
          };
        }
        // Resolved against the current URL so a relative Location still lands where
        // the next hop's validation can judge it.
        try {
          current = new URL(location, validated.url).toString();
        } catch {
          return {
            ok: false,
            code: "REDIRECT_NOT_ALLOWED",
            message: "That website redirected to an address that could not be read.",
          };
        }
        continue;
      }

      if (!response.ok) {
        return {
          ok: false,
          code: "HTTP_ERROR",
          // The status number is useful and harmless; the body is neither.
          message: `That website answered with an error (${response.status}).`,
        };
      }

      const contentType = response.headers.get("content-type");
      if (!looksLikeFeedType(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        return {
          ok: false,
          code: "NOT_A_FEED",
          message:
            "That address returned a web page rather than a feed. Look for the site's RSS or Atom address.",
        };
      }

      // A declared length over the cap is refused before a byte is read.
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > MAX_FEED_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        return {
          ok: false,
          code: "TOO_LARGE",
          message: "That feed is too large to read.",
        };
      }

      const read = await readCapped(response);
      if (!read.ok) {
        return {
          ok: false,
          code: "TOO_LARGE",
          message: "That feed is too large to read.",
        };
      }

      return {
        ok: true,
        body: read.text,
        finalUrl: validated.url,
        contentType,
        byteLength: read.byteLength,
      };
    }

    return {
      ok: false,
      code: "TOO_MANY_REDIRECTS",
      message: "That website redirected too many times.",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

export type FeedFetcher = (url: string) => Promise<FeedFetchResult>;

let override: FeedFetcher | undefined;

/**
 * Replaces the fetcher for tests.
 *
 * The suite must never reach the internet: a test that did would be slow, flaky, and —
 * worse — would make AXIS's CI a source of traffic to somebody else's website.
 */
export function setFeedFetcherForTesting(fetcher: FeedFetcher | undefined): void {
  override = fetcher;
}

export function getFeedFetcher(): FeedFetcher {
  return override ?? fetchFeed;
}
