import { describe, expect, it } from "vitest";
import { chatgptTranslationPrompt, importChatgptTranslation } from "./chatgptTranslation";
import { prepareHebrewTranslation } from "./hebrewTranslation";

const plan = prepareHebrewTranslation({ title: "NavVis CLX mapping", bodyText: "## Surveying\n\nAccuracy: 5 mm\n\n[Read more](https://example.com/article)" });
const sourceRef = "a".repeat(64);
const response = () => JSON.stringify({ sourceRef, segments: plan.segments.map(row => ({ ...row, text: `טקסט לבדיקה ${row.text}` })) });
describe("ChatGPT copy/paste translation", () => {
  it("prepares a self-contained prompt with protected passages", () => {
    const prompt = chatgptTranslationPrompt(plan, sourceRef);
    expect(prompt).toContain("ענן נקודות"); expect(prompt).toContain(sourceRef);
    expect(JSON.parse(prompt.split("ARTICLE_DATA:\n")[1])).toEqual({ sourceRef, segments: plan.segments });
  });
  it("makes excerpt-only scope explicit and keeps a saved full body in the prompt", () => {
    const excerptPlan = prepareHebrewTranslation({ title: "Surveying", summary: "An introduction…", externalUrl: "https://example.com/story" });
    const excerptPrompt = chatgptTranslationPrompt(excerptPlan, sourceRef);
    expect(excerptPrompt).toContain("No article body text is included");
    expect(excerptPrompt).toContain("Do not browse a website");
    expect(excerptPlan.segments).toHaveLength(2);
    const fullPlan = prepareHebrewTranslation({ title: "Surveying", summary: "An introduction…", bodyText: "First paragraph.\n\nLast paragraph." });
    const fullPrompt = chatgptTranslationPrompt(fullPlan, sourceRef);
    expect(fullPrompt).toContain("Last paragraph.");
    expect(fullPrompt).toContain("its completeness has not been verified");
  });
  it.each([false, true])("accepts a complete response with code fence=%s", fenced => {
    const reply = fenced ? "```json\n" + response() + "\n```" : response();
    const translated = importChatgptTranslation(plan, sourceRef, reply);
    expect(translated.title).toContain("NavVis CLX"); expect(translated.body).toContain("5 mm");
    expect(translated.body).toContain("](https://example.com/article)");
  });
  it.each(["", "A plain reply", "x".repeat(200_001), '{"sourceRef":"wrong","segments":[]}', JSON.stringify({ sourceRef, segments: [] })])
  ("refuses incomplete, oversized or mismatched replies", reply => {
    expect(() => importChatgptTranslation(plan, sourceRef, reply)).toThrow();
  });
  it("refuses edited protected facts after pasting", () => {
    expect(() => importChatgptTranslation(plan, sourceRef, response().replace("⟦AXIS_0⟧", "unexpected"))).toThrow();
  });
});
