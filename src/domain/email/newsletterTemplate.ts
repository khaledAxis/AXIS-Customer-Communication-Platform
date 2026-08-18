/**
 * THE canonical newsletter renderer (ADR-0011).
 *
 * There is exactly ONE email HTML generator in this codebase. The browser preview
 * and any future provider adapter (e.g. Microsoft Graph) both call `renderNewsletterHtml`
 * with the same document, so what a user previews is byte-identical to what would be
 * sent. Never add a second "preview-only" layout.
 *
 * Constraints this file honours:
 *  - table-based layout + inline styles (email clients ignore <style> blocks,
 *    external CSS, flexbox/grid, and Tailwind classes)
 *  - deterministic: same input -> byte-identical output (no dates, no randomness)
 *  - RTL via real `dir` semantics for Hebrew and Arabic, not just right-alignment
 *  - pure: no I/O, no framework imports
 */

import { escapeHtml, isSafeUrl } from "../content/richText";

export type NewsletterLanguage = "HE" | "AR" | "UNKNOWN";

export interface NewsletterItem {
  title: string;
  /** Short summary shown under the title. */
  summary?: string | null;
  /** Pre-rendered body HTML from `renderRichText` — never raw user HTML. */
  bodyHtml?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  /** External article link — renders a "Read more" action when present. */
  externalUrl?: string | null;
  sourceName?: string | null;
  /** Per-campaign overrides (CampaignContentItem). */
  customHeading?: string | null;
  customIntro?: string | null;
}

export interface NewsletterBrand {
  companyName: string;
  tagline?: string | null;
  contactEmail: string;
  contactPhone?: string | null;
  websiteUrl?: string | null;
  /** Absolute base used to turn app-relative media paths into email-safe URLs. */
  baseUrl: string;
}

export interface NewsletterDocument {
  subject: string;
  preheader?: string | null;
  language: NewsletterLanguage;
  /** Optional intro paragraph shown under the newsletter heading. */
  introHtml?: string | null;
  items: NewsletterItem[];
  brand: NewsletterBrand;
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
  unsubscribe: string;
  unsubscribePlaceholder: string;
  testBanner: string;
  viewSource: string;
}

