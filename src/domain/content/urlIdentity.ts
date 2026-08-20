/**
 * Article identity for deduplication (ADR-0026).
 *
 * The same article arrives repeatedly: every poll re-lists it, a publisher exposes
 * both `/feed` and `/feed/atom`, and campaign trackers append a different
 * `utm_content` each time. Without a stable key the review inbox fills with copies of
 * the same story and staff stop trusting it.
 *
 * The rule is CONSERVATIVE in one specific direction: it collapses what is provably
 * the same URL, and it never merges on resemblance. Two publishers writing about the
 * same launch are two articles — AXIS may legitimately want to link either — so
 * similarity of title is not, and must never become, a dedup signal.
 *
 * Pure: no I/O.
 */

/**
 * Query parameters that identify a CAMPAIGN, not an article.
 *
 * Stripping these is safe because they never change which page is served. Anything
 * not on this list is preserved, because `?id=123` or `?p=7` very often IS the
 * article, and dropping it would merge unrelated pages into one.
 */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_source_platform",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
  "source",
  "spm",
  "_hsenc",
  "_hsmi",
  "yclid",
  "msclkid",
]);

/**
 * A comparable form of an article URL.
 *
 * - scheme and host lower-cased; `http` and `https` for the same host+path are the
 *   same article, so the scheme is dropped from the key entirely;
 * - a leading `www.` is dropped;
 * - the default port is dropped;
 * - tracking parameters are removed and the rest are sorted, so parameter order
 *   cannot create a second copy;
 * - a trailing slash is dropped;
 * - the fragment is dropped — `#comments` is not a different article.
 *
 * Returns `null` for anything unparseable, and the caller then falls back to the
 * source's own external id. A null key must never be treated as "matches everything".
 */
export function normalizeArticleUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);

  const port =
    parsed.port === "" || parsed.port === "80" || parsed.port === "443"
      ? ""
      : `:${parsed.port}`;

  const kept: [string, string][] = [];
  parsed.searchParams.forEach((value, key) => {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) kept.push([key, value]);
  });
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query =
    kept.length > 0
      ? `?${kept.map(([k, v]) => `${k}=${v}`).join("&")}`
      : "";

  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  // The scheme is deliberately absent from the key: a publisher moving to HTTPS must
  // not resurrect every article it has ever published.
  return `${host}${port}${path}${query}`.toLowerCase();
}

/**
 * The identity used to decide whether an incoming article is already stored.
 *
 * The source's own id wins when it has one — it is the publisher's statement about
 * identity, and it survives a URL change. The normalized URL is the fallback, and one
 * of the two must exist or the article cannot be deduplicated at all.
 */
export interface ArticleIdentity {
  externalId: string | null;
  normalizedUrl: string | null;
}

export function articleIdentity(input: {
  externalId?: string | null;
  canonicalUrl?: string | null;
  externalUrl?: string | null;
}): ArticleIdentity {
  const externalId =
    typeof input.externalId === "string" && input.externalId.trim() !== ""
      ? input.externalId.trim().slice(0, 500)
      : null;

  // The publisher's declared canonical URL is preferred over the link it happened to
  // syndicate — that is exactly what `<link rel="canonical">` is for.
  const normalizedUrl =
    normalizeArticleUrl(input.canonicalUrl) ?? normalizeArticleUrl(input.externalUrl);

  return { externalId, normalizedUrl };
}

/** An article with neither identity cannot be deduplicated, and is not ingested. */
export function isIdentifiable(identity: ArticleIdentity): boolean {
  return identity.externalId !== null || identity.normalizedUrl !== null;
}
