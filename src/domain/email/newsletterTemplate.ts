/**
 * THE canonical newsletter renderer (ADR-0011, redesigned by ADR-0015).
 *
 * There is exactly ONE email HTML generator in this codebase. The browser preview and
 * the provider adapter both call `renderNewsletterHtml` with the same document, so what
 * a user previews is byte-identical to what is sent — which is what makes the approval
 * hash meaningful. Never add a second "preview-only" layout.
 *
 * Constraints this file honours:
 *  - table-based layout + inline styles (email clients ignore <style> blocks,
 *    external CSS, flexbox/grid, and Tailwind classes)
 *  - deterministic: same input -> byte-identical output (no dates, no randomness)
 *  - RTL via real `dir` semantics for Hebrew and Arabic, with LTR fragments
 *    (brand, product codes, URLs, emails) isolated so bidi cannot reorder them
 *  - non-deliverable images are OMITTED, never rendered as a broken box
 *  - pure: no I/O, no framework imports
 */

import { escapeHtml, isSafeUrl } from "../content/richText";
import {
  EMAIL_LOGO_DISPLAY_WIDTH,
  emailDeliveryUrl,
  emailLogoUrl,
} from "../media/cloudinaryDelivery";
import { isPublicHttpsUrl } from "../media/publicUrl";

export type NewsletterLanguage = "HE" | "AR" | "UNKNOWN";

export interface NewsletterItem {
  title: string;
  /** Short summary shown under the title. */
  summary?: string | null;
  /** Pre-rendered body HTML from `renderRichText` — never raw user HTML. */
  bodyHtml?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  /** External article link — renders a call-to-action button when present. */
  externalUrl?: string | null;
  sourceName?: string | null;
  /** Small uppercase label above the headline (falls back to the source name). */
  kicker?: string | null;
  /** Per-campaign overrides (CampaignContentItem). */
  customHeading?: string | null;
  customIntro?: string | null;
}

export interface NewsletterSocialLink {
  label: string;
  url: string;
}

export interface NewsletterBrand {
  companyName: string;
  tagline?: string | null;
  contactEmail: string;
  contactPhone?: string | null;
  websiteUrl?: string | null;
  /** Postal/company line shown in the footer. */
  addressLine?: string | null;
  socialLinks?: NewsletterSocialLink[];
  privacyUrl?: string | null;
  termsUrl?: string | null;
  /**
   * Optional public HTTPS logo. When absent (or not deliverable) the header falls
   * back to the AXIS text wordmark, which always renders — including with images off.
   */
  logoUrl?: string | null;
  /** Absolute base used to turn app-relative media paths into email-safe URLs. */
  baseUrl: string;
}

export interface NewsletterDocument {
  subject: string;
  preheader?: string | null;
  language: NewsletterLanguage;
  /** Optional intro paragraph shown under the featured headline. */
  introHtml?: string | null;
  items: NewsletterItem[];
  brand: NewsletterBrand;
  /** "View as webpage" link. Rendered only when a real, deliverable URL exists. */
  viewInBrowserUrl?: string | null;
  /**
   * Unsubscribe destination. NOT yet functional — the tokenized public endpoint
   * arrives with the sending milestone (ADR-0008). The footer block is rendered
   * now so the layout is final and reviewable.
   */
  unsubscribeUrl?: string | null;
  /** Renders the TEST banner; production sends must set this false explicitly. */
  isTestMode: boolean;
}

interface Labels {
  readMore: string;
  learnMore: string;
  unsubscribe: string;
  unsubscribePlaceholder: string;
  testBanner: string;
  viewInBrowser: string;
  defaultKicker: string;
  allRightsReserved: string;
  privacy: string;
  terms: string;
}