const LABELS: Record<"he" | "ar" | "en", Labels> = {
  he: {
    readMore: "קראו עוד",
    unsubscribe: "הסרה מרשימת התפוצה",
    unsubscribePlaceholder: "קישור ההסרה יופעל לפני השליחה בפועל",
    testBanner: "מצב בדיקה — הודעה זו אינה נשלחת ללקוחות",
    viewSource: "מקור",
  },
  ar: {
    readMore: "اقرأ المزيد",
    unsubscribe: "إلغاء الاشتراك",
    unsubscribePlaceholder: "سيتم تفعيل رابط إلغاء الاشتراك قبل الإرسال الفعلي",
    testBanner: "وضع الاختبار — لا يتم إرسال هذه الرسالة إلى العملاء",
    viewSource: "المصدر",
  },
  en: {
    readMore: "Read more",
    unsubscribe: "Unsubscribe",
    unsubscribePlaceholder: "Unsubscribe link is activated before real sending",
    testBanner: "TEST MODE — this message is not delivered to customers",
    viewSource: "Source",
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

const PALETTE = {
  ink: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  line: "#e2e8f0",
  brand: "#0b5cab",
  canvas: "#f1f5f9",
  surface: "#ffffff",
  testBg: "#fff7ed",
  testInk: "#9a3412",
  testLine: "#fdba74",
} as const;

function renderItem(item: NewsletterItem, dir: "rtl" | "ltr", labels: Labels, brand: NewsletterBrand): string {
  const align = dir === "rtl" ? "right" : "left";
  const heading = escapeHtml(item.customHeading?.trim() || item.title);
  const image = absoluteUrl(item.imageUrl, brand.baseUrl);
  const alt = escapeHtml(item.imageAlt ?? item.title);

  const parts: string[] = [];

  if (image) {
    parts.push(
      `<tr><td style="padding:0 0 16px;" align="${align}">` +
        `<img src="${image}" alt="${alt}" width="536" ` +
        `style="display:block;width:100%;max-width:536px;height:auto;border:0;outline:none;text-decoration:none;border-radius:8px;" /></td></tr>`,
    );
  }

  parts.push(
    `<tr><td dir="${dir}" align="${align}" style="padding:0 0 8px;text-align:${align};">` +
      `<h2 style="margin:0;font-size:20px;line-height:1.35;font-weight:700;color:${PALETTE.ink};">${heading}</h2></td></tr>`,
  );

  if (item.sourceName && item.sourceName.trim() !== "") {
    parts.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:0 0 10px;text-align:${align};">` +
        `<span style="font-size:12px;color:${PALETTE.muted};">${escapeHtml(item.sourceName)}</span></td></tr>`,
    );
  }

  if (item.customIntro && item.customIntro.trim() !== "") {
    parts.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:0 0 8px;text-align:${align};">` +
        `<p style="margin:0;font-size:15px;line-height:1.65;color:${PALETTE.body};font-style:italic;">${escapeHtml(item.customIntro)}</p></td></tr>`,
    );
  }

  if (item.summary && item.summary.trim() !== "") {
    parts.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:0 0 10px;text-align:${align};">` +
        `<p style="margin:0;font-size:15px;line-height:1.65;color:${PALETTE.body};">${escapeHtml(item.summary)}</p></td></tr>`,
    );
  }

  if (item.bodyHtml && item.bodyHtml.trim() !== "") {
    // Already rendered by renderRichText (escaped at source) — safe to embed.
    parts.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:0 0 4px;text-align:${align};">${item.bodyHtml}</td></tr>`,
    );
  }

  const link = absoluteUrl(item.externalUrl, brand.baseUrl);
  if (link && isSafeUrl(link)) {
    parts.push(
      `<tr><td dir="${dir}" align="${align}" style="padding:8px 0 0;text-align:${align};">` +
        `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" ` +
        `style="display:inline-block;padding:10px 18px;background:${PALETTE.brand};color:#ffffff;` +
        `font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">${labels.readMore}</a></td></tr>`,
    );
  }

  return (
    `<tr><td style="padding:0 24px 28px;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" dir="${dir}" ` +
    `style="width:100%;border-collapse:collapse;">${parts.join("")}</table></td></tr>`
  );
}

/**
 * Render the complete email document. Deterministic and self-contained.
 */
export function renderNewsletterHtml(doc: NewsletterDocument): string {
  const dir = directionFor(doc.language);
  const locale = localeFor(doc.language);
  const labels = LABELS[locale];
  const align = dir === "rtl" ? "right" : "left";
  const brand = doc.brand;

  const preheader = doc.preheader?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${escapeHtml(doc.preheader)}</div>`
    : "";

  const testBanner = doc.isTestMode
    ? `<tr><td dir="${dir}" align="center" style="padding:12px 24px;background:${PALETTE.testBg};` +
      `border-bottom:1px solid ${PALETTE.testLine};text-align:center;">` +
      `<span style="font-size:13px;font-weight:700;color:${PALETTE.testInk};">${labels.testBanner}</span></td></tr>`
    : "";

  const intro = doc.introHtml?.trim()
    ? `<tr><td dir="${dir}" align="${align}" style="padding:0 24px 24px;text-align:${align};">${doc.introHtml}</td></tr>`
    : "";

  const items = doc.items.map((item) => renderItem(item, dir, labels, brand)).join(
    `<tr><td style="padding:0 24px;"><div style="height:1px;background:${PALETTE.line};margin:0 0 28px;"></div></td></tr>`,
  );

  const unsubHref = doc.unsubscribeUrl && isSafeUrl(doc.unsubscribeUrl) ? doc.unsubscribeUrl : null;
  const unsubscribe = unsubHref
    ? `<a href="${escapeHtml(unsubHref)}" style="color:${PALETTE.muted};text-decoration:underline;">${labels.unsubscribe}</a>`
    : `<span style="color:${PALETTE.muted};text-decoration:underline;">${labels.unsubscribe}</span>` +
      `<br /><span style="font-size:11px;color:${PALETTE.muted};">${labels.unsubscribePlaceholder}</span>`;

  const website = brand.websiteUrl && isSafeUrl(brand.websiteUrl)
    ? ` &nbsp;·&nbsp; <a href="${escapeHtml(brand.websiteUrl)}" style="color:${PALETTE.muted};text-decoration:underline;">${escapeHtml(
        brand.websiteUrl.replace(/^https?:\/\//i, ""),
      )}</a>`
    : "";

  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(doc.subject)}</title>
