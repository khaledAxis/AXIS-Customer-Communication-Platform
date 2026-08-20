"use server";

import { revalidatePath } from "next/cache";

import {
  ConsentAssignmentError,
  type ConsentCounts,
} from "../../domain/communication/consentAssignment";
import {
  LanguageAssignmentError,
  type LanguageCounts,
} from "../../domain/communication/languageAssignment";
import {
  setConsent,
  setLanguage,
} from "../../server/services/communicationService";

/**
 * Thin route layer for communication settings.
 *
 * Two actions, deliberately separate: one submits a language, the other a consent
 * decision with its evidence. Neither can reach the other's column, and there is no
 * action at all for email status, unsubscribe or suppression — those are separate
 * decisions with no write path in this milestone (ADR-0020, ADR-0021).
 */

export interface LanguageFormState {
  ok: boolean;
  message: string;
  changed?: number;
  unchanged?: number;
  before?: LanguageCounts;
  after?: LanguageCounts;
}

const LANGUAGE_NAME: Record<string, string> = {
  HE: "Hebrew",
  AR: "Arabic",
  UNKNOWN: "Not set",
};

export async function setLanguageAction(
  _state: LanguageFormState,
  formData: FormData,
): Promise<LanguageFormState> {
  const language = formData.get("language");
  const addressIds = formData.getAll("addressId").filter((v) => typeof v === "string");

  try {
    const result = await setLanguage({ language, addressIds });

    revalidatePath("/communication");
    revalidatePath("/customers");
    revalidatePath("/segments");

    const name = LANGUAGE_NAME[String(language)] ?? String(language);
    const message =
      result.changed === 0
        ? `Nothing to change — those ${result.unchanged} addresses were already set to ${name}.`
        : `${result.changed} address${result.changed === 1 ? "" : "es"} set to ${name}.` +
          (result.unchanged > 0 ? ` ${result.unchanged} already had that language.` : "");

    return {
      ok: true,
      message,
      changed: result.changed,
      unchanged: result.unchanged,
      before: result.before,
      after: result.after,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof LanguageAssignmentError
          ? error.message
          : "That change could not be saved.",
    };
  }
}

export interface ConsentFormState {
  ok: boolean;
  message: string;
  changed?: number;
  unchanged?: number;
  before?: ConsentCounts;
  after?: ConsentCounts;
}

const CONSENT_NAME: Record<string, string> = {
  UNKNOWN: "Not confirmed",
  GRANTED: "Approved for communication",
  DENIED: "Do not send",
};

/**
 * Records a consent decision.
 *
 * The confirmation checkbox, the documented basis and the effective date are read
 * straight from the form and validated in `domain/communication/consentAssignment`.
 * Nothing is defaulted here: an absent confirmation is a rejection, not a `true`.
 */
export async function setConsentAction(
  _state: ConsentFormState,
  formData: FormData,
): Promise<ConsentFormState> {
  const status = formData.get("consentStatus");
  const addressIds = formData.getAll("addressId").filter((v) => typeof v === "string");

  try {
    const result = await setConsent({
      status,
      addressIds,
      source: formData.get("consentSource"),
      note: formData.get("consentNote"),
      effectiveAt: formData.get("consentEffectiveAt"),
      confirmed: formData.get("consentConfirmed"),
    });

    revalidatePath("/communication");
    revalidatePath("/customers");
    revalidatePath("/segments");
    revalidatePath("/newsletters");

    const name = CONSENT_NAME[String(status)] ?? String(status);
    const message =
      result.changed === 0
        ? `Nothing to change — those ${result.unchanged} addresses were already "${name}".`
        : `${result.changed} address${result.changed === 1 ? "" : "es"} recorded as "${name}".` +
          (result.unchanged > 0
            ? ` ${result.unchanged} already had that setting.`
            : "") +
          " Nothing was sent.";

    return {
      ok: true,
      message,
      changed: result.changed,
      unchanged: result.unchanged,
      before: result.before,
      after: result.after,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ConsentAssignmentError
          ? error.message
          : "That change could not be saved.",
    };
  }
}
