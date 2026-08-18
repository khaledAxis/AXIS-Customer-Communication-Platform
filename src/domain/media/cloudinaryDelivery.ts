/**
 * Cloudinary delivery-URL shaping for email (ADR-0016).
 *
 * Pure string transformation — no SDK, no I/O, no credentials. The stored asset is
 * left untouched; only the delivery URL is reshaped, so historical emails that
 * reference an older URL keep working.
 *
 * Sizing: the email container is 640px wide, so 1280px covers a 2x retina display.
 * `c_limit` only ever scales DOWN and preserves aspect ratio — a smaller image is
 * never upscaled and nothing is cropped.
 */

/** Physical pixels delivered for a 640px email container (2x for retina). */
export const EMAIL_IMAGE_MAX_WIDTH = 1280;

/** The logo is displayed at 200px, so 440px covers a 2x display with headroom. */
export const EMAIL_LOGO_DISPLAY_WIDTH = 200;
export const EMAIL_LOGO_MAX_WIDTH = 440;

const CLOUDINARY_DELIVERY = /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//i;

/** True for an HTTPS Cloudinary image delivery URL. */
export function isCloudinaryUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && CLOUDINARY_DELIVERY.test(url);
}

/**
 * Build the transformation segment.
 *
 * `f_auto` is deliberately NOT used: it can negotiate AVIF, which several email
 * clients cannot display. WebP is converted to JPEG because Outlook on Windows does
 * not render WebP; every other format is delivered as uploaded so PNG transparency
 * (logos) survives.
 */
export function emailTransformation(sourceUrl: string): string {
  const isWebp = /\.webp($|\?)/i.test(sourceUrl);
  const parts = [`c_limit`, `w_${EMAIL_IMAGE_MAX_WIDTH}`, "q_auto"];
  if (isWebp) parts.push("f_jpg");
  return parts.join(",");
}

/**
 * Return the URL to place in the newsletter.
 *
 * Non-Cloudinary URLs are returned unchanged — this function adds email sizing, it
 * does not decide deliverability (that stays with `deliverableImageUrl`).
 * Applying it twice is a no-op, so re-rendering can never stack transformations.
 */
export function emailDeliveryUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!isCloudinaryUrl(url)) return url;

  const marker = "/image/upload/";
  const at = url.indexOf(marker);
  if (at === -1) return url;

  const head = url.slice(0, at + marker.length);
  const tail = url.slice(at + marker.length);

  // Already shaped by us — leave it alone rather than nesting transformations.
  if (/^c_limit,w_\d+,q_auto(,f_jpg)?\//.test(tail)) return url;

  return `${head}${emailTransformation(url)}/${tail}`;
}

/**
 * Delivery URL for the header logo.
 *
 * A brand logo is displayed far smaller than a hero image, and an unoptimised source
 * file can easily be hundreds of kilobytes — real weight in every message. This caps
 * it at the logo's retina width instead of the hero width.
 *
 * `c_limit` only scales DOWN and preserves aspect ratio, so the logo is never
 * stretched, cropped, or upscaled. Idempotent, like `emailDeliveryUrl`.
 */
export function emailLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!isCloudinaryUrl(url)) return url;

  const marker = "/image/upload/";
  const at = url.indexOf(marker);
  if (at === -1) return url;

  const head = url.slice(0, at + marker.length);
  const tail = url.slice(at + marker.length);

  // Already shaped by us — leave it alone rather than nesting transformations.
  if (new RegExp("^c_limit,w_[0-9]+,q_auto(,f_jpg)?/").test(tail)) return url;

  return `${head}c_limit,w_${EMAIL_LOGO_MAX_WIDTH},q_auto/${tail}`;
}