<style>
  /* Progressive enhancement only — every critical style is also inline. */
  @media only screen and (max-width:620px) {
    .axis-shell { width:100% !important; }
    .axis-pad { padding-left:16px !important; padding-right:16px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${PALETTE.canvas};-webkit-text-size-adjust:100%;">
${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" dir="${dir}" style="background:${PALETTE.canvas};width:100%;border-collapse:collapse;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="axis-shell" dir="${dir}" style="width:600px;max-width:600px;background:${PALETTE.surface};border-collapse:collapse;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,'Helvetica Neue',sans-serif;">
${testBanner}
<tr><td dir="${dir}" align="${align}" style="padding:24px;background:${PALETTE.ink};text-align:${align};">
  <span style="display:inline-block;font-size:22px;font-weight:800;letter-spacing:1px;color:#ffffff;">${escapeHtml(brand.companyName)}</span>
  ${brand.tagline ? `<div style="margin-top:4px;font-size:12px;color:#94a3b8;">${escapeHtml(brand.tagline)}</div>` : ""}
</td></tr>
<tr><td dir="${dir}" align="${align}" class="axis-pad" style="padding:28px 24px 12px;text-align:${align};">
  <h1 style="margin:0;font-size:24px;line-height:1.3;font-weight:800;color:${PALETTE.ink};">${escapeHtml(doc.subject)}</h1>
</td></tr>
${intro}
<tr><td style="padding:12px 0 0;"></td></tr>
${items}
<tr><td dir="${dir}" align="${align}" class="axis-pad" style="padding:20px 24px 24px;background:#f8fafc;border-top:1px solid ${PALETTE.line};text-align:${align};">
  <div style="font-size:13px;font-weight:700;color:${PALETTE.ink};">${escapeHtml(brand.companyName)}</div>
  <div style="margin-top:4px;font-size:12px;line-height:1.6;color:${PALETTE.muted};">
    <a href="mailto:${escapeHtml(brand.contactEmail)}" style="color:${PALETTE.muted};text-decoration:underline;">${escapeHtml(brand.contactEmail)}</a>
    ${brand.contactPhone ? ` &nbsp;·&nbsp; ${escapeHtml(brand.contactPhone)}` : ""}${website}
  </div>
  <div style="margin-top:12px;font-size:12px;line-height:1.6;color:${PALETTE.muted};">${unsubscribe}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Plain-text alternative for the eventual multipart/alternative send. */
export function renderNewsletterText(doc: NewsletterDocument): string {
  const labels = LABELS[localeFor(doc.language)];
  const lines: string[] = [doc.brand.companyName, "", doc.subject, ""];

  for (const item of doc.items) {
    lines.push(`— ${item.customHeading?.trim() || item.title}`);
    if (item.summary?.trim()) lines.push(item.summary.trim());
    const link = absoluteUrl(item.externalUrl, doc.brand.baseUrl);
    if (link) lines.push(`${labels.readMore}: ${link}`);
    lines.push("");
  }

  lines.push(doc.brand.companyName, doc.brand.contactEmail);
  if (doc.unsubscribeUrl) lines.push(`${labels.unsubscribe}: ${doc.unsubscribeUrl}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
