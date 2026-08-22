"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import * as reviewService from "../../../server/services/contentReviewService";
import * as draftService from "../../../server/services/newsletterDraftService";

/**
 * Server actions for the review inbox.
 *
 * Approving is the ONLY way an externally collected article becomes usable, and it
 * happens here, by a person, one article at a time. Nothing in this file approves in
 * bulk and nothing sends.
 */

function backToInbox(params: Record<string, string>): never {
  redirect(`/content/inbox?${new URLSearchParams(params).toString()}`);
}

export async function approveContentAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  const from = formData.get("from");
  if (typeof id !== "string") return;

  const result = await reviewService.approveContent(id);
  revalidatePath("/content/inbox");
  revalidatePath(`/content/inbox/${id}`);

  if (typeof from === "string" && from === "detail") {
    redirect(`/content/inbox/${id}?approved=1`);
  }
  backToInbox(result.ok ? { approved: "1" } : { error: result.errors[0].message });
}

export async function rejectContentAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  const from = formData.get("from");
  if (typeof id !== "string") return;

  const result = await reviewService.rejectContent(id);
  revalidatePath("/content/inbox");
  revalidatePath(`/content/inbox/${id}`);

  if (typeof from === "string" && from === "detail") {
    redirect(`/content/inbox/${id}?rejected=1`);
  }
  backToInbox(result.ok ? { rejected: "1" } : { error: result.errors[0].message });
}

export async function returnToInboxAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;
  await reviewService.returnToInbox(id);
  revalidatePath("/content/inbox");
  redirect(`/content/inbox/${id}?returned=1`);
}

/** Saves AXIS's own words. Cannot alter the publisher's metadata or approve anything. */
export async function saveEditorialAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;

  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : null;
  };

  const result = await reviewService.saveEditorial(id, {
    axisHeadline: text("axisHeadline"),
    axisSummary: text("axisSummary"),
    ctaLabel: text("ctaLabel"),
    ctaUrl: text("ctaUrl"),
    internalNote: text("internalNote"),
  });

  revalidatePath(`/content/inbox/${id}`);
  redirect(
    result.ok
      ? `/content/inbox/${id}?saved=1`
      : `/content/inbox/${id}?error=${encodeURIComponent(result.errors[0].message)}`,
  );
}

/** Copies the article's picture into AXIS storage, on explicit request only. */
export async function importImageAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;

  const result = await reviewService.importArticleImage(id);
  revalidatePath(`/content/inbox/${id}`);
  redirect(
    result.ok
      ? `/content/inbox/${id}?imported=1`
      : `/content/inbox/${id}?error=${encodeURIComponent(result.errors[0].message)}`,
  );
}

/**
 * Builds a DRAFT newsletter from the ticked articles.
 *
 * The order of the checkboxes on the page is the order of the newsletter, and the
 * first one becomes the featured article. This creates a draft and nothing else — no
 * audience, no approval, no send.
 */
export async function createDraftAction(formData: FormData): Promise<void> {
  const ids = formData
    .getAll("selected")
    .filter((value): value is string => typeof value === "string");

  const result = await draftService.createDraftFromContent({ contentItemIds: ids });
  revalidatePath("/newsletters");

  if (!result.ok) {
    backToInbox({ error: result.message });
  }
  redirect(`/newsletters/${result.campaignId}?fromContent=1`);
}
