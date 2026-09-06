"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TranslationSourceOverview } from "../../domain/content/hebrewTranslation";
import { createHebrewArticleTranslation, prepareArticleForChatgpt, saveArticleFromChatgpt } from "../../server/services/articleTranslationService";

export interface TranslationActionState { message: string }
export interface ChatgptPreparationState { message: string; prompt: string; receipt: string; source: TranslationSourceOverview | null }
export async function prepareChatgptArticle(_state: ChatgptPreparationState, form: FormData): Promise<ChatgptPreparationState> {
  const id = form.get("id");
  if (typeof id !== "string" || id.length > 100) return { message: "Choose an external article.", prompt: "", receipt: "", source: null };
  const result = await prepareArticleForChatgpt(id);
  return result.ok ? { message: "", prompt: result.prompt, receipt: result.receipt, source: result.source } : { message: result.message, prompt: "", receipt: "", source: null };
}
export async function importChatgptArticle(_state: TranslationActionState, form: FormData): Promise<TranslationActionState> {
  const id = form.get("id"), receipt = form.get("receipt"), reply = form.get("reply");
  if (typeof id !== "string" || id.length > 100 || typeof receipt !== "string" || typeof reply !== "string")
    return { message: "Prepare this article for ChatGPT, then paste its complete reply." };
  const result = await saveArticleFromChatgpt(id, receipt, reply);
  if (!result.ok) return { message: result.message };
  revalidatePath("/content"); revalidatePath("/content/inbox"); revalidatePath(`/content/inbox/${id}`);
  revalidatePath(`/content/${id}/edit`);
  redirect(`/content/${result.contentItemId}/edit?translated=1`);
}
export async function translateArticleToHebrew(_state: TranslationActionState, form: FormData): Promise<TranslationActionState> {
  const id = form.get("id");
  if (typeof id !== "string" || id.length > 100) return { message: "Choose an external article to translate." };
  const result = await createHebrewArticleTranslation(id);
  if (!result.ok) return { message: result.message };
  revalidatePath("/content"); revalidatePath("/content/inbox"); revalidatePath(`/content/inbox/${id}`);
  redirect(`/content/${result.contentItemId}/edit?translated=1`);
}
