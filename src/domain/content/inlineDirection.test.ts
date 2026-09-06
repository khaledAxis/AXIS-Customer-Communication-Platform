import { describe, expect, it } from "vitest";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { articleDirection, inlineDirectionFragments } from "./inlineDirection";
import { renderRichText } from "./richText";
import { normalizeArticleSource } from "./articleFormat";
import { prepareHebrewTranslation } from "./hebrewTranslation";
import { chatgptTranslationPrompt } from "./chatgptTranslation";

const runs = (text: string) => inlineDirectionFragments(text, "rtl").filter(part => part.ltr).map(part => part.text);
function textContent(node: DefaultTreeAdapterMap["node"]): string {
  return "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(textContent).join("") : "";
}

describe("browser inline BiDi isolation", () => {
  it.each(["NavVis CLX", "NavVis VLX", "RTK", "SLAM", "BIM"])("isolates %s and keeps Hebrew and sentence punctuation outside", term => {
    const text = `המערכת (${term}), מתאימה למדידות.`;
    expect(runs(text)).toEqual([term]);
    expect(inlineDirectionFragments(text, "rtl").map(part => part.text).join("")).toBe(text);
    const html = renderRichText(text, "rtl", "browser");
    expect(html).toContain(`(<bdi dir="ltr">${term}</bdi>),`);
    expect(textContent(parseFragment(html))).toBe(text);
  });
  it("keeps separate acronym punctuation outside and preserves technical fragments", () => {
    expect(runs("משלבים RTK, SLAM ו־BIM; עם NavVis CLX-450 ו־3D, בדיוק של -5 mm.")).toEqual(["RTK", "SLAM", "BIM", "NavVis CLX-450", "3D", "-5 mm"]);
    expect(runs("עבודה עם Müller ו־Cafe\u0301, גרסה v2.1.")).toEqual(["Müller", "Cafe\u0301", "v2.1"]);
  });
  it("preserves URL query syntax, balanced parentheses and email addresses", () => {
    const text = "לפרטים (https://example.com/scan_(CLX)?mode=RTK&format=BIM), או info@axis-gps.com.";
    expect(runs(text)).toEqual(["https://example.com/scan_(CLX)?mode=RTK&format=BIM", "info@axis-gps.com"]);
    const html = renderRichText(text, "rtl", "browser");
    expect(html).toContain("&amp;format=BIM</bdi>),");
    expect(textContent(parseFragment(html))).toBe(text);
  });
  it("uses the same isolation in paragraphs, headings, quotes, both list types and link labels", () => {
    const source = "## מדידה עם NavVis CLX\n\n### מיפוי עם NavVis VLX\n\nדיוק עם **RTK**.\n\n> תיעוד באמצעות SLAM.\n\n- מודל BIM.\n\n1. בדיקה עם NavVis CLX.\n\n[מערכת NavVis VLX](https://example.com/?a=RTK&b=BIM)";
    const html = renderRichText(source, "rtl", "browser");
    for (const tag of ["h2", "h3", "p", "blockquote", "li", "a"]) expect(html).toMatch(new RegExp(`<${tag}[^>]*>[^]*?<bdi dir="ltr">`));
    expect(html).toContain('<strong><bdi dir="ltr">RTK</bdi></strong>.');
    expect(html).toContain('href="https://example.com/?a=RTK&amp;b=BIM"');
    expect(html).not.toMatch(/(?:href|src|alt)="[^"]*<bdi/);
    expect(renderRichText(source, "rtl")).not.toContain("<bdi");
  });
  it("isolates imported figure captions without changing source or translation JSON", () => {
    const original = '<figure><img src="https://example.com/a.jpg" alt="NavVis CLX"><figcaption>צילום עם NavVis CLX, בשטח.</figcaption></figure>';
    const normalized = normalizeArticleSource(original).source;
    const plan = prepareHebrewTranslation({ title: "מיפוי עם NavVis VLX", bodyText: normalized });
    const before = JSON.stringify(plan); const prompt = chatgptTranslationPrompt(plan, "a".repeat(64));
    const html = renderRichText(normalized, "rtl", "browser");
    expect(html).toContain('צילום עם <bdi dir="ltr">NavVis CLX</bdi>, בשטח.');
    expect(html).toContain('alt="NavVis CLX"');
    expect(JSON.stringify(plan)).toBe(before); expect(chatgptTranslationPrompt(plan, "a".repeat(64))).toBe(prompt);
    expect(normalizeArticleSource(original).source).toBe(normalized);
  });
  it("escapes untrusted text, leaves Hebrew and LTR input alone, and adds no directional characters", () => {
    const text = 'מיפוי <script>alert("BIM")</script> עם NavVis CLX.';
    const html = renderRichText(text, "rtl", "browser");
    expect(html).not.toContain("<script>"); expect(textContent(parseFragment(html))).toBe(text);
    expect(html).not.toMatch(/[\u202a-\u202e\u2066-\u2069\u200e\u200f]/);
    expect(renderRichText("NavVis CLX, surveying.", "ltr", "browser")).not.toContain("<bdi");
    expect(runs("מיפוי בשטח, בדיוק רב.")).toEqual([]);
    expect(articleDirection("HE", "NavVis CLX בשטח")).toBe("rtl");
    expect(articleDirection("AR")).toBe("rtl"); expect(articleDirection("UNKNOWN")).toBe("ltr");
  });
});