const LABELS: Record<"he" | "ar" | "en", Labels> = {
  he: {
    readMore: "קראו עוד",
    learnMore: "לפרטים נוספים",
    unsubscribe: "הסרה מרשימת התפוצה",
    unsubscribePlaceholder: "קישור ההסרה יופעל לפני השליחה בפועל",
    testBanner: "מצב בדיקה — הודעה זו אינה נשלחת ללקוחות",
    viewInBrowser: "צפייה בדפדפן",
    defaultKicker: "עדכון",
    allRightsReserved: "כל הזכויות שמורות.",
    privacy: "מדיניות פרטיות",
    terms: "תנאי שימוש",
  },
  ar: {
    readMore: "اقرأ المزيد",
    learnMore: "لمزيد من التفاصيل",
    unsubscribe: "إلغاء الاشتراك",
    unsubscribePlaceholder: "سيتم تفعيل رابط إلغاء الاشتراك قبل الإرسال الفعلي",
    testBanner: "وضع الاختبار — لا يتم إرسال هذه الرسالة إلى العملاء",
    viewInBrowser: "عرض في المتصفح",
    defaultKicker: "تحديث",
    allRightsReserved: "جميع الحقوق محفوظة.",
    privacy: "سياسة الخصوصية",
    terms: "شروط الاستخدام",
  },
  en: {
    readMore: "Read more",
    learnMore: "Learn more",
    unsubscribe: "Unsubscribe",
    unsubscribePlaceholder: "Unsubscribe link is activated before real sending",
    testBanner: "TEST MODE — this message is not delivered to customers",
    viewInBrowser: "View as webpage",
    defaultKicker: "Update",
    allRightsReserved: "All rights reserved.",
    privacy: "Privacy Statement",
    terms: "Terms of Use",
  },
};

/** Hebrew and Arabic are RTL; UNKNOWN falls back to LTR (never guess a language). */
export function directionFor(language: NewsletterLanguage): "rtl" | "ltr" {
  return language === "HE" || language === "AR" ? "rtl" : "ltr";
}

function localeFor(language: NewsletterLanguage): "he" | "ar" | "en" {
  if (language === "HE") return "he";
  if (language === "AR") return "ar";
  return "en";
}

/** Make an app-relative media path absolute so email clients can load it. */
export function absoluteUrl(url: string | null | undefined, baseUrl: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed === "") return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return `${baseUrl.replace(/\/+$/, "")}${trimmed}`;
  return null; // anything else (data:, javascript:, relative junk) is refused
}

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;

/** A host only this machine can resolve is useless to a recipient. */
export function isDeliverableImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return !LOCAL_HOST.test(url);
}

/**
 * The image URL to actually put in the email, or null.
 *
 * Returning null means the picture is OMITTED entirely — the layout closes up rather
 * than showing a broken image box to the recipient (ADR-0015). Because preview and
 * send share this renderer, the preview shows the same omission, so nobody approves a
 * layout that will not arrive.
 */
export function deliverableImageUrl(
  url: string | null | undefined,
  baseUrl: string,
): string | null {
  const absolute = absoluteUrl(url, baseUrl);
  if (!isDeliverableImageUrl(absolute)) return null;
  // Hosted assets are reshaped for the 640px email container; anything else passes
  // through unchanged. Applying this twice is a no-op.
  return emailDeliveryUrl(absolute);
}

/**
 * Escape text and isolate Latin runs so the bidi algorithm cannot reorder them inside
 * RTL copy. Without this, "AXIS GPS & Mapping Solutions" or "GPS-3000" can have their
 * punctuation flipped to the wrong end in Outlook.
 *
 * Isolation happens on the RAW text before escaping, so an entity such as `&amp;` can
 * never be split apart.
 */
export function escapeWithLtrIsolation(raw: string, dir: "rtl" | "ltr"): string {
  if (dir === "ltr") return escapeHtml(raw);

  // A contiguous Latin PHRASE: a Latin word plus any following Latin words joined by
  // spaces or an ampersand. Wrapping each word separately would be noisy and would
  // still leave the punctuation between them subject to reordering.
  const LATIN_RUN =
    /[A-Za-z][A-Za-z0-9@._+':/-]*(?:[ 	,&]+[A-Za-z0-9][A-Za-z0-9@._+':/-]*)*/g;

  let out = "";
  let index = 0;
  for (const match of raw.matchAll(LATIN_RUN)) {
    const start = match.index ?? 0;
    out += escapeHtml(raw.slice(index, start));
    out += `<span dir="ltr">${escapeHtml(match[0])}</span>`;
    index = start + match[0].length;
  }
  out += escapeHtml(raw.slice(index));
  return out;
}

