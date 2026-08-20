"use server";

import { revalidatePath } from "next/cache";

import {
  ReadinessError,
  approveForProduction,
  prepareFinalAudience,
  revokeProductionApproval,
} from "../../../server/services/sendReadinessService";

/**
 * Server actions for the send-readiness screen.
 *
 * Thin: read the campaign id, call a service, map the result. Every rule — audience
 * resolution, freezing, hashing, approval validity, four-eyes — lives in the service
 * and the domain, never here.
 *
 * There is deliberately NO action for sending. Production customer delivery is not
 * implemented, so this file exposes no route that could reach a customer, and the
 * readiness checklist reports production sending as blocked regardless of what is
 * approved.
 */

export interface ReadinessFormState {
  ok: boolean;
  message: string;
}

function campaignIdOf(formData: FormData): string | null {
  const id = formData.get("campaignId");
  return typeof id === "string" && id !== "" ? id : null;
}

export async function prepareFinalAudienceAction(
  _state: ReadinessFormState,
  formData: FormData,
): Promise<ReadinessFormState> {
  const campaignId = campaignIdOf(formData);
  if (!campaignId) {
    return { ok: false, message: "That newsletter no longer exists." };
  }

  try {
    const result = await prepareFinalAudience(campaignId);
    revalidatePath(`/newsletters/${campaignId}/readiness`);
    revalidatePath(`/newsletters/${campaignId}`);

    const truncated =
      result.destinationsTruncated || result.exclusionsTruncated
        ? ` Only ${result.destinationsStored.toLocaleString()} addresses and ${result.exclusionsStored.toLocaleString()} exclusions were stored — this audience is larger than one snapshot can hold.`
        : "";

    return {
      ok: true,
      message:
        `Final audience frozen: ${result.uniqueDestinations.toLocaleString()} address` +
        `${result.uniqueDestinations === 1 ? "" : "es"}, ${result.excluded.toLocaleString()} excluded.` +
        `${truncated} No email was sent and no delivery record was created.`,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ReadinessError
          ? error.message
          : "The final audience could not be prepared.",
    };
  }
}

export async function approveProductionAction(
  _state: ReadinessFormState,
  formData: FormData,
): Promise<ReadinessFormState> {
  const campaignId = campaignIdOf(formData);
  if (!campaignId) {
    return { ok: false, message: "That newsletter no longer exists." };
  }

  // A client-supplied "approved" flag is never trusted: the hash is computed on the
  // server from freshly rendered content and the frozen audience.
  const result = await approveForProduction(campaignId);
  revalidatePath(`/newsletters/${campaignId}/readiness`);
  return { ok: result.ok, message: result.message };
}

export async function revokeProductionApprovalAction(
  _state: ReadinessFormState,
  formData: FormData,
): Promise<ReadinessFormState> {
  const campaignId = campaignIdOf(formData);
  if (!campaignId) {
    return { ok: false, message: "That newsletter no longer exists." };
  }

  const result = await revokeProductionApproval(campaignId);
  revalidatePath(`/newsletters/${campaignId}/readiness`);
  return { ok: result.ok, message: result.message };
}
