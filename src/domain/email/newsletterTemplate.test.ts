import { describe, it, expect } from "vitest";

import { renderRichText } from "../content/richText";
import {
  absoluteUrl,
  deliverableImageUrl,
  directionFor,
  escapeWithLtrIsolation,
  isDeliverableImageUrl,
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
  addressLine: "AXIS GPS & Mapping Solutions",
  socialLinks: [
    { label: "LinkedIn", url: "https://linkedin.com/company/axis" },
    { label: "Facebook", url: "https://facebook.com/axis" },
  ],
  privacyUrl: "https://www.axis-gps.com/privacy",
  termsUrl: "https://www.axis-gps.com/terms",
  baseUrl: "https://mail.axis-gps.com",
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
    expect(html).not.toContain("<script");
    // Angle brackets survive only as entities; the word itself may sit inside an
    // LTR-isolation span, which is why this asserts the entity, not "&lt;script&gt;".
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
  });
});

describe("featured article", () => {
  it("treats the first item as featured with an <h1> headline", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("<h1");
    const h1 = html.slice(html.indexOf("<h1"), html.indexOf("</h1>"));
    expect(h1).toContain("First article");
  });

  it("renders secondary articles as <h2>, not <h1>", () => {
    const html = renderNewsletterHtml(doc());
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("<h2");
    const h2 = html.slice(html.indexOf("<h2"), html.indexOf("</h2>"));
    expect(h2).toContain("Second article");
  });

  it("shows a kicker above the featured headline", () => {
    const html = renderNewsletterHtml(
      doc({ items: [{ title: "Featured", kicker: "PRODUCT UPDATE" }] }),
    );
    expect(html).toContain("PRODUCT UPDATE");
    expect(html).toContain("text-transform:uppercase");
    expect(html.indexOf("PRODUCT UPDATE")).toBeLessThan(html.indexOf("Featured"));
  });

  it("falls back to the source name, then a language default, for the kicker", () => {
    expect(
      renderNewsletterHtml(doc({ items: [{ title: "T", sourceName: "Trimble" }] })),
    ).toContain("Trimble");
    // Hebrew newsletter with no kicker and no source falls back to the Hebrew label.
    expect(renderNewsletterHtml(doc({ items: [{ title: "T" }] }))).toContain("עדכון");
  });

  it("renders the featured hero image above the headline", () => {
    const html = renderNewsletterHtml(
      doc({
        items: [{ title: "Featured", imageUrl: "https://cdn.axis-gps.com/hero.jpg", imageAlt: "Hero" }],
      }),
    );
    expect(html.indexOf("hero.jpg")).toBeLessThan(html.indexOf("Featured"));
    expect(html).toContain('alt="Hero"');
  });

  it("renders a single article without a secondary section", () => {
    const html = renderNewsletterHtml(doc({ items: [{ title: "Only one" }] }));
    expect(html).toContain("Only one");
    expect(html).not.toContain("<h2");
  });
});

describe("call to action", () => {
  it("renders a table-based pill button for the featured article", () => {
    const html = renderNewsletterHtml(
      doc({ items: [{ title: "F", externalUrl: "https://axis-gps.com/a" }] }),
    );
    expect(html).toContain('href="https://axis-gps.com/a"');
    expect(html).toContain("border-radius:28px");
    // bgcolor makes Outlook paint the fill even though it ignores border-radius.
    expect(html).toContain('bgcolor="#0b5cab"');
    expect(html).toContain("לפרטים נוספים"); // Hebrew "learn more"
  });

  it("uses the Arabic call-to-action label for an Arabic newsletter", () => {
    const html = renderNewsletterHtml(
      doc({ language: "AR", items: [{ title: "F", externalUrl: "https://x.com/a" }] }),
    );
    expect(html).toContain("لمزيد من التفاصيل");
  });

  it("renders a text link for secondary articles", () => {
    const html = renderNewsletterHtml(
      doc({
        items: [{ title: "F" }, { title: "S", externalUrl: "https://axis-gps.com/s" }],
      }),
    );
    expect(html).toContain('href="https://axis-gps.com/s"');
    expect(html).toContain("קראו עוד");
  });

  it("points the secondary arrow along the reading direction", () => {
    expect(renderNewsletterHtml(doc({ items: [{ title: "F" }, { title: "S", externalUrl: "https://x.com/s" }] })))
      .toContain("&#8592;"); // RTL newsletter -> left arrow
    expect(
      renderNewsletterHtml(
        doc({ language: "UNKNOWN", items: [{ title: "F" }, { title: "S", externalUrl: "https://x.com/s" }] }),
      ),
    ).toContain("&#8594;");
  });

  it("omits the action when there is no link", () => {
    expect(renderNewsletterHtml(doc({ items: [{ title: "Internal only" }] }))).not.toContain(
      "לפרטים נוספים",
    );
  });

  it("refuses an unsafe link", () => {
    const html = renderNewsletterHtml(
      doc({ items: [{ title: "Bad", externalUrl: "javascript:alert(1)" }] }),
    );
    expect(html).not.toContain("javascript:alert");
  });
});

