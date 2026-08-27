import { isDeliverableImageUrl } from "../email/newsletterTemplate";

/**
 * The hosted web version of a newsletter, and the "View as webpage" link (ADR-0032).
 *
 * Why it exists: most mail clients block images by default, and several mangle
 * layout. A web version is the escape hatch — one link, near the top, that renders
 * the same newsletter with everything loaded.
 *
 * Two rules make the link trustworthy rather than decorative:
 *
 *  1. **It is per-newsletter.** Previously the template took a single configured URL
 *     that was identical for every send, which is worse than useless: it promises
 *     "this message on the web" and delivers something else.
 *  2. **It is shown only when it would actually work.** The same deliverability rule
 *     images obey (ADR-0015): a URL that resolves only on the sending machine is a
 *     dead link in somebody's inbox days later. No token, or no publicly reachable
 *     origin, and the link is HIDDEN — not rendered greyed-out, not rendered broken.
 *
 * Pure: no I/O, no Prisma, no framework imports.
 */

/** Where hosted newsletters live. Short, because it is typed into address bars. */
export const PUBLIC_NEWSLETTER_PATH = "/n" as const;

/**
 * Builds the public URL for a newsletter, or null when one cannot be promised.
 *
 * Returns null — never a placeholder, never a best guess — when the token is missing
 * or the origin is not something a recipient could reach.
 */
export function publicNewsletterUrl(
  origin: string | null | undefined,
  token: string | null | undefined,
): string | null {
  if (typeof token !== "string" || token.trim() === "") return null;
  if (typeof origin !== "string" || origin.trim() === "") return null;

  const trimmedOrigin = origin.trim().replace(/\/+$/, "");
  const candidate = `${trimmedOrigin}${PUBLIC_NEWSLETTER_PATH}/${encodeURIComponent(token.trim())}`;

  // The recipient has to be able to open it. `http://localhost` is fine for a
  // developer and worthless in an inbox, so it fails this check on purpose.
  return isDeliverableImageUrl(candidate) ? candidate : null;
}

/**
 * Whether a token could address a public page at all.
 *
 * Deliberately strict: the route rejects anything that is not this shape before it
 * touches the database, so a malformed value never becomes a query.
 */
export function isWellFormedPublicToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    token.length >= 16 &&
    token.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(token)
  );
}
