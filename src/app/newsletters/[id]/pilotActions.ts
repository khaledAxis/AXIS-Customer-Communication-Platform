"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import * as providerPilotService from "../../../server/services/providerPilotService";

/**
 * Server actions for the internal PROVIDER PILOT (ADR-0025).
 *
 * Thin, like the SAFE TEST actions: read the form, call the service, redirect with a
 * message. Every guard — the single authorised recipient, the pilot switch, the
 * verified domain, the single-use hash-bound approval — lives in the service, the
 * adapter and the database. Nothing here decides anything.
 *
 * Note what is absent: no recipient field, no sender field, no "send to" parameter.
 * The form carries a campaign id and a confirmation, and that is all it can carry.
 */

function backToPreview(campaignId: string, params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(`/newsletters/${campaignId}/preview?${query}`);
}

export async function approvePilotAction(formData: FormData): Promise<void> {
  const campaignId = formData.get("campaignId");
  const confirmation = formData.get("confirm");

  if (typeof campaignId !== "string") return;

  if (confirmation !== "yes") {
    backToPreview(campaignId, {
      error: "Please tick the confirmation box to approve this provider pilot.",
    });
  }

  const result = await providerPilotService.approvePilotSend(campaignId);
  revalidatePath(`/newsletters/${campaignId}/preview`);

  backToPreview(
    campaignId,
    result.ok ? { pilotApproved: "1" } : { error: result.message },
  );
}

export async function revokePilotApprovalAction(formData: FormData): Promise<void> {
  const campaignId = formData.get("campaignId");
  if (typeof campaignId !== "string") return;

  await providerPilotService.revokePilotApprovals(campaignId);
  revalidatePath(`/newsletters/${campaignId}/preview`);
  backToPreview(campaignId, { pilotRevoked: "1" });
}

/**
 * Submits the pilot. Reached only by a person pressing the button — no scheduler, no
 * worker, and no test invokes it.
 */
export async function sendPilotAction(formData: FormData): Promise<void> {
  const campaignId = formData.get("campaignId");
  if (typeof campaignId !== "string") return;

  const result = await providerPilotService.sendApprovedPilotEmail(campaignId);
  revalidatePath(`/newsletters/${campaignId}/preview`);

  backToPreview(
    campaignId,
    result.ok
      ? { pilotSent: "1", message: result.message }
      : { error: result.message },
  );
}