describe("images — non-deliverable pictures are omitted, never broken", () => {
  it("includes a publicly reachable image", () => {
    const html = renderNewsletterHtml(
      doc({ items: [{ title: "T", imageUrl: "https://cdn.axis-gps.com/photo.png" }] }),
    );
    expect(html).toContain("https://cdn.axis-gps.com/photo.png");
    expect(html).toContain("<img");
  });

  it("OMITS a localhost image entirely rather than emitting a broken box", () => {
    const html = renderNewsletterHtml(
      doc({
        brand: { ...brand, baseUrl: "http://localhost:3000" },
        items: [{ title: "T", imageUrl: "/api/media/local-1.png" }],
      }),
    );
    expect(html).not.toContain("localhost");
    expect(html).not.toContain("<img");
    expect(html).toContain("T"); // the article itself still renders
  });

  it.each([
    "http://localhost:3000/a.png",
    "http://127.0.0.1:3000/a.png",
    "http://0.0.0.0:3000/a.png",
    "https://localhost/a.png",
  ])("treats %s as non-deliverable", (url) => {
    expect(isDeliverableImageUrl(url)).toBe(false);
  });

  it.each(["https://cdn.axis-gps.com/a.png", "http://images.example.com/a.png"])(
    "treats %s as deliverable",
    (url) => {
      expect(isDeliverableImageUrl(url)).toBe(true);
    },
  );

  it("refuses non-http image sources", () => {
    expect(isDeliverableImageUrl("javascript:alert(1)")).toBe(false);
    expect(isDeliverableImageUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(deliverableImageUrl("data:image/png;base64,AAAA", "https://mail.axis-gps.com")).toBeNull();
  });

  it("makes app-relative paths absolute against a public base", () => {
    expect(deliverableImageUrl("/api/media/x.png", "https://mail.axis-gps.com")).toBe(
      "https://mail.axis-gps.com/api/media/x.png",
    );
    expect(absoluteUrl("/api/media/x.png", "http://localhost:3000")).toBe(
      "http://localhost:3000/api/media/x.png",
    );
  });

  it("falls back to the title when no alt text is given", () => {
    const html = renderNewsletterHtml(
      doc({ items: [{ title: "Fallback title", imageUrl: "https://cdn.axis-gps.com/a.png" }] }),
    );
    expect(html).toContain('alt="Fallback title"');
  });

  it("contains no localhost reference anywhere in a sent document", () => {
    const html = renderNewsletterHtml(
      doc({
        brand: { ...brand, baseUrl: "http://localhost:3000" },
        viewInBrowserUrl: "http://localhost:3000/view/abc",
        items: [
          { title: "A", imageUrl: "/api/media/a.png" },
          { title: "B", imageUrl: "http://127.0.0.1:3000/api/media/b.png" },
        ],
      }),
    );
    expect(html).not.toMatch(/localhost|127\.0\.0\.1/);
  });
});

describe("RTL and mixed-language handling", () => {
  it("sets real dir semantics for Hebrew, not just alignment", () => {
    const html = renderNewsletterHtml(doc({ language: "HE" }));
    expect(html).toContain('<html lang="he" dir="rtl"');
    expect(html).toContain('dir="rtl"');
  });

  it("sets real dir semantics for Arabic", () => {
    expect(renderNewsletterHtml(doc({ language: "AR" }))).toContain('<html lang="ar" dir="rtl"');
  });

  it("stays left-to-right when the language is not set", () => {
    const html = renderNewsletterHtml(doc({ language: "UNKNOWN" }));
    expect(html).toContain('<html lang="en" dir="ltr"');
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

  it("isolates Latin runs inside RTL copy so bidi cannot reorder them", () => {
    const html = renderNewsletterHtml(
      doc({ language: "HE", items: [{ title: "מוצר GPS-3000 חדש", summary: "דגם NavVis VLX" }] }),
    );
    expect(html).toContain('<span dir="ltr">GPS-3000</span>');
    // A contiguous Latin phrase is isolated as ONE run, not word by word.
    expect(html).toContain('<span dir="ltr">NavVis VLX</span>');
  });

  it("isolates the brand, email and website in the footer", () => {
    const html = renderNewsletterHtml(doc({ language: "HE" }));
    expect(html).toContain('<span dir="ltr">AXIS GPS &amp; Mapping Solutions</span>');
    expect(html).toContain('<span dir="ltr">info@axis-gps.com</span>');
    expect(html).toContain('<span dir="ltr">www.axis-gps.com</span>');
  });

  it("does not add isolation spans to an LTR newsletter", () => {
    const html = renderNewsletterHtml(
      doc({ language: "UNKNOWN", items: [{ title: "GPS-3000 launch" }] }),
    );
    // The headline itself is plain; only fixed brand fragments stay isolated.
    const h1 = html.slice(html.indexOf("<h1"), html.indexOf("</h1>"));
    expect(h1).not.toContain('dir="ltr"');
  });

  it("never splits an HTML entity while isolating", () => {
    // "&" escapes to "&amp;" — isolation must not wrap "amp" and corrupt it.
    const isolated = escapeWithLtrIsolation("AXIS & Partners", "rtl");
    expect(isolated).toContain("&amp;");
    expect(isolated).not.toContain("&<span");
    expect(isolated).not.toMatch(/&<\/?span[^>]*>amp;/);
  });

  it("escapes hostile input while isolating", () => {
    const isolated = escapeWithLtrIsolation('<img src=x onerror="alert(1)">', "rtl");
    expect(isolated).not.toContain("<img");
    expect(isolated).toContain("&lt;");
    expect(isolated).toContain("&quot;");
    // The invariant: strip the isolation spans this function generates and NO markup
    // remains — so no attribute or element can be forged through it.
    expect(isolated.replace(new RegExp("</?span[^>]*>", "g"), "")).not.toContain("<");
  });

  it("keeps a comma inside a Latin phrase, not at the RTL edge", () => {
    // "GPS, Mapping & Field Technology" must isolate as ONE run. Split into separate
    // runs, the comma is a neutral character and Outlook renders "…Technology ,GPS".
    expect(escapeWithLtrIsolation("GPS, Mapping & Field Technology", "rtl")).toBe(
      '<span dir="ltr">GPS, Mapping &amp; Field Technology</span>',
    );
  });

  it("does not swallow punctuation that belongs to the Hebrew text", () => {
    expect(escapeWithLtrIsolation("שלום, GPS", "rtl")).toBe('שלום, <span dir="ltr">GPS</span>');
    expect(escapeWithLtrIsolation("GPS, שלום", "rtl")).toBe('<span dir="ltr">GPS</span>, שלום');
  });

  it("keeps Hebrew text unwrapped", () => {
    expect(escapeWithLtrIsolation("שלום עולם", "rtl")).toBe("שלום עולם");
  });
});

describe("email client safety", () => {
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
    expect(html).not.toContain("position:absolute");
  });

  it("declares a mobile viewport and an Outlook-friendly doctype", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("width=device-width");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('http-equiv="X-UA-Compatible"');
  });

  it("declares a light colour scheme so dark mode degrades predictably", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain('name="supported-color-schemes"');
  });

  it("uses a web-safe font stack", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("Arial, Helvetica");
    expect(html).not.toMatch(/@font-face|fonts\.googleapis/);
  });

  it("uses a classic email container width", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain('width="640"');
    expect(html).toContain("max-width:640px");
  });

  it("carries the rendered article body through unchanged", () => {
    const bodyHtml = renderRichText("## Inner heading\n\nSome **body** text");
    const html = renderNewsletterHtml(doc({ items: [{ title: "T", bodyHtml }] }));
    expect(html).toContain("Inner heading");
    expect(html).toContain("<strong>body</strong>");
  });
});

