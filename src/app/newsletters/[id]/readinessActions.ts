"use server";

import { revalidatePath } from "next/cache";

import {
  NotAuthenticatedError,
  NotAuthorizedError,
} from "../../../domain/auth/authorization";
import {
  DeliveryError,
  prepareDeliveryLedger,
} from "../../../server/services/deliveryService";
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

  // One logical preparation per token. The browser generates it once per intent and
  // resends it on a double click or a retried POST, so those collapse into a single
  // frozen snapshot instead of two (ADR-0023 §concurrency).
  const raw = formData.get("preparationKey");
  const preparationKey =
    typeof raw === "string" && raw.trim() !== "" ? raw.trim().slice(0, 100) : null;

  try {
    const result = await prepareFinalAudience(campaignId, preparationKey);
    revalidatePath(`/newsletters/${campaignId}/readiness`);
    revalidatePath(`/newsletters/${campaignId}`);

    const truncated =
      result.destinationsTruncated || result.exclusionsTruncated
        ? ` Only ${result.destinationsStored.toLocaleString()} addresses and ${result.exclusionsStored.toLocaleString()} exclusions were stored — this audience is larger than one snapshot can hold.`
        : "";

    if (result.deduplicated) {
      return {
        ok: true,
        message:
          `That audience was already prepared: ${result.uniqueDestinations.toLocaleString()} address` +
          `${result.uniqueDestinations === 1 ? "" : "es"}, ${result.excluded.toLocaleString()} excluded. ` +
          "Nothing was frozen twice.",
      };
    }

    return {
      ok: true,
      message:
        `Final audience frozen: ${result.uniqueDestinations.toLocaleString()} address` +
        `${result.uniqueDestinations === 1 ? "" : "es"}, ${result.excluded.toLocaleString()} excluded.` +
        `${truncated} No email was sent and no delivery record was created.`,
    };
  } catch (error) {
    if (error instanceof NotAuthenticatedError || error instanceof NotAuthorizedError) {
      return { ok: false, message: error.message };
    }
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

  // A client-supplied "approved" flag is never trusted, and neither is an approver
  // id: the hash is computed on the server from freshly rendered content and the
  // frozen audience, and the approver is the signed-in session.
  try {
    const result = await approveForProduction(campaignId);
    revalidatePath(`/newsletters/${campaignId}/readiness`);
    return { ok: result.ok, message: result.message };
  } catch (error) {
    if (error instanceof NotAuthenticatedError || error instanceof NotAuthorizedError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

export async function revokeProductionApprovalAction(
  _state: ReadinessFormState,
  formData: FormData,
): Promise<ReadinessFormState> {
  const campaignId = campaignIdOf(formData);
  if (!campaignId) {
    return { ok: false, message: "That newsletter no longer exists." };
  }

  try {
    const result = await revokeProductionApproval(campaignId);
    revalidatePath(`/newsletters/${campaignId}/readiness`);
    return { ok: result.ok, message: result.message };
  } catch (error) {
    if (error instanceof NotAuthenticatedError || error instanceof NotAuthorizedError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

/**
 * Prepares the production delivery ledger — a DRY RUN that creates records and sends
 * nothing (ADR-0024).
 *
 * Every precondition (current audience, valid approval, four-eyes, live vetoes) is
 * re-derived inside the service. There is no parameter here through which a recipient
 * could be supplied.
 */
export async function prepareDeliveryLedgerAction(
  _state: ReadinessFormState,
  formData: FormData,
): Promise<ReadinessFormState> {
  const campaignId = campaignIdOf(formData);
  if (!campaignId) {
    return { ok: false, message: "That newsletter no longer exists." };
  }

  try {
    const result = await prepareDeliveryLedger(campaignId);
    revalidatePath(`/newsletters/${campaignId}/readiness`);
    return { ok: true, message: result.message };
  } catch (error) {
    if (error instanceof NotAuthenticatedError || error instanceof NotAuthorizedError) {
      return { ok: false, message: error.message };
    }
    if (error instanceof DeliveryError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}