/** Brand/contact fragments are always Latin — isolate them unconditionally. */
function ltr(raw: string): string {
  return `<span dir="ltr">${escapeHtml(raw)}</span>`;
}

const PALETTE = {
  ink: "#111827",
  body: "#374151",
  muted: "#6b7280",
  faint: "#9ca3af",
  line: "#e5e7eb",
  brand: "#0b5cab",
  brandDark: "#0a4d8f",
  canvas: "#eef1f5",
  band: "#f3f4f6",
  surface: "#ffffff",
  testBg: "#fff7ed",
  testInk: "#9a3412",
  testLine: "#fdba74",
} as const;

/** Prescribed alt text for the brand logo (shown when a client blocks images). */
export const LOGO_ALT_TEXT = "AXIS Advanced Mapping Solutions";

const FONT = "Arial, Helvetica, 'Segoe UI', sans-serif";
const WIDTH = 640;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/**
 * Pill call-to-action. Table-based so Outlook renders the fill; Outlook ignores
 * border-radius and degrades to a square button, which is acceptable.
 */
function ctaButton(href: string, label: string, dir: "rtl" | "ltr"): string {
  const align = dir === "rtl" ? "right" : "left";
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" ` +
    `style="border-collapse:separate;"><tr>` +
    `<td bgcolor="${PALETTE.brand}" style="border-radius:28px;" align="center">` +
    `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" ` +
    `style="display:inline-block;padding:14px 34px;font-family:${FONT};font-size:14px;` +
    `font-weight:bold;letter-spacing:0.6px;color:#ffffff;text-decoration:none;border-radius:28px;">` +
    `${escapeHtml(label)}</a></td></tr></table>`
  );
}

/** Full-bleed image row. Callers pass only a deliverable URL. */
function imageRow(src: string, alt: string, width: number): string {
  return (
    `<tr><td style="padding:0;font-size:0;line-height:0;">` +
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="${width}" ` +
    `style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;" /></td></tr>`
  );
}

function spacerRow(height: number): string {
  return `<tr><td style="height:${height}px;line-height:${height}px;font-size:0;">&nbsp;</td></tr>`;
}

