"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { FieldError } from "../../domain/content/contentValidation";
import * as contentService from "../../server/services/contentService";

/**
 * Server actions for the content library.
 *
 * Thin by design: read the form, call a service, map the result (CLAUDE.md — no
 * business logic in the route/action layer). All validation happens server-side
 * inside the service, so a crafted request cannot bypass the UI's checks.
 */

/** Type-only export: a "use server" module may export nothing but async functions. */
export interface ContentFormState {
  ok: boolean;
  errors: FieldError[];
}

function readForm(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : null;
  };
  return {
    title: text("title") ?? "",
    summary: text("summary"),
    body: text("body"),
    language: text("language") ?? "UNKNOWN",
    origin: text("origin"),
    externalUrl: text("externalUrl"),
    author: text("author"),
    sourceName: text("sourceName"),
    imageUrl: text("imageUrl"),
    imageAlt: text("imageAlt"),
    publishedAt: text("publishedAt"),
  };
}

export async function createContentAction(
  _prev: ContentFormState,
  formData: FormData,
): Promise<ContentFormState> {
  const result = await contentService.createContent(readForm(formData));
  if (!result.ok) return { ok: false, errors: result.errors };

  revalidatePath("/content");
  revalidatePath("/");
  redirect(`/content/${result.data.id}/edit?saved=1`);
}

export async function updateContentAction(
  _prev: ContentFormState,
  formData: FormData,
): Promise<ContentFormState> {
  const id = formData.get("id");
  if (typeof id !== "string" || id === "") {
    return { ok: false, errors: [{ field: "id", message: "That article no longer exists." }] };
  }

  const result = await contentService.updateContent(id, readForm(formData));
  if (!result.ok) return { ok: false, errors: result.errors };

  revalidatePath("/content");
  revalidatePath(`/content/${id}/edit`);
  return { ok: true, errors: [] };
}

export async function setReviewStateAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  const state = formData.get("reviewState");
  if (typeof id !== "string" || typeof state !== "string") return;
  if (state !== "APPROVED" && state !== "REJECTED" && state !== "PENDING_REVIEW") return;

  await contentService.setReviewState(id, state);
  revalidatePath("/content");
  revalidatePath(`/content/${id}/edit`);
  revalidatePath("/");
}

export async function deleteContentAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;

  const result = await contentService.deleteContent(id);
  revalidatePath("/content");
  revalidatePath("/");

  if (!result.ok) {
    redirect(`/content?error=${encodeURIComponent(result.errors[0]?.message ?? "Could not delete.")}`);
  }
  redirect("/content");
}
