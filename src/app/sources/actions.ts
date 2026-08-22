"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import * as sourceService from "../../server/services/contentSourceService";
import { runIngestion } from "../../server/services/contentIngestionService";

/**
 * Server actions for content sources.
 *
 * Thin: read the form, call the service, redirect with a message. Every guard — who
 * may add a source, and which addresses are permitted — lives in the service and in
 * `domain/content/sourceUrl`. Nothing is decided here.
 */

function back(params: Record<string, string>): never {
  redirect(`/sources?${new URLSearchParams(params).toString()}`);
}

function readInput(formData: FormData): sourceService.SourceInput {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : null;
  };
  return {
    name: text("name") ?? "",
    kind: text("kind") ?? "RSS",
    feedUrl: text("feedUrl"),
    baseUrl: text("baseUrl"),
    language: text("language"),
    categories: text("categories"),
  };
}

export async function createSourceAction(formData: FormData): Promise<void> {
  const result = await sourceService.createSource(readInput(formData));
  revalidatePath("/sources");
  back(result.ok ? { created: "1" } : { error: result.errors[0].message });
}

export async function updateSourceAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;
  const result = await sourceService.updateSource(id, readInput(formData));
  revalidatePath("/sources");
  back(result.ok ? { updated: "1" } : { error: result.errors[0].message });
}

export async function setSourceEnabledAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  const enabled = formData.get("enabled");
  if (typeof id !== "string") return;

  const result = await sourceService.setSourceEnabled(id, enabled === "yes");
  revalidatePath("/sources");
  back(result.ok ? { updated: "1" } : { error: result.errors[0].message });
}

/**
 * "Check sources now."
 *
 * Fetches and stores article metadata. It cannot send anything: no provider is
 * reachable from the ingestion path.
 */
export async function checkSourcesAction(): Promise<void> {
  const result = await runIngestion();
  revalidatePath("/sources");
  revalidatePath("/content/inbox");
  back({ checked: "1", message: result.message });
}
