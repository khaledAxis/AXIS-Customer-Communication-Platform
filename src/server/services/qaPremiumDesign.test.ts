import { describe, expect, it } from "vitest";

import { renderNewsletterHtml } from "../../domain/email/newsletterTemplate";
import {
  QA_SUBJECT_PREFIX,
  hasQaSubjectPrefix,
  qaNoticeFor,
} from "../../domain/send/qaPolicy";
import { renderQaScenario } from "./qaEmailService";
import { QA_SCENARIOS, type QaScenario } from "./qaScenarios";

/**
 * The redesigned newsletter, as it will actually be sent (ADR-0032).
 *
 * These assertions run against `renderQaScenario` — the exact function the live QA
 * send calls — rather than against a document assembled inside the test. A test that
 * builds its own input proves the renderer works on that input; this proves the eight
 * messages a colleague is about to receive are the ones the design intends.
 *
 * Nothing here sends anything: rendering is pure, and the QA transport registry hands
 * out a refusing adapter under the test runner regardless.
 */

const PREMIUM_IDS = [
  "QA-PREMIUM-HE",
  "QA-PREMIUM-MULTI",
  "QA-PREMIUM-AR",
  "QA-PREMIUM-AR-MULTI",
  "QA-PREMIUM-GENERAL",
  "QA-PREMIUM-IMAGES",
  "QA-PREMIUM-HE-MIXED",
  "QA-PREMIUM-CTA",
] as const;

function scenario(id: string): QaScenario {
  const found = QA_SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`Scenario ${id} is missing from the catalogue.`);
  return found;
}

function html(id: string): string {
  return renderQaScenario(scenario(id)).html;
}

