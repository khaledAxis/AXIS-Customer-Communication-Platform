import { describe, expect, it } from "vitest";
import { prepareHebrewTranslation, completeHebrewTranslation, describeTranslationSource } from "./hebrewTranslation";
import { renderRichText } from "./richText";

const synthetic = (text: string) => `טקסט בעברית ${text}`;
describe("reviewed Hebrew translation plan", () => {
  it("identifies a feed excerpt without implying that the linked article was fetched", () => {
    const source = describeTranslationSource({ title: "Surveying", summary: "A short introduction…", externalUrl: "https://example.com/full-story" });
    expect(source.bodyWordCount).toBe(0); expect(source.bodyText).toBe("");
    expect(source.excerptAppearsCutOff).toBe(true); expect(source.bodyAppearsCutOff).toBe(false);
  });
  it("describes normalized saved body text without counting pictures as article words", () => {
    const source = describeTranslationSource({ title: "Surveying", bodyText: '<p>Capture <b>point clouds</b>.</p><img src="/image.jpg">', externalUrl: "https://example.com/story" });
    expect(source.bodyWordCount).toBe(3); expect(source.bodyText).toContain("**point clouds**");
    expect(source.bodyText).toContain("https://example.com/image.jpg"); expect(source.bodyAppearsCutOff).toBe(false);
    expect(describeTranslationSource({ title: "Surveying", bodyText: "![Scanner](https://example.com/image.jpg)" }).bodyWordCount).toBe(0);
    expect(describeTranslationSource({ title: "Surveying", bodyText: "The next step..." }).bodyAppearsCutOff).toBe(true);
  });
  it("preserves figures, product names, URLs, images, headings and lists", () => {
    const plan = prepareHebrewTranslation({ title: "NavVis CLX update", summary: "Accuracy is -5 mm at 40 m.",
      bodyText: '## Surveying\n\n- **GPS mapping** with Trimble SX12\n\n[Read more](https://example.com/story?q=2026)\n\n![Scanner](https://example.com/picture.jpg)' });
    const result = completeHebrewTranslation(plan, plan.segments.map(row => ({ id: row.id, text: synthetic(row.text) })));
    expect(result.title).toContain("NavVis CLX");
    expect(result.summary).toContain("-5 mm"); expect(result.summary).toContain("40 m");
    expect(result.body).toContain("## "); expect(result.body).toContain("- ");
    expect(result.body).toContain("**GPS mapping**");
    expect(result.body).toContain("](https://example.com/story?q=2026)");
    expect(result.body).toContain("![Scanner](https://example.com/picture.jpg)");
    const html = renderRichText(result.body, "rtl");
    expect(html).toContain('<span dir="ltr">GPS mapping</span>');
    expect(html).toContain('href="https://example.com/story?q=2026"');
    expect(html).not.toContain("⟦AXIS_");
  });
  it("keeps numbers and Latin units together within Hebrew output", () => {
    const html = renderRichText("דיוק של -5 mm וטווח של 40 m בשטח של 12 m².", "rtl");
    expect(html).toContain('<span dir="ltr">-5 mm</span>');
    expect(html).toContain('<span dir="ltr">40 m</span>');
    expect(html).toContain('<span dir="ltr">12 m².</span>');
  });
  it("preserves text order across long paragraphs and existing Hebrew", () => {
    const body = "מיפוי מדויק ".repeat(220).trim();
    const plan = prepareHebrewTranslation({ title: "מיפוי", bodyText: body });
    expect(completeHebrewTranslation(plan, plan.segments).body).toBe(body);
  });
  it.each(["missing", "duplicated", "invented", "untranslated", "unsafe markup"])("refuses %s output", kind => {
    const plan = prepareHebrewTranslation({ title: "NavVis surveying at 40 m" });
    let text = synthetic(plan.segments[0].text);
    if (kind === "missing") text = text.replace("⟦AXIS_0⟧", "");
    if (kind === "duplicated") text += " ⟦AXIS_0⟧";
    if (kind === "invented") text += " 100%";
    if (kind === "untranslated") text = plan.segments[0].text;
    if (kind === "unsafe markup") text += ' <img src="bad">';
    expect(() => completeHebrewTranslation(plan, [{ id: plan.segments[0].id, text }])).toThrow();
  });
  it("refuses missing, extra and duplicate segment identities", () => {
    const plan = prepareHebrewTranslation({ title: "Surveying", summary: "Mapping" });
    for (const result of [[], [{ id: "wrong", text: "מיפוי" }], [{ id: "s0", text: "מיפוי" }, { id: "s0", text: "מיפוי" }]])
      expect(() => completeHebrewTranslation(plan, result)).toThrow();
  });
  it("retains formatted HTML as normalized editable source", () => {
    const plan = prepareHebrewTranslation({ title: "Story", bodyText: '<h2>Mapping</h2><p>With <b>NavVis</b></p><img src="/hero.jpg">', externalUrl: "https://example.com/story" });
    expect(plan.source.body).toContain("## Mapping");
    expect(plan.source.body).toContain("https://example.com/hero.jpg");
    expect(JSON.stringify(plan.segments)).not.toContain("<img");
  });
  it("rejects content beyond the existing editor limit without truncation", () => {
    expect(() => prepareHebrewTranslation({ title: "Story", bodyText: "word ".repeat(10001) })).toThrow();
  });
  it("keeps RTL isolation out of link and image attributes", () => {
    const html = renderRichText('מיפוי עם **NavVis CLX** וגם [פרטים](https://example.com/GPS?a=1&b=2) ![מכשיר](https://example.com/photo.jpg)', "rtl");
    expect(html).toContain('<strong><span dir="ltr">NavVis CLX</span></strong>');
    expect(html).toContain('href="https://example.com/GPS?a=1&amp;b=2"');
    expect(html).toContain('src="https://example.com/photo.jpg"');
  });
});