describe("brand header and utility row", () => {
  it("shows an AXIS wordmark, never another company's brand", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain('<span dir="ltr">AXIS</span>');
    expect(html).not.toMatch(/Trimble/i);
  });

  it("omits the view-as-webpage row when no public page exists", () => {
    const html = renderNewsletterHtml(doc({ viewInBrowserUrl: null }));
    expect(html).not.toContain("צפייה בדפדפן");
  });

  it("renders the view-as-webpage link when a public page exists", () => {
    const html = renderNewsletterHtml(doc({ viewInBrowserUrl: "https://mail.axis-gps.com/v/abc" }));
    expect(html).toContain("צפייה בדפדפן");
    expect(html).toContain('href="https://mail.axis-gps.com/v/abc"');
  });

  it("never renders a localhost view-as-webpage link", () => {
    const html = renderNewsletterHtml(doc({ viewInBrowserUrl: "http://localhost:3000/v/abc" }));
    expect(html).not.toContain("localhost");
  });
});

describe("footer", () => {
  it("identifies AXIS and its contact details", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("AXIS GPS &amp; Mapping Solutions");
    expect(html).toContain("info@axis-gps.com");
    expect(html).toContain("www.axis-gps.com");
  });

  it("renders social links when configured", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("https://linkedin.com/company/axis");
    expect(html).toContain("https://facebook.com/axis");
  });

  it("omits the social row entirely when none are configured", () => {
    const html = renderNewsletterHtml(doc({ brand: { ...brand, socialLinks: [] } }));
    expect(html).not.toContain("linkedin.com");
  });

  it("drops an unsafe social link", () => {
    const html = renderNewsletterHtml(
      doc({ brand: { ...brand, socialLinks: [{ label: "X", url: "javascript:alert(1)" }] } }),
    );
    expect(html).not.toContain("javascript:alert");
  });

  it("shows copyright and legal links", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("כל הזכויות שמורות.");
    expect(html).toContain("https://www.axis-gps.com/privacy");
    expect(html).toContain("https://www.axis-gps.com/terms");
  });

  it("always includes the unsubscribe area, even before it works", () => {
    expect(renderNewsletterHtml(doc())).toContain("הסרה מרשימת התפוצה");
  });

  it("labels the unsubscribe link as a placeholder when no URL exists", () => {
    const html = renderNewsletterHtml(doc({ unsubscribeUrl: null }));
    expect(html).toContain("קישור ההסרה יופעל לפני השליחה בפועל");
    expect(html).not.toContain('<a href="null"');
  });

  it("renders a real unsubscribe link once one is supplied", () => {
    const html = renderNewsletterHtml(doc({ unsubscribeUrl: "https://axis-gps.com/u/token123" }));
    expect(html).toContain('href="https://axis-gps.com/u/token123"');
  });
});

