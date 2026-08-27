"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import * as qaEmailService from "../../../server/services/qaEmailService";

/**
 * Server action for QA email.
 *
 * Thin by design. The recipient arrives as a form value and is treated as untrusted —
 * `sendQaEmail` forces it through the allowlist gate regardless of what the page
 * rendered. A crafted POST naming a fifth address is refused there, before any
 * transport is obtained.
 */
export async function sendQaEmailAction(formData: FormData): Promise<void> {
  const scenarioId = formData.get("scenarioId");
  const recipient = formData.get("recipient");
  const confirm = formData.get("confirm");

  if (typeof scenarioId !== "string" || typeof recipient !== "string") return;

  if (confirm !== "yes") {
    redirect(
      `/admin/qa-email?error=${encodeURIComponent("Tick the confirmation box before sending a QA email.")}`,
    );
  }

  const result = await qaEmailService.sendQaEmail({ scenarioId, recipient });
  revalidatePath("/admin/qa-email");

  redirect(
    result.ok
      ? `/admin/qa-email?sent=1&message=${encodeURIComponent(`${result.testId} — ${result.subject} → ${result.recipient}`)}`
      : `/admin/qa-email?error=${encodeURIComponent(result.message)}`,
  );
}
