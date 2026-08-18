import { describe, it, expect } from "vitest";

import { renderRichText } from "../content/richText";
import {
  absoluteUrl,
  directionFor,
  renderNewsletterHtml,
  renderNewsletterText,
  type NewsletterDocument,
} from "./newsletterTemplate";

const brand = {
  companyName: "AXIS GPS & Mapping Solutions",
  tagline: "GPS, Mapping & Field Technology",
  contactEmail: "info@axis-gps.com",
  contactPhone: "+972-000-0000",
  websiteUrl: "https://www.axis-gps.com",
  baseUrl: "http://localhost:3000",
};

function doc(overrides: Partial<NewsletterDocument> = {}): NewsletterDocument {
  return {
    subject: "September update",
    preheader: "What is new at AXIS",
    language: "HE",
    items: [
      { title: "First article", summary: "First summary" },
      { title: "Second article", summary: "Second summary" },
    ],
    brand,
    unsubscribeUrl: null,
    isTestMode: true,
    ...overrides,
  };
}

describe("newsletter rendering — content and ordering", () => {
  it("includes every selected article", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("First article");
    expect(html).toContain("Second article");
  });

  it("renders articles in the order given by the campaign", () => {
    const html = renderNewsletterHtml(doc());
    expect(html.indexOf("First article")).toBeLessThan(html.indexOf("Second article"));
  });

  it("reflects a reordered composition", () => {
    const reordered = renderNewsletterHtml(
      doc({
        items: [
          { title: "Second article", summary: "b" },
          { title: "First article", summary: "a" },
        ],
      }),
    );
    expect(reordered.indexOf("Second article")).toBeLessThan(reordered.indexOf("First article"));
  });

  it("renders the subject as the newsletter heading", () => {
    expect(renderNewsletterHtml(doc({ subject: "Autumn news" }))).toContain("Autumn news");
  });

  it("hides the preheader from the visible layout but keeps it in the source", () => {
    const html = renderNewsletterHtml(doc({ preheader: "Secret preview line" }));
    expect(html).toContain("Secret preview line");
    expect(html).toContain("display:none");
  });

  it("renders an empty newsletter without throwing", () => {
    expect(() => renderNewsletterHtml(doc({ items: [] }))).not.toThrow();
  });

  it("is deterministic", () => {
    expect(renderNewsletterHtml(doc())).toBe(renderNewsletterHtml(doc()));
  });

  it("escapes hostile article titles", () => {
    const html = renderNewsletterHtml(doc({ items: [{ title: "<script>bad()</script>" }] }));
    expect(html).not.toContain("<script>bad()");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("newsletter rendering — images", () => {
  it("renders an image when one is set", () => {
    const html = renderNewsletterHtml(
      doc({ items: [{ title: "With picture", imageUrl: "/api/media/photo-abc123.jpg", imageAlt: "A photo" }] }),
    );
    expect(html).toContain("<img");
    expect(html).toContain("http://localhost:3000/api/media/photo-abc123.jpg");
    expect(html).toContain('alt="A photo"');
  });

  it("makes app-relative image paths absolute for email clients", () => {
    expect(absoluteUrl("/api/media/x.png", "http://localhost:3000")).toBe(
      "http://localhost:3000/api/media/x.png",
    );
    expect(absoluteUrl("https://cdn.example.com/x.png", "http://localhost:3000")).toBe(
      "https://cdn.example.com/x.png",
    );
  });

  it("refuses non-http image sources", () => {
    expect(absoluteUrl("javascript:alert(1)", "http://localhost:3000")).toBeNull();
    expect(absoluteUrl("data:image/png;base64,AAAA", "http://localhost:3000")).toBeNull();
  });

  it("falls back to the title when no alt text is given", () => {
    const html = renderNewsletterHtml(
      doc({ items: [{ title: "Fallback title", imageUrl: "/api/media/a-1.png" }] }),
    );
    expect(html).toContain('alt="Fallback title"');
  });

  it("omits the image element entirely when no image is set", () => {
    expect(renderNewsletterHtml(doc({ items: [{ title: "No picture" }] }))).not.toContain("<img");
  });
});

describe("newsletter rendering — read more link", () => {
  it("renders a Read more action for an external article", () => {
    const html = renderNewsletterHtml(
      doc({ items: [{ title: "External", externalUrl: "https://trimble.com/news" }] }),
    );
    expect(html).toContain('href="https://trimble.com/news"');
    expect(html).toContain("קראו עוד"); // Hebrew newsletter
  });

  it("uses the Arabic label for an Arabic newsletter", () => {
    const html = renderNewsletterHtml(
      doc({ language: "AR", items: [{ title: "E", externalUrl: "https://x.com/a" }] }),
    );
    expect(html).toContain("اقرأ المزيد");
  });

  it("omits the action when there is no link", () => {
    expect(renderNewsletterHtml(doc({ items: [{ title: "Internal only" }] }))).not.toContain(
      "קראו עוד",
    );
  });

  it("refuses an unsafe external link", () => {
    const html = renderNewsletterHtml(
      doc({ items: [{ title: "Bad", externalUrl: "javascript:alert(1)" }] }),
    );
    expect(html).not.toContain("javascript:alert");
  });
});

describe("newsletter rendering — RTL", () => {
  it("sets real dir semantics for Hebrew, not just alignment", () => {
    const html = renderNewsletterHtml(doc({ language: "HE" }));
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('dir="rtl"');
  });

  it("sets real dir semantics for Arabic", () => {
    const html = renderNewsletterHtml(doc({ language: "AR" }));
    expect(html).toContain('<html lang="ar" dir="rtl">');
  });

  it("stays left-to-right when the language is not set", () => {
    const html = renderNewsletterHtml(doc({ language: "UNKNOWN" }));
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).not.toContain('dir="rtl"');
  });

  it("maps languages to directions", () => {
    expect(directionFor("HE")).toBe("rtl");
    expect(directionFor("AR")).toBe("rtl");
    expect(directionFor("UNKNOWN")).toBe("ltr");
  });

  it("aligns text to the start of the reading direction", () => {
    expect(renderNewsletterHtml(doc({ language: "HE" }))).toContain("text-align:right");
    expect(renderNewsletterHtml(doc({ language: "UNKNOWN" }))).toContain("text-align:left");
  });

  it("keeps embedded LTR content readable inside RTL text", () => {
    const html = renderNewsletterHtml(
      doc({ language: "AR", items: [{ title: "منتج", summary: "GPS-3000 model" }] }),
    );
    expect(html).toContain("GPS-3000 model");
    expect(html).toContain('dir="rtl"');
  });
});

describe("newsletter rendering — email client safety", () => {
  it("uses a table-based layout", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("<table");
    expect(html).toContain('role="presentation"');
  });

  it("does not rely on Tailwind classes or flex/grid layout", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).not.toMatch(/class="(?!axis-)/);
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("display:grid");
  });

  it("declares a mobile viewport", () => {
    expect(renderNewsletterHtml(doc())).toContain("width=device-width");
  });

  it("carries the rendered article body through unchanged", () => {
    const bodyHtml = renderRichText("## Inner heading\n\nSome **body** text");
    const html = renderNewsletterHtml(doc({ items: [{ title: "T", bodyHtml }] }));
    expect(html).toContain("Inner heading");
    expect(html).toContain("<strong>body</strong>");
  });
});