describe("test banner and recipient safety", () => {
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
    expect(html).not.toContain("axisgpscana@gmail.com");
    expect(html).not.toMatch(/CampaignRecipient|normalizedEmail|mondayItemId/);
  });
});

describe("plain-text alternative", () => {
  it("lists every article in order", () => {
    const text = renderNewsletterText(doc());
    expect(text.indexOf("FIRST ARTICLE")).toBeLessThan(text.indexOf("Second article"));
  });

  it("includes the read-more URL", () => {
    const text = renderNewsletterText(
      doc({ items: [{ title: "F", externalUrl: "https://x.com/a" }] }),
    );
    expect(text).toContain("https://x.com/a");
  });

  it("includes brand contact details and unsubscribe", () => {
    const text = renderNewsletterText(doc());
    expect(text).toContain("info@axis-gps.com");
    expect(text).toContain("הסרה מרשימת התפוצה");
  });

  it("contains no HTML", () => {
    expect(renderNewsletterText(doc())).not.toContain("<");
  });
});

describe("brand logo in the email header", () => {
  const LOGO = "https://res.cloudinary.com/axis-demo/image/upload/v1700000000/axis-logo.png";

  it("renders a valid public HTTPS logo", () => {
    const html = renderNewsletterHtml(doc({ brand: { ...brand, logoUrl: LOGO } }));
    expect(html).toContain("<img");
    expect(html).toContain("axis-logo.png");
  });

  it("uses the prescribed alt text, escaped", () => {
    const html = renderNewsletterHtml(doc({ brand: { ...brand, logoUrl: LOGO } }));
    expect(html).toContain('alt="AXIS Advanced Mapping Solutions"');
  });

  it("sizes the logo for email and preserves aspect ratio", () => {
    const html = renderNewsletterHtml(doc({ brand: { ...brand, logoUrl: LOGO } }));
    // Explicit width attribute for Outlook, height:auto so it is never stretched.
    expect(html).toContain('width="200"');
    expect(html).toContain("width:200px");
    expect(html).toContain("height:auto");
    expect(html).toContain("max-width:100%"); // stays inside a narrow phone
    // Scoped to the logo itself: spacer rows legitimately use fixed pixel heights.
    const img = html.slice(html.indexOf("<img"), html.indexOf("/>", html.indexOf("<img")));
    expect(img).not.toContain("height:40px");
    expect(img).toContain("height:auto");
  });

  it("shrinks the delivered logo instead of shipping the full-size original", () => {
    const html = renderNewsletterHtml(doc({ brand: { ...brand, logoUrl: LOGO } }));
    expect(html).toContain("c_limit,w_440,q_auto");
    expect(html).not.toContain("w_1280,q_auto/v1700000000/axis-logo.png");
  });

  it("isolates the logo from RTL reordering", () => {
    const html = renderNewsletterHtml(doc({ language: "HE", brand: { ...brand, logoUrl: LOGO } }));
    const img = html.slice(html.indexOf("<img"), html.indexOf("/>", html.indexOf("<img")));
    expect(img).toContain('dir="ltr"');
  });

  it("falls back to the AXIS wordmark when no logo is configured", () => {
    const html = renderNewsletterHtml(doc({ brand: { ...brand, logoUrl: null } }));
    expect(html).toContain('<span dir="ltr">AXIS</span>');
    expect(html).not.toContain("alt=\"AXIS Advanced Mapping Solutions\"");
  });

  it.each([
    ["localhost", "https://localhost:3000/logo.png"],
    ["plain http", "http://res.cloudinary.com/axis-demo/image/upload/v1/logo.png"],
    ["private ip", "https://192.168.1.10/logo.png"],
    ["data uri", "data:image/png;base64,AAAA"],
  ])("rejects a %s logo and falls back to the wordmark", (_label, logoUrl) => {
    const html = renderNewsletterHtml(doc({ brand: { ...brand, logoUrl } }));
    expect(html).toContain('<span dir="ltr">AXIS</span>');
    expect(html).not.toContain("alt=\"AXIS Advanced Mapping Solutions\"");
    expect(html).not.toMatch(/localhost|192\.168|data:image/);
  });

  it("escapes a hostile alt-bearing logo URL", () => {
    const html = renderNewsletterHtml(
      doc({ brand: { ...brand, logoUrl: 'https://cdn.example.com/a.png" onerror="alert(1)' } }),
    );
    expect(html).not.toContain('onerror="alert(1)"');
  });

  it("changes the rendered HTML when the logo changes, so approval is invalidated", () => {
    const withoutLogo = renderNewsletterHtml(doc({ brand: { ...brand, logoUrl: null } }));
    const withLogo = renderNewsletterHtml(doc({ brand: { ...brand, logoUrl: LOGO } }));
    const otherLogo = renderNewsletterHtml(
      doc({ brand: { ...brand, logoUrl: LOGO.replace("axis-logo", "axis-logo-v2") } }),
    );
    expect(withLogo).not.toBe(withoutLogo);
    expect(otherLogo).not.toBe(withLogo);
  });

  it("is deterministic with a logo configured", () => {
    const once = renderNewsletterHtml(doc({ brand: { ...brand, logoUrl: LOGO } }));
    expect(renderNewsletterHtml(doc({ brand: { ...brand, logoUrl: LOGO } }))).toBe(once);
  });
});

