import { completeHebrewTranslation, HEBREW_TRANSLATION_INSTRUCTIONS, TranslationContentError, type TranslationPlan } from "./hebrewTranslation";

/** Portable article data only; no sign-in receipt, internal notes or credentials. */
export function chatgptTranslationPrompt(plan: TranslationPlan, sourceRef: string): string {
  const scope = plan.source.body.trim() ? "Saved article body text is included; its completeness has not been verified."
    : "No article body text is included. These passages contain only the saved title and any saved excerpt; do not present their translation as the full article.";
  return `${HEBREW_TRANSLATION_INSTRUCTIONS}\n\nThis is a copy-and-paste translation for the AXIS article editor. Return one JSON object with exactly two fields: "sourceRef" (copy the value below unchanged) and "segments" (the translated id/text entries). Do not include an introduction or an explanation. The user will copy your complete response into AXIS.\n\n${scope} The user is supplying the passages below directly. Translate only ARTICLE_DATA. Do not browse a website or retrieve missing article text from a link.\n\nARTICLE_DATA:\n${JSON.stringify({ sourceRef, segments: plan.segments }, null, 2)}`;
}

export function importChatgptTranslation(plan: TranslationPlan, sourceRef: string, reply: string) {
  if (!reply.trim() || reply.length > 200_000) throw new TranslationContentError("Paste the complete ChatGPT reply, up to 200,000 characters.");
  const text = reply.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new TranslationContentError("That reply could not be read. Copy ChatGPT’s complete response to the prepared prompt and paste it here."); }
  if (!value || typeof value !== "object" || !("sourceRef" in value) || value.sourceRef !== sourceRef || !("segments" in value))
    throw new TranslationContentError("This reply does not match this article. Use the prompt prepared here and copy its complete response.");
  return completeHebrewTranslation(plan, value.segments);
}