/** The featured (first) article: hero image, kicker, big headline, lead, CTA. */
function renderFeatured(
  item: NewsletterItem,
  dir: "rtl" | "ltr",
  labels: Labels,
  brand: NewsletterBrand,
  introHtml: string | null,
): string {
  const align = dir === "rtl" ? "right" : "left";
  const hero = deliverableImageUrl(item.imageUrl, brand.baseUrl);
  const headline = item.customHeading?.trim() || item.title;
  const kicker = item.kicker?.trim() || item.sourceName?.trim() || labels.defaultKicker;
  const link = deliverableLink(item.externalUrl, brand.baseUrl);

  const rows: string[] = [];

  if (hero) {
    rows.push(imageRow(hero, item.imageAlt ?? item.title, WIDTH));
  }

  rows.push(
    `<tr><td dir="${dir}" align="${align}" style="padding:36px 40px 0;text-align:${align};">` +
      `<div style="font-family:${FONT};font-size:13px;font-weight:bold;letter-spacing:1.2px;` +
      `text-transform:uppercase;color:${PALETTE.brand};">${escapeWithLtrIsolation(kicker, dir)}</div></td></tr>`,
  );

  rows.push(
    `<tr><td dir="${dir}" align="${align}" style="padding:12px 40px 0;text-align:${align};">` +
      `<h1 style="margin:0;font-family:${FONT};font-size:30px;line-height:1.25;font-weight:bold;` +
      `color:${PALETTE.ink};">${escapeWithLtrIsolation(headline, dir)}</h1></td></tr>`,
  );

  if (item.customIntro?.trim()) {
    rows.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:18px 40px 0;text-align:${align};">` +
        `<p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.6;font-weight:bold;` +
        `color:${PALETTE.ink};">${escapeWithLtrIsolation(item.customIntro, dir)}</p></td></tr>`,
    );
  }

  if (item.summary?.trim()) {
    rows.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:18px 40px 0;text-align:${align};">` +
        `<p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.65;color:${PALETTE.body};">` +
        `${escapeWithLtrIsolation(item.summary, dir)}</p></td></tr>`,
    );
  }

  if (introHtml?.trim()) {
    rows.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:18px 40px 0;text-align:${align};` +
        `font-family:${FONT};font-size:16px;line-height:1.65;color:${PALETTE.body};">${introHtml}</td></tr>`,
    );
  }

  if (item.bodyHtml?.trim()) {
    rows.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:18px 40px 0;text-align:${align};` +
        `font-family:${FONT};font-size:16px;line-height:1.65;color:${PALETTE.body};">${item.bodyHtml}</td></tr>`,
    );
  }

  if (link) {
    rows.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:28px 40px 0;">` +
        `${ctaButton(link, labels.learnMore, dir)}</td></tr>`,
    );
  }

  rows.push(spacerRow(40));
  return rows.join("");
}

/** A secondary article: compact image, title, summary, text link. */
function renderSecondary(
  item: NewsletterItem,
  dir: "rtl" | "ltr",
  labels: Labels,
  brand: NewsletterBrand,
): string {
  const align = dir === "rtl" ? "right" : "left";
  const image = deliverableImageUrl(item.imageUrl, brand.baseUrl);
  const heading = item.customHeading?.trim() || item.title;
  const link = deliverableLink(item.externalUrl, brand.baseUrl);
  const arrow = dir === "rtl" ? "&#8592;" : "&#8594;";

  const rows: string[] = [];

  if (image) {
    rows.push(imageRow(image, item.imageAlt ?? item.title, WIDTH - 80));
    rows.push(spacerRow(18));
  }

  if (item.sourceName?.trim()) {
    rows.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:0 0 6px;text-align:${align};">` +
        `<span style="font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:1px;` +
        `text-transform:uppercase;color:${PALETTE.muted};">${escapeWithLtrIsolation(item.sourceName, dir)}</span></td></tr>`,
    );
  }

  rows.push(
    `<tr><td dir="${dir}" align="${align}" style="padding:0;text-align:${align};">` +
      `<h2 style="margin:0;font-family:${FONT};font-size:20px;line-height:1.35;font-weight:bold;` +
      `color:${PALETTE.ink};">${escapeWithLtrIsolation(heading, dir)}</h2></td></tr>`,
  );

  if (item.customIntro?.trim()) {
    rows.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:10px 0 0;text-align:${align};">` +
        `<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;font-style:italic;` +
        `color:${PALETTE.muted};">${escapeWithLtrIsolation(item.customIntro, dir)}</p></td></tr>`,
    );
  }

  if (item.summary?.trim()) {
    rows.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:10px 0 0;text-align:${align};">` +
        `<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.65;color:${PALETTE.body};">` +
        `${escapeWithLtrIsolation(item.summary, dir)}</p></td></tr>`,
    );
  }

  if (item.bodyHtml?.trim()) {
    rows.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:10px 0 0;text-align:${align};` +
        `font-family:${FONT};font-size:15px;line-height:1.65;color:${PALETTE.body};">${item.bodyHtml}</td></tr>`,
    );
  }

  if (link) {
    rows.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:14px 0 0;text-align:${align};">` +
        `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" ` +
        `style="font-family:${FONT};font-size:14px;font-weight:bold;color:${PALETTE.brand};text-decoration:none;">` +
        `${labels.readMore} ${arrow}</a></td></tr>`,
    );
  }

  return (
    `<tr><td style="padding:0 40px;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" dir="${dir}" ` +
    `style="width:100%;border-collapse:collapse;">${rows.join("")}</table></td></tr>`
  );
}