/**
 * The unsubscribe design is deliberately unchanged by the no-reply work (ADR-0019):
 * one modest link in the footer, and nothing near the sender. These tests exist to
 * make a future "improvement" to unsubscribe prominence a visible, deliberate act.
 */
describe("unsubscribe stays footer-only", () => {
  it("renders the unsubscribe link in the footer", () => {
    const html = renderNewsletterHtml(
      doc({ unsubscribeUrl: "https://mail.axis-gps.com/u/abc123" }),
    );
    expect(html).toContain("https://mail.axis-gps.com/u/abc123");

    // It belongs to the last part of the document, not the header or the body.
    const position = html.indexOf("https://mail.axis-gps.com/u/abc123");
    expect(position).toBeGreaterThan(html.length * 0.6);
  });

  it("keeps the real contact address in the footer as the way to reach AXIS", () => {
    const html = renderNewsletterHtml(doc());
    expect(html).toContain("info@axis-gps.com");
    expect(html).toContain("mailto:info@axis-gps.com");
  });

  it("appears exactly once — no second unsubscribe control near the sender", () => {
    const url = "https://mail.axis-gps.com/u/abc123";
    const html = renderNewsletterHtml(doc({ unsubscribeUrl: url }));
    expect(html.split(url).length - 1).toBe(1);
  });

  it("emits no List-Unsubscribe markup or one-click unsubscribe hint", () => {
    const html = renderNewsletterHtml(
      doc({ unsubscribeUrl: "https://mail.axis-gps.com/u/abc123" }),
    );
    expect(html).not.toMatch(/list-unsubscribe/i);
    expect(html).not.toMatch(/one-click/i);
    expect(html).not.toMatch(/<meta[^>]*unsubscribe/i);
  });

  it("keeps the unsubscribe link in the plain-text part too", () => {
    const text = renderNewsletterText(
      doc({ unsubscribeUrl: "https://mail.axis-gps.com/u/abc123" }),
    );
    expect(text).toContain("https://mail.axis-gps.com/u/abc123");
    expect(text).toContain("info@axis-gps.com");
  });
});
