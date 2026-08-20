"use server";

import { headers } from "next/headers";

import { confirmUnsubscribe } from "../../../server/services/unsubscribeService";

/**
 * The one write a recipient can perform, with no AXIS account.
 *
 * CSRF REASONING (ADR-0024): the classic CSRF threat is an attacker causing a
 * *victim's authenticated session* to act. There is no session here — the token in the
 * URL is the entire authorization, and it is not a cookie, so a cross-site request
 * carries nothing the attacker did not already have. Anyone able to forge this request
 * already possesses the token and could simply open the link themselves.
 *
 * What the POST does buy is protection from a DIFFERENT problem: link prefetchers,
 * security scanners and corporate proxies open every URL in an email. A GET that
 * unsubscribed would silently opt people out who never clicked. So the confirmation
 * step exists for accident-safety, not for CSRF, and Next.js server actions add their
 * own same-origin check on top at no cost.
 *
 * The token is read from the route parameter and re-validated server-side; nothing
 * else about the request is trusted.
 */

export interface UnsubscribeFormState {
  status: "IDLE" | "DONE" | "ALREADY" | "ERROR";
  message: string;
}

/**
 * A best-effort client identifier for the abuse throttle only.
 *
 * Spoofable, and therefore used for nothing but bounding invalid attempts. It never
 * authorizes anything and never appears in the audit trail.
 */
async function clientKey(): Promise<string> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first && first !== "" ? first : (list.get("x-real-ip") ?? "unknown");
}

export async function confirmUnsubscribeAction(
  _state: UnsubscribeFormState,
  formData: FormData,
): Promise<UnsubscribeFormState> {
  const token = formData.get("token");

  const result = await confirmUnsubscribe(token, { clientKey: await clientKey() });

  if (!result.ok) {
    return { status: "ERROR", message: result.message };
  }

  return result.alreadyUnsubscribed
    ? {
        status: "ALREADY",
        message:
          "This address was already unsubscribed. Nothing changed, and you will not receive AXIS newsletters.",
      }
    : {
        status: "DONE",
        message: "You have been unsubscribed from AXIS newsletter emails.",
      };
}
