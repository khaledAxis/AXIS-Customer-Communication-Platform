import { describe, expect, it } from "vitest";

import {
  renderNewsletterHtml,
  type NewsletterDocument,
} from "../email/newsletterTemplate";
import {
  PUBLIC_NEWSLETTER_PATH,
  isWellFormedPublicToken,
  publicNewsletterUrl,
} from "./publicPage";

/**
 * "View as webpage" (ADR-0032).
 *
 * The link is only worth having if it works. These tests hold it to that: shown when
 * a real public page exists, hidden — not greyed out, not broken — when one does not.
 */

const brand = {
  companyName: "AXIS Advanced Mapping Solutions",
  contactEmail: "info@axis-gps.com",
  baseUrl: "https://axis-gps.com",
};

const doc = (over: Partial<NewsletterDocument> = {}): NewsletterDocument => ({
  subject: "Subject",
  language: "HE",
  items: [{ title: "Featured" }],
  brand,
  isTestMode: false,
  ...over,
});

describe("building the public URL", () => {
  it("builds a per-newsletter URL from the origin and token", () => {
    const url = publicNewsletterUrl("https://mail.axis-gps.com", "abc123def456ghi789");
    expect(url).toBe("https://mail.axis-gps.com/n/abc123def456ghi789");
    expect(PUBLIC_NEWSLETTER_PATH).toBe("/n");
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(publicNewsletterUrl("https://mail.axis-gps.com/", "abc123def456ghi789")).toBe(
      "https://mail.axis-gps.com/n/abc123def456ghi789",
    );
  });

  it("returns null when there is no token — never a guess", () => {
    for (const token of [null, undefined, "", "   "]) {
      expect(publicNewsletterUrl("https://mail.axis-gps.com", token)).toBeNull();
    }
  });

  it("returns null for an origin a recipient could not reach", () => {
    // A newsletter is opened days later, on somebody else's network.
    for (const origin of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
      null,
      "",
    ]) {
      expect(publicNewsletterUrl(origin, "abc123def456ghi789")).toBeNull();
    }
  });

  it("accepts only well-formed tokens", () => {
    expect(isWellFormedPublicToken("abcdefghijklmnop")).toBe(true);
    for (const bad of [
      "short",
      "has spaces in it here",
      "has/slash/in/it/xxxxxx",
      "..%2f..%2fetc%2fpasswd",
      "a".repeat(200),
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isWellFormedPublicToken(bad), String(bad)).toBe(false);
    }
  });
});

describe("the link in the rendered email", () => {
  it("is SHOWN when a public URL exists", () => {
    const html = renderNewsletterHtml(
      doc({ viewInBrowserUrl: "https://mail.axis-gps.com/n/abc123def456ghi789" }),
    );
    expect(html).toContain("https://mail.axis-gps.com/n/abc123def456ghi789");
    expect(html).toContain("צפייה בדפדפן"); // Hebrew "view in browser"
  });

  it("is HIDDEN when there is no public URL", () => {
    const html = renderNewsletterHtml(doc({ viewInBrowserUrl: null }));
    expect(html).not.toContain("צפייה בדפדפן");
  });

  it("is HIDDEN when the URL only resolves on the sending machine", () => {
    const html = renderNewsletterHtml(
      doc({ viewInBrowserUrl: "http://localhost:3000/n/abc123def456ghi789" }),
    );
    // A dead link in an inbox is worse than no link at all.
    expect(html).not.toContain("localhost");
    expect(html).not.toContain("צפייה בדפדפן");
  });

  it("appears near the top, above the masthead", () => {
    const html = renderNewsletterHtml(
      doc({ viewInBrowserUrl: "https://mail.axis-gps.com/n/abc123def456ghi789" }),
    );
    const linkAt = html.indexOf("mail.axis-gps.com/n/");
    const logoAt = html.indexOf("AXIS");
    expect(linkAt).toBeGreaterThan(-1);
    expect(linkAt).toBeLessThan(logoAt);
  });

  it("stays quiet — muted, small, and not a button", () => {
    const html = renderNewsletterHtml(
      doc({ viewInBrowserUrl: "https://mail.axis-gps.com/n/abc123def456ghi789" }),
    );
    const row = html.slice(html.indexOf("mail.axis-gps.com/n/") - 400, html.indexOf("mail.axis-gps.com/n/") + 200);
    // Utility type, not brand blue, and no button fill.
    expect(row).toContain("font-size:12px");
    expect(row).not.toContain("bgcolor");
  });
});

describe("the premium layout", () => {
  it("gives the hero a much larger headline than a secondary heading", () => {
    const html = renderNewsletterHtml(
      doc({ items: [{ title: "Featured" }, { title: "Second" }] }),
    );
    // Hierarchy is the point: a flat scale reads as a list.
    expect(html).toContain("font-size:38px");
    expect(html).toContain("font-size:21px");
  });

  it("uses a wider gutter for a calmer measure", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("48px");
  });

  it("keeps the 640px centred shell", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("width:640px");
    expect(html).toContain("max-width:640px");
  });

  it("scales the headline down on a phone", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("max-width:660px");
    expect(html).toContain("font-size:28px !important");
  });

  it("still renders without images, and without a broken image box", () => {
    const html = renderNewsletterHtml(
      doc({ items: [{ title: "No picture", summary: "Text only." }] }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("No picture");
  });
});

describe("the footer is unchanged in prominence", () => {
  it("still carries exactly one unsubscribe affordance and no List-Unsubscribe", () => {
    const html = renderNewsletterHtml(doc());
    expect(html.toLowerCase()).not.toContain("list-unsubscribe");
    const clickable = html.split(">הסרה מרשימת התפוצה<").length - 1;
    expect(clickable).toBe(1);
  });
});