/** Every `font-size:Npx` in the document, in order of appearance. */
function fontSizes(source: string): number[] {
  return [...source.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
}

// ---------------------------------------------------------------------------
// The catalogue itself
// ---------------------------------------------------------------------------

describe("the premium design review set", () => {
  it("contains all eight scenarios", () => {
    for (const id of PREMIUM_IDS) expect(scenario(id).id).toBe(id);
  });

  it("gives each one a distinct subject and a distinct purpose", () => {
    // "Do not send duplicate emails merely to increase the test count" — a send names
    // a scenario, so two scenarios that test the same thing would be that duplicate.
    const subjects = PREMIUM_IDS.map((id) => scenario(id).subject);
    const purposes = PREMIUM_IDS.map((id) => scenario(id).purpose);
    expect(new Set(subjects).size).toBe(PREMIUM_IDS.length);
    expect(new Set(purposes).size).toBe(PREMIUM_IDS.length);
  });

  it("names the exact subjects the design review asked for", () => {
    expect(PREMIUM_IDS.map((id) => scenario(id).subject)).toEqual([
      "Premium Newsletter Design — Hebrew",
      "Premium Newsletter Design — Multi-Article",
      "Premium Newsletter Design — Arabic",
      "Premium Newsletter Design — Arabic Multi-Article",
      "Premium Newsletter Design — General Layout",
      "Premium Newsletter Design — Images and Spacing",
      "Premium Newsletter Design — Hebrew Mixed Content",
      "Premium Newsletter Design — CTA and Mobile Layout",
    ]);
  });

  it("tells the reviewer what to look at", () => {
    for (const id of PREMIUM_IDS) {
      expect(scenario(id).inspect.length).toBeGreaterThanOrEqual(5);
    }
  });

  // 23 — the mandatory prefix, on the rendered subject, once.
  it("puts the mandatory TEST prefix on every rendered subject, exactly once", () => {
    for (const id of PREMIUM_IDS) {
      const { subject } = renderQaScenario(scenario(id));
      expect(hasQaSubjectPrefix(subject)).toBe(true);
      expect(subject.split(QA_SUBJECT_PREFIX).length - 1).toBe(1);
    }
  });

  it("carries the platform-test notice in the reader's language", () => {
    expect(html("QA-PREMIUM-HE")).toContain(qaNoticeFor("HE"));
    expect(html("QA-PREMIUM-AR")).toContain(qaNoticeFor("AR"));
    expect(html("QA-PREMIUM-GENERAL")).toContain(qaNoticeFor("UNKNOWN"));
  });
});

// ---------------------------------------------------------------------------
// 1–6. The redesigned proportions
// ---------------------------------------------------------------------------

describe("the redesigned proportions", () => {
  // 1 — hero font scale.
  it("sets the hero headline at the redesigned size", () => {
    for (const id of PREMIUM_IDS) {
      expect(html(id), id).toContain("font-size:38px");
    }
  });

  // 4 — hero beats secondary, by a lot.
  it("makes the hero headline far larger than a secondary heading", () => {
    for (const id of ["QA-PREMIUM-MULTI", "QA-PREMIUM-AR-MULTI", "QA-PREMIUM-CTA"]) {
      const source = html(id);
      expect(source, id).toContain("font-size:21px");
      // Nearly 2:1. A flat scale reads as a list rather than as a newsletter.
      expect(38 / 21, id).toBeGreaterThan(1.7);
    }
  });

  // 2 — desktop gutter.
  it("uses the 48px desktop gutter on every padded row", () => {
    for (const id of PREMIUM_IDS) {
      const source = html(id);
      expect(source, id).toContain("padding:0 48px");
      // The old 40px rhythm must be gone, not merely joined.
      expect(source, id).not.toContain("padding:0 40px");
    }
  });

  // 3 — mobile gutter and headline.
  it("narrows to a single 24px gutter and a 28px headline on a phone", () => {
    const source = html("QA-PREMIUM-CTA");
    expect(source).toContain("max-width:660px");
    expect(source).toContain("padding-left:24px !important");
    expect(source).toContain("padding-right:24px !important");
    expect(source).toContain("font-size:28px !important");
  });

  // 5 — the refined CTA.
  it("renders the call to action in the refined button style", () => {
    const source = html("QA-PREMIUM-CTA");
    // A restrained corner, not the old 28px pill.
    expect(source).toContain("border-radius:4px");
    expect(source).not.toContain("border-radius:28px");
    // A solid fill Outlook will paint, and a target a thumb can hit.
    expect(source).toContain('bgcolor="#0b5cab"');
    expect(source).toContain("padding:16px 40px");
  });

  it("gives the hero the only button, and secondary articles a quiet text link", () => {
    const source = html("QA-PREMIUM-CTA");
    // Exactly one filled button per message, on the featured article. The secondary
    // items get a small blue "read more" link instead — two competing buttons would
    // flatten the hierarchy the rest of the layout builds.
    const fills = source.split('bgcolor="#0b5cab"').length - 1;
    expect(fills).toBe(1);
    expect(source.split("padding:16px 40px").length - 1).toBe(fills);
    expect(source).toContain("Read more");
  });

  // 6 — the refined footer.
  it("sets the footer on the soft band, quietly", () => {
    const source = html("QA-PREMIUM-GENERAL");
    expect(source).toContain("#f7f9fb");
    // Footer type stays small; it is not competing with the content.
    expect(source).toContain("font-size:12px");
  });

  it("separates sections with an inset hairline rather than a heavy rule", () => {
    const source = html("QA-PREMIUM-MULTI");
    expect(source).toContain("background:#eff2f6");
    // The rule sits inside the gutter, so it never cuts the sheet edge to edge.
    expect(source).toContain('class="axis-pad" style="padding:0 48px;"');
  });

  it("keeps the 640px centred shell", () => {
    for (const id of PREMIUM_IDS) {
      expect(html(id), id).toContain("width:640px");
      expect(html(id), id).toContain("max-width:640px");
    }
  });
});

// ---------------------------------------------------------------------------
// 7–9. Direction and bidi
// ---------------------------------------------------------------------------

describe("direction", () => {
  // 7 — Hebrew.
  it("renders Hebrew right-to-left, with real dir semantics", () => {
    const source = html("QA-PREMIUM-HE");
    expect(source).toContain('<html lang="he" dir="rtl"');
    expect(source).toContain('dir="rtl"');
    expect(source).toContain('align="right"');
    // The direction is an attribute, not a CSS property Outlook ignores.
    expect(source).not.toContain("unicode-bidi");
  });

  // 8 — Arabic.
  it("renders Arabic right-to-left, with real dir semantics", () => {
    const source = html("QA-PREMIUM-AR");
    expect(source).toContain('<html lang="ar" dir="rtl"');
    expect(source).toContain("حلول المسح والقياس الدقيق للفرق الميدانية");
    expect(source).not.toContain("unicode-bidi");
  });

  it("renders a left-to-right newsletter as left-to-right", () => {
    const source = html("QA-PREMIUM-GENERAL");
    expect(source).toContain('dir="ltr"');
    expect(source).not.toContain('<html lang="he" dir="rtl"');
  });

  // 9 — mixed bidi, as WHOLE phrases.
  it("isolates Latin product names inside Hebrew as whole phrases", () => {
    const source = html("QA-PREMIUM-HE-MIXED");
    for (const phrase of ["Trimble X9", "NavVis VLX", "Trimble R12i", "GNSS", "RTK"]) {
      // Isolated in one piece: per-word isolation leaves the separator neutral and
      // lets the space or comma drift to the wrong edge.
      expect(source, phrase).toContain(`<span dir="ltr">${phrase}`);
    }
  });

  it("isolates Latin product names inside Arabic too", () => {
    const source = html("QA-PREMIUM-AR-MULTI");
    expect(source).toContain('<span dir="ltr">Trimble X9');
    expect(source).toContain('<span dir="ltr">NavVis VLX');
  });

  it("keeps an email address and a URL in one piece inside Hebrew", () => {
    const source = html("QA-PREMIUM-HE-MIXED");
    expect(source).toContain('<span dir="ltr">info@axis-gps.com');
    expect(source).toContain("https://www.axis-gps.com/products");
  });
});

// ---------------------------------------------------------------------------
// 10–11. Article counts
// ---------------------------------------------------------------------------

describe("article counts", () => {
  // 10 — one hero, nothing else.
  it("renders a single-article newsletter with a hero and no secondary block", () => {
    const single = renderNewsletterHtml({
      subject: "One",
      language: "UNKNOWN",
      items: [{ title: "The only article", summary: "Alone." }],
      brand: {
        companyName: "AXIS Advanced Mapping Solutions",
        contactEmail: "info@axis-gps.com",
        baseUrl: "https://axis-gps.com",
      },
      isTestMode: false,
    });
    expect(single).toContain("font-size:38px");
    expect(single).not.toContain("font-size:21px");
  });

  // 11 — four articles: one hero, three consistent siblings.
  it("renders four articles as one hero and three consistent siblings", () => {
    for (const id of ["QA-PREMIUM-MULTI", "QA-PREMIUM-AR-MULTI", "QA-PREMIUM-IMAGES"]) {
      const source = html(id);
      expect(scenario(id).items, id).toHaveLength(4);
      // One hero headline, three secondary headings — identical treatment each.
      expect(source.split("font-size:38px").length - 1, id).toBe(1);
      expect(source.split("font-size:21px").length - 1, id).toBe(3);
    }
  });

  it("keeps every article, in the order the scenario declares", () => {
    const source = html("QA-PREMIUM-MULTI");
    const positions = scenario("QA-PREMIUM-MULTI").items.map((item) =>
      source.indexOf(item.title.split(" ")[0]),
    );
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

// ---------------------------------------------------------------------------
// 12–14. Images
// ---------------------------------------------------------------------------

describe("images", () => {
  // 12 — the hero image.
  it("renders a full-width hero image at the delivery transformation", () => {
    const source = html("QA-PREMIUM-HE");
    expect(source).toContain("res.cloudinary.com");
    // Bounded for delivery, and never f_auto — Outlook cannot read AVIF.
    expect(source).toContain("c_limit,w_1280,q_auto");
    expect(source).not.toContain("f_auto");
    expect(source).toContain("width:100%;max-width:640px;height:auto");
  });

  // 13 — several images in one message.
  it("renders several images at one consistent width", () => {
    const source = html("QA-PREMIUM-IMAGES");
    const images = [...source.matchAll(/<img [^>]*src="https:\/\/res\.cloudinary[^"]+"/g)];
    // Hero, two secondary placements, plus the brand logo.
    expect(images.length).toBeGreaterThanOrEqual(4);
    // Every image scales with the sheet rather than overflowing it. The hero is
    // full-bleed at 640px and secondary images are inset to the 544px text column —
    // two intended widths, both capped by the sheet.
    for (const match of images) {
      const tag = source.slice(match.index, source.indexOf(">", match.index));
      expect(tag).toContain("height:auto");
      // The logo is capped as a percentage; content images by pixel width.
      const cap = /max-width:(\d+)px/.exec(tag);
      if (cap) expect(Number(cap[1]), tag).toBeLessThanOrEqual(640);
      else expect(tag, tag).toContain("max-width:100%");
    }
    // Secondary images share ONE width, so the column edge stays straight.
    const secondaryCaps = new Set(
      [...source.matchAll(/max-width:(\d+)px;height:auto/g)]
        .map((m) => Number(m[1]))
        .filter((w) => w !== 640 && w !== 200),
    );
    expect(secondaryCaps.size).toBe(1);
  });

  // 14 — omission, never a broken box.
  it("omits an image a recipient could not load", () => {
    const source = html("QA-IMAGE-OMISSION");
    expect(source).not.toContain("/api/media/");
    expect(source).not.toContain("localhost");
    // The article itself survives — only its picture is dropped.
    expect(source).toContain("This article&#39;s image should be absent");
  });

  it("still holds together with no image at all", () => {
    const textOnly = renderNewsletterHtml({
      subject: "No pictures",
      language: "UNKNOWN",
      items: [{ title: "Text only", summary: "Nothing to load here." }],
      brand: {
        companyName: "AXIS Advanced Mapping Solutions",
        contactEmail: "info@axis-gps.com",
        baseUrl: "https://axis-gps.com",
      },
      isTestMode: false,
    });
    expect(textOnly).not.toContain("<img");
    expect(textOnly).toContain("Text only");
  });

  it("gives every content image alt text, so a blocked image still says something", () => {
    for (const id of ["QA-PREMIUM-HE", "QA-PREMIUM-IMAGES", "QA-PREMIUM-AR"]) {
      const source = html(id);
      for (const match of source.matchAll(/<img (?![^>]*alt=")[^>]*>/g)) {
        throw new Error(`${id} has an image with no alt text: ${match[0]}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 15. Horizontal overflow
// ---------------------------------------------------------------------------

describe("horizontal behaviour", () => {
  it("declares no fixed width wider than the sheet", () => {
    for (const id of PREMIUM_IDS) {
      const source = html(id);
      // `max-width` is excluded deliberately: the mobile breakpoint is 660px, and
      // capping a breakpoint at the sheet width would be meaningless.
      for (const match of source.matchAll(/(?<!max-)width:(\d+)px/g)) {
        expect(Number(match[1]), `${id} → ${match[0]}`).toBeLessThanOrEqual(640);
      }
    }
  });

  it("lets the shell and every inner table shrink", () => {
    for (const id of PREMIUM_IDS) {
      const source = html(id);
      expect(source, id).toContain(".axis-shell { width:100% !important; }");
      expect(source, id).toContain('style="width:100%;border-collapse:collapse;"');
    }
  });

  it("never sets a white-space rule that would stop a long headline wrapping", () => {
    const source = html("QA-PREMIUM-CTA");
    expect(source).not.toContain("white-space:nowrap");
    // The long headline is present and unclipped.
    expect(source).toContain("large infrastructure sites");
  });

  it("keeps every declared font size within the intended scale", () => {
    for (const id of PREMIUM_IDS) {
      for (const size of fontSizes(html(id))) {
        expect(size, `${id} → ${size}px`).toBeLessThanOrEqual(38);
        expect(size, `${id} → ${size}px`).toBeGreaterThanOrEqual(11);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 16–18. "View as webpage" on the QA path
// ---------------------------------------------------------------------------

describe('"View as webpage" on a QA message', () => {
  // 16/17 — a QA email carries no public page, so it carries no link.
  it("is absent from every QA message", () => {
    for (const id of PREMIUM_IDS) {
      const source = html(id);
      expect(source, id).not.toContain("/n/");
      expect(source, id).not.toContain("צפייה בדפדפן");
      expect(source, id).not.toContain("View as webpage");
      // And most importantly: no address only the sending machine can resolve.
      expect(source, id).not.toContain("localhost");
    }
  });

  // 18 — the same renderer DOES show it, given a real public origin.
  it("appears when the document carries a reachable public URL", () => {
    const withPage = renderNewsletterHtml({
      subject: "With a web version",
      language: "HE",
      items: [{ title: "Featured" }],
      brand: {
        companyName: "AXIS Advanced Mapping Solutions",
        contactEmail: "info@axis-gps.com",
        baseUrl: "https://axis-gps.com",
      },
      viewInBrowserUrl: "https://mail.axis-gps.com/n/abc123def456ghi789",
      isTestMode: false,
    });
    expect(withPage).toContain("https://mail.axis-gps.com/n/abc123def456ghi789");
    expect(withPage).toContain("צפייה בדפדפן");
  });
});

// ---------------------------------------------------------------------------
// The web-version scenario
// ---------------------------------------------------------------------------

describe("the hosted web version, end to end", () => {
  const WEB = "QA-WEB-VERSION";

  it("names the campaign whose web version it demonstrates, not a database id", () => {
    // A cuid in source code is meaningless on another machine.
    expect(scenario(WEB).webVersionCampaignName).toBe("QA — Web version test (ADR-0032)");
    expect(scenario(WEB).webVersionCampaignName).not.toMatch(/^c[a-z0-9]{20,}$/);
  });

  it("carries the exact subject the test asked for", () => {
    expect(renderQaScenario(scenario(WEB)).subject).toBe(
      "[AXIS Newsletter Platform TEST] View as Webpage — End-to-End Test",
    );
  });

  it("shows NO link when no URL is resolved — the default", () => {
    // Which is exactly what happened on the previous eight sends.
    const source = renderQaScenario(scenario(WEB)).html;
    expect(source).not.toContain("View as webpage");
    expect(source).not.toContain("/n/");
  });

  it("shows EXACTLY ONE link when given a reachable HTTPS URL", () => {
    const url = "https://example-tunnel.lhr.life/n/abc123def456ghi789";
    const source = renderQaScenario(scenario(WEB), url).html;

    expect(source.split(url).length - 1).toBe(1);
    expect(source.split("View as webpage").length - 1).toBe(1);
    // https, and pointing at the public newsletter path.
    expect(source).toMatch(/href="https:\/\/[^"]*\/n\/[A-Za-z0-9_-]{16,}"/);
  });

  it("never prints a local or private address, whatever it is handed", () => {
    // The renderer is the last line of defence: the resolver already refuses these,
    // and it refuses them again here.
    for (const url of [
      "http://localhost:3000/n/abc123def456ghi789",
      "http://127.0.0.1:3000/n/abc123def456ghi789",
      "http://192.168.1.20:3000/n/abc123def456ghi789",
      "http://10.0.0.5:3000/n/abc123def456ghi789",
      "http://[::1]:3000/n/abc123def456ghi789",
    ]) {
      const source = renderQaScenario(scenario(WEB), url).html;
      expect(source, url).not.toContain("View as webpage");
      expect(source, url).not.toContain("localhost");
      expect(source, url).not.toContain("127.0.0.1");
      expect(source, url).not.toContain("192.168.");
      expect(source, url).not.toContain("10.0.0.");
    }
  });

  it("puts the link above the masthead and keeps it quiet", () => {
    const url = "https://example-tunnel.lhr.life/n/abc123def456ghi789";
    const source = renderQaScenario(scenario(WEB), url).html;
    expect(source.indexOf(url)).toBeLessThan(source.indexOf("AXIS Advanced Mapping"));
    const row = source.slice(source.indexOf(url) - 400, source.indexOf(url) + 200);
    expect(row).toContain("font-size:12px");
    expect(row).not.toContain("bgcolor");
  });

  it("still carries the hero, two secondary articles, images and one button", () => {
    const url = "https://example-tunnel.lhr.life/n/abc123def456ghi789";
    const source = renderQaScenario(scenario(WEB), url).html;
    expect(scenario(WEB).items).toHaveLength(3);
    expect(source.split("font-size:38px").length - 1).toBe(1);
    expect(source.split("font-size:21px").length - 1).toBe(2);
    expect(source.split('bgcolor="#0b5cab"').length - 1).toBe(1);
    expect(source).toContain("res.cloudinary.com");
  });

  it("only the web-version scenarios carry a web-version link", () => {
    const linked = QA_SCENARIOS.filter((s) => s.webVersionCampaignName);
    expect(linked.map((s) => s.id)).toEqual([WEB, "QA-WEB-VERSION-RETEST"]);
  });

  it("the retest carries the required subject and the same behaviour", () => {
    const retest = scenario("QA-WEB-VERSION-RETEST");
    expect(renderQaScenario(retest).subject).toBe(
      "[AXIS Newsletter Platform TEST] View as Webpage — Tunnel Retest",
    );
    // Same campaign, same articles — only the subject and review notes differ.
    expect(retest.webVersionCampaignName).toBe(scenario(WEB).webVersionCampaignName);
    expect(retest.items).toEqual(scenario(WEB).items);

    const url = "https://example-tunnel.lhr.life/n/abc123def456ghi789";
    const source = renderQaScenario(retest, url).html;
    expect(source.split("View as webpage").length - 1).toBe(1);
    expect(source.split(url).length - 1).toBe(1);
    // And the dead hostname from the first attempt appears nowhere.
    expect(source).not.toContain("1e510c449aed4f");
  });
});

// ---------------------------------------------------------------------------
// The footer, unchanged
// ---------------------------------------------------------------------------

describe("the footer is not made more prominent by any of this", () => {
  it("carries exactly one unsubscribe affordance and no List-Unsubscribe", () => {
    for (const id of PREMIUM_IDS) {
      const source = html(id);
      expect(source.toLowerCase(), id).not.toContain("list-unsubscribe");
      const he = source.split(">הסרה מרשימת התפוצה<").length - 1;
      const en = source.split(">Unsubscribe<").length - 1;
      const ar = source.split(">إلغاء الاشتراك<").length - 1;
      expect(he + en + ar, id).toBe(1);
    }
  });

  it("keeps the real contact address in the footer", () => {
    expect(html("QA-PREMIUM-GENERAL")).toContain("info@axis-gps.com");
  });

  it("unsubscribes nobody — a QA message carries no live token", () => {
    for (const id of PREMIUM_IDS) {
      // A per-recipient token in a test email is a live unsubscribe link for a
      // colleague, and would differ on every render.
      expect(html(id), id).not.toMatch(/\/unsubscribe\/[A-Za-z0-9_-]{20,}/);
    }
  });
});
