import { describe, it, expect } from "vitest";

import { escapeHtml, excerpt, isSafeUrl, renderRichText, richTextToPlain } from "./richText";

describe("richText — XSS safety by construction", () => {
  it("escapes angle brackets so a script tag can never be produced", () => {
    const html = renderRichText('<script>alert("x")</script>');
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes attribute-breaking quotes", () => {
    expect(escapeHtml(`" onload='x'`)).toBe("&quot; onload=&#39;x&#39;");
  });

  it("refuses javascript: links and leaves them as plain text", () => {
    const html = renderRichText("[click](javascript:alert(1))");
    expect(html).not.toContain("href=");
    expect(html).toContain("[click](javascript:alert(1))");
  });

  it("refuses data: links", () => {
    const html = renderRichText("[x](data:text/html;base64,PHNjcmlwdD4=)");
    expect(html).not.toContain("href=");
  });

  it("accepts only http, https and mailto", () => {
    expect(isSafeUrl("https://axis-gps.com")).toBe(true);
    expect(isSafeUrl("http://axis-gps.com")).toBe(true);
    expect(isSafeUrl("mailto:info@axis-gps.com")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,x")).toBe(false);
    expect(isSafeUrl("vbscript:x")).toBe(false);
    expect(isSafeUrl("  https://ok.com  ")).toBe(true);
  });
});

describe("richText — supported formatting", () => {
  it("renders headings", () => {
    const html = renderRichText("## Big\n\n### Small");
    expect(html).toContain("<h2");
    expect(html).toContain("Big");
    expect(html).toContain("<h3");
    expect(html).toContain("Small");
  });

  it("renders bold and italic", () => {
    const html = renderRichText("This is **bold** and *italic*.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders a safe link with security attributes", () => {
    const html = renderRichText("[AXIS](https://axis-gps.com)");
    expect(html).toContain('href="https://axis-gps.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("renders bullet and numbered lists", () => {
    expect(renderRichText("- one\n- two")).toContain("<ul");
    expect(renderRichText("- one\n- two")).toContain("<li");
    expect(renderRichText("1. first\n2. second")).toContain("<ol");
  });

  it("groups consecutive bullets into a single list", () => {
    const html = renderRichText("- a\n- b\n- c");
    expect(html.match(/<ul/g)).toHaveLength(1);
    expect(html.match(/<li/g)).toHaveLength(3);
  });

  it("separates paragraphs on blank lines", () => {
    const html = renderRichText("First para.\n\nSecond para.");
    expect(html.match(/<p /g)).toHaveLength(2);
  });

  it("uses inline styles only — email clients ignore classes", () => {
    const html = renderRichText("## Heading\n\nBody **text**");
    expect(html).toContain("style=");
    expect(html).not.toContain("class=");
  });

  it("is deterministic — same input yields identical output", () => {
    const source = "## T\n\n- a\n- b\n\n[l](https://x.com)";
    expect(renderRichText(source)).toBe(renderRichText(source));
  });

  it("returns an empty string for empty input", () => {
    expect(renderRichText("")).toBe("");
    expect(renderRichText(null)).toBe("");
    expect(renderRichText(undefined)).toBe("");
  });

  it("pads lists on the correct side for RTL", () => {
    expect(renderRichText("- item", "rtl")).toContain("padding-right");
    expect(renderRichText("- item", "ltr")).toContain("padding-left");
  });

  it("renders Hebrew and Arabic text unchanged", () => {
    expect(renderRichText("שלום עולם")).toContain("שלום עולם");
    expect(renderRichText("مرحبا بالعالم")).toContain("مرحبا بالعالم");
  });
});

describe("richText — plain text and excerpt", () => {
  it("strips markers for the plain-text alternative", () => {
    const plain = richTextToPlain("## Title\n\n**bold** and *italic*\n\n- item");
    expect(plain).toContain("Title");
    expect(plain).not.toContain("**");
    expect(plain).not.toContain("##");
    expect(plain).toContain("• item");
  });

  it("keeps the URL visible in plain text", () => {
    expect(richTextToPlain("[AXIS](https://axis-gps.com)")).toBe("AXIS (https://axis-gps.com)");
  });

  it("truncates an excerpt on a word boundary", () => {
    const long = `${"word ".repeat(100)}`;
    const short = excerpt(long, 50);
    expect(short.length).toBeLessThanOrEqual(51);
    expect(short.endsWith("…")).toBe(true);
  });

  it("leaves a short excerpt untouched", () => {
    expect(excerpt("Short text")).toBe("Short text");
  });
});
