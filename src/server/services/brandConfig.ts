import type { NewsletterBrand, NewsletterSocialLink } from "../../domain/email/newsletterTemplate";

/**
 * Branding + contact details used by the newsletter template.
 *
 * Configuration, not secrets — safe to default in code and override per environment.
 * Every value is AXIS-owned; nothing here references another company's brand.
 */

/**
 * Social links are opt-in via env so the footer never advertises an account that does
 * not exist. Format: "LinkedIn=https://…,Facebook=https://…".
 */
function readSocialLinks(): NewsletterSocialLink[] {
  const raw = (process.env.BRAND_SOCIAL_LINKS ?? "").trim();
  if (raw === "") return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes("="))
    .map((entry) => {
      const separator = entry.indexOf("=");
      return {
        label: entry.slice(0, separator).trim(),
        url: entry.slice(separator + 1).trim(),
      };
    })
    .filter((link) => link.label !== "" && link.url !== "");
}

export function getNewsletterBrand(): NewsletterBrand {
  return {
    companyName: process.env.BRAND_COMPANY_NAME ?? "AXIS GPS & Mapping Solutions",
    tagline: process.env.BRAND_TAGLINE ?? "",
    contactEmail: process.env.BRAND_CONTACT_EMAIL ?? "info@axis-gps.com",
    contactPhone: process.env.BRAND_CONTACT_PHONE ?? null,
    websiteUrl: process.env.BRAND_WEBSITE_URL ?? "https://www.axis-gps.com",
    addressLine: process.env.BRAND_ADDRESS_LINE ?? "AXIS GPS & Mapping Solutions",
    socialLinks: readSocialLinks(),
    // Optional public logo. Falls back to the AXIS text wordmark when unset or when the
    // URL is not publicly reachable (the renderer applies the same deliverability rule).
    logoUrl: process.env.AXIS_EMAIL_LOGO_URL ?? null,
    privacyUrl: process.env.BRAND_PRIVACY_URL ?? null,
    termsUrl: process.env.BRAND_TERMS_URL ?? null,
    baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };
}

/**
 * "View as webpage" target. Only rendered when a real, public page exists — a link to
 * a machine-local address would be dead in the recipient's inbox.
 */
export function getViewInBrowserUrl(): string | null {
  const configured = (process.env.BRAND_VIEW_IN_BROWSER_URL ?? "").trim();
  return configured === "" ? null : configured;
}