describe("newsletter rendering — footer, unsubscribe and test banner", () => {
  it("always includes the unsubscribe area, even before it works", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("הסרה מרשימת התפוצה");
  });

  it("labels the unsubscribe link as a placeholder when no URL exists", () => {
    const html = renderNewsletterHtml(doc({ unsubscribeUrl: null }));
    expect(html).toContain("קישור ההסרה יופעל לפני השליחה בפועל");
    expect(html).not.toContain("<a href=\"null\"");
  });

  it("renders a real unsubscribe link once one is supplied", () => {
    const html = renderNewsletterHtml(doc({ unsubscribeUrl: "https://axis-gps.com/u/token123" }));
    expect(html).toContain('href="https://axis-gps.com/u/token123"');
  });

  it("identifies AXIS and contact details in the footer", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("AXIS GPS &amp; Mapping Solutions");
    expect(html).toContain("info@axis-gps.com");
  });

  it("shows the TEST banner in test mode", () => {
    expect(renderNewsletterHtml(doc({ isTestMode: true }))).toContain(
      "מצב בדיקה — הודעה זו אינה נשלחת ללקוחות",
    );
  });

  it("omits the TEST banner only when test mode is explicitly off", () => {
    expect(renderNewsletterHtml(doc({ isTestMode: false }))).not.toContain("מצב בדיקה");
  });

  it("contains no recipient or customer data", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).not.toContain("khaled-s@axis-gps.com");
    expect(html).not.toMatch(/CampaignRecipient|normalizedEmail|mondayItemId/);
  });
});

describe("newsletter plain-text alternative", () => {
  it("lists every article in order", () => {
    const text = renderNewsletterText(doc());
    expect(text.indexOf("First article")).toBeLessThan(text.indexOf("Second article"));
  });

  it("includes the read-more URL", () => {
    const text = renderNewsletterText(
      doc({ items: [{ title: "E", externalUrl: "https://x.com/a" }] }),
    );
    expect(text).toContain("https://x.com/a");
  });

  it("contains no HTML", () => {
    expect(renderNewsletterText(doc())).not.toContain("<");
  });
});
