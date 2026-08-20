"use client";

import { useActionState } from "react";

import type { UnsubscribeFormState } from "../app/unsubscribe/[token]/actions";
import { buttonPrimary } from "./primitives";

/**
 * The public unsubscribe confirmation.
 *
 * Seen by a customer, not by AXIS staff, so it shows nothing about them: not their
 * address, not their company, not which newsletter this was. A person who follows a
 * link that was forwarded to them learns nothing about whoever it belonged to.
 *
 * There is deliberately no re-subscribe control (ADR-0024). Unsubscribing should be
 * the easy direction; coming back is a decision that needs a real, audited workflow.
 */

export function UnsubscribePanel({
  token,
  action,
  alreadyUnsubscribed,
}: {
  token: string;
  action: (
    state: UnsubscribeFormState,
    formData: FormData,
  ) => Promise<UnsubscribeFormState>;
  alreadyUnsubscribed: boolean;
}) {
  const initial: UnsubscribeFormState = alreadyUnsubscribed
    ? {
        status: "ALREADY",
        message:
          "This address is already unsubscribed. You will not receive AXIS newsletters.",
      }
    : { status: "IDLE", message: "" };

  const [state, formAction, pending] = useActionState(action, initial);

  const finished = state.status === "DONE" || state.status === "ALREADY";

  if (finished) {
    return (
      <div role="status" className="text-center">
        <p className="text-lg font-semibold text-slate-900">
          {state.status === "DONE"
            ? "You have been unsubscribed."
            : "You are already unsubscribed."}
        </p>
        <p className="mt-2 text-sm text-slate-600">{state.message}</p>
        <p className="mt-4 text-xs text-slate-500">
          If this was a mistake, reply to any AXIS message or contact us at{" "}
          <a
            href="mailto:info@axis-gps.com"
            className="font-semibold text-sky-700 hover:underline"
            dir="ltr"
          >
            info@axis-gps.com
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      {state.status === "ERROR" ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
        >
          {state.message}
        </p>
      ) : null}

      <p className="text-sm text-slate-600">
        You will stop receiving AXIS newsletters at the address this link was sent to.
        This does not affect service messages about equipment you own.
      </p>

      {/* The token travels in the form, not in a cookie: this action has no session
          to hijack, and possession of the link is the whole authorization. */}
      <form action={formAction} className="mt-5">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className={`${buttonPrimary} w-full`} disabled={pending}>
          {pending ? "Unsubscribing…" : "Unsubscribe"}
        </button>
      </form>
    </div>
  );
}
