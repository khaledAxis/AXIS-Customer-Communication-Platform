"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { FieldError } from "../../domain/content/contentValidation";
import {
  setCampaignSegment,
  snapshotCampaignAudience,
} from "../../server/services/campaignAudienceService";
import * as newsletterService from "../../server/services/newsletterService";

/**
 * Server actions for the newsletter builder.
 *
 * Thin: read form -> service -> map result. Editability, duplicate prevention and
 * history protection are all enforced inside the service, never here.
 */

export interface NewsletterFormState {
  ok: boolean;
  errors: FieldError[];
}

function details(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    name: text("name"),
    subject: text("subject"),
    preheader: text("preheader"),
    language: text("language") || "UNKNOWN",
  };
}

export async function createNewsletterAction(
  _prev: NewsletterFormState,
  formData: FormData,
): Promise<NewsletterFormState> {
  const result = await newsletterService.createNewsletter(details(formData));
  if (!result.ok) return { ok: false, errors: result.errors };

  revalidatePath("/newsletters");
  revalidatePath("/");
  redirect(`/newsletters/${result.data.id}`);
}

export async function updateNewsletterAction(
  _prev: NewsletterFormState,
  formData: FormData,
): Promise<NewsletterFormState> {
  const id = formData.get("id");
  if (typeof id !== "string") {
    return { ok: false, errors: [{ field: "id", message: "That newsletter no longer exists." }] };
  }

  const result = await newsletterService.updateNewsletterDetails(id, details(formData));
  if (!result.ok) return { ok: false, errors: result.errors };

  revalidatePath(`/newsletters/${id}`);
  revalidatePath("/newsletters");
  return { ok: true, errors: [] };
}

async function mutateComposition(
  formData: FormData,
  run: (campaignId: string, contentItemId: string) => Promise<unknown>,
): Promise<void> {
  const campaignId = formData.get("campaignId");
  const contentItemId = formData.get("contentItemId");
  if (typeof campaignId !== "string" || typeof contentItemId !== "string") return;

  await run(campaignId, contentItemId);
  revalidatePath(`/newsletters/${campaignId}`);
  revalidatePath(`/newsletters/${campaignId}/preview`);
  revalidatePath("/newsletters");
}

export async function addContentAction(formData: FormData): Promise<void> {
  await mutateComposition(formData, newsletterService.addContent);
}

export async function removeContentAction(formData: FormData): Promise<void> {
  await mutateComposition(formData, newsletterService.removeContent);
}

export async function moveContentUpAction(formData: FormData): Promise<void> {
  await mutateComposition(formData, (campaignId, contentItemId) =>
    newsletterService.moveContent(campaignId, contentItemId, "UP"),
  );
}

export async function moveContentDownAction(formData: FormData): Promise<void> {
  await mutateComposition(formData, (campaignId, contentItemId) =>
    newsletterService.moveContent(campaignId, contentItemId, "DOWN"),
  );
}

export async function duplicateNewsletterAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;

  const result = await newsletterService.duplicateNewsletter(id);
  revalidatePath("/newsletters");
  if (result.ok) redirect(`/newsletters/${result.data.id}`);
}

export async function deleteNewsletterAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;

  const result = await newsletterService.deleteNewsletter(id);
  revalidatePath("/newsletters");
  revalidatePath("/");

  if (!result.ok) {
    redirect(
      `/newsletters?error=${encodeURIComponent(result.errors[0]?.message ?? "Could not delete.")}`,
    );
  }
  redirect("/newsletters");
}

/**
 * Audience selection for a newsletter.
 *
 * Choosing or re-resolving an audience is analysis: it creates no delivery
 * recipient and sends nothing. The service enforces that, and that the campaign
 * is still editable.
 */
export async function setCampaignSegmentAction(formData: FormData): Promise<void> {
  const campaignId = formData.get("campaignId");
  const segmentId = formData.get("segmentId");
  if (typeof campaignId !== "string") return;

  const chosen =
    typeof segmentId === "string" && segmentId !== "" ? segmentId : null;
  await setCampaignSegment(campaignId, chosen);
  revalidatePath(`/newsletters/${campaignId}`);
}

export async function snapshotAudienceAction(formData: FormData): Promise<void> {
  const campaignId = formData.get("campaignId");
  if (typeof campaignId !== "string") return;

  await snapshotCampaignAudience(campaignId);
  revalidatePath(`/newsletters/${campaignId}`);
}
