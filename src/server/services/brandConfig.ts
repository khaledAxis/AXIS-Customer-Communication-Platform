import type { NewsletterBrand } from "../../domain/email/newsletterTemplate";

/**
 * Branding + contact details used by the newsletter template.
 *
 * Configuration, not secrets — safe to default in code and override per environment.
 */
export function getNewsletterBrand(): NewsletterBrand {
  return {
    companyName: process.env.BRAND_COMPANY_NAME ?? "AXIS GPS & Mapping Solutions",
    tagline: process.env.BRAND_TAGLINE ?? "GPS, Mapping & Field Technology",
    contactEmail: process.env.BRAND_CONTACT_EMAIL ?? "info@axis-gps.com",
    contactPhone: process.env.BRAND_CONTACT_PHONE ?? null,
    websiteUrl: process.env.BRAND_WEBSITE_URL ?? "https://www.axis-gps.com",
    baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };
}