/** Links are validated the same way images are, minus the localhost rule. */
function deliverableLink(url: string | null | undefined, baseUrl: string): string | null {
  const absolute = absoluteUrl(url, baseUrl);
  return absolute && isSafeUrl(absolute) ? absolute : null;
}

function renderFooter(doc: NewsletterDocument, dir: "rtl" | "ltr", labels: Labels): string {
  const brand = doc.brand;
  const rows: string[] = [];

  // Wordmark — always Latin, so it is isolated and centred.
  rows.push(
    `<tr><td align="center" style="padding:0 0 18px;">` +
      `<span style="font-family:${FONT};font-size:20px;font-weight:bold;letter-spacing:2px;` +
      `color:${PALETTE.ink};">${ltr(brand.companyName)}</span></td></tr>`,
  );

  const social = (brand.socialLinks ?? []).filter((link) => isSafeUrl(link.url));
  if (social.length > 0) {
    const cells = social
      .map(
        (link) =>
          `<td style="padding:0 6px;"><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" ` +
          `style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;` +
          `border:1px solid ${PALETTE.line};border-radius:17px;font-family:${FONT};font-size:12px;` +
          `font-weight:bold;color:${PALETTE.body};text-decoration:none;">${escapeHtml(link.label.slice(0, 2))}</a></td>`,
      )
      .join("");
    rows.push(
      `<tr><td align="center" style="padding:0 0 20px;">` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" dir="ltr" ` +
        `style="border-collapse:collapse;"><tr>${cells}</tr></table></td></tr>`,
    );
  }

  const legal: string[] = [];
  if (brand.privacyUrl && isSafeUrl(brand.privacyUrl)) {
    legal.push(
      `<a href="${escapeHtml(brand.privacyUrl)}" style="color:${PALETTE.brand};text-decoration:none;font-weight:bold;">${labels.privacy}</a>`,
    );
  }
  if (brand.termsUrl && isSafeUrl(brand.termsUrl)) {
    legal.push(
      `<a href="${escapeHtml(brand.termsUrl)}" style="color:${PALETTE.brand};text-decoration:none;font-weight:bold;">${labels.terms}</a>`,
    );
  }

  rows.push(
    `<tr><td align="center" dir="${dir}" style="padding:0 0 6px;text-align:center;` +
      `font-family:${FONT};font-size:12px;line-height:1.7;color:${PALETTE.muted};">` +
      `${labels.allRightsReserved}${legal.length > 0 ? `<br />${legal.join(" &nbsp;|&nbsp; ")}` : ""}</td></tr>`,
  );

  const contact: string[] = [
    `<a href="mailto:${escapeHtml(brand.contactEmail)}" style="color:${PALETTE.muted};text-decoration:underline;">${ltr(brand.contactEmail)}</a>`,
  ];
  if (brand.contactPhone?.trim()) contact.push(ltr(brand.contactPhone));
  if (brand.websiteUrl && isSafeUrl(brand.websiteUrl)) {
    contact.push(
      `<a href="${escapeHtml(brand.websiteUrl)}" style="color:${PALETTE.muted};text-decoration:underline;">` +
        `${ltr(brand.websiteUrl.replace(/^https?:\/\//i, ""))}</a>`,
    );
  }

  rows.push(
    `<tr><td align="center" dir="${dir}" style="padding:0 0 6px;text-align:center;` +
      `font-family:${FONT};font-size:12px;line-height:1.7;color:${PALETTE.muted};">` +
      `${contact.join(" &nbsp;&#183;&nbsp; ")}</td></tr>`,
  );

  if (brand.addressLine?.trim()) {
    rows.push(
      `<tr><td align="center" dir="${dir}" style="padding:0 0 14px;text-align:center;` +
        `font-family:${FONT};font-size:12px;line-height:1.7;color:${PALETTE.faint};">` +
        `${escapeWithLtrIsolation(brand.addressLine, dir)}</td></tr>`,
    );
  }

  const unsubHref = doc.unsubscribeUrl && isSafeUrl(doc.unsubscribeUrl) ? doc.unsubscribeUrl : null;
  const unsubscribe = unsubHref
    ? `<a href="${escapeHtml(unsubHref)}" style="color:${PALETTE.brand};text-decoration:underline;font-weight:bold;">${labels.unsubscribe}</a>`
    : `<span style="color:${PALETTE.brand};text-decoration:underline;font-weight:bold;">${labels.unsubscribe}</span>` +
      `<br /><span style="font-size:11px;color:${PALETTE.faint};">${labels.unsubscribePlaceholder}</span>`;

  rows.push(
    `<tr><td align="center" dir="${dir}" style="padding:12px 0 0;text-align:center;` +
      `font-family:${FONT};font-size:12px;line-height:1.7;">${unsubscribe}</td></tr>`,
  );

  return (
    `<tr><td class="axis-pad" style="padding:32px 40px 36px;background:${PALETTE.surface};border-top:1px solid ${PALETTE.line};">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="width:100%;border-collapse:collapse;">${rows.join("")}</table></td></tr>`
  );
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * Render the complete email document. Deterministic and self-contained.
 */
export function renderNewsletterHtml(doc: NewsletterDocument): string {
  const dir = directionFor(doc.language);
  const locale = localeFor(doc.language);
  const labels = LABELS[locale];
  const align = dir === "rtl" ? "right" : "left";
  const endAlign = dir === "rtl" ? "left" : "right";
  const brand = doc.brand;

  const preheader = doc.preheader?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${escapeHtml(doc.preheader)}</div>`
    : "";

  const testBanner = doc.isTestMode
    ? `<tr><td dir="${dir}" align="center" style="padding:12px 24px;background:${PALETTE.testBg};` +
      `border-bottom:1px solid ${PALETTE.testLine};text-align:center;font-family:${FONT};` +
      `font-size:13px;font-weight:bold;color:${PALETTE.testInk};">${labels.testBanner}</td></tr>`
    : "";

  // Top utility row — rendered only when a real, reachable page exists.
  // Must be reachable by the RECIPIENT — a machine-local address is a dead link.
  const browserLink = deliverableImageUrl(doc.viewInBrowserUrl, brand.baseUrl);
  const utilityRow = browserLink
    ? `<tr><td dir="${dir}" align="${endAlign}" class="axis-pad" ` +
      `style="padding:0 40px 10px;text-align:${endAlign};font-family:${FONT};font-size:12px;">` +
      `<a href="${escapeHtml(browserLink)}" target="_blank" rel="noopener noreferrer" ` +
      `style="color:${PALETTE.brand};text-decoration:none;font-weight:bold;">${labels.viewInBrowser}</a></td></tr>`
    : "";

  // Brand header: a public logo when one is configured, otherwise the AXIS text
  // wordmark. The wordmark always renders — including when a client blocks images.
  // The logo must be reachable by the RECIPIENT: HTTPS only, no loopback, no private
  // or internal host. Anything else falls back to the text wordmark, which always
  // renders — including when a client blocks images.
  const logo = isPublicHttpsUrl(brand.logoUrl) ? emailLogoUrl(brand.logoUrl!) : null;
  const brandMark = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(LOGO_ALT_TEXT)}" ` +
      `width="${EMAIL_LOGO_DISPLAY_WIDTH}" ` +
      // width + height:auto preserves the aspect ratio; max-width keeps it inside a
      // narrow phone. dir="ltr" so bidi never reorders it beside RTL copy.
      `style="display:block;width:${EMAIL_LOGO_DISPLAY_WIDTH}px;max-width:100%;height:auto;` +
      `border:0;outline:none;text-decoration:none;" dir="ltr" />`
    : `<span style="display:inline-block;padding:10px 18px;background:${PALETTE.brandDark};` +
      `font-family:${FONT};font-size:18px;font-weight:bold;letter-spacing:3px;color:#ffffff;">${ltr("AXIS")}</span>`;

  const header =
    `<tr><td class="axis-pad" style="padding:22px 40px;background:${PALETTE.surface};">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" dir="${dir}" ` +
    `style="width:100%;border-collapse:collapse;"><tr>` +
    `<td align="${align}" style="text-align:${align};">` +
    brandMark +
    (brand.tagline
      ? `<div style="padding-top:8px;font-family:${FONT};font-size:12px;color:${PALETTE.muted};">` +
        `${escapeWithLtrIsolation(brand.tagline, dir)}</div>`
      : "") +
    `</td></tr></table></td></tr>`;

  const [featured, ...secondary] = doc.items;

  const featuredBlock = featured
    ? renderFeatured(featured, dir, labels, brand, doc.introHtml ?? null)
    : `<tr><td style="padding:40px;"></td></tr>`;

  const secondaryBlocks =
    secondary.length > 0
      ? `<tr><td style="padding:0 40px;"><div style="height:1px;background:${PALETTE.line};font-size:0;line-height:0;">&nbsp;</div></td></tr>` +
        spacerRow(36) +
        secondary
          .map((item) => renderSecondary(item, dir, labels, brand))
          .join(
            spacerRow(32) +
              `<tr><td style="padding:0 40px;"><div style="height:1px;background:${PALETTE.line};font-size:0;line-height:0;">&nbsp;</div></td></tr>` +
              spacerRow(32),
          ) +
        spacerRow(40)
      : "";

  return `<!doctype html>
<html lang="${locale}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(doc.subject)}</title>
<style>
  /* Progressive enhancement only — every critical style is also inline. */
  @media only screen and (max-width:660px) {
    .axis-shell { width:100% !important; }
    .axis-pad { padding-left:22px !important; padding-right:22px !important; }
    .axis-hpad { padding-left:22px !important; padding-right:22px !important; }
    .axis-h1 { font-size:24px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${PALETTE.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" dir="${dir}" style="background:${PALETTE.canvas};width:100%;border-collapse:collapse;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${WIDTH}" class="axis-shell" dir="${dir}" style="width:${WIDTH}px;max-width:${WIDTH}px;border-collapse:collapse;">
${utilityRow}
<tr><td style="padding:0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" dir="${dir}" style="width:100%;background:${PALETTE.surface};border-collapse:collapse;border:1px solid ${PALETTE.line};">
${testBanner}
${header}
${featuredBlock}
${secondaryBlocks}
${renderFooter(doc, dir, labels)}
</table>
</td></tr>
${spacerRow(24)}
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Plain-text alternative for the multipart/alternative send. */
export function renderNewsletterText(doc: NewsletterDocument): string {
  const labels = LABELS[localeFor(doc.language)];
  const lines: string[] = [doc.brand.companyName, "", doc.subject, ""];

  for (const [index, item] of doc.items.entries()) {
    const heading = item.customHeading?.trim() || item.title;
    lines.push(index === 0 ? `${heading.toUpperCase()}` : `— ${heading}`);
    if (item.summary?.trim()) lines.push(item.summary.trim());
    const link = deliverableLink(item.externalUrl, doc.brand.baseUrl);
    if (link) lines.push(`${labels.readMore}: ${link}`);
    lines.push("");
  }

  lines.push(doc.brand.companyName, doc.brand.contactEmail);
  if (doc.brand.websiteUrl) lines.push(doc.brand.websiteUrl);
  if (doc.brand.addressLine) lines.push(doc.brand.addressLine);
  lines.push(
    doc.unsubscribeUrl ? `${labels.unsubscribe}: ${doc.unsubscribeUrl}` : labels.unsubscribe,
  );

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
