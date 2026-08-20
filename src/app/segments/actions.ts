"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  SegmentDefinitionError,
  SegmentIssue,
} from "../../domain/segment/segmentDefinition";
import { Language } from "../../domain/types";
import {
  AudiencePreview,
  SegmentInUseError,
  createSegment,
  deleteSegment,
  duplicateSegment,
  previewAudience,
  updateSegment,
} from "../../server/services/segmentService";

/**
 * Thin route layer: parse the form, call a service, map the result.
 *
 * The rules arrive as JSON from the builder, which makes them untrusted input —
 * the service re-validates every time, so a hand-crafted request cannot store
 * or run a rule the catalogue does not define.
 */

export interface SegmentFormState {
  ok: boolean;
  errors: SegmentIssue[];
  savedId?: string;
}

export interface PreviewState {
  ok: boolean;
  errors: SegmentIssue[];
  preview: AudiencePreview | null;
}

function toIssues(error: unknown): SegmentIssue[] {
  if (error instanceof SegmentDefinitionError) return error.issues;
  return [
    {
      path: "segment",
      message: error instanceof Error ? error.message : "Something went wrong.",
    },
  ];
}

function parseRules(formData: FormData): unknown {
  const raw = formData.get("definition");
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new SegmentDefinitionError([
      { path: "definition", message: "Add at least one condition first." },
    ]);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new SegmentDefinitionError([
      { path: "definition", message: "These conditions could not be read." },
    ]);
  }
}

export async function saveSegmentAction(
  _state: SegmentFormState,
  formData: FormData,
): Promise<SegmentFormState> {
  const id = formData.get("id");
  const name = String(formData.get("name") ?? "");
  const description = String(formData.get("description") ?? "");

  let savedId: string;
  try {
    const definition = parseRules(formData);
    if (typeof id === "string" && id !== "") {
      await updateSegment(id, { name, description, definition });
      savedId = id;
    } else {
      savedId = await createSegment({ name, description, definition });
    }
  } catch (error) {
    return { ok: false, errors: toIssues(error) };
  }

  revalidatePath("/segments");
  revalidatePath(`/segments/${savedId}`);

  if (typeof id !== "string" || id === "") redirect(`/segments/${savedId}`);
  return { ok: true, errors: [], savedId };
}

/**
 * Resolves the audience for the rules currently in the builder — saved or not.
 * Analysis only: nothing is written and nothing is sent.
 */
export async function previewAudienceAction(
  _state: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const language = String(formData.get("language") ?? "");
  const requireLanguage =
    language === Language.HE || language === Language.AR
      ? (language as Language)
      : null;

  try {
    const definition = parseRules(formData);
    const preview = await previewAudience(definition, { requireLanguage });
    return { ok: true, errors: [], preview };
  } catch (error) {
    return { ok: false, errors: toIssues(error), preview: null };
  }
}

export async function duplicateSegmentAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const copyId = await duplicateSegment(id);
  revalidatePath("/segments");
  redirect(`/segments/${copyId}`);
}

export async function deleteSegmentAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  try {
    await deleteSegment(id);
  } catch (error) {
    if (error instanceof SegmentInUseError) {
      redirect(`/segments/${id}?error=in-use`);
    }
    throw error;
  }
  revalidatePath("/segments");
  redirect("/segments");
}
