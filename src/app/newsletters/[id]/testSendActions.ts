"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import * as testSendService from "../../../server/services/testSendService";

/**
 * Server actions for the SAFE TEST send.
 *
 * Thin: read the form, call the service, redirect with a message. Every guard —
 * authorized addresses, approval validity, single use, idempotency — lives in the
 * service and the database, never here and never in the browser.
 */

function backToPreview(campaignId: string, params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(`/newsletters/${campaignId}/preview?${query}`);
}

export async function approveTestSendAction(formData: FormData): Promise<void> {
  const campaignId = formData.get("campaignId");
  const confirmation = formData.get("confirm");

  if (typeof campaignId !== "string") return;

  // The confirmation checkbox is a deliberate second action, not a formality.
  if (confirmation !== "yes") {
    backToPreview(campaignId, {
      error: "Please tick the confirmation box to approve this test email.",
    });
  }

  const result = await testSendService.approveTestSend(campaignId);
  revalidatePath(`/newsletters/${campaignId}/preview`);

  backToPreview(campaignId, result.ok ? { approved: "1" } : { error: result.message });
}

export async function revokeTestApprovalAction(formData: FormData): Promise<void> {
  const campaignId = formData.get("campaignId");
  if (typeof campaignId !== "string") return;

  await testSendService.revokeTestApprovals(campaignId);
  revalidatePath(`/newsletters/${campaignId}/preview`);
  backToPreview(campaignId, { revoked: "1" });
}

export async function sendTestEmailAction(formData: FormData): Promise<void> {
  const campaignId = formData.get("campaignId");
  if (typeof campaignId !== "string") return;

  const result = await testSendService.sendApprovedTestEmail(campaignId);
  revalidatePath(`/newsletters/${campaignId}/preview`);

  backToPreview(
    campaignId,
    result.ok ? { sent: "1", message: result.message } : { error: result.message },
  );
}
