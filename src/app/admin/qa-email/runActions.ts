"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import * as qaRunService from "../../../server/services/qaRunService";

/**
 * QA run lifecycle actions (ADR-0028).
 *
 * Opening a run is an ADMIN act and requires an explicit acknowledgement when live
 * sends already exist, because opening one does NOT reset the limits — the caps count
 * every live QA email ever sent.
 */

function back(params: Record<string, string>): never {
  redirect(`/admin/qa-email?${new URLSearchParams(params).toString()}`);
}

export async function openQaRunAction(formData: FormData): Promise<void> {
  const label = formData.get("label");
  const acknowledged = formData.get("acknowledged");
  const planned = formData.get("plannedCount");

  if (typeof label !== "string") return;

  const result = await qaRunService.openQaRun({
    label,
    plannedCount: typeof planned === "string" && planned !== "" ? Number(planned) : 0,
    acknowledgedExistingSends: acknowledged === "yes",
  });

  revalidatePath("/admin/qa-email");
  back(result.ok ? { runOpened: "1", message: result.message } : { error: result.message });
}

export async function closeQaRunAction(formData: FormData): Promise<void> {
  const runId = formData.get("runId");
  if (typeof runId !== "string") return;

  const result = await qaRunService.closeQaRun(runId);
  revalidatePath("/admin/qa-email");
  back(result.ok ? { runClosed: "1", message: result.message } : { error: result.message });
}
